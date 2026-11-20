// Tests only (`@infrabyx/crypto/mtls-test`; PR-UDF-064, R1-D-238): a throwaway certificate
// authority for partner mTLS tests, so products can test `readClientCertificate` and their TLS
// listeners without committing a key or calling `openssl`. Every key is made in memory; nothing it
// issues chains to a real CA. Certificates are minimal X.509 v3 DER, signed with node:crypto: P-256
// with ECDSA-SHA-256 (the approved C-03/C-22 primitive), or P-384 with ECDSA-SHA-384 only to test
// that the pinned-CA check refuses an issuer algorithm it does not accept. Production code never
// imports this module.
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

const der = (tag: number, ...parts: Uint8Array[]): Buffer => {
  const body = Buffer.concat(parts);
  const n = body.length;
  const len =
    n < 0x80
      ? Buffer.from([n])
      : n < 0x100
        ? Buffer.from([0x81, n])
        : Buffer.from([0x82, n >> 8, n & 0xff]);
  return Buffer.concat([Buffer.from([tag]), len, body]);
};
const seq = (...p: Uint8Array[]) => der(0x30, ...p);
const oid = (dotted: string): Buffer => {
  const [a, b, ...rest] = dotted.split(".").map(Number);
  const out = [a! * 40 + b!];
  for (const v of rest) {
    const groups = [v & 0x7f];
    for (let x = v >> 7; x > 0; x >>= 7) groups.unshift((x & 0x7f) | 0x80);
    out.push(...groups);
  }
  return der(0x06, Buffer.from(out));
};
const utc = (d: Date) =>
  der(0x17, Buffer.from(`${d.toISOString().slice(2, 19).replace(/[-:T]/g, "")}Z`));
const ATTR = { CN: "2.5.4.3", O: "2.5.4.10", C: "2.5.4.6" } as const;
const name = (n: TestName) =>
  seq(
    ...(["C", "O", "CN"] as const)
      .filter((k) => n[k] !== undefined)
      .map((k) =>
        der(
          0x31,
          seq(
            oid(ATTR[k]),
            k === "C" ? der(0x13, Buffer.from(n[k]!)) : der(0x0c, Buffer.from(n[k]!)),
          ),
        ),
      ),
  );

/** An X.509 name for a test certificate. */
export interface TestName {
  CN: string;
  O?: string;
  C?: string;
}

/** The key type and signature algorithm of a test authority. */
export type TestKeyType = "p256" | "p384";

const SIG_ALG = {
  p256: { hash: "sha256", oid: "1.2.840.10045.4.3.2", curve: "prime256v1" },
  p384: { hash: "sha384", oid: "1.2.840.10045.4.3.3", curve: "secp384r1" },
} as const;

const EKU = { clientAuth: "1.3.6.1.5.5.7.3.2", serverAuth: "1.3.6.1.5.5.7.3.1" } as const;

interface CertInput {
  subject: TestName;
  issuer: TestName;
  publicKey: KeyObject;
  signer: KeyObject;
  signerType: TestKeyType;
  ca: boolean;
  notBefore: Date;
  notAfter: Date;
  extendedKeyUsage?: readonly (keyof typeof EKU)[];
}

function certificate(c: CertInput): Buffer {
  const alg = seq(oid(SIG_ALG[c.signerType].oid));
  const exts: Buffer[] = [
    c.ca
      ? seq(
          oid("2.5.29.19"),
          der(0x01, Buffer.from([0xff])),
          der(0x04, seq(der(0x01, Buffer.from([0xff])))),
        )
      : seq(oid("2.5.29.19"), der(0x04, seq())),
    // keyUsage: keyCertSign + cRLSign for a CA, digitalSignature for a leaf.
    seq(
      oid("2.5.29.15"),
      der(0x01, Buffer.from([0xff])),
      der(0x04, c.ca ? der(0x03, Buffer.from([0x01, 0x06])) : der(0x03, Buffer.from([0x07, 0x80]))),
    ),
  ];
  if (c.extendedKeyUsage?.length)
    exts.push(seq(oid("2.5.29.37"), der(0x04, seq(...c.extendedKeyUsage.map((k) => oid(EKU[k]))))));
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, Buffer.concat([Buffer.from([0x01]), randomBytes(8)])),
    alg,
    name(c.issuer),
    seq(utc(c.notBefore), utc(c.notAfter)),
    name(c.subject),
    c.publicKey.export({ type: "spki", format: "der" }),
    der(0xa3, seq(...exts)),
  );
  const sig = sign(SIG_ALG[c.signerType].hash, tbs, { key: c.signer, dsaEncoding: "der" });
  return seq(tbs, alg, der(0x03, Buffer.concat([Buffer.from([0]), sig])));
}

