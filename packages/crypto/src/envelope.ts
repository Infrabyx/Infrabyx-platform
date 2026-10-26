// Envelope encryption for REGULATED/SECRET fields (IPB-02-20, §02.4.3.2; PL1-C-04).
// Per-tenant data keys come from the KMS port, are cached ≤ 5 minutes and rotated after 2^20 uses.
// The wrapped data key travels with the row inside `<col>_enc`; `<col>_key_id` is the tenant KMS key;
// `<col>_alg` is "aes-256-gcm".
import type { KmsPort } from "@infrabyx/contracts/ports";
import { aesGcmDecrypt, aesGcmEncrypt } from "./aead.js";
import { concatBytes, toBytes, toHex } from "./encoding.js";
import { sha256 } from "./hash.js";

export const FIELD_ALG = "aes-256-gcm" as const;
const FORMAT_VERSION = 1;
export const DATA_KEY_TTL_MS = 5 * 60 * 1000;
export const DATA_KEY_MAX_USES = 2 ** 20;

interface CachedKey {
  plaintext: Uint8Array;
  wrapped: Uint8Array;
  createdAt: number;
  uses: number;
}

export interface EnvelopeOptions {
  ttlMs?: number;
  maxUses?: number;
  now?: () => number;
}

export interface SealedField {
  enc: Uint8Array;
  keyId: string;
  alg: typeof FIELD_ALG;
}

/** AAD binding a ciphertext to its location: tenant ‖ table ‖ column ‖ row (PL1-C-04). */
export function fieldAad(
  tenantId: string,
  table: string,
  column: string,
  rowId: string,
): Uint8Array {
  for (const part of [tenantId, table, column, rowId]) {
    if (part.includes("\u001f")) throw new Error("AAD part contains the unit separator");
  }
  return toBytes([tenantId, table, column, rowId].join("\u001f"));
}

export class FieldEnvelope {
  private readonly kms: KmsPort;
  private readonly ttlMs: number;
  private readonly maxUses: number;
  private readonly now: () => number;
  private readonly encryptKeys = new Map<string, CachedKey>();
  private readonly decryptKeys = new Map<string, { plaintext: Uint8Array; at: number }>();

  constructor(kms: KmsPort, opts: EnvelopeOptions = {}) {
    this.kms = kms;
    this.ttlMs = Math.min(opts.ttlMs ?? DATA_KEY_TTL_MS, DATA_KEY_TTL_MS);
    this.maxUses = Math.min(opts.maxUses ?? DATA_KEY_MAX_USES, DATA_KEY_MAX_USES);
    this.now = opts.now ?? Date.now;
  }

  private async dataKey(keyId: string): Promise<CachedKey> {
    const c = this.encryptKeys.get(keyId);
    const t = this.now();
    if (c && t - c.createdAt < this.ttlMs && c.uses < this.maxUses) return c;
    const dk = await this.kms.generateDataKey(keyId);
    const fresh: CachedKey = {
      plaintext: dk.plaintext,
      wrapped: dk.ciphertext,
      createdAt: t,
      uses: 0,
    };
    this.encryptKeys.set(keyId, fresh);
    return fresh;
  }

  async seal(keyId: string, plaintext: Uint8Array | string, aad: Uint8Array): Promise<SealedField> {
    const dk = await this.dataKey(keyId);
    dk.uses++;
    const body = aesGcmEncrypt(dk.plaintext, toBytes(plaintext), aad);
    if (dk.wrapped.byteLength > 0xffff) throw new Error("wrapped data key too large");
    const header = new Uint8Array([
      FORMAT_VERSION,
      dk.wrapped.byteLength >> 8,
      dk.wrapped.byteLength & 0xff,
    ]);
    return { enc: concatBytes(header, dk.wrapped, body), keyId, alg: FIELD_ALG };
  }

  async open(field: SealedField, aad: Uint8Array): Promise<Uint8Array> {
    if (field.alg !== FIELD_ALG) throw new Error(`unsupported field algorithm ${field.alg}`);
    const e = field.enc;
    if (e[0] !== FORMAT_VERSION) throw new Error("unsupported envelope version");
    const wlen = ((e[1] as number) << 8) | (e[2] as number);
    const wrapped = e.subarray(3, 3 + wlen);
    const body = e.subarray(3 + wlen);
    const cacheKey = `${field.keyId}:${toHex(sha256(wrapped))}`;
    const t = this.now();
    let pk = this.decryptKeys.get(cacheKey);
    if (!pk || t - pk.at >= this.ttlMs) {
      pk = { plaintext: await this.kms.decrypt(field.keyId, new Uint8Array(wrapped)), at: t };
      this.decryptKeys.set(cacheKey, pk);
    }
    return aesGcmDecrypt(pk.plaintext, body, aad);
  }

  /** Drop all cached plaintext keys (e.g. on shutdown or key rotation). */
  clear(): void {
    this.encryptKeys.clear();
    this.decryptKeys.clear();
  }
}
