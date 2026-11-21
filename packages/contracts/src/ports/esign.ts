// ESIGN port (IPB-01 ESIGN; PL3 plan §8, PL3-D-04). Documents travel by reference (`documentId`,
// `sha256`), never inline. Signature types are never silently downgraded: a downgrade needs the
// signer's consent and a RULES legal-sufficiency rule. "Sign" is R3: an agent may only be the
// maker. Inbound webhooks are untrusted triggers; `handleWebhook` returns the status read back
// from the vendor (PL3-D-15, #19). PR-UDF-070 (R1-D-251): each signature record may carry the
// signer certificate's summary, and an envelope may hold several documents (optional methods, so
// existing adapters and callers are unaffected; an adapter without them refuses `unsupported`).
import { z } from "zod";
import type { Port, PortCall, WebhookRequestMeta } from "./common.js";
import { classed, recipient } from "./payload-class.js";

const internal = <T extends z.ZodType>(s: T): T => classed(s, "INTERNAL");

/** Ecosystem §5 code table `signing_method` (v1.2). */
export const SIGNING_METHODS = [
  "AADHAAR_OTP_ESIGN",
  "AADHAAR_BIO_ESIGN",
  "ACCOUNT_ESIGN",
  "DSC",
  "E_ACCEPTANCE_OTP",
  "WET_INK",
] as const;
export type SigningMethod = (typeof SIGNING_METHODS)[number];

export const DocumentRef = z
  .object({
    documentId: internal(z.string().min(3)),
    sha256: internal(z.string().regex(/^[0-9a-f]{64}$/)),
    /** STORAGE key of the PDF; the adapter streams it to the ESP. */
    storageKey: internal(z.string().min(1)),
  })
  .strict();
export type DocumentRef = z.infer<typeof DocumentRef>;

export const Signer = z
  .object({
    /** Principal or party reference. */
    ref: internal(z.string().min(3)),
    name: recipient(z.string().min(1).max(200)),
    email: recipient(z.email()).optional(),
    phone: recipient(z.string().regex(/^\+[1-9]\d{7,14}$/)).optional(),
    method: internal(z.enum(SIGNING_METHODS)),
  })
  .strict();
export type Signer = z.infer<typeof Signer>;

