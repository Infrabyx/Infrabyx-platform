// Tests only (`@infrabyx/crypto/pades-test`; C-28, R1-D-246): a throwaway certification authority
// for the PAdES/CMS verifier. It makes a root, an intermediate, a timestamp authority, an OCSP
// responder and signers at test time (no key or certificate is committed), signs PDFs as an
// incremental update with a CAdES-detached CMS signature, and makes RFC 3161 tokens, CRLs and
// OCSP responses. Nothing it makes chains to the pinned CCA India store: pass `trust` (a
// `customTrustStore`), which production code never does. Certificates are minimal DER signed with
// node:crypto. Test names only; no personal data.
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  constants,
  type KeyObject,
} from "node:crypto";
import { bitStringOf, children, readOne } from "./der.js";
import { customTrustStore, type PadesTrustStore } from "./pades.js";

type Hash = "sha256" | "sha384" | "sha512";
export type PadesTestKeyKind = "rsa" | "ec256" | "ec384";

// ---------------------------------------------------------------- DER writer

const lenBytes = (n: number): number[] => {
  if (n < 0x80) return [n];
  const out: number[] = [];
  for (let x = n; x > 0; x = Math.floor(x / 256)) out.unshift(x & 0xff);
  return [0x80 | out.length, ...out];
};
export const der = (tag: number, ...parts: Uint8Array[]): Buffer => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag, ...lenBytes(body.length)]), body]);
};
const seq = (...p: Uint8Array[]) => der(0x30, ...p);
const set = (...p: Uint8Array[]) => der(0x31, ...[...p].sort(Buffer.compare));
const octet = (b: Uint8Array) => der(0x04, b);
const nul = () => Buffer.from([0x05, 0x00]);
const bool = (v: boolean) => der(0x01, Buffer.from([v ? 0xff : 0]));
const bits = (b: Uint8Array, unused = 0) => der(0x03, Buffer.from([unused]), b);
export const oid = (dotted: string): Buffer => {
  const [a, b, ...rest] = dotted.split(".").map(Number);
  const out = [a! * 40 + b!];
  for (const v of rest) {
    const groups = [v % 128];
    for (let x = Math.floor(v / 128); x > 0; x = Math.floor(x / 128))
      groups.unshift((x % 128) | 0x80);
    out.push(...groups);
  }
  return der(0x06, Buffer.from(out));
};
const int = (v: number | Uint8Array): Buffer => {
  let b =
    typeof v === "number"
      ? Buffer.from(
          v
            .toString(16)
            .padStart(2, "0")
            .replace(/^(.)((..)*)$/, "0$1$2"),
          "hex",
        )
      : Buffer.from(v);
  while (b.length > 1 && b[0] === 0 && !(b[1]! & 0x80)) b = b.subarray(1);
  if (b[0]! & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return der(0x02, b);
};
const utc = (d: Date) =>
  d.getUTCFullYear() < 2050
    ? der(0x17, Buffer.from(`${d.toISOString().slice(2, 19).replace(/[-:T]/g, "")}Z`))
    : gen(d);
const gen = (d: Date) =>
  der(0x18, Buffer.from(`${d.toISOString().slice(0, 19).replace(/[-:T]/g, "")}Z`));
const name = (cn: string) =>
  seq(
    set(seq(oid("2.5.4.6"), der(0x13, Buffer.from("IN")))),
    set(seq(oid("2.5.4.10"), der(0x0c, Buffer.from("Infrabyx Test")))),
    set(seq(oid("2.5.4.3"), der(0x0c, Buffer.from(cn)))),
  );

const O = {
  DATA: "1.2.840.113549.1.7.1",
  SIGNED_DATA: "1.2.840.113549.1.7.2",
  TST_INFO: "1.2.840.113549.1.9.16.1.4",
  CONTENT_TYPE: "1.2.840.113549.1.9.3",
  MESSAGE_DIGEST: "1.2.840.113549.1.9.4",
  SIGNING_TIME: "1.2.840.113549.1.9.5",
  SIGNING_CERT_V2: "1.2.840.113549.1.9.16.2.47",
  TIMESTAMP_TOKEN: "1.2.840.113549.1.9.16.2.14",
  OCSP_BASIC: "1.3.6.1.5.5.7.48.1.1",
} as const;
const HASH_OID: Record<Hash, string> = {
  sha256: "2.16.840.1.101.3.4.2.1",
  sha384: "2.16.840.1.101.3.4.2.2",
  sha512: "2.16.840.1.101.3.4.2.3",
};
const PKCS1_OID: Record<Hash, string> = {
  sha256: "1.2.840.113549.1.1.11",
  sha384: "1.2.840.113549.1.1.12",
  sha512: "1.2.840.113549.1.1.13",
};
const ECDSA_OID: Partial<Record<Hash, string>> = {
  sha256: "1.2.840.10045.4.3.2",
  sha384: "1.2.840.10045.4.3.3",
};
const hashAlg = (h: Hash) => seq(oid(HASH_OID[h]), nul());
const digest = (h: Hash, ...p: Uint8Array[]) => {
  const x = createHash(h);
  for (const b of p) x.update(b);
  return x.digest();
};

// ---------------------------------------------------------------- keys and certificates

export interface TestKey {
  kind: PadesTestKeyKind;
  privateKey: KeyObject;
  publicKey: KeyObject;
}

export function testKey(kind: PadesTestKeyKind = "rsa"): TestKey {
  const k =
    kind === "rsa"
      ? generateKeyPairSync("rsa", { modulusLength: 2048 })
      : generateKeyPairSync("ec", { namedCurve: kind === "ec256" ? "prime256v1" : "secp384r1" });
  return { kind, ...k };
}

const defaultHash = (k: TestKey): Hash => (k.kind === "ec384" ? "sha384" : "sha256");

interface SigOpts {
  hash?: Hash;
  pss?: boolean;
  /** Replaces the AlgorithmIdentifier OID (to test refusals). */
  algOid?: string;
}

function sigAlgId(k: TestKey, o: SigOpts): Buffer {
  const h = o.hash ?? defaultHash(k);
  if (o.algOid) return seq(oid(o.algOid), ...(k.kind === "rsa" ? [nul()] : []));
  if (k.kind !== "rsa") return seq(oid(ECDSA_OID[h]!));
  if (!o.pss) return seq(oid(PKCS1_OID[h]), nul());
  return seq(
    oid("1.2.840.113549.1.1.10"),
    seq(
      der(0xa0, hashAlg(h)),
      der(0xa1, seq(oid("1.2.840.113549.1.1.8"), hashAlg(h))),
      der(0xa2, int(h === "sha256" ? 32 : h === "sha384" ? 48 : 64)),
    ),
  );
}

function signWith(k: TestKey, data: Uint8Array, o: SigOpts): Buffer {
  const h = o.hash ?? defaultHash(k);
  if (k.kind !== "rsa") return sign(h, data, { key: k.privateKey, dsaEncoding: "der" });
  if (o.pss)
    return sign(h, data, {
      key: k.privateKey,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: h === "sha256" ? 32 : h === "sha384" ? 48 : 64,
    });
  return sign(h, data, { key: k.privateKey, padding: constants.RSA_PKCS1_PADDING });
}

const keyUsageExt = (usage: number[]) => {
  const max = Math.max(...usage);
  const out = Buffer.alloc((max >> 3) + 1);
  for (const b of usage) out[b >> 3]! |= 0x80 >> (b & 7);
  return seq(oid("2.5.29.15"), bool(true), octet(bits(out, 7 - (max & 7))));
};

export interface TestCertSpec {
  subject: string;
  issuer: string;
  key: TestKey;
  issuerKey: TestKey;
  hash?: Hash;
  pss?: boolean;
  algOid?: string;
  ca?: boolean;
  pathLen?: number;
  /** Key usage bits (0 digitalSignature, 1 nonRepudiation, 5 keyCertSign, 6 cRLSign); [] omits it. */
  keyUsage?: number[];
  eku?: string[];
  ski?: Buffer;
  /** Adds a critical extension the verifier does not know. */
  unknownCritical?: boolean;
  /** Adds a critical extension with each of these OIDs and an empty value (refusal tests). */
  criticalOids?: string[];
  notBefore?: Date;
  notAfter?: Date;
}

export interface TestCert {
  der: Buffer;
  serial: Buffer;
  subject: Buffer;
  /** The issuer Name DER. */
  issuer: Buffer;
  ski?: Buffer;
  key: TestKey;
}

export function testCertificate(s: TestCertSpec): TestCert {
  const exts: Buffer[] = [];
  if (s.ca)
    exts.push(
      seq(
        oid("2.5.29.19"),
        bool(true),
        octet(seq(bool(true), ...(s.pathLen === undefined ? [] : [int(s.pathLen)]))),
      ),
    );
  const ku = s.keyUsage ?? (s.ca ? [5, 6] : [0, 1]);
  if (ku.length) exts.push(keyUsageExt(ku));
  if (s.eku?.length) exts.push(seq(oid("2.5.29.37"), octet(seq(...s.eku.map(oid)))));
  if (s.ski) exts.push(seq(oid("2.5.29.14"), octet(octet(s.ski))));
  if (s.unknownCritical) exts.push(seq(oid("1.3.6.1.4.1.99999.1"), bool(true), octet(nul())));
  for (const o of s.criticalOids ?? []) exts.push(seq(oid(o), bool(true), octet(seq())));
  const serial = Buffer.concat([Buffer.from([0x01]), randomBytes(9)]);
  const alg = sigAlgId(s.issuerKey, s);
  const subject = name(s.subject);
  const tbs = seq(
    der(0xa0, int(2)),
    int(serial),
    alg,
    name(s.issuer),
    seq(
      utc(s.notBefore ?? new Date(Date.now() - 86_400_000)),
      utc(s.notAfter ?? new Date(Date.now() + 365 * 86_400_000)),
    ),
    subject,
    s.key.publicKey.export({ type: "spki", format: "der" }),
    ...(exts.length ? [der(0xa3, seq(...exts))] : []),
  );
  const sig = signWith(s.issuerKey, tbs, s);
  return {
    der: seq(tbs, alg, bits(sig)),
    serial,
    subject,
    issuer: name(s.issuer),
    ...(s.ski ? { ski: s.ski } : {}),
    key: s.key,
  };
}

export const pem = (d: Uint8Array): string =>
  `-----BEGIN CERTIFICATE-----\n${Buffer.from(d)
    .toString("base64")
    .replace(/(.{64})/g, "$1\n")
    .replace(/\n$/, "")}\n-----END CERTIFICATE-----\n`;

// ---------------------------------------------------------------- PDF

/** A minimal one-page PDF (classic cross-reference table). */
export function minimalPdf(): Buffer {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>",
  ];
  let out = "%PDF-1.7\n%\xe2\xe3\xcf\xd3\n";
  const off: number[] = [];
  objs.forEach((o, i) => {
    off.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

function trailerOf(s: string): { size: number; root: number; prev: number } {
  const t = s.lastIndexOf("trailer");
  const dict = s.slice(t);
  const size = Number(/\/Size\s+(\d+)/.exec(dict)?.[1]);
  const root = Number(/\/Root\s+(\d+)\s+0\s+R/.exec(dict)?.[1]);
  const prev = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(s)?.[1]);
  if (!size || !root || Number.isNaN(prev)) throw new Error("not a classic-xref PDF");
  return { size, root, prev };
}

/** Appends an incremental update with one new object (a change after any signature). */
export function appendIncrementalUpdate(pdf: Uint8Array): Buffer {
  const s = Buffer.from(pdf).toString("latin1");
  const { size, root, prev } = trailerOf(s);
  let out = s.endsWith("\n") ? s : `${s}\n`;
  const at = out.length;
  out += `${size} 0 obj\n<< /Note (appended after signing) >>\nendobj\n`;
  const x = out.length;
  out += `xref\n0 1\n0000000000 65535 f \n${size} 1\n${String(at).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${size + 1} /Root ${root} 0 R /Prev ${prev} >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const pdfDate = (d: Date) => `D:${d.toISOString().slice(0, 19).replace(/[-:T]/g, "")}Z`;

// ---------------------------------------------------------------- the authority

export interface TestSigner extends TestCert {
  /** The issuing CA's certificate DER, included in the CMS by default. */
  chain: Buffer[];
}

export interface PadesTestSignOptions {
  signer?: TestSigner;
  hash?: Hash;
  pss?: boolean;
  /** `/SubFilter` (default `ETSI.CAdES.detached`). */
  subFilter?: string;
  /** A signed `signingTime` attribute (default none, as PAdES B-B). */
  signingTime?: Date;
  /** The dictionary's `/M` (default now); null omits it. */
  m?: Date | null;
  /** A B-T signature timestamp from the test TSA. */
  timestamp?: boolean | { at?: Date; wrongImprint?: boolean; tsa?: TestSigner };
  /** Replace the CMS digest or signature AlgorithmIdentifier OID (refusal tests). */
  digestOid?: string;
  sigAlgOid?: string;
  /** ESS signing-certificate-v2 (default true); `wrong` hashes another value. */
  ess?: boolean | "wrong";
  /** Certificates in the CMS: signer and its chain (default), signer only, or none. */
  certificates?: "chain" | "signer" | "none";
  /** Identify the signer by subject key identifier (it must have one). */
  sidBySki?: boolean;
  /** Bytes reserved for the CMS (default 24 KiB). */
  contentsBytes?: number;
}

export interface PadesTestAuthority {
  root: TestCert;
  intermediate: TestCert;
  rootPem: string;
  intermediatePem: string;
  /** A custom store with this root and intermediate pinned. */
  trust: PadesTrustStore;
  /** The default signer (RSA, digitalSignature and nonRepudiation). */
  signer: TestSigner;
  tsa: TestSigner;
  newSigner(o?: {
    kind?: PadesTestKeyKind;
    keyUsage?: number[];
    eku?: string[];
    notBefore?: Date;
    notAfter?: Date;
    /** Issued by the root directly, or by an unpinned CA under the intermediate. */
    issuer?: "intermediate" | "root" | "unpinned";
    ski?: Buffer;
    unknownCritical?: boolean;
    /** The certificate signature algorithm OID (refusal tests). */
    algOid?: string;
    /** The subject common name (default "Test PAdES Signer"); test names only. */
    subject?: string;
  }): TestSigner;
  sign(pdf: Uint8Array, o?: PadesTestSignOptions): Buffer;
  /** A CRL issued by the intermediate (or `issuer`). */
  crl(o?: {
    revoked?: Buffer[];
    thisUpdate?: Date;
    nextUpdate?: Date | null;
    issuer?: "intermediate" | "root";
    wrongKey?: boolean;
    critical?: boolean;
  }): Buffer;
  /** An OCSP response about `serial` from the intermediate (or a delegated responder). */
  ocsp(
    serial: Buffer,
    o?: {
      status?: "good" | "revoked" | "unknown";
      thisUpdate?: Date;
      nextUpdate?: Date | null;
      responder?: "ca" | "delegated" | "untrusted";
      certIdHash?: "sha1" | "sha256";
      responseStatus?: number;
    },
  ): Buffer;
}

export function padesTestAuthority(o: { kind?: PadesTestKeyKind } = {}): PadesTestAuthority {
  const rootKey = testKey(o.kind ?? "rsa");
  const interKey = testKey(o.kind ?? "rsa");
  const root = testCertificate({
    subject: "Test PAdES Root CA",
    issuer: "Test PAdES Root CA",
    key: rootKey,
    issuerKey: rootKey,
    ca: true,
    notBefore: new Date(Date.now() - 3650 * 86_400_000),
    notAfter: new Date(Date.now() + 3650 * 86_400_000),
  });
  const intermediate = testCertificate({
    subject: "Test PAdES Sub CA",
    issuer: "Test PAdES Root CA",
    key: interKey,
    issuerKey: rootKey,
    ca: true,
    pathLen: 0,
    notBefore: new Date(Date.now() - 1825 * 86_400_000),
    notAfter: new Date(Date.now() + 1825 * 86_400_000),
  });
  let unpinned: TestCert | undefined;
  const newSigner: PadesTestAuthority["newSigner"] = (s = {}) => {
    const key = testKey(s.kind ?? "rsa");
    let issuerName = "Test PAdES Sub CA";
    let issuerKey = interKey;
    let chain = [intermediate.der];
    if (s.issuer === "root") {
      issuerName = "Test PAdES Root CA";
      issuerKey = rootKey;
      chain = [];
    } else if (s.issuer === "unpinned") {
      unpinned ??= testCertificate({
        subject: "Test PAdES Unpinned CA",
        issuer: "Test PAdES Sub CA",
        key: testKey("rsa"),
        issuerKey: interKey,
        ca: true,
      });
      issuerName = "Test PAdES Unpinned CA";
      issuerKey = unpinned.key;
      chain = [unpinned.der, intermediate.der];
    }
    const c = testCertificate({
      subject: s.subject ?? "Test PAdES Signer",
      issuer: issuerName,
      key,
      issuerKey,
      keyUsage: s.keyUsage ?? [0, 1],
      ...(s.eku ? { eku: s.eku } : {}),
      ...(s.ski ? { ski: s.ski } : {}),
      ...(s.unknownCritical ? { unknownCritical: true } : {}),
      ...(s.algOid ? { algOid: s.algOid } : {}),
      ...(s.notBefore ? { notBefore: s.notBefore } : {}),
      ...(s.notAfter ? { notAfter: s.notAfter } : {}),
    });
    return { ...c, chain };
  };
  const tsaKey = testKey("rsa");
  const tsa: TestSigner = {
    ...testCertificate({
      subject: "Test PAdES TSA",
      issuer: "Test PAdES Sub CA",
      key: tsaKey,
      issuerKey: interKey,
      keyUsage: [0],
      eku: ["1.3.6.1.5.5.7.3.8"],
    }),
    chain: [intermediate.der],
  };
  const signer = newSigner();

  const signedData = (p: {
    signer: TestSigner;
    hash: Hash;
    pss?: boolean;
    eContentType: string;
    eContent?: Buffer;
    messageDigest: Buffer;
    signingTime?: Date;
    ess: boolean | "wrong";
    digestOid?: string;
    sigAlgOid?: string;
    certificates: "chain" | "signer" | "none";
    sidBySki?: boolean;
  }): Buffer => {
    const attrs = [
      seq(oid(O.CONTENT_TYPE), set(oid(p.eContentType))),
      seq(oid(O.MESSAGE_DIGEST), set(octet(p.messageDigest))),
    ];
    if (p.signingTime) attrs.push(seq(oid(O.SIGNING_TIME), set(utc(p.signingTime))));
    if (p.ess) {
      const h =
        p.ess === "wrong" ? digest("sha256", Buffer.from("other")) : digest("sha256", p.signer.der);
      attrs.push(seq(oid(O.SIGNING_CERT_V2), set(seq(seq(seq(octet(h)))))));
    }
    const signedAttrs = set(...attrs);
    const sigOpts: SigOpts = { hash: p.hash, ...(p.pss ? { pss: true } : {}) };
    const signature = signWith(p.signer.key, signedAttrs, sigOpts);
    const digestAlg = p.digestOid ? seq(oid(p.digestOid), nul()) : hashAlg(p.hash);
    if (p.sidBySki && !p.signer.ski) throw new Error("the signer has no subject key identifier");
    const sid = p.sidBySki ? der(0x80, p.signer.ski!) : seq(p.signer.issuer, int(p.signer.serial));
    const si = seq(
      int(p.sidBySki ? 3 : 1),
      sid,
      digestAlg,
      der(0xa0, ...[...attrs].sort(Buffer.compare)),
      p.sigAlgOid
        ? seq(oid(p.sigAlgOid), ...(p.signer.key.kind === "rsa" ? [nul()] : []))
        : sigAlgId(p.signer.key, sigOpts),
      octet(signature),
    );
    const certs =
      p.certificates === "none"
        ? []
        : p.certificates === "signer"
          ? [p.signer.der]
          : [p.signer.der, ...p.signer.chain];
    const eci = p.eContent
      ? seq(oid(p.eContentType), der(0xa0, octet(p.eContent)))
      : seq(oid(p.eContentType));
    const sd = seq(
      int(p.sidBySki ? 3 : 1),
      set(digestAlg),
      eci,
      ...(certs.length ? [der(0xa0, ...certs)] : []),
      set(si),
    );
    return seq(oid(O.SIGNED_DATA), der(0xa0, sd));
  };

  const timestampToken = (
    sigValue: Buffer,
    t: { at?: Date; wrongImprint?: boolean; tsa?: TestSigner },
  ) => {
    const imprint = digest("sha256", t.wrongImprint ? Buffer.from("other") : sigValue);
    const tst = seq(
      int(1),
      oid("1.3.6.1.4.1.99999.2"),
      seq(hashAlg("sha256"), octet(imprint)),
      int(randomBytes(8)),
      gen(t.at ?? new Date()),
    );
    return signedData({
      signer: t.tsa ?? tsa,
      hash: "sha256",
      eContentType: O.TST_INFO,
      eContent: tst,
      messageDigest: digest("sha256", tst),
      ess: true,
      certificates: "chain",
    });
  };

  const sign: PadesTestAuthority["sign"] = (input, s = {}) => {
    const who = s.signer ?? signer;
    const hash = s.hash ?? defaultHash(who.key);
    const src = Buffer.from(input).toString("latin1");
    const { size, root: rootObj, prev } = trailerOf(src);
    const catM = new RegExp(`(?:^|\\n)${rootObj} 0 obj\\s*(<<[^]*?>>)\\s*endobj`).exec(src);
    if (!catM) throw new Error("catalog not found");
    const catalog = catM[1]!.replace(/\/AcroForm\s*<<[^]*?>>/, "").replace(/>>\s*$/, "");
    const reserve = (s.contentsBytes ?? 24 * 1024) * 2;
    const placeholder = "0000000000";
    let out = src.endsWith("\n") ? src : `${src}\n`;
    const sigObj = size;
    const fieldObj = size + 1;
    const offs: Record<number, number> = {};
    offs[sigObj] = out.length;
    const m = s.m === null ? "" : ` /M (${pdfDate(s.m ?? new Date())})`;
    out += `${sigObj} 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /${s.subFilter ?? "ETSI.CAdES.detached"}${m} /ByteRange [0 ${placeholder} ${placeholder} ${placeholder}] /Contents <`;
    const b = out.length - 1;
    out += `${"0".repeat(reserve)}>`;
    const c = out.length;
    out += " >>\nendobj\n";
    offs[fieldObj] = out.length;
    out += `${fieldObj} 0 obj\n<< /FT /Sig /T (Signature${sigObj}) /V ${sigObj} 0 R /Type /Annot /Subtype /Widget /Rect [0 0 0 0] /F 132 >>\nendobj\n`;
    offs[rootObj] = out.length;
    out += `${rootObj} 0 obj\n${catalog} /AcroForm << /Fields [${fieldObj} 0 R] /SigFlags 3 >> >>\nendobj\n`;
    const x = out.length;
    const entry = (o: number) => `${String(o).padStart(10, "0")} 00000 n \n`;
    out += `xref\n0 1\n0000000000 65535 f \n${rootObj} 1\n${entry(offs[rootObj])}${sigObj} 2\n${entry(offs[sigObj])}${entry(offs[fieldObj])}`;
    out += `trailer\n<< /Size ${size + 2} /Root ${rootObj} 0 R /Prev ${prev} >>\nstartxref\n${x}\n%%EOF\n`;
    const d = out.length - c;
    const br = `[0 ${String(b).padEnd(10)} ${String(c).padEnd(10)} ${String(d).padEnd(10)}]`;
    out = out.replace(`[0 ${placeholder} ${placeholder} ${placeholder}]`, br);
    const pdf = Buffer.from(out, "latin1");
    const md = digest(hash, pdf.subarray(0, b), pdf.subarray(c));
    const unsigned: Buffer[] = [];
    const cms = () =>
      signedData({
        signer: who,
        hash,
        ...(s.pss ? { pss: true } : {}),
        eContentType: O.DATA,
        messageDigest: md,
        ...(s.signingTime ? { signingTime: s.signingTime } : {}),
        ess: s.ess ?? true,
        ...(s.digestOid ? { digestOid: s.digestOid } : {}),
        ...(s.sigAlgOid ? { sigAlgOid: s.sigAlgOid } : {}),
        certificates: s.certificates ?? "chain",
        ...(s.sidBySki ? { sidBySki: true } : {}),
      });
    let token = cms();
    if (s.timestamp) {
      // The signature value is deterministic for RSA PKCS#1 v1.5 but not for ECDSA or PSS, so
      // the token is made over the signature value of the CMS actually embedded.
      const sigValue = signatureValueOf(token);
      const t = typeof s.timestamp === "object" ? s.timestamp : {};
      unsigned.push(seq(oid(O.TIMESTAMP_TOKEN), set(timestampToken(sigValue, t))));
      token = withUnsigned(token, unsigned);
    }
    const hex = token.toString("hex");
    if (hex.length > reserve) throw new Error("contentsBytes too small");
    pdf.write(hex.padEnd(reserve, "0"), b + 1, "latin1");
    return pdf;
  };

  const crl: PadesTestAuthority["crl"] = (c = {}) => {
    const issuerKey = c.issuer === "root" ? rootKey : interKey;
    const signKey = c.wrongKey ? testKey("rsa") : issuerKey;
    const now = Date.now();
    const entries = (c.revoked ?? []).map((s) => seq(int(s), utc(new Date(now - 3600_000))));
    const tbs = seq(
      int(1),
      sigAlgId(signKey, {}),
      name(c.issuer === "root" ? "Test PAdES Root CA" : "Test PAdES Sub CA"),
      utc(c.thisUpdate ?? new Date(now - 3600_000)),
      ...(c.nextUpdate === null ? [] : [utc(c.nextUpdate ?? new Date(now + 7 * 86_400_000))]),
      ...(entries.length ? [seq(...entries)] : []),
      ...(c.critical ? [der(0xa0, seq(seq(oid("2.5.29.28"), bool(true), octet(seq()))))] : []),
    );
    return seq(tbs, sigAlgId(signKey, {}), bits(signWith(signKey, tbs, {})));
  };

  let responder: TestCert | undefined;
  const ocsp: PadesTestAuthority["ocsp"] = (serial, r = {}) => {
    const now = Date.now();
    let signKey = interKey;
    const certs: Buffer[] = [];
    if (r.responder === "delegated" || r.responder === "untrusted") {
      responder ??= testCertificate({
        subject: "Test PAdES OCSP Responder",
        issuer: "Test PAdES Sub CA",
        key: testKey("rsa"),
        issuerKey: interKey,
        keyUsage: [0],
        eku: ["1.3.6.1.5.5.7.3.9"],
      });
      signKey = r.responder === "untrusted" ? testKey("rsa") : responder.key;
      certs.push(responder.der);
    }
    const spki = interKey.publicKey.export({ type: "spki", format: "der" });
    const [, keyBits] = children(spki, readOne(spki));
    const subjectKeyBits = bitStringOf(spki, keyBits!).bytes;
    const certId =
      r.certIdHash === "sha1"
        ? seq(
            seq(oid("1.3.14.3.2.26"), nul()),
            octet(randomBytes(20)),
            octet(randomBytes(20)),
            int(serial),
          )
        : seq(
            hashAlg("sha256"),
            octet(digest("sha256", name("Test PAdES Sub CA"))),
            octet(digest("sha256", subjectKeyBits)),
            int(serial),
          );
    const status =
      r.status === "revoked"
        ? der(0xa1, gen(new Date(now - 3600_000)))
        : r.status === "unknown"
          ? Buffer.from([0x82, 0x00])
          : Buffer.from([0x80, 0x00]);
    const single = seq(
      certId,
      status,
      gen(r.thisUpdate ?? new Date(now - 60_000)),
      ...(r.nextUpdate === null
        ? []
        : [der(0xa0, gen(r.nextUpdate ?? new Date(now + 86_400_000)))]),
    );
    const tbs = seq(der(0xa1, name("Test PAdES Sub CA")), gen(new Date(now - 60_000)), seq(single));
    const basic = seq(
      tbs,
      sigAlgId(signKey, {}),
      bits(signWith(signKey, tbs, {})),
      ...(certs.length ? [der(0xa0, seq(...certs))] : []),
    );
    return seq(
      der(0x0a, Buffer.from([r.responseStatus ?? 0])),
      der(0xa0, seq(oid(O.OCSP_BASIC), octet(basic))),
    );
  };

  return {
    root,
    intermediate,
    rootPem: pem(root.der),
    intermediatePem: pem(intermediate.der),
    trust: customTrustStore({ roots: [root.der], intermediates: [intermediate.der] }),
    signer,
    tsa,
    newSigner,
    sign,
    crl,
    ocsp,
  };
}

// ---------------------------------------------------------------- CMS surgery for the B-T token

const tlvAt = (b: Buffer, at: number): { body: number; end: number } => {
  const first = b[at + 1]!;
  if (!(first & 0x80)) return { body: at + 2, end: at + 2 + first };
  const k = first & 0x7f;
  let n = 0;
  for (let i = 0; i < k; i++) n = n * 256 + b[at + 2 + i]!;
  return { body: at + 2 + k, end: at + 2 + k + n };
};
const kids = (b: Buffer, at: number): number[] => {
  const t = tlvAt(b, at);
  const out: number[] = [];
  for (let p = t.body; p < t.end; p = tlvAt(b, p).end) out.push(p);
  return out;
};

/** The SignerInfo of a test ContentInfo: [ContentInfo → [0] → SignedData → last SET → first]. */
function signerInfoOf(ci: Buffer): number {
  const [, ctx] = kids(ci, 0);
  const [sd] = kids(ci, ctx!);
  const sdKids = kids(ci, sd!);
  const [si] = kids(ci, sdKids[sdKids.length - 1]!);
  return si!;
}

function signatureValueOf(ci: Buffer): Buffer {
  const parts = kids(ci, signerInfoOf(ci));
  const sig = parts.find((p) => ci[p] === 0x04)!;
  const t = tlvAt(ci, sig);
  return ci.subarray(t.body, t.end);
}

function withUnsigned(ci: Buffer, unsigned: Buffer[]): Buffer {
  // Rebuild ContentInfo → SignedData → SignerInfos with the unsigned attributes appended.
  const [ctT, ctx] = kids(ci, 0);
  const [sd] = kids(ci, ctx!);
  const sdKids = kids(ci, sd!);
  const [si] = kids(ci, sdKids[sdKids.length - 1]!);
  const piece = (at: number) => ci.subarray(at, tlvAt(ci, at).end);
  const newSi = seq(...kids(ci, si!).map(piece), der(0xa1, ...unsigned));
  const newSd = seq(...sdKids.slice(0, -1).map(piece), der(0x31, newSi));
  return seq(piece(ctT!), der(0xa0, newSd));
}
