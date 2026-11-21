// Documents by reference (Ecosystem Specification §6.13, §3.6) and the lender execution-pack
// manifest (Udofin PR-UDF-053; R1-D-219; plan `docs/phases/R1-udofin-phase8-plan.md`).
//
// A document travels by reference (`document_id`, `version`, `sha256`) with a detached JWS for
// transfer integrity (`signDocumentJws` in @infrabyx/crypto); the bytes are fetched from the
// producer through `GET /v1/documents/{id}`, which answers a signed India-hosted URL valid at most
// 15 minutes. The execution-pack manifest is not named by the Specification: until the owner adopts
// a carrier (platform request PR-047 proposes `ExecutionPackIssued`), it is shared as a document of
// type `EXECUTION_PACK_MANIFEST` whose bytes are the JCS form of the manifest.
//
// PR-UDF-061 items (12) and (13) (R1-D-236): the owner approved PR-047 on 20 Nov 2026, so the pack
// now travels as the signed §6.2 event `ExecutionPackIssued` (`ExecutionPackIssuedData` below, with
// the accepted KFS, instrument and enclosure codes, the WD covenant, the RBC enclosure list, the
// per-document stamp evidence, the not-stampable list and the signer roles as an enum);
// `ExecutionPackManifest` stays as the interim carrier, changed only by optional additions.
// `DocumentShared` takes an optional `language`, and the document JWS may sign a v2 descriptor that
// also binds the type, media type, size and application (`signDocumentJwsV2` in @infrabyx/crypto),
// whose fields `DocumentRetrieval` now carries too.
//
// PR-UDF-061 item 18 (R1-D-252): each pack document, in both carriers, may say why it needs a
// physical step (`physical_reason`) and carry the lender's plain-text instructions
// (`re_instructions`); a document with a physical reason is executed `WET_INK`.
//
// PR-UDF-075 (R1-D-258): optional `estamp_system` on both carriers' stamp evidence (only with an
// e-stamp), optional reason codes on not-stampable entries, the accepted forms of
// `page_or_clause_ref` with optional structured `page` and `clause_ref` beside it (agreeing with it
// where both can be read), and the rule for `certificate_document_id` stated.
import { z } from "zod";
import type { EstampCertificate } from "../ports/estamp.js";
import { linkFreeText } from "./text.js";

/** The schema version every type below starts at (the envelope's `schemaver`). */
export const DOCUMENTS_SCHEMA_VERSION = "1.0.0";
/** The retrieval call (§6.13); `{id}` is the `document_id`. */
export const DOCUMENT_GET_PATH = "/v1/documents/{id}";
/** The longest a retrieval URL may live (§6.13: "valid ≤ 15 min"). */
export const DOCUMENT_URL_MAX_TTL_SECONDS = 900;
/** The retrieval budget (§6.13: p95 ≤ 800 ms). */
export const DOCUMENT_GET_P95_MS = 800;
/** The `DocumentShared.type` of an execution-pack manifest (until PR-047 is decided). */
export const EXECUTION_PACK_MANIFEST_TYPE = "EXECUTION_PACK_MANIFEST";

const ref = z.string().regex(/^[A-Za-z0-9_.:-]{3,128}$/);
const code = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const at = z.iso.datetime({ offset: true });
const version = z.number().int().min(1);
/** A document's language, BCP 47 as the KFS's (`en`, `hi`, `mr-IN`). */
const language = z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/);
const mediaType = z
  .string()
  .regex(/^[a-z]+\/[a-z0-9.+-]+$/)
  .max(127);
const sizeBytes = z.number().int().min(0).max(5e9);
/** A compact detached JWS: `<header>..<signature>` (RFC 7515 Appendix F), at most 1,024 octets. */
const detachedJws = z
  .string()
  .max(1024)
  .regex(/^[A-Za-z0-9_-]+\.\.[A-Za-z0-9_-]+$/);

// ---- §6.13 DocumentShared ----------------------------------------------------------------------

export const DocumentSharedData = z
  .object({
    document_id: ref,
    version,
    /** The document type, by code (`KFS`, `SANCTION_LETTER`, `LOAN_AGREEMENT`, …). */
    type: code,
    sha256,
    /**
     * The producer's detached document JWS. v1 (`ipb-document+jws`, R1-D-228) signs
     * `{ document_id, version, sha256 }`; v2 (`ipb-document-v2+jws`, R1-D-236) also binds `type`,
     * `media_type`, `size_bytes` and, when present, `application_id`, so a consumer that verifies
     * it against this event knows none of them was changed on the way. `verifyDocumentJws` takes
     * both; a v2 JWS needs `media_type` and `size_bytes` here.
     */
    jws: detachedJws,
    retention_class: code,
    legal_hold: z.boolean(),
    media_type: mediaType.optional(),
    size_bytes: sizeBytes.optional(),
    /**
     * The lender's application the document belongs to. Present on every document of a loan
     * application (the KFS, the sanction letter, the execution pack and its documents): a consumer
     * files a document by it. It may be omitted only for a document not tied to one application,
     * such as a producer's general policy or a tenant-wide notice (R1-D-236, PR-UDF-061 item 13).
     */
    application_id: ref.optional(),
    /** Optional (R1-D-236): the document's language, BCP 47 (`en`, `hi`, `mr-IN`). */
    language: language.optional(),
  })
  .loose();
