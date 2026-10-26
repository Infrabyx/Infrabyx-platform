import { describe, expect, it } from "vitest";
import { inspect } from "node:util";
import { canonicalize } from "./jcs.js";
import { sha256Hex, canonicalDigest } from "./hash.js";
import { hmacSha256Hex, hashedActorId, pseudonymise } from "./hmac.js";
import { SecretKey } from "./keys.js";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  aesGcmEncryptWithNonceForTest,
  AES_GCM_NONCE_BYTES,
} from "./aead.js";
import { fromHex, toHex } from "./encoding.js";
import { randomInt } from "./random.js";

describe("RFC 8785 JCS (PL1-C-01)", () => {
  it("sorts keys by UTF-16 code units (RFC 8785 §3.2.3 example)", () => {
    const input = {
      "€": "Euro Sign",
      "\r": "Carriage Return",
      דּ: "Hebrew",
      "1": "One",
      "😀": "Emoji",
      "\u0080": "Control",
      ö: "o-umlaut",
    };
    // Read the order from the canonical text: JSON.parse would move the integer-like key "1" first.
    const keys = [...canonicalize(input).matchAll(/"((?:[^"\\]|\\.)*)":/g)].map(
      (m) => JSON.parse(`"${m[1]}"`) as string,
    );
    expect(keys).toEqual(["\r", "1", "\u0080", "ö", "€", "😀", "דּ"]);
  });
  it("serialises numbers like ECMAScript (RFC 8785 §3.2.2.3)", () => {
    expect(canonicalize([1e30, 4.5, 0.002, -0, 333333333.3333333, 1e-7])).toBe(
      "[1e+30,4.5,0.002,0,333333333.3333333,1e-7]",
    );
    expect(() => canonicalize(Number.NaN)).toThrow();
    expect(() => canonicalize(1n)).toThrow();
  });
  it("has no whitespace, drops undefined members, escapes per JSON", () => {
    expect(canonicalize({ b: [1, { d: "x\ny", c: null }], a: undefined, e: true })).toBe(
      '{"b":[1,{"c":null,"d":"x\\ny"}],"e":true}',
    );
  });
  it("rejects cycles", () => {
    const o: Record<string, unknown> = {};
    o.self = o;
    expect(() => canonicalize(o)).toThrow(/cyclic/);
  });
});

describe("SHA-256 and HMAC-SHA-256 known answers", () => {
  it("SHA-256('abc') (FIPS 180-4)", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
  it("HMAC-SHA-256 RFC 4231 test case 6 (131-byte key)", () => {
    const key = new SecretKey("t6", "hmac-sha-256", new Uint8Array(131).fill(0xaa));
    expect(hmacSha256Hex(key, "Test Using Larger Than Block-Size Key - Hash Key First")).toBe(
      "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54",
    );
  });
  it("canonical digests ignore key order", () => {
    expect(canonicalDigest({ a: 1, b: 2 })).toBe(canonicalDigest({ b: 2, a: 1 }));
  });
  it("pseudonyms are keyed (PL1-C-02)", () => {
    const k1 = new SecretKey("k1", "hmac-sha-256", new Uint8Array(32).fill(1));
    const k2 = new SecretKey("k2", "hmac-sha-256", new Uint8Array(32).fill(2));
    expect(pseudonymise(k1, "10.0.0.1")).not.toBe(pseudonymise(k2, "10.0.0.1"));
    expect(hashedActorId(k1, "usr_1")).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("SecretKey never leaks material", () => {
  it("serialises as a placeholder", () => {
    const k = new SecretKey("audit-hmac", "hmac-sha-256", new Uint8Array(32).fill(7));
    for (const s of [JSON.stringify({ k }), String(k), inspect(k)]) {
      expect(s).toContain("[SecretKey audit-hmac]");
      expect(s).not.toContain("0707");
    }
    expect(() => new SecretKey("short", "hmac-sha-256", new Uint8Array(16))).toThrow();
  });
});

describe("AES-256-GCM (PL1-C-04)", () => {
  const zero32 = new Uint8Array(32);
  it("matches GCM spec test cases 13 and 14 (256-bit key, 96-bit nonce)", () => {
    const tc13 = aesGcmEncryptWithNonceForTest(zero32, new Uint8Array(12), new Uint8Array(0));
    expect(toHex(tc13.subarray(12))).toBe("530f8afbc74536b9a963b4f1c4cb738b");
    const tc14 = aesGcmEncryptWithNonceForTest(zero32, new Uint8Array(12), new Uint8Array(16));
    expect(toHex(tc14.subarray(12, 28))).toBe("cea7403d4d606b6e074ec5d3baf39d18");
    expect(toHex(tc14.subarray(28))).toBe("d0d1c8a799996bf0265b98b5d48ab919");
    expect(toHex(aesGcmDecrypt(zero32, tc14))).toBe("00".repeat(16));
  });
  it("detects tampering with ciphertext, tag, nonce or AAD", () => {
    const key = fromHex("11".repeat(32));
    const aad = new TextEncoder().encode("tnt_a\u001fkyc\u001fpan\u001frow1");
    const sealed = aesGcmEncrypt(key, new TextEncoder().encode("ABCDE1234F"), aad);
    for (const idx of [0, AES_GCM_NONCE_BYTES + 1, sealed.byteLength - 1]) {
      const t = new Uint8Array(sealed);
      t[idx] = (t[idx] as number) ^ 1;
      expect(() => aesGcmDecrypt(key, t, aad)).toThrow();
    }
    expect(() => aesGcmDecrypt(key, sealed, new TextEncoder().encode("other"))).toThrow();
    expect(new TextDecoder().decode(aesGcmDecrypt(key, sealed, aad))).toBe("ABCDE1234F");
    expect(() => aesGcmEncrypt(new Uint8Array(16), new Uint8Array(1))).toThrow();
  });
  it("never repeats a nonce over 1,000,000 encryptions", { timeout: 120_000 }, () => {
    const key = fromHex("22".repeat(32));
    const seen = new Set<string>();
    const pt = new Uint8Array(1);
    for (let i = 0; i < 1_000_000; i++) {
      const s = aesGcmEncrypt(key, pt);
      seen.add(Buffer.from(s.buffer, s.byteOffset, AES_GCM_NONCE_BYTES).toString("hex"));
    }
    expect(seen.size).toBe(1_000_000);
  });
});

describe("randomInt", () => {
  it("stays in range and covers it", () => {
    const counts = new Array(7).fill(0);
    for (let i = 0; i < 7000; i++) counts[randomInt(7)]++;
    expect(counts.every((c) => c > 800 && c < 1200)).toBe(true);
    expect(() => randomInt(0)).toThrow();
  });
});
