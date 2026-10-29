// NOTIFY service (IPB-01 NOTIFY, IPB-07-25; PL3 plan §6, PL3-D-20). One request fans out to in-app,
// email, SMS, WhatsApp and push:
// - channels: catalogue defaults → `ntf.org.routing` → the user's `ntf.user.channels`;
// - `kill.msg.<channel>` refuses a channel before any I/O (`killed`, IPB-NTF-004 semantics);
// - non-urgent classes are digest-first; urgent ones respect quiet hours unless they may bypass;
// - marketing needs a GRANTED consent for the address and purpose (default deny);
// - the platform suppression list (C-23 keyed hashes) is checked just before each send;
// - an unknown vendor outcome is resent once for `safe` classes and held for a person for `hold`
//   classes (owner, PL2-D-65), never resent automatically.
// Callers pass principal references only; addresses come from the product's `ContactResolver`
// and are never stored, logged or put on a queue.
import { AsyncLocalStorage } from "node:async_hooks";
import { IpbError, PortError } from "@infrabyx/contracts/errors";
import type {
  ApprovalGateway,
  AuditSink,
  HumanQueue,
  InboxItemInput,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import {
  NotificationRequest,
  type AdapterDescriptor,
  type ChannelMatrix,
  type ContactResolver,
  type DeliveryRecord,
  type DeliveryState,
  type DomainCheck,
  type EmailEvent,
  type EmailPort,
  type NotificationClass,
  type NotifyChannel,
  type NotifyPort,
  type PortCall,
  type PortHealth,
  type PushPort,
  type RenderedChannels,
  type SendResult,
  type SmsDeliveryReport,
  type SmsPort,
  type SuppressionInput,
  type WhatsappEvent,
  type WhatsappPort,
} from "@infrabyx/contracts/ports";
import { internalEvent } from "@infrabyx/config/events";
import {
  addressHash,
  newId,
  randomBytes,
  sha256Hex,
  toBase64Url,
  type AddressKind,
  type SecretKey,
} from "@infrabyx/crypto";
import { NotFoundError, ServiceReader, type ServiceReadRecord } from "@infrabyx/tenancy";
import type { Catalogue } from "./catalogue.js";
import { assertPreferences, effectiveChannels, isCollectionClass, timing } from "./routing.js";

/** The context a push token store runs in while NOTIFY delivers (see `PgPushTokenStore`). */
export const notifyContext = new AsyncLocalStorage<KernelContext>();

export const NOTIFY_PRINCIPAL_ID = "svc_notify";
const serviceContext = (tenantId: string): KernelContext => ({
  tenantId,
  principal: { id: NOTIFY_PRINCIPAL_ID, type: "service", roles: ["SVC_NOTIFY"] },
});
/** The dispatcher's identity: the cross-tenant service reader SVC_NOTIFY_DISPATCH (PL3-D-21). */
export const NOTIFY_DISPATCH_PRINCIPAL_ID = "svc_notify_dispatch";

const KIND: Record<"email" | "sms" | "whatsapp", AddressKind> = {
  email: "email",
  sms: "phone",
  whatsapp: "phone",
};
const PLATFORM_REASONS = new Set(["hard_bounce", "complaint", "invalid"]);
export const SUPPRESSION_LIFT_ACTION = "notify.suppression.lift";
const UNSUBSCRIBE_TTL_DAYS = 90;

export interface NotifyChannels {
  email?: { port: EmailPort; brand: string };
  sms?: { port: SmsPort; senderId: string; dltEntityId: string };
  whatsapp?: { port: WhatsappPort };
  push?: { port: PushPort };
}

/** The slice of `SettingsService` NOTIFY reads (and writes, for preferences). */
export interface NotifySettings {
  get(ctx: KernelContext, key: string, scope?: { userId?: string }): Promise<unknown>;
  set?(
    ctx: KernelContext,
    key: string,
    target: { tier: "USER"; scopeId: string },
    value: unknown,
  ): Promise<unknown>;
}

export interface NotifyServiceOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  product: string;
  catalogue: Catalogue;
  contacts: ContactResolver;
  channels: NotifyChannels;
  /** FlagService: `kill.msg.<channel>` (IPB-02-83). */
  flags: { isOn(key: string): Promise<boolean> };
  /** The group consent key (C-23), read through SECRETS. */
  consentKey: SecretKey;
  settings?: NotifySettings;
  outbox?: OutboxWriter;
  /** Work Inbox for held resends (implemented by `@infrabyx/workflow`). */
  humanQueue?: HumanQueue;
  /** Who confirms a held resend (default the tenant's ORG_ADMIN role). */
  holdAssignee?: InboxItemInput["assignee"];
  /** The recipient's time zone (default Asia/Kolkata, A-07; OWNER-QUESTIONS #23). */
  timezone?: (ctx: KernelContext, recipientRef: string) => Promise<string | undefined>;
  /**
   * A narrower contact window for collection and recovery classes (`"HH:MM-HH:MM"` inside
   * 08:00–21:00 in the recipient's zone); a wider one is refused (OWNER-QUESTIONS #23).
   */
  contactWindow?: (
    ctx: KernelContext,
    cls: NotificationClass,
    recipientRef: string,
  ) => Promise<string | undefined>;
  /** Title texts by `title_key`, then locale; `{var}` placeholders are filled from `vars`. */
  messages?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Called with the Ecosystem `MarketingConsentUpdated` data the product publishes. */
  onConsentChanged?: (tx: Tx, data: Record<string, unknown>) => Promise<void>;
  /** Leave due deliveries for `dispatchDue` (a worker) instead of delivering after `send`. */
  deferDelivery?: boolean;
  /** Operational log of the dispatcher's cross-tenant reads (the ledger has them as well). */
  onServiceRead?: (r: ServiceReadRecord) => void;
  pseudonymKey?: SecretKey;
  now?: () => Date;
}

