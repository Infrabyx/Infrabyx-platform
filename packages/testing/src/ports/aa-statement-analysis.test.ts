// PR-UDF-065 (R1-D-243): the fake AA's FI payloads in STORAGE, joined to the statement analysis
// fake by reference; then what only the fakes promise (the fake AA's own store by default, and the
// fake analyser's summary of exactly the payloads the AA stored).
import { describe, expect, it } from "vitest";
import { MemoryStorage } from "@infrabyx/fakes";
import { newId, sha256Hex } from "@infrabyx/crypto";
import { defineContractSuite } from "../contract.js";
import { aaStatementAnalysisJoinCases } from "./aa-statement-analysis.js";
import { FakeAccountAggregator, fakeFiPayload } from "./bureau-aa.js";
import { FakeStatementAnalysis } from "./statement-analysis.js";

const storage = new MemoryStorage();
const DATA_PREFIX = "tenant/tnt_udf/aa_fi/";
const REPORT_PREFIX = "tenant/tnt_udf/statement_reports/";

defineContractSuite(
  "STATEMENT_ANALYSIS",
  () => new FakeStatementAnalysis({ storage }),
  aaStatementAnalysisJoinCases<FakeStatementAnalysis>({
    storage,
    dataPrefix: DATA_PREFIX,
    reportPrefix: REPORT_PREFIX,
    calls: (p) => p.analyses,
  }),
);

const consentAsk = () => {
  const now = Date.now();
  return {
    customerHandle: "asha.rao@fake-aa",
    subjectRef: "cus:aa-fake",
    consentRef: newId("cpr"),
    purposeCode: "101" as const,
    fiTypes: ["DEPOSIT" as const, "RECURRING_DEPOSIT" as const],
    fetchType: "ONETIME" as const,
    dataRange: {
      from: new Date(now - 86_400_000).toISOString(),
      to: new Date(now).toISOString(),
    },
    dataLife: { unit: "MONTH" as const, value: 1 },
    consentStart: new Date(now).toISOString(),
    consentExpiry: new Date(now + 3_600_000).toISOString(),
  };
};

describe("the AA fake's FI payloads in STORAGE (PR-UDF-065)", () => {
  it("keeps its own MemoryStorage when built without one, as before", async () => {
    const aa = new FakeAccountAggregator();
    const c = await aa.requestConsent(consentAsk());
    aa.approve(c.consentId);
    const r = await aa.fetch({
      consentId: c.consentId,
      range: c.dataRange,
      dataPrefix: DATA_PREFIX,
    });
    expect(r.payloads).toHaveLength(2);
    const types: string[] = [];
    for (const x of r.payloads) {
      const obj = await aa.storage.get(x.storageKey);
      expect(obj.meta).toMatchObject({ bucketClass: "REGULATED", contentType: "application/json" });
      expect(sha256Hex(obj.body)).toBe(x.sha256);
      // The stored bytes are the fake's synthetic ReBIT payload for that FI type and session.
      const expected = fakeFiPayload({
        fiType: x.fiType,
        maskedAccount: x.maskedAccount,
        sessionId: r.sessionId,
        range: c.dataRange,
      });
      expect(new TextDecoder().decode(obj.body)).toBe(new TextDecoder().decode(expected));
      const json = JSON.parse(new TextDecoder().decode(obj.body)) as {
        account: { type: string; version: string; maskedAccNumber: string };
      };
      expect(json.account.version).toBe(x.schemaVersion);
      expect(json.account.maskedAccNumber).toBe(x.maskedAccount);
      types.push(json.account.type);
    }
    // The ReBIT account types, as `setu-aa` maps them back (`setuFiType`).
    expect(types).toEqual(["deposit", "recurring_deposit"]);
  });

  it("the analyser's report summarises exactly the payloads the AA stored", async () => {
    const shared = new MemoryStorage();
    const aa = new FakeAccountAggregator({ storage: shared });
    const sa = new FakeStatementAnalysis({ storage: shared });
    const c = await aa.requestConsent(consentAsk());
    aa.approve(c.consentId);
    const r = await aa.fetch({
      consentId: c.consentId,
      range: c.dataRange,
      dataPrefix: DATA_PREFIX,
    });
    const a = await sa.analyse({
      subjectRef: "cus:aa-fake",
      inputs: r.payloads.map(({ fiType, storageKey, sha256 }) => ({ fiType, storageKey, sha256 })),
      reportPrefix: REPORT_PREFIX,
    });
    expect(a.state).toBe("COMPLETED");
    const report = JSON.parse(
      new TextDecoder().decode((await shared.get(a.report!.storageKey)).body),
    ) as { inputs: Array<{ fiType: string; sha256: string; bytes: number }> };
    expect(report.inputs.map((i) => [i.fiType, i.sha256])).toEqual(
      r.payloads.map((x) => [x.fiType, x.sha256]),
    );
    for (const [i, x] of r.payloads.entries())
      expect(report.inputs[i]!.bytes).toBe((await shared.get(x.storageKey)).body.byteLength);
  });
});
