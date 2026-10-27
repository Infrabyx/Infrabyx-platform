// Feedback items (IPB-04-94…98, IPB-06-61/62; Ecosystem §6.40; PL5 plan §7.1).
//   submit        minimised payload (payload.ts), honeypot and rate limit (`IPB-FB-002`), the NPS
//                 rules, then one transaction: the item, its first status, the ledger entry and
//                 `FeedbackSubmitted` (plus `AccessibilityIssueReported` with the SLA due dates).
//   hand-off      after commit, `bug` and `accessibility` go to SUPPORT, the rest to BACKLOG. A failed
//                 hand-off keeps the item RECEIVED without a reference; the sweep retries it.
//   status loop   OH's `FeedbackStatusChanged` (or a poll of the port) moves the status; each change
//                 is a history row and an internal `FeedbackStatusChanged` for NOTIFY. The submitter
//                 sees the status in the app (their own items) or through the link with the view key.
// The person is never contacted from here; `contact_ok` only tells OH whether it may.
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import type { BacklogPort, FeedbackStatus, SupportPort } from "@infrabyx/contracts/ports";
import {
  AccessibilityIssueReportedData,
  EcoFeedbackStatusChanged,
  FEEDBACK_EVENTS,
  FeedbackStatusChangedInternalData,
  FeedbackSubmittedInternalData,
} from "@infrabyx/contracts";
import { internalEvent } from "@infrabyx/config/events";
import { newId, randomBytes, sha256Hex, toBase64Url } from "@infrabyx/crypto";
import { NotFoundError } from "@infrabyx/tenancy";
import {
  DEFAULT_CATEGORY,
  FEEDBACK_HONEYPOT,
  isOn,
  parseFeedback,
  routePattern,
  uaFamilies,
  type FeedbackType,
} from "./payload.js";

export const FEEDBACK_PRINCIPAL_ID = "svc_feedback";
export const FEEDBACK_OH_PRINCIPAL_ID = "svc_feedback_oh";
const CLOSED: readonly FeedbackStatus[] = ["SHIPPED", "DECLINED", "DUPLICATE"];
const SUPPORT_TYPES: readonly FeedbackType[] = ["bug", "accessibility"];

/** Settings the service reads (registered in `@infrabyx/config`). */
export interface SettingsReader {
  get(ctx: KernelContext, key: string): Promise<unknown>;
}

/** Who sent it: an authenticated context, or a public visitor of a pack's tenant by consent id. */
export type Submitter =
  | { ctx: KernelContext; firstSession?: boolean; userAgent?: string; clientKey: string }
  | {
      tenantId: string;
      cid: string;
      firstSession?: boolean;
      userAgent?: string;
      clientKey: string;
    };

export interface SubmitResult {
  id: string;
  /** Shown to the person; also the id OH quotes back. */
  reference: string;
  /** Returned once, for the status link (`/feedback/status/{id}?key=`); only its hash is kept. */
  viewKey: string;
  ohRef: string | null;
  status: "received";
}

export interface FeedbackView {
  id: string;
  type: FeedbackType;
  status: Lowercase<FeedbackStatus>;
  submittedAt: string;
  statusChangedAt: string;
  history: { status: Lowercase<FeedbackStatus>; at: string; note: string | null }[];
}

/** Roles that may read the staff queue. */
export const QUEUE_ROLES: readonly string[] = ["PLT_SUPER_ADMIN", "PLT_ACCESSIBILITY_LEAD"];

/** One row of the staff queue. */
export interface FeedbackQueueItem {
  id: string;
  type: FeedbackType;
  category: string;
  summary: string;
  route: string | null;
  severity: string | null;
  status: Lowercase<FeedbackStatus>;
  ohRef: string | null;
  priority: string | null;
  regulatedStep: boolean;
  ackDueAt: Date | null;
  fixDueAt: Date | null;
  slaBreaches: string[];
  submittedAt: Date;
}

interface ItemRow {
  id: string;
  tenant_id: string;
  type: FeedbackType;
  category: string;
  summary: string;
  route_pattern: string | null;
  severity: "S1" | "S2" | "S3" | "S4" | null;
  status: FeedbackStatus;
  oh_ref: string | null;
  contact_ok: boolean;
  user_id: string | null;
  view_key_sha256: string | null;
  created_at: Date;
  status_changed_at: Date;
}