export type DocumentSharedData = z.infer<typeof DocumentSharedData>;

/** Every event this file defines, with its Ecosystem type and the Specification's idempotency fields. */
export const DOCUMENT_EVENTS = Object.freeze({
  DocumentShared: {
    type: "in.infrabyx.documents.DocumentShared.v1",
    schema: DocumentSharedData,
    idempotency: ["document_id", "version"] as readonly string[],
    regulated: false,
    /** The data field that is the envelope's `subject` (§3.2: the aggregate id; R1-D-236). */
    subject: "document_id",
  },
});

// ---- §6.13 GET /v1/documents/{id} ---------------------------------------------------------------

/** The answer of `GET /v1/documents/{id}`: a signed India-hosted URL valid at most 15 minutes. */
export const DocumentRetrieval = z
  .object({
    document_id: ref,
    version,
    sha256,
    jws: detachedJws,
    url: z.url({ protocol: /^https$/ }).max(4096),
    issued_at: at,
    url_expires_at: at,
    /** Where the bytes are hosted (§6.13 "India-hosted"). */
    data_residency: z.literal("IN"),
    /**
     * Optional (R1-D-236, PR-UDF-061 item 13): the document's media type, size, type and
     * application, as its `DocumentShared` gives them. A v2 document JWS signs them, so the
     * answer verifies on its own (`verifyDocumentJws(r.jws, r, keys)`) and the consumer checks the
     * downloaded bytes' length against `size_bytes` as well as their hash against `sha256`.
     */
    media_type: mediaType.optional(),
    size_bytes: sizeBytes.optional(),
    type: code.optional(),
    application_id: ref.optional(),
  })
  .loose()
  .refine((r) => {
    const ttl = Date.parse(r.url_expires_at) - Date.parse(r.issued_at);
    return ttl > 0 && ttl <= DOCUMENT_URL_MAX_TTL_SECONDS * 1000;
  }, `the URL lives more than 0 and at most ${DOCUMENT_URL_MAX_TTL_SECONDS} s`);
export type DocumentRetrieval = z.infer<typeof DocumentRetrieval>;

// ---- The lender execution-pack manifest (PR-UDF-053; proposal PR-047) --------------------------

export const EXECUTION_MODES = ["ESIGN_AADHAAR", "ESIGN_DSC", "WET_INK", "NONE"] as const;
export const STAMP_MODES = ["E_STAMP", "FRANKING", "PHYSICAL_PAPER"] as const;
/**
 * Why a pack document needs a physical step outside the eSign flow (PR-UDF-061 item 18; R1-D-252):
 * it is to be registered (Registration Act, 1908) or notarised (Notaries Act, 1952). A document with
 * either is executed `WET_INK`; the field is optional, and a document without it is unaffected.
 */
export const PACK_PHYSICAL_REASONS = ["REGISTRATION_REQUIRED", "NOTARISATION_REQUIRED"] as const;
/** The longest `re_instructions` a pack document carries, in characters (R1-D-252). */
export const PACK_RE_INSTRUCTIONS_MAX = 1000;
/**
 * The two optional per-document fields of PR-UDF-061 item 18 (R1-D-252), the same in
 * `ExecutionPackManifest` and `ExecutionPackIssuedData`: `physical_reason` (a
 * `PACK_PHYSICAL_REASONS` code) and `re_instructions`, the lender's instructions for the document
 * in its own words: plain text of 1 to 1,000 characters, no control character other than tab and
 * line breaks, and no link (R1-D-232's rule for `CoolingOffExitAnswered.payment_instruction`).
 */
const physicalFields = {
  physical_reason: z.enum(PACK_PHYSICAL_REASONS).optional(),
  re_instructions: linkFreeText(PACK_RE_INSTRUCTIONS_MAX).optional(),
};
/** R1-D-252: a document that needs registration or notarisation is executed in wet ink. */
const physicalIssue = (d: {
  document_id: string;
  execution_mode: string;
  physical_reason?: string | undefined;
}): string | undefined =>
  d.physical_reason !== undefined && d.execution_mode !== "WET_INK"
    ? `${d.document_id} needs ${d.physical_reason === "REGISTRATION_REQUIRED" ? "registration" : "notarisation"}: it is executed WET_INK`
    : undefined;
/** An Indian State or Union Territory, ISO 3166-2:IN (`IN-MH`, `IN-DL`, …). */
export const indianState = z.string().regex(/^IN-[A-Z]{2}$/);
/**
 * The modes of a document's `stamp_evidence` (owner, 20 Nov 2026 13:10; R1-D-231; the owner's
 * names). The pack-level `stamp.mode` keeps `STAMP_MODES`; `STAMP_EVIDENCE_MODE_OF` maps one to the
 * other (`E_STAMP` ↔ `ESTAMP`, `PHYSICAL_PAPER` ↔ `PAPER`, `FRANKING` ↔ `FRANKING`).
 */
