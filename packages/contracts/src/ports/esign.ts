// ESIGN port (IPB-01 ESIGN; PL3 plan §8, PL3-D-04). Documents travel by reference (`documentId`,
// `sha256`), never inline. Signature types are never silently downgraded: a downgrade needs the
// signer's consent and a RULES legal-sufficiency rule. "Sign" is R3: an agent may only be the
// maker. Inbound webhooks are untrusted triggers; `handleWebhook` returns the status read back
// from the vendor (PL3-D-15, #19).
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
}

/** Signature record kept with the signed document (crypto-agility, IPB-01 ESIGN). */
export interface SignatureRecord {
  alg: string;
  keyId: string;
  certChainRef: string;
  signerRef: string;
  signedAt: string;
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
  /** Signed PDF written to STORAGE; returns its key, SHA-256 and signature records. */
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