const lower = (s: FeedbackStatus) => s.toLowerCase() as Lowercase<FeedbackStatus>;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** One business day after `from` (Monday to Friday; holidays are the OH calendar's job). */
export function addBusinessDay(from: Date): Date {
  const d = new Date(from.getTime() + DAY);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setTime(d.getTime() + DAY);
  return d;
}

export class FeedbackService {
  constructor(
    private readonly o: {
      kernel: MutationKernel;
      audit: AuditSink;
      product: string;
      support: SupportPort;
      backlog: BacklogPort;
      outbox?: OutboxWriter;
      settings?: SettingsReader;
      /** Anti-spam limit per client key (the app's hashed address or session); never stored. */
      allow?: (clientKey: string) => Promise<boolean> | boolean;
      /** Items one person may send in an hour (default 10). */
      maxPerHour?: number;
      /** The running release (`rel_` id) when the widget does not send one. */
      appVersion?: string;
      now?: () => Date;
    },
  ) {}

  private now(): Date {
    return this.o.now?.() ?? new Date();
  }

  private async setting<T>(ctx: KernelContext, key: string, fallback: T): Promise<T> {
    try {
      return ((await this.o.settings?.get(ctx, key)) ?? fallback) as T;
    } catch {
      return fallback;
    }
  }

  private static subject(s: Submitter): {
    ctx: KernelContext;
    userId: string | null;
    cid: string | null;
    role: string;
  } {
    if ("ctx" in s) {
      if (s.ctx.principal.type !== "user" || s.ctx.act)
        throw new IpbError("IPB-UX-011", { detail: "feedback is sent by the signed-in person" });
      return {
        ctx: s.ctx,
        userId: s.ctx.principal.id,
        cid: null,
        role: s.ctx.principal.roles.find((r) => /^(ORG|PLT|OPS)_/.test(r)) ?? "USER",
      };
    }
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(s.cid))
      throw new IpbError("IPB-FB-001", { detail: "missing consent id" });
    return {
      ctx: {
        tenantId: s.tenantId,
        principal: { id: FEEDBACK_PRINCIPAL_ID, type: "service", roles: [] },
      },
      userId: null,
      cid: s.cid,
      role: "VISITOR",
    };
  }

  private static subjectSql(userId: string | null): string {
    return userId ? "user_id = $2" : "cid = $2";
  }

  /** Whether to offer the NPS question: never in a first session, at most once per interval. */
  async npsDue(s: Submitter): Promise<boolean> {
    if (s.firstSession !== false) return false;
    const who = FeedbackService.subject(s);
    const days = Math.max(90, await this.setting(who.ctx, "fb.nps.interval_days", 90));
    const last = await this.o.kernel.read(who.ctx, (tx) =>
      tx.query<{ n: number }>(
        `select count(*)::int as n from feedback.item where tenant_id = $1 and ${FeedbackService.subjectSql(who.userId)}
           and type = 'nps' and created_at > $3`,
        [tx.ctx.tenantId, who.userId ?? who.cid, new Date(this.now().getTime() - days * DAY)],
      ),
    );
    return last.rows[0]!.n === 0;
  }

  async submit(raw: unknown, s: Submitter): Promise<SubmitResult> {
    const v = parseFeedback(raw);
    if (v[FEEDBACK_HONEYPOT]?.trim())
      throw new IpbError("IPB-FB-002", { detail: "anti-spam check" });
    if (this.o.allow && !(await this.o.allow(s.clientKey)))
      throw new IpbError("IPB-FB-002", { detail: "too many submissions" });
    const who = FeedbackService.subject(s);
    if (v.type === "nps" && !(await this.npsDue(s)))
      throw new IpbError("IPB-FB-002", { detail: "the score question is not due" });
    const route = v.route ? routePattern(v.route) : null;
    const ua = uaFamilies(s.userAgent);
    const now = this.now();
    const a11y = v.type === "accessibility" ? await this.dueDates(who.ctx, now, false, null) : null;
    const viewKey = toBase64Url(randomBytes(24));
    const summary =
      v.type === "accessibility" && v.expected
        ? `${v.summary}\n\nExpected: ${v.expected}`.slice(0, 2000)
        : v.summary;
    const category = v.category ?? DEFAULT_CATEGORY[v.type];
    const severity = v.type === "accessibility" && isOn(v.blocking) ? "S2" : null;

    const id = await this.o.kernel.mutate(
      who.ctx,
      async (tx) => {
        const recent = await tx.query<{ n: number }>(
          `select count(*)::int as n from feedback.item where tenant_id = $1 and ${FeedbackService.subjectSql(who.userId)}
             and created_at > $3`,
          [tx.ctx.tenantId, who.userId ?? who.cid, new Date(now.getTime() - HOUR)],
        );
        if (recent.rows[0]!.n >= (this.o.maxPerHour ?? 10))
          throw new IpbError("IPB-FB-002", { detail: "too many submissions" });
        const id = newId("fbk");
        await tx.query(
          `insert into feedback.item (id, tenant_id, type, category, surface, summary, nps_score, assistive_tech,
             route_pattern, app_version, brand_pack_id, locale, viewport_class, os_family, browser_family, trace_id,
             cid, user_id, submitted_by_role, view_key_sha256, contact_ok, severity, ack_due_at, interim_due_at,
             workaround_due_at, fix_due_at, created_at, status_changed_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
             $22, $23, $24, $25, $26, $27, $27)`,
          [
            id,
            tx.ctx.tenantId,
            v.type,
            category,
            v.type === "accessibility"
              ? "A11Y"
              : v.type === "help_content"
                ? "HELP_ARTICLE"
                : "WIDGET",
            summary,
            v.nps_score ?? null,
            v.assistive_tech || null,
            route,
            v.app_version ?? this.o.appVersion ?? null,
            v.brand_pack_id ?? null,
            v.locale ?? null,
            v.viewport ?? null,
            ua.os,
            ua.browser,
            v.trace_id ?? null,
            who.cid,
            who.userId,
            who.role,
            sha256Hex(viewKey),
            isOn(v.contact_ok),
            severity,
            a11y?.ack ?? null,
            a11y?.interim ?? null,
            a11y?.workaround ?? null,
            a11y?.fix ?? null,
            now,
          ],
        );
        await tx.query(
          `insert into feedback.status_change (id, tenant_id, item_id, status, source, changed_at)
           values ($1, $2, $3, 'RECEIVED', 'platform', $4)`,
          [newId("fbs"), tx.ctx.tenantId, id, now],
        );
        await this.o.audit.record(tx, {
          action: "feedback.submit",
          resourceType: "feedback_item",
          resourceId: id,
          after: { type: v.type, category, route_pattern: route },
        });
        await this.emit(tx, FEEDBACK_EVENTS.FeedbackSubmitted, {
          ...FeedbackSubmittedInternalData.parse({
            fbk_id: id,
            category,
            route_pattern: route,
            severity,
          }),
        });
        if (a11y)
          await this.emit(
            tx,
            FEEDBACK_EVENTS.AccessibilityIssueReported,
            AccessibilityIssueReportedData.parse({
              fbk_id: id,
              route_pattern: route,
              ack_due_at: a11y.ack.toISOString(),
              fix_due_at: a11y.fix.toISOString(),
            }),
          );
        return id;
      },
      { action: "feedback.submit" },
    );
    const ohRef = await this.handOff(who.ctx.tenantId, id).catch(() => null);
    return { id, reference: id, viewKey, ohRef, status: "received" };
  }

  /** IPB-06-62 due dates from `a11y.feedback.*` (fix: P1 on a regulated step, else the default). */
  private async dueDates(
    ctx: KernelContext,
    from: Date,
    regulatedP1: boolean,
    priority: string | null,
  ): Promise<{ ack: Date; interim: Date | null; workaround: Date; fix: Date }> {
    const ackHours = Math.min(24, await this.setting(ctx, "a11y.feedback.ack_hours", 24));
    const workDays = Math.min(5, await this.setting(ctx, "a11y.feedback.workaround_days", 5));
    const fix = await this.setting(ctx, "a11y.feedback.fix_days", { p1: 30, other: 90 });
    const fixDays = priority === "P1" ? Math.min(30, fix.p1) : Math.min(90, fix.other);
    return {
      ack: new Date(from.getTime() + ackHours * HOUR),
      interim: regulatedP1 ? addBusinessDay(from) : null,
      workaround: new Date(from.getTime() + workDays * DAY),
      fix: new Date(from.getTime() + fixDays * DAY),
    };
  }

  private async emit(tx: Tx, event: { module: string; name: string }, data: unknown) {
    if (!this.o.outbox) return;
    await this.o.outbox.publish(tx, "feedback", {
      envelope: internalEvent({
        product: this.o.product,
        event,
        tenantId: tx.ctx.tenantId,
        dataclass: "INTERNAL",
        data: data as Record<string, unknown>,
      }),
    });
  }

  private static ohContext(tenantId: string): KernelContext {
    return {
      tenantId,
      principal: { id: FEEDBACK_OH_PRINCIPAL_ID, type: "service", roles: [] },
    };
  }

  /**
   * Hand an item to OH (SUPPORT for bugs and accessibility, BACKLOG for the rest) and keep the
   * reference. Idempotent: an item that already has one is left alone.
   */
  async handOff(tenantId: string, id: string): Promise<string | null> {
    const ctx = FeedbackService.ohContext(tenantId);
    const item = await this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<ItemRow>(
        "select * from feedback.item where tenant_id = $1 and id = $2",
        [tenantId, id],
      );
      return r.rows[0];
    });
    if (!item) throw new NotFoundError("feedback item");
    if (item.oh_ref) return item.oh_ref;
    const base = {
      feedbackId: item.id,
      category: item.category as never,
      summary: item.summary.slice(0, 500),
      ...(item.route_pattern ? { routePattern: item.route_pattern } : {}),
      ...(item.severity ? { severity: item.severity } : {}),
      contactOk: item.contact_ok,
    };
    let ref: string;
    try {
      ref = SUPPORT_TYPES.includes(item.type)
        ? (
            await this.o.support.createTicket(
              { ...base, kind: item.type === "accessibility" ? "accessibility" : "bug" },
              { tenantId, idempotencyKey: item.id },
            )
          ).ref
        : (
            await this.o.backlog.createIdea(
              { ...base, kind: item.type as "idea" | "praise" | "nps" | "help_content" },
              { tenantId, idempotencyKey: item.id },
            )
          ).ref;
    } catch (e) {
      await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          await tx.query(
            "update feedback.item set hand_off_attempts = hand_off_attempts + 1 where id = $1",
            [id],
          );
          await this.o.audit.record(tx, {
            action: "feedback.hand_off_failed",
            resourceType: "feedback_item",
            resourceId: id,
            after: { attempts: "incremented" },
          });
        },
        { action: "feedback.hand_off_failed" },
      );
      throw e;
    }
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await tx.query("update feedback.item set oh_ref = $2 where id = $1 and oh_ref is null", [
          id,
          ref,
        ]);
        await this.o.audit.record(tx, {
          action: "feedback.hand_off",
          resourceType: "feedback_item",
          resourceId: id,
          after: { oh_ref: ref, port: SUPPORT_TYPES.includes(item.type) ? "SUPPORT" : "BACKLOG" },
        });
      },
      { action: "feedback.hand_off" },
    );
    return ref;
  }

  /**
   * OH's `FeedbackStatusChanged` (Ecosystem §6.40), consumed once per event id. An unchanged status
   * is a no-op; a closing status sets `closed_at`, which starts the 3-year purge clock (#48).
   */
  async onStatusChanged(e: { eventId: string; tenantId: string; data: unknown }): Promise<boolean> {
    const d = EcoFeedbackStatusChanged.parse(e.data);
    return this.applyStatus(e.tenantId, d.fbk_id, d.status, {
      source: "oh_event",
      at: new Date(d.changed_at),
      note: d.public_note ?? null,
      eventId: e.eventId,
    });
  }

  /** Ask OH for the current status (the poll behind "refresh" and the daily sweep). */
  async refreshStatus(tenantId: string, id: string): Promise<Lowercase<FeedbackStatus>> {
    const ctx = FeedbackService.ohContext(tenantId);
    const item = await this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<Pick<ItemRow, "type" | "oh_ref" | "status">>(
        "select type, oh_ref, status from feedback.item where tenant_id = $1 and id = $2",
        [tenantId, id],
      );
      return r.rows[0];
    });
    if (!item) throw new NotFoundError("feedback item");
    if (!item.oh_ref) return lower(item.status);
    const port = SUPPORT_TYPES.includes(item.type) ? this.o.support : this.o.backlog;
    const status = await port.getStatus(item.oh_ref, { tenantId });
    await this.applyStatus(tenantId, id, status, { source: "oh_poll", at: this.now(), note: null });
    return lower(status);
  }

  private async applyStatus(
    tenantId: string,
    id: string,
    status: FeedbackStatus,
    o: { source: "oh_event" | "oh_poll"; at: Date; note: string | null; eventId?: string },
  ): Promise<boolean> {
    const ctx = FeedbackService.ohContext(tenantId);
    const changed = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        if (o.eventId) {
          const seen = await tx.query(
            `insert into feedback.inbox (consumer, event_id, tenant_id) values ('fb.status', $1, $2)
             on conflict do nothing returning event_id`,
            [o.eventId, tenantId],
          );
          if (!seen.rowCount) {
            await this.o.audit.record(tx, {
              action: "feedback.status.duplicate",
              resourceType: "feedback_item",
              resourceId: id,
              after: { event_id: o.eventId },
            });
            return false;
          }
        }
        const cur = (
          await tx.query<ItemRow>(
            "select * from feedback.item where tenant_id = $1 and id = $2 for update",
            [tenantId, id],
          )
        ).rows[0];
        if (!cur) throw new NotFoundError("feedback item");
        if (cur.status === status) {
          await this.o.audit.record(tx, {
            action: "feedback.status.unchanged",
            resourceType: "feedback_item",
            resourceId: id,
            after: { status },
          });
          return false;
        }
        const closing = CLOSED.includes(status);
        await tx.query(
          `update feedback.item set status = $2, status_changed_at = $3,
             closed_at = case when $4 then coalesce(closed_at, $3) else null end,
             acknowledged_at = case when type = 'accessibility' then coalesce(acknowledged_at, $3) else acknowledged_at end
           where id = $1`,
          [id, status, o.at, closing],
        );
        await tx.query(
          `insert into feedback.status_change (id, tenant_id, item_id, status, public_note, source, changed_at)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [newId("fbs"), tenantId, id, status, o.note, o.source, o.at],
        );
        await this.o.audit.record(tx, {
          action: "feedback.status",
          resourceType: "feedback_item",
          resourceId: id,
          before: { status: cur.status },
          after: { status, source: o.source },
        });
        await this.emit(
          tx,
          FEEDBACK_EVENTS.FeedbackStatusChanged,
          FeedbackStatusChangedInternalData.parse({
            fbk_id: id,
            status,
            previous: cur.status,
            changed_at: o.at.toISOString(),
          }),
        );
        return true;
      },
      { action: "feedback.status" },
    );
    return changed;
  }

  /**
   * Triage of an accessibility item from OH (IPB-06-62): the priority and whether it blocks a
   * regulated step set the fix and interim due dates; `workaroundAt` records the interim path.
   */
  async triageAccessibility(
    tenantId: string,
    id: string,
    t: { priority?: "P1" | "P2" | "P3"; regulatedStep?: boolean; workaroundAt?: Date },
  ): Promise<void> {
    const ctx = FeedbackService.ohContext(tenantId);
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const cur = (
          await tx.query<
            ItemRow & {
              priority: string | null;
              regulated_step: boolean;
              workaround_at: Date | null;
            }
          >("select * from feedback.item where tenant_id = $1 and id = $2 for update", [
            tenantId,
            id,
          ])
        ).rows[0];
        if (!cur || cur.type !== "accessibility") throw new NotFoundError("accessibility item");
        const priority = t.priority ?? cur.priority;
        const regulated = t.regulatedStep ?? cur.regulated_step;
        const due = await this.dueDates(
          ctx,
          cur.created_at,
          priority === "P1" && regulated,
          priority,
        );
        await tx.query(
          `update feedback.item set priority = $2, regulated_step = $3, fix_due_at = $4, interim_due_at = $5,
             workaround_at = coalesce(workaround_at, $6), acknowledged_at = coalesce(acknowledged_at, $7)
           where id = $1`,
          [id, priority, regulated, due.fix, due.interim, t.workaroundAt ?? null, this.now()],
        );
        await this.o.audit.record(tx, {
          action: "feedback.a11y.triage",
          resourceType: "feedback_item",
          resourceId: id,
          after: {
            priority,
            regulated_step: regulated,
            fix_due_at: due.fix.toISOString(),
            workaround: t.workaroundAt ? "recorded" : "unchanged",
          },
        });
      },
      { action: "feedback.a11y.triage" },
    );
  }

  private async history(tx: Tx, id: string): Promise<FeedbackView["history"]> {
    const r = await tx.query<{
      status: FeedbackStatus;
      changed_at: Date;
      public_note: string | null;
    }>(
      "select status, changed_at, public_note from feedback.status_change where item_id = $1 order by changed_at, id",
      [id],
    );
    return r.rows.map((x) => ({
      status: lower(x.status),
      at: x.changed_at.toISOString(),
      note: x.public_note,
    }));
  }

  private toView(item: ItemRow, history: FeedbackView["history"]): FeedbackView {
    return {
      id: item.id,
      type: item.type,
      status: lower(item.status),
      submittedAt: item.created_at.toISOString(),
      statusChangedAt: item.status_changed_at.toISOString(),
      history,
    };
  }

  /** The signed-in person's own items (`@IPB-04-AT-92`). */
  async mine(ctx: KernelContext): Promise<FeedbackView[]> {
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<ItemRow>(
        "select * from feedback.item where tenant_id = $1 and user_id = $2 order by created_at desc limit 100",
        [tx.ctx.tenantId, ctx.principal.id],
      );
      return Promise.all(r.rows.map(async (i) => this.toView(i, await this.history(tx, i.id))));
    });
  }

  /**
   * The staff queue of the context's tenant (Studio's Feedback section): newest first, with the
   * accessibility timers. Platform scope, for PLT_SUPER_ADMIN or PLT_ACCESSIBILITY_LEAD; triage
   * and status changes happen in OH (`onStatusChanged`), not here.
   */
  async queue(
    ctx: KernelContext,
    f: { type?: FeedbackType; open?: boolean } = {},
  ): Promise<FeedbackQueueItem[]> {
    if (ctx.scope !== "platform" || !ctx.principal.roles.some((r) => QUEUE_ROLES.includes(r)))
      throw new IpbError("IPB-UX-011", {
        detail: `the feedback queue needs ${QUEUE_ROLES.join(" or ")} in the platform context`,
      });
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<
        ItemRow & {
          priority: string | null;
          regulated_step: boolean;
          ack_due_at: Date | null;
          fix_due_at: Date | null;
          sla_breaches: string[];
        }
      >(
        `select * from feedback.item where tenant_id = $1
            and ($2::text is null or type = $2) and (not $3 or closed_at is null)
          order by created_at desc, id desc limit 500`,
        [tx.ctx.tenantId, f.type ?? null, f.open === true],
      );
      return r.rows.map((x) => ({
        id: x.id,
        type: x.type,
        category: x.category,
        summary: x.summary,
        route: x.route_pattern,
        severity: x.severity,
        status: lower(x.status),
        ohRef: x.oh_ref,
        priority: x.priority,
        regulatedStep: x.regulated_step,
        ackDueAt: x.ack_due_at,
        fixDueAt: x.fix_due_at,
        slaBreaches: x.sla_breaches,
        submittedAt: x.created_at,
      }));
    });
  }

  /** The status through the emailed or shown link: the id and the view key, nothing else. */
  async viewByLink(tenantId: string, id: string, key: string): Promise<FeedbackView> {
    const ctx: KernelContext = {
      tenantId,
      principal: { id: FEEDBACK_PRINCIPAL_ID, type: "service", roles: [] },
    };
    return this.o.kernel.read(ctx, async (tx) => {
      // The key is 192 random bits; only its hash is stored and compared.
      const r = await tx.query<ItemRow>(
        "select * from feedback.item where tenant_id = $1 and id = $2 and view_key_sha256 = $3",
        [tenantId, id, sha256Hex(key)],
      );
      const item = r.rows[0];
      if (!item) throw new NotFoundError("feedback item");
      return this.toView(item, await this.history(tx, id));
    });
  }
}
