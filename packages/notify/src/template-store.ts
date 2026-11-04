// Tenant notification templates (LawDocsComply PR-LDC-27; R1-plan M58; R1-D-90), behind wave 2's
// `TemplateResolver` (R1-D-69). Per (class, channel, locale) a tenant keeps versioned overrides in
// `notify.tenant_template` (forced RLS): an EMAIL override is a subject, a required plain-text part
// and an optional HTML part, linted against the class's variable whitelist and an HTML allow-list;
// an SMS or WhatsApp override only SELECTS a template already registered for that channel (a DLT
// template with its sender and entity ids; an approved WhatsApp template name and language), never
// free text, because DLT and WhatsApp approve message text in advance. Every change is a
// maker-checker request `notify.template.change` (R3: locked maker-checker, tenant checkers only);
// its executor activates the version and ledgers it in the approving transaction.
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  ApprovalGateway,
  AuditSink,
  KernelContext,
  MutationKernel,
  Tx,
} from "@infrabyx/contracts/kernel";
import type {
  EmailTemplateContent,
  NotificationClass,
  ResolvedTemplate,
  TemplateResolver,
} from "@infrabyx/contracts/ports";
import { canonicalDigest, newId } from "@infrabyx/crypto";
import { ConflictError, NotFoundError } from "@infrabyx/tenancy";
import type { Catalogue } from "./catalogue.js";
import {
  TemplateLintError,
  lintEmailTemplate,
  templateVariables,
  type TemplateFinding,
  type TemplateLintOptions,
} from "./template-lint.js";

export const TEMPLATE_CHANGE_ACTION = "notify.template.change";
/**
 * R3: maker-checker is locked (a tenant cannot switch it off, unlike R2) because a template is
 * text sent to customers under the tenant's name: a link or wording changed by one person is a
 * phishing and regulatory risk. No delay: a fix to a wrong template should not wait an hour.
 */
export const TEMPLATE_CHANGE_RISK = "R3" as const;
/** Tenant roles that may raise a change (the maker); a platform context never may. */
export const TEMPLATE_MAKER_ROLES: readonly string[] = ["ORG_OWNER", "ORG_ADMIN", "ORG_MAKER"];
/** Tenant roles that may approve it; nobody checks from a platform context. */
export const TEMPLATE_CHECKER_ROLES: readonly string[] = ["ORG_CHECKER", "ORG_ADMIN", "ORG_OWNER"];

export type TemplateChannel = "email" | "sms" | "whatsapp";

/** A DLT template registered for the tenant's sender (TRAI TCCCPR), with its ids. */
export interface RegisteredSmsTemplate {
  dltTemplateId: string;
  senderId: string;
  dltEntityId: string;
  /** The notification variables in the template's positional order (PR-UDF-025). */
  vars?: readonly string[];
  /** The classes it was registered for; omitted: any class. */
  classes?: readonly string[];
}

/** A WhatsApp template approved by Meta for the tenant's number. */
export interface RegisteredWhatsappTemplate {
  name: string;
  lang: string;
  category: "utility" | "authentication" | "marketing";
  vars?: readonly string[];
  classes?: readonly string[];
}

/**
 * Where the product keeps the SMS and WhatsApp templates registered for each tenant. Consulted
 * when a change is raised, when it is approved and at every delivery: a template that is no
 * longer registered fails the delivery closed rather than going out unregistered.
 */
export interface TemplateRegistry {
  sms(ctx: KernelContext, dltTemplateId: string): Promise<RegisteredSmsTemplate | undefined>;
  whatsapp(
    ctx: KernelContext,
    name: string,
    lang: string,
  ): Promise<RegisteredWhatsappTemplate | undefined>;
}

/** A registry from fixed lists (the same for every tenant): tests and single-tenant products. */
export function staticTemplateRegistry(r: {
  sms?: readonly RegisteredSmsTemplate[];
  whatsapp?: readonly RegisteredWhatsappTemplate[];
}): TemplateRegistry {
  return {
    sms: async (_ctx, id) => r.sms?.find((t) => t.dltTemplateId === id),
    whatsapp: async (_ctx, name, lang) =>
      r.whatsapp?.find((t) => t.name === name && t.lang === lang),
  };
}

