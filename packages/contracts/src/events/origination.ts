// The origination contract between an LSP (Udofin) and the lender (Finbyx), Ecosystem
// Specification §6.2 and the two §6.3 items of the loan journey (Udofin PR-UDF-051; R1-D-217;
// plan `docs/phases/R1-udofin-phase7-plan.md`). Field names are the Specification's key payload
// fields in snake case; unknown fields pass through, as for the other Ecosystem schemas, and are
// checked against the registry schemas when they are published ([VERIFY]).
//
// `EligibilityCheck` is a synchronous call, not an event pair: the Specification defines it as
// `POST /v1/eligibility-checks` with an `Idempotency-Key`, a budget of at most 3 s and "timeout =
// lender unavailable" (§6.2; Part 10.3). Six of the events are regulated messages (§3.6): they
// carry the detached JWS over the CloudEvent (`signRegulatedMessage` in @infrabyx/crypto). The
// eSign and eStamp evidence (`ESignCompleted`, `EStampCompleted`) joined in PR-UDF-053 (R1-D-219).
//
// Conventions: money in integer paise, rates in integer basis points, hashes as lower-case SHA-256
// hex, people by reference only (`applicant_ref`; never a name, PAN or Aadhaar number).
//
// PR-UDF-061 (owner, 20 Nov 2026 14:30; R1-D-232): Udofin's `udf_ext` v1 list as optional fields
// on these events, two-character product codes, and one new event, `CoolingOffExitAnswered` (the
// lender's answer to an exit request), proposed for the Specification in PR-047's draft.
//
// PR-UDF-061 items (12) to (17) (owner, 20 Nov 2026 18:50 IST; R1-D-236): PR-047 is approved, so
// `CoolingOffExitAnswered` is signed and the new `ExecutionPackIssued` (`ExecutionPackIssuedData` in
// `documents.ts`) joins the registry, signed; the KFS and the sanction letter name their file's
// version (`document_version`, beside `document_ref`); and every event names the data field that is
// its envelope `subject` (§3.2: the aggregate id; `seq` counts per subject): the lender's
// application for the origination events, the loan once it exists, and the LSP's own application
// reference for what the LSP sends before it holds the lender's id.
import { z } from "zod";
import { ExecutionPackIssuedData, indianState } from "./documents.js";
import { REGULATED_MESSAGE_EVENTS } from "./regulated.js";
import { lenderText, linkFreeText } from "./text.js";

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
/** A non-negative amount in integer paise (a charge, an income, a net amount). */
const paiseOrZero = z.number().int().min(0).max(1e14);
/** A tenor in days (R1-D-232): one day to fifty years. */
const tenorDays = z.number().int().min(1).max(18_300);

/**
 * A product code (R1-D-232; owner, 20 Nov 2026 14:30, item 2): the Udofin catalogue's pattern
 * `^[A-Z][A-Z0-9_]{1,15}$`, so two characters are enough (`PL`), or any reference the contract
 * already took (three to 128 of `[A-Za-z0-9_.:-]`). Nothing earlier is refused.
 */
export const PRODUCT_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,15}$/;
const productCode = z.union([z.string().regex(PRODUCT_CODE_PATTERN), ref]);

/** An `https` URL without credentials or a fragment, at most 2048 characters (R1-D-232). */
const httpsUrl = z
  .string()
  .max(2048)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" && !u.username && !u.password && !u.hash && !!u.hostname;
    } catch {
      return false;
    }
  }, "an https URL without credentials");

// ---- The offer (§6.2; R1-D-231 optional fields) --------------------------------------------------

/** How often `monthly_instalment` falls due (R1-D-231; the owner's list). */
export const INSTALMENT_FREQUENCIES = [
  "MONTHLY",
  "QUARTERLY",
  "HALF_YEARLY",
  "YEARLY",
  "BULLET",
  "OTHER",
] as const;

/**
 * The penal-charge bases the platform names (R1-D-231). `basis` is an open code, so a lender can
 * send another while this list is checked: [VERIFY] against the text of RBI's Penal Charges in
 * Loan Accounts directions.
 */
