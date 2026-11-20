// NOTIFY port (IPB-01 NOTIFY, IPB-07-25; PL3 plan §6). One call fans out to in-app, email, SMS,
// WhatsApp and push. Callers pass principal references, never raw addresses; NOTIFY resolves
// addresses through a product-supplied resolver. The method list is derived from IPB-07-25 and the
// IPB-04/05 uses, because IPB-01 gives none (assumption A-06).
import { z } from "zod";
import type { KernelContext } from "../kernel.js";
import { AGENT_ROLE_REGEX, RoleSchema, SERVICE_ROLE_REGEX, isPlatformRole } from "../roles.js";
import type { Port, PortCall } from "./common.js";

export const NOTIFY_CHANNELS = ["inapp", "email", "sms", "whatsapp", "push"] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];
export const NotifyChannelSchema = z.enum(NOTIFY_CHANNELS);

export const NOTIFICATION_CATEGORIES = [
  "transactional",
  "security",
  "regulatory",
  "maker_checker",
  "marketing",
] as const;

/** Resend classes (owner, PL2-D-65): `safe` is resent once after an unknown outcome; `hold` never. */
export const RESEND_CLASSES = ["safe", "hold"] as const;
export type ResendClass = (typeof RESEND_CLASSES)[number];

/** Ecosystem §5 code table `marketing_purpose` (v1.2). */
export const MARKETING_PURPOSES = [
  "MARKETING_EMAIL",
  "MARKETING_SMS",
  "MARKETING_WHATSAPP",
  "ANALYTICS",
  "PERSONALISATION",
] as const;

/** Channel a marketing class may use, by purpose; push and in-app have no marketing purpose code. */
export const MARKETING_PURPOSE_CHANNEL: Readonly<Record<string, NotifyChannel>> = Object.freeze({
  MARKETING_EMAIL: "email",
  MARKETING_SMS: "sms",
  MARKETING_WHATSAPP: "whatsapp",
});

const ClassId = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/);
const VarName = z.string().regex(/^[a-z][a-zA-Z0-9_]*$/);

/**
 * The channels a staff class may use (Udofin PR-UDF-052; R1-D-222): staff are reached in the
 * product and by email, never by SMS, WhatsApp or push.
 */
export const STAFF_CHANNELS = ["inapp", "email"] as const satisfies readonly NotifyChannel[];

