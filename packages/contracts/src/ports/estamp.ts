// ESTAMP port (IPB-01 ESTAMP; Finbyx PR-FBX-29, R1-D-52). Interfaces and fakes only: stamp duty is
// paid money, so `purchase` is a money-moving call (idempotency key, amount in paise, an approved
// maker-checker request, never an agent) and no vendor adapter exists until the owner approves one.
// NeSL is listed by IPB-01 as an ESTAMP alternative for bank documents; its Digital Document
// Execution (DDE) is modelled as optional methods of this port (`capabilities.dde*`). A DDE record
// carries each signer's evidence in the shape of ESIGN's signer trail, and a document that bears no
// stamp duty (a sanction letter, a KFS acknowledgement) is registered as not stampable with a reason
// code, without a duty or an e-stamp (Finbyx PR-FBX-35, R1-D-84). No DDE call moves money.
// A certificate the regulated entity bought through its own channel (its SHCIL account, a licensed
// stamp vendor, a franking agent) is recorded with the optional `recordCertificate` (Udofin
// PR-UDF-054, R1-D-245): nothing is bought, so it is not a money call; the adapter checks it with
// the issuer where it can and keeps it once per State, channel and number.
import { z } from "zod";
import { PortError } from "../errors.js";
import type { Port, PortCall, WebhookRequestMeta } from "./common.js";
import { DocFileRef, OutputPrefix } from "./doc-file.js";
import type { SignatureRecord, SigningMethod } from "./esign.js";
import { MoneyAuthorisation, MoneyIdempotencyKey } from "./money.js";
import { AmountMinor } from "./payments.js";
import { classed } from "./payload-class.js";

const regulated = <T extends z.ZodType>(s: T): T => classed(s, "REGULATED");
const internal = <T extends z.ZodType>(s: T): T => classed(s, "INTERNAL");

/** Indian state or union territory code (ISO 3166-2:IN suffix, e.g. `MH`, `KA`, `DL`). */
export const StateCode = z.string().regex(/^[A-Z]{2}$/);

export const DutyQuoteRequest = z
  .object({
    state: internal(StateCode),
    /** The article of the state's Stamp Act schedule, e.g. `5(h)` or `loan_agreement`. */
    instrument: internal(z.string().min(1).max(80)),
    considerationMinor: regulated(AmountMinor),
  })
  .strict();

export const EstampParty = z
  .object({
    /** The product's reference for the party; the name is printed on the certificate. */
    partyRef: regulated(z.string().min(1).max(120)),
    name: regulated(z.string().min(1).max(200)),
  })
  .strict();

export const EstampPurchase = z
  .object({
    state: internal(StateCode),
    instrument: internal(z.string().min(1).max(80)),
    dutyMinor: regulated(AmountMinor),
    considerationMinor: regulated(AmountMinor),
    firstParty: EstampParty,
    secondParty: EstampParty,
    /** Who pays the duty and is named as purchaser. */
    purchaser: EstampParty,
    /** Where the certificate PDF is written. */
    outputPrefix: internal(OutputPrefix),
    authorisation: MoneyAuthorisation,
  })
  .strict();

/**
 * How a stamp was paid (R1-D-245): an e-stamp certificate, a franking impression or physical stamp
 * paper. The names of the evidence's `channel` (`STAMP_MODES`) and of `EStampCompleted.stamp_mode`.
 */
export const STAMP_RECORD_CHANNELS = ["E_STAMP", "FRANKING", "PHYSICAL_PAPER"] as const;
export type StampRecordChannel = (typeof STAMP_RECORD_CHANNELS)[number];

/**
 * How a recorded certificate was checked, usable as `EStampCompleted.stamp_verification_method`:
 * read back from its issuer (SHCIL, the aggregator), or recorded by the regulated entity from the
 * paper it holds, with nothing external to ask.
 */
export const STAMP_VERIFICATIONS = ["ISSUER_READBACK", "MANUAL_RECORD"] as const;
export type StampVerification = (typeof STAMP_VERIFICATIONS)[number];

