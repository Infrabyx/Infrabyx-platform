// fieldCryptoForTenant over the KMS port on LocalKms (PR-LDC-16; R1-plan M42; R1-D-73).
import { describe, expect, it } from "vitest";
import type { AdapterDescriptor, KmsPort } from "@infrabyx/contracts/ports";
import {
  FieldEnvelope,
  LocalKms,
  aesGcmEncrypt,
  concatBytes,
  fieldAad,
  localTenantKeyId,
  randomBytes,
} from "@infrabyx/crypto";
import { FieldCrypto, TenantFieldCrypto, fieldCryptoForTenant, tenantFieldKeyId } from "./index.js";

const A = "tnt_01HZY8K3M4N5P6Q7R8S9T0V1W2";
const B = "tnt_01HZY8K3M4N5P6Q7R8S9T0V1W3";
const at = { table: "ldc.contact_point", column: "mobile", rowId: "cpt_1" };
const MOBILE = "+919876543210";

/** LocalKms that counts calls, optionally presenting another adapter's descriptor. */
class CountingKms extends LocalKms {
  calls = 0;
  constructor(adapter?: string) {
    super();
    if (adapter)
      Object.defineProperty(this, "descriptor", {
        value: { port: "KMS", adapter, residency: "IN", maxDataClass: "SECRET" },
      });
  }
  override async generateDataKey(keyId: string, aad?: Uint8Array) {
    this.calls++;
    return super.generateDataKey(keyId, aad);
  }
  override async decrypt(keyId: string, ciphertext: Uint8Array, aad?: Uint8Array) {
    this.calls++;
    return super.decrypt(keyId, ciphertext, aad);
  }
}