export const PENAL_CHARGE_BASES = [
  "PER_INSTANCE",
  "PER_MONTH_ON_OVERDUE",
  "FLAT",
  "OTHER",
] as const;

/** URI schemes a document reference must not start with: a KFS link is a reference, never a URL. */
const URL_SHAPED = /^(?:https?|ftps?|file|data|blob|javascript|mailto|s3|gs|storage|wss?):|^www\./i;

/** A document reference (the §6.13 `document_id` rule) that is not URL-shaped. */
const documentRef = ref.refine((v) => !URL_SHAPED.test(v), "a document reference, never a URL");

/**
 * A penal charge (RBI's Penal Charges in Loan Accounts directions): a charge, not penal interest,
 * and never capitalised. Exactly one of `rate_bp` (integer basis points) or `amount_paise`.
 * `basis` is a code such as `PER_INSTANCE`, `PER_MONTH_ON_OVERDUE`, `FLAT` or `OTHER`
 * (`PENAL_CHARGE_BASES`; [VERIFY] the list against the circular's text).
 */
export const PenalCharge = z
  .object({
    basis: code,
    rate_bp: bp.optional(),
    amount_paise: paise.optional(),
    description: z.string().min(1).max(200),
  })
  .loose()
  .refine(
    (c) => (c.rate_bp === undefined) !== (c.amount_paise === undefined),
    "exactly one of rate_bp or amount_paise",
  );
export type PenalCharge = z.infer<typeof PenalCharge>;

/**
 * One offer, shared by `EligibilityCheckAnswer.offers` and `DecisionMade.offers`. Optional
 * (owner, 20 Nov 2026 13:10; R1-D-231; PR-UDF-051), each in snake case for the owner's camel-case
 * names: `monthly_instalment` (`monthlyInstalment`: the instalment in integer paise and how often it
 * falls due), `penal_charges` (`penalCharges`: at most 20) and `kfs_link` (`kfsLink`: the KFS by
 * document reference, `document_id` and optional `version`; never a URL, and no other field).
 */
export const OriginationOffer = z
  .object({
    offer_id: ref,
    amount_paise: paise,
    tenor_months: tenor,
    apr_bp: bp,
    monthly_instalment: z
      .object({ amount_paise: paise, frequency: z.enum(INSTALMENT_FREQUENCIES) })
      .loose()
      .optional(),
    penal_charges: z.array(PenalCharge).max(20).optional(),
    kfs_link: z
      .object({ document_id: documentRef, version: version.optional() })
      .strict()
      .optional(),
    /**
     * R1-D-232 (PR-UDF-061, item 1; CF para 7(3)): the monthly instalment as one figure. When
     * `monthly_instalment` is also given, it is `MONTHLY` and the same amount.
     */
    monthly_instalment_paise: paise.optional(),
    /** R1-D-232: the lender's penal-charges text, as it stands in its terms (the list is `penal_charges`). */
    penal_charges_text: lenderText(2000).optional(),
    /** R1-D-232: the KFS at an `https` URL, beside or instead of the `kfs_link` reference. */
    kfs_url: httpsUrl.optional(),
  })
  .loose()
  .refine(
    (o) =>
      o.monthly_instalment === undefined ||
      o.monthly_instalment_paise === undefined ||
      (o.monthly_instalment.frequency === "MONTHLY" &&
        o.monthly_instalment.amount_paise === o.monthly_instalment_paise),
    "monthly_instalment_paise agrees with a MONTHLY monthly_instalment",
  );
export type OriginationOffer = z.infer<typeof OriginationOffer>;
const Offer = OriginationOffer;

// ---- EligibilityCheck (synchronous) ------------------------------------------------------------