/** The fixed refusal label of an adapter that never buys stamp duty (R1-D-245). */
export const STAMP_PURCHASE_NOT_PERMITTED = "purchase_not_permitted";

/** The certificate number rule of the stamp evidence (`PackStampEvidence.certificate_no`). */
export const StampCertificateNumber = z.string().regex(/^[A-Za-z0-9/_.-]{3,64}$/);

/** Who keyed a stamp record: a named user or a service, never an agent (R1-D-245). */
export const StampRecorder = z
  .object({
    principalId: internal(z.string().min(1).max(255)),
    principalType: internal(z.enum(["user", "service"])),
  })
  .strict();
export type StampRecorder = z.infer<typeof StampRecorder>;

/**
 * A stamp the regulated entity already paid for, recorded against the stamped instrument (Udofin
 * PR-UDF-054, R1-D-245). Physical paper and franking carry the licensed vendor's or franking
 * agent's licence and the scanned certificate; the duty paid is never less than the duty the
 * instrument states (no deficient stamping).
 */
export const StampCertificateRecord = z
  .object({
    channel: internal(z.enum(STAMP_RECORD_CHANNELS)),
    state: internal(StateCode),
    /** The article of the state's Stamp Act schedule, e.g. `5(h)` or `loan_agreement`. */
    instrument: internal(z.string().min(1).max(80)),
    /** The e-stamp certificate number, or the stamp paper's or franking impression's serial. */
    certificateNumber: internal(StampCertificateNumber),
    dutyMinor: regulated(AmountMinor),
    /** The duty the instrument states it needs, where it states one. */
    statedDutyMinor: regulated(AmountMinor).optional(),
    /** When the certificate was issued, the paper sold or the impression made. */
    issuedAt: internal(z.iso.datetime({ offset: true })),
    purchaser: EstampParty,
    /** The stamped instrument in STORAGE; its SHA-256 is the evidence's `stamped_document_sha256`. */
    stampedDocument: DocFileRef,
    /** The scanned certificate, paper or impression, as the product's document id. */
    certificateDocumentId: internal(z.string().regex(/^[A-Za-z0-9_.:-]{3,128}$/)).optional(),
    /** The licensed stamp vendor's or franking agent's licence number, as printed. */
    vendorLicence: internal(z.string().regex(/^[A-Za-z0-9/_.-]{3,64}$/)).optional(),
    /** The channel's own id for the certificate (SHCIL's or the aggregator's reference). */
    vendorCertificateId: internal(z.string().regex(/^[A-Za-z0-9/_.:-]{3,128}$/)).optional(),
    recordedBy: StampRecorder,
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.statedDutyMinor !== undefined && r.dutyMinor < r.statedDutyMinor)
      ctx.addIssue({
        code: "custom",
        message: "the duty paid is at least the duty stated (no deficient stamping)",
        path: ["statedDutyMinor"],
      });
    if (r.channel !== "E_STAMP") {
      if (r.vendorLicence === undefined)
        ctx.addIssue({
          code: "custom",
          message: "stamp paper and franking name the vendor's or agent's licence",
          path: ["vendorLicence"],
        });
      if (r.certificateDocumentId === undefined)
        ctx.addIssue({
          code: "custom",
          message: "stamp paper and franking carry the scanned certificate",
          path: ["certificateDocumentId"],
        });
    }
  });
export type StampCertificateRecord = z.infer<typeof StampCertificateRecord>;

/** Idempotency keys of `recordCertificate`: as for money calls (8 to 128 of A-Z a-z 0-9 _ . : -). */
export const StampRecordKey = MoneyIdempotencyKey;

/**
 * The check every `recordCertificate` (adapter and fake) runs first, so all refuse alike: an agent
 * recorder `IPB-SEC-004`; a duty below the stated duty `IPB-PORT-001` `deficient_stamping`; any
 * other malformed record, or a missing or malformed key, `IPB-PORT-001` `invalid_request`.
 */
