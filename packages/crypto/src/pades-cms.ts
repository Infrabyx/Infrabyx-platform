// CMS SignedData (RFC 5652) and RFC 3161 TSTInfo readers for the PAdES verifier (C-28,
// R1-D-246). Only the fields the approved scope needs; everything else is skipped, never
// interpreted. Internal to @infrabyx/crypto.
import {
  DerError,
  TAG,
  bytesOf,
  children,
  encodingOf,
  expect,
  integerOf,
  oidOf,
  readOne,
  smallIntOf,
  timeOf,
  type Tlv,
} from "./der.js";
import { hashOf, type PadesHash } from "./pades-x509.js";

export const OID = {
  SIGNED_DATA: "1.2.840.113549.1.7.2",
  DATA: "1.2.840.113549.1.7.1",
  TST_INFO: "1.2.840.113549.1.9.16.1.4",
  CONTENT_TYPE: "1.2.840.113549.1.9.3",
  MESSAGE_DIGEST: "1.2.840.113549.1.9.4",
  SIGNING_TIME: "1.2.840.113549.1.9.5",
  SIGNING_CERT_V2: "1.2.840.113549.1.9.16.2.47",
  TIMESTAMP_TOKEN: "1.2.840.113549.1.9.16.2.14",
} as const;

const MAX_CERTS = 32;
const MAX_ATTRS = 32;

export type SignerId = { issuer: Buffer; serial: Buffer } | { ski: Buffer };

export interface ParsedSignerInfo {
  sid: SignerId;
  /** The digest algorithm, refused (AlgError) when weak or unknown. */
  digest: PadesHash;
  /** The signed attributes re-encoded with the SET tag, the bytes the signature covers. */
  signedAttrs: Buffer;
  contentType: string;
  messageDigest: Buffer;
  signingTime?: Date;
  /** ESS signing-certificate-v2: the first ESSCertIDv2 (the signer's). */
  essCert?: { hash: PadesHash; certHash: Buffer };
  sigAlg: { d: Buffer; t: Tlv };
  signature: Buffer;
  /** The encoding of the signature-time-stamp token (a ContentInfo), when present. */
  timestampToken?: Buffer;
}

export interface ParsedSignedData {
  eContentType: string;
  eContent?: Buffer;
  certificates: Buffer[];
  signer: ParsedSignerInfo;
}

function attributes(d: Buffer, t: Tlv): Map<string, Tlv[]> {
  const out = new Map<string, Tlv[]>();
  for (const a of children(d, t, MAX_ATTRS)) {
    const [typeT, valuesT, ...rest] = children(d, expect(a, TAG.SEQUENCE), 2);
    if (rest.length) throw new DerError("bad attribute");
    const type = oidOf(d, typeT!);
    if (out.has(type)) throw new DerError("repeated attribute");
    out.set(type, children(d, expect(valuesT, TAG.SET), 8));
  }
  return out;
}

function single(attrs: Map<string, Tlv[]>, type: string): Tlv | undefined {
  const v = attrs.get(type);
  if (!v) return undefined;
  if (v.length !== 1) throw new DerError("attribute must have one value");
  return v[0];
}