/** One requested change. `revert` returns the key to the catalogue template. */
export type TemplateChange =
  | ({ class: string; channel: "email"; locale: string } & EmailTemplateContent)
  | { class: string; channel: "sms"; locale: string; dltTemplateId: string }
  | { class: string; channel: "whatsapp"; locale: string; name: string; lang: string }
  | { class: string; channel: TemplateChannel; locale: string; revert: true };

export interface TenantTemplate {
  id: string;
  classId: string;
  channel: TemplateChannel;
  locale: string;
  version: number;
  state: "proposed" | "active" | "superseded";
  kind: "override" | "revert";
  /** The active version this one was proposed against (`null`: none was active). */
  baseVersion: number | null;
  email?: EmailTemplateContent;
  sms?: { dltTemplateId: string; senderId: string; dltEntityId: string; vars?: readonly string[] };
  whatsapp?: { name: string; lang: string; vars?: readonly string[] };
  contentDigest: string;
  approvalId: string | null;
  proposedBy: string;
  proposedAt: Date;
  activatedBy: string | null;
  activatedAt: Date | null;
  supersededAt: Date | null;
}

interface Row {
  id: string;
  tenant_id: string;
  class_id: string;
  channel: TemplateChannel;
  locale: string;
  version: number;
  state: TenantTemplate["state"];
  kind: TenantTemplate["kind"];
  base_version: number | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  dlt_template_id: string | null;
  sender_id: string | null;
  dlt_entity_id: string | null;
  wa_name: string | null;
  wa_lang: string | null;
  vars: string[] | null;
  content_digest: string;
  approval_id: string | null;
  proposed_by: string;
  proposed_at: Date;
  activated_by: string | null;
  activated_at: Date | null;
  superseded_at: Date | null;
}

const toTemplate = (r: Row): TenantTemplate => ({
  id: r.id,
  classId: r.class_id,
  channel: r.channel,
  locale: r.locale,
  version: r.version,
  state: r.state,
  kind: r.kind,
  baseVersion: r.base_version,
  ...(r.kind === "override" && r.channel === "email"
    ? {
        email: {
          subject: r.subject as string,
          text: r.body_text as string,
          ...(r.body_html ? { html: r.body_html } : {}),
        },
      }
    : {}),
  ...(r.kind === "override" && r.channel === "sms"
    ? {
        sms: {
          dltTemplateId: r.dlt_template_id as string,
          senderId: r.sender_id as string,
          dltEntityId: r.dlt_entity_id as string,
          ...(r.vars ? { vars: r.vars } : {}),
        },
      }
    : {}),
  ...(r.kind === "override" && r.channel === "whatsapp"
    ? {
        whatsapp: {
          name: r.wa_name as string,
          lang: r.wa_lang as string,
          ...(r.vars ? { vars: r.vars } : {}),
        },
      }
    : {}),
  contentDigest: r.content_digest,
  approvalId: r.approval_id,
  proposedBy: r.proposed_by,
  proposedAt: r.proposed_at,
  activatedBy: r.activated_by,
  activatedAt: r.activated_at,
  supersededAt: r.superseded_at,
});

/** The fields a version stores, and what its digest covers. */
interface Fields {
  kind: "override" | "revert";
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  dlt_template_id: string | null;
  sender_id: string | null;
  dlt_entity_id: string | null;
  wa_name: string | null;
  wa_lang: string | null;
  vars: readonly string[] | null;
}
const digestOf = (classId: string, channel: string, locale: string, f: Fields): string =>
  canonicalDigest({ classId, channel, locale, ...f, vars: f.vars ? [...f.vars] : null });
const fieldsOf = (r: Row): Fields => ({
  kind: r.kind,
  subject: r.subject,
  body_text: r.body_text,
  body_html: r.body_html,
  dlt_template_id: r.dlt_template_id,
  sender_id: r.sender_id,
  dlt_entity_id: r.dlt_entity_id,
  wa_name: r.wa_name,
  wa_lang: r.wa_lang,
  vars: r.vars,
});

const LOCALE = /^[a-z]{2,3}(-[A-Z]{2})?$/;

