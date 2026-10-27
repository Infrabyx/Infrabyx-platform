// NOTIFY port (IPB-01 NOTIFY, IPB-07-25; PL3 plan §6). One call fans out to in-app, email, SMS,
// WhatsApp and push. Callers pass principal references, never raw addresses; NOTIFY resolves
// addresses through a product-supplied resolver. The method list is derived from IPB-07-25 and the
// IPB-04/05 uses, because IPB-01 gives none (assumption A-06).
import { z } from "zod";
import type { KernelContext } from "../kernel.js";
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
    templates: z
      .object({
        email: z
          .object({ key: z.string(), locales: z.array(z.string()).min(1) })
          .strict()
          .optional(),
        sms: z.object({ dlt_template_id: z.string(), header: z.string() }).strict().optional(),
        whatsapp: z
          .object({
            name: z.string(),
            category: z.enum(["utility", "authentication", "marketing"]),
            lang: z.array(z.string()).min(1),
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
  })
  .strict();
export type NotificationRequest = z.infer<typeof NotificationRequest>;

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
}

/** Product-supplied address lookup; addresses never travel through events or queues. */
export interface ContactResolver {
  resolve(
    recipient: Recipient,
    channel: Exclude<NotifyChannel, "inapp" | "push">,
  ): Promise<{ address: string; locale?: string; timezone?: string } | null>;
}
