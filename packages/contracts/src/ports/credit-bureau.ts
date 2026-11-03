// BUREAU port, a product port of IPB-01 §01.4.4.3 owned by FBX (Finbyx platform request PR-FBX-28,
// R1-D-43, ADR-0003). A pull from one of the four credit information companies, routed per tenant
// (`int.bureau.<cic>.enabled`, registered with the first adapter). Every request and
// result is REGULATED and stays `IN`. A pull needs the product's recorded consent receipt for it
// (`PurposeConsents`, PR-FBX-26) and is refused without one. The subject travels by reference and
// its identifiers in a REGULATED schema; the CIC's raw report goes to STORAGE with its SHA-256, and
// the result carries a normalised summary in integer paise. Vendor adapters wait for the owner's
// sandbox documents and accounts; the fake in @infrabyx/testing and the contract cases define the
// behaviour every adapter must keep.
import { z } from "zod";
import type { Port, PortCall, WebhookRequestMeta } from "./common.js";
import { PAN } from "./kyc.js";
import { classed } from "./payload-class.js";

const regulated = <T extends z.ZodType>(s: T): T => classed(s, "REGULATED");

export const CREDIT_BUREAUS = ["cibil", "experian", "equifax", "crif"] as const;
export type CreditBureau = (typeof CREDIT_BUREAUS)[number];

/** A soft enquiry leaves no footprint on the subject's report; a hard one is recorded by the CIC. */
export const ENQUIRY_TYPES = ["soft", "hard"] as const;
export type EnquiryType = (typeof ENQUIRY_TYPES)[number];

export const BUREAU_PURPOSES = [
  "new_credit",
  "review",
  "collections",
  "guarantor",
  "co_applicant",
] as const;

/** A file in STORAGE: its key and SHA-256 (the CIC's raw report). */
export const BureauFileRef = z
  .object({
    storageKey: regulated(z.string().min(1).max(1024)),
    sha256: regulated(z.string().regex(/^[0-9a-f]{64}$/)),
  })
  .strict();
export type BureauFileRef = z.infer<typeof BureauFileRef>;

export const BureauSubject = z
  .object({
    /** The product's own reference for the person or entity, never a PAN. */
    subjectRef: z.string().min(3).max(200),
    kind: z.enum(["individual", "commercial"]),
    name: regulated(z.string().min(1).max(200)),
    pan: regulated(z.string().regex(PAN)).optional(),
    dob: regulated(z.iso.date()).optional(),
    mobile: regulated(z.string().regex(/^\+91[6-9][0-9]{9}$/)).optional(),
    pincode: regulated(z.string().regex(/^[1-9][0-9]{5}$/)).optional(),
  })
  .strict()
  .refine((s) => s.pan !== undefined || s.mobile !== undefined, {
    message: "a subject needs a PAN or a mobile number",
  });

export const BureauPullRequest = z
  .object({
    bureau: z.enum(CREDIT_BUREAUS),
    enquiry: z.enum(ENQUIRY_TYPES),
    purpose: z.enum(BUREAU_PURPOSES),
    /** The product's consent receipt for this pull (`cpr_…`); a pull without one is refused. */
    consentRef: z.string().regex(/^cpr_[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
    /** Loan amount enquired for, in integer paise (hard enquiries). */
    amountPaise: z.number().int().positive().max(1e14).optional(),
    subject: BureauSubject,
    /** Where the adapter writes the raw report: `tenant/<tenant>/<module>/` prefix. */
    reportPrefix: z.string().regex(/^tenant\/[a-z]{2,6}_[A-Za-z0-9]+\/[a-z][a-z0-9_]*\/$/),
  })
  .strict();
export type BureauPullRequest = z.input<typeof BureauPullRequest>;

/** What every result carries for traceability (as `KycEvidence`). */
export interface BureauEvidence {
  vendorRef: string;
  adapter: string;
  /** The CIC's report format and version, e.g. `cibil-cir-4.0`. */
  formatVersion: string;
  checkedAt: string;
}

export const DPD_BUCKETS = ["0", "1-30", "31-60", "61-90", "91-180", "180+"] as const;
export type DpdBucket = (typeof DPD_BUCKETS)[number];

export interface Tradeline {
  lenderType: "bank" | "nbfc" | "hfc" | "mfi" | "other";
  accountType: string;
  ownership: "individual" | "joint" | "guarantor";
  sanctionedPaise: number;
  currentPaise: number;
  overduePaise: number;
  /** The worst days-past-due bucket in the last 12 months, and the latest. */
  worstDpd12m: DpdBucket;
  currentDpd: DpdBucket;
  status: "active" | "closed" | "written_off" | "settled" | "restructured";
  openedOn: string;
  closedOn?: string;
}

export interface BureauSummary {
  /** Null when the subject has no score (new to credit). */
  score: number | null;
  scoreVersion: string;
  tradelines: Tradeline[];
  enquiries: { last30d: number; last90d: number; last365d: number };
}

export interface BureauReport extends BureauEvidence {
  bureau: CreditBureau;
  enquiry: EnquiryType;
  /** `ready`, or `pending` until the CIC's webhook or a poll completes it. */
  state: "ready" | "pending" | "no_hit";
  pullId: string;
  consentRef: string;
  /** The CIC's raw report in STORAGE (absent while pending or on no hit). */
  report?: BureauFileRef;
  summary?: BureauSummary;
}

export interface CreditBureauPort extends Port {
  /** Refused without a consent receipt; a hard enquiry is recorded by the CIC. */
  pull(req: BureauPullRequest, call?: PortCall): Promise<BureauReport>;
  /** Read a pull back from the CIC (for a `pending` one). */
  status(pullId: string, call?: PortCall): Promise<BureauReport>;
  /** Parses an async-report event, then reads the pull back from the CIC; only that is trusted. */
  handleWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    meta?: WebhookRequestMeta,
  ): Promise<BureauReport>;
}
