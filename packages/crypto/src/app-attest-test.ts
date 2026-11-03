// Tests only (`@infrabyx/crypto/app-attest-test`; C-27): a stand-in for Apple's App Attest service.
// It makes a throwaway root and intermediate, and for an app key an attestation object and
// assertions in Apple's format, so verification can be tested without a device. Its root is never
// Apple's, so nothing it makes verifies against the pinned root: pass `roots: [authority.rootPem]`,
// which production code never does. Certificates are minimal DER, signed with node:crypto.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

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
const name = (cn: string) => seq(der(0x31, seq(oid("2.5.4.3"), der(0x0c, Buffer.from(cn)))));
const alg = (hash: "sha256" | "sha384") =>
  seq(oid(hash === "sha256" ? "1.2.840.10045.4.3.2" : "1.2.840.10045.4.3.3"));

interface CertInput {
  subject: string;
  issuer: string;
  publicKey: KeyObject;
  signer: KeyObject;
  hash: "sha256" | "sha384";
  ca?: boolean;
  nonce?: Uint8Array;
  notBefore?: Date;
  notAfter?: Date;
}

function certificate(c: CertInput): Buffer {
  const exts: Buffer[] = [];
  if (c.ca)
    exts.push(
      seq(
        oid("2.5.29.19"),
        der(0x01, Buffer.from([0xff])),
        der(0x04, seq(der(0x01, Buffer.from([0xff])))),
      ),
    );
  if (c.nonce)
    exts.push(seq(oid("1.2.840.113635.100.8.2"), der(0x04, seq(der(0xa1, der(0x04, c.nonce))))));
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, Buffer.concat([Buffer.from([0x01]), randomBytes(8)])),
    alg(c.hash),
    name(c.issuer),
    seq(
      utc(c.notBefore ?? new Date(Date.now() - 86_400_000)),
      utc(c.notAfter ?? new Date(Date.now() + 365 * 86_400_000)),
    ),
    name(c.subject),
    c.publicKey.export({ type: "spki", format: "der" }),
    ...(exts.length ? [der(0xa3, seq(...exts))] : []),
  );
  const sig = sign(c.hash, tbs, { key: c.signer, dsaEncoding: "der" });
  return seq(tbs, alg(c.hash), der(0x03, Buffer.concat([Buffer.from([0]), sig])));
}

const pem = (d: Buffer) =>
  `-----BEGIN CERTIFICATE-----\n${d.toString("base64").replace(/(.{64})/g, "$1\n")}\n-----END CERTIFICATE-----\n`;

const counterBytes = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

// CBOR (RFC 8949) encoder for the shapes Apple uses: maps with text keys, arrays, bytes, integers.
type CborIn = Uint8Array | string | number | CborIn[] | { [k: string]: CborIn };
const head = (major: number, n: number): Buffer =>
  n < 24
    ? Buffer.from([(major << 5) | n])
    : n < 0x100
      ? Buffer.from([(major << 5) | 24, n])
      : n < 0x10000
        ? Buffer.from([(major << 5) | 25, n >> 8, n & 0xff])
        : Buffer.concat([Buffer.from([(major << 5) | 26]), counterBytes(n)]);
export function encodeCbor(v: CborIn): Buffer {
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === "string") {
    const b = Buffer.from(v, "utf8");
    return Buffer.concat([head(3, b.length), b]);
  }
  if (typeof v === "number") return head(0, v);
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(encodeCbor)]);
  const keys = Object.keys(v);
  return Buffer.concat([
    head(5, keys.length),
    ...keys.flatMap((k) => [encodeCbor(k), encodeCbor(v[k]!)]),
  ]);
}

const sha256 = (...p: Uint8Array[]) => {
  const h = createHash("sha256");
  for (const x of p) h.update(x);
  return h.digest();
};

export interface TestAppKey {
  /** base64 of the SHA-256 of the public point, as the app reports it. */
  keyId: string;
  privateKey: KeyObject;
}

export interface AppAttestTestAuthority {
  /** The throwaway root to pass as `roots` in tests. */
  rootPem: string;
  /** A new app key and its attestation for `appId` and `challenge`. */
  attest(
    appId: string,
    challenge: string,
    o?: {
      development?: boolean;
      /** Make a wrong nonce (another challenge), to test refusals. */
      nonceFor?: string;
      counter?: number;
      expired?: boolean;
    },
  ): { attestation: string; key: TestAppKey };
  /** An assertion by `key` for `challenge` with `counter`. */
  assert(appId: string, challenge: string, key: TestAppKey, counter: number): string;
}

export function appAttestTestAuthority(): AppAttestTestAuthority {
  const root = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
  const inter = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
  const rootCert = certificate({
    subject: "Test App Attestation Root CA",
    issuer: "Test App Attestation Root CA",
    publicKey: root.publicKey,
    signer: root.privateKey,
    hash: "sha384",
    ca: true,
  });
  const interCert = certificate({
    subject: "Test App Attestation CA 1",
    issuer: "Test App Attestation Root CA",
    publicKey: inter.publicKey,
    signer: root.privateKey,
    hash: "sha384",
    ca: true,
  });
  return {
    rootPem: pem(rootCert),
    attest(appId, challenge, o = {}) {
      const k = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const jwk = k.publicKey.export({ format: "jwk" }) as { x: string; y: string };
      const point = Buffer.concat([
        Buffer.from([4]),
        Buffer.from(jwk.x, "base64url"),
        Buffer.from(jwk.y, "base64url"),
      ]);
      const keyId = sha256(point);
      const aaguid = o.development
        ? Buffer.from("appattestdevelop")
        : Buffer.concat([Buffer.from("appattest"), Buffer.alloc(7)]);
      const idLen = Buffer.alloc(2);
      idLen.writeUInt16BE(keyId.length);
      const authData = Buffer.concat([
        sha256(Buffer.from(appId)),
        Buffer.from([0x40]),
        counterBytes(o.counter ?? 0),
        aaguid,
        idLen,
        keyId,
      ]);
      const nonce = sha256(authData, sha256(Buffer.from(o.nonceFor ?? challenge, "utf8")));
      const leaf = certificate({
        subject: keyId.toString("hex"),
        issuer: "Test App Attestation CA 1",
        publicKey: k.publicKey,
        signer: inter.privateKey,
        hash: "sha256",
        nonce,
        ...(o.expired
          ? {
              notBefore: new Date(Date.now() - 3 * 86_400_000),
              notAfter: new Date(Date.now() - 86_400_000),
            }
          : {}),
      });
      const attestation = encodeCbor({
        fmt: "apple-appattest",
        attStmt: { x5c: [leaf, interCert], receipt: Buffer.from("test-receipt") },
        authData,
      }).toString("base64");
      return { attestation, key: { keyId: keyId.toString("base64"), privateKey: k.privateKey } };
    },
    assert(appId, challenge, key, counter) {
      const authenticatorData = Buffer.concat([
        sha256(Buffer.from(appId)),
        Buffer.from([0x00]),
        counterBytes(counter),
      ]);
      const nonce = sha256(authenticatorData, sha256(Buffer.from(challenge, "utf8")));
      const signature = sign("sha256", nonce, { key: key.privateKey, dsaEncoding: "der" });
      return encodeCbor({ signature, authenticatorData }).toString("base64");
    },
  };
}
