import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addressHash, normaliseAddress } from "./address-hash.js";
import { fromBase64Url } from "./encoding.js";
import { FCM_SCOPE, GOOGLE_TOKEN_URL, signServiceAccountAssertion } from "./google-assertion.js";
import { hmacSha256Hex } from "./hmac.js";
import { SecretKey } from "./keys.js";
import { assertApproved } from "./registry.js";
import { verifyLeegalityMac } from "./webhook-sig.js";

describe("C-23 address hash (PL3-D-05)", () => {
  const key = new SecretKey("consent:test", "hmac-sha-256", new Uint8Array(32).fill(7));
  it("is HMAC-SHA-256 over the kind and the normalised address, full 64 hex", () => {
    const h = addressHash(key, "email", "  Asha.K@Example.TEST ");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hmacSha256Hex(key, "email:asha.k@example.test"));
    expect(addressHash(key, "email", "asha.k@example.test")).toBe(h);
    expect(addressHash(key, "phone", "+91 98123-45678")).toBe(
      addressHash(key, "phone", "+919812345678"),
    );
    const other = new SecretKey("consent:other", "hmac-sha-256", new Uint8Array(32).fill(8));
    expect(addressHash(other, "email", "asha.k@example.test")).not.toBe(h);
  });
  it("refuses values that are not addresses", () => {
    expect(() => normaliseAddress("email", "nobody")).toThrow();
    expect(() => normaliseAddress("phone", "9812345678")).toThrow();
  });
});

describe("C-24 service-account assertion (PL3-C-01)", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  it("signs an RS256 JWT for Google's token endpoint with the FCM scope, at most one hour", () => {
    const jwt = signServiceAccountAssertion({
      clientEmail: "push@project.iam.example",
      privateKeyPem: pem,
      privateKeyId: "kid1",
      now: 1_800_000_000,
      lifetimeSeconds: 7200,
    });
    const [h, c, s] = jwt.split(".") as [string, string, string];
    const dec = (x: string) => JSON.parse(new TextDecoder().decode(fromBase64Url(x)));
    expect(dec(h)).toEqual({ alg: "RS256", typ: "JWT", kid: "kid1" });
    expect(dec(c)).toEqual({
      iss: "push@project.iam.example",
      scope: FCM_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
    expect(verify("RSA-SHA256", Buffer.from(`${h}.${c}`), publicKey, fromBase64Url(s))).toBe(true);
  });
  it("refuses a non-RSA or short key", () => {
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({
      type: "pkcs8",
      format: "pem",
    });
    expect(() =>
      signServiceAccountAssertion({ clientEmail: "x", privateKeyPem: ec.toString() }),
    ).toThrow(/RSA/);
    const small = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({
      type: "pkcs8",
      format: "pem",
    });
    expect(() =>
      signServiceAccountAssertion({ clientEmail: "x", privateKeyPem: small.toString() }),
    ).toThrow(/2048/);
  });
});

describe("C-25 Leegality webhook mac, verification only (PL3-C-02)", () => {
  // HMAC-SHA1 test vector (key "key", the pangram), standing in for (salt, documentId).
  const doc = "The quick brown fox jumps over the lazy dog";
  const mac = "de7c9b85b8b78aa6bc8a7a36f70a90701c9db4d9";
  it("accepts the HMAC-SHA1 of the document id with the salt, in any hex case", () => {
    expect(verifyLeegalityMac("key", doc, mac)).toBe(true);
    expect(verifyLeegalityMac("key", doc, mac.toUpperCase())).toBe(true);
  });
  it("refuses another salt, document id, a truncated or non-hex mac", () => {
    expect(verifyLeegalityMac("salt", doc, mac)).toBe(false);
    expect(verifyLeegalityMac("key", `${doc}.`, mac)).toBe(false);
    expect(verifyLeegalityMac("key", doc, mac.slice(0, 38))).toBe(false);
    expect(verifyLeegalityMac("key", doc, `${mac.slice(0, 39)}g`)).toBe(false);
    expect(verifyLeegalityMac("key", "", mac)).toBe(false);
  });
  it("enforces the replay window when a timestamp is sent", () => {
    const now = Date.parse("2026-10-27T10:00:00Z");
    const ok = { now, timestamp: "2026-10-27T09:58:00Z" };
    expect(verifyLeegalityMac("key", doc, mac, ok)).toBe(true);
    expect(verifyLeegalityMac("key", doc, mac, { now, timestamp: String(now / 1000 - 600) })).toBe(
      false,
    );
    expect(verifyLeegalityMac("key", doc, mac, { now, timestamp: "yesterday" })).toBe(false);
  });
  it("is registered for Leegality verification only", () => {
    expect(assertApproved("hmac-sha1", "mac").usedFor).toEqual([
      "Leegality webhook verification only (C-25); never for signing anything of ours",
    ]);
  });
});
