// G5 (R1-D-08): the regulated-message JWS profile, one test per refusal, rotation with overlap,
// replay protection, and a differential check against `jose` (test-only, PL2-C-02).
import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { compactVerify, importJWK } from "jose";
import { describe, expect, it } from "vitest";
import { cloudEventSigningPayload } from "./detached-jws.js";
import { toBase64Url } from "./encoding.js";
import { canonicalize } from "./jcs.js";
import { LocalKms } from "./local-kms.js";
import {
  MemoryReplayStore,
  REGULATED_JWS_TYP,
  RegulatedKeyRing,
  signRegulatedMessage,
  verifyRegulatedMessage,
} from "./regulated-jws.js";

const NOW = new Date("2026-10-28T12:00:00Z");
const event = {
  specversion: "1.0",
  id: "01a152c9-ead8-7b2e-9a1d-3f6c2b8e4d10",
  source: "urn:infrabyx:finbyx:tnt_01J9ZQ8K7H",
  type: "in.infrabyx.origination.DecisionMade.v1",
  subject: "app_01J9ZQB3W4X6",
  seq: 4,
  data: { decision: "APPROVED" },
};

const ecKey = () => generateKeyPairSync("ec", { namedCurve: "P-256" });
const derSigner = (priv: ReturnType<typeof ecKey>["privateKey"]) => async (m: Uint8Array) =>
  new Uint8Array(nodeSign("sha256", m, { key: priv, dsaEncoding: "der" }));
const spki = (k: ReturnType<typeof ecKey>) =>
  new Uint8Array(k.publicKey.export({ format: "der", type: "spki" }));

const k1 = ecKey();
const ring = () => new RegulatedKeyRing([{ kid: "kms:k1", key: spki(k1) }]);
const verify = (
  jws: string,
  o: {
    now?: Date;
    ev?: Record<string, unknown>;
    replay?: MemoryReplayStore;
    keys?: RegulatedKeyRing;
  } = {},
) =>
  verifyRegulatedMessage(o.ev ?? event, jws, {
    keys: o.keys ?? ring(),
    replay: o.replay ?? new MemoryReplayStore(() => o.now ?? NOW),
    now: o.now ?? NOW,
  });
const sign = (o: { kid?: string; now?: Date; jti?: string } = {}) =>
  signRegulatedMessage({
    event,
    kid: o.kid ?? "kms:k1",
    sign: derSigner(k1.privateKey),
    now: o.now ?? NOW,
    ...(o.jti ? { jti: o.jti } : {}),
  });

/** A JWS with a hand-made header, signed by k1 (or a caller-provided signature). */
function forge(header: Record<string, unknown>, sig?: Uint8Array): string {
  const h = toBase64Url(new TextEncoder().encode(canonicalize(header)));
  const input = Buffer.from(`${h}.${toBase64Url(cloudEventSigningPayload(event))}`, "ascii");
  const s =
    sig ??
    new Uint8Array(nodeSign("sha256", input, { key: k1.privateKey, dsaEncoding: "ieee-p1363" }));
  return `${h}..${toBase64Url(s)}`;
}
const good = (over: Record<string, unknown> = {}) => ({
  alg: "ES256",
  kid: "kms:k1",
  typ: REGULATED_JWS_TYP,
  iat: Math.floor(NOW.getTime() / 1000),
  jti: "AAAAAAAAAAAAAAAAAAAAAA",
  ...over,
});