function signerInfo(d: Buffer, t: Tlv): ParsedSignerInfo {
  const f = children(d, expect(t, TAG.SEQUENCE), 7);
  let i = 0;
  smallIntOf(d, f[i++]!);
  const sidT = f[i++]!;
  let sid: SignerId;
  if (sidT.tag === TAG.SEQUENCE) {
    const [iss, ser, ...rest] = children(d, sidT, 2);
    if (rest.length) throw new DerError("bad signer id");
    sid = { issuer: encodingOf(d, expect(iss, TAG.SEQUENCE)), serial: integerOf(d, ser!) };
  } else if (sidT.tag === 0x80) sid = { ski: bytesOf(d, sidT) };
  else throw new DerError("bad signer id");
  const digest = hashOf(d, f[i++]!);
  const saT = f[i++];
  if (!saT || saT.tag !== 0xa0) throw new DerError("signed attributes are required");
  const sigAlgT = expect(f[i++], TAG.SEQUENCE);
  const sigT = expect(f[i++], TAG.OCTET_STRING);
  const uaT = f[i];
  if (uaT && (uaT.tag !== 0xa1 || i !== f.length - 1)) throw new DerError("bad signer info");

  const attrs = attributes(d, saT);
  const ct = single(attrs, OID.CONTENT_TYPE);
  const md = single(attrs, OID.MESSAGE_DIGEST);
  if (!ct || !md) throw new DerError("contentType and messageDigest are required");
  const st = single(attrs, OID.SIGNING_TIME);
  const ess = single(attrs, OID.SIGNING_CERT_V2);
  const signedAttrs = Buffer.from(encodingOf(d, saT));
  signedAttrs[0] = TAG.SET;

  const out: ParsedSignerInfo = {
    sid,
    digest,
    signedAttrs,
    contentType: oidOf(d, ct),
    messageDigest: bytesOf(d, expect(md, TAG.OCTET_STRING)),
    sigAlg: { d, t: sigAlgT },
    signature: bytesOf(d, sigT),
  };
  if (st) out.signingTime = timeOf(d, st);
  if (ess) {
    const [certs] = children(d, expect(ess, TAG.SEQUENCE), 2);
    const [first] = children(d, expect(certs, TAG.SEQUENCE), 16);
    const parts = children(d, expect(first, TAG.SEQUENCE), 3);
    let hash: PadesHash = "sha256";
    let j = 0;
    if (parts[0]?.tag === TAG.SEQUENCE) hash = hashOf(d, parts[j++]!);
    out.essCert = { hash, certHash: bytesOf(d, expect(parts[j], TAG.OCTET_STRING)) };
  }
  if (uaT) {
    const ua = attributes(d, uaT);
    const tst = single(ua, OID.TIMESTAMP_TOKEN);
    if (tst) out.timestampToken = encodingOf(d, expect(tst, TAG.SEQUENCE));
  }
  return out;
}

/** Parses a DER ContentInfo holding SignedData with exactly one SignerInfo. */
export function parseSignedData(input: Uint8Array): ParsedSignedData {
  const d = Buffer.from(input);
  const [ctT, contentT, ...rest] = children(d, expect(readOne(d), TAG.SEQUENCE), 2);
  if (rest.length || oidOf(d, ctT!) !== OID.SIGNED_DATA || contentT?.tag !== 0xa0)
    throw new DerError("not SignedData");
  const [sdT, ...more] = children(d, contentT, 1);
  if (more.length) throw new DerError("bad SignedData");
  const f = children(d, expect(sdT, TAG.SEQUENCE), 6);
  let i = 0;
  smallIntOf(d, f[i++]!);
  children(d, expect(f[i++], TAG.SET), 8);
  const eci = children(d, expect(f[i++], TAG.SEQUENCE), 2);
  const eContentType = oidOf(d, eci[0]!);
  let eContent: Buffer | undefined;
  if (eci[1]) {
    if (eci[1].tag !== 0xa0) throw new DerError("bad encapsulated content");
    const [oct, ...x] = children(d, eci[1], 1);
    if (x.length) throw new DerError("bad encapsulated content");
    eContent = bytesOf(d, expect(oct, TAG.OCTET_STRING));
  }
  const certificates: Buffer[] = [];
  if (f[i]?.tag === 0xa0) {
    for (const c of children(d, f[i++]!, MAX_CERTS))
      if (c.tag === TAG.SEQUENCE) certificates.push(Buffer.from(encodingOf(d, c)));
  }
  if (f[i]?.tag === 0xa1) i++;
  const infos = children(d, expect(f[i++], TAG.SET), 2);
  if (i !== f.length) throw new DerError("bad SignedData");
  if (infos.length !== 1) throw new DerError("exactly one signer is required");
  const out: ParsedSignedData = {
    eContentType,
    certificates,
    signer: signerInfo(d, infos[0]!),
  };
  if (eContent) out.eContent = eContent;
  return out;
}

export interface ParsedTstInfo {
  imprintHash: PadesHash;
  imprint: Buffer;
  genTime: Date;
}

/** Parses an RFC 3161 TSTInfo. */
export function parseTstInfo(input: Uint8Array): ParsedTstInfo {
  const d = Buffer.from(input);
  const f = children(d, expect(readOne(d), TAG.SEQUENCE), 10);
  if (smallIntOf(d, f[0]!) !== 1) throw new DerError("bad TSTInfo version");
  oidOf(d, f[1]!);
  const [algT, hT, ...rest] = children(d, expect(f[2], TAG.SEQUENCE), 2);
  if (rest.length) throw new DerError("bad message imprint");
  integerOf(d, f[3]!);
  return {
    imprintHash: hashOf(d, algT!),
    imprint: bytesOf(d, expect(hT, TAG.OCTET_STRING)),
    genTime: timeOf(d, expect(f[4], TAG.GENERALIZED_TIME)),
  };
}
