// Events of the public-website kit (PL5 plan §3.6, §8). Internal events follow
// `in.<product>.<module>.<Event>.v1` (IPB-04 §04.6.1, IPB-05 §05.6, IPB-06 §06.6.1, IPB-07 §07.6.1,
// IPB-08 §08.6.1). The Ecosystem v1.2 payloads below are for `in.infrabyx.*` events registered in
// Ecosystem §6.15, §6.34, §6.35, §6.38–§6.40; their emitters stay off until every product owner
// records v1.2 approval (§6.1; `eco.v12.emit_enabled`). Payloads carry ids, hashes and versions;
// never a person's name, contact details or free text that was not PII-scanned.
import { z } from "zod";
import {
  CONSENT_REGIONS,
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
  LEAD_SOURCES,
  VAD_CADENCES,
  VAD_CATEGORIES,
  VAD_STATES,
  VAD_VISIBILITY,
} from "../ports/web.js";

/** `module` and `name` per the IPB event tables; register with `internalEvent({ event })`. */
export const CMS_EVENTS = {
  RevisionCreated: { module: "cms", name: "RevisionCreated" },
  PublishRequested: { module: "cms", name: "PublishRequested" },
  ContentPublished: { module: "cms", name: "ContentPublished" },
  ContentUnpublished: { module: "cms", name: "ContentUnpublished" },
  RollbackPerformed: { module: "cms", name: "RollbackPerformed" },
  ClaimsLintFailed: { module: "cms", name: "ClaimsLintFailed" },
  ContentStale: { module: "cms", name: "ContentStale" },
  ResourceDownloaded: { module: "cms", name: "ResourceDownloaded" },
  ResourceReviewDue: { module: "cms", name: "ResourceReviewDue" },
  RedirectChanged: { module: "cms", name: "RedirectChanged" },
  PolicyDrafted: { module: "cms", name: "PolicyDrafted" },
  PolicyApproved: { module: "cms", name: "PolicyApproved" },
  PolicyEffective: { module: "cms", name: "PolicyEffective" },
  PolicyReviewDue: { module: "cms", name: "PolicyReviewDue" },
  MediaPublishBlocked: { module: "cms", name: "MediaPublishBlocked" },
} as const;

export const BRAND_EVENTS = {
  /** IPB-04 §04.6.1 puts brand-pack events in the `tenancy` namespace. */
  BrandPackPublished: { module: "tenancy", name: "BrandPackPublished" },
  BrandPackRolledBack: { module: "tenancy", name: "BrandPackRolledBack" },
  ContrastGuardFailed: { module: "brand", name: "ContrastGuardFailed" },
} as const;

export const CONSENT_EVENTS = {
  ConsentRecorded: { module: "web", name: "ConsentRecorded" },
  AcceptanceRecorded: { module: "pol", name: "AcceptanceRecorded" },
  AcknowledgementRecorded: { module: "pol", name: "AcknowledgementRecorded" },
  AcceptanceRefused: { module: "pol", name: "AcceptanceRefused" },
} as const;

export const FEEDBACK_EVENTS = {
  FeedbackSubmitted: { module: "fb", name: "FeedbackSubmitted" },
  FeedbackStatusChanged: { module: "fb", name: "FeedbackStatusChanged" },
  AccessibilityIssueReported: { module: "a11y", name: "AccessibilityIssueReported" },
  AccessibilityIssueSlaBreached: { module: "a11y", name: "AccessibilityIssueSlaBreached" },
} as const;

export const TRUST_EVENTS = {
  VendorAssuranceDocumentAcknowledged: {
    module: "trust",
    name: "VendorAssuranceDocumentAcknowledged",
  },
  VendorDocumentRequested: { module: "trust", name: "VendorDocumentRequested" },
  MirrorDigestMismatch: { module: "trust", name: "MirrorDigestMismatch" },
  NdaAccepted: { module: "trust", name: "NdaAccepted" },
} as const;