/** One class in a notification catalogue file (`notify/catalogue/*.yaml`). */
export const NotificationClass = z
  .object({
    id: ClassId,
    category: z.enum(NOTIFICATION_CATEGORIES),
    /** Cannot be disabled (IPB-NTF-001); may be routed. */
    mandatory: z.boolean().default(false),
    urgent: z.boolean().default(false),
    /** Effective only when `ntf.org.allow_quiet_hours_bypass` is also true. */
    bypass_quiet_hours: z.boolean().default(false),
    /** Required by the catalogue lint; data written outside a catalogue defaults to `hold`. */
    resend: z.enum(RESEND_CLASSES),
    default_channels: z.array(NotifyChannelSchema).min(1),
    never_channels: z.array(NotifyChannelSchema).default([]),
    help_key: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/),
    /** Deep-link pattern; every notification carries one (IPB-07-25). */
    deep_link: z.string().regex(/^\/[A-Za-z0-9/_:{}.-]*$/),
    marketing_purpose: z.enum(MARKETING_PURPOSES).optional(),
    /**
     * The variables a tenant's own email template may use (LawDocsComply PR-LDC-27; R1-D-90).
     * Omitted: the SMS and WhatsApp templates' `vars`; a class with neither offers none.
     */
    variables: z.array(VarName).max(50).optional(),
    /**
     * `staff`: the class goes only to staff by role through `notifyStaff` (PR-UDF-052; R1-D-222),
     * by in-app and email, with declared `variables`. Omitted: any recipient through `send`.
     */
    audience: z.literal("staff").optional(),
    /**
     * A staff class's variables its subject and titles may carry (a subset of `variables`, default
     * none); their values must be references or codes, never personal data (R1-D-222).
     */
    subject_variables: z.array(VarName).max(10).optional(),
    templates: z
      .object({
        email: z
          .object({ key: z.string(), locales: z.array(z.string()).min(1) })
          .strict()
          .optional(),
        sms: z
          .object({
            dlt_template_id: z.string(),
            header: z.string(),
            /**
             * The notification's variables in the DLT template's positional order (PR-UDF-025).
             * Without it the values go in the natural order of their names (`v1`, `v2`, … `v10`).
             */
            vars: z
              .array(z.string().regex(/^[a-z][a-zA-Z0-9_]*$/))
              .max(10)
              .optional(),
          })
          .strict()
          .optional(),
        whatsapp: z
          .object({
            name: z.string(),
            category: z.enum(["utility", "authentication", "marketing"]),
            lang: z.array(z.string()).min(1),
            /** Body parameters in the approved template's order (PR-UDF-025). */
            vars: z.array(z.string().regex(/^[a-z][a-zA-Z0-9_]*$/)).optional(),
          })
          .strict()
          .optional(),
        push: z.object({ title_key: z.string() }).strict().optional(),
        inapp: z.object({ title_key: z.string() }).strict().optional(),
      })
      .strict()
      .default({}),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.category === "marketing" && c.mandatory)
      ctx.addIssue({
        code: "custom",
        path: ["mandatory"],
        message: "a marketing class is never mandatory",
      });
    if (c.category === "marketing" && !c.marketing_purpose)
      ctx.addIssue({
        code: "custom",
        path: ["marketing_purpose"],
        message: "a marketing class needs a consent purpose",
      });
    if (c.category === "marketing" && c.marketing_purpose) {
      const allowed = MARKETING_PURPOSE_CHANNEL[c.marketing_purpose];
      for (const ch of c.default_channels)
        if (ch !== allowed)
          ctx.addIssue({
            code: "custom",
            path: ["default_channels"],
            message: `marketing purpose ${c.marketing_purpose} allows only ${allowed ?? "no channel"}`,
          });
    }
    for (const ch of c.default_channels)
      if (c.never_channels.includes(ch))
        ctx.addIssue({
          code: "custom",
          path: ["default_channels"],
          message: `${ch} is also in never_channels`,
        });
    if (c.audience === "staff") {
      if (c.category === "marketing")
        ctx.addIssue({
          code: "custom",
          path: ["audience"],
          message: "a staff class is never a marketing class",
        });
      for (const ch of c.default_channels)
        if (!(STAFF_CHANNELS as readonly string[]).includes(ch))
          ctx.addIssue({
            code: "custom",
            path: ["default_channels"],
            message: `a staff class uses only ${STAFF_CHANNELS.join(" and ")}, not ${ch}`,
          });
      if (!c.variables)
        ctx.addIssue({
          code: "custom",
          path: ["variables"],
          message: "a staff class declares its variables",
        });
      for (const v of c.subject_variables ?? [])
        if (!c.variables?.includes(v))
          ctx.addIssue({
            code: "custom",
            path: ["subject_variables"],
            message: `subject variable ${v} is not in variables`,
          });
    } else if (c.subject_variables)
      ctx.addIssue({
        code: "custom",
        path: ["subject_variables"],
        message: "subject_variables belongs to a staff class (audience: staff)",
      });
  });
export type NotificationClass = z.infer<typeof NotificationClass>;

export const NotificationCatalogue = z
  .object({
    catalogue: z.string().regex(/^[a-z][a-z0-9_-]*$/),
    version: z.number().int().positive(),
    classes: z.array(NotificationClass).min(1),
  })
  .strict();
export type NotificationCatalogue = z.infer<typeof NotificationCatalogue>;

/** The product's reference of the thread a reply belongs to (a matter, a task, a ticket). */
export const ReplyThreadRef = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[\x21-\x7e]+$/, "printable ASCII without spaces");

/** A principal reference: `usr_…` or a product `party_ref`; never an address. */
export const Recipient = z.object({ ref: z.string().min(3).max(120) }).strict();
export type Recipient = z.infer<typeof Recipient>;

export const NotificationRequest = z
  .object({
    class: ClassId,
    to: z.array(Recipient).min(1).max(1000),
    /** INTERNAL template variables only; content above INTERNAL is fetched in-app by deep link. */
    vars: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean()])),
    deepLink: z.string().regex(/^\/[A-Za-z0-9/_:.?=&%-]*$/),
    locale: z.string().optional(),
    idempotencyKey: z.string().min(8).max(200),
    /**
     * Invite a reply by email (PR-LDC-50; R1-D-177): each email delivery carries a reply address
     * bound to this thread and that recipient. Ignored unless the tenant's `ntf.reply.enabled` is on
     * and `ntf.reply.domain` is set; never set on a digest.
     */
    reply: z.object({ threadRef: ReplyThreadRef }).strict().optional(),
  })
  .strict();
export type NotificationRequest = z.infer<typeof NotificationRequest>;

/**
 * A role a staff notification targets (PR-UDF-052; R1-D-222): a tenant role (`ORG_*`), a
 * group-operations role (`OPS_*`), a product role or a tenant function (`FN:<CODE>`). Platform,
 * service and agent roles are refused: platform staff are not tenant members, and services and
 * agents are never notified.
 */
