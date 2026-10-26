// LocalKms: software KMS for local, dev and test only (PL1-C-10).
// Keys are derived with HKDF-SHA-256 from a public, non-secret seed, so no key material is committed;
// the committed dev-keys.json holds only fingerprints, and @infrabyx/config refuses any configured
// value matching them, and the `local` KMS adapter itself, in staging, demo, pre-prod, prod and dr
// (IPB-11-17).
import {
  createECDH,
  createPrivateKey,
  createPublicKey,
  hkdfSync,
  sign as nodeSign,
  verify as nodeVerify,
  type KeyObject,
} from "node:crypto";
import type { DataKey, KmsPort, PortHealth } from "@infrabyx/contracts/ports";
import { aesGcmDecrypt, aesGcmEncrypt } from "./aead.js";
import { sha256Hex } from "./hash.js";
import { randomBytes } from "./random.js";
import { SecretKey } from "./keys.js";

/** Public by design: these keys protect nothing outside a developer laptop or CI. */
const DEV_SEED = "infrabyx-localkms-dev-only-v1 :: never use outside local/dev/test";
const P256_N = BigInt("0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551");

export const LOCAL_KMS_KEYS = {
  platform: "local:platform",
  anchorSigning: "local:sign:audit-anchor",
  auditPseudonym: "local:hmac:audit-pseudonym",
  blindIndex: "local:hmac:blind-index",
  sessionSecret: "local:hmac:session",
} as const;

export const localTenantKeyId = (tenantId: string): string => `local:tenant:${tenantId}`;

function derive(info: string, counter = 0): Uint8Array {
  return new Uint8Array(
    hkdfSync("sha256", DEV_SEED, "infrabyx-localkms", `${info}#${counter}`, 32),
  );
}

function signingKey(keyId: string): { priv: KeyObject; spki: Uint8Array } {
  for (let c = 0; c < 16; c++) {
    const d = derive(keyId, c);
    const n = BigInt(`0x${Buffer.from(d).toString("hex")}`);
    if (n === 0n || n >= P256_N) continue;
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(d));
    const pub = ecdh.getPublicKey(null, "uncompressed");
    const jwk = {
      kty: "EC",
      crv: "P-256",
      d: Buffer.from(d).toString("base64url"),
      x: pub.subarray(1, 33).toString("base64url"),
      y: pub.subarray(33, 65).toString("base64url"),
    };
    const priv = createPrivateKey({ key: jwk, format: "jwk" });
    const spki = new Uint8Array(createPublicKey(priv).export({ format: "der", type: "spki" }));
    return { priv, spki };
  }
  throw new Error("could not derive a P-256 key");
}

const isSigningKey = (keyId: string): boolean => keyId.startsWith("local:sign:");

/** A dev HMAC key (e.g. audit pseudonyms) derived like the KMS keys. */
export function localDevKey(keyId: string): SecretKey {
  return new SecretKey(keyId, "hmac-sha-256", derive(keyId));
}

/** Fingerprint of a well-known dev key: SHA-256 of the symmetric key or of the SPKI public key. */
export function devKeyFingerprint(keyId: string): string {
  return isSigningKey(keyId) ? sha256Hex(signingKey(keyId).spki) : sha256Hex(derive(keyId));
}

export function devKeyFingerprints(): Array<{
  keyId: string;
  kind: "symmetric" | "signing";
  fingerprint: string;
}> {
  return Object.values(LOCAL_KMS_KEYS).map((keyId) => ({
    keyId,
    kind: isSigningKey(keyId) ? ("signing" as const) : ("symmetric" as const),
    fingerprint: devKeyFingerprint(keyId),
  }));
}

/**
 * True when `value` is (or hex/base64/base64url-encodes) a well-known dev key, or when its SHA-256
 * equals a dev-key fingerprint. Used by the production guards (IPB-11-17).
 */
export function matchesDevKey(value: string): boolean {
  const fps = new Set(devKeyFingerprints().map((k) => k.fingerprint));
  if (fps.has(value.toLowerCase())) return true;
  const candidates: Uint8Array[] = [new TextEncoder().encode(value)];
  if (/^[0-9a-f]{64}$/i.test(value)) candidates.push(new Uint8Array(Buffer.from(value, "hex")));
  if (/^[A-Za-z0-9+/_-]{43,44}=?$/.test(value))
    candidates.push(new Uint8Array(Buffer.from(value, "base64url")));
  return candidates.some((c) => fps.has(sha256Hex(c)));
}

export class LocalKms implements KmsPort {
  readonly descriptor = {
    port: "KMS",
    adapter: "local",
    residency: "IN",
    maxDataClass: "SECRET",
  } as const;
  private readonly deletions = new Map<string, string>();

  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: new Date().toISOString() };
  }

  private symmetric(keyId: string): Uint8Array {
    if (isSigningKey(keyId)) throw new Error(`${keyId} is a signing key`);
    if (this.deletions.has(keyId)) throw new Error(`${keyId} is scheduled for deletion`);
    return derive(keyId);
  }

  async encrypt(keyId: string, plaintext: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
    return aesGcmEncrypt(this.symmetric(keyId), plaintext, aad);
  }

  async decrypt(keyId: string, ciphertext: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
    return aesGcmDecrypt(this.symmetric(keyId), ciphertext, aad);
  }

  async generateDataKey(keyId: string): Promise<DataKey> {
    const plaintext = randomBytes(32);
    return { plaintext, ciphertext: await this.encrypt(keyId, plaintext), keyId };
  }

  async sign(keyId: string, message: Uint8Array, alg: string): Promise<Uint8Array> {
    if (alg !== "ecdsa-p256-sha256") throw new Error(`LocalKms does not support ${alg}`);
    if (!isSigningKey(keyId)) throw new Error(`${keyId} is not a signing key`);
    return new Uint8Array(
      nodeSign("sha256", message, { key: signingKey(keyId).priv, dsaEncoding: "der" }),
    );
  }

  async verify(
    keyId: string,
    message: Uint8Array,
    signature: Uint8Array,
    alg: string,
  ): Promise<boolean> {
    if (alg !== "ecdsa-p256-sha256") return false;
    const pub = createPublicKey({
      key: Buffer.from(signingKey(keyId).spki),
      format: "der",
      type: "spki",
    });
    return nodeVerify("sha256", message, { key: pub, dsaEncoding: "der" }, signature);
  }

  async getPublicKey(keyId: string): Promise<Uint8Array> {
    if (!isSigningKey(keyId)) throw new Error(`${keyId} is not an asymmetric key`);
    return signingKey(keyId).spki;
  }

  async createTenantKey(tenantId: string): Promise<{ keyId: string }> {
    return { keyId: localTenantKeyId(tenantId) };
  }

  async scheduleKeyDeletion(keyId: string, days: number): Promise<{ deletionDate: string }> {
    if (!Number.isInteger(days) || days < 30)
      throw new Error("key deletion must be scheduled at least 30 days ahead (IPB-02-20)");
    const deletionDate = new Date(Date.now() + days * 86_400_000).toISOString();
    this.deletions.set(keyId, deletionDate);
    return { deletionDate };
  }

  async listAlgorithms(): Promise<string[]> {
    return ["aes-256-gcm", "ecdsa-p256-sha256"];
  }
}
