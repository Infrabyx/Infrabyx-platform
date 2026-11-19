// PR-FBX-01 (R1-D-21): the KYC and VIDEO_MEET contracts run against the fakes, as every adapter will.
import { describe, expect, it } from "vitest";
import { defineContractSuite } from "../contract.js";
import {
  FakeKyc,
  KYC_FAKE_FIXTURES,
  fakeVcipHandoffContext,
  kycContractCases,
  signFakeVcipHandoff,
} from "./kyc.js";
import { FakeVideoMeet, videoMeetContractCases } from "./video-meet.js";

const kyc = new FakeKyc({ notifiedEntity: true });
defineContractSuite("KYC", () => kyc, kycContractCases(KYC_FAKE_FIXTURES));
defineContractSuite("VIDEO_MEET", () => new FakeVideoMeet(), videoMeetContractCases());

describe("the KYC fake's V-CIP and webhook", () => {
  it("a completed call reports scores, geo, the official and every artefact by hash; a webhook is read back", async () => {
    const v = await kyc.startVcip({
      sessionId: "vcs_1",
      tenantId: "tnt_kyc",
      customerRef: "cus:1",
      officialRef: "usr_official",
      roomId: "room_1",
      documents: [],
    });
    kyc.completeVcip(v.vcipId, { state: "completed" });
    const m = await kyc.handleWebhook(
      new TextEncoder().encode(JSON.stringify({ vcipId: v.vcipId, state: "rejected" })),
      {},
    );
    expect(m).toMatchObject({
      state: "completed",
      officialRef: "usr_official",
      geo: { country: "IN" },
    });
    expect(m.liveness?.passed && m.faceMatch?.passed).toBe(true);
    expect(m.artefacts.every((a) => /^[0-9a-f]{64}$/.test(a.file.sha256))).toBe(true);
    await expect(kyc.handleWebhook(new TextEncoder().encode("{}"), {})).rejects.toMatchObject({
      code: "IPB-PORT-001",
    });
  });
});

describe("the KYC fake's V-CIP launcher (PR-UDF-045)", () => {
  it("a launched session is started by the official, lapses when its hand-off does, and ends with a code", async () => {
    let now = new Date();
    const f = new FakeKyc({ now: () => now });
    const c = fakeVcipHandoffContext({ customerRef: "cus_launch_1" }, now);
    const l = await f.launchVcip({ context: c, jws: await signFakeVcipHandoff(c, { now }) });
    expect(l.launchUrl).toMatch(/^https:\/\/vcip-launch\.example\.com\/v\//);
    const start = (o: { tenantId?: string; customerRef?: string } = {}) =>
      f.startVcip({
        sessionId: "sess_re_1",
        tenantId: o.tenantId ?? "tnt_kyc",
        customerRef: o.customerRef ?? "cus_launch_1",
        officialRef: "usr_official",
        roomId: "room_launch_1",
        documents: [],
        vcipId: l.vcipId,
      });
    await expect(start({ customerRef: "cus_other" })).rejects.toMatchObject({
      meta: { reason: "customer_mismatch" },
    });
    await expect(start({ tenantId: "tnt_other" })).rejects.toMatchObject({
      meta: { reason: "not_found" },
    });
    expect((await start()).state).toBe("in_progress");
    await expect(start()).rejects.toMatchObject({ meta: { reason: "wrong_state" } });
    f.completeVcip(l.vcipId, { state: "rejected", reason: "free text, never shown" });
    const m = await f.vcipStatus(l.vcipId, { tenantId: "tnt_kyc" });
    expect(m).toMatchObject({
      state: "rejected",
      sessionId: c.journeyId,
      officialRef: "usr_official",
      reasonCode: "official_rejected",
      liveness: { mode: "passive" },
    });

    const c2 = fakeVcipHandoffContext({}, now);
    const l2 = await f.launchVcip({ context: c2, jws: await signFakeVcipHandoff(c2, { now }) });
    now = new Date(Date.parse(c2.expiresAt));
    expect(await f.vcipStatus(l2.vcipId)).toMatchObject({
      state: "expired",
      reasonCode: "launch_expired",
    });
    await expect(
      f.startVcip({
        sessionId: "sess_re_2",
        tenantId: "tnt_kyc",
        customerRef: c2.customerRef,
        officialRef: "usr_official",
        roomId: "room_launch_2",
        documents: [],
        vcipId: l2.vcipId,
      }),
    ).rejects.toMatchObject({ meta: { reason: "launch_expired" } });
  });
});
