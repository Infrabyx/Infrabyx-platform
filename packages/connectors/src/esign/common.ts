// Shared pieces of the ESIGN adapters (PL3 plan §8, PL3-D-23). Documents travel by reference: the
// adapter reads the PDF from STORAGE, checks its SHA-256 against the reference, and writes the
// signed PDF back to STORAGE. A signer's method is never downgraded: a method the adapter cannot
// provide exactly is refused (IPB-PORT-001, reason `method_unsupported`). Webhooks are untrusted
// triggers: after the vendor's own check, the adapter reads the envelope back and returns that.
import { PortError } from "@infrabyx/contracts/errors";
import {
  DocumentRef,
  Signer,
  SignatureField,
  storageKey,
  type EnvelopeStatus,
  type EsignEnvelopeRecord,
  type EsignEnvelopeStore,
  type SigningMethod,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { newId, sha256Hex } from "@infrabyx/crypto";
import type { z } from "zod";

export const ESIGN = "ESIGN";

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

export function validateEnvelope(
  adapter: string,
  doc: unknown,
  signers: unknown,
  fields: unknown,
): ValidatedEnvelope {
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

/** Write the signed PDF to STORAGE (REGULATED, under the tenant of the original). */
export async function storeSigned(
  storage: StoragePort,
  original: DocumentRef,
  pdf: Uint8Array,
): Promise<{ storageKey: string; sha256: string }> {
  const tenant = /^tenant\/([^/]+)\//.exec(original.storageKey)?.[1];
  if (!tenant) throw new Error("the original document key has no tenant");
  const key = storageKey(tenant, "esign", newId("esr").slice(4), "pdf");
  const sha256 = sha256Hex(pdf);
  await storage.put(key, pdf, { bucketClass: "REGULATED", contentType: "application/pdf", sha256 });
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
