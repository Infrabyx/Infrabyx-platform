// The origination contract between an LSP (Udofin) and the lender (Finbyx), Ecosystem
// Specification §6.2 and the two §6.3 items of the loan journey (Udofin PR-UDF-051; R1-D-217;
// plan `docs/phases/R1-udofin-phase7-plan.md`). Field names are the Specification's key payload
// fields in snake case; unknown fields pass through, as for the other Ecosystem schemas, and are
// checked against the registry schemas when they are published ([VERIFY]).
//
// `EligibilityCheck` is a synchronous call, not an event pair: the Specification defines it as
// `POST /v1/eligibility-checks` with an `Idempotency-Key`, a budget of at most 3 s and "timeout =
// lender unavailable" (§6.2; Part 10.3). Four of the events are regulated messages (§3.6): they
// carry the detached JWS over the CloudEvent (`signRegulatedMessage` in @infrabyx/crypto).
//
// Conventions: money in integer paise, rates in integer basis points, hashes as lower-case SHA-256
// hex, people by reference only (`applicant_ref`; never a name, PAN or Aadhaar number).
import { z } from "zod";
import { REGULATED_MESSAGE_EVENTS } from "./regulated.js";

/** The schema version every type below starts at (the envelope's `schemaver`). */
export const ORIGINATION_SCHEMA_VERSION = "1.0.0";
/** `EligibilityCheck`'s budget (§6.2, Part 10.3): after it the lender counts as unavailable. */
export const ELIGIBILITY_CHECK_BUDGET_MS = 3000;
/** The path of the synchronous call (§6.2). */
export const ELIGIBILITY_CHECK_PATH = "/v1/eligibility-checks";

const ref = z.string().regex(/^[A-Za-z0-9_.:-]{3,128}$/);
const code = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const at = z.iso.datetime({ offset: true });
const date = z.iso.date();
const paise = z.number().int().positive().max(1e14);
const bp = z.number().int().min(0).max(100_000);
const tenor = z.number().int().min(1).max(600);
const version = z.number().int().min(1);

const Offer = z
  .object({ offer_id: ref, amount_paise: paise, tenor_months: tenor, apr_bp: bp })
  .loose();

// ---- EligibilityCheck (synchronous) ------------------------------------------------------------

/** The request body of `POST /v1/eligibility-checks`; the `Idempotency-Key` header is required. */
export const EligibilityCheckRequest = z
  .object({
    lsp_ref: ref,
    product_code: ref,
    product_version: z.string().max(32).optional(),
    amount_paise: paise,
    tenor_months: tenor,
    /** The purpose consent the minimum fields are shared under (§3.2 `consentref`). */
    consentref: ref,
    /** The minimum consented fields, by the product catalogue's field codes. */
    fields: z
      .record(
        z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
        z.union([z.string().max(256), z.number(), z.boolean()]),
      )
      .refine((f) => Object.keys(f).length <= 64, "at most 64 fields"),
  })
  .loose();
export type EligibilityCheckRequest = z.infer<typeof EligibilityCheckRequest>;

export const ELIGIBILITY_OUTCOMES = ["ELIGIBLE", "NOT_ELIGIBLE", "REFER"] as const;

/** The lender's answer within the budget. */
export const EligibilityCheckAnswer = z
  .object({
    check_id: ref,
    outcome: z.enum(ELIGIBILITY_OUTCOMES),
    offers: z.array(Offer).max(20),
    reason_codes: z.array(code).max(20),
    rule_version: z.string().min(1).max(64),
    valid_until: at,
  })
  .loose()
  .refine((a) => a.outcome === "ELIGIBLE" || a.offers.length === 0, "offers only when ELIGIBLE");
export type EligibilityCheckAnswer = z.infer<typeof EligibilityCheckAnswer>;

/** The fixed outcome when the lender does not answer within the budget (§6.2). */
export const ELIGIBILITY_LENDER_UNAVAILABLE = "lender_unavailable";

// ---- §6.2 events -------------------------------------------------------------------------------

const Document = z.object({ document_id: ref, kind: code, sha256 }).loose();

export const ApplicationSubmittedData = z
  .object({
    lsp_application_ref: ref,
    applicants: z
      .array(
        z
          .object({ applicant_ref: ref, role: z.enum(["PRIMARY", "CO_APPLICANT", "GUARANTOR"]) })
          .loose(),
      )
      .min(1)
      .max(10),
    kyc_evidence_refs: z.array(ref).max(50),
    otp_ekyc_declaration: z.object({ declared_at: at, sha256 }).loose().optional(),
    bureau_refs: z.array(ref).max(20),
    aa_refs: z.array(ref).max(20),
    documents: z.array(Document).max(100),
    consents: z.array(ref).min(1).max(50),
    household: z.object({ household_ref: ref }).loose().optional(),
  })
  .loose();

export const APPLICATION_STATES = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "INFO_REQUESTED",
  "SANCTIONED",
  "REJECTED",
  "ACCEPTED",
  "DISBURSED",
  "WITHDRAWN",
  "CANCELLED",
] as const;

export const ApplicationStatusChangedData = z
  .object({
    application_id: ref,
    seq: z.number().int().min(1),
    from: z.enum(APPLICATION_STATES),
    to: z.enum(APPLICATION_STATES),
    reason_code: code.optional(),
  })
  .loose()
  .refine((e) => e.from !== e.to, "from and to differ");

export const AdditionalInfoRequestedData = z
  .object({
    request_id: ref,
    application_id: ref,
    items: z
      .array(z.object({ item_code: code, note: z.string().max(500).optional() }).loose())
      .min(1)
      .max(50),
    due_date: date,
  })
  .loose();

