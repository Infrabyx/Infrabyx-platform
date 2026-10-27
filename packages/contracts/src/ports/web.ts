// The public-website ports (PL5 plan §8; IPB-04 §04.4.2, IPB-05, IPB-08 §08.4.6; Ecosystem §3.12
// supplementary ports, §5.2 entity 29, §6.27, §6.34, §6.39, §6.40). Interfaces and payload shapes
// only: PL5 builds a fixture or local adapter for each and an OH adapter against a stub where OH is
// the provider. Personal data crosses these ports only with a consent receipt.
import { z } from "zod";
import type { Port, PortCall } from "./common.js";

/* ------------------------------------------------------------------ CONSENT (IPB-04-78, Eco #29) */

export const CONSENT_CATEGORIES = ["necessary", "functional", "analytics", "marketing"] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];
/** Non-necessary categories a person can switch. */
export const OPTIONAL_CONSENT_CATEGORIES = ["functional", "analytics", "marketing"] as const;

/** Consent regions for wording (IPB-04-81). */
export const CONSENT_REGIONS = ["IN", "EU", "US-CA", "OTHER"] as const;
export type ConsentRegion = (typeof CONSENT_REGIONS)[number];

/** How the choice was captured (Ecosystem entity 29 `method`, v1.2 adds `CMP_BANNER`). */
export const CONSENT_METHODS = [
  "CMP_BANNER",
  "PREFERENCE_CENTRE",
  "FORM",
  "CONSENT_MANAGER",
] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

/** Ecosystem v1.2 purpose codes the public site captures (§5.2 entity 29, `marketing_purpose`). */
export const WEB_CONSENT_PURPOSES = [
  "ANALYTICS",
  "MARKETING_EMAIL",
  "MARKETING_SMS",
  "MARKETING_WHATSAPP",
  "PERSONALISATION",
  "LEAD_CONTACT",
  "CAREER_APPLICATION",
] as const;
export type WebConsentPurpose = (typeof WEB_CONSENT_PURPOSES)[number];

export const ConsentChoice = z
  .object({
    functional: z.boolean(),
    analytics: z.boolean(),
    marketing: z.boolean(),
  })
  .strict();
export type ConsentChoice = z.infer<typeof ConsentChoice>;

export const ConsentRecordInput = z
  .object({
    /** The anonymous first-party id (`ibx_cid`) or a principal reference; at least one. */
    cid: z.string().min(16).max(64).optional(),
    principalRef: z.string().min(3).max(120).optional(),
    brandPackId: z.string().regex(/^brd_/).optional(),
    method: z.enum(CONSENT_METHODS),
    /** Cookie categories (CMP) — necessary is implied and always on. */
    choice: ConsentChoice.optional(),
    /** Purposes granted on a form (each a separate unticked control, IPB-05 template 18). */
    purposes: z.array(z.enum(WEB_CONSENT_PURPOSES)).default([]),
    textKey: z.string().regex(/^(consent|notice)\.[a-z0-9_.]+$/),
    textVersion: z.string().min(1).max(40),
    policyVersion: z.string().max(40).optional(),
    region: z.enum(CONSENT_REGIONS),
    gpc: z.boolean(),
    uaClass: z.string().max(40).optional(),
  })
  .strict()
  .refine((v) => v.cid || v.principalRef, "a consent record needs a cid or a principal reference");
export type ConsentRecordInput = z.input<typeof ConsentRecordInput>;

export interface ConsentReceipt {
  /** `cns_<ULID>`; the receipt id shown to the person and carried as `consentref`. */
  receiptId: string;
  recordedAt: string;
}

export interface ConsentState {
  receiptId: string;
  choice: ConsentChoice;
  textVersion: string;
  region: ConsentRegion;
  gpc: boolean;
  recordedAt: string;
}

/** The consent ledger (Ecosystem Part 6): records append, never overwrite (IPB-04-78). */
export interface ConsentPort extends Port {
  recordConsent(input: ConsentRecordInput, call?: PortCall): Promise<ConsentReceipt>;
  /** The latest cookie choice for an anonymous id, or null. */
  getConsent(cid: string, call?: PortCall): Promise<ConsentState | null>;
}

/* --------------------------------------------------------------------- CRM, HR (IPB-04-53, 67) */

/** Ecosystem `lead_source` (§5.2). */
export const LEAD_SOURCES = [
  "FORM",
  "CHAT",
  "PRICING",
  "WEBINAR",
  "RESOURCE_GATE",
  "DEMO_REQUEST",
  "PARTNER",
] as const;

export const LeadInput = z
  .object({
    source: z.enum(LEAD_SOURCES),
    product: z.string().min(2).max(8),
    brandPackId: z.string().regex(/^brd_/).optional(),
    /** Field values as entered; the platform never stores them (PL5 plan §5.8). */
    fields: z.record(z.string(), z.string().max(5000)),
    consentReceiptId: z.string().regex(/^cns_/),
    noticeVersion: z.string().min(1).max(40),
    pageUrl: z.string().max(500),
    interest: z.string().max(120).optional(),
  })
  .strict();