export function assertStampRecord(
  port: string,
  raw: unknown,
  idempotencyKey: unknown,
  adapter?: string,
): StampCertificateRecord {
  const type = (raw as { recordedBy?: { principalType?: unknown } } | undefined)?.recordedBy
    ?.principalType;
  if (type === "agent")
    throw new PortError("IPB-SEC-004", port, {
      ...(adapter ? { adapter } : {}),
      detail: "an agent never records stamp evidence; a user or a service does (R1-D-245)",
    });
  const refuse = (reason: string, detail: string) =>
    new PortError("IPB-PORT-001", port, {
      ...(adapter ? { adapter } : {}),
      detail,
      meta: { reason, definite: true },
    });
  if (!StampRecordKey.safeParse(idempotencyKey).success)
    throw refuse("invalid_request", "a stamp record needs an idempotency key");
  const r = StampCertificateRecord.safeParse(raw);
  if (!r.success) {
    if (r.error.issues.some((i) => i.path[0] === "statedDutyMinor" && i.code === "custom"))
      throw refuse("deficient_stamping", "the duty paid is below the duty the instrument states");
    throw refuse(
      "invalid_request",
      `invalid stamp record: ${r.error.issues.map((i) => i.path.join(".") || i.message).join(", ")}`,
    );
  }
  return r.data;
}

export interface DutyQuote {
  dutyMinor: number;
  /** The RULES rule set and version that computed it (IPB-01: `quoteDuty` delegates to RULES). */
  ruleSet: string;
  ruleVersion: string;
}

export type EstampState = "pending" | "issued" | "failed" | "cancelled";

export interface EstampCertificate {
  certificateId: string;
  /** The issuing authority's certificate number; null until issued. */
  certificateNumber: string | null;
  state: EstampState;
  stateCode: string;
  instrument: string;
  dutyMinor: number;
  purchaserRef: string;
  /** The certificate PDF in STORAGE, once issued. */
  file: DocFileRef | null;
  vendorRef: string;
  adapter: string;
  issuedAt: string | null;
  // ---- R1-D-245 (PR-UDF-054): set on a recorded certificate, all optional ----
  channel?: StampRecordChannel;
  statedDutyMinor?: number;
  /** SHA-256 of the stamped instrument. */
  stampedDocumentSha256?: string;
  certificateDocumentId?: string;
  vendorLicence?: string;
  vendorCertificateId?: string;
  verification?: StampVerification;
}

/**
 * Why a document registered for DDE bears no stamp duty (PR-FBX-35 (c), R1-D-84): it is not an
 * instrument under the state's Stamp Act (a sanction letter, a notice), it only acknowledges receipt
 * (a KFS or terms acknowledgement), or another reason stated in a note. Whether a document is
 * stampable is the product's determination (its RULES); the platform records the code it gives.
 */
export const DDE_NOT_STAMPABLE_REASONS = ["NOT_AN_INSTRUMENT", "ACKNOWLEDGEMENT", "OTHER"] as const;
export type DdeNotStampableReason = (typeof DDE_NOT_STAMPABLE_REASONS)[number];

export const DdeNotStampable = z
  .object({
    reason: internal(z.enum(DDE_NOT_STAMPABLE_REASONS)),
    /** Required with `OTHER`: why the document bears no duty, in words (no personal data). */
    note: internal(z.string().trim().min(3).max(500)).optional(),
  })
  .strict()
  .refine((n) => n.reason !== "OTHER" || n.note !== undefined, {
    message: "a not-stampable registration for OTHER needs a note",
    path: ["note"],
  });