export const STAMP_EVIDENCE_MODES = ["ESTAMP", "PAPER", "FRANKING"] as const;
export const STAMP_EVIDENCE_MODE_OF: Readonly<
  Record<(typeof STAMP_MODES)[number], (typeof STAMP_EVIDENCE_MODES)[number]>
> = Object.freeze({ E_STAMP: "ESTAMP", PHYSICAL_PAPER: "PAPER", FRANKING: "FRANKING" });

/**
 * The system an e-stamp certificate was issued through (PR-UDF-075 (1); R1-D-258): `SHCIL` (Stock
 * Holding Corporation of India, the Central Record Keeping Agency), `STATE_PORTAL` (a State's own
 * e-stamp portal), `NESL_DDE` (NeSL's Digital Document Execution) and `GRAS` (Maharashtra's
 * Government Receipt Accounting System, e-SBTR). Optional on the stamp evidence of both carriers,
 * and only with an e-stamp (`channel: E_STAMP`, `mode: ESTAMP`): franking and stamp paper are not
 * issued through one. Any other value is refused.
 */
export const ESTAMP_SYSTEMS = ["SHCIL", "STATE_PORTAL", "NESL_DDE", "GRAS"] as const;
const estampSystemIssue = "an estamp_system is given only with an e-stamp";

/**
 * Why a pack document needs no stamp, by code (PR-UDF-075 (2); R1-D-258): `NOT_AN_INSTRUMENT` (a
 * disclosure, a notice or a policy, not an instrument chargeable with duty), `ACKNOWLEDGEMENT` (an
 * acknowledgement the State's stamp law does not charge or exempts) or `OTHER`. Optional beside the
 * free-text reason, which stays required for every code, so `OTHER` always carries one.
 */
export const NOT_STAMPABLE_REASON_CODES = [
  "NOT_AN_INSTRUMENT",
  "ACKNOWLEDGEMENT",
  "OTHER",
] as const;

// The forms of `page_or_clause_ref` the platform reads (PR-UDF-075 (3); R1-D-258); see
// `parsePageOrClauseRef`.
const PAGE_FORM = String.raw`(?:p|pg|page)\.?\s*(\d{1,4})`;
const CLAUSE_TOKEN = String.raw`[0-9a-z]+(?:\.[0-9a-z]+)*(?:\([0-9a-z]+\))*`;
const CLAUSE_FORM = String.raw`(?:cl|clause)\.?\s*(${CLAUSE_TOKEN})`;
const SEP = String.raw`\s*[,;/]?\s*`;
const PAGE_THEN_CLAUSE = new RegExp(String.raw`^\s*${PAGE_FORM}(?:${SEP}${CLAUSE_FORM})?\s*$`, "i");
const CLAUSE_THEN_PAGE = new RegExp(String.raw`^\s*${CLAUSE_FORM}(?:${SEP}${PAGE_FORM})?\s*$`, "i");
/** A structured `clause_ref` (R1-D-258): `4`, `4.2`, `4.2(a)`, `9A.1(ii)`, without `cl.`. */
const clauseRef = z
  .string()
  .max(64)
  .regex(new RegExp(String.raw`^${CLAUSE_TOKEN}$`, "i"));
const pageNumber = z.number().int().min(1).max(2000);

/**
 * Reads a `page_or_clause_ref` (PR-UDF-075 (3); R1-D-258). The forms read, case-insensitive and
 * with optional spaces: a page (`p.3`, `p 3`, `pg.3`, `page 3`), a clause (`cl.4.2`, `cl 4.2(a)`,
 * `clause 4.2`), or both, either first, separated by a space, `,`, `;` or `/` (`p.3 cl.4.2`,
 * `cl.4.2, p.3`). A page is 1 to 2000; a clause is digit or letter groups separated by dots, with
 * optional bracketed sub-items (`4`, `4.2`, `4.2(a)`, `9A.1(ii)`). Answers the page and the clause
 * (lower-cased, without its prefix), or `undefined` for any other text, which the schema still
 * accepts (1 to 64 characters, as before) and does not read.
 */
export function parsePageOrClauseRef(ref: string): { page?: number; clause?: string } | undefined {
  const a = PAGE_THEN_CLAUSE.exec(ref);
  const b = a ? null : CLAUSE_THEN_PAGE.exec(ref);
  if (!a && !b) return undefined;
  const pageText = a ? a[1] : b?.[2];
  const clause = a ? a[2] : b?.[1];
  const n = pageText === undefined ? undefined : Number(pageText);
  if (n !== undefined && (n < 1 || n > 2000)) return undefined;
  return {
    ...(n !== undefined ? { page: n } : {}),
    ...(clause !== undefined ? { clause: clause.toLowerCase() } : {}),
  };
}

/**
 * Where a pack document states the amount to be disbursed (R1-D-229), the same in both carriers:
 * `document_id` names a pack document, `page_or_clause_ref` locates the statement (the forms
 * `parsePageOrClauseRef` reads, or free text) and `amount_stated_paise` is integer paise. Optional
 * (R1-D-258): `page` and `clause_ref`, the same locator split; `page_or_clause_ref` stays required.
 * When `page_or_clause_ref` names a page or a clause in a form read, a `page` or `clause_ref` given
 * beside it must name the same one (clauses compared ignoring case); free text is not compared.
 */
