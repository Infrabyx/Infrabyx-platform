// Event payloads PL3 emits or consumes (PL3 plan §10). Ecosystem payloads follow the Ecosystem
// Spec v1.2 field lists (§6.39 `MarketingConsentUpdated`, N11 `ExportRequested` and
// `ExportCompleted`); internal payloads follow the platform naming (IPB-10-37). Payloads describe
// a job or a decision, never its content, and carry no address or name in clear.
import { z } from "zod";

const ISO = z.iso.datetime({ offset: true });
const SHA256_HEX = z.string().regex(/^[0-9a-f]{64}$/);

/** `in.infrabyx.consent.MarketingConsentUpdated.v1` data (Ecosystem §6.39). */
export const MarketingConsentUpdatedData = z
  .object({
    consent_id: z.string().min(1),
    /** Ecosystem form: SHA-256 of the normalised address (PR-018 asks for the keyed form). */
    principal_hash: SHA256_HEX,
    purpose: z.enum([
      "MARKETING_EMAIL",
      "MARKETING_SMS",
      "MARKETING_WHATSAPP",
      "ANALYTICS",
      "PERSONALISATION",
    ]),
    state: z.enum(["GRANTED", "WITHDRAWN"]),
    channel: z.enum([
      "WEB_CMP",
      "PREFERENCE_CENTRE",
      "EMAIL_LINK",
      "SMS_STOP",
      "WHATSAPP_STOP",
      "CONSENT_MANAGER",
      "SUPPORT",
    ]),
    brand_pack_id: z.string().min(1),
    notice_version: z.string().min(1),
    occurred_at: ISO,
    expires_at: ISO.optional(),
  })
  .strict();
export type MarketingConsentUpdatedData = z.infer<typeof MarketingConsentUpdatedData>;

export const EXPORT_SCOPES = [
  "DATASET",
  "LEGAL_ENTITY",
  "MODULE",
  "AUDIT_PACK",
  "RE_PACK",
  "FULL_TENANT",
  "EXIT",
] as const;

/** `in.infrabyx.<domain>.ExportRequested.v1` data (Ecosystem N11). */
export const ExportRequestedData = z
  .object({
    job_id: z.string().min(1),
    scope_type: z.enum(EXPORT_SCOPES),
    data_classes: z.array(z.string()).min(1),
    destination_type: z.string().min(1),
    requester_role: z.string().min(1),
  })
  .strict();
export type ExportRequestedData = z.infer<typeof ExportRequestedData>;

/** `in.infrabyx.<domain>.ExportCompleted.v1` data (Ecosystem N11); the event is signed (C-22). */
export const ExportCompletedData = z
  .object({
    archive_id: z.string().min(1),
    archive_standard_version: z.string().regex(/^\d+\.\d+$/),
    folder_profile: z.string().min(1),
    file_count: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    manifest_hash: SHA256_HEX,
    destination_type: z.string().min(1),
    predecessor_archive_id: z.string().nullable(),
  })
  .strict();
export type ExportCompletedData = z.infer<typeof ExportCompletedData>;

export const RuleSetPublishedData = z
  .object({
    rule_set_id: z.string(),
    key: z.string(),
    version: z.number().int().positive(),
    digest: SHA256_HEX,
    approval_id: z.string(),
    effective_from: ISO,
  })
  .strict();

export const NotificationHeldData = z
  .object({
    notification_id: z.string(),
    delivery_id: z.string(),
    class_id: z.string(),
    channel: z.string(),
    inbox_item_id: z.string(),
  })
  .strict();

export const NotificationDigestSentData = z
  .object({
    user_id: z.string(),
    channel: z.string(),
    entry_count: z.number().int().positive(),
    digest_date: z.iso.date(),
  })
  .strict();

export const InboxItemEventData = z
  .object({
    item_id: z.string(),
    type: z.string(),
    product_module: z.string(),
    record_ref: z.string(),
    assignee_kind: z.enum(["user", "role"]),
    assignee: z.string(),
  })
  .strict();

export const ApprovalExpiredData = z
  .object({
    request_id: z.string(),
    action: z.string(),
    risk_class: z.string(),
    maker_id: z.string(),
    expires_at: ISO,
  })
  .strict();

export const ApprovalEscalatedData = z
  .object({
    request_id: z.string(),
    action: z.string(),
    risk_class: z.string(),
    escalated_to_role: z.string(),
    pending_hours: z.number().int().positive(),
  })
  .strict();

export const ExportMapBumpedData = z
  .object({
    map: z.string(),
    from_version: z.string(),
    to_version: z.string(),
    change: z.enum(["minor", "major"]),
  })
  .strict();

export const GoldenArchiveDriftData = z
  .object({
    release: z.string(),
    map_version: z.string(),
    changed_files: z.number().int().nonnegative(),
  })
  .strict();

/** Operations alert when the flag provider is unreachable (PL3-D-13). Flag keys only, no context. */
export const FlagProviderUnreachableData = z
  .object({
    flag_key: z.string(),
    served_from: z.enum(["snapshot", "safe-state", "default"]),
    snapshot_age_s: z.number().int().nonnegative().nullable(),
  })
  .strict();
