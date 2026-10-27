// C-22 detached JWS (PL3-D-06): LocalKms signing, DER conversion, verification, tampering, and a
// differential test against `jose` (test-only devDependency, as for C-11).
import { describe, expect, it } from "vitest";
import { compactVerify, importJWK } from "jose";
import {
  LocalKms,
  cloudEventSigningPayload,
  derToJose,
  signDetachedJws,
  spkiToEs256Jwk,
  verifyDetachedJws,
} from "./index.js";

const kms = new LocalKms();
const KEY = "local:sign:export";
const sign = (input: Uint8Array) => kms.sign(KEY, input, "ecdsa-p256-sha256");
const payload = new TextEncoder().encode('{"archive_id":"arc_x","files":[]}');

describe("C-22 detached JWS (ES256 through KMS sign)", () => {
  it("signs a detached compact JWS that verifies with the SPKI key and its JWK", async () => {
    const jws = await signDetachedJws({ payload, kid: KEY, sign });
    const [h, p, s] = jws.split(".");
    expect(p).toBe("");
    expect(JSON.parse(Buffer.from(h as string, "base64url").toString())).toEqual({
      alg: "ES256",
      kid: KEY,
    });
    expect(Buffer.from(s as string, "base64url")).toHaveLength(64);
    const spki = await kms.getPublicKey(KEY);
    expect(verifyDetachedJws(jws, payload, spki)).toEqual({ ok: true, kid: KEY });
    expect(verifyDetachedJws(jws, payload, spkiToEs256Jwk(spki, KEY))).toEqual({
      ok: true,
      kid: KEY,
    });
  });

  it("fails on a changed payload, an attached payload, another alg or extra header members", async () => {
    const jws = await signDetachedJws({ payload, kid: KEY, sign });
    const spki = await kms.getPublicKey(KEY);
    expect(verifyDetachedJws(jws, new TextEncoder().encode("{}"), spki).ok).toBe(false);
    const [h, , s] = jws.split(".");
    const attached = `${h}.${Buffer.from(payload).toString("base64url")}.${s}`;
    expect(verifyDetachedJws(attached, payload, spki).ok).toBe(false);
    for (const header of [
      { alg: "none", kid: KEY },
      { alg: "ES256", kid: KEY, b64: false },
    ]) {
      const bad = `${Buffer.from(JSON.stringify(header)).toString("base64url")}..${s}`;
      expect(verifyDetachedJws(bad, payload, spki).ok).toBe(false);
    }
    const other = await kms.getPublicKey("local:sign:audit-anchor");
    expect(verifyDetachedJws(jws, payload, other).ok).toBe(false);
  });

  it("converts DER with leading zeros and short integers to 64-byte r ‖ s", () => {
    const r = new Uint8Array(33).fill(0x80);
    r[0] = 0;
    const sv = new Uint8Array([0x01, 0x02]);
    const der = new Uint8Array([0x30, 2 + 33 + 2 + 2, 0x02, 33, ...r, 0x02, 2, ...sv]);
    const jose = derToJose(der);
    expect(jose).toHaveLength(64);
    expect([...jose.subarray(0, 32)]).toEqual([...r.subarray(1)]);
    expect([...jose.subarray(62)]).toEqual([1, 2]);
    expect(() => derToJose(new Uint8Array([0x31, 0]))).toThrow();
  });

  it("matches jose: jose verifies our detached JWS once the payload is re-attached", async () => {
    const jws = await signDetachedJws({ payload, kid: KEY, sign, typ: "JOSE" });
    const [h, , s] = jws.split(".");
    const jwk = spkiToEs256Jwk(await kms.getPublicKey(KEY), KEY);
    const key = await importJWK(jwk, "ES256");
    const res = await compactVerify(`${h}.${Buffer.from(payload).toString("base64url")}.${s}`, key);
    expect(Buffer.from(res.payload).toString()).toBe(Buffer.from(payload).toString());
  });

  it("signs a CloudEvent over its JCS form without the signature attribute", () => {
    const a = cloudEventSigningPayload({ id: "1", type: "t", data: { b: 2, a: 1 } });
    const b = cloudEventSigningPayload({
      type: "t",
      data: { a: 1, b: 2 },
      id: "1",
      signature: "x",
    });
    expect(Buffer.from(a).toString()).toBe('{"data":{"a":1,"b":2},"id":"1","type":"t"}');
    expect(Buffer.from(b)).toEqual(Buffer.from(a));
  });
});
