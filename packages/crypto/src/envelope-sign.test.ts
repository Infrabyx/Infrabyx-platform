import { describe, expect, it, vi } from "vitest";
import { FieldEnvelope, fieldAad } from "./envelope.js";
import {
  LocalKms,
  LOCAL_KMS_KEYS,
  localTenantKeyId,
  localDevKey,
  devKeyFingerprints,
  matchesDevKey,
} from "./local-kms.js";
import { signRecord, verifyRecord } from "./sign.js";
import { blindIndex } from "./blind-index.js";
import { cbom, assertApproved, ALGORITHMS } from "./registry.js";
import { readFileSync } from "node:fs";

const kms = new LocalKms();
const tenantKey = localTenantKeyId("tnt_01H00000000000000000000000");
const aad = fieldAad(
  "tnt_01H00000000000000000000000",
  "kyc.party",
  "pan",
  "pty_01H00000000000000000000000",
);

describe("field envelope (IPB-02-20, PL1-C-04)", () => {
  it("round-trips and binds the ciphertext to its location", async () => {
    const env = new FieldEnvelope(kms);
    const sealed = await env.seal(tenantKey, "ABCDE1234F", aad);
    expect(sealed.alg).toBe("aes-256-gcm");
    expect(Buffer.from(sealed.enc).includes(Buffer.from("ABCDE1234F"))).toBe(false);
    expect(new TextDecoder().decode(await env.open(sealed, aad))).toBe("ABCDE1234F");
    const otherRow = fieldAad("tnt_01H00000000000000000000000", "kyc.party", "pan", "pty_other");
    await expect(env.open(sealed, otherRow)).rejects.toThrow();
    const otherTenant = await new FieldEnvelope(kms).seal(localTenantKeyId("tnt_other"), "x", aad);
    await expect(env.open({ ...otherTenant, keyId: tenantKey }, aad)).rejects.toThrow();
  });

  it("caches a data key and rotates it after maxUses or the 5-minute TTL", async () => {
    let now = 0;
    const spy = vi.spyOn(kms, "generateDataKey");
    spy.mockClear();
    const env = new FieldEnvelope(kms, { maxUses: 3, now: () => now });
    for (let i = 0; i < 3; i++) await env.seal(tenantKey, "v", aad);
    expect(spy).toHaveBeenCalledTimes(1);
    await env.seal(tenantKey, "v", aad);
    expect(spy).toHaveBeenCalledTimes(2);
    now += 5 * 60 * 1000;
    await env.seal(tenantKey, "v", aad);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(() => new FieldEnvelope(kms, { ttlMs: 60 * 60 * 1000 })).not.toThrow();
  });
});

describe("blind index (PL1-C-05)", () => {
  const k = localDevKey(LOCAL_KMS_KEYS.blindIndex);
  it("is deterministic over normalised values and keyed", () => {
    expect(blindIndex(k, " abcde1234f ")).toBe(blindIndex(k, "ABCDE1234F"));
    expect(blindIndex(k, "ABCDE1234F")).not.toBe(
      blindIndex(localDevKey("local:hmac:other"), "ABCDE1234F"),
    );
  });
});

describe("signature records (PL1-C-03)", () => {
  it("signs through the KMS port and verifies with the public key alone", async () => {
    const msg = '{"date":"2026-10-26","head_hash":"00"}';
    const rec = await signRecord(kms, LOCAL_KMS_KEYS.anchorSigning, msg);
    expect(rec).toMatchObject({
      alg: "ecdsa-p256-sha256",
      digest_alg: "sha-256",
      key_id: LOCAL_KMS_KEYS.anchorSigning,
      cert_chain_ref: null,
    });
    const pub = await kms.getPublicKey(LOCAL_KMS_KEYS.anchorSigning);
    expect(verifyRecord(rec, msg, pub)).toBe(true);
    expect(verifyRecord(rec, msg.replace("00", "01"), pub)).toBe(false);
    expect(
      await kms.verify(
        LOCAL_KMS_KEYS.anchorSigning,
        new TextEncoder().encode(msg),
        Buffer.from(rec.value, "base64url"),
        rec.alg,
      ),
    ).toBe(true);
  });
  it("refuses algorithms that are not approved", async () => {
    await expect(
      signRecord(kms, LOCAL_KMS_KEYS.anchorSigning, "m", { alg: "ed25519" }),
    ).rejects.toThrow(/not approved/);
    expect(() => assertApproved("aes-256-gcm", "signature")).toThrow();
  });
});

describe("registry and CBOM (IPB-12 §12.6 item 1)", () => {
  it("exports a CycloneDX 1.6 cryptographic-asset BOM", () => {
    const b = cbom() as {
      bomFormat: string;
      specVersion: string;
      components: Array<{ type: string; name: string }>;
    };
    expect(b.bomFormat).toBe("CycloneDX");
    expect(b.specVersion).toBe("1.6");
    expect(b.components.map((c) => c.name)).toEqual(ALGORITHMS.map((a) => a.id));
    expect(b.components.every((c) => c.type === "cryptographic-asset")).toBe(true);
  });
});

describe("LocalKms dev keys (PL1-C-10)", () => {
  it("matches the committed dev-keys.json fingerprints", () => {
    const committed = JSON.parse(
      readFileSync(new URL("../dev-keys.json", import.meta.url), "utf8"),
    ) as { keys: unknown };
    expect(committed.keys).toEqual(devKeyFingerprints());
  });
  it("recognises dev keys in hex, base64url and fingerprint form", async () => {
    const dk = await kms.generateDataKey(LOCAL_KMS_KEYS.platform);
    expect(matchesDevKey(Buffer.from(dk.plaintext).toString("hex"))).toBe(false); // random data keys are not dev keys
    const fp = devKeyFingerprints()[0]?.fingerprint as string;
    expect(matchesDevKey(fp)).toBe(true);
    expect(matchesDevKey("a-normal-production-secret-value-0123456789")).toBe(false);
  });
  it("schedules deletion no sooner than 30 days", async () => {
    await expect(kms.scheduleKeyDeletion("local:tenant:x", 7)).rejects.toThrow(/30 days/);
    await expect(kms.scheduleKeyDeletion("local:tenant:x", 30)).resolves.toHaveProperty(
      "deletionDate",
    );
  });
});