// 64-character lines with no empty line before the footer (OpenSSL's PEM reader refuses one).
const pem = (d: Buffer) =>
  `-----BEGIN CERTIFICATE-----\n${d
    .toString("base64")
    .match(/.{1,64}/g)!
    .join("\n")}\n-----END CERTIFICATE-----\n`;

const DAY = 86_400_000;

/** A certificate and its private key, both PEM. */
export interface TestIssued {
  certPem: string;
  /** PKCS #8 PEM of the certificate's key, for a TLS client or server in a test. */
  keyPem: string;
  /** The certificate's DER. */
  der: Buffer;
}

export interface TestIssueOptions {
  /** Default: one day ago. */
  notBefore?: Date;
  /** Default: one year from now. */
  notAfter?: Date;
  /** Default `["clientAuth"]` for a leaf; `[]` leaves the extension out. */
  extendedKeyUsage?: readonly ("clientAuth" | "serverAuth")[];
}

/** A throwaway CA: its own certificate, and leaves and sub-CAs it issues. */
export interface TestCertificateAuthority {
  /** The CA's certificate (self-signed for a root): what a test pins. */
  readonly certPem: string;
  readonly name: TestName;
  /** Issue a leaf certificate (not a CA) on a new P-256 key. */
  issue(subject: TestName, o?: TestIssueOptions): TestIssued;
  /** Issue an intermediate CA on a new key of `keyType` (default p256). */
  intermediate(
    subject: TestName,
    o?: { keyType?: TestKeyType; notBefore?: Date; notAfter?: Date },
  ): TestCertificateAuthority;
}

function authority(
  subject: TestName,
  key: { publicKey: KeyObject; privateKey: KeyObject },
  keyType: TestKeyType,
  certDer: Buffer,
): TestCertificateAuthority {
  return {
    certPem: pem(certDer),
    name: subject,
    issue(leafSubject, o = {}) {
      const k = generateKeyPairSync("ec", { namedCurve: SIG_ALG.p256.curve });
      const d = certificate({
        subject: leafSubject,
        issuer: subject,
        publicKey: k.publicKey,
        signer: key.privateKey,
        signerType: keyType,
        ca: false,
        notBefore: o.notBefore ?? new Date(Date.now() - DAY),
        notAfter: o.notAfter ?? new Date(Date.now() + 365 * DAY),
        extendedKeyUsage: o.extendedKeyUsage ?? ["clientAuth"],
      });
      return {
        certPem: pem(d),
        keyPem: k.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        der: d,
      };
    },
    intermediate(sub, o = {}) {
      const t = o.keyType ?? "p256";
      const k = generateKeyPairSync("ec", { namedCurve: SIG_ALG[t].curve });
      const d = certificate({
        subject: sub,
        issuer: subject,
        publicKey: k.publicKey,
        signer: key.privateKey,
        signerType: keyType,
        ca: true,
        notBefore: o.notBefore ?? new Date(Date.now() - DAY),
        notAfter: o.notAfter ?? new Date(Date.now() + 5 * 365 * DAY),
      });
      return authority(sub, k, t, d);
    },
  };
}

/**
 * A new self-signed test root on a key of `keyType` (default p256: ECDSA P-256, SHA-256, the
 * algorithm the pinned-CA check accepts; p384 makes a root whose signatures it refuses).
 */
export function mtlsTestAuthority(
  subject: TestName = { CN: "Test Partner Root CA", O: "Test Partner" },
  o: { keyType?: TestKeyType; notBefore?: Date; notAfter?: Date } = {},
): TestCertificateAuthority {
  const t = o.keyType ?? "p256";
  const k = generateKeyPairSync("ec", { namedCurve: SIG_ALG[t].curve });
  const d = certificate({
    subject,
    issuer: subject,
    publicKey: k.publicKey,
    signer: k.privateKey,
    signerType: t,
    ca: true,
    notBefore: o.notBefore ?? new Date(Date.now() - DAY),
    notAfter: o.notAfter ?? new Date(Date.now() + 10 * 365 * DAY),
  });
  return authority(subject, k, t, d);
}

/**
 * The value an edge forwards for `pem` in the platform's header (`docs/platform/mtls-edge-header.md`):
 * the PEM, percent-encoded as `encodeURIComponent` does (so `+`, `/` and `=` are escaped too).
 */
export function edgeHeaderValueForTest(pemText: string): string {
  return encodeURIComponent(pemText);
}
