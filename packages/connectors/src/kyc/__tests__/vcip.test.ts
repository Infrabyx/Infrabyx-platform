// M24, V-CIP in our VIDEO_MEET room (owner answer #90 (b); R1-D-55): the official of the session
// conducts it; liveness and face match on frames by the scorer; an approval needs both passed,
// the customer in India and a recording the provider does not keep; artefacts stay by hash.
import { describe, expect, it } from "vitest";
import { FakeKyc, FakeVideoMeet, KYC_FAKE_FIXTURES, VCIP_ROOM_POLICY } from "@infrabyx/testing";
import { MemoryVcipStore, VcipConductor } from "../vcip.js";

const fx = KYC_FAKE_FIXTURES;
const geoIn = { lat: 19.07, lon: 72.87, country: "IN", capturedAt: new Date().toISOString() };
const frames = [fx.faces.a, fx.faces.same, fx.faces.a];

async function setup(o: { enabled?: boolean; retention?: "none" | "vendor" } = {}) {
  const meet = new FakeVideoMeet();
  const conductor = new VcipConductor({
    meet,
    scorer: new FakeKyc(),
    store: new MemoryVcipStore(),
    enabled: () => o.enabled ?? true,
  });
  const room = await meet.createRoom(
    "case_vcip_1",
    [
      { ref: "usr_official", role: "official" },
      { ref: "cus_one", role: "participant" },
    ],
    {
      ...VCIP_ROOM_POLICY,
      providerRetention: o.retention ?? "none",
      ...(o.retention === "vendor" ? { dataClass: "INTERNAL" as const } : {}),
    },
  );
  const start = await conductor.startVcip({
    sessionId: "sess_vcip_1",
    tenantId: "tnt_kyc",
    customerRef: "cus_one",
    officialRef: "usr_official",
    roomId: room.roomId,
    documents: [fx.ovd],
  });
  return { meet, conductor, room, start };
}
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string; meta?: { reason?: string } }) => `${e.code}:${e.meta?.reason ?? ""}`,
  );

describe("M24 V-CIP conductor", () => {
  it("is off until int.kyc.vcip.enabled", async () => {
    await expect(setup({ enabled: false })).rejects.toMatchObject({
      meta: { reason: "adapter_disabled" },
    });
  });

  it("approves only after the official's passed checks, with the recording in the tenant", async () => {
    const { conductor, start } = await setup();
    expect(start.state).toBe("in_progress");
    expect(
      await code(
        conductor.complete("tnt_kyc", start.vcipId, { by: "usr_official", decision: "approve" }),
      ),
    ).toBe("IPB-PORT-001:checks_not_passed");
    expect(
      await code(
        conductor.assess("tnt_kyc", start.vcipId, {
          by: "usr_someone",
          frames,
          documentFace: fx.faces.same,
          geo: geoIn,
        }),
      ),
    ).toBe("IPB-SEC-005:");
    const s = await conductor.assess("tnt_kyc", start.vcipId, {
      by: "usr_official",
      frames,
      documentFace: fx.faces.same,
      geo: geoIn,
    });
    expect(s.liveness.passed).toBe(true);
    expect(s.faceMatch.passed).toBe(true);
    const m = await conductor.complete("tnt_kyc", start.vcipId, {
      by: "usr_official",
      decision: "approve",
    });
    expect(m.state).toBe("completed");
    expect(m.officialRef).toBe("usr_official");
    expect(m.artefacts.map((a) => a.kind)).toEqual(
      expect.arrayContaining(["document", "screenshot", "video"]),
    );
    for (const a of m.artefacts) expect(a.file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await conductor.vcipStatus(start.vcipId, "tnt_kyc")).state).toBe("completed");
    // A decided session takes no further decision.
    expect(
      await code(
        conductor.complete("tnt_kyc", start.vcipId, {
          by: "usr_official",
          decision: "reject",
          reason: "late",
        }),
      ),
    ).toBe("IPB-PORT-001:wrong_state");
  });

  it("refuses an approval outside India, with a failed face match, or a provider copy", async () => {
    const a = await setup();
    await a.conductor.assess("tnt_kyc", a.start.vcipId, {
      by: "usr_official",
      frames,
      documentFace: fx.faces.same,
      geo: { ...geoIn, country: "AE" },
    });
    expect(
      await code(
        a.conductor.complete("tnt_kyc", a.start.vcipId, {
          by: "usr_official",
          decision: "approve",
        }),
      ),
    ).toBe("IPB-PORT-001:outside_india");

    const b = await setup();
    await b.conductor.assess("tnt_kyc", b.start.vcipId, {
      by: "usr_official",
      frames,
      documentFace: fx.faces.other,
      geo: geoIn,
    });
    expect(
      await code(
        b.conductor.complete("tnt_kyc", b.start.vcipId, {
          by: "usr_official",
          decision: "approve",
        }),
      ),
    ).toBe("IPB-PORT-001:checks_not_passed");
    const rejected = await b.conductor.complete("tnt_kyc", b.start.vcipId, {
      by: "usr_official",
      decision: "reject",
      reason: "the face does not match the PAN photo",
    });
    expect(rejected).toMatchObject({
      state: "rejected",
      reason: "the face does not match the PAN photo",
    });

    const c = await setup({ retention: "vendor" });
    await c.conductor.assess("tnt_kyc", c.start.vcipId, {
      by: "usr_official",
      frames,
      documentFace: fx.faces.same,
      geo: geoIn,
    });
    expect(
      await code(
        c.conductor.complete("tnt_kyc", c.start.vcipId, {
          by: "usr_official",
          decision: "approve",
        }),
      ),
    ).toBe("IPB-PORT-001:provider_retains");
  });

  it("ends a dropped call without a decision", async () => {
    const { conductor, start } = await setup();
    const m = await conductor.drop("tnt_kyc", start.vcipId, "customer left the call");
    expect(m).toMatchObject({ state: "dropped", reason: "customer left the call" });
  });
});