export const SignatureField = z
  .object({
    signerRef: z.string(),
    page: z.number().int().positive(),
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();

/** At most this many documents in one multi-document envelope (PR-UDF-070, R1-D-251). */
export const MAX_ENVELOPE_DOCUMENTS = 10;

/** One document of a multi-document envelope, with its own signature positions. */
export const EnvelopeDocument = z
  .object({
    doc: DocumentRef,
    fields: SignatureField.array().max(100),
  })
  .strict();
export type EnvelopeDocument = z.infer<typeof EnvelopeDocument>;

/** The documents of a multi-document envelope: 1 to 10, unique ids and storage keys. */
export const EnvelopeDocuments = EnvelopeDocument.array()
  .min(1)
  .max(MAX_ENVELOPE_DOCUMENTS)
  .refine(
    (ds) =>
      new Set(ds.map((d) => d.doc.documentId)).size === ds.length &&
      new Set(ds.map((d) => d.doc.storageKey)).size === ds.length,
    { message: "document ids and storage keys must be unique" },
  );

export const ENVELOPE_STATES = [
  "draft",
  "sent",
  "partially_signed",
  "completed",
  "declined",
  "expired",
  "cancelled",
  "failed",
] as const;
export type EnvelopeState = (typeof ENVELOPE_STATES)[number];

export interface EnvelopeStatus {
  /** `esr_…` envelope id. */
  envelopeId: string;
  vendorRef: string;
  state: EnvelopeState;
  signers: {
    ref: string;
    state: "pending" | "signed" | "declined";
    method: SigningMethod;
    at?: string;
  }[];
  /**
   * Multi-document envelopes only (PR-UDF-070): each document's progress. A signer is `signed`
   * only once they signed every document, and the envelope is `completed` only when every
   * document is signed by every signer (all or nothing); a decline on any document declines it.
   */
  documents?: EnvelopeDocumentStatus[];
}

export interface EnvelopeDocumentStatus {
  documentId: string;
  state: "pending" | "partially_signed" | "signed";
  /** Signer references that have signed this document, in signing order. */
  signedBy: string[];
}

/**
 * The signer certificate of one signature, as the ESP issued it (PR-UDF-070, R1-D-251): fields
 * read from the certificate, never a judgement of trust (that is `verifyPadesSignatures`').
 * `subjectCommonName` is usually the signer's name: CONFIDENTIAL, signing evidence only.
 */
export interface SignerCertificateSummary {
  /** Hex, as Node prints it (upper case), the same as `verifyPadesSignatures`' `signer.serial`. */
  serialNumber: string;
  /** The issuer's distinguished name, as Node prints it (one `attribute=value` per line). */
  issuer: string;
  /** RFC 3339 (UTC). */
  notBefore: string;
  notAfter: string;
  /** SHA-256 of the certificate's DER, lower-case hex. */
  sha256: string;
  /** The subject's most specific common name; absent when the subject has none. */
  subjectCommonName?: string;
}

/** Signature record kept with the signed document (crypto-agility, IPB-01 ESIGN). */
export interface SignatureRecord {
  alg: string;
  keyId: string;
  certChainRef: string;
  signerRef: string;
  signedAt: string;
  /** The ESP's transaction id from its audit trail, where it gives one (PR-FBX-29 item 7). */
  espTransactionId?: string;
  /** The signer's IP address as the ESP recorded it (CONFIDENTIAL; signing evidence only). */
  signerIp?: string;
  /**
   * PR-UDF-070: the signer certificate's summary, from the ESP's own certificate (its response, or
   * the signature embedded in the signed PDF). Absent when the adapter cannot tie a certificate
   * to this signer.
   */
  signerCertificate?: SignerCertificateSummary;
}

/** One signed document of an envelope: the file written to STORAGE and its signature records. */
export interface SignedEnvelopeDocument {
  documentId: string;
  storageKey: string;
  sha256: string;
  signatures: SignatureRecord[];
}

export interface EsignPort extends Port {
  createEnvelope(
    doc: DocumentRef,
    signers: Signer[],
    order: "sequential" | "parallel",
    fields: z.infer<typeof SignatureField>[],
    call?: PortCall,
  ): Promise<{ envelopeId: string }>;
  sendForSignature(envelopeId: string, call?: PortCall): Promise<EnvelopeStatus>;
  getStatus(envelopeId: string): Promise<EnvelopeStatus>;
  /**
   * PR-UDF-070: one envelope over several documents (`EnvelopeDocuments`: 1 to 10, each with its
   * own reference and signature positions), signed by the same signers in one order. Optional:
   * an adapter that cannot do it refuses `IPB-PORT-001` `unsupported` (or does not have it).
   */
  createMultiDocumentEnvelope?(
    documents: EnvelopeDocument[],
    signers: Signer[],
    order: "sequential" | "parallel",
    call?: PortCall,
  ): Promise<{ envelopeId: string }>;
  /**
   * PR-UDF-070: every signed document of a completed envelope, in the order created, each written
   * to STORAGE with its signature records. Refused `not_completed` until every document is signed
   * by every signer (all or nothing). Optional, as `createMultiDocumentEnvelope`.
   */
  downloadSignedDocuments?(envelopeId: string): Promise<{ documents: SignedEnvelopeDocument[] }>;
  /**
   * Signed PDF written to STORAGE; returns its key, SHA-256 and signature records. An envelope of
   * more than one document is refused (`multi_document`): use `downloadSignedDocuments`.
   */
  downloadSigned(
    envelopeId: string,
  ): Promise<{ storageKey: string; sha256: string; signatures: SignatureRecord[] }>;
  aadhaarEsign(session: {
    envelopeId: string;
    signerRef: string;
    method: "AADHAAR_OTP_ESIGN" | "AADHAAR_BIO_ESIGN";
  }): Promise<{ redirectUrl: string }>;
  dscSign(session: { envelopeId: string; signerRef: string }): Promise<{ redirectUrl: string }>;
  verifySignature(doc: DocumentRef): Promise<{ valid: boolean; signatures: SignatureRecord[] }>;
  cancel(envelopeId: string, reason: string): Promise<void>;
  /** Parses the event, then reads the envelope back from the vendor; only that status is trusted. */
  handleWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    meta?: WebhookRequestMeta,
  ): Promise<EnvelopeStatus>;
}

/** What an ESIGN adapter remembers about an envelope (the product persists it). */
export interface EsignEnvelopeRecord {
  envelopeId: string;
  adapter: string;
  vendorRef: string;
  doc: DocumentRef;
  order: "sequential" | "parallel";
  /** Per signer: the method it was created with (never downgraded) and the vendor's handle. */
  signers: { ref: string; method: SigningMethod; vendorKey: string }[];
  createdAt: string;
}

/** Envelope ids ↔ vendor references, kept by the product (e.g. beside its signing workflow). */
export interface EsignEnvelopeStore {
  save(r: EsignEnvelopeRecord): Promise<void>;
  get(envelopeId: string): Promise<EsignEnvelopeRecord | null>;
  byVendorRef(adapter: string, vendorRef: string): Promise<EsignEnvelopeRecord | null>;
}
