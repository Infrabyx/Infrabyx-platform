import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as jose from "jose";
import {
  AGENT_REQUEST_JWS_TYP,
  agentPublicJwk,
  agentRequestKid,
  agentRequestPayload,
  generateAgentKeyPair,
  signAgentRequest,
  verifyAgentRequest,
  type AgentRequest,
} from "./agent-request-jws.js";
import { toBase64Url } from "./encoding.js";
import { canonicalize } from "./jcs.js";
import {
  MemoryReplayStore,
  signRegulatedMessage,
  verifyRegulatedMessage,
  RegulatedKeyRing,
} from "./regulated-jws.js";

const kid = "tnt_acme/tga_01JAAAAAAAAAAAAAAAAAAAAAAA";
const now = new Date("2026-11-18T06:00:00Z");
const req = (over: Partial<AgentRequest> = {}): AgentRequest => ({
  tenant: "tnt_acme",
  agent: "tga_01JAAAAAAAAAAAAAAAAAAAAAAA",
  method: "POST",
  path: "/v1/accounting/agent/jobs/jrn-0001/result",
  body: new TextEncoder().encode('{"outcome":"acknowledged"}'),
  ...over,
});

describe("agent request proofs (C-22 profile, R1-D-178)", () => {
  const pair = generateAgentKeyPair();
  const verify = (jws: string, r: AgentRequest, seq = 7, o: { now?: Date } = {}) =>
    verifyAgentRequest(jws, r, {
      key: pair.publicJwk,
      expectedKid: kid,
      seq,
      replay: new MemoryReplayStore(() => now),
      now: o.now ?? now,
    });
  const signed = (r = req(), seq = 7, at = now) =>
    signAgentRequest({ privateKey: pair.privateKey, kid, request: r, seq, now: at });

  it("round-trips and names its kid", async () => {
    const jws = signed();
    expect(agentRequestKid(jws)).toBe(kid);
    expect(await verify(jws, req())).toMatchObject({ ok: true, kid });
    expect(pair.publicJwk).toEqual(agentPublicJwk(pair.privateKey));
    expect(pair.thumbprint).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("verifies with an independent JOSE implementation (differential)", async () => {
    const jws = signed();
    const [h, , s] = jws.split(".");
    const payload = toBase64Url(agentRequestPayload(req(), 7));
    const key = await jose.importJWK(pair.publicJwk, "ES256");
    const out = await jose.compactVerify(`${h}.${payload}.${s}`, key);
    expect(out.protectedHeader).toMatchObject({ alg: "ES256", typ: AGENT_REQUEST_JWS_TYP, kid });
  });

  it("is bound to the method, path, body, tenant, agent and seq", async () => {
    const jws = signed();
    for (const r of [
      req({ method: "GET" }),
      req({ path: "/v1/accounting/agent/jobs/jrn-0002/result" }),
      req({ body: new TextEncoder().encode('{"outcome":"rejected"}') }),
      req({ tenant: "tnt_other" }),
      req({ agent: "tga_01JBBBBBBBBBBBBBBBBBBBBBBB" }),
    ])
      expect(await verify(jws, r)).toEqual({ ok: false, reason: "signature" });
    expect(await verify(jws, req(), 8)).toEqual({ ok: false, reason: "signature" });
  });

  it("refuses another key, another kid, a stale, future or replayed proof", async () => {
    const other = generateAgentKeyPair();
    const jws = signed();
    expect(
      await verifyAgentRequest(jws, req(), {
        key: other.publicJwk,
        expectedKid: kid,
        seq: 7,
        replay: new MemoryReplayStore(() => now),
        now,
      }),
    ).toEqual({ ok: false, reason: "signature" });
    expect(
      await verifyAgentRequest(jws, req(), {
        key: pair.publicJwk,
        expectedKid: `${kid}x`,
        seq: 7,
        replay: new MemoryReplayStore(() => now),
        now,
      }),
    ).toEqual({ ok: false, reason: "kid" });
    expect(await verify(signed(req(), 7, new Date(now.getTime() - 301_000)), req())).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(await verify(signed(req(), 7, new Date(now.getTime() + 61_000)), req())).toEqual({
      ok: false,
      reason: "future",
    });
    const replay = new MemoryReplayStore(() => now);
    const o = { key: pair.publicJwk, expectedKid: kid, seq: 7, replay, now };
    expect((await verifyAgentRequest(jws, req(), o)).ok).toBe(true);
    expect(await verifyAgentRequest(jws, req(), o)).toEqual({ ok: false, reason: "replay" });
  });

  it("refuses every header deviation and a non-ES256 signature", async () => {
    const forge = (header: Record<string, unknown>, sigBytes?: Uint8Array) => {
      const h = toBase64Url(new TextEncoder().encode(canonicalize(header)));
      const input = Buffer.from(`${h}.${toBase64Url(agentRequestPayload(req(), 7))}`, "ascii");
      const sig =
        sigBytes ?? nodeSign("sha256", input, { key: pair.privateKey, dsaEncoding: "ieee-p1363" });
      return `${h}..${toBase64Url(sig)}`;
    };
    const base = {
      alg: "ES256",
      kid,
      typ: AGENT_REQUEST_JWS_TYP,
      iat: now.getTime() / 1000,
      jti: "a".repeat(22),
    };
    expect((await verify(forge(base), req())).ok).toBe(true);
    expect(await verify(forge({ ...base, alg: "none" }), req())).toMatchObject({ reason: "alg" });
    expect(await verify(forge({ ...base, alg: "HS256" }), req())).toMatchObject({ reason: "alg" });
    expect(await verify(forge({ ...base, alg: "ES384" }), req())).toMatchObject({ reason: "alg" });
    expect(await verify(forge({ ...base, jwk: pair.publicJwk }), req())).toMatchObject({
      reason: "header",
    });
    expect(await verify(forge({ ...base, b64: false }), req())).toMatchObject({ reason: "header" });
    const { jti: _jti, ...noJti } = base;
    expect(await verify(forge(noJti), req())).toMatchObject({ reason: "header" });
    expect(await verify(forge({ ...base, jti: "short" }), req())).toMatchObject({
      reason: "header",
    });
    expect(await verify(forge({ ...base, iat: 1.5 }), req())).toMatchObject({ reason: "header" });
    expect(await verify(forge({ ...base, typ: "JWT" }), req())).toMatchObject({ reason: "typ" });
    expect(await verify(forge(base, new Uint8Array(72)), req())).toMatchObject({
      reason: "signature",
    });
    const attached = forge(base).replace("..", `.${toBase64Url(agentRequestPayload(req(), 7))}.`);
    expect(await verify(attached, req())).toMatchObject({ reason: "format" });
    expect(await verify("not-a-jws", req())).toMatchObject({ reason: "format" });
  });

  it("never passes as a regulated message, nor a regulated message as a request proof", async () => {
    const event = { id: "evt_1", type: "x", specversion: "1.0" };
    const regulated = await signRegulatedMessage({
      event,
      kid,
      sign: async (input) => nodeSign("sha256", input, pair.privateKey),
      now,
    });
    expect(await verify(regulated, req())).toMatchObject({ ok: false, reason: "typ" });
    const ring = new RegulatedKeyRing([{ kid, key: pair.publicJwk }]);
    expect(
      await verifyRegulatedMessage(event, signed(), {
        keys: ring,
        replay: new MemoryReplayStore(() => now),
        now,
      }),
    ).toMatchObject({ ok: false, reason: "typ" });
  });

  it("signs only with a P-256 key and a well-formed request", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() => agentPublicJwk(rsa.publicKey)).toThrow(/P-256/);
    const p384 = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
    expect(() => agentPublicJwk(p384.privateKey)).toThrow(/P-256/);
    expect(() => signed(req({ method: "post" }))).toThrow(/method/);
    expect(() => signed(req({ path: "relative" }))).toThrow(/path/);
    expect(() => signed(req(), 0)).toThrow(/seq/);
  });
});
