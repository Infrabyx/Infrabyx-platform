// PR-UDF-045 (R1-D-198): a V-CIP hand-off signed and verified with the existing regulated-message
// API only (G5, owner answer #82: ES256, `kid`, `jti` replay protection, a short `iat` window). No
// new algorithm, key type or primitive: the context is the signed object, as a CloudEvent is.
import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  VcipHandoffContext,
  vcipHandoffFailure,
  vcipHandoffTimeRefusal,
} from "@infrabyx/contracts/ports";
import {
  MemoryReplayStore,
  RegulatedKeyRing,
  signRegulatedMessage,
  verifyRegulatedMessage,
} from "./regulated-jws.js";

const NOW = new Date("2026-11-19T10:00:00Z");
const MIN = 60_000;
const lsp = generateKeyPairSync("ec", { namedCurve: "P-256" });
const other = generateKeyPairSync("ec", { namedCurve: "P-256" });
const spki = (k: typeof lsp) => new Uint8Array(k.publicKey.export({ format: "der", type: "spki" }));
const signer = (k: typeof lsp) => async (m: Uint8Array) =>
  new Uint8Array(nodeSign("sha256", m, { key: k.privateKey, dsaEncoding: "der" }));

const context = (over: Partial<VcipHandoffContext> = {}, at = NOW): VcipHandoffContext =>
  VcipHandoffContext.parse({
    tenantId: "tnt_kyc",
    reId: "re_nbfc_one",
    lspId: "lsp_udofin",
    customerRef: "cus_01JD00000000000000000000AB",
    journeyId: "jrn_01JD00000000000000000000CD",
    issuedAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + 10 * MIN).toISOString(),
    nonce: "n0nce-AAAAAAAAAAAAAAAAAAAA",
    ...over,
  });
const sign = (c: VcipHandoffContext, o: { now?: Date; key?: typeof lsp } = {}) =>
  signRegulatedMessage({
    event: c,
    kid: "kms:lsp-handoff-1",
    sign: signer(o.key ?? lsp),
    now: o.now ?? NOW,
  });

/** What a launcher does: verify the JWS over the context, then the context's own times. */
async function check(
  c: VcipHandoffContext,
  jws: string,
  replay: MemoryReplayStore,
  now = NOW,
): Promise<string> {
  const v = await verifyRegulatedMessage(c, jws, {
    keys: new RegulatedKeyRing([{ kid: "kms:lsp-handoff-1", key: spki(lsp) }]),
    replay,
    now,
  });
  if (!v.ok) return vcipHandoffFailure(v.reason);
  return vcipHandoffTimeRefusal(c, now) ?? "ok";
}

describe("PR-UDF-045: the V-CIP hand-off on the regulated-message JWS", () => {
  it("sign, verify, then a replay is refused", async () => {
    const replay = new MemoryReplayStore(() => NOW);
    const c = context();
    const jws = await sign(c);
    expect(jws.split(".")[1]).toBe("");
    expect(await check(c, jws, replay)).toBe("ok");
    expect(await check(c, jws, replay)).toBe("handoff_replayed");
  });

  it("an expired context, or a signature older than the iat window, is refused handoff_expired", async () => {
    const replay = new MemoryReplayStore(() => NOW);
    const old = context({}, new Date(NOW.getTime() - 20 * MIN));
    expect(await check(old, await sign(old), replay)).toBe("handoff_expired");
    const c = context({ nonce: "n0nce-BBBBBBBBBBBBBBBBBBBB" });
    expect(await check(c, await sign(c, { now: new Date(NOW.getTime() - 10 * MIN) }), replay)).toBe(
      "handoff_expired",
    );
  });

  it("a tampered signature, a JWS over another context and an untrusted key are refused handoff_invalid", async () => {
    const replay = new MemoryReplayStore(() => NOW);
    const c = context();
    const jws = await sign(c);
    const i = jws.length - 20;
    const tampered = `${jws.slice(0, i)}${jws[i] === "A" ? "B" : "A"}${jws.slice(i + 1)}`;
    expect(await check(c, tampered, replay)).toBe("handoff_invalid");
    for (const changed of [
      { customerRef: "cus_someone_else" },
      { journeyId: "jrn_another" },
      { tenantId: "tnt_other" },
      { reId: "re_other" },
      { expiresAt: new Date(NOW.getTime() + 15 * MIN).toISOString() },
    ])
      expect(await check(context(changed), jws, replay), JSON.stringify(changed)).toBe(
        "handoff_invalid",
      );
    expect(await check(c, await sign(c, { key: other }), replay)).toBe("handoff_invalid");
    // None of the refused attempts burned the jti: the genuine hand-off still verifies once.
    expect(await check(c, jws, replay)).toBe("ok");
  });
});
