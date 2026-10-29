// PR-FBX-01 (R1-D-21): the KYC and VIDEO_MEET contracts run against the fakes, as every adapter will.
import { describe, expect, it } from "vitest";
import { defineContractSuite } from "../contract.js";
import { FakeKyc, KYC_FAKE_FIXTURES, kycContractCases } from "./kyc.js";
import { FakeVideoMeet, videoMeetContractCases } from "./video-meet.js";

const kyc = new FakeKyc();
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