/** The request body of `POST /v1/eligibility-checks`; the `Idempotency-Key` header is required. */
export const EligibilityCheckRequest = z
  .object({
    lsp_ref: ref,
    product_code: productCode,
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
    household: z
      .object({
        household_ref: ref,
        /** R1-D-232: the household's monthly income (microfinance assessment, MF Directions). */
        monthly_household_income_paise: paiseOrZero.optional(),
        /** R1-D-232: the loan is a microfinance loan. */
        is_microfinance: z.boolean().optional(),
      })
      .loose()
      .optional(),
    // ---- R1-D-232 (PR-UDF-061, item 3): all optional ----
    /** The offer the borrower chose (`offer_id` of an `EligibilityCheckAnswer` offer). */
    offer_ref: ref.optional(),
    product_code: productCode.optional(),
    /** What the borrower asked for. */
    request: z
      .object({ amount_paise: paise, tenor_days: tenorDays, purpose: code })
      .loose()
      .optional(),
    /** The primary applicant's economic profile (CF para 8): figures and codes, never a document. */
    economic_profile: z
      .object({
        age_years: z.number().int().min(18).max(120).optional(),
        occupation: code.optional(),
        monthly_income_paise: paiseOrZero.optional(),
        income_source: code.optional(),
      })
      .loose()
      .optional(),
    /** The KYC case at this lender: its level and state, by code. */
    kyc: z.object({ level: code, state: code }).loose().optional(),
    /** Which credit data the lender may use for this application. */
    credit_data_modes: z.object({ bureau: z.boolean(), aa: z.boolean() }).strict().optional(),
    /** Which consent artefact (one of `consents`) answers which purpose. */
    consent_purposes: z
      .array(z.object({ purpose: code, consent_ref: ref }).loose())
      .max(50)
      .optional(),
  })
  .loose()
  .refine(
    (a) => (a.consent_purposes ?? []).every((c) => a.consents.includes(c.consent_ref)),
    "every consent_purposes entry names one of consents",
  );

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
    /** R1-D-232 (item 7): the lender's words for the status, shown as they are. */
    status_text: lenderText(1000).optional(),
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
    /** R1-D-232 (item 8): the lender's words for each of `reason_codes`, at most one each. */
    reason_texts: z
      .array(z.object({ reason_code: code, text: lenderText(1000) }).loose())
      .max(20)
      .optional(),
  })
  .loose()
  .refine(
    (d) => d.decision === "SANCTIONED" || d.offers.length === 0,
    "offers only when SANCTIONED",
  )
  .refine((d) => {
    const codes = (d.reason_texts ?? []).map((t) => t.reason_code);
    return codes.every((c) => d.reason_codes.includes(c)) && new Set(codes).size === codes.length;
  }, "each reason text is for one of reason_codes, once");

// ---- The KFS's optional detail (R1-D-232; PR-UDF-061, item 9; RBI KFS format, Annex A) ----------

/** Who a KFS charge is paid to (Annex A, Part 1, item 8). */
export const KFS_CHARGE_PAYEES = ["RE", "THIRD_PARTY"] as const;
/** Whether a KFS charge is one-time or recurring (Annex A, Part 1, item 8). */
export const KFS_CHARGE_RECURRENCES = ["ONE_TIME", "RECURRING"] as const;
/** The roles of `lsp_recovery_agent` entries (Annex A, Part 2). */
export const KFS_AGENT_ROLES = ["LSP", "RECOVERY_AGENT"] as const;

/** One instalment of the KFS repayment schedule (Annex B). */
export const KfsInstalment = z
  .object({
    seq: z.number().int().min(1).max(18_300),
    due_date: date,
    amount_paise: paise,
    principal_paise: paiseOrZero.optional(),
    interest_paise: paiseOrZero.optional(),
  })
  .loose()
  .refine(
    (i) =>
      i.principal_paise === undefined ||
      i.interest_paise === undefined ||
      i.principal_paise + i.interest_paise === i.amount_paise,
    "principal and interest add up to the instalment",
  );
export type KfsInstalment = z.infer<typeof KfsInstalment>;

/** One fee or charge of the KFS (Annex A, Part 1, item 8); an amount, a rate, or neither ("at actuals"). */
export const KfsCharge = z
  .object({
    code,
    description: lenderText(200),
    amount_paise: paiseOrZero.optional(),
    rate_bp: bp.optional(),
    payable_to: z.enum(KFS_CHARGE_PAYEES).optional(),
    recurrence: z.enum(KFS_CHARGE_RECURRENCES).optional(),
  })
  .loose();