export const HLP_EVENTS = {
  GlossaryEntryPublished: { module: "hlp", name: "GlossaryEntryPublished" },
  GlossaryEntryDeprecated: { module: "hlp", name: "GlossaryEntryDeprecated" },
} as const;

const Id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_`));
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const Iso = z.iso.datetime({ offset: true });

/* ------------------------------------------------------------------------ internal payloads */

export const ContentPublishedData = z
  .object({
    item_id: z.string(),
    revision_id: Id("rev"),
    content_type: z.string(),
    brand_pack_id: Id("brd"),
    locale: z.string(),
    routes: z.array(z.string()),
  })
  .strict();

export const RollbackPerformedData = z
  .object({
    item_id: z.string(),
    from_revision_id: Id("rev"),
    to_revision_id: Id("rev"),
    maker_id: z.string(),
    checker_id: z.string(),
  })
  .strict();

export const PolicyEffectiveData = z
  .object({
    policy_key: z.string(),
    version: z.string(),
    brand_pack_id: Id("brd"),
    effective_at: Iso,
    reconsent_required: z.boolean(),
  })
  .strict();

export const BrandPackPublishedData = z
  .object({
    brd_id: Id("brd"),
    revision_id: Id("brv"),
    action: z.enum(["PUBLISHED", "ROLLED_BACK"]),
    hosts: z.array(z.string()),
    app_name: z.string(),
    contrast_guard_passed: z.boolean(),
    rollback_of: Id("brv").nullable(),
  })
  .strict();

export const ConsentRecordedData = z
  .object({
    receipt_id: Id("cns"),
    categories: z.array(z.string()),
    region: z.enum(CONSENT_REGIONS),
    text_version: z.string(),
    gpc: z.boolean(),
  })
  .strict();

export const FeedbackSubmittedInternalData = z
  .object({
    fbk_id: Id("fbk"),
    category: z.enum(FEEDBACK_CATEGORIES),
    route_pattern: z.string().nullable(),
    severity: z.enum(["S1", "S2", "S3", "S4"]).nullable(),
  })
  .strict();

export const MirrorDigestMismatchData = z
  .object({ product: z.string(), expected: z.string(), actual: z.string() })
  .strict();

/* ---------------------------------------------------- Ecosystem v1.2 payloads (emitters off) */

/** §6.35 `in.infrabyx.tenancy.BrandPackPublished.v1` (PUBLIC). */
export const EcoBrandPackPublished = z
  .object({
    brd_id: Id("brd"),
    product: z.string(),
    revision_id: Id("brv"),
    action: z.enum(["PUBLISHED", "ROLLED_BACK"]),
    hosts: z.array(z.string()),
    app_name: z.string(),
    legal_entity_ref: z.string(),
    email_domain: z.string().nullable(),
    terminology_override: z.record(z.string(), z.string()),
    contrast_guard_passed: z.boolean(),
    policy_set_id: Id("pol"),
    published_at: Iso,
  })
  .strict();

/** §6.15 `in.infrabyx.grc.PolicyEffective.v1` (PUBLIC). */
export const EcoPolicyEffective = z
  .object({
    policy_key: z.string(),
    version: z.string(),
    effective_at: Iso,
    reconsent_required: z.boolean(),
    notice_url: z.string(),
    brand_pack_id: Id("brd"),
    product: z.string(),
  })
  .strict();

/** §6.39 `in.infrabyx.consent.MarketingConsentUpdated.v1` (INTERNAL; the event is the evidence). */
export const EcoMarketingConsentUpdated = z
  .object({
    consent_id: Id("cns"),
    principal_hash: z.string().min(16),
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
    brand_pack_id: Id("brd").nullable(),
    notice_version: z.string(),
    occurred_at: Iso,
    expires_at: Iso.nullable().optional(),
  })
  .strict();

/** §6.39 `in.infrabyx.crm.LeadCaptured.v1` (INTERNAL; consentref with purpose LEAD_CONTACT). */
export const EcoLeadCaptured = z
  .object({
    lead_id: z.string(),
    product: z.string(),
    brand_pack_id: Id("brd").nullable(),
    source: z.enum(LEAD_SOURCES),
    contact_hash: z.string().min(16),
    fields_ref: z.string(),
    utm: z
      .object({
        source: z.string().optional(),
        medium: z.string().optional(),
        campaign: z.string().optional(),
        content: z.string().optional(),
        term: z.string().optional(),
      })
      .strict()
      .optional(),
    page_url: z.string(),
    interest: z.string().optional(),
    captured_at: Iso,
    notice_version: z.string(),
  })
  .strict();

/** §6.40 `in.infrabyx.feedback.FeedbackSubmitted.v1` (INTERNAL; never tenant customer data). */
export const EcoFeedbackSubmitted = z
  .object({
    fbk_id: Id("fbk"),
    product: z.string(),
    tenantid: z.string(),
    module: z.string(),
    surface: z.enum(["WIDGET", "HELP_ARTICLE", "BETA", "A11Y", "VIDHI"]),
    flag_key: z.string().optional(),
    release: z.string().optional(),
    severity: z.enum(["S1", "S2", "S3", "S4"]),
    category: z.enum(FEEDBACK_CATEGORIES),
    summary: z.string().max(500),
    attachments_count: z.number().int().nonnegative(),
    a11y_sla_due_at: Iso.optional(),
    submitted_by_role: z.string(),
    contact_ok: z.boolean(),
  })
  .strict();

/** §6.40 `in.infrabyx.feedback.FeedbackStatusChanged.v1` (OH → originating product). */
export const EcoFeedbackStatusChanged = z
  .object({
    fbk_id: Id("fbk"),
    status: z.enum(FEEDBACK_STATUSES),
    linked_rel_id: z.string().optional(),
    public_note: z.string().max(300).optional(),
    changed_at: Iso,
  })
  .strict();

/** §6.34 `in.infrabyx.trust.VendorAssuranceDocumentStateChanged.v1` (OH → products). */
export const EcoVendorAssuranceDocumentStateChanged = z
  .object({
    vad_id: Id("vad"),
    version: z.number().int().positive(),
    state: z.enum(VAD_STATES),
    visibility: z.enum(VAD_VISIBILITY),
    publication_targets: z.array(z.string()),
    reason_code: z.string().optional(),
    changed_at: Iso,
  })
  .strict();

/** §6.34 `in.infrabyx.trust.VendorAssuranceDocumentPublished.v1` (OH → products). */
export const EcoVendorAssuranceDocumentPublished = z
  .object({
    vad_id: Id("vad"),
    title: z.string(),
    category: z.enum(VAD_CATEGORIES),
    cadence: z.enum(VAD_CADENCES),
    valid_from: z.iso.date(),
    valid_until: z.iso.date().nullable(),
    version: z.number().int().positive(),
    storage_ref: z.string(),
    sha256: Sha256,
    visibility: z.enum(VAD_VISIBILITY),
    publication_targets: z.array(z.string()),
    nda_required: z.boolean(),
    summary: z.string().max(500),
    supersedes_vad_id: Id("vad").nullable().optional(),
  })
  .strict();

/** §6.34 `in.infrabyx.trust.VendorAssuranceDocumentAcknowledged.v1` (products → OH; never a name). */
export const EcoVendorAssuranceDocumentAcknowledged = z
  .object({
    vad_id: Id("vad"),
    version: z.number().int().positive(),
    tenantid: z.string(),
    product: z.string(),
    action: z.enum(["VIEWED", "ACKNOWLEDGED", "PACK_EXPORTED", "NDA_ACCEPTED"]),
    pack_id: z.string().optional(),
    preset: z.string().optional(),
    acknowledged_by_role: z.string(),
    occurred_at: Iso,
  })
  .strict();
