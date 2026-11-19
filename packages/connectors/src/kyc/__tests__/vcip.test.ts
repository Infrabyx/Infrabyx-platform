// M24, V-CIP in our VIDEO_MEET room (owner answer #90 (b); R1-D-55): the official of the session
// conducts it; liveness and face match on frames by the scorer; an approval needs both passed,
// the customer in India and a recording the provider does not keep; artefacts stay by hash.
// PR-UDF-045 (R1-D-198): the conductor takes an LSP's signed hand-off and launches the RE's V-CIP.
import { describe, expect, it } from "vitest";
import { findAadhaarLike } from "@infrabyx/contracts/aadhaar";
import { MemoryReplayStore } from "@infrabyx/crypto";
import {
  FAKE_VCIP_HANDOFF,
  FakeKyc,
  FakeVideoMeet,
  KYC_FAKE_FIXTURES,
  VCIP_ROOM_POLICY,
  fakeVcipHandoffContext,
  fakeVcipHandoffKeys,
  signFakeVcipHandoff,
  syntheticUid,
} from "@infrabyx/testing";
import { MemoryVcipStore, VcipConductor, type VcipRecord } from "../vcip.js";

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
    expect(m).toMatchObject({
      state: "dropped",
      reason: "customer left the call",
      reasonCode: "connection_lost",
    });
  });

  it("a rejection carries a reason code; free text holding an identity number is never kept (PR-UDF-045)", async () => {
    const uid = syntheticUid("99990000011");
    const a = await setup();
    expect(
      await code(
        a.conductor.complete("tnt_kyc", a.start.vcipId, {
          by: "usr_official",
          decision: "reject",
          reason: `the customer showed ${uid}`,
        }),
      ),
    ).toBe("IPB-PORT-001:reason_unsafe");
    expect(
      await code(
        a.conductor.complete("tnt_kyc", a.start.vcipId, {
          by: "usr_official",
          decision: "reject",
          reason: "the document photo is unclear",
          reasonCode: "made_up" as never,
        }),
      ),
    ).toBe("IPB-PORT-001:reason_code_invalid");
    const m = await a.conductor.complete("tnt_kyc", a.start.vcipId, {
      by: "usr_official",
      decision: "reject",
      reason: "the document photo is unclear",
      reasonCode: "document_mismatch",
    });
    expect(m).toMatchObject({ state: "rejected", reasonCode: "document_mismatch" });
    const b = await setup();
    const d = await b.conductor.drop(
      "tnt_kyc",
      b.start.vcipId,
      `left; said ${uid}`,
      "customer_left",
    );
    expect(d.reasonCode).toBe("customer_left");
    expect(d.reason).toBeUndefined();
    expect(findAadhaarLike(JSON.stringify(d), { letters: "join" })).toEqual([]);
  });
});