export type KfsCharge = z.infer<typeof KfsCharge>;

const phone = z.string().regex(/^\+?[0-9][0-9 -]{5,19}$/);

export const KfsIssuedData = z
  .object({
    kfs_id: ref,
    version,
    application_id: ref,
    proposal_no: ref,
    validity_expiry: at,
    apr_bp: bp,
    document_sha256: sha256,
    /**
     * Optional (owner, 20 Nov 2026; R1-D-229; PR-UDF-051 follow-up): the KFS "Loan amount" of the
     * RBI KFS format (Annex A, Part 1), in integer paise. It is the amount of the loan, not the net
     * disbursed amount (which is less any fees deducted upfront; `LoanDisbursed.amount_paise`). The
     * owner named it `loanAmount`; the Ecosystem payloads here are snake case (§3.2), so it travels
     * as `loan_amount_paise`.
     */
    loan_amount_paise: paise.optional(),
    // ---- R1-D-232 (PR-UDF-061, item 9): all optional, [VERIFY] against the RBI KFS format ----
    issued_at: at.optional(),
    /** The KFS's language, BCP 47 (`en`, `hi`, `mr-IN`). */
    language: z
      .string()
      .regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/)
      .optional(),
    /** The KFS document, by reference (`document_id` of its `DocumentShared`). */
    document_ref: documentRef.optional(),
    /**
     * R1-D-236 (PR-UDF-061 item 16): the `version` of that `DocumentShared`, so `document_ref` and
     * `document_version` name the exact file whose hash is `document_sha256`.
     */
    document_version: version.optional(),
    tenor_days: tenorDays.optional(),
    /** The cash flows: the net disbursed amount and the instalments, in order. */
    cash_flows: z
      .object({
        net_disbursed_paise: paiseOrZero,
        instalments: z.array(KfsInstalment).max(18_300),
      })
      .loose()
      .refine(
        (c) =>
          c.instalments.every(
            (x, i, a) => i === 0 || (x.seq > a[i - 1]!.seq && x.due_date >= a[i - 1]!.due_date),
          ),
        "instalments in order of seq and due date",
      )
      .optional(),
    charges: z.array(KfsCharge).max(50).optional(),
    cooling_off_days: z.number().int().min(0).max(365).optional(),
    /** The terms of exit in the cooling-off period (CF para 11), the lender's words. */
    exit_terms: lenderText(2000).optional(),
    /** The nodal grievance redressal officer (Annex A, Part 2): the RE's published contact. */
    nodal_gro: z
      .object({
        name: lenderText(200),
        designation: lenderText(200).optional(),
        phone: phone.optional(),
        email: z.email().max(254).optional(),
        address: lenderText(500).optional(),
      })
      .loose()
      .optional(),
    /** A co-lent loan (Annex A, Part 2): the parties, their shares adding up to 100 %, and the blended rate. */
    co_lending: z
      .object({
        parties: z
          .array(
            z
              .object({
                name: lenderText(200),
                share_bp: z.number().int().min(1).max(10_000),
                rate_bp: bp.optional(),
              })
              .loose(),
          )
          .min(2)
          .max(5),
        blended_rate_bp: bp.optional(),
      })
      .loose()
      .refine(
        (c) => c.parties.reduce((t, p) => t + p.share_bp, 0) === 10_000,
        "shares add up to 10000 bp",
      )
      .optional(),
    /** The LSPs and recovery agents engaged (Annex A, Part 2), each with its role and functions. */
    lsp_recovery_agent: z
      .array(
        z
          .object({
            role: z.enum(KFS_AGENT_ROLES),
            name: lenderText(200),
            functions: lenderText(500).optional(),
            contact: lenderText(200).optional(),
          })
          .loose(),
      )
      .max(20)
      .optional(),
  })
  .loose()
  .refine(
    (k) =>
      k.cash_flows === undefined ||
      k.loan_amount_paise === undefined ||
      k.cash_flows.net_disbursed_paise <= k.loan_amount_paise,
    "the net disbursed amount is at most the loan amount",
  );

