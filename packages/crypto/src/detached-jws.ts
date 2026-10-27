// C-22 (PL3-D-06): detached JWS (RFC 7515 Appendix F), ES256, for export manifests and the signed
// `ExportCompleted`. The signature is made by KMS `sign` (C-14 `ECC_NIST_P256`, `ECDSA_SHA_256`,
// MessageType DIGEST in the AWS adapter) with the platform export-signing key; `kid` is the KMS
// key id. KMS returns DER, which is converted to the JOSE form (IEEE P1363, 64 bytes). The payload
// is never part of the serialisation (`<header>..<signature>`), so the signed file stays separate.
import { createPublicKey, verify as nodeVerify, type KeyObject } from "node:crypto";
import { fromBase64Url, toBase64Url } from "./encoding.js";
import { canonicalize } from "./jcs.js";

/** Signs the JWS signing input with ECDSA P-256 / SHA-256 and returns a DER signature (KMS `sign`). */
export type DerSigner = (signingInput: Uint8Array) => Promise<Uint8Array>;

const HEADER_KEYS = new Set(["alg", "kid", "typ", "cty"]);

/** DER `SEQUENCE { INTEGER r, INTEGER s }` → 64-byte `r ‖ s`. */
export function derToJose(der: Uint8Array): Uint8Array {
  const fail = () => {
    throw new Error("not a DER ECDSA P-256 signature");
  };
  let i = 0;
  if (der[i++] !== 0x30) fail();
  let len = der[i++] as number;
  if (len & 0x80) {
    if (len !== 0x81) fail();
    len = der[i++] as number;
  }
  if (len !== der.length - i) fail();
  const out = new Uint8Array(64);
  for (const off of [0, 32]) {
    if (der[i++] !== 0x02) fail();
    const n = der[i++] as number;
    let v = der.subarray(i, i + n);
    i += n;
    while (v.length > 32 && v[0] === 0) v = v.subarray(1);
    if (v.length > 32 || v.length === 0) fail();
    out.set(v, off + 32 - v.length);
  }
  if (i !== der.length) fail();
  return out;
}

/**
 * Sign `payload` as a detached compact JWS: `BASE64URL(header) || ".." || BASE64URL(signature)`.
 * The header carries `alg: ES256`, `kid` and optionally `typ`/`cty`; nothing else.
 */
export async function signDetachedJws(o: {
  payload: Uint8Array;
  kid: string;
  sign: DerSigner;
  typ?: string;
  cty?: string;
}): Promise<string> {
  if (!o.kid) throw new Error("kid is required (C-22)");
  const header: Record<string, string> = { alg: "ES256", kid: o.kid };
  if (o.typ) header.typ = o.typ;
  if (o.cty) header.cty = o.cty;
  const h = toBase64Url(new TextEncoder().encode(canonicalize(header)));
  const input = new TextEncoder().encode(`${h}.${toBase64Url(o.payload)}`);
  const sig = derToJose(await o.sign(input));
  return `${h}..${toBase64Url(sig)}`;
}

/** The ES256 public key of an SPKI DER (KMS `getPublicKey`) as a public JWK, for READMEs and verifiers. */
export interface Es256PublicJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  alg: "ES256";
  use: "sig";
  kid: string;
}

export function spkiToEs256Jwk(spki: Uint8Array, kid: string): Es256PublicJwk {
  const k = createPublicKey({ key: Buffer.from(spki), format: "der", type: "spki" });
  const j = k.export({ format: "jwk" }) as Record<string, string>;
  if (j.kty !== "EC" || j.crv !== "P-256") throw new Error("C-22 needs an EC P-256 key");
  return {
    kty: "EC",
    crv: "P-256",
    x: j.x as string,
    y: j.y as string,
    alg: "ES256",
    use: "sig",
    kid,
  };
}

/**
 * Verify a detached ES256 JWS over `payload` with a public key (SPKI DER or a P-256 JWK). Refuses
 * any alg other than ES256, an attached payload and unknown header members (e.g. `b64`, `crit`).
 */
export function verifyDetachedJws(
  jws: string,
  payload: Uint8Array,
  key: Uint8Array | { kty: string; crv?: string; x?: string; y?: string },
): { ok: boolean; kid?: string } {
  const parts = jws.split(".");
  if (parts.length !== 3 || parts[1] !== "") return { ok: false };
  const [h, , s] = parts as [string, string, string];
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(fromBase64Url(h))) as Record<string, unknown>;
  } catch {
    return { ok: false };
  }
  if (header.alg !== "ES256" || Object.keys(header).some((k) => !HEADER_KEYS.has(k)))
    return { ok: false };
  const sig = fromBase64Url(s);
  if (sig.byteLength !== 64) return { ok: false };
  let pub: KeyObject;
  try {
    pub =
      key instanceof Uint8Array
        ? createPublicKey({ key: Buffer.from(key), format: "der", type: "spki" })
        : createPublicKey({
            key: { kty: "EC", crv: "P-256", x: String(key.x), y: String(key.y) },
            format: "jwk",
          });
  } catch {
    return { ok: false };
  }
  const input = Buffer.from(`${h}.${toBase64Url(payload)}`, "ascii");
  const ok = nodeVerify("sha256", input, { key: pub, dsaEncoding: "ieee-p1363" }, sig);
  return { ok, ...(typeof header.kid === "string" ? { kid: header.kid } : {}) };
}

/**
 * The payload of a signed CloudEvent (C-22, Ecosystem §3): the JCS (RFC 8785) form of the event
 * without its signature attribute, so the JWS is stored beside the event and re-verified later.
 */
export function cloudEventSigningPayload(event: Record<string, unknown>): Uint8Array {
  const { signature: _signature, ...rest } = event;
  return new TextEncoder().encode(canonicalize(rest));
}