describe("fieldCryptoForTenant (PR-LDC-16; R1-D-73)", () => {
  it("round-trips a field under the tenant's own key and the v2 envelope", async () => {
    const fc = fieldCryptoForTenant(new LocalKms(), A);
    expect(fc).toBeInstanceOf(FieldCrypto);
    expect(fc).toBeInstanceOf(TenantFieldCrypto);
    expect(fc.tenantId).toBe(A);
    expect(fc.keyId).toBe(localTenantKeyId(A));
    const sealed = await fc.encryptField(A, "CONFIDENTIAL", MOBILE, at);
    expect(sealed.keyId).toBe(localTenantKeyId(A));
    expect(sealed.alg).toBe("aes-256-gcm");
    expect(fc.formatVersion(sealed)).toBe(2);
    expect(Buffer.from(sealed.enc).toString("latin1")).not.toContain(MOBILE);
    expect(await fc.decryptFieldText(A, sealed, at)).toBe(MOBILE);
    // A fresh instance (another process) opens it too: nothing depends on the cache.
    expect(await fieldCryptoForTenant(new LocalKms(), A).decryptFieldText(A, sealed, at)).toBe(
      MOBILE,
    );
    await expect(fc.decryptField(A, sealed, { ...at, rowId: "cpt_2" })).rejects.toThrow();
    await expect(fc.encryptField(A, "INTERNAL", MOBILE, at)).rejects.toThrow();
  });

  it("isolates tenants: B's FieldCrypto never opens A's ciphertext", async () => {
    const kms = new CountingKms();
    const fa = fieldCryptoForTenant(kms, A);
    const fb = fieldCryptoForTenant(kms, B);
    expect(fb.keyId).not.toBe(fa.keyId);
    const sealed = await fa.encryptField(A, "REGULATED", MOBILE, at);
    // Presented as B's own: refused by key id before the KMS is called.
    const before = kms.calls;
    await expect(fb.decryptField(B, sealed, at)).rejects.toThrow(/another tenant key/);
    await expect(fb.rewrapField(B, sealed)).rejects.toThrow(/another tenant key/);
    expect(kms.calls).toBe(before);
    // Asked for tenant A through B's instance: refused before the KMS is called.
    await expect(fb.decryptField(A, sealed, at)).rejects.toThrow(/bound to another tenant/);
    await expect(fb.encryptField(A, "REGULATED", MOBILE, at)).rejects.toThrow(
      /bound to another tenant/,
    );
    expect(kms.calls).toBe(before);
  });

  it("fails closed when A's ciphertext is relabelled with B's key id", async () => {
    const kms = new LocalKms();
    const sealed = await fieldCryptoForTenant(kms, A).encryptField(A, "REGULATED", MOBILE, at);
    const relabelled = { ...sealed, keyId: tenantFieldKeyId(kms, B) };
    await expect(fieldCryptoForTenant(kms, B).decryptField(B, relabelled, at)).rejects.toThrow();
  });

  it("binds the KMS context and the field AAD to the tenant, each on its own", async () => {
    const kms = new LocalKms();
    const sealed = await fieldCryptoForTenant(kms, A).encryptField(A, "REGULATED", MOBILE, at);
    const env = new FieldEnvelope(kms);
    const aad = (t: string) => fieldAad(t, at.table, at.column, at.rowId);
    // Right key and AAD, other tenant in the C-14 context: the data key does not unwrap.
    await expect(env.open(sealed, aad(A), { tenant_id: B, purpose: "field" })).rejects.toThrow();
    // Right key and context, other tenant in the field AAD: the body does not open.
    await expect(env.open(sealed, aad(B), { tenant_id: A, purpose: "field" })).rejects.toThrow();
    // Right key, AAD and tenant, other purpose: refused from the header.
    await expect(env.open(sealed, aad(A), { tenant_id: A, purpose: "workflow" })).rejects.toThrow(
      /another purpose/,
    );
    expect(
      new TextDecoder().decode(await env.open(sealed, aad(A), { tenant_id: A, purpose: "field" })),
    ).toBe(MOBILE);
  });

  it("refuses a malformed tenant id before any KMS call", () => {
    const kms = new CountingKms();
    for (const bad of [
      "",
      "tnt_a",
      "tnt_platform",
      "TNT_01HZY8K3M4N5P6Q7R8S9T0V1W2",
      "tnt_01hzy8k3m4n5p6q7r8s9t0v1w2",
      "tnt_01HZY8K3M4N5P6Q7R8S9T0V1W", // 25 characters
      "tnt_01HZY8K3M4N5P6Q7R8S9T0V1W2X", // 27 characters
      "tnt_01HZY8K3M4N5P6Q7R8S9T0V1WU", // U is not Crockford base32
      "tnt_01HZY8K3M4N5P6Q7R8S9T0V1W2\n",
      "tnt_01HZY8K3M4N5P6Q7R8S9T0V1W2/../x",
      "alias/ipb/tenant/tnt_01HZY8K3M4N5P6Q7R8S9T0V1W2",
      "usr_01HZY8K3M4N5P6Q7R8S9T0V1W2",
    ]) {
      expect(() => fieldCryptoForTenant(kms, bad), bad).toThrow(RangeError);
      expect(() => tenantFieldKeyId(kms, bad), bad).toThrow(RangeError);
    }
    expect(() => fieldCryptoForTenant(kms, undefined as unknown as string)).toThrow(RangeError);
    expect(kms.calls).toBe(0);
  });

  it("applies each adapter's tenant key-id convention and refuses an unknown adapter", async () => {
    const d = (adapter: string, port = "KMS") => ({
      descriptor: { port, adapter, residency: "IN", maxDataClass: "SECRET" } as AdapterDescriptor,
    });
    expect(tenantFieldKeyId(d("local"), A)).toBe(`local:tenant:${A}`);
    expect(tenantFieldKeyId(d("aws-kms"), A)).toBe(`alias/ipb/tenant/${A}`);
    expect(tenantFieldKeyId(d("vault-transit"), A)).toBe(`tenant-${A}`);
    for (const other of [d("other-kms"), d("constructor"), d("__proto__"), d("local", "SECRETS")])
      expect(() => tenantFieldKeyId(other, A)).toThrow(
        expect.objectContaining({ code: "IPB-PORT-001" }),
      );
    // End to end with the AWS convention: the alias is the stored key id.
    const aws: KmsPort = new CountingKms("aws-kms");
    const fc = fieldCryptoForTenant(aws, A);
    const sealed = await fc.encryptField(A, "REGULATED", MOBILE, at);
    expect(sealed.keyId).toBe(`alias/ipb/tenant/${A}`);
    expect(await fc.decryptFieldText(A, sealed, at)).toBe(MOBILE);
  });

  it("ignores a key id slipped in through the options", async () => {
    const opts = { keyIdFor: () => "local:platform" } as unknown as { maxUses: number };
    const fc = fieldCryptoForTenant(new LocalKms(), A, opts);
    expect((await fc.encryptField(A, "REGULATED", MOBILE, at)).keyId).toBe(localTenantKeyId(A));
  });

  it("rotates data keys within the envelope's limits; older fields stay readable", async () => {
    const kms = new CountingKms();
    const fc = fieldCryptoForTenant(kms, A, { maxUses: 1 });
    const one = await fc.encryptField(A, "REGULATED", MOBILE, at);
    const two = await fc.encryptField(A, "REGULATED", MOBILE, at);
    expect(kms.calls).toBe(2); // a fresh data key per seal at maxUses 1
    expect(Buffer.from(one.enc).equals(Buffer.from(two.enc))).toBe(false);
    fc.clear();
    expect(await fc.decryptFieldText(A, one, at)).toBe(MOBILE);
    expect(await fc.decryptFieldText(A, two, at)).toBe(MOBILE);
  });

  it("rewraps a v1 field of its own tenant to v2 and refuses another tenant's", async () => {
    const kms = new LocalKms();
    const keyId = localTenantKeyId(A);
    const dk = randomBytes(32);
    const wrapped = await kms.encrypt(keyId, dk);
    const body = aesGcmEncrypt(
      dk,
      new TextEncoder().encode(MOBILE),
      fieldAad(A, at.table, at.column, at.rowId),
    );
    const v1 = {
      enc: concatBytes(
        new Uint8Array([1, wrapped.byteLength >> 8, wrapped.byteLength & 0xff]),
        wrapped,
        body,
      ),
      keyId,
      alg: "aes-256-gcm" as const,
    };
    const fa = fieldCryptoForTenant(kms, A);
    expect(fa.formatVersion(v1)).toBe(1);
    const v2 = await fa.rewrapField(A, v1);
    expect(fa.formatVersion(v2)).toBe(2);
    expect(await fa.decryptFieldText(A, v2, at)).toBe(MOBILE);
    await expect(fieldCryptoForTenant(kms, B).rewrapField(B, v1)).rejects.toThrow(
      /another tenant key/,
    );
  });
});