export const SanctionLetterIssuedData = z
  .object({
    sanction_id: ref,
    version,
    application_id: ref,
    terms: z.object({ amount_paise: paise, tenor_months: tenor, apr_bp: bp }).loose(),
    document_sha256: sha256,
    /** R1-D-232 (item 10): the sanction letter, by reference (`document_id` of its `DocumentShared`). */
    document_ref: documentRef.optional(),
    /** R1-D-236 (item 16): the `version` of that `DocumentShared` (the file `document_sha256` hashes). */
    document_version: version.optional(),
  })
  .loose();

export const BorrowerAcceptedData = z
  .object({
    kfs_id: ref,
    accepted_at: at,
    /** The borrower acknowledged the explanation of the KFS; never a bare default. */
    explanation_acknowledged: z.literal(true),
    // ---- R1-D-232 (PR-UDF-061, item 4): all optional ----
    lsp_application_ref: ref.optional(),
    /** The KFS version and hash the borrower saw: the lender refuses a mismatch. */
    kfs_version: version.optional(),
    kfs_sha256: sha256.optional(),
    /** When the borrower acknowledged the explanation; not after `accepted_at`. */
    acknowledged_at: at.optional(),
    /** The device the borrower accepted on, by the LSP's reference (never a device identifier). */
    device_ref: ref.optional(),
  })
  .loose()
  .refine(
    (b) =>
      b.acknowledged_at === undefined || Date.parse(b.acknowledged_at) <= Date.parse(b.accepted_at),
    "acknowledged no later than accepted",
  );

// ---- §6.2 execution evidence (PR-UDF-053; R1-D-219) ---------------------------------------------

export const ESIGN_METHODS = ["AADHAAR_OTP", "AADHAAR_BIOMETRIC", "DSC"] as const;

/** `ESignCompleted` (UD → FX, signed): the ESP's confirmation, "never a bare flag" (§6.2). */
export const ESignCompletedData = z
  .object({
    document_id: ref,
    esp_txn_id: z.string().regex(/^[A-Za-z0-9_.:/-]{3,128}$/),
    /** The eSign Service Provider, by code (`NSDL`, `CDAC`, …). */
    esp: code,
    signer_ref: ref,
    signing_method: z.enum(ESIGN_METHODS),
    signed_at: at,
    /** SHA-256 of the signed document as returned by the ESP. */
    signed_sha256: sha256,
    certificate: z
      .object({
        serial_no: z.string().regex(/^[0-9A-Fa-f:]{1,128}$/),
        issuer: z.string().min(1).max(512),
        not_before: at,
        not_after: at,
        /** SHA-256 of the signer certificate's DER. */
        sha256,
      })
      .loose(),
    application_id: ref.optional(),
  })
  .loose()
  .refine(
    (e) =>
      Date.parse(e.certificate.not_before) <= Date.parse(e.signed_at) &&
      Date.parse(e.signed_at) <= Date.parse(e.certificate.not_after),
    "signed within the certificate's validity",
  );

export const ESTAMP_MODES = ["E_STAMP", "FRANKING", "PHYSICAL_PAPER"] as const;

/** `EStampCompleted` (UD → FX, signed): the stamp certificate issued for a document (§6.2). */
export const EStampCompletedData = z
  .object({
    document_id: ref,
    certificate_no: z.string().regex(/^[A-Za-z0-9/_.-]{3,64}$/),
    /** The State or Union Territory whose stamp law applies, ISO 3166-2:IN. */
    state: indianState,
    duty_paise: z.number().int().min(0).max(1e12),
    article: z.string().min(1).max(64).optional(),
    issued_at: at,
    stamp_mode: z.enum(ESTAMP_MODES),
    stamp_verification_method: code.optional(),
    application_id: ref.optional(),
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
    /** R1-D-232 (item 5). */
    lsp_application_ref: ref.optional(),
  })
  .loose();