/** The locales tried for a delivery: its own, its language, then the class's first locale. */
export function templateLocales(
  cls: NotificationClass,
  channel: TemplateChannel,
  locale: string | null,
): string[] {
  const first =
    channel === "email"
      ? cls.templates.email?.locales[0]
      : channel === "whatsapp"
        ? cls.templates.whatsapp?.lang[0]?.split(/[-_]/)[0]
        : undefined;
  const out: string[] = [];
  for (const l of [locale, locale?.split("-")[0], first ?? "en"])
    if (l && LOCALE.test(l) && !out.includes(l)) out.push(l);
  return out;
}

export interface TenantTemplateStoreOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  catalogue: Catalogue;
  /** Registered SMS and WhatsApp templates; without it SMS and WhatsApp overrides are refused. */
  registry?: TemplateRegistry;
  /** HTML lint options (for example the link hosts a tenant may use). */
  lint?: TemplateLintOptions;
  /**
   * The product's own resolver (R1-D-69), consulted when the tenant has no active version, before
   * the catalogue; omitted: the catalogue.
   */
  fallback?: TemplateResolver;
}

/** Engine slice used to register the executor (the tenancy `ApprovalsEngine`). */
export interface TemplateApprovalEngine {
  register(
    action: string,
    p: {
      checkerRoles?: readonly string[];
      platformCheckerRoles?: readonly string[];
      execute: (tx: Tx, payload: Record<string, unknown>, request: { id: string }) => Promise<void>;
    },
  ): unknown;
}

export class TenantTemplateStore {
  /** Pass `store.resolver.resolve` to `NotifyService` as `templates`. */
  readonly resolver: TenantTemplateResolver;

  constructor(private readonly o: TenantTemplateStoreOptions) {
    this.resolver = new TenantTemplateResolver(o);
  }

