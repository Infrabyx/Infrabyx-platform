// The document JWS (Ecosystem Specification §3.6: "documents travel by reference (`document_id`,
// `sha256`) with a detached JWS for transfer integrity"; Udofin PR-UDF-053, R1-D-219). Built on the
// approved C-22 profile (`signDetachedJws`: RFC 7515 Appendix F, ES256, base64url payload; RFC 7797
// `b64: false` is not used, R1-D-94). The payload is the JCS form of the document's descriptor
// `{ document_id, version, sha256 }`, which binds the bytes through their SHA-256, so the JWS stays
// small and is checked before the download; the consumer then checks the bytes against `sha256`.
// `typ` is `ipb-document+jws`. No new primitive, key type or algorithm (owner question #158).
//
// Descriptor v2 (PR-UDF-061 item 13; R1-D-236): the same profile, key and algorithm over a wider
// JCS descriptor `{ application_id?, document_id, media_type, sha256, size_bytes, type, version }`,
// under its own `typ` (`ipb-document-v2+jws`), so the document's type, media type, size and
// application cannot be changed on the way either. A v1 JWS never verifies as v2 or the reverse
// (the `typ` is in the signed header). `verifyDocumentJws` takes both; `requireV2` refuses v1.
import { fromBase64Url } from "./encoding.js";
import { signDetachedJws, verifyDetachedJws, type DerSigner } from "./detached-jws.js";
import { canonicalize } from "./jcs.js";
import type { RegulatedKeyRing } from "./regulated-jws.js";

export const DOCUMENT_JWS_TYP = "ipb-document+jws";
/** The `typ` of a document JWS over a v2 descriptor (R1-D-236). */
export const DOCUMENT_JWS_V2_TYP = "ipb-document-v2+jws";

/** What a document JWS signs: the document's identity, version and content hash. */
export interface DocumentDescriptor {
  document_id: string;
  version: number;
  /** Lower-case SHA-256 hex of the document's bytes. */
  sha256: string;
}

/**
 * What a v2 document JWS signs (R1-D-236): the v1 descriptor and the document's type (a code such
 * as `KFS`), media type, size in bytes and, when it belongs to one, the lender's application.
 */
export interface DocumentDescriptorV2 extends DocumentDescriptor {
  type: string;
  media_type: string;
  size_bytes: number;
  application_id?: string;
}

const REF = /^[A-Za-z0-9_.:-]{3,128}$/;

function v1Fields(d: DocumentDescriptor): DocumentDescriptor {
  if (!REF.test(d.document_id)) throw new Error("invalid document_id");
  if (!Number.isInteger(d.version) || d.version < 1) throw new Error("invalid version");
  if (!/^[0-9a-f]{64}$/.test(d.sha256)) throw new Error("sha256 must be lower-case hex");
  return { document_id: d.document_id, version: d.version, sha256: d.sha256 };
}

function payloadOf(d: DocumentDescriptor): Uint8Array {
  return new TextEncoder().encode(canonicalize(v1Fields(d)));
}