const DisbursementClause = z
  .object({
    document_id: ref,
    page_or_clause_ref: z.string().min(1).max(64),
    amount_stated_paise: z.number().int().min(0).max(1e14),
    page: pageNumber.optional(),
    clause_ref: clauseRef.optional(),
  })
  .loose()
  .superRefine((c, ctx) => {
    if (c.page === undefined && c.clause_ref === undefined) return;
    const read = parsePageOrClauseRef(c.page_or_clause_ref);
    if (c.page !== undefined && read?.page !== undefined && read.page !== c.page)
      ctx.addIssue({
        code: "custom",
        path: ["page"],
        message: `page ${c.page} is not the page of page_or_clause_ref`,
      });
    if (
      c.clause_ref !== undefined &&
      read?.clause !== undefined &&
      read.clause !== c.clause_ref.toLowerCase()
    )
      ctx.addIssue({
        code: "custom",
        path: ["clause_ref"],
        message: `clause_ref ${c.clause_ref} is not the clause of page_or_clause_ref`,
      });
  });

/**
 * Evidence that one pack document was stamped (R1-D-231; PR-UDF-053; the owner's `stampEvidence`):
 * the mode, the State whose stamp law applies, the certificate number, the duty in integer paise,
 * the SHA-256 of the stamped document and, optionally, the stamp vendor's reference.
 */
export const StampEvidence = z
  .object({
    mode: z.enum(STAMP_EVIDENCE_MODES),
    state: indianState,
    certificate_number: z.string().regex(/^[A-Za-z0-9/_.-]{3,64}$/),
    duty_paise: z.number().int().min(0).max(1e12),
    stamped_document_sha256: sha256,
    vendor_ref: ref.optional(),
    /** Optional (R1-D-258): the `ESTAMP_SYSTEMS` system, only with `mode: ESTAMP`. */
    estamp_system: z.enum(ESTAMP_SYSTEMS).optional(),
  })
  .loose()
  .refine((e) => e.estamp_system === undefined || e.mode === "ESTAMP", {
    message: estampSystemIssue,
    path: ["estamp_system"],
  });
export type StampEvidence = z.infer<typeof StampEvidence>;

/**
 * The interim execution-pack manifest (PR-UDF-053), shared as a `DocumentShared` of type
 * `EXECUTION_PACK_MANIFEST`. Deprecated in favour of the signed `ExecutionPackIssued` event
 * (`ExecutionPackIssuedData`; PR-047 approved 20 Nov 2026, R1-D-236), which carries the full
 * PR-UDF-061 shape; kept so existing consumers still parse it (changed only by optional additions,
 * such as item 18's `physical_reason` and `re_instructions`, R1-D-252), and removed only in a major.
 */
