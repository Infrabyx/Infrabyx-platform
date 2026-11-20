// PR-FBX-51 (R1-D-220): the GRC contract runs against the fake, as every adapter's does; then what
// only the fake promises (the records it took, by key).
import { describe, expect, it } from "vitest";
import { defineContractSuite } from "../contract.js";
import { FakeGrc, grcContractCases, grcFakeFixtures, grcObligations, grcSamples } from "./grc.js";

const fake = new FakeGrc();
defineContractSuite("GRC", () => fake, grcContractCases(grcFakeFixtures));

describe("the GRC fake", () => {
  it("keeps what it took, by key, and takes obligations only in §9.2's shape", async () => {
    const p = new FakeGrc({ obligations: grcObligations(2) });
    const d = grcSamples.recordPolicyAttestation();
    const r = await p.recordPolicyAttestation(d);
    expect(p.records).toEqual([{ resource: "PolicyAttestation", data: d, key: r.idempotencyKey }]);
    expect((await p.listObligations()).items).toHaveLength(2);
    expect(() => p.seedObligations([{ ...grcObligations(1)[0]!, text_sha256: "x" }])).toThrow();
  });
});