function payloadV2Of(d: Partial<DocumentDescriptorV2> & DocumentDescriptor): Uint8Array {
  const base = v1Fields(d);
  if (typeof d.type !== "string" || !/^[A-Z][A-Z0-9_]{1,63}$/.test(d.type))
    throw new Error("invalid type");
  if (
    typeof d.media_type !== "string" ||
    d.media_type.length > 127 ||
    !/^[a-z]+\/[a-z0-9.+-]+$/.test(d.media_type)
  )
    throw new Error("invalid media_type");
  if (!Number.isSafeInteger(d.size_bytes) || (d.size_bytes as number) < 0)
    throw new Error("invalid size_bytes");
  const out: Record<string, unknown> = {
    ...base,
    type: d.type,
    media_type: d.media_type,
    size_bytes: d.size_bytes,
  };
  if (d.application_id !== undefined) {
    if (!REF.test(d.application_id)) throw new Error("invalid application_id");
    out.application_id = d.application_id;
  }
  return new TextEncoder().encode(canonicalize(out));
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

/**
 * Signs a v2 descriptor (R1-D-236): the same C-22 detached JWS as `signDocumentJws`, with
 * `typ: ipb-document-v2+jws`, binding the type, media type, size and application as well.
 */
export async function signDocumentJwsV2(o: {
  descriptor: DocumentDescriptorV2;
  kid: string;
  sign: DerSigner;
}): Promise<string> {
  return signDetachedJws({
    payload: payloadV2Of(o.descriptor),
    kid: o.kid,
    sign: o.sign,
    typ: DOCUMENT_JWS_V2_TYP,
  });
}

/** Which descriptor a document JWS signed (R1-D-258): v1 (`ipb-document+jws`) or v2. */
export type DocumentJwsProfile = "v1" | "v2";

/**
 * A document JWS check's outcome. `profile` (R1-D-258, PR-UDF-075 (5)) is optional here so a value
 * typed `DocumentJwsResult` that a caller builds itself (a mock, a stub) still compiles;
 * `verifyDocumentJws` always sets it (`DocumentJwsVerification`).
 */
export type DocumentJwsResult =
  | { ok: true; kid: string; profile?: DocumentJwsProfile }
  | { ok: false; reason: "malformed" | "wrong_typ" | "unknown_key" | "signature_invalid" };

/** What `verifyDocumentJws` answers: a `DocumentJwsResult` whose success names the profile. */
export type DocumentJwsVerification =
  | { ok: true; kid: string; profile: DocumentJwsProfile }
  | Extract<DocumentJwsResult, { ok: false }>;

/**
 * Verifies a document JWS against the descriptor the consumer holds (from `DocumentShared` or the
 * `GET /v1/documents/{id}` answer, which can be passed as they are) and the producer's keys. `at` is
 * the instant the key must be valid at (default now). The JWS's `typ` says which descriptor it
 * signs: v1 (`ipb-document+jws`) or v2 (`ipb-document-v2+jws`, R1-D-236), for which the descriptor
 * must hold `type`, `media_type` and `size_bytes` (else `malformed`) and, exactly when the producer
 * signed one, `application_id`. With `requireV2` a v1 JWS is refused `wrong_typ`. The bytes are
 * checked separately against `descriptor.sha256` (and, for v2, their length against `size_bytes`).
 * A success names the `profile` that verified (`"v1"` or `"v2"`; R1-D-258), so a consumer that
 * has not yet set `requireV2` can see which documents a producer still signs v1.
 */
export function verifyDocumentJws(
  jws: string,
  descriptor: DocumentDescriptor | DocumentDescriptorV2,
  keys: RegulatedKeyRing,
  at: Date = new Date(),
  opts: { requireV2?: boolean } = {},
): DocumentJwsVerification {
  let header: Record<string, unknown>;
  try {
    v1Fields(descriptor);
    const [h, mid, s] = jws.split(".");
    if (!h || mid !== "" || !s || jws.split(".").length !== 3)
      return { ok: false, reason: "malformed" };
    header = JSON.parse(new TextDecoder().decode(fromBase64Url(h))) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const v2 = header.typ === DOCUMENT_JWS_V2_TYP;
  if (!v2 && (header.typ !== DOCUMENT_JWS_TYP || opts.requireV2))
    return { ok: false, reason: "wrong_typ" };
  let payload: Uint8Array;
  try {
    payload = v2 ? payloadV2Of(descriptor) : payloadOf(descriptor);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof header.kid !== "string") return { ok: false, reason: "malformed" };
  const pub = keys.get(header.kid, at);
  if (!pub) return { ok: false, reason: "unknown_key" };
  const spki = new Uint8Array(pub.export({ format: "der", type: "spki" }));
  const r = verifyDetachedJws(jws, payload, spki);
  return r.ok
    ? { ok: true, kid: header.kid, profile: v2 ? "v2" : "v1" }
    : { ok: false, reason: "signature_invalid" };
}