export type LeadInput = z.infer<typeof LeadInput>;

export interface CrmPort extends Port {
  upsertLead(input: LeadInput, call?: PortCall): Promise<{ leadId: string }>;
}

export const ApplicationInput = z
  .object({
    roleId: z.string().min(1).max(80),
    brandPackId: z.string().regex(/^brd_/).optional(),
    fields: z.record(z.string(), z.string().max(10000)),
    consentReceiptId: z.string().regex(/^cns_/),
    noticeVersion: z.string().min(1).max(40),
  })
  .strict();
export type ApplicationInput = z.infer<typeof ApplicationInput>;

export interface HrPort extends Port {
  createApplication(input: ApplicationInput, call?: PortCall): Promise<{ applicationId: string }>;
}

/* ------------------------------------------------------- SUPPORT, BACKLOG (IPB-04-96, Eco §6.40) */

/** Ecosystem `feedback_category` (§5.2). SECURITY routes to OH13 only, never public. */
export const FEEDBACK_CATEGORIES = [
  "BUG",
  "IDEA",
  "UX",
  "ACCESSIBILITY",
  "CONTENT",
  "HELP_ARTICLE",
  "SECURITY",
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

/** Ecosystem §6.40 `FeedbackStatusChanged.status`. */
export const FEEDBACK_STATUSES = [
  "RECEIVED",
  "TRIAGED",
  "PLANNED",
  "SHIPPED",
  "DECLINED",
  "DUPLICATE",
] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export interface TicketInput {
  kind: "bug" | "grievance" | "dpa_request" | "support" | "accessibility";
  feedbackId?: string;
  category: FeedbackCategory;
  /** PII-scanned before it reaches the port. */
  summary: string;
  routePattern?: string;
  severity?: "S1" | "S2" | "S3" | "S4";
  contactOk: boolean;
  /** Consent receipt when the person may be contacted. */
  consentReceiptId?: string;
}

export interface SupportPort extends Port {
  createTicket(input: TicketInput, call?: PortCall): Promise<{ ref: string }>;
  getStatus(ref: string, call?: PortCall): Promise<FeedbackStatus>;
}

export interface BacklogPort extends Port {
  createIdea(
    input: Omit<TicketInput, "kind"> & { kind: "idea" | "praise" | "nps" | "help_content" },
    call?: PortCall,
  ): Promise<{ ref: string }>;
  getStatus(ref: string, call?: PortCall): Promise<FeedbackStatus>;
}

/* -------------------------------------------------------------------- TRUST (Ecosystem §6.34) */

export const VAD_CATEGORIES = [
  "CERTIFICATE",
  "AUDIT_REPORT",
  "AFFIDAVIT",
  "DPA",
  "POLICY",
  "STATEMENT",
  "ACCESSIBILITY_STATEMENT",
  "EXIT_RUNBOOK",
  "BOM",
  "PENTEST_SUMMARY",
  "INSURANCE",
] as const;
export type VadCategory = (typeof VAD_CATEGORIES)[number];
export const VAD_VISIBILITY = ["PUBLIC", "TENANT", "GATED_NDA", "AUDITOR"] as const;
export type VadVisibility = (typeof VAD_VISIBILITY)[number];
export const VAD_CADENCES = ["MONTHLY", "QUARTERLY", "HALF_YEARLY", "ANNUAL", "EVENT"] as const;
export const VAD_STATES = ["PUBLISHED", "SUPERSEDED", "EXPIRED", "WITHDRAWN"] as const;
export type VadState = (typeof VAD_STATES)[number];

/** One document as OH announces it (`VendorAssuranceDocumentPublished`, §6.34). */
export const VadDocument = z
  .object({
    vad_id: z.string().regex(/^vad_/),
    title: z.string().min(1).max(300),
    category: z.enum(VAD_CATEGORIES),
    /** IPB-08 type key (`cert_iso27001`…) when OH sends it; product-internal, not on the wire. */
    type_key: z.string().max(80).optional(),
    cadence: z.enum(VAD_CADENCES),
    valid_from: z.iso.date(),
    valid_until: z.iso.date().nullable(),
    version: z.number().int().positive(),
    storage_ref: z.string().min(1).max(500),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    visibility: z.enum(VAD_VISIBILITY),
    publication_targets: z.array(z.string().min(2).max(8)),
    nda_required: z.boolean(),
    summary: z.string().max(500),
    supersedes_vad_id: z.string().regex(/^vad_/).nullable().optional(),
    state: z.enum(VAD_STATES).default("PUBLISHED"),
    issuer_name: z.string().max(200).optional(),
  })
  .strict();
export type VadDocument = z.infer<typeof VadDocument>;

export interface TrustPort extends Port {
  /** Daily reconciliation (`GET /v1/trust/documents?updated_since=`). */
  listDocuments(updatedSince: string | null, call?: PortCall): Promise<VadDocument[]>;
  /** Signed India-hosted URL, at most 15 minutes, with the digest to verify. */
  fileUrl(
    vadId: string,
    call?: PortCall,
  ): Promise<{ url: string; sha256: string; expiresAt: string }>;
  /** OH's digest of the publication set, compared daily (IPB-08-29). */
  publicationDigest(call?: PortCall): Promise<string>;
}

/* --------------------------------------------------------- BILLING catalogue (IPB-04-33, §6.27) */

export const CataloguePrice = z
  .object({
    currency: z.string().length(3),
    /** Integer minor units; the platform never stores or types a price (IPB-04-33). */
    amount_minor: z.number().int().nonnegative(),
    period: z.enum(["month", "year", "one_time"]),
    /** GST rate in basis points for the label (1800 = 18 %), or null when not applicable. */
    gst_rate_bp: z.number().int().nonnegative().nullable(),
    tax_inclusive: z.boolean(),
  })
  .strict();

export const CataloguePlan = z
  .object({
    plan_key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
    name: z.string().min(1).max(80),
    features: z.array(z.string().regex(/^[a-z][a-z0-9_.]{1,80}$/)),
    prices: z.array(CataloguePrice),
    trial_days: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const Catalogue = z
  .object({
    product: z.string().min(2).max(8),
    brand_pack_id: z.string().regex(/^brd_/).nullable(),
    catalogue_version: z.string().min(1).max(40),
    catalogue_hash: z.string().regex(/^[0-9a-f]{64}$/),
    plans: z.array(CataloguePlan),
    coupons: z.array(
      z
        .object({
          coupon_key: z.string().max(40),
          label: z.string().max(80),
          ends_at: z.iso.datetime({ offset: true }).nullable(),
        })
        .strict(),
    ),
    fetched_at: z.iso.datetime({ offset: true }),
  })
  .strict();
export type Catalogue = z.infer<typeof Catalogue>;

export interface BillingCataloguePort extends Port {
  getCatalogue(product: string, brandPackId: string | null, call?: PortCall): Promise<Catalogue>;
}

/* ------------------------------------------------- TAG_MANAGER, ANALYTICS (IPB-04-85, 86; OWN-09) */

/** A script the gating layer may activate only after consent for its category. */
export interface GatedScript {
  category: Exclude<ConsentCategory, "necessary">;
  /** First-party or consented provider URL; never inline third-party code. */
  src: string;
  async?: boolean;
}

export interface TagManagerPort extends Port {
  /** What to place in the page for this consent state; `none` returns nothing. */
  scripts(consent: ConsentChoice, route: { pattern: string; sensitive: boolean }): GatedScript[];
}

export interface AnalyticsPort extends Port {
  /** Server-side event; dropped unless analytics consent is given. `none` drops everything. */
  track(
    event: { name: string; routePattern: string; props?: Record<string, string | number> },
    consent: ConsentChoice,
  ): Promise<void>;
}

/* --------------------------------------------------- EGRESS (IPB-04 §04.4.4; AT-94 SSRF guard) */

export interface EgressPort extends Port {
  /** Fetch an allow-listed URL with DNS pinning, a private-range block, a timeout and a size cap. */
  fetch(
    url: string,
    o?: { maxBytes?: number; timeoutMs?: number; accept?: string },
  ): Promise<{ status: number; contentType: string; body: Uint8Array }>;
}

/* ------------------------------------------ CLAIMS gate, LAW_REGISTER (Ecosystem §6.29; IPB-05) */

export interface ClaimsPort extends Port {
  /** OH14 claims gate (`GET /v1/claims-gate/check`); the local Claims Register decides until it exists. */
  check(input: {
    text: string;
    surface: "website" | "trust" | "sales" | "tutorial" | "clip";
  }): Promise<{
    status: "PASS" | "BLOCKED";
    claimId?: string;
    reason?: string;
  }>;
}

export interface LawRegisterPort extends Port {
  /** Whether each cited instrument is still in force (IPB-05 `IPB-POL-004`). */
  checkCitations(citations: readonly string[]): Promise<
    {
      citation: string;
      status: "current" | "repealed" | "superseded" | "unknown";
      replacement?: string;
    }[]
  >;
}

/** The ports PL5 defines (PL5 plan §8). */
export const PL5_PORTS = [
  "CONSENT",
  "CRM",
  "HR",
  "SUPPORT",
  "BACKLOG",
  "TRUST",
  "BILLING",
  "TAG_MANAGER",
  "ANALYTICS",
  "EGRESS",
  "CLAIMS",
  "LAW_REGISTER",
] as const;
export type Pl5Port = (typeof PL5_PORTS)[number];