/**
 * `CoolingOffExitAnswered` (FX → UD, signed; R1-D-232, PR-UDF-061 item 6; PR-047 §5, approved by
 * the owner on 20 Nov 2026, so a regulated message from this minor, R1-D-236): the lender's answer to `CoolingOffExitRequested`, with the amount to repay
 * (principal and proportionate APR, CF para 11), how to pay it in the lender's words, the lender's
 * exit reference and the time. The instruction is plain text with no link; a product shows it as the
 * lender's words and never routes the payment through an account of its own (CF para 10).
 */
export const CoolingOffExitAnsweredData = z
  .object({
    loan_id: ref,
    exit_ref: ref,
    exit_amount_paise: paiseOrZero,
    payment_instruction: linkFreeText(1000),
    answered_at: at,
    lsp_application_ref: ref.optional(),
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
    /** R1-D-232 (item 11): the lender's application id, and the exact time of disbursal. */
    application_id: ref.optional(),
    disbursed_at: at.optional(),
    /**
     * R1-D-256 (PR-UDF-061 finding (i)): the LSP's own application reference, as on
     * `CoolingOffExitAnswered`, so an LSP can tell which application was disbursed. A lender sends
     * `application_id`, this, or both (the mock lender sends both); the schema does not require
     * either, because `application_id` was optional before and a hard rule would refuse a payload
     * valid then (a minor). The lender contract cases require at least one, each naming the
     * application. The envelope subject stays `loan_id` (R1-D-236).
     */
    lsp_application_ref: ref.optional(),
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
  /**
   * The data field whose value is the envelope's `subject` (§3.2: "aggregate id; ordering and
   * partition key"; `seq` is "per-subject"; R1-D-236): the aggregate the event belongs to, so one
   * application's lifecycle is one ordered stream: `application_id` for the origination events that
   * carry it, `lsp_application_ref` (the LSP's own aggregate) for what the LSP sends before it holds
   * the lender's id, `loan_id` once a loan exists. Optional in this interface so a spec built before
   * it stays valid; every entry of `ORIGINATION_EVENTS` has it.
   */
  subject?: string;
  /**
   * The fields tried in order when `subject`'s field is absent from an event's data, because the
   * Specification makes it optional there (R1-D-236): `BorrowerAccepted` without
   * `lsp_application_ref` falls back to `kfs_id`; `ESignCompleted` and `EStampCompleted` without
   * `application_id` fall back to `document_id`.
   */
  subjectFallback?: readonly string[];
}

const spec = (
  domain: "origination" | "servicing",
  name: string,
  schema: z.ZodType,
  idempotency: readonly string[],
  direction: OriginationEventSpec["direction"],
  subject: string,
  subjectFallback: readonly string[] = [],
): OriginationEventSpec & { subject: string; subjectFallback: readonly string[] } => ({
  type: `in.infrabyx.${domain}.${name}.v1`,
  schema,
  idempotency,
  regulated: (REGULATED_MESSAGE_EVENTS as readonly string[]).includes(name),
  direction,
  subject,
  subjectFallback,
});

/** Every event of the loan journey this file defines, by its Specification name. */
export const ORIGINATION_EVENTS = Object.freeze({
  ApplicationSubmitted: spec(
    "origination",
    "ApplicationSubmitted",
    ApplicationSubmittedData,
    ["lsp_application_ref"],
    "LSP_TO_LENDER",
    // Before the lender assigns an application id: the LSP's own aggregate.
    "lsp_application_ref",
  ),
  ApplicationStatusChanged: spec(
    "origination",
    "ApplicationStatusChanged",
    ApplicationStatusChangedData,
    ["application_id", "seq"],
    "LENDER_TO_LSP",
    "application_id",
  ),
  AdditionalInfoRequested: spec(
    "origination",
    "AdditionalInfoRequested",
    AdditionalInfoRequestedData,
    ["request_id"],
    "LENDER_TO_LSP",
    "application_id",
  ),
  DecisionMade: spec(
    "origination",
    "DecisionMade",
    DecisionMadeData,
    ["application_id", "decision_version"],
    "LENDER_TO_LSP",
    "application_id",
  ),
  KFSIssued: spec(
    "origination",
    "KFSIssued",
    KfsIssuedData,
    ["kfs_id", "version"],
    "LENDER_TO_LSP",
    "application_id",
  ),
  SanctionLetterIssued: spec(
    "origination",
    "SanctionLetterIssued",
    SanctionLetterIssuedData,
    ["sanction_id", "version"],
    "LENDER_TO_LSP",
    "application_id",
  ),
  ExecutionPackIssued: spec(
    "origination",
    "ExecutionPackIssued",
    ExecutionPackIssuedData,
    ["pack_id", "version"],
    "LENDER_TO_LSP",
    "application_id",
  ),
  BorrowerAccepted: spec(
    "origination",
    "BorrowerAccepted",
    BorrowerAcceptedData,
    ["kfs_id"],
    "LSP_TO_LENDER",
    // It carries no `application_id`: the LSP's own aggregate when sent, else the KFS it accepts.
    "lsp_application_ref",
    ["kfs_id"],
  ),
  ESignCompleted: spec(
    "origination",
    "ESignCompleted",
    ESignCompletedData,
    ["document_id", "esp_txn_id"],
    "LSP_TO_LENDER",
    // `application_id` is optional here: without it, the document it evidences.
    "application_id",
    ["document_id"],
  ),
  EStampCompleted: spec(
    "origination",
    "EStampCompleted",
    EStampCompletedData,
    ["document_id", "certificate_no"],
    "LSP_TO_LENDER",
    "application_id",
    ["document_id"],
  ),
  CoolingOffExitRequested: spec(
    "servicing",
    "CoolingOffExitRequested",
    CoolingOffExitRequestedData,
    ["loan_id"],
    "LSP_TO_LENDER",
    "loan_id",
  ),
  CoolingOffExitAnswered: spec(
    "servicing",
    "CoolingOffExitAnswered",
    CoolingOffExitAnsweredData,
    ["loan_id", "exit_ref"],
    "LENDER_TO_LSP",
    "loan_id",
  ),
  LoanDisbursed: spec(
    "servicing",
    "LoanDisbursed",
    LoanDisbursedData,
    ["loan_id", "utr"],
    "LENDER_TO_LSP",
    "loan_id",
  ),
});
export type OriginationEventName = keyof typeof ORIGINATION_EVENTS;

/**
 * The regulated messages among them (§3.6): `DecisionMade`, `KFSIssued`, `SanctionLetterIssued`,
 * `ESignCompleted`, `EStampCompleted` and `LoanDisbursed`, and from v1.6 (PR-047, R1-D-236)
 * `ExecutionPackIssued` and `CoolingOffExitAnswered`.
 */
export const ORIGINATION_REGULATED: readonly OriginationEventName[] = Object.freeze(
  (Object.keys(ORIGINATION_EVENTS) as OriginationEventName[]).filter(
    (n) => ORIGINATION_EVENTS[n].regulated,
  ),
);

/**
 * The envelope `subject` of one event's data (§3.2: the aggregate id; R1-D-236, PR-UDF-061 item 15):
 * the value of its spec's `subject` field, or of the first `subjectFallback` field present: the
 * application id of `DecisionMade`, `KFSIssued`, `SanctionLetterIssued` or `ExecutionPackIssued`,
 * the LSP's application reference of `ApplicationSubmitted`, the loan id of `LoanDisbursed`. A
 * producer counts `seq` per subject from 1, so one application's events form one ordered stream.
 */
export function originationSubject(
  name: OriginationEventName,
  data: Record<string, unknown>,
): string {
  const s = ORIGINATION_EVENTS[name];
  for (const f of [s.subject, ...s.subjectFallback]) {
    const v = data[f];
    if (typeof v === "string" && v.length > 0) return v;
  }
  throw new Error(
    `${name} has no ${[s.subject, ...s.subjectFallback].join(" or ")} for its subject`,
  );
}

/** The idempotency key of one event's data, as `field=value` pairs joined by `|`. */
export function originationIdempotencyKey(
  name: OriginationEventName,
  data: Record<string, unknown>,
): string {
  return ORIGINATION_EVENTS[name].idempotency.map((f) => `${f}=${String(data[f])}`).join("|");
}
