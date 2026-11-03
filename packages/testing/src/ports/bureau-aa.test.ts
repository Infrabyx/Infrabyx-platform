// PR-FBX-28 (R1-D-43): the BUREAU and AA_FIU contracts run against the fakes,
// as every adapter will.
import { describe, expect, it } from "vitest";
import { newId } from "@infrabyx/crypto";
import { defineContractSuite } from "../contract.js";
import {
  ACCOUNT_AGGREGATOR_FAKE_FIXTURES,
  CREDIT_BUREAU_FAKE_FIXTURES,
  FakeAccountAggregator,
  FakeCreditBureau,
  accountAggregatorContractCases,
  creditBureauContractCases,
} from "./bureau-aa.js";

defineContractSuite(
  "BUREAU",
  () => new FakeCreditBureau(),
  creditBureauContractCases(CREDIT_BUREAU_FAKE_FIXTURES),
);
defineContractSuite(
  "AA_FIU",
  () => new FakeAccountAggregator(),
  accountAggregatorContractCases(ACCOUNT_AGGREGATOR_FAKE_FIXTURES),
);

describe("the bureau fake's async report", () => {
  it("answers pending until the CIC completes, then the webhook reads the report back", async () => {
    const b = new FakeCreditBureau({ pendingPans: ["BBBPZ1234D"] });
    const r = await b.pull({
      bureau: "experian",
      enquiry: "hard",
      purpose: "new_credit",
      consentRef: newId("cpr"),
      amountPaise: 50_000_000,
      subject: { subjectRef: "cus:2", kind: "individual", name: "Ravi Iyer", pan: "BBBPZ1234D" },
      reportPrefix: "tenant/tnt_bureau/los/",
    });
    expect(r.state).toBe("pending");
    expect(r.report).toBeUndefined();
    b.completePending(r.pullId);
    const back = await b.handleWebhook(
      new TextEncoder().encode(JSON.stringify({ pullId: r.pullId })),
      {},
    );
    expect(back).toMatchObject({ state: "ready", bureau: "experian", enquiry: "hard" });
    expect(back.summary?.enquiries.last30d).toBe(1);
    expect(JSON.stringify(back)).not.toContain("reportPrefix");
  });
});

describe("the AA fake's expiry", () => {
  it("an expired consent fetches nothing and reads as EXPIRED", async () => {
    let now = Date.now();
    const aa = new FakeAccountAggregator({ now: () => new Date(now) });
    const c = await aa.requestConsent({
      customerHandle: "asha.rao@fake-aa",
      subjectRef: "cus:1",
      consentRef: newId("cpr"),
      purposeCode: "101",
      fiTypes: ["DEPOSIT"],
      fetchType: "PERIODIC",
      frequency: { unit: "MONTH", value: 1 },
      dataRange: {
        from: new Date(now - 86_400_000).toISOString(),
        to: new Date(now).toISOString(),
      },
      dataLife: { unit: "MONTH", value: 1 },
      consentStart: new Date(now).toISOString(),
      consentExpiry: new Date(now + 3_600_000).toISOString(),
    });
    aa.approve(c.consentId);
    now += 2 * 3_600_000;
    expect((await aa.consentStatus(c.consentId)).state).toBe("EXPIRED");
    await expect(
      aa.fetch({
        consentId: c.consentId,
        range: c.dataRange,
        dataPrefix: "tenant/tnt_aa/los/",
      }),
    ).rejects.toMatchObject({ code: "IPB-PORT-001", meta: { reason: "consent_inactive" } });
    await expect(aa.revoke(c.consentId)).rejects.toMatchObject({ code: "IPB-PORT-001" });
  });
});