  /**
   * Raise a change for the checker: validated first (lint, whitelist, registered templates only),
   * stored as a `proposed` version and sent for approval in the same transaction. Nothing changes
   * for delivery until a tenant checker approves it.
   */
  async requestChange(
    ctx: KernelContext,
    approvals: ApprovalGateway,
    change: TemplateChange,
  ): Promise<{ approvalId: string; templateId: string; version: number }> {
    assertMaker(ctx);
    const cls = this.o.catalogue.get(change.class);
    if (!LOCALE.test(change.locale))
      throw new TemplateLintError([
        {
          field: "subject",
          message: `locale ${change.locale} is not a language tag such as en or hi-IN`,
        },
      ]);
    const fields = await this.validate(ctx, cls, change);
    const digest = digestOf(cls.id, change.channel, change.locale, fields);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const key = [ctx.tenantId, cls.id, change.channel, change.locale];
        const latest = await tx.query<{ version: number; state: string }>(
          `select version, state from notify.tenant_template
            where tenant_id = $1 and class_id = $2 and channel = $3 and locale = $4
            order by version desc`,
          key,
        );
        const active = latest.rows.find((r) => r.state === "active");
        const version = (latest.rows[0]?.version ?? 0) + 1;
        const id = newId("ntt");
        await tx.query(
          `insert into notify.tenant_template
             (id, tenant_id, class_id, channel, locale, version, state, kind, base_version, subject, body_text,
              body_html, dlt_template_id, sender_id, dlt_entity_id, wa_name, wa_lang, vars, content_digest, proposed_by)
           values ($1, $2, $3, $4, $5, $6, 'proposed', $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19)`,
          [
            id,
            ...key,
            version,
            fields.kind,
            active?.version ?? null,
            fields.subject,
            fields.body_text,
            fields.body_html,
            fields.dlt_template_id,
            fields.sender_id,
            fields.dlt_entity_id,
            fields.wa_name,
            fields.wa_lang,
            fields.vars ? JSON.stringify(fields.vars) : null,
            digest,
            ctx.principal.id,
          ],
        );
        const before = active
          ? await tx.query<Row>(
              `select * from notify.tenant_template where tenant_id = $1 and class_id = $2
                and channel = $3 and locale = $4 and state = 'active'`,
              key,
            )
          : undefined;
        const { id: approvalId } = await approvals.request(tx, {
          action: TEMPLATE_CHANGE_ACTION,
          riskClass: TEMPLATE_CHANGE_RISK,
          payload: { templateId: id, contentDigest: digest },
          summary:
            fields.kind === "revert"
              ? `Return ${cls.id} ${change.channel} (${change.locale}) to the catalogue template`
              : `Change the ${cls.id} ${change.channel} template (${change.locale}) to version ${version}`,
          diff: {
            before: before?.rows[0] ? checkerView(fieldsOf(before.rows[0])) : null,
            after: checkerView(fields),
          },
        });
        await tx.query("update notify.tenant_template set approval_id = $2 where id = $1", [
          id,
          approvalId,
        ]);
        await this.o.audit.record(tx, {
          action: "notify.template.propose",
          resourceType: "notification_template",
          resourceId: id,
          after: {
            class: cls.id,
            channel: change.channel,
            locale: change.locale,
            version,
            kind: fields.kind,
            content_digest: digest,
            approval_id: approvalId,
          },
        });
        return { approvalId, templateId: id, version };
      },
      { action: "notify.template.propose" },
    );
  }

  /** The executor for `notify.template.change`; tenant checkers only. Register it once. */
  registerApprovals(engine: TemplateApprovalEngine): void {
    engine.register(TEMPLATE_CHANGE_ACTION, {
      checkerRoles: TEMPLATE_CHECKER_ROLES,
      platformCheckerRoles: [],
      execute: (tx, payload, request) => this.activate(tx, payload, request.id),
    });
  }

  /**
   * Activate an approved version in the approving transaction: the content must still be what the
   * maker raised (digest) and still pass validation, and the active version must still be the one
   * it was proposed against; the previous active version is superseded, and both are ledgered.
   */
  private async activate(
    tx: Tx,
    payload: Record<string, unknown>,
    approvalId: string,
  ): Promise<void> {
    const r = (
      await tx.query<Row>(
        `select * from notify.tenant_template where id = $1 and approval_id = $2 and state = 'proposed'
          for update`,
        [String(payload.templateId), approvalId],
      )
    ).rows[0];
    if (!r) throw new NotFoundError("proposed notification template");
    const f = fieldsOf(r);
    if (
      r.content_digest !== payload.contentDigest ||
      digestOf(r.class_id, r.channel, r.locale, f) !== r.content_digest
    )
      throw new ConflictError("the template changed after it was raised; raise it again");
    const active = (
      await tx.query<Row>(
        `select * from notify.tenant_template where tenant_id = $1 and class_id = $2 and channel = $3
            and locale = $4 and state = 'active' for update`,
        [r.tenant_id, r.class_id, r.channel, r.locale],
      )
    ).rows[0];
    if ((active?.version ?? null) !== r.base_version)
      throw new ConflictError(
        "another version of this template was activated after this one was raised; raise it again",
      );
    // The catalogue or the registry may have changed since the request.
    const cls = this.o.catalogue.get(r.class_id);
    await this.validate(tx.ctx, cls, changeOf(r));
    if (active)
      await tx.query(
        "update notify.tenant_template set state = 'superseded', superseded_at = now() where id = $1",
        [active.id],
      );
    await tx.query(
      `update notify.tenant_template set state = 'active', activated_by = $2, activated_at = now()
        where id = $1`,
      [r.id, tx.ctx.principal.id],
    );
    await this.o.audit.record(tx, {
      action: "notify.template.activate",
      resourceType: "notification_template",
      resourceId: r.id,
      before: active ? { version: active.version, template_id: active.id } : { version: null },
      after: {
        class: r.class_id,
        channel: r.channel,
        locale: r.locale,
        version: r.version,
        kind: r.kind,
        content_digest: r.content_digest,
        approval_id: approvalId,
      },
    });
  }

  /** One version, proposed or not (the checker reads what they approve here). */
  async get(ctx: KernelContext, templateId: string): Promise<TenantTemplate> {
    const r = await this.o.kernel.read(
      ctx,
      async (tx) =>
        (
          await tx.query<Row>(
            "select * from notify.tenant_template where id = $1 and tenant_id = $2",
            [templateId, ctx.tenantId],
          )
        ).rows[0],
    );
    if (!r) throw new NotFoundError("notification template");
    return toTemplate(r);
  }

  /** Every version of one key, newest first (the history). */
  async history(
    ctx: KernelContext,
    classId: string,
    channel: TemplateChannel,
    locale: string,
  ): Promise<TenantTemplate[]> {
    return this.o.kernel.read(ctx, async (tx) =>
      (
        await tx.query<Row>(
          `select * from notify.tenant_template where tenant_id = $4 and class_id = $1
              and channel = $2 and locale = $3
            order by version desc`,
          [classId, channel, locale, ctx.tenantId],
        )
      ).rows.map(toTemplate),
    );
  }

  /** The template a version would deliver, for `NotifyService.previewTemplate` before approval. */
  async resolvedOf(ctx: KernelContext, templateId: string): Promise<ResolvedTemplate | undefined> {
    const t = await this.get(ctx, templateId);
    return resolvedFrom(this.o.catalogue.get(t.classId), t);
  }

  private async validate(
    ctx: KernelContext,
    cls: NotificationClass,
    change: TemplateChange,
  ): Promise<Fields> {
    const none: Fields = {
      kind: "override",
      subject: null,
      body_text: null,
      body_html: null,
      dlt_template_id: null,
      sender_id: null,
      dlt_entity_id: null,
      wa_name: null,
      wa_lang: null,
      vars: null,
    };
    const refuse = (message: string, field: TemplateFinding["field"] = "text"): never => {
      throw new TemplateLintError([{ field, message }]);
    };
    if (cls.never_channels.includes(change.channel))
      refuse(`${cls.id} is never sent by ${change.channel}`);
    if ("revert" in change && change.revert) return { ...none, kind: "revert" };
    const allowed = templateVariables(cls);
    const within = (vars: readonly string[] | undefined) => {
      const missing = (vars ?? []).filter((v) => !allowed.includes(v));
      if (missing.length)
        refuse(
          `the registered template takes ${missing.join(", ")}, which ${cls.id} does not offer`,
        );
    };
    const inClass = (classes: readonly string[] | undefined) => {
      if (classes && !classes.includes(cls.id))
        refuse(`the registered template is not registered for ${cls.id}`);
    };
    switch (change.channel) {
      case "email": {
        const c = change as Extract<TemplateChange, { channel: "email"; subject: string }>;
        // Security messages (sign-in codes and alerts) keep the platform's wording.
        if (cls.category === "security")
          refuse("security classes keep the catalogue email template", "subject");
        const findings = lintEmailTemplate(
          { subject: c.subject, text: c.text, ...(c.html !== undefined ? { html: c.html } : {}) },
          allowed,
          this.o.lint,
        );
        if (findings.length) throw new TemplateLintError(findings);
        return { ...none, subject: c.subject, body_text: c.text, body_html: c.html ?? null };
      }
      case "sms": {
        const c = change as Extract<TemplateChange, { channel: "sms"; dltTemplateId: string }>;
        if (typeof c.dltTemplateId !== "string" || Object.keys(c).some((k) => !SMS_KEYS.has(k)))
          refuse("an SMS override only selects a registered DLT template by its id");
        const t = await this.o.registry?.sms(ctx, c.dltTemplateId);
        if (!t) return refuse(`DLT template ${c.dltTemplateId} is not registered for this tenant`);
        if (
          !/^[0-9]{10,30}$/.test(t.dltTemplateId) ||
          !/^[A-Z]{6}$/.test(t.senderId) ||
          !/^[0-9]{19}$/.test(t.dltEntityId)
        )
          refuse("the registered DLT template has a malformed template, sender or entity id");
        inClass(t.classes);
        within(t.vars);
        return {
          ...none,
          dlt_template_id: t.dltTemplateId,
          sender_id: t.senderId,
          dlt_entity_id: t.dltEntityId,
          vars: t.vars ?? null,
        };
      }
      case "whatsapp": {
        const c = change as Extract<TemplateChange, { channel: "whatsapp"; name: string }>;
        if (
          typeof c.name !== "string" ||
          typeof c.lang !== "string" ||
          Object.keys(c).some((k) => !WA_KEYS.has(k))
        )
          refuse("a WhatsApp override only selects an approved template by name and language");
        const t = await this.o.registry?.whatsapp(ctx, c.name, c.lang);
        if (!t)
          return refuse(`WhatsApp template ${c.name} (${c.lang}) is not approved for this tenant`);
        if (!/^[a-z0-9_]{1,512}$/.test(t.name) || !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(t.lang))
          refuse("the approved WhatsApp template has a malformed name or language");
        inClass(t.classes);
        within(t.vars);
        if ((t.category === "marketing") !== (cls.category === "marketing"))
          refuse("a WhatsApp marketing template serves marketing classes only, and only them");
        if (t.category === "authentication" && cls.category !== "security")
          refuse("a WhatsApp authentication template serves security classes only");
        return { ...none, wa_name: t.name, wa_lang: t.lang, vars: t.vars ?? null };
      }
    }
    return refuse(
      `channel ${String((change as { channel: unknown }).channel)} has no tenant templates`,
    );
  }
}