export const DecisionMadeData = z
  .object({
    application_id: ref,
    decision_version: version,
    decision: z.enum(["SANCTIONED", "REJECTED"]),
    reason_codes: z.array(code).max(20),
    rule_version: z.string().min(1).max(64),
    offers: z.array(Offer).max(20),
  })
  .loose()
  .refine(
    (d) => d.decision === "SANCTIONED" || d.offers.length === 0,
    "offers only when SANCTIONED",
  );

export const KfsIssuedData = z
  .object({
    kfs_id: ref,
    version,
    application_id: ref,
    proposal_no: ref,
    validity_expiry: at,
    apr_bp: bp,
    document_sha256: sha256,
  })
  .loose();

export const SanctionLetterIssuedData = z
  .object({
    sanction_id: ref,
    version,
    application_id: ref,
    terms: z.object({ amount_paise: paise, tenor_months: tenor, apr_bp: bp }).loose(),
    document_sha256: sha256,
  })
  .loose();

export const BorrowerAcceptedData = z
  .object({
    kfs_id: ref,
    accepted_at: at,
    /** The borrower acknowledged the explanation of the KFS; never a bare default. */
    explanation_acknowledged: z.literal(true),
  })
  .loose();

// ---- §6.3 items of the journey -----------------------------------------------------------------

export const CoolingOffExitRequestedData = z
  .object({
    loan_id: ref,
    requested_at: at,
    evidence: z
      .object({
        sha256,
        uri: z
          .string()
          .max(2048)
          .regex(/^(https:\/\/|storage:)/),
      })
      .loose(),
  })
  .loose();

export const LOAN_DISBURSEMENT_KINDS = ["INITIAL", "TRANCHE", "DRAWDOWN"] as const;

export const LoanDisbursedData = z
  .object({
    loan_id: ref,
    utr: z.string().regex(/^[A-Z0-9]{12,22}$/),
    amount_paise: paise,
    value_date: date,
    beneficiary_type: code,
    kind: z.enum(LOAN_DISBURSEMENT_KINDS),
    cooling_off_end: at,
  })
  .loose();

// ---- The registry --------------------------------------------------------------------------------

export interface OriginationEventSpec {
  /** The Ecosystem type, `in.infrabyx.<domain>.<Event>.v1`. */
  type: string;
  schema: z.ZodType;
  /** The fields of the Specification's idempotency key, in its order. */
  idempotency: readonly string[];
  /** A regulated message (§3.6): it carries the detached JWS. */
  regulated: boolean;
  /** Producer → consumer (§6.2, §6.3). */
  direction: "LSP_TO_LENDER" | "LENDER_TO_LSP";
}

const spec = (
  domain: "origination" | "servicing",
  name: string,
  schema: z.ZodType,
  idempotency: readonly string[],
  direction: OriginationEventSpec["direction"],
): OriginationEventSpec => ({
  type: `in.infrabyx.${domain}.${name}.v1`,
  schema,
  idempotency,
  regulated: (REGULATED_MESSAGE_EVENTS as readonly string[]).includes(name),
  direction,
});

/** Every event of the loan journey this file defines, by its Specification name. */
export const ORIGINATION_EVENTS = Object.freeze({
  ApplicationSubmitted: spec(
    "origination",
    "ApplicationSubmitted",
    ApplicationSubmittedData,
    ["lsp_application_ref"],
    "LSP_TO_LENDER",
  ),
  ApplicationStatusChanged: spec(
    "origination",
    "ApplicationStatusChanged",
    ApplicationStatusChangedData,
    ["application_id", "seq"],
    "LENDER_TO_LSP",
  ),
  AdditionalInfoRequested: spec(
    "origination",
    "AdditionalInfoRequested",
    AdditionalInfoRequestedData,
    ["request_id"],
    "LENDER_TO_LSP",
  ),
  DecisionMade: spec(
    "origination",
    "DecisionMade",
    DecisionMadeData,
    ["application_id", "decision_version"],
    "LENDER_TO_LSP",
  ),
  KFSIssued: spec(
    "origination",
    "KFSIssued",
    KfsIssuedData,
    ["kfs_id", "version"],
    "LENDER_TO_LSP",
  ),
  SanctionLetterIssued: spec(
    "origination",
    "SanctionLetterIssued",
    SanctionLetterIssuedData,
    ["sanction_id", "version"],
    "LENDER_TO_LSP",
  ),
  BorrowerAccepted: spec(
    "origination",
    "BorrowerAccepted",
    BorrowerAcceptedData,
    ["kfs_id"],
    "LSP_TO_LENDER",
  ),
  CoolingOffExitRequested: spec(
    "servicing",
    "CoolingOffExitRequested",
    CoolingOffExitRequestedData,
    ["loan_id"],
    "LSP_TO_LENDER",
  ),
  LoanDisbursed: spec(
    "servicing",
    "LoanDisbursed",
    LoanDisbursedData,
    ["loan_id", "utr"],
    "LENDER_TO_LSP",
  ),
});
export type OriginationEventName = keyof typeof ORIGINATION_EVENTS;

/** The regulated messages among them (§3.6): `DecisionMade`, `KFSIssued`, `SanctionLetterIssued`, `LoanDisbursed`. */
export const ORIGINATION_REGULATED: readonly OriginationEventName[] = Object.freeze(
  (Object.keys(ORIGINATION_EVENTS) as OriginationEventName[]).filter(
    (n) => ORIGINATION_EVENTS[n].regulated,
  ),
);

/** The idempotency key of one event's data, as `field=value` pairs joined by `|`. */
export function originationIdempotencyKey(
  name: OriginationEventName,
  data: Record<string, unknown>,
): string {
  return ORIGINATION_EVENTS[name].idempotency.map((f) => `${f}=${String(data[f])}`).join("|");
}