export const StaffRole = z
  .string()
  .max(64)
  .refine((r) => RoleSchema.safeParse(r).success, { message: "unknown role format" })
  .refine(
    (r) =>
      !isPlatformRole(r) &&
      !r.startsWith("PLT_") &&
      !SERVICE_ROLE_REGEX.test(r) &&
      !AGENT_ROLE_REGEX.test(r),
    { message: "platform, service and agent roles are never notified as staff" },
  );

/**
 * Notify everyone holding one of `roles` in the context's tenant (PR-UDF-052; R1-D-222). The
 * holders are found by NOTIFY at send time; the tenant is the verified context's only.
 */
export const StaffNotificationRequest = z
  .object({
    class: ClassId,
    roles: z.array(StaffRole).min(1).max(10),
    /** INTERNAL references and codes only; checked for personal data (R1-D-222). */
    vars: z.record(VarName, z.union([z.string().max(500), z.number(), z.boolean()])),
    deepLink: z.string().regex(/^\/[A-Za-z0-9/_:.?=&%-]*$/),
    locale: z.string().optional(),
    idempotencyKey: z.string().min(8).max(200),
    /** Principals never notified by this call (for example the person who acted). */
    exclude: z.array(Recipient).max(50).optional(),
  })
  .strict();
export type StaffNotificationRequest = z.infer<typeof StaffNotificationRequest>;

export const DELIVERY_STATES = [
  "queued",
  "sent",
  "delivered",
  "failed",
  "held",
  "suppressed",
  "killed",
  "digested",
  "expired",
  /** Recorded in a sandbox tenant and never handed to an adapter (PR-LDC-29; R1-D-87). */
  "sandboxed",
] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export interface SendResult {
  /** `ntf_…`; the same id when the idempotency key repeats inside the dedupe window. */
  notificationId: string;
  deliveries: {
    recipient: string;
    channel: NotifyChannel;
    state: DeliveryState;
    deliveryId: string;
  }[];
}

/** What `notifyStaff` did (R1-D-222). */
export interface StaffSendResult extends SendResult {
  /** `no_recipients`: nobody in the tenant holds the roles; recorded and ledgered, nothing sent. */
  outcome: "targeted" | "no_recipients";
  /** The principals the roles resolved to at send time, in order. */
  recipients: string[];
}

export interface DeliveryRecord {
  deliveryId: string;
  recipient: string;
  channel: NotifyChannel;
  state: DeliveryState;
  attempt: number;
  adapter?: string;
  lastErrorCode?: string;
  updatedAt: string;
}

/** A notification's delivery receipt, per recipient (PR-UDF-052; R1-D-222). */
export interface DeliveryReceipt {
  notificationId: string;
  classId: string;
  outcome: "targeted" | "no_recipients";
  recipients: Array<{
    recipient: string;
    /** Whether any of the recipient's deliveries was `sent` or `delivered`. */
    reached: boolean;
    deliveries: DeliveryRecord[];
  }>;
}

/** Per-class channel choices of one user (`ntf.user.channels`). */
export type ChannelMatrix = Record<string, Partial<Record<NotifyChannel, boolean>>>;

export const SUPPRESSION_REASONS = [
  "hard_bounce",
  "complaint",
  "unsubscribe",
  "stop",
  "manual",
  "invalid",
] as const;

export interface SuppressionInput {
  channel: Exclude<NotifyChannel, "inapp">;
  /** Normalised address; NOTIFY keys it with C-23 and never stores it. */
  address: string;
  reason: (typeof SUPPRESSION_REASONS)[number];
  /** `platform` for hard bounces and complaints, otherwise the tenant scope. */
  scope: "platform" | "tenant";
  classScope: "all" | "marketing";
  source: string;
}

export interface RenderedChannels {
  classId: string;
  channels: Partial<Record<NotifyChannel, { subject?: string; title?: string; body: string }>>;
}

export interface DomainCheck {
  domain: string;
  spf: boolean;
  dkim: boolean;
  dmarc: boolean;
}

/**
 * NOTIFY runs inside tenancy, so every method that touches tenant data takes the verified
 * `KernelContext` first (PL3 session 4).
 */