export const ExecutionPackManifest = z
  .object({
    pack_id: ref,
    version,
    application_id: ref,
    kfs_id: ref,
    sanction_id: ref.optional(),
    documents: z
      .array(
        z
          .object({
            document_id: ref,
            version,
            /** `LOAN_AGREEMENT`, `KFS`, `SANCTION_LETTER`, `SCHEDULE`, `DPN`, `GUARANTEE`, … */
            kind: code,
            sha256,
            execution_mode: z.enum(EXECUTION_MODES),
            stamp_required: z.boolean(),
            /** Who signs, by role (`BORROWER`, `CO_APPLICANT`, `GUARANTOR`, `LENDER`). */
            signers: z.array(code).max(10),
            /** Optional (R1-D-231): the stamp evidence of this document; never with `not_stampable`. */
            stamp_evidence: StampEvidence.optional(),
            /**
             * Optional (R1-D-231; the owner's `notStampable`): the document needs no stamp. When
             * true, `not_stampable_reason` (1–200 characters) says why, and `stamp_required` is false.
             */
            not_stampable: z.boolean().optional(),
            not_stampable_reason: z.string().min(1).max(200).optional(),
            /** Optional (R1-D-258): the reason by code; only with `not_stampable: true`. */
            not_stampable_reason_code: z.enum(NOT_STAMPABLE_REASON_CODES).optional(),
            /** Optional (R1-D-252): `physical_reason` and `re_instructions`; see `physicalFields`. */
            ...physicalFields,
          })
          .loose(),
      )
      .min(1)
      .max(50),
    stamp: z
      .object({
        state: indianState,
        article: z.string().min(1).max(64),
        duty_paise: z.number().int().min(0).max(1e12),
        mode: z.enum(STAMP_MODES),
        payer: z.enum(["BORROWER", "LENDER"]),
      })
      .loose()
      .optional(),
    /** The page of the loan agreement that carries the KFS summary box. */
    summary_box: z.object({ document_id: ref, page: z.number().int().min(1).max(2000) }).loose(),
    /** The borrower's covenant declaration the pack relies on. */
    covenant_declaration: z.object({ document_id: ref, sha256 }).loose(),
    countersignature: z
      .object({
        required: z.boolean(),
        by: z.enum(["LENDER"]).optional(),
        order: z.enum(["AFTER_BORROWER", "BEFORE_BORROWER"]).optional(),
        within_days: z.number().int().min(1).max(90).optional(),
      })
      .loose()
      .refine(
        (c) => !c.required || (c.by !== undefined && c.order !== undefined),
        "a required countersignature names `by` and `order`",
      ),
    /**
     * Optional (owner, 20 Nov 2026; R1-D-229; PR-UDF-053 follow-up): where a pack document states
     * the amount to be disbursed, so a product can compare it with `LoanDisbursed.amount_paise`.
     * `document_id` names a document in the pack; `page_or_clause_ref` is a short locator such as
     * `p.3` or `cl.4.2`; `amount_stated_paise` is integer paise. The owner named it
     * `disbursementClause { documentId, pageOrClauseRef, amountStated }`; the Ecosystem payloads
     * here are snake case (§3.2). Optional `page` and `clause_ref` (R1-D-258): see
     * `DisbursementClause`.
     */
    disbursement_clause: DisbursementClause.optional(),
  })
  .loose()
  .superRefine((m, ctx) => {
    const ids = new Set<string>();
    for (const [i, d] of m.documents.entries()) {
      if (ids.has(d.document_id))
        ctx.addIssue({ code: "custom", message: `duplicate document ${d.document_id}` });
      ids.add(d.document_id);
      if (d.stamp_required && (!m.stamp || d.execution_mode === "NONE"))
        ctx.addIssue({
          code: "custom",
          message: `${d.document_id} needs stamping: the pack names a stamp and an execution mode`,
        });
      if (d.execution_mode !== "NONE" && d.signers.length === 0)
        ctx.addIssue({ code: "custom", message: `${d.document_id} is executed but has no signer` });
      const at = (field: string) => ["documents", i, field];
      const physical = physicalIssue(d);
      if (physical)
        ctx.addIssue({ code: "custom", path: at("physical_reason"), message: physical });
      if (d.not_stampable === true) {
        if (d.not_stampable_reason === undefined)
          ctx.addIssue({
            code: "custom",
            path: at("not_stampable_reason"),
            message: `${d.document_id} is not stampable but gives no reason`,
          });
        if (d.stamp_evidence)
          ctx.addIssue({
            code: "custom",
            path: at("stamp_evidence"),
            message: `${d.document_id} is not stampable but carries stamp evidence`,
          });
        if (d.stamp_required)
          ctx.addIssue({
            code: "custom",
            path: at("not_stampable"),
            message: `${d.document_id} is not stampable but is stamp-required`,
          });
      } else {
        if (d.not_stampable_reason !== undefined)
          ctx.addIssue({
            code: "custom",
            path: at("not_stampable_reason"),
            message: `${d.document_id} gives a not-stampable reason without not_stampable: true`,
          });
        if (d.not_stampable_reason_code !== undefined)
          ctx.addIssue({
            code: "custom",
            path: at("not_stampable_reason_code"),
            message: `${d.document_id} gives a not-stampable reason code without not_stampable: true`,
          });
      }
    }
    if (!ids.has(m.summary_box.document_id))
      ctx.addIssue({ code: "custom", message: "summary_box names a document outside the pack" });
    if (!ids.has(m.covenant_declaration.document_id))
      ctx.addIssue({
        code: "custom",
        message: "covenant_declaration names a document outside the pack",
      });
    if (m.disbursement_clause && !ids.has(m.disbursement_clause.document_id))
      ctx.addIssue({
        code: "custom",
        path: ["disbursement_clause", "document_id"],
        message: "disbursement_clause names a document outside the pack",
      });
  });
export type ExecutionPackManifest = z.infer<typeof ExecutionPackManifest>;

// ---- §6.2 ExecutionPackIssued (PR-047 approved 20 Nov 2026; PR-UDF-061 item 12; R1-D-236) -------

/** Who signs a pack document, by role (PR-UDF-061 item 12: an enum, not an open code). */
export const PACK_SIGNER_ROLES = ["BORROWER", "CO_APPLICANT", "GUARANTOR", "LENDER"] as const;

/** The electronic execution modes: an eSign (Aadhaar OTP or biometric) or a DSC. */
export const ELECTRONIC_EXECUTION_MODES = ["ESIGN_AADHAAR", "ESIGN_DSC"] as const;

/**
 * Instrument codes for the documents of the Information Technology Act, 2000, First Schedule, to
 * which the Act does not apply (section 1(4)), so they cannot be executed by eSign or DSC: a
 * negotiable instrument other than a cheque (a promissory note, a demand promissory note, a bill of
 * exchange), a power of attorney, a trust, a will, and a contract for the sale or conveyance of
 * immovable property. A pack document with one of these as its `instrument_code` is executed
 * `WET_INK` (or `NONE`), never electronically. [VERIFY] the list against the Schedule as amended;
 * `instrument_code` stays an open code, so adding one later is not a breaking change.
 */
export const IT_ACT_FIRST_SCHEDULE_INSTRUMENTS = [
  "NEGOTIABLE_INSTRUMENT",
  "PROMISSORY_NOTE",
  "DEMAND_PROMISSORY_NOTE",
  "BILL_OF_EXCHANGE",
  "POWER_OF_ATTORNEY",
  "TRUST",
  "WILL",
  "IMMOVABLE_PROPERTY_SALE",
] as const;

