// Shared pieces of the ESIGN adapters (PL3 plan §8, PL3-D-23). Documents travel by reference: the
// adapter reads the PDF from STORAGE, checks its SHA-256 against the reference, and writes the
// signed PDF back to STORAGE. A signer's method is never downgraded: a method the adapter cannot
// provide exactly is refused (IPB-PORT-001, reason `method_unsupported`). Webhooks are untrusted
// triggers: after the vendor's own check, the adapter reads the envelope back and returns that.
// PR-UDF-070 (R1-D-251): signature records carry the signer certificate read from the signed
// PDF's own signatures, where each can be tied to one signer; multi-document envelopes are
// refused `unsupported` by every vendor adapter until a vendor's support is verified.
// PR-UDF-074 (R1-D-260): a download may name the tenant's STORAGE key (`keyRef`); the signed PDF
// is written to REGULATED under it or not at all (the STORAGE refusal fails the download, never a
// write under the class key). It goes straight to REGULATED, not through QUARANTINE: it is the
// contracted ESP's answer over its authenticated API, as every other vendor-sourced file.
import { PortError } from "@infrabyx/contracts/errors";
import {
  DocumentRef,
  Signer,
  SignatureField,
  storageKey,
  isValidStorageKeyRef,
  returnUrlProblem,
  type EnvelopeStatus,
  type EsignDownloadOptions,
  type EsignEnvelopeRecord,
  type EsignEnvelopeStore,
  type SignatureRecord,
  type SignerCertificateSummary,
  type SigningMethod,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { newId, PADES_LIMITS, padesSignerCertificates, sha256Hex } from "@infrabyx/crypto";
import type { z } from "zod";

export const ESIGN = "ESIGN";

/** Descriptor capabilities of an adapter without multi-document envelopes (PR-UDF-070). */
export const NO_MULTI_DOCUMENT = {
  createMultiDocumentEnvelope: "unsupported",
  downloadSignedDocuments: "unsupported",
} as const;

/**
 * PR-UDF-070: each signer's certificate summary, from the signatures embedded in the signed PDF
 * (`padesSignerCertificates`: only signatures bound to their certificate count). The k-th
 * signature in file order (each ESP signature is an incremental update) is the k-th signer to
 * sign: envelope order for a sequential envelope, the ESP's signing times for a parallel one.
 * Filled only when that mapping is certain: one bound signature per signer, and for a parallel
 * envelope of several signers distinct signing times; otherwise the map is empty and no record
 * gets a certificate (never a guess). [VERIFY] per vendor that its signed PDF carries exactly one
 * signature per signer (no extra platform seal or document timestamp) in signing order.
 */
export function signerCertificatesFromPdf(
  pdf: Uint8Array,
  order: "sequential" | "parallel",
  signers: readonly { ref: string; at?: string }[],
): Map<string, SignerCertificateSummary> {
  const out = new Map<string, SignerCertificateSummary>();
  const certs = padesSignerCertificates(pdf, { maxBytes: PADES_LIMITS.maxBytes });
  if (!signers.length || certs.length !== signers.length || certs.some((c) => !c)) return out;
  let bySigning = [...signers];
  if (order === "parallel" && signers.length > 1) {
    const t = signers.map((s) => (s.at ? Date.parse(s.at) : Number.NaN));
    if (t.some(Number.isNaN) || new Set(t).size !== t.length) return out;
    bySigning = signers
      .map((s, i) => ({ s, t: t[i] as number }))
      .sort((a, b) => a.t - b.t)
      .map((x) => x.s);
  }
  bySigning.forEach((s, i) => out.set(s.ref, certs[i] as SignerCertificateSummary));
  return out;
}

/** The record with its signer certificate, when one was tied to its signer. */
export function withSignerCertificate(
  r: SignatureRecord,
  certs: ReadonlyMap<string, SignerCertificateSummary>,
): SignatureRecord {
  const c = certs.get(r.signerRef);
  return c ? { ...r, signerCertificate: c } : r;
}

export function unsupported(adapter: string, method: string, reason = "unsupported"): PortError {
  return new PortError("IPB-PORT-001", ESIGN, {
    adapter,
    detail: `${adapter} does not provide ${method}`,
    meta: { reason },
  });
}

/** Never a silent downgrade: refuse a method the adapter does not provide as asked. */
export function methodRefused(adapter: string, method: SigningMethod): PortError {
  return new PortError("IPB-PORT-001", ESIGN, {
    adapter,
    detail: `${adapter} cannot sign with ${method}; a different method needs the signer's consent and a RULES legal-sufficiency decision`,
    meta: { reason: "method_unsupported", method },
  });
}

export interface ValidatedEnvelope {
  doc: DocumentRef;
  signers: Signer[];
  fields: z.infer<typeof SignatureField>[];
}

/**
 * Refuse a return URL `returnUrlProblem` does not admit (PR-UDF-086, R1-D-287), before any vendor
 * call: `IPB-PORT-001` `return_url_invalid`, with the problem but never the URL (it may carry what
 * it should not).
 */
export function assertReturnUrl(adapter: string, url: unknown): asserts url is string {
  const problem = returnUrlProblem(url);
  if (problem)
    throw new PortError("IPB-PORT-001", ESIGN, {
      adapter,
      detail: `invalid return URL (${problem}): https, a host, no query string, fragment or user info`,
      meta: { reason: "return_url_invalid", problem },
    });
}

export function validateEnvelope(
  adapter: string,
  doc: unknown,
  signers: unknown,
  fields: unknown,
): ValidatedEnvelope {
  if (Array.isArray(signers))
    for (const x of signers)
      if (x && typeof x === "object" && "returnUrl" in x && x.returnUrl !== undefined)
        assertReturnUrl(adapter, x.returnUrl);
  const d = DocumentRef.safeParse(doc);
  const s = Signer.array().min(1).max(20).safeParse(signers);
  const f = SignatureField.array().max(100).safeParse(fields);
  if (!d.success || !s.success || !f.success)
    throw new PortError("IPB-PORT-001", ESIGN, {
      adapter,
      detail: "invalid envelope (document reference, 1–20 signers, signature fields)",
      meta: { reason: "invalid_request" },
    });
  const refs = new Set(s.data.map((x) => x.ref));
  if (refs.size !== s.data.length || f.data.some((x) => !refs.has(x.signerRef)))
    throw new PortError("IPB-PORT-001", ESIGN, {
      adapter,
      detail: "signer references must be unique and every field must name a signer",
      meta: { reason: "invalid_request" },
    });
  return { doc: d.data, signers: s.data, fields: f.data };
}

/** Read the PDF from STORAGE and prove it is the referenced document. */
export async function readDocument(
  storage: StoragePort,
  adapter: string,
  doc: DocumentRef,
): Promise<Uint8Array> {
  const o = await storage.get(doc.storageKey);
  if (sha256Hex(o.body) !== doc.sha256)
    throw new PortError("IPB-PORT-001", ESIGN, {
      adapter,
      detail: "the stored document does not match its SHA-256",
      meta: { reason: "hash_mismatch" },
    });
  if (Buffer.from(o.body.subarray(0, 5)).toString("latin1") !== "%PDF-")
    throw new PortError("IPB-PORT-001", ESIGN, {
      adapter,
      detail: "only PDF documents are signed",
      meta: { reason: "invalid_request" },
    });
  return o.body;
}

/**
 * PR-UDF-074: the named key reference a download asks for, checked before the ESP is called. A
 * malformed reference (or a key id in disguise) is refused `IPB-PORT-003` `key_ref_invalid`, as
 * the STORAGE write would refuse it; whether the tenant has that key is the write's to decide.
 */
export function downloadKeyRef(
  adapter: string,
  opts: EsignDownloadOptions | undefined,
): string | undefined {
  const keyRef = opts?.keyRef;
  if (keyRef === undefined) return undefined;
  if (typeof keyRef !== "string" || !isValidStorageKeyRef(keyRef))
    throw new PortError("IPB-PORT-003", ESIGN, {
      adapter,
      detail: "the signed file's key reference is malformed",
      meta: { reason: "key_ref_invalid" },
    });
  return keyRef;
}

/**
 * Write the signed PDF to STORAGE (REGULATED, under the tenant of the original). PR-UDF-074: with
 * `keyRef`, under that named tenant key; STORAGE's refusal propagates unchanged (fail closed).
 */
export async function storeSigned(
  storage: StoragePort,
  original: DocumentRef,
  pdf: Uint8Array,
  keyRef?: string,
): Promise<{ storageKey: string; sha256: string }> {
  const tenant = /^tenant\/([^/]+)\//.exec(original.storageKey)?.[1];
  if (!tenant) throw new Error("the original document key has no tenant");
  const key = storageKey(tenant, "esign", newId("esr").slice(4), "pdf");
  const sha256 = sha256Hex(pdf);
  await storage.put(key, pdf, {
    bucketClass: "REGULATED",
    contentType: "application/pdf",
    sha256,
    ...(keyRef !== undefined ? { keyRef } : {}),
  });
  return { storageKey: key, sha256 };
}

export async function loadEnvelope(
  store: EsignEnvelopeStore,
  adapter: string,
  envelopeId: string,
): Promise<EsignEnvelopeRecord> {
  const r = await store.get(envelopeId);
  if (!r || r.adapter !== adapter)
    throw new PortError("IPB-PORT-001", ESIGN, {
      adapter,
      detail: `unknown envelope ${envelopeId}`,
      meta: { reason: "not_found" },
    });
  return r;
}

/** Overall state from per-signer states (any decline wins; all signed completes). */
export function overallState(
  signers: EnvelopeStatus["signers"],
  vendor: { expired?: boolean; cancelled?: boolean; sent?: boolean },
): EnvelopeStatus["state"] {
  if (vendor.cancelled) return "cancelled";
  if (signers.some((s) => s.state === "declined")) return "declined";
  if (signers.length && signers.every((s) => s.state === "signed")) return "completed";
  if (vendor.expired) return "expired";
  if (signers.some((s) => s.state === "signed")) return "partially_signed";
  return vendor.sent === false ? "draft" : "sent";
}