describe("PR-UDF-045 the conductor takes an LSP's signed hand-off (RE-hosted V-CIP)", () => {
  class CountingStore extends MemoryVcipStore {
    creates = 0;
    override async create(r: VcipRecord) {
      this.creates++;
      await super.create(r);
    }
  }
  async function launcher(o: { enabled?: boolean; handoff?: boolean } = {}) {
    let now = new Date();
    const meet = new FakeVideoMeet();
    const store = new CountingStore();
    const conductor = new VcipConductor({
      meet,
      scorer: new FakeKyc(),
      store,
      enabled: () => o.enabled ?? true,
      now: () => now,
      ...(o.handoff === false
        ? {}
        : {
            handoff: {
              reId: FAKE_VCIP_HANDOFF.reId,
              issuers: { [FAKE_VCIP_HANDOFF.lspId]: await fakeVcipHandoffKeys() },
              replay: new MemoryReplayStore(() => now),
              launchBaseUrl: "https://vcip.re.example.com/v/",
            },
          }),
    });
    const room = await meet.createRoom(
      "case_launch_1",
      [
        { ref: "usr_official", role: "official" },
        { ref: "cus_handoff_1", role: "participant" },
      ],
      VCIP_ROOM_POLICY,
    );
    return {
      conductor,
      store,
      room,
      advance: (ms: number) => (now = new Date(now.getTime() + ms)),
      now: () => now,
    };
  }
  const handoff = async (now: Date, over = {}) => {
    const context = fakeVcipHandoffContext(over, now);
    return { context, jws: await signFakeVcipHandoff(context, { now }) };
  };

  it("a hand-off schedules a session the RE's official starts and decides; the manifest carries the mode and a code", async () => {
    const { conductor, room, now } = await launcher();
    const h = await handoff(now());
    const l = await conductor.launchVcip(h, { tenantId: "tnt_kyc" });
    expect(l.launchUrl).toBe(`https://vcip.re.example.com/v/${l.vcipId}`);
    expect(l.expiresAt).toBe(h.context.expiresAt);
    const scheduled = await conductor.vcipStatus(l.vcipId, { tenantId: "tnt_kyc" });
    expect(scheduled).toMatchObject({
      state: "scheduled",
      sessionId: h.context.journeyId,
      officialRef: "",
    });
    expect(scheduled.startedAt).toBeUndefined();
    expect(await code(conductor.vcipStatus(l.vcipId, { tenantId: "tnt_other" }))).toBe(
      "IPB-PORT-001:not_found",
    );
    const start = (customerRef = h.context.customerRef) =>
      conductor.startVcip({
        sessionId: "sess_re_1",
        tenantId: "tnt_kyc",
        customerRef,
        officialRef: "usr_official",
        roomId: room.roomId,
        documents: [fx.ovd],
        vcipId: l.vcipId,
      });
    expect(await code(start("cus_someone_else"))).toBe("IPB-PORT-001:customer_mismatch");
    expect((await start()).state).toBe("in_progress");
    expect(await code(start())).toBe("IPB-PORT-001:wrong_state");
    await conductor.assess("tnt_kyc", l.vcipId, {
      by: "usr_official",
      frames,
      documentFace: fx.faces.same,
      geo: geoIn,
      mode: "active_voice",
    });
    const m = await conductor.complete("tnt_kyc", l.vcipId, {
      by: "usr_official",
      decision: "reject",
      reason: "the customer declined to continue",
      reasonCode: "customer_declined",
    });
    expect(m).toMatchObject({
      vcipId: l.vcipId,
      sessionId: h.context.journeyId,
      state: "rejected",
      officialRef: "usr_official",
      liveness: { mode: "active_voice" },
      reasonCode: "customer_declined",
    });
    expect(m.startedAt).toBeDefined();
    expect(findAadhaarLike(JSON.stringify(m), { letters: "join" })).toEqual([]);
    // The old tenant string still reads, as before.
    expect((await conductor.vcipStatus(l.vcipId, "tnt_kyc")).state).toBe("rejected");
  });

  it("refuses a replayed, expired, stale, tampered, mismatched, untrusted, other-RE or other-tenant hand-off before storing anything", async () => {
    const { conductor, store, now } = await launcher();
    const h = await handoff(now());
    await conductor.launchVcip(h);
    const created = store.creates;
    const t = now();
    const ago = (m: number) => new Date(t.getTime() - m * 60_000);
    const old = fakeVcipHandoffContext({}, ago(20));
    const fresh = () => fakeVcipHandoffContext({}, t);
    const f1 = fresh();
    const j1 = await signFakeVcipHandoff(f1, { now: t });
    const i = j1.length - 20;
    const cases: Array<[string, Promise<unknown>]> = [
      ["handoff_replayed", conductor.launchVcip(h)],
      [
        "handoff_expired",
        conductor.launchVcip({ context: old, jws: await signFakeVcipHandoff(old, { now: t }) }),
      ],
      [
        "handoff_expired",
        (async () => {
          const c = fresh();
          return conductor.launchVcip({
            context: c,
            jws: await signFakeVcipHandoff(c, { now: ago(10) }),
          });
        })(),
      ],
      [
        "handoff_invalid",
        conductor.launchVcip({
          context: f1,
          jws: `${j1.slice(0, i)}${j1[i] === "A" ? "B" : "A"}${j1.slice(i + 1)}`,
        }),
      ],
      [
        "handoff_invalid",
        conductor.launchVcip({ context: { ...f1, journeyId: "jrn_other" }, jws: j1 }),
      ],
      [
        "handoff_invalid",
        (async () => {
          const c = fresh();
          return conductor.launchVcip({
            context: c,
            jws: await signFakeVcipHandoff(c, { kid: FAKE_VCIP_HANDOFF.untrustedKid, now: t }),
          });
        })(),
      ],
      [
        "handoff_invalid",
        (async () => {
          const c = fakeVcipHandoffContext({ lspId: "constructor" }, t);
          return conductor.launchVcip({
            context: c,
            jws: await signFakeVcipHandoff(c, { now: t }),
          });
        })(),
      ],
      [
        "handoff_invalid",
        (async () => {
          const c = fakeVcipHandoffContext({ reId: "re_other" }, t);
          return conductor.launchVcip({
            context: c,
            jws: await signFakeVcipHandoff(c, { now: t }),
          });
        })(),
      ],
      [
        "handoff_invalid",
        (async () => {
          const c = fresh();
          return conductor.launchVcip(
            { context: c, jws: await signFakeVcipHandoff(c, { now: t }) },
            { tenantId: "tnt_other" },
          );
        })(),
      ],
    ];
    for (const [reason, p] of cases) expect(await code(p), reason).toBe(`IPB-PORT-001:${reason}`);
    expect(store.creates).toBe(created);
  });

  it("is off with V-CIP, not configured without a hand-off set-up, and refuses an http launch address", async () => {
    const off = await launcher({ enabled: false });
    const h = await handoff(off.now());
    expect(await code(off.conductor.launchVcip(h))).toBe("IPB-PORT-001:adapter_disabled");
    const none = await launcher({ handoff: false });
    expect(await code(none.conductor.launchVcip(h))).toBe("IPB-PORT-001:not_configured");
    expect(
      () =>
        new VcipConductor({
          meet: new FakeVideoMeet(),
          scorer: new FakeKyc(),
          store: new MemoryVcipStore(),
          enabled: () => true,
          handoff: {
            reId: "re_fake",
            issuers: {},
            replay: new MemoryReplayStore(),
            launchBaseUrl: "http://vcip.re.example.com/v/",
          },
        }),
    ).toThrow(RangeError);
  });

  it("a session no official starts before its hand-off lapses reads expired, launch_expired, and cannot start", async () => {
    const { conductor, room, now, advance } = await launcher();
    const h = await handoff(now());
    const l = await conductor.launchVcip(h);
    advance(10 * 60_000);
    expect(await conductor.vcipStatus(l.vcipId, { tenantId: "tnt_kyc" })).toMatchObject({
      state: "expired",
      reasonCode: "launch_expired",
    });
    expect(
      await code(
        conductor.startVcip({
          sessionId: "sess_re_2",
          tenantId: "tnt_kyc",
          customerRef: h.context.customerRef,
          officialRef: "usr_official",
          roomId: room.roomId,
          documents: [],
          vcipId: l.vcipId,
        }),
      ),
    ).toBe("IPB-PORT-001:launch_expired");
  });
});