/**
 * The documents the RE forwards to the borrower on execution of the loan contract (Digital Lending
 * Directions, CF para 9(3)): the loan agreement, the KFS, the sanction letter, the terms and
 * conditions, the product summary and the privacy policy, by `kind`. A pack under the Directions
 * lists each; the schema does not require it (other loan kinds), the lender contract case does.
 */
export const CF_PARA_9_3_DOCUMENT_KINDS = [
  "LOAN_AGREEMENT",
  "KFS",
  "SANCTION_LETTER",
  "TERMS_AND_CONDITIONS",
  "PRODUCT_SUMMARY",
  "PRIVACY_POLICY",
] as const;

const duty = z.number().int().min(0).max(1e12);

/**
 * The stamp evidence of one pack document (PR-UDF-061 item 12): the channel (`STAMP_MODES`, the
 * names of the pack's `stamp.mode` and of `EStampCompleted.stamp_mode`), the certificate number,
 * the State whose stamp law applies, the duty paid in integer paise and, optionally, the duty the
 * instrument states it needs (`stated_duty_paise`; the duty paid is never less: deficient stamping
 * is refused), the SHA-256 of the stamped document, when the certificate was issued, the stamp
 * vendor's certificate id and the certificate itself as a shared document
 * (`certificate_document_id`, never the stamped document).
 *
 * `certificate_document_id` (the rule stated by R1-D-258, PR-UDF-075 (4)): the stamp certificate
 * as a document the lender shared (`DocumentShared`, type `ESTAMP_CERTIFICATE` by convention) for
 * the same application, so its `application_id` is the pack's. It need not be listed in the pack's
 * `documents` (a certificate is not executed); when it is, it is a document of its own, not
 * stamp-required and without stamp evidence. The schema refuses what it can see without refusing
 * a pack valid before: the stamped document naming itself. The application and the listed
 * document's flags are checked by the lender contract cases, and by a consumer against the
 * `DocumentShared` it holds.
 *
 * `estamp_system` (R1-D-258, PR-UDF-075 (1)): optional, the `ESTAMP_SYSTEMS` system the e-stamp
 * was issued through; only with `channel: E_STAMP`.
 */
export const PackStampEvidence = z
  .object({
    channel: z.enum(STAMP_MODES),
    certificate_no: z.string().regex(/^[A-Za-z0-9/_.-]{3,64}$/),
    state: indianState,
    duty_paise: duty,
    stated_duty_paise: duty.optional(),
    stamped_document_sha256: sha256,
    issued_at: at,
    vendor_certificate_id: z
      .string()
      .regex(/^[A-Za-z0-9/_.:-]{3,128}$/)
      .optional(),
    certificate_document_id: ref.optional(),
    estamp_system: z.enum(ESTAMP_SYSTEMS).optional(),
  })
  .loose()
  .refine(
    (e) => e.stated_duty_paise === undefined || e.duty_paise >= e.stated_duty_paise,
    "the duty paid is at least the duty stated (no deficient stamping)",
  )
  .refine((e) => e.estamp_system === undefined || e.channel === "E_STAMP", {
    message: estampSystemIssue,
    path: ["estamp_system"],
  });
export type PackStampEvidence = z.infer<typeof PackStampEvidence>;

/**
 * The pack's stamp evidence of a certificate an ESTAMP adapter recorded (`recordCertificate`;
 * PR-UDF-054, R1-D-245): the channel, number, State (`MH` → `IN-MH`), duty, stated duty, stamped
 * document hash, issue time, the channel's certificate id and the scanned certificate's document id.
 * Parsed, so a certificate without a channel, number, hash or issue time, or one stamped below its
 * stated duty, throws rather than travel as incomplete evidence.
 */
export function stampEvidenceOf(cert: EstampCertificate): PackStampEvidence {
  return PackStampEvidence.parse({
    channel: cert.channel,
    certificate_no: cert.certificateNumber,
    state: `IN-${cert.stateCode}`,
    duty_paise: cert.dutyMinor,
    ...(cert.statedDutyMinor !== undefined ? { stated_duty_paise: cert.statedDutyMinor } : {}),
    stamped_document_sha256: cert.stampedDocumentSha256,
    issued_at: cert.issuedAt,
    ...(cert.vendorCertificateId !== undefined
      ? { vendor_certificate_id: cert.vendorCertificateId }
      : {}),
    ...(cert.certificateDocumentId !== undefined
      ? { certificate_document_id: cert.certificateDocumentId }
      : {}),
  });
}