const SMS_KEYS = new Set(["class", "channel", "locale", "dltTemplateId"]);
const WA_KEYS = new Set(["class", "channel", "locale", "name", "lang"]);

function assertMaker(ctx: KernelContext): void {
  if (
    ctx.scope === "platform" ||
    !ctx.principal.roles.some((r) => TEMPLATE_MAKER_ROLES.includes(r))
  )
    throw new IpbError("IPB-UX-011", {
      detail: "a tenant's own owner, admin or maker raises a template change",
      meta: { action: TEMPLATE_CHANGE_ACTION },
    });
}

/** What the checker's diff shows: the email text in full, the selected template's ids. */
function checkerView(f: Fields): Record<string, unknown> {
  if (f.kind === "revert") return { kind: "revert" };
  return Object.fromEntries(
    Object.entries({
      subject: f.subject,
      text: f.body_text,
      html: f.body_html,
      dlt_template_id: f.dlt_template_id,
      sender_id: f.sender_id,
      dlt_entity_id: f.dlt_entity_id,
      whatsapp_template: f.wa_name,
      whatsapp_lang: f.wa_lang,
    }).filter(([, v]) => v !== null),
  );
}

function changeOf(r: Row): TemplateChange {
  const base = { class: r.class_id, locale: r.locale };
  if (r.kind === "revert") return { ...base, channel: r.channel, revert: true };
  if (r.channel === "email")
    return {
      ...base,
      channel: "email",
      subject: r.subject as string,
      text: r.body_text as string,
      ...(r.body_html ? { html: r.body_html } : {}),
    };
  if (r.channel === "sms")
    return { ...base, channel: "sms", dltTemplateId: r.dlt_template_id as string };
  return { ...base, channel: "whatsapp", name: r.wa_name as string, lang: r.wa_lang as string };
}