interface DeliveryRow {
  id: string;
  tenant_id: string;
  notification_id: string;
  recipient_ref: string;
  channel: NotifyChannel;
  state: DeliveryState;
  resend_class: "safe" | "hold";
  attempt: number;
  send_after: Date;
  adapter: string | null;
  vendor_ref: string | null;
  last_error_code: string | null;
  updated_at: Date;
}
interface NotificationRow {
  id: string;
  class_id: string;
  deep_link: string;
  vars: Record<string, string | number | boolean>;
  locale: string | null;
}

const toRecord = (d: DeliveryRow): DeliveryRecord => ({
  deliveryId: d.id,
  recipient: d.recipient_ref,
  channel: d.channel,
  state: d.state,
  attempt: d.attempt,
  ...(d.adapter ? { adapter: d.adapter } : {}),
  ...(d.last_error_code ? { lastErrorCode: d.last_error_code } : {}),
  updatedAt: d.updated_at.toISOString(),
});

/** A vendor outcome we cannot know: a timeout or the vendor down mid-call (IPB-PORT-002). */
const unknownOutcome = (e: unknown): boolean =>
  e instanceof PortError
    ? e.code === "IPB-PORT-002"
    : (e as { code?: string })?.code === "IPB-PORT-002";
const codeOf = (e: unknown): string => {
  const c = (e as { code?: unknown })?.code;
  return typeof c === "string" && /^[A-Z]{2,4}-[A-Z0-9]{2,6}-\d{3}$/.test(c) ? c : "error";
};

export class NotifyService implements NotifyPort {
  readonly descriptor: AdapterDescriptor = {
    port: "NOTIFY",
    adapter: "notify",
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
  };

  private readonly dispatcher: ServiceReader;
  private readonly unsubscribeReader: ServiceReader;
  constructor(private readonly o: NotifyServiceOptions) {
    const reader = (role: "SVC_NOTIFY_DISPATCH" | "SVC_NOTIFY_UNSUBSCRIBE", principalId: string) =>
      new ServiceReader({
        kernel: o.kernel,
        audit: o.audit,
        role,
        principalId,
        ...(o.onServiceRead ? { onRead: o.onServiceRead } : {}),
      });
    this.dispatcher = reader("SVC_NOTIFY_DISPATCH", NOTIFY_DISPATCH_PRINCIPAL_ID);
    this.unsubscribeReader = reader("SVC_NOTIFY_UNSUBSCRIBE", "svc_notify_unsubscribe");
  }