/** One document of an issued pack. */
export const PackDocument = z
  .object({
    document_id: ref,
    version,
    /** `LOAN_AGREEMENT`, `KFS`, `SANCTION_LETTER`, `TERMS_AND_CONDITIONS`, `DPN`, `GUARANTEE`, … */
    kind: code,
    sha256,
    execution_mode: z.enum(EXECUTION_MODES),
    stamp_required: z.boolean(),
    /** Who signs, by role, each role at most once. */
    signers: z.array(z.enum(PACK_SIGNER_ROLES)).max(PACK_SIGNER_ROLES.length),
    /**
     * What instrument the document is (`LOAN_AGREEMENT`, `DEMAND_PROMISSORY_NOTE`, `GUARANTEE`,
     * …); required when it is executed, so the IT Act First Schedule guard applies.
     */
    instrument_code: code.optional(),
    /** The `enclosure_list` code this document furnishes (RBC para 14). */
    enclosure_code: code.optional(),
    stamp_evidence: PackStampEvidence.optional(),
    /** Optional (PR-UDF-061 item 18; R1-D-252): `physical_reason` and `re_instructions`. */
    ...physicalFields,
  })
  .loose();
export type PackDocument = z.infer<typeof PackDocument>;

/**
 * `ExecutionPackIssued` (FX → UD, signed; Ecosystem Spec v1.6 as PR-047 drafted it, approved by the
 * owner on 20 Nov 2026): how an accepted loan is to be executed. Keyed `(pack_id, version)`; a new
 * version supersedes the earlier one, and the LSP executes only the latest, within the KFS
 * validity. Beside PR-047's fields it carries PR-UDF-061 item 12:
 *
 * - `kfs_version` and `kfs_sha256`: the KFS the borrower accepted; a `KFS` document in the pack has
 *   that hash.
 * - `documents[].instrument_code` and `enclosure_code`; an executed document names its instrument,
 *   and an IT Act First Schedule instrument is never executed electronically.
 * - `covenant { business_purpose, declared }`: the wilful-defaulter covenant (RBI Treatment of
 *   Wilful Defaulters and Large Defaulters Directions, para 7(4) [VERIFY]), which the lender writes
 *   into a loan for a business purpose: the borrower will not induct a wilful defaulter or a large
 *   defaulter into its management. A business-purpose loan must have it declared, and
 *   `covenant_declaration` (the pack document carrying it, with its hash) is present exactly when
 *   `declared` is true: required for a business-purpose loan, absent when nothing is declared.
 * - `enclosure_list [{ code, clause_ref }]`: every enclosure the agreement quotes (RBI Responsible
 *   Business Conduct Directions, para 14: the borrower gets a copy of the agreement and of each
 *   enclosure it quotes), each furnished by exactly one pack document with that `enclosure_code`.
 * - `documents[].stamp_evidence` (`PackStampEvidence`), only on a stamp-required document, and in
 *   the pack `stamp`'s State when the pack names one.
 * - `not_stampable [{ document_id, reason }]`: pack documents that need no stamp, with the reason;
 *   never stamp-required and never with stamp evidence.
 * - `documents[].signers` as the `PACK_SIGNER_ROLES` enum, each role once.
 *
 * And PR-UDF-061 item 18 (R1-D-252): optional `documents[].physical_reason` (a document with one is
 * executed `WET_INK`) and `documents[].re_instructions` (link-free plain text, 1 to 1,000 characters).
 * PR-UDF-075 (R1-D-258): optional `stamp_evidence.estamp_system`, `not_stampable[].reason_code`
 * and `disbursement_clause.page` and `clause_ref`.
 */