function resolvedFrom(cls: NotificationClass, t: TenantTemplate): ResolvedTemplate | undefined {
  if (t.kind === "revert") return undefined;
  if (t.email)
    return { channel: "email", key: cls.templates.email?.key ?? cls.id, content: t.email };
  if (t.sms) return { channel: "sms", ...t.sms };
  if (t.whatsapp) return { channel: "whatsapp", ...t.whatsapp };
  return undefined;
}

/**
 * `TemplateResolver` over the tenant store (R1-D-69 contract): the tenant's active version for the
 * class, channel and locale (its own locale, then its language, then the class's first locale); a
 * `revert` or no version defers to `fallback`, else `undefined` (the catalogue). It never returns
 * `null` for a missing template; it returns `null` (the delivery fails closed, nothing sent) only
 * when an active SMS or WhatsApp selection is no longer registered for the tenant.
 */
export class TenantTemplateResolver {
  constructor(
    private readonly o: Pick<TenantTemplateStoreOptions, "kernel" | "registry" | "fallback">,
  ) {}

  readonly resolve: TemplateResolver = async (ctx, cls, channel, locale) => {
    const locales = templateLocales(cls, channel, locale);
    const rows = await this.o.kernel.read(
      ctx,
      async (tx) =>
        (
          await tx.query<Row>(
            `select * from notify.tenant_template where tenant_id = $4 and class_id = $1
              and channel = $2 and locale = any($3::text[]) and state = 'active'`,
            [cls.id, channel, locales, ctx.tenantId],
          )
        ).rows,
    );
    const row = locales.map((l) => rows.find((r) => r.locale === l)).find((r) => r !== undefined);
    const t = row ? resolvedFrom(cls, toTemplate(row)) : undefined;
    if (!t) return this.o.fallback ? this.o.fallback(ctx, cls, channel, locale) : undefined;
    if (t.channel === "sms") {
      const reg = await this.o.registry?.sms(ctx, t.dltTemplateId);
      if (!reg || reg.senderId !== t.senderId || reg.dltEntityId !== t.dltEntityId) return null;
    }
    if (t.channel === "whatsapp" && !(await this.o.registry?.whatsapp(ctx, t.name, t.lang)))
      return null;
    return t;
  };
}