export interface NotifyPort extends Port {
  send(ctx: KernelContext, n: NotificationRequest, call?: PortCall): Promise<SendResult>;
  /** "Test notification": renders without sending. */
  preview(
    classId: string,
    locale: string,
    vars: Record<string, unknown>,
  ): Promise<RenderedChannels>;
  /** Refuses to disable every channel of a mandatory class with IPB-NTF-001. */
  setPreferences(ctx: KernelContext, userId: string, prefs: ChannelMatrix): Promise<void>;
  suppress(ctx: KernelContext, entry: SuppressionInput): Promise<void>;
  /** One-click marketing unsubscribe with a random, one-time, revocable token (PL3-D-06). */
  unsubscribe(token: string): Promise<void>;
  verifySenderDomain(brand: string, domain: string): Promise<DomainCheck>;
  deliveryStatus(ctx: KernelContext, notificationId: string): Promise<DeliveryRecord[]>;
  /** Staff by role in the context's tenant (PR-UDF-052; R1-D-222); optional for other adapters. */
  notifyStaff?(ctx: KernelContext, n: StaffNotificationRequest): Promise<StaffSendResult>;
  /** Per-recipient delivery receipt (R1-D-222); null for an unknown notification. */
  deliveryReceipt?(ctx: KernelContext, notificationId: string): Promise<DeliveryReceipt | null>;
}

// ------------------------------------------------------------------ inbound replies (PR-LDC-50)

/** Why an inbound message was dropped (design §3; plan `docs/phases/R1-inbound-mail-plan.md` §4). */
export const INBOUND_DROP_REASONS = [
  "off",
  "no_token",
  "ambiguous",
  "unknown_token",
  "expired",
  "used_up",
  "domain",
  "sender",
  "auth",
  "too_large",
  "line_length",
  "parse",
  "parts",
  "depth",
  "headers",
  "charset",
  "attachments",
  "empty",
] as const;
export type InboundDropReason = (typeof INBOUND_DROP_REASONS)[number];

/** The state of a reply's attachment: released only on a `CLEAN` scan (IPB-02-44). */
export type ReplyAttachmentState = "RELEASED" | "QUARANTINED" | "REJECTED";

export interface ReplyAttachment {
  storageKey: string;
  /** The sender's file name, cut to 200 characters; never used as a path. */
  filename: string | null;
  /** The declared media type, as sent (lower case); not trusted. */
  contentType: string;
  bytes: number;
  sha256: string;
  state: ReplyAttachmentState;
  verdict: string;
}

/** An accepted reply (`getReply`). The text has its quoted history removed. */
export interface InboundReply {
  id: string;
  threadRef: string;
  recipientRef: string;
  text: string;
  attachments: ReplyAttachment[];
  receivedAt: string;
}

export interface ReceiveRepliesResult {
  /** Ids of the replies accepted by this call. */
  accepted: string[];
  /** Redeliveries of a reply already accepted (nothing consumed). */
  duplicate: number;
  dropped: Partial<Record<InboundDropReason, number>>;
}

/** Product-supplied address lookup; addresses never travel through events or queues. */
export interface ContactResolver {
  resolve(
    recipient: Recipient,
    channel: Exclude<NotifyChannel, "inapp" | "push">,
  ): Promise<{ address: string; locale?: string; timezone?: string } | null>;
}

/**
 * A tenant's own template for one class and channel (Finbyx PR-FBX-33; R1-plan M39; R1-D-69):
 * the SMS DLT template with its sender and entity ids, the WhatsApp template's name and language,
 * or the email template key; `vars` gives the template's positional order (PR-UDF-025).
 */
export type ResolvedTemplate =
  | {
      channel: "sms";
      dltTemplateId: string;
      senderId: string;
      dltEntityId: string;
      vars?: readonly string[];
    }
  | { channel: "whatsapp"; name: string; lang: string; vars?: readonly string[] }
  | {
      channel: "email";
      key: string;
      /**
       * The tenant's own subject and parts (PR-LDC-27; R1-D-90) with `{{var}}` placeholders:
       * NOTIFY lints and renders them at delivery and sends the result in place of the vendor
       * template, `key` staying the logical template name.
       */
      content?: EmailTemplateContent;
    };

/** A tenant's email template: a subject, a required plain-text part and an optional HTML part. */
export interface EmailTemplateContent {
  subject: string;
  text: string;
  html?: string;
}

/**
 * Consulted by NOTIFY at every delivery, `dispatchDue` included, in the delivering tenant's
 * context. An object is used as is; `undefined` falls back to the static catalogue; `null` fails
 * the delivery closed (no template, nothing sent; IPB-04-28).
 */
export type TemplateResolver = (
  ctx: KernelContext,
  cls: NotificationClass,
  channel: "email" | "sms" | "whatsapp",
  locale: string | null,
) => Promise<ResolvedTemplate | null | undefined>;