export const ExecutionPackIssuedData = z
  .object({
    pack_id: ref,
    version,
    application_id: ref,
    kfs_id: ref,
    /** The version and SHA-256 of the KFS the borrower accepted (`BorrowerAccepted`). */
    kfs_version: version,
    kfs_sha256: sha256,
    sanction_id: ref.optional(),
    documents: z.array(PackDocument).min(1).max(50),
    stamp: z
      .object({
        state: indianState,
        article: z.string().min(1).max(64),
        duty_paise: duty,
        mode: z.enum(STAMP_MODES),
        payer: z.enum(["BORROWER", "LENDER"]),
      })
      .loose()
      .optional(),
    /** The page of the loan agreement that carries the KFS summary box. */
    summary_box: z.object({ document_id: ref, page: z.number().int().min(1).max(2000) }).loose(),
    covenant: z.object({ business_purpose: z.boolean(), declared: z.boolean() }).strict(),
    /** The document carrying the covenant declaration; present exactly when `covenant.declared`. */
    covenant_declaration: z.object({ document_id: ref, sha256 }).loose().optional(),
    enclosure_list: z
      .array(z.object({ code, clause_ref: z.string().min(1).max(64) }).loose())
      .max(50),
    /**
     * Pack documents that need no stamp: `reason` (1 to 200 characters, required) and, optional
     * (R1-D-258), `reason_code` (`NOT_STAMPABLE_REASON_CODES`).
     */
    not_stampable: z
      .array(
        z
          .object({
            document_id: ref,
            reason: z.string().min(1).max(200),
            reason_code: z.enum(NOT_STAMPABLE_REASON_CODES).optional(),
          })
          .loose(),
      )
      .max(50)
      .optional(),
    countersignature: z
      .object({
        required: z.boolean(),
        by: z.enum(["LENDER"]).optional(),
        order: z.enum(["AFTER_BORROWER", "BEFORE_BORROWER"]).optional(),
        within_days: z.number().int().min(1).max(90).optional(),
      })
      .loose(),
    /** As on the manifest (R1-D-229), with the optional `page` and `clause_ref` of R1-D-258. */
    disbursement_clause: DisbursementClause.optional(),
  })
  .loose()
  .superRefine((p, ctx) => {
    const issue = (path: Array<string | number>, message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    const byId = new Map<string, PackDocument>();
    const electronic: readonly string[] = ELECTRONIC_EXECUTION_MODES;
    const firstSchedule: readonly string[] = IT_ACT_FIRST_SCHEDULE_INSTRUMENTS;
    for (const [i, d] of p.documents.entries()) {
      const at = (field: string) => ["documents", i, field];
      if (byId.has(d.document_id)) issue(["documents", i], `duplicate document ${d.document_id}`);
      byId.set(d.document_id, d);
      if (d.stamp_required && (!p.stamp || d.execution_mode === "NONE"))
        issue(
          at("stamp_required"),
          `${d.document_id} needs stamping: the pack names a stamp and an execution mode`,
        );
      if (new Set(d.signers).size !== d.signers.length)
        issue(at("signers"), `${d.document_id} names a signer role twice`);
      if (d.execution_mode !== "NONE") {
        if (d.signers.length === 0)
          issue(at("signers"), `${d.document_id} is executed but has no signer`);
        if (d.instrument_code === undefined)
          issue(at("instrument_code"), `${d.document_id} is executed but names no instrument`);
      }
      if (
        d.instrument_code !== undefined &&
        firstSchedule.includes(d.instrument_code) &&
        electronic.includes(d.execution_mode)
      )
        issue(
          at("execution_mode"),
          `${d.document_id} is an IT Act First Schedule instrument: never executed electronically`,
        );
      const physical = physicalIssue(d);
      if (physical) issue(at("physical_reason"), physical);
      if (d.stamp_evidence) {
        if (!d.stamp_required)
          issue(at("stamp_evidence"), `${d.document_id} carries stamp evidence but needs no stamp`);
        if (p.stamp && d.stamp_evidence.state !== p.stamp.state)
          issue(at("stamp_evidence"), `${d.document_id} is stamped in another State than the pack`);
        if (d.stamp_evidence.certificate_document_id === d.document_id)
          issue(at("stamp_evidence"), `${d.document_id} names itself as its stamp certificate`);
      }
      if (d.kind === "KFS" && d.sha256 !== p.kfs_sha256)
        issue(at("sha256"), `${d.document_id} is not the KFS the borrower accepted`);
    }
    if (!byId.has(p.summary_box.document_id))
      issue(["summary_box", "document_id"], "summary_box names a document outside the pack");
    // The wilful-defaulter covenant: declared for a business purpose, carried exactly when declared.
    if (p.covenant.business_purpose && !p.covenant.declared)
      issue(["covenant", "declared"], "a business-purpose loan declares the covenant");
    if (p.covenant.declared !== (p.covenant_declaration !== undefined))
      issue(
        ["covenant_declaration"],
        p.covenant.declared
          ? "a declared covenant names its covenant_declaration"
          : "a covenant_declaration without a declared covenant",
      );
    if (p.covenant_declaration && !byId.has(p.covenant_declaration.document_id))
      issue(
        ["covenant_declaration", "document_id"],
        "covenant_declaration names a document outside the pack",
      );
    // RBC para 14: each quoted enclosure is furnished by exactly one pack document.
    const codes = new Set<string>();
    for (const [i, e] of p.enclosure_list.entries()) {
      if (codes.has(e.code)) issue(["enclosure_list", i, "code"], `duplicate enclosure ${e.code}`);
      codes.add(e.code);
      const n = p.documents.filter((d) => d.enclosure_code === e.code).length;
      if (n !== 1)
        issue(
          ["enclosure_list", i, "code"],
          `enclosure ${e.code} is furnished by ${n} pack documents, not exactly one`,
        );
    }
    for (const [i, d] of p.documents.entries())
      if (d.enclosure_code !== undefined && !codes.has(d.enclosure_code))
        issue(
          ["documents", i, "enclosure_code"],
          `${d.document_id} furnishes an enclosure the list does not quote`,
        );
    const listed = new Set<string>();
    for (const [i, n] of (p.not_stampable ?? []).entries()) {
      const path = ["not_stampable", i, "document_id"];
      if (listed.has(n.document_id)) issue(path, `${n.document_id} is listed twice`);
      listed.add(n.document_id);
      const d = byId.get(n.document_id);
      if (!d) issue(path, `${n.document_id} is not in the pack`);
      else if (d.stamp_required || d.stamp_evidence)
        issue(path, `${n.document_id} is not stampable but is stamp-required or stamped`);
    }
    if (p.countersignature.required && (!p.countersignature.by || !p.countersignature.order))
      issue(["countersignature"], "a required countersignature names `by` and `order`");
    if (p.disbursement_clause && !byId.has(p.disbursement_clause.document_id))
      issue(
        ["disbursement_clause", "document_id"],
        "disbursement_clause names a document outside the pack",
      );
  });
export type ExecutionPackIssuedData = z.infer<typeof ExecutionPackIssuedData>;