  private now(): Date {
    return this.o.now?.() ?? new Date();
  }

  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: new Date().toISOString() };
  }

  // -------------------------------------------------------------------------------- sending

  /** Send: record the notification and its deliveries, then deliver what is due now. */
  async send(ctx: KernelContext, req: NotificationRequest, _call?: PortCall): Promise<SendResult> {
    const plan = await this.plan(ctx, req);
    const res = await this.o.kernel.mutate(ctx, (tx) => this.write(tx, req, plan), {
      action: "notify.notification.create",
    });
    if (this.o.deferDelivery || res.replay) return res.result;
    for (const d of res.result.deliveries)
      if (d.state === "queued" && res.due.has(d.deliveryId)) await this.deliver(ctx, d.deliveryId);
    return this.result(ctx, res.result.notificationId);
  }

  /**
   * Record a notification inside the caller's transaction (for example a workflow timer); its
   * deliveries are left for `dispatchDue`, so nothing is sent if the caller rolls back.
   */
  async enqueue(tx: Tx, req: NotificationRequest): Promise<SendResult> {
    const plan = await this.plan(tx.ctx, req);
    return (await this.write(tx, req, plan)).result;
  }

  private async plan(ctx: KernelContext, raw: NotificationRequest) {
    const req = NotificationRequest.parse(raw);
    const cls = this.o.catalogue.get(req.class);
    const at = this.now();
    const org = await this.setting(ctx, "ntf.org.routing");
    const bypass = await this.setting(ctx, "ntf.org.allow_quiet_hours_bypass");
    const plan: Array<{
      ref: string;
      channel: NotifyChannel;
      state: DeliveryState;
      sendAfter: Date;
    }> = [];
    for (const { ref } of req.to) {
      const user = ref.startsWith("usr_") ? { userId: ref } : undefined;
      const prefs = user
        ? ((await this.setting(ctx, "ntf.user.channels", user)) as ChannelMatrix)
        : {};
      const channels = effectiveChannels(cls, (org as Record<string, unknown>) ?? {}, prefs ?? {});
      const tz = await this.o.timezone?.(ctx, ref);
      const window = isCollectionClass(cls)
        ? await this.o.contactWindow?.(ctx, cls, ref)
        : undefined;
      const t = timing(cls, at, {
        ...(tz ? { tz } : {}),
        ...(window ? { contactWindow: window } : {}),
        ...(user ? { quietHours: str(await this.setting(ctx, "ntf.quiet_hours", user)) } : {}),
        ...(user ? { digestTime: str(await this.setting(ctx, "ntf.user.digest_time", user)) } : {}),
        orgAllowsBypass: bypass !== false,
      });
      for (const channel of channels) {
        let state: DeliveryState = t.mode === "digest" ? "digested" : "queued";
        if (await this.killed(channel)) state = "killed";
        plan.push({ ref, channel, state, sendAfter: t.mode === "now" ? at : t.at });
      }
    }
    if (plan.length === 0) throw new IpbError("IPB-NTF-003", { meta: { class: cls.id } });
    return { req, cls, plan };
  }

  private async write(
    tx: Tx,
    req: NotificationRequest,
    p: Awaited<ReturnType<NotifyService["plan"]>>,
  ): Promise<{ result: SendResult; due: Set<string>; replay: boolean }> {
    const prior = await tx.query<{ id: string }>(
      "select id from notify.notification where idempotency_key = $1",
      [req.idempotencyKey],
    );
    if (prior.rows[0]) {
      const ds = await tx.query<DeliveryRow>(
        "select * from notify.delivery where notification_id = $1 order by created_at, id",
        [prior.rows[0].id],
      );
      await this.o.audit.record(tx, {
        action: "notify.notification.replay",
        resourceType: "notification",
        resourceId: prior.rows[0].id,
      });
      return {
        result: { notificationId: prior.rows[0].id, deliveries: ds.rows.map((d) => this.short(d)) },
        due: new Set(),
        replay: true,
      };
    }
    const id = newId("ntf");
    await tx.query(
      `insert into notify.notification (id, tenant_id, class_id, idempotency_key, deep_link, vars, locale, created_by)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
      [
        id,
        tx.ctx.tenantId,
        p.cls.id,
        req.idempotencyKey,
        req.deepLink,
        JSON.stringify(req.vars),
        req.locale ?? null,
        tx.ctx.principal.id,
      ],
    );
    const deliveries: SendResult["deliveries"] = [];
    const due = new Set<string>();
    const now = this.now();
    for (const d of p.plan) {
      const dlv = newId("dlv");
      await tx.query(
        `insert into notify.delivery (id, tenant_id, notification_id, recipient_ref, channel, state, resend_class, send_after)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [dlv, tx.ctx.tenantId, id, d.ref, d.channel, d.state, p.cls.resend, d.sendAfter],
      );
      deliveries.push({ recipient: d.ref, channel: d.channel, state: d.state, deliveryId: dlv });
      if (d.state === "queued" && d.sendAfter <= now) due.add(dlv);
    }
    await this.o.audit.record(tx, {
      action: "notify.notification.create",
      resourceType: "notification",
      resourceId: id,
      after: {
        class: p.cls.id,
        recipients: req.to.length,
        deliveries: Object.fromEntries(
          [...new Set(deliveries.map((d) => d.state))].map((s) => [
            s,
            deliveries.filter((d) => d.state === s).length,
          ]),
        ),
      },
    });
    return { result: { notificationId: id, deliveries }, due, replay: false };
  }

  /**
   * Send a one-time sign-in code now, on one channel, to the login being proven (customer sign-in,
   * R1-D-19). The class must be a `security` class with a template for the channel; its first
   * template variable is the code. The notification and delivery are recorded and ledgered as for
   * `send`, but the stored `vars` hold `[redacted]` in place of the code and the address is never
   * stored: the code exists only in this call. `kill.msg.<channel>` and the platform suppression
   * list apply. There is no resend and no hold: after an unknown outcome the customer asks for a
   * new code. The same idempotency key returns the first delivery's state without sending again.
   */
  async sendOneTimeCode(
    ctx: KernelContext,
    m: {
      class: string;
      /** Principal reference the delivery is recorded against (`cus:<idp user id>`). */
      recipientRef: string;
      channel: "sms" | "whatsapp" | "email";
      address: string;
      code: string;
      expiresAt: Date;
      locale?: string;
      idempotencyKey: string;
    },
  ): Promise<DeliveryState> {
    const cls = this.o.catalogue.get(m.class);
    if (cls.category !== "security" || !cls.templates[m.channel])
      throw new IpbError("IPB-NTF-003", {
        detail: "one-time codes go out through a security class with a template for the channel",
        meta: { class: cls.id, channel: m.channel },
      });
    if (!/^[0-9]{4,10}$/.test(m.code)) throw new RangeError("a one-time code is 4 to 10 digits");
    const minutes = Math.max(
      1,
      Math.round((m.expiresAt.getTime() - this.now().getTime()) / 60_000),
    );
    const stored = { code: "[redacted]", expires_minutes: minutes };
    const res = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const prior = await tx.query<DeliveryRow>(
          `select d.* from notify.notification n join notify.delivery d on d.notification_id = n.id
            where n.idempotency_key = $1`,
          [m.idempotencyKey],
        );
        if (prior.rows[0]) {
          await this.o.audit.record(tx, {
            action: "notify.notification.replay",
            resourceType: "notification",
            resourceId: prior.rows[0].notification_id,
          });
          return { d: prior.rows[0], replay: true };
        }
        const id = newId("ntf");
        await tx.query(
          `insert into notify.notification (id, tenant_id, class_id, idempotency_key, deep_link, vars, locale, created_by)
           values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
          [
            id,
            tx.ctx.tenantId,
            cls.id,
            m.idempotencyKey,
            cls.deep_link,
            JSON.stringify(stored),
            m.locale ?? null,
            tx.ctx.principal.id,
          ],
        );
        const d = (
          await tx.query<DeliveryRow>(
            `insert into notify.delivery (id, tenant_id, notification_id, recipient_ref, channel, state, resend_class, send_after)
             values ($1, $2, $3, $4, $5, 'queued', 'hold', now()) returning *`,
            [newId("dlv"), tx.ctx.tenantId, id, m.recipientRef, m.channel],
          )
        ).rows[0] as DeliveryRow;
        await this.o.audit.record(tx, {
          action: "notify.notification.create",
          resourceType: "notification",
          resourceId: id,
          after: { class: cls.id, recipients: 1, deliveries: { queued: 1 }, one_time_code: true },
        });
        return { d, replay: false };
      },
      { action: "notify.notification.create" },
    );
    if (res.replay) return res.d.state;
    const d = res.d;
    if (await this.killed(m.channel))
      return this.settle(ctx, d, "killed", { error: "IPB-NTF-004" });
    const hash = addressHash(this.o.consentKey, KIND[m.channel], m.address);
    if (await this.suppressed(ctx, m.channel, hash, cls))
      return this.settle(ctx, d, "suppressed", { error: "suppressed" });
    const n: NotificationRow = {
      id: d.notification_id,
      class_id: cls.id,
      deep_link: cls.deep_link,
      vars: { code: m.code, expires_minutes: minutes },
      locale: m.locale ?? null,
    };
    try {
      const sent = await this.callChannel(ctx, d, n, cls, m.address, d.attempt);
      return await this.settle(ctx, d, sent.delivered ? "delivered" : "sent", sent);
    } catch (e) {
      return this.settle(ctx, d, "failed", { error: codeOf(e) });
    }
  }

  /** Deliver one queued delivery that is due (dispatcher, or right after `send`). */
  async deliver(ctx: KernelContext, deliveryId: string): Promise<DeliveryState | null> {
    const loaded = await this.o.kernel.read(ctx, async (tx) => {
      const d = (
        await tx.query<DeliveryRow>(
          "select * from notify.delivery where id = $1 and state = 'queued' and send_after <= now()",
          [deliveryId],
        )
      ).rows[0];
      if (!d) return null;
      const n = (
        await tx.query<NotificationRow>("select * from notify.notification where id = $1", [
          d.notification_id,
        ])
      ).rows[0] as NotificationRow;
      return { d, n };
    });
    if (!loaded) return null;
    const { d, n } = loaded;
    const cls = this.o.catalogue.get(n.class_id);
    if (await this.killed(d.channel))
      return this.settle(ctx, d, "killed", { error: "IPB-NTF-004" });
    // Addresses are resolved here and never leave this call.
    let address: string | null = null;
    if (d.channel === "email" || d.channel === "sms" || d.channel === "whatsapp") {
      const c = await this.o.contacts.resolve({ ref: d.recipient_ref }, d.channel);
      if (!c) return this.settle(ctx, d, "failed", { error: "no_address" });
      address = c.address;
      const hash = addressHash(this.o.consentKey, KIND[d.channel], address);
      if (await this.suppressed(ctx, d.channel, hash, cls))
        return this.settle(ctx, d, "suppressed", { error: "suppressed" });
      if (cls.category === "marketing" && !(await this.consented(ctx, hash, cls)))
        return this.settle(ctx, d, "suppressed", { error: "no_consent" });
    }
    for (let attempt = d.attempt; ; attempt++) {
      try {
        const sent = await this.callChannel(ctx, d, n, cls, address, attempt);
        return this.settle(ctx, d, sent.delivered ? "delivered" : "sent", { attempt, ...sent });
      } catch (e) {
        if (!unknownOutcome(e)) return this.settle(ctx, d, "failed", { attempt, error: codeOf(e) });
        if (cls.resend === "safe" && attempt < 2) continue;
        if (cls.resend === "safe")
          return this.settle(ctx, d, "failed", { attempt, error: codeOf(e) });
        return this.hold(ctx, d, n, attempt, codeOf(e));
      }
    }
  }

  private async callChannel(
    ctx: KernelContext,
    d: DeliveryRow,
    n: NotificationRow,
    cls: NotificationClass,
    address: string | null,
    attempt: number,
  ): Promise<{ adapter?: string; vendorRef?: string; delivered?: boolean }> {
    const call: PortCall = { idempotencyKey: `${d.id}:${attempt}` };
    const vars = n.vars ?? {};
    switch (d.channel) {
      case "inapp": {
        await this.o.kernel.mutate(
          ctx,
          async (tx) => {
            const id = newId("inm");
            await tx.query(
              `insert into notify.inapp_message (id, tenant_id, user_ref, notification_id, class_id, title, deep_link)
               values ($1, $2, $3, $4, $5, $6, $7)`,
              [
                id,
                ctx.tenantId,
                d.recipient_ref,
                n.id,
                cls.id,
                this.title(cls, "inapp", n),
                n.deep_link,
              ],
            );
            await this.o.audit.record(tx, {
              action: "notify.inapp.create",
              resourceType: "inapp_message",
              resourceId: id,
            });
          },
          { action: "notify.inapp.create" },
        );
        return { adapter: "inapp", delivered: true };
      }
      case "push": {
        const p = this.o.channels.push;
        if (!p) throw notConfigured("PUSH");
        const r = await notifyContext.run(ctx, () =>
          p.port.send(
            [d.recipient_ref],
            { title: this.title(cls, "push", n), deepLink: n.deep_link },
            call,
          ),
        );
        const ok = r.tickets.find((t) => t.status === "accepted");
        if (!ok && r.tickets.length)
          throw new PortError("IPB-PORT-001", "PUSH", {
            adapter: p.port.descriptor.adapter,
            detail: "no device accepted the push",
          });
        if (!r.tickets.length)
          throw new PortError("IPB-PORT-001", "PUSH", {
            adapter: p.port.descriptor.adapter,
            detail: "no registered device",
          });
        return {
          adapter: p.port.descriptor.adapter,
          ...(ok?.vendorId ? { vendorRef: ok.vendorId } : {}),
        };
      }
      case "email": {
        const e = this.o.channels.email;
        if (!e || !cls.templates.email) throw notConfigured("EMAIL");
        const r = await e.port.send(
          {
            to: [address as string],
            template: cls.templates.email.key,
            vars,
            brand: e.brand,
            tags: { ipb_class: cls.id },
          },
          call,
        );
        return { adapter: e.port.descriptor.adapter, vendorRef: r.messageId };
      }
      case "sms": {
        const s = this.o.channels.sms;
        if (!s || !cls.templates.sms) throw notConfigured("SMS");
        const r = await s.port.send(
          {
            to: address as string,
            templateId: cls.templates.sms.dlt_template_id,
            vars: Object.values(vars)
              .map((v) => String(v).slice(0, 30))
              .slice(0, 10),
            senderId: s.senderId,
            dltEntityId: s.dltEntityId,
          },
          call,
        );
        return { adapter: s.port.descriptor.adapter, vendorRef: r.messageId };
      }
      case "whatsapp": {
        const w = this.o.channels.whatsapp;
        const t = cls.templates.whatsapp;
        if (!w || !t) throw notConfigured("WHATSAPP");
        const r = await w.port.sendTemplate(
          {
            to: address as string,
            templateName: t.name,
            lang: n.locale && t.lang.includes(n.locale) ? n.locale : (t.lang[0] as string),
            components: [
              {
                type: "body",
                parameters: Object.values(vars).map((v) => ({ type: "text", text: String(v) })),
              },
            ],
          },
          call,
        );
        return { adapter: w.port.descriptor.adapter, vendorRef: r.messageId };
      }
    }
  }

  private async settle(
    ctx: KernelContext,
    d: DeliveryRow,
    state: DeliveryState,
    o: {
      attempt?: number;
      adapter?: string;
      vendorRef?: string;
      error?: string;
      inboxItemId?: string;
    },
  ): Promise<DeliveryState> {
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await tx.query(
          `update notify.delivery set state = $2, attempt = $3, adapter = coalesce($4, adapter),
                  vendor_ref = coalesce($5, vendor_ref), last_error_code = $6,
                  inbox_item_id = coalesce($7, inbox_item_id), updated_at = now()
            where id = $1`,
          [
            d.id,
            state,
            o.attempt ?? d.attempt,
            o.adapter ?? null,
            o.vendorRef ?? null,
            o.error ?? null,
            o.inboxItemId ?? null,
          ],
        );
        await this.o.audit.record(tx, {
          action: `notify.delivery.${state}`,
          resourceType: "delivery",
          resourceId: d.id,
          before: { state: d.state },
          after: {
            state,
            channel: d.channel,
            attempt: o.attempt ?? d.attempt,
            ...(o.error ? { error: o.error } : {}),
          },
        });
      },
      { action: `notify.delivery.${state}` },
    );
    return state;
  }

  /** `hold` class with an unknown outcome: never resent; a person confirms or discards (PL2-D-65). */
  private async hold(
    ctx: KernelContext,
    d: DeliveryRow,
    n: NotificationRow,
    attempt: number,
    error: string,
  ): Promise<DeliveryState> {
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const item = await this.o.humanQueue?.raise(tx, {
          type: "task",
          productModule: "notify",
          recordRef: d.id,
          title: `Confirm resend: ${n.class_id} by ${d.channel}`,
          assignee: this.o.holdAssignee ?? { kind: "role", id: "ORG_ADMIN" },
          severity: "warning",
          actionHint: "confirm_resend",
          deepLink: `/notifications/deliveries/${d.id}`,
          helpKey: "hlp.notify.held_resend",
        });
        await tx.query(
          `update notify.delivery set state = 'held', attempt = $2, last_error_code = $3, inbox_item_id = $4, updated_at = now()
            where id = $1`,
          [d.id, attempt, error, item?.id ?? null],
        );
        await this.o.audit.record(tx, {
          action: "notify.delivery.held",
          resourceType: "delivery",
          resourceId: d.id,
          before: { state: d.state },
          after: { state: "held", attempt, error },
        });
        await this.emit(tx, "NotificationHeld", {
          notification_id: n.id,
          delivery_id: d.id,
          class_id: n.class_id,
          channel: d.channel,
          inbox_item_id: item?.id ?? "none",
        });
      },
      { action: "notify.delivery.held" },
    );
    return "held";
  }

  /** A person's decision on a held delivery: resend once more, or discard. Ledgered. */
  async decideHeld(
    ctx: KernelContext,
    deliveryId: string,
    decision: "resend" | "discard",
  ): Promise<DeliveryState | null> {
    const d = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query<DeliveryRow>(
          `update notify.delivery set state = $2, attempt = least(attempt + $3, 3), send_after = now(),
                  last_error_code = $4, updated_at = now()
            where id = $1 and state = 'held' returning *`,
          [
            deliveryId,
            decision === "resend" ? "queued" : "failed",
            decision === "resend" ? 1 : 0,
            decision === "resend" ? null : "discarded",
          ],
        );
        const row = r.rows[0];
        if (!row) throw new NotFoundError("held delivery");
        await this.o.audit.record(tx, {
          action: `notify.delivery.${decision}`,
          resourceType: "delivery",
          resourceId: deliveryId,
          before: { state: "held" },
          after: { state: row.state, decided_by: ctx.principal.id },
        });
        return row;
      },
      { action: `notify.delivery.${decision}` },
    );
    return decision === "resend" ? this.deliver(ctx, d.id) : "failed";
  }

  /**
   * Dispatcher (worker): deliver due queued rows and send due digests, across tenants. Reads ids as
   * the service reader SVC_NOTIFY_DISPATCH (queue columns only, each read ledgered per tenant,
   * PL3-D-21); each delivery runs in its own tenant's context.
   */
  async dispatchDue(limit = 200): Promise<{ delivered: number; digests: number }> {
    const due = await this.dispatcher.read<{
      id: string;
      tenant_id: string;
      state: DeliveryState;
      recipient_ref: string;
      channel: NotifyChannel;
    }>(
      "notify.delivery",
      `select id, tenant_id, state, recipient_ref, channel from notify.delivery
        where state in ('queued', 'digested') and send_after <= now() order by send_after limit $1`,
      [limit],
    );
    let delivered = 0;
    const digests = new Map<
      string,
      { tenantId: string; ref: string; channel: NotifyChannel; ids: string[] }
    >();
    for (const r of due) {
      if (r.state === "queued") {
        if (await this.deliver(serviceContext(r.tenant_id), r.id)) delivered += 1;
        continue;
      }
      const k = `${r.tenant_id}|${r.recipient_ref}|${r.channel}`;
      const g = digests.get(k) ?? {
        tenantId: r.tenant_id,
        ref: r.recipient_ref,
        channel: r.channel,
        ids: [],
      };
      g.ids.push(r.id);
      digests.set(k, g);
    }
    for (const g of digests.values()) await this.sendDigest(g);
    return { delivered, digests: digests.size };
  }

  /** One digest message per recipient and channel (IPB-07-25), then the entries are marked sent. */
  private async sendDigest(g: {
    tenantId: string;
    ref: string;
    channel: NotifyChannel;
    ids: string[];
  }): Promise<void> {
    const ctx = serviceContext(g.tenantId);
    const day = this.now().toISOString().slice(0, 10);
    const res = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const n = await this.write(
          tx,
          {
            class: "digest.daily",
            to: [{ ref: g.ref }],
            vars: { count: g.ids.length },
            deepLink: "/inbox",
            idempotencyKey: `digest:${g.ref}:${g.channel}:${day}:${g.ids.length}:${g.ids[0]}`,
          },
          {
            req: {} as NotificationRequest,
            cls: this.o.catalogue.get("digest.daily"),
            plan: [{ ref: g.ref, channel: g.channel, state: "queued", sendAfter: this.now() }],
          },
        );
        await tx.query(
          "update notify.delivery set state = 'sent', updated_at = now() where id = any($1::text[]) and state = 'digested'",
          [g.ids],
        );
        await this.o.audit.record(tx, {
          action: "notify.digest.send",
          resourceType: "notification",
          resourceId: n.result.notificationId,
          after: { entries: g.ids.length, channel: g.channel },
        });
        await this.emit(tx, "NotificationDigestSent", {
          user_id: g.ref,
          channel: g.channel,
          entry_count: g.ids.length,
          digest_date: day,
        });
        return n;
      },
      { action: "notify.digest.send" },
    );
    for (const id of res.due) await this.deliver(ctx, id);
  }

  // -------------------------------------------------------------------------------- preferences

  async setPreferences(ctx: KernelContext, userId: string, prefs: ChannelMatrix): Promise<void> {
    const org = ((await this.setting(ctx, "ntf.org.routing")) ?? {}) as Record<string, unknown>;
    assertPreferences(this.o.catalogue.all(), prefs, org);
    if (!this.o.settings?.set)
      throw new Error("NotifyService needs settings.set to store preferences");
    await this.o.settings.set(ctx, "ntf.user.channels", { tier: "USER", scopeId: userId }, prefs);
  }

  // -------------------------------------------------------------------------------- suppression

  /** Add a suppression entry; platform scope only for address facts (bounce, complaint, invalid). */
  async suppress(ctx: KernelContext, e: SuppressionInput): Promise<void> {
    if (e.scope === "platform" && !PLATFORM_REASONS.has(e.reason))
      throw new IpbError("IPB-UX-011", {
        detail: "only hard bounces, complaints and invalid addresses are platform-wide",
      });
    const kind: AddressKind = e.channel === "email" ? "email" : "phone";
    const hash =
      e.channel === "push" ? sha256Hex(e.address) : addressHash(this.o.consentKey, kind, e.address);
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const id = newId("sup");
        const r = await tx.query(
          `insert into notify.suppression (id, tenant_id, channel, address_hash, reason, class_scope, source)
           values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing returning id`,
          [
            id,
            e.scope === "platform" ? "tnt_platform" : ctx.tenantId,
            e.channel,
            hash,
            e.reason,
            e.classScope,
            e.source.slice(0, 80),
          ],
        );
        await this.o.audit.record(tx, {
          action: "notify.suppression.add",
          resourceType: "suppression",
          resourceId: r.rowCount ? id : "existing",
          after: {
            channel: e.channel,
            reason: e.reason,
            scope: e.scope,
            class_scope: e.classScope,
          },
        });
      },
      { action: "notify.suppression.add" },
    );
  }

  /**
   * Lifting a suppression re-enables sending to someone who bounced, complained or opted out, so it
   * is an R2 maker-checker request (A-08). Register the executor once with `registerApprovals`.
   */
  async requestLift(
    ctx: KernelContext,
    approvals: ApprovalGateway,
    suppressionId: string,
  ): Promise<{ approvalId: string }> {
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query<{ id: string; channel: string; reason: string }>(
          "select id, channel, reason from notify.suppression where id = $1 and lifted_at is null",
          [suppressionId],
        );
        const row = r.rows[0];
        if (!row) throw new NotFoundError("suppression entry");
        const { id } = await approvals.request(tx, {
          action: SUPPRESSION_LIFT_ACTION,
          riskClass: "R2",
          payload: { suppressionId },
          summary: `Lift ${row.reason} suppression on ${row.channel}`,
        });
        return { approvalId: id };
      },
      { action: "notify.suppression.lift_request" },
    );
  }

  /** The executor for `notify.suppression.lift`; platform entries need a platform context (RLS). */
  registerApprovals(engine: {
    register(
      action: string,
      p: {
        execute: (
          tx: Tx,
          payload: Record<string, unknown>,
          request: { id: string },
        ) => Promise<void>;
      },
    ): unknown;
  }): void {
    engine.register(SUPPRESSION_LIFT_ACTION, {
      execute: async (tx, payload, request) => {
        const r = await tx.query(
          "update notify.suppression set lifted_at = now(), lift_approval_id = $2 where id = $1 and lifted_at is null",
          [String(payload.suppressionId), request.id],
        );
        if (!r.rowCount) throw new NotFoundError("suppression entry");
        await this.o.audit.record(tx, {
          action: "notify.suppression.lift",
          resourceType: "suppression",
          resourceId: String(payload.suppressionId),
          after: { approval_id: request.id },
        });
      },
    });
  }

  private async suppressed(
    ctx: KernelContext,
    channel: NotifyChannel,
    hash: string,
    cls: NotificationClass,
  ): Promise<boolean> {
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query(
        `select 1 from notify.suppression where channel = $1 and address_hash = $2 and lifted_at is null
           and (class_scope = 'all' or $3) limit 1`,
        [channel, hash, cls.category === "marketing"],
      );
      return (r.rowCount ?? 0) > 0;
    });
  }

  // -------------------------------------------------------------------------------- consent

  /** Record marketing consent for an address and purpose (before the CONSENT port, Ecosystem §6.39). */
  async setMarketingConsent(
    ctx: KernelContext,
    c: {
      channel: "email" | "sms" | "whatsapp";
      address: string;
      purpose: string;
      state: "GRANTED" | "WITHDRAWN";
      brandPackId?: string;
      consentref?: string;
      noticeVersion?: string;
    },
  ): Promise<void> {
    const hash = addressHash(this.o.consentKey, KIND[c.channel], c.address);
    await this.o.kernel.mutate(ctx, (tx) => this.writeConsent(tx, hash, c), {
      action: "notify.consent.set",
    });
  }

  private async writeConsent(
    tx: Tx,
    hash: string,
    c: {
      purpose: string;
      state: "GRANTED" | "WITHDRAWN";
      brandPackId?: string;
      consentref?: string;
      noticeVersion?: string;
    },
  ): Promise<void> {
    await tx.query(
      `insert into notify.marketing_consent (tenant_id, principal_hash, purpose, brand_pack_id, state, consentref, notice_version)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (tenant_id, principal_hash, purpose, brand_pack_id) do update
         set state = excluded.state, consentref = excluded.consentref, notice_version = excluded.notice_version, updated_at = now()`,
      [
        tx.ctx.tenantId,
        hash,
        c.purpose,
        c.brandPackId ?? "",
        c.state,
        c.consentref ?? null,
        c.noticeVersion ?? null,
      ],
    );
    await this.o.audit.record(tx, {
      action: "notify.consent.set",
      resourceType: "marketing_consent",
      resourceId: `${c.purpose}:${hash.slice(0, 12)}`,
      after: { purpose: c.purpose, state: c.state },
    });
  }

  private async consented(
    ctx: KernelContext,
    hash: string,
    cls: NotificationClass,
  ): Promise<boolean> {
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<{ state: string }>(
        `select state from notify.marketing_consent where principal_hash = $1 and purpose = $2
          order by updated_at desc limit 1`,
        [hash, cls.marketing_purpose],
      );
      return r.rows[0]?.state === "GRANTED";
    });
  }

  /** A random one-time unsubscribe token for a recipient and purpose (PL3-D-06); only its hash is kept. */
  async issueUnsubscribeToken(
    ctx: KernelContext,
    t: {
      recipientRef: string;
      channel: "email" | "sms" | "whatsapp";
      purpose: string;
      brandPackId?: string;
    },
  ): Promise<string> {
    const token = toBase64Url(randomBytes(32));
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await tx.query(
          `insert into notify.unsubscribe_token (token_hash, tenant_id, recipient_ref, channel, purpose, brand_pack_id, expires_at)
           values ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7))`,
          [
            sha256Hex(token),
            ctx.tenantId,
            t.recipientRef,
            t.channel,
            t.purpose,
            t.brandPackId ?? "",
            UNSUBSCRIBE_TTL_DAYS,
          ],
        );
        await this.o.audit.record(tx, {
          action: "notify.unsubscribe.issue",
          resourceType: "unsubscribe_token",
          resourceId: sha256Hex(token).slice(0, 16),
        });
      },
      { action: "notify.unsubscribe.issue" },
    );
    return token;
  }

  /** One-click unsubscribe (RFC 8058): withdraws marketing consent; the token works once. */
  async unsubscribe(token: string): Promise<void> {
    const h = sha256Hex(token);
    const row = (
      await this.unsubscribeReader.read<{
        tenant_id: string;
        recipient_ref: string;
        channel: "email" | "sms" | "whatsapp";
        purpose: string;
        brand_pack_id: string;
      }>(
        "notify.unsubscribe_token",
        `select tenant_id, recipient_ref, channel, purpose, brand_pack_id from notify.unsubscribe_token
          where token_hash = $1 and used_at is null and revoked_at is null and expires_at > now()`,
        [h],
      )
    )[0];
    if (!row) throw new NotFoundError("unsubscribe token");
    const ctx = serviceContext(row.tenant_id);
    const c = await this.o.contacts.resolve({ ref: row.recipient_ref }, row.channel);
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query(
          "update notify.unsubscribe_token set used_at = now() where token_hash = $1 and used_at is null",
          [h],
        );
        if (!r.rowCount) throw new NotFoundError("unsubscribe token");
        if (c) {
          const keyed = addressHash(this.o.consentKey, KIND[row.channel], c.address);
          await this.writeConsent(tx, keyed, {
            purpose: row.purpose,
            state: "WITHDRAWN",
            brandPackId: row.brand_pack_id,
          });
          await this.o.onConsentChanged?.(tx, {
            consent_id: `unsub-${h.slice(0, 24)}`,
            // The Ecosystem form, computed only here at the event boundary and never stored (PR-018).
            principal_hash: sha256Hex(`${KIND[row.channel]}:${c.address.trim().toLowerCase()}`),
            purpose: row.purpose,
            state: "WITHDRAWN",
            channel:
              row.channel === "email"
                ? "EMAIL_LINK"
                : row.channel === "sms"
                  ? "SMS_STOP"
                  : "WHATSAPP_STOP",
            brand_pack_id: row.brand_pack_id || "default",
            notice_version: "unsubscribe",
            occurred_at: new Date().toISOString(),
          });
        }
        await this.o.audit.record(tx, {
          action: "notify.unsubscribe.use",
          resourceType: "unsubscribe_token",
          resourceId: h.slice(0, 16),
        });
      },
      { action: "notify.unsubscribe.use" },
    );
  }

  // -------------------------------------------------------------------------------- delivery reports

  /** EMAIL events (verified by the adapter): delivery state; bounces and complaints suppress platform-wide. */
  async handleEmailEvents(
    ctx: KernelContext,
    adapter: string,
    events: readonly EmailEvent[],
  ): Promise<void> {
    for (const e of events) {
      const state: DeliveryState | null =
        e.type === "delivered"
          ? "delivered"
          : e.type === "bounced" || e.type === "rejected" || e.type === "complained"
            ? "failed"
            : null;
      if (state) await this.report(ctx, "email", adapter, e.messageId, state, e.type);
      if ((e.type === "bounced" || e.type === "complained") && e.recipient)
        await this.suppress(ctx, {
          channel: "email",
          address: e.recipient,
          reason: e.type === "bounced" ? "hard_bounce" : "complaint",
          scope: "platform",
          classScope: "all",
          source: `${adapter}:webhook`,
        });
    }
  }

  async handleSmsReports(
    ctx: KernelContext,
    adapter: string,
    reports: readonly SmsDeliveryReport[],
  ): Promise<void> {
    for (const r of reports)
      await this.report(
        ctx,
        "sms",
        adapter,
        r.messageId,
        r.status === "delivered" ? "delivered" : "failed",
        r.status,
      );
  }

  async handleWhatsappEvents(
    ctx: KernelContext,
    adapter: string,
    events: readonly WhatsappEvent[],
  ): Promise<void> {
    for (const e of events) {
      if (!e.messageId) continue;
      if (e.type === "delivered" || e.type === "read")
        await this.report(ctx, "whatsapp", adapter, e.messageId, "delivered", e.type);
      else if (e.type === "failed")
        await this.report(ctx, "whatsapp", adapter, e.messageId, "failed", e.type);
    }
  }

  private async report(
    ctx: KernelContext,
    channel: NotifyChannel,
    adapter: string,
    vendorRef: string,
    state: DeliveryState,
    vendorType: string,
  ): Promise<void> {
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query<{ id: string }>(
          `update notify.delivery set state = $4, updated_at = now(),
                  last_error_code = case when $4 = 'failed' then $5 else last_error_code end
            where channel = $1 and adapter = $2 and vendor_ref = $3 and state in ('sent', 'delivered', 'held') returning id`,
          [channel, adapter, vendorRef, state, `vendor_${vendorType}`],
        );
        for (const row of r.rows)
          await this.o.audit.record(tx, {
            action: `notify.delivery.report_${state}`,
            resourceType: "delivery",
            resourceId: row.id,
            after: { state, vendor_type: vendorType },
          });
      },
      { action: "notify.delivery.report" },
    );
  }

  // -------------------------------------------------------------------------------- queries

  async deliveryStatus(ctx: KernelContext, notificationId: string): Promise<DeliveryRecord[]> {
    return this.o.kernel.read(ctx, async (tx) =>
      (
        await tx.query<DeliveryRow>(
          "select * from notify.delivery where notification_id = $1 order by created_at, id",
          [notificationId],
        )
      ).rows.map(toRecord),
    );
  }

  /** The in-app list for the shell (PL5), newest first. */
  async inapp(
    ctx: KernelContext,
    userRef: string,
    limit = 50,
  ): Promise<
    Array<{ id: string; title: string; deepLink: string; createdAt: Date; readAt: Date | null }>
  > {
    return this.o.kernel.read(ctx, async (tx) =>
      (
        await tx.query<{
          id: string;
          title: string;
          deep_link: string;
          created_at: Date;
          read_at: Date | null;
        }>(
          "select id, title, deep_link, created_at, read_at from notify.inapp_message where user_ref = $1 order by created_at desc limit $2",
          [userRef, limit],
        )
      ).rows.map((r) => ({
        id: r.id,
        title: r.title,
        deepLink: r.deep_link,
        createdAt: r.created_at,
        readAt: r.read_at,
      })),
    );
  }

  async preview(
    classId: string,
    locale: string,
    vars: Record<string, unknown>,
  ): Promise<RenderedChannels> {
    const cls = this.o.catalogue.get(classId);
    const n: NotificationRow = {
      id: "preview",
      class_id: classId,
      deep_link: cls.deep_link,
      vars: vars as NotificationRow["vars"],
      locale,
    };
    const channels: RenderedChannels["channels"] = {};
    for (const ch of cls.default_channels) {
      if (ch === "inapp" || ch === "push")
        channels[ch] = { title: this.title(cls, ch, n), body: cls.deep_link };
      else if (ch === "email" && cls.templates.email)
        channels.email = {
          subject: this.title(cls, "inapp", n),
          body: `template ${cls.templates.email.key}`,
        };
      else if (ch === "sms" && cls.templates.sms)
        channels.sms = { body: `DLT ${cls.templates.sms.dlt_template_id}` };
      else if (ch === "whatsapp" && cls.templates.whatsapp)
        channels.whatsapp = { body: `template ${cls.templates.whatsapp.name}` };
    }
    return { classId, channels };
  }

  /** SPF, DKIM and DMARC as the EMAIL adapter reports them for the brand's domain (IPB-04-28). */
  async verifySenderDomain(_brand: string, domain: string): Promise<DomainCheck> {
    const e = this.o.channels.email;
    if (!e) throw notConfigured("EMAIL");
    const r = await e.port.verifyDomain(domain);
    const has = (f: (x: { type: string; name: string; value: string }) => boolean) =>
      r.verified && r.dnsRecords.some(f);
    return {
      domain,
      spf: has((x) => /v=spf1/i.test(x.value)),
      dkim: has((x) => /domainkey/i.test(x.name)),
      dmarc: has((x) => /^_dmarc\./i.test(x.name)),
    };
  }

  // -------------------------------------------------------------------------------- helpers

  private async result(ctx: KernelContext, notificationId: string): Promise<SendResult> {
    const ds = await this.deliveryStatus(ctx, notificationId);
    return {
      notificationId,
      deliveries: ds.map((d) => ({
        recipient: d.recipient,
        channel: d.channel,
        state: d.state,
        deliveryId: d.deliveryId,
      })),
    };
  }

  private short(d: DeliveryRow): SendResult["deliveries"][number] {
    return { recipient: d.recipient_ref, channel: d.channel, state: d.state, deliveryId: d.id };
  }

  private async killed(channel: NotifyChannel): Promise<boolean> {
    return this.o.flags.isOn(`kill.msg.${channel}`);
  }

  private async setting(
    ctx: KernelContext,
    key: string,
    scope?: { userId?: string },
  ): Promise<unknown> {
    if (!this.o.settings) return undefined;
    try {
      return await this.o.settings.get(ctx, key, scope);
    } catch {
      return undefined;
    }
  }

  private title(cls: NotificationClass, ch: "inapp" | "push", n: NotificationRow): string {
    const key = cls.templates[ch]?.title_key ?? cls.templates.inapp?.title_key ?? cls.id;
    const texts = this.o.messages?.[key];
    const text = (n.locale && texts?.[n.locale]) || texts?.en || key;
    return (
      text
        .replace(/\{([a-z][a-zA-Z0-9_]*)\}/g, (_, v: string) => String(n.vars?.[v] ?? ""))
        .slice(0, 120) || cls.id
    );
  }

  private async emit(
    tx: Tx,
    event: "NotificationHeld" | "NotificationDigestSent",
    data: Record<string, unknown>,
  ): Promise<void> {
    if (!this.o.outbox) return;
    const envelope = internalEvent({
      product: this.o.product,
      event,
      tenantId: tx.ctx.tenantId,
      data,
      actorId: tx.ctx.principal.id,
      ...(this.o.pseudonymKey ? { pseudonymKey: this.o.pseudonymKey } : {}),
    });
    await this.o.outbox.publish(tx, "notify", { envelope });
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const notConfigured = (port: string) =>
  new PortError("IPB-PORT-001", port, {
    adapter: "notify",
    detail: `NOTIFY has no ${port} channel configured`,
  });