describe("G5 regulated-message JWS (R1-D-08)", () => {
  it("signs with kid, iat and a fresh jti and verifies", async () => {
    const jws = await sign();
    const [h, p] = jws.split(".");
    expect(p).toBe("");
    const header = JSON.parse(Buffer.from(h!, "base64url").toString());
    expect(Object.keys(header).sort()).toEqual(["alg", "iat", "jti", "kid", "typ"]);
    expect(header).toMatchObject({ alg: "ES256", kid: "kms:k1", typ: REGULATED_JWS_TYP });
    expect(header.jti).not.toBe(
      JSON.parse(Buffer.from((await sign()).split(".")[0]!, "base64url").toString()).jti,
    );
    expect(await verify(jws)).toMatchObject({ ok: true, kid: "kms:k1" });
  });

  it("signs through KMS sign (DER from the key in KMS)", async () => {
    const kms = new LocalKms();
    const kid = "local:sign:audit-anchor";
    const jws = await signRegulatedMessage({
      event,
      kid,
      sign: (m) => kms.sign(kid, m, "ecdsa-p256-sha256"),
      now: NOW,
    });
    const keys = new RegulatedKeyRing([{ kid, key: await kms.getPublicKey(kid) }]);
    expect(await verify(jws, { keys })).toMatchObject({ ok: true, kid });
  });

  it("verifies like jose does (differential, test-only)", async () => {
    const jws = await sign();
    const [h, , s] = jws.split(".");
    const attached = `${h}.${toBase64Url(cloudEventSigningPayload(event))}.${s}`;
    const jwk = k1.publicKey.export({ format: "jwk" });
    const r = await compactVerify(attached, await importJWK({ ...jwk, alg: "ES256" }, "ES256"));
    expect(r.protectedHeader.kid).toBe("kms:k1");
  });

  it.each([
    ["none", { alg: "none" }],
    ["HS256", { alg: "HS256" }],
    ["HS512", { alg: "HS512" }],
    ["RS256", { alg: "RS256" }],
    ["PS256", { alg: "PS256" }],
    ["ES384", { alg: "ES384" }],
    ["lower-case es256", { alg: "es256" }],
  ])("refuses alg %s", async (_n, over) => {
    expect(await verify(forge(good(over)))).toEqual({ ok: false, reason: "alg" });
  });

  it.each(["b64", "crit", "jku", "jwk", "x5u", "x5c", "cty", "nonce"])(
    "refuses an extra header member %s",
    async (k) => {
      expect(await verify(forge(good({ [k]: k === "b64" ? false : "x" })))).toEqual({
        ok: false,
        reason: "header",
      });
    },
  );

  it("refuses a missing or unknown kid, a missing jti or iat, and a wrong typ", async () => {
    const { kid: _k, ...noKid } = good();
    expect(await verify(forge(noKid))).toMatchObject({ ok: false, reason: "header" });
    expect(await verify(forge(good({ kid: "kms:other" })))).toEqual({ ok: false, reason: "kid" });
    const { jti: _j, ...noJti } = good();
    expect(await verify(forge(noJti))).toMatchObject({ ok: false, reason: "header" });
    expect(await verify(forge(good({ iat: "1761652800" })))).toMatchObject({
      ok: false,
      reason: "header",
    });
    expect(await verify(forge(good({ typ: "JWT" })))).toEqual({ ok: false, reason: "typ" });
  });

  it("refuses a changed event, a DER signature, an attached payload and a malformed token", async () => {
    const jws = await sign();
    expect(await verify(jws, { ev: { ...event, seq: 5 } })).toEqual({
      ok: false,
      reason: "signature",
    });
    const [h, , s] = jws.split(".");
    const der = new Uint8Array(
      nodeSign("sha256", Buffer.from(`${h}.${toBase64Url(cloudEventSigningPayload(event))}`), {
        key: k1.privateKey,
        dsaEncoding: "der",
      }),
    );
    expect(await verify(`${h}..${toBase64Url(der)}`)).toEqual({ ok: false, reason: "signature" });
    expect(await verify(`${h}.${toBase64Url(cloudEventSigningPayload(event))}.${s}`)).toEqual({
      ok: false,
      reason: "format",
    });
    expect(await verify(`${h}..${s}=`)).toEqual({ ok: false, reason: "format" });
    expect(await verify("not.a")).toEqual({ ok: false, reason: "format" });
  });

  it("refuses a stale iat and one from the future, inside the window it verifies", async () => {
    const at = (m: number) => new Date(NOW.getTime() + m * 60_000);
    expect(await verify(await sign({ now: at(-6) }))).toEqual({ ok: false, reason: "stale" });
    expect(await verify(await sign({ now: at(2) }))).toEqual({ ok: false, reason: "future" });
    expect(await verify(await sign({ now: at(-4) }))).toMatchObject({ ok: true });
  });

  it("refuses a replayed jti, and a forgery does not burn a real message's jti", async () => {
    const replay = new MemoryReplayStore(() => NOW);
    const jws = await sign({ jti: "BBBBBBBBBBBBBBBBBBBBBB" });
    const [h] = jws.split(".");
    expect(await verify(`${h}..${toBase64Url(new Uint8Array(64))}`, { replay })).toEqual({
      ok: false,
      reason: "signature",
    });
    expect(await verify(jws, { replay })).toMatchObject({ ok: true });
    expect(await verify(jws, { replay })).toEqual({ ok: false, reason: "replay" });
  });

  it("rotates without downtime: both keys verify during the overlap, the old one not after", async () => {
    const k2 = ecKey();
    const overlapEnd = new Date(NOW.getTime() + 60_000);
    const keys = new RegulatedKeyRing([
      { kid: "kms:k1", key: spki(k1), notAfter: overlapEnd },
      {
        kid: "kms:k2",
        key: k2.publicKey.export({ format: "jwk" }) as { kty: string },
        notBefore: NOW,
      },
    ]);
    const viaK2 = await signRegulatedMessage({
      event,
      kid: "kms:k2",
      sign: derSigner(k2.privateKey),
      now: NOW,
    });
    expect(await verify(await sign(), { keys })).toMatchObject({ ok: true, kid: "kms:k1" });
    expect(await verify(viaK2, { keys })).toMatchObject({ ok: true, kid: "kms:k2" });
    const later = new Date(overlapEnd.getTime() + 60_000);
    expect(await verify(await sign({ now: later }), { keys, now: later })).toEqual({
      ok: false,
      reason: "kid",
    });
  });

  it("the key ring takes EC P-256 keys only, and signing needs a kid", async () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const p384 = generateKeyPairSync("ec", { namedCurve: "P-384" });
    for (const k of [rsa, p384])
      expect(
        () =>
          new RegulatedKeyRing([
            { kid: "x", key: new Uint8Array(k.publicKey.export({ format: "der", type: "spki" })) },
          ]),
      ).toThrow(/P-256/);
    await expect(
      signRegulatedMessage({ event, kid: "", sign: derSigner(k1.privateKey) }),
    ).rejects.toThrow(/kid/);
  });
});