export const DdeRegistration = z
  .object({
    /** The executed-to-be document. */
    document: DocFileRef,
    /** Its stamp certificate; required unless the document is registered as not stampable. */
    certificateId: internal(z.string().min(1).max(120)).optional(),
    /**
     * A document that bears no stamp duty: a reason code, and no certificate (or duty) with it.
     * Nothing is paid on either path; buying duty stays `purchase`, with its money-call rules.
     */
    notStampable: DdeNotStampable.optional(),
    executants: z.array(EstampParty).min(1).max(20),
    outputPrefix: internal(OutputPrefix),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.notStampable && r.certificateId !== undefined)
      ctx.addIssue({
        code: "custom",
        message: "a not-stampable registration carries no e-stamp certificate",
        path: ["certificateId"],
      });
    if (!r.notStampable && r.certificateId === undefined)
      ctx.addIssue({
        code: "custom",
        message: "a DDE registration needs its stamp certificate, or notStampable with a reason",
        path: ["certificateId"],
      });
  });

export type DdeState = "registered" | "pending_execution" | "executed" | "expired" | "rejected";

/**
 * One executant's signing evidence at the information utility, in the shape of ESIGN's signer
 * trail (`SignatureRecord`'s signer reference, time, ESP transaction id and the signer's IP as the
 * ESP recorded it, with `EnvelopeStatus`'s signing method). No other personal data: the signer is
 * the product's party reference, and the IP is CONFIDENTIAL signing evidence only (PR-FBX-35 (b)).
 */
export type DdeSignerEvidence = Pick<
  SignatureRecord,
  "signerRef" | "signedAt" | "espTransactionId" | "signerIp"
> & { method: SigningMethod };

export interface DdeRecord {
  ddeId: string;
  state: DdeState;
  /** Executants who have signed so far, by product reference. */
  executed: string[];
  /** Each signed executant's evidence, in the order of `executed` (one entry per reference). */
  signers: DdeSignerEvidence[];
  /** The reason code when registered as not stampable; null for a stamped document. */
  notStampableReason: DdeNotStampableReason | null;
  vendorRef: string;
  adapter: string;
}

export interface EstampPort extends Port {
  /** Which states and instruments the adapter can stamp (a state it does not cover is refused). */
  covers(state: string, instrument: string): Promise<boolean>;
  quoteDuty(req: z.infer<typeof DutyQuoteRequest>, call?: PortCall): Promise<DutyQuote>;
  /** Money-moving: pays the duty and procures a certificate (`assertMoneyCall` first). */
  purchase(
    req: z.infer<typeof EstampPurchase>,
    idempotencyKey: string,
    call?: PortCall,
  ): Promise<EstampCertificate>;
  /**
   * Records a stamp the regulated entity already paid for through its own channel (optional;
   * `capabilities.recordCertificate`; R1-D-245). Never buys: an adapter that has it refuses
   * `purchase` with `purchase_not_permitted`. Once per idempotency key, and a certificate number
   * once per State and channel (`IPB-PORT-004`, `certificate_reused`). The product writes the
   * record in its kernel mutation, so the ledger entry is in the same transaction.
   */
  recordCertificate?(
    req: z.input<typeof StampCertificateRecord>,
    idempotencyKey: string,
    call?: PortCall,
  ): Promise<EstampCertificate>;
  /** Links a certificate to the product's document record. */
  attach(certificateId: string, documentId: string): Promise<void>;
  /** Reads the certificate back from the issuing authority. */
  verify(certificateId: string): Promise<EstampCertificate>;
  /** Parses the event, then reads the certificate back; only that is trusted. */
  handleWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    meta?: WebhookRequestMeta,
  ): Promise<EstampCertificate>;
  /**
   * NeSL Digital Document Execution (optional; `capabilities.ddeRegister`). A stamped document
   * names its certificate; a document that bears no duty is registered `notStampable` with a
   * reason code instead (refused with a certificate or a duty). Neither path moves money.
   */
  ddeRegister?(
    req: z.infer<typeof DdeRegistration>,
    idempotencyKey: string,
    call?: PortCall,
  ): Promise<DdeRecord>;
  /** Read back from the information utility, with each signed executant's evidence. */
  ddeStatus?(ddeId: string): Promise<DdeRecord>;
  /** The executed document with the information utility's record, written to STORAGE. */
  ddeDownloadExecuted?(ddeId: string): Promise<DocFileRef>;
}
