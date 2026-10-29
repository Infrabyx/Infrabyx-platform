// DPoP proofs (R1-D-18, owner answer #84): one test per refusal, the jkt binding, the iat window,
// replay protection, and differential checks against `jose` (test-only, PL2-C-02).
import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { calculateJwkThumbprint, SignJWT, importJWK } from "jose";
import { describe, expect, it } from "vitest";
import { accessTokenHash, jwkThumbprint, normaliseHtu, verifyDpopProof, DPOP_TYP } from "./dpop.js";
import { toBase64Url } from "./encoding.js";
import { MemoryReplayStore } from "./regulated-jws.js";

const NOW = new Date("2026-10-29T06:00:00Z");
const URL_ = "https://id.example.test/realms/udf-customers/protocol/openid-connect/token";
const iat = (d = NOW) => Math.floor(d.getTime() / 1000);

const device = () => {
  const k = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const j = k.publicKey.export({ format: "jwk" }) as {
    kty: string;
    crv: string;
    x: string;
    y: string;
  };
  return { k, jwk: { kty: j.kty, crv: j.crv, x: j.x, y: j.y } };
};
const d1 = device();
const b64json = (o: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(o)));

/** A proof signed by hand, so each field can be bent. */
function proof(
  o: {
    header?: Record<string, unknown>;
    payload?: Record<string, unknown>;
    key?: ReturnType<typeof device>;
  } = {},
): string {
  const key = o.key ?? d1;
  const h = b64json({ typ: DPOP_TYP, alg: "ES256", jwk: key.jwk, ...o.header });
  const p = b64json({
    jti: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    htm: "POST",
    htu: URL_,
    iat: iat(),
    ...o.payload,
  });
  const sig = nodeSign("sha256", Buffer.from(`${h}.${p}`), {
    key: key.k.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${h}.${p}.${toBase64Url(new Uint8Array(sig))}`;
}

const verify = (jws: string, o: Partial<Parameters<typeof verifyDpopProof>[1]> = {}) =>
  verifyDpopProof(jws, {
    method: "POST",
    url: URL_,
    replay: new MemoryReplayStore(() => NOW),
    now: NOW,
    ...o,
  });

describe("@IPB-02 DPoP proof verification (R1-D-18)", () => {
  it("accepts a proof and names its key by the RFC 7638 thumbprint (jose agrees)", async () => {
    const r = await verify(proof());
    expect(r).toMatchObject({ ok: true, jkt: jwkThumbprint(d1.jwk as never) });
    expect(jwkThumbprint(d1.jwk as never)).toBe(await calculateJwkThumbprint(d1.jwk as never));
  });

  it("verifies a proof jose signs, with ath bound to the access token", async () => {
    const token = "opaque-test-access-token";
    const jws = await new SignJWT({
      htm: "GET",
      htu: "https://api.example.test/v1/me",
      ath: accessTokenHash(token),
    })
      .setProtectedHeader({ typ: DPOP_TYP, alg: "ES256", jwk: d1.jwk })
      .setJti("0123456789abcdef0123")
      .setIssuedAt(iat())
      .sign(await importJWK({ ...d1.k.privateKey.export({ format: "jwk" }) } as never, "ES256"));
    expect(
      await verify(jws, {
        method: "get",
        url: "https://API.example.test:443/v1/me?x=1#f",
        accessToken: token,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await verify(jws, {
        method: "GET",
        url: "https://api.example.test/v1/me",
        accessToken: "other",
      }),
    ).toEqual({
      ok: false,
      reason: "ath",
    });
  });

  it.each([
    ["none", "alg"],
    ["HS256", "alg"],
    ["RS256", "alg"],
    ["PS256", "alg"],
    ["ES384", "alg"],
  ])("refuses alg %s", async (alg, reason) => {
    expect(await verify(proof({ header: { alg } }))).toEqual({ ok: false, reason });
  });

  it("refuses a wrong typ, an extra or missing header member", async () => {
    expect(await verify(proof({ header: { typ: "JWT" } }))).toEqual({ ok: false, reason: "typ" });
    expect(await verify(proof({ header: { kid: "k1" } }))).toEqual({ ok: false, reason: "header" });
    expect(await verify(proof({ header: { jwk: undefined } }))).toEqual({
      ok: false,
      reason: "header",
    });
  });

  it("refuses a private, foreign or off-curve key", async () => {
    const priv = d1.k.privateKey.export({ format: "jwk" });
    expect(await verify(proof({ header: { jwk: priv } }))).toEqual({ ok: false, reason: "jwk" });
    expect(await verify(proof({ header: { jwk: { ...d1.jwk, crv: "P-384" } } }))).toEqual({
      ok: false,
      reason: "jwk",
    });
    expect(await verify(proof({ header: { jwk: { ...d1.jwk, kid: "x" } } }))).toEqual({
      ok: false,
      reason: "jwk",
    });
    const offCurve = { ...d1.jwk, y: toBase64Url(new Uint8Array(32).fill(7)) };
    expect(await verify(proof({ header: { jwk: offCurve } }))).toEqual({
      ok: false,
      reason: "jwk",
    });
  });

  it("refuses a proof signed by another key than the one it carries", async () => {
    const other = device();
    const forged = proof({ key: other }).split(".");
    const mine = proof().split(".");
    expect(await verify(`${mine[0]}.${forged[1]}.${forged[2]}`)).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("refuses a DER signature, non-canonical base64url and the wrong segment count", async () => {
    const [h, p] = proof().split(".") as [string, string];
    const der = nodeSign("sha256", Buffer.from(`${h}.${p}`), {
      key: d1.k.privateKey,
      dsaEncoding: "der",
    });
    expect(await verify(`${h}.${p}.${toBase64Url(new Uint8Array(der))}`)).toEqual({
      ok: false,
      reason: "signature",
    });
    expect(await verify(`${h}.${p}`)).toEqual({ ok: false, reason: "format" });
    expect(await verify(`${h}.${p}.!!`)).toEqual({ ok: false, reason: "format" });
    expect(await verify(`${h}=.${p}.x`)).toEqual({ ok: false, reason: "format" });
  });

  it("refuses unknown claims, a bad jti and a non-integer iat", async () => {
    expect(await verify(proof({ payload: { nonce: "n" } }))).toEqual({
      ok: false,
      reason: "claims",
    });
    expect(await verify(proof({ payload: { jti: "short" } }))).toEqual({
      ok: false,
      reason: "claims",
    });
    expect(await verify(proof({ payload: { iat: iat() + 0.5 } }))).toEqual({
      ok: false,
      reason: "claims",
    });
  });

  it("refuses another method or target, and an ath without a token", async () => {
    expect(await verify(proof({ payload: { htm: "GET" } }))).toEqual({ ok: false, reason: "htm" });
    expect(await verify(proof({ payload: { htu: "https://id.example.test/other" } }))).toEqual({
      ok: false,
      reason: "htu",
    });
    expect(await verify(proof({ payload: { htu: "ftp://id.example.test/x" } }))).toEqual({
      ok: false,
      reason: "htu",
    });
    expect(await verify(proof({ payload: { ath: accessTokenHash("t") } }))).toEqual({
      ok: false,
      reason: "ath",
    });
    expect(await verify(proof(), { accessToken: "t" })).toEqual({ ok: false, reason: "ath" });
  });

  it("keeps the iat window: 60 s back, 30 s ahead by default; wider windows are refused", async () => {
    expect(await verify(proof({ payload: { iat: iat() - 60 } }))).toMatchObject({ ok: true });
    expect(await verify(proof({ payload: { iat: iat() - 61 } }))).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(await verify(proof({ payload: { iat: iat() + 30 } }))).toMatchObject({ ok: true });
    expect(await verify(proof({ payload: { iat: iat() + 31 } }))).toEqual({
      ok: false,
      reason: "future",
    });
    await expect(verify(proof(), { maxAgeSeconds: 301 })).rejects.toThrow(RangeError);
    await expect(verify(proof(), { maxSkewSeconds: 61 })).rejects.toThrow(RangeError);
  });

  it("binds to the expected jkt", async () => {
    expect(await verify(proof(), { jkt: jwkThumbprint(device().jwk as never) })).toEqual({
      ok: false,
      reason: "jkt",
    });
    expect(await verify(proof(), { jkt: jwkThumbprint(d1.jwk as never) })).toMatchObject({
      ok: true,
    });
  });

  it("claims each jti once per key, and only after the proof verified", async () => {
    const replay = new MemoryReplayStore(() => NOW);
    const jws = proof({ payload: { jti: "the-same-jti-0001" } });
    expect(await verify(jws, { replay })).toMatchObject({ ok: true });
    expect(await verify(jws, { replay })).toEqual({ ok: false, reason: "replay" });
    // A refused proof with a fresh jti does not burn it.
    const fresh = "fresh-jti-00000001";
    expect(await verify(proof({ payload: { jti: fresh, htm: "GET" } }), { replay })).toMatchObject({
      ok: false,
    });
    expect(await verify(proof({ payload: { jti: fresh } }), { replay })).toMatchObject({
      ok: true,
    });
    // The same jti under another key is another proof.
    expect(
      await verify(proof({ key: device(), payload: { jti: "the-same-jti-0001" } }), { replay }),
    ).toMatchObject({ ok: true });
  });

  it("normalises htu", () => {
    expect(normaliseHtu("HTTPS://Api.Example.test:443/a/b?q#f")).toBe(
      "https://api.example.test/a/b",
    );
    expect(normaliseHtu("http://127.0.0.1:8080/t")).toBe("http://127.0.0.1:8080/t");
  });
});
