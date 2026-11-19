// PR-UDF-048 (R1-D-202): the STATEMENT_ANALYSIS contract runs against the fake, as every adapter's
// does; then what only the fake promises (its development-key webhook and its state by bytes).
import { describe, expect, it } from "vitest";
import { MemoryStorage } from "@infrabyx/fakes";
import { defineContractSuite } from "../contract.js";
import {
  FakeStatementAnalysis,
  contractStatement,
  signFakeStatementAnalysisNotification,
  statementAnalysisContractCases,
  statementAnalysisFakeFixtures,
} from "./statement-analysis.js";

const storage = new MemoryStorage();
defineContractSuite(
  "STATEMENT_ANALYSIS",
  () => new FakeStatementAnalysis({ storage }),
  statementAnalysisContractCases(statementAnalysisFakeFixtures(storage)),
);

describe("the statement analysis fake", () => {
  it("refuses a notification signed by another key, or stale, before any read", async () => {
    const p = new FakeStatementAnalysis({ storage });
    const fx = statementAnalysisFakeFixtures(storage);
    const key = `${fx.inputPrefix}01JA0000000000000000000001.json`;
    const body = contractStatement("fake-only");
    await storage.put(key, body, { bucketClass: "REGULATED" });
    const { sha256Hex } = await import("@infrabyx/crypto");
    const a = await p.analyse({
      subjectRef: "cus:fake",
      inputs: [{ fiType: "DEPOSIT", storageKey: key, sha256: sha256Hex(body) }],
      reportPrefix: fx.reportPrefix,
    });
    const other = await signFakeStatementAnalysisNotification(a.analysisId, {
      kid: "local:sign:fake-statement-other",
    });
    await expect(p.handleWebhook(other.body, other.headers)).rejects.toMatchObject({
      code: "IPB-API-018",
      meta: { reason: "webhook_invalid" },
    });
    const stale = await signFakeStatementAnalysisNotification(a.analysisId, {
      now: new Date(Date.now() - 3600_000),
    });
    await expect(p.handleWebhook(stale.body, stale.headers)).rejects.toMatchObject({
      code: "IPB-API-018",
    });
    const ok = await signFakeStatementAnalysisNotification(a.analysisId);
    expect((await p.handleWebhook(ok.body, ok.headers)).analysis.state).toBe("COMPLETED");
  });
});
