// Documents by reference (Ecosystem Specification §6.13, §3.6) and the lender execution-pack
// manifest (Udofin PR-UDF-053; R1-D-219; plan `docs/phases/R1-udofin-phase8-plan.md`).
//
// A document travels by reference (`document_id`, `version`, `sha256`) with a detached JWS for
// transfer integrity (`signDocumentJws` in @infrabyx/crypto); the bytes are fetched from the
// producer through `GET /v1/documents/{id}`, which answers a signed India-hosted URL valid at most
// 15 minutes. The execution-pack manifest is not named by the Specification: until the owner adopts
// a carrier (platform request PR-047 proposes `ExecutionPackIssued`), it is shared as a document of
// type `EXECUTION_PACK_MANIFEST` whose bytes are the JCS form of the manifest.
import { z } from "zod";

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
    /** The producer's detached document JWS over `{ document_id, version, sha256 }`. */
    jws: detachedJws,
    retention_class: code,
    legal_hold: z.boolean(),
    media_type: z
      .string()
      .regex(/^[a-z]+\/[a-z0-9.+-]+$/)
      .max(127)
      .optional(),
    size_bytes: z.number().int().min(0).max(5e9).optional(),
    application_id: ref.optional(),
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
/** An Indian State or Union Territory, ISO 3166-2:IN (`IN-MH`, `IN-DL`, …). */
export const indianState = z.string().regex(/^IN-[A-Z]{2}$/);

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
     * here are snake case (§3.2).
     */
    disbursement_clause: z
      .object({
        document_id: ref,
        page_or_clause_ref: z.string().min(1).max(64),
        amount_stated_paise: z.number().int().min(0).max(1e14),
      })
      .loose()
      .optional(),
  })
  .loose()
  .superRefine((m, ctx) => {
    const ids = new Set<string>();
    for (const d of m.documents) {
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
