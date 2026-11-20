// The document JWS (Ecosystem Specification §3.6: "documents travel by reference (`document_id`,
// `sha256`) with a detached JWS for transfer integrity"; Udofin PR-UDF-053, R1-D-219). Built on the
// approved C-22 profile (`signDetachedJws`: RFC 7515 Appendix F, ES256, base64url payload; RFC 7797
// `b64: false` is not used, R1-D-94). The payload is the JCS form of the document's descriptor
// `{ document_id, version, sha256 }`, which binds the bytes through their SHA-256, so the JWS stays
// small and is checked before the download; the consumer then checks the bytes against `sha256`.
// `typ` is `ipb-document+jws`. No new primitive, key type or algorithm (owner question #158).
import { fromBase64Url } from "./encoding.js";
import { signDetachedJws, verifyDetachedJws, type DerSigner } from "./detached-jws.js";
import { canonicalize } from "./jcs.js";
import type { RegulatedKeyRing } from "./regulated-jws.js";

export const DOCUMENT_JWS_TYP = "ipb-document+jws";

/** What a document JWS signs: the document's identity, version and content hash. */
export interface DocumentDescriptor {
  document_id: string;
  version: number;
  /** Lower-case SHA-256 hex of the document's bytes. */
  sha256: string;
}

function payloadOf(d: DocumentDescriptor): Uint8Array {
  if (!/^[A-Za-z0-9_.:-]{3,128}$/.test(d.document_id)) throw new Error("invalid document_id");
  if (!Number.isInteger(d.version) || d.version < 1) throw new Error("invalid version");
  if (!/^[0-9a-f]{64}$/.test(d.sha256)) throw new Error("sha256 must be lower-case hex");
  return new TextEncoder().encode(
    canonicalize({ document_id: d.document_id, version: d.version, sha256: d.sha256 }),
  );
}

/** Signs a document's descriptor as a compact detached JWS (`<header>..<signature>`). */
export async function signDocumentJws(o: {
  descriptor: DocumentDescriptor;
  kid: string;
  sign: DerSigner;
}): Promise<string> {
  return signDetachedJws({
    payload: payloadOf(o.descriptor),
    kid: o.kid,
    sign: o.sign,
    typ: DOCUMENT_JWS_TYP,
  });
}

export type DocumentJwsResult =
  | { ok: true; kid: string }
  | { ok: false; reason: "malformed" | "wrong_typ" | "unknown_key" | "signature_invalid" };

/**
 * Verifies a document JWS against the descriptor the consumer holds (from `DocumentShared` or the
 * `GET /v1/documents/{id}` answer) and the producer's keys. `at` is the instant the key must be
 * valid at (default now). The bytes are checked separately against `descriptor.sha256`.
 */
export function verifyDocumentJws(
  jws: string,
  descriptor: DocumentDescriptor,
  keys: RegulatedKeyRing,
  at: Date = new Date(),
): DocumentJwsResult {
  let payload: Uint8Array;
  let header: Record<string, unknown>;
  try {
    payload = payloadOf(descriptor);
    const [h, mid, s] = jws.split(".");
    if (!h || mid !== "" || !s || jws.split(".").length !== 3)
      return { ok: false, reason: "malformed" };
    header = JSON.parse(new TextDecoder().decode(fromBase64Url(h))) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (header.typ !== DOCUMENT_JWS_TYP) return { ok: false, reason: "wrong_typ" };
  if (typeof header.kid !== "string") return { ok: false, reason: "malformed" };
  const pub = keys.get(header.kid, at);
  if (!pub) return { ok: false, reason: "unknown_key" };
  const spki = new Uint8Array(pub.export({ format: "der", type: "spki" }));
  const r = verifyDetachedJws(jws, payload, spki);
  return r.ok ? { ok: true, kid: header.kid } : { ok: false, reason: "signature_invalid" };
}
