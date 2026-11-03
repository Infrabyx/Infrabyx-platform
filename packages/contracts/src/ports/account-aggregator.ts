// AA_FIU port, a product port of IPB-01 §01.4.4.3 owned by FBX: the Account Aggregator FIU side
// (Finbyx platform request PR-FBX-28, R1-D-43, ADR-0003; `int.aa_fiu.*` keys come with the first
// adapter). Consent is asked through an Account Aggregator with the ReBIT consent template; financial information (FI)
// is fetched only under an ACTIVE consent, within its FI types and data range, and lands in STORAGE
// with its SHA-256 and the ReBIT schema version of the payload. A revoked, paused, rejected or
// expired consent fetches nothing. Every request and result is REGULATED and stays `IN`. Vendor
// adapters (an AA or a technology service provider) wait for the owner's sandbox documents and
// accounts; the fake in @infrabyx/testing and the contract cases define the behaviour.
import { z } from "zod";
import type { Port, PortCall, WebhookRequestMeta } from "./common.js";
import { classed } from "./payload-class.js";

const regulated = <T extends z.ZodType>(s: T): T => classed(s, "REGULATED");

/** ReBIT FI types the platform recognises (a subset; extend here). */
export const FI_TYPES = [
  "DEPOSIT",
  "TERM_DEPOSIT",
  "RECURRING_DEPOSIT",
  "GST_GSTR1_3B",
  "MUTUAL_FUNDS",
  "EQUITIES",
  "INSURANCE_POLICIES",
] as const;
export type FiType = (typeof FI_TYPES)[number];

/** ReBIT consent purpose codes (101 wealth, 102 customer spending, 103 monitoring, 104 aggregated, 105 one-time). */
export const AA_PURPOSE_CODES = ["101", "102", "103", "104", "105"] as const;
export const AA_FETCH_TYPES = ["ONETIME", "PERIODIC"] as const;
export const AA_CONSENT_STATES = [
  "PENDING",
  "ACTIVE",
  "PAUSED",
  "REJECTED",
  "REVOKED",
  "EXPIRED",
] as const;
export type AaConsentState = (typeof AA_CONSENT_STATES)[number];

const DATE_TIME = z.iso.datetime({ offset: true });
const DURATION = z
  .object({ unit: z.enum(["DAY", "MONTH", "YEAR", "INF"]), value: z.number().int().min(0) })
  .strict();

export const AaConsentRequest = z
  .object({
    /** The customer's AA handle (`<user>@<aa>`). */
    customerHandle: regulated(z.string().regex(/^[A-Za-z0-9._-]{3,60}@[a-z0-9-]{2,30}$/)),
    /** The product's own reference for the customer. */
    subjectRef: z.string().min(3).max(200),
    /** The product's consent receipt for asking (`cpr_…`). */
    consentRef: z.string().regex(/^cpr_[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
    purposeCode: z.enum(AA_PURPOSE_CODES),
    fiTypes: z.array(z.enum(FI_TYPES)).min(1).max(FI_TYPES.length),
    fetchType: z.enum(AA_FETCH_TYPES),
    /** PERIODIC only: how often FI may be fetched. */
    frequency: z
      .object({ unit: z.enum(["HOUR", "DAY", "MONTH", "YEAR"]), value: z.number().int().min(1) })
      .strict()
      .optional(),
    dataRange: z.object({ from: DATE_TIME, to: DATE_TIME }).strict(),
    /** How long the FIU may keep the data (ReBIT `DataLife`). */
    dataLife: DURATION,
    consentStart: DATE_TIME,
    consentExpiry: DATE_TIME,
  })
  .strict()
  .refine((r) => r.fetchType === "ONETIME" || r.frequency !== undefined, {
    message: "a PERIODIC consent needs a frequency",
  })
  .refine((r) => Date.parse(r.dataRange.from) <= Date.parse(r.dataRange.to), {
    message: "the data range runs from no later than to",
  })
  .refine((r) => Date.parse(r.consentStart) < Date.parse(r.consentExpiry), {
    message: "a consent expires after it starts",
  });
export type AaConsentRequest = z.input<typeof AaConsentRequest>;

export const AaFetchRequest = z
  .object({
    consentId: z.string().min(3).max(200),
    range: z.object({ from: DATE_TIME, to: DATE_TIME }).strict(),
    /** Where the adapter writes each FI payload: `tenant/<tenant>/<module>/` prefix. */
    dataPrefix: z.string().regex(/^tenant\/[a-z]{2,6}_[A-Za-z0-9]+\/[a-z][a-z0-9_]*\/$/),
    fiTypes: z.array(z.enum(FI_TYPES)).min(1).optional(),
  })
  .strict();
export type AaFetchRequest = z.input<typeof AaFetchRequest>;

export interface AaEvidence {
  vendorRef: string;
  adapter: string;
  /** The ReBIT API version the AA spoke. */
  apiVersion: string;
  checkedAt: string;
}

export interface AaConsent extends AaEvidence {
  consentId: string;
  /** The AA's consent handle while PENDING. */
  consentHandle: string;
  state: AaConsentState;
  fiTypes: FiType[];
  dataRange: { from: string; to: string };
  consentExpiry: string;
  /** FI types the customer revoked one by one, while the rest stays ACTIVE. */
  revokedFiTypes: FiType[];
}

export interface FiPayload {
  fiType: FiType;
  /** The masked account reference the AA returns (never a full account number). */
  maskedAccount: string;
  storageKey: string;
  sha256: string;
  /** The ReBIT FI schema version of this payload, e.g. `1.1.3`. */
  schemaVersion: string;
}

export interface AaFetchResult extends AaEvidence {
  sessionId: string;
  consentId: string;
  state: "COMPLETED" | "PARTIAL" | "PENDING";
  payloads: FiPayload[];
}

export interface AaNotification {
  kind: "consent" | "fi";
  consentId: string;
  consent?: AaConsent;
  sessionId?: string;
}

export interface AccountAggregatorPort extends Port {
  /** Refused without the product's consent receipt for asking. */
  requestConsent(req: AaConsentRequest, call?: PortCall): Promise<AaConsent>;
  consentStatus(consentId: string, call?: PortCall): Promise<AaConsent>;
  /** Revoke in full, or for the listed FI types only. */
  revoke(consentId: string, fiTypes?: readonly FiType[], call?: PortCall): Promise<AaConsent>;
  /** Only under an ACTIVE, unexpired consent, within its FI types and data range. */
  fetch(req: AaFetchRequest, call?: PortCall): Promise<AaFetchResult>;
  /** Parses a consent or FI notification, then reads the consent back; only that is trusted. */
  handleWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    meta?: WebhookRequestMeta,
  ): Promise<AaNotification>;
}
