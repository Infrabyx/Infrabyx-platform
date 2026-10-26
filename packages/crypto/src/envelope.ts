// Envelope encryption for REGULATED/SECRET fields (IPB-02-20, §02.4.3.2; PL1-C-04).
// Per-tenant data keys come from the KMS port, are cached ≤ 5 minutes and rotated after 2^20 uses.
// The wrapped data key travels with the row inside `<col>_enc`; `<col>_key_id` is the tenant KMS key;
// `<col>_alg` is "aes-256-gcm".
//
// Format v2 (PL2-D-50): every wrap and unwrap of the data key carries the C-14 KMS encryption
// context { tenant_id, purpose }; the purpose is stored in the header, the tenant is supplied by
// the caller, so a ciphertext opens only for the tenant and purpose it was sealed for.
//   v2: [0x02][purpose length][purpose ASCII][wrapped length u16][wrapped key][AES-GCM body]
//   v1: [0x01][wrapped length u16][wrapped key][AES-GCM body]   (read-only; rewrapToV2 upgrades)
import type { KmsEncryptionContext, KmsPort } from "@infrabyx/contracts/ports";
import { aesGcmDecrypt, aesGcmEncrypt } from "./aead.js";
import { concatBytes, toBytes, toHex } from "./encoding.js";
import { sha256 } from "./hash.js";
import { encodeKmsContext } from "./kms-context.js";

export const FIELD_ALG = "aes-256-gcm" as const;
const FORMAT_V1 = 1;
const FORMAT_V2 = 2;
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

  private async dataKey(keyId: string, ctx: KmsEncryptionContext): Promise<CachedKey> {
    const slot = `${keyId}|${ctx.tenant_id}|${ctx.purpose}`;
    const c = this.encryptKeys.get(slot);
    const t = this.now();
    if (c && t - c.createdAt < this.ttlMs && c.uses < this.maxUses) return c;
    const dk = await this.kms.generateDataKey(keyId, encodeKmsContext(ctx));
    const fresh: CachedKey = {
      plaintext: dk.plaintext,
      wrapped: dk.ciphertext,
      createdAt: t,
      uses: 0,
    };
    this.encryptKeys.set(slot, fresh);
    return fresh;
  }

  /** Seal with format v2: the data key is wrapped under `ctx` (C-14). */
  async seal(
    keyId: string,
    plaintext: Uint8Array | string,
    aad: Uint8Array,
    ctx: KmsEncryptionContext,
  ): Promise<SealedField> {
    encodeKmsContext(ctx); // validates before any KMS call
    const dk = await this.dataKey(keyId, ctx);
    dk.uses++;
    const body = aesGcmEncrypt(dk.plaintext, toBytes(plaintext), aad);
    return { enc: v2(ctx, dk.wrapped, body), keyId, alg: FIELD_ALG };
  }

  /**
   * Open v2 (unwrapped under `ctx`; the stored purpose must equal `ctx.purpose`) or v1 (wrapped
   * without a context, readable until rewrapped). A wrong tenant or purpose fails closed.
   */
  async open(field: SealedField, aad: Uint8Array, ctx: KmsEncryptionContext): Promise<Uint8Array> {
    const p = parse(field);
    if (p.version === FORMAT_V2 && p.purpose !== ctx.purpose)
      throw new Error("field was sealed for another purpose");
    const kmsAad = p.version === FORMAT_V2 ? encodeKmsContext(ctx) : undefined;
    const cacheKey = `${field.keyId}:${p.version === FORMAT_V2 ? `${ctx.tenant_id}|${ctx.purpose}` : "v1"}:${toHex(sha256(p.wrapped))}`;
    const t = this.now();
    let pk = this.decryptKeys.get(cacheKey);
    if (!pk || t - pk.at >= this.ttlMs) {
      pk = {
        plaintext: await this.kms.decrypt(field.keyId, new Uint8Array(p.wrapped), kmsAad),
        at: t,
      };
      this.decryptKeys.set(cacheKey, pk);
    }
    return aesGcmDecrypt(pk.plaintext, p.body, aad);
  }

  /** 1 or 2. */
  formatVersion(field: SealedField): 1 | 2 {
    return parse(field).version;
  }

  /**
   * Re-wrap a v1 field's data key under `ctx` and return the v2 field. The AES-GCM body (the field
   * ciphertext) is carried over byte for byte; only the wrapped key and header change. A v2 field
   * is returned unchanged.
   */
  async rewrapToV2(field: SealedField, ctx: KmsEncryptionContext): Promise<SealedField> {
    const p = parse(field);
    if (p.version === FORMAT_V2) return field;
    const kmsAad = encodeKmsContext(ctx);
    const dataKey = await this.kms.decrypt(field.keyId, new Uint8Array(p.wrapped));
    try {
      const rewrapped = await this.kms.encrypt(field.keyId, dataKey, kmsAad);
      return { enc: v2(ctx, rewrapped, p.body), keyId: field.keyId, alg: FIELD_ALG };
    } finally {
      dataKey.fill(0);
    }
  }

  /** Drop all cached plaintext keys (e.g. on shutdown or key rotation). */
  clear(): void {
    this.encryptKeys.clear();
    this.decryptKeys.clear();
  }
}

function v2(ctx: KmsEncryptionContext, wrapped: Uint8Array, body: Uint8Array): Uint8Array {
  if (wrapped.byteLength > 0xffff) throw new Error("wrapped data key too large");
  const purpose = toBytes(ctx.purpose);
  return concatBytes(
    new Uint8Array([FORMAT_V2, purpose.byteLength]),
    purpose,
    new Uint8Array([wrapped.byteLength >> 8, wrapped.byteLength & 0xff]),
    wrapped,
    body,
  );
}

function parse(field: SealedField): {
  version: 1 | 2;
  purpose: string | null;
  wrapped: Uint8Array;
  body: Uint8Array;
} {
  if (field.alg !== FIELD_ALG) throw new Error(`unsupported field algorithm ${field.alg}`);
  const e = field.enc;
  let o: number;
  let purpose: string | null = null;
  let version: 1 | 2;
  if (e[0] === FORMAT_V1) {
    version = 1;
    o = 1;
  } else if (e[0] === FORMAT_V2) {
    version = 2;
    const plen = e[1] as number;
    purpose = new TextDecoder().decode(e.subarray(2, 2 + plen));
    o = 2 + plen;
  } else throw new Error("unsupported envelope version");
  const wlen = ((e[o] as number) << 8) | (e[o + 1] as number);
  const wrapped = e.subarray(o + 2, o + 2 + wlen);
  if (wrapped.byteLength !== wlen) throw new Error("truncated envelope");
  return { version, purpose, wrapped, body: e.subarray(o + 2 + wlen) };
}
