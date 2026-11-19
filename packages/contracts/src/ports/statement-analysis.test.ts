// PR-UDF-048 (R1-D-202): the STATEMENT_ANALYSIS port's request, result and registration.
import { describe, expect, it } from "vitest";
import { PORT_CATALOGUE, R1_PORTS } from "./catalogue.js";
import { portDefaultDataClass } from "./common.js";
import { effectiveDataClass, payloadClass } from "./payload-class.js";
import {
  STATEMENT_ANALYSIS_MAX_INPUTS,
  assertStatementAnalysisClass,
  statementInputFormat,
  StatementAnalysisRequest,
  StatementAnalysisResult,
  statementAnalysisResultOnly,
  type StatementAnalysis,
} from "./statement-analysis.js";

const H = "a".repeat(64);
const key = (n: number, tenant = "tnt_udf") =>
  `tenant/${tenant}/los/01JA00000000000000000000${String(n).padStart(2, "0")}.json`;
const req = (over: Record<string, unknown> = {}) => ({
  subjectRef: "cus:asha-0001",
  inputs: [{ fiType: "DEPOSIT", storageKey: key(1), sha256: H }],
  reportPrefix: "tenant/tnt_udf/los/",
  ...over,
});

describe("STATEMENT_ANALYSIS request (PR-UDF-048)", () => {
  it("accepts STORAGE references with their SHA-256 in one tenant", () => {
    expect(StatementAnalysisRequest.safeParse(req()).success).toBe(true);
  });

  it("refuses unknown fields, bad keys, bad digests, duplicates and too many inputs", () => {
    const bad = [
      req({ extra: 1 }),
      req({ inputs: [] }),
      req({ inputs: [{ fiType: "DEPOSIT", storageKey: "s3://bucket/x", sha256: H }] }),
      req({ inputs: [{ fiType: "DEPOSIT", storageKey: key(1), sha256: "A".repeat(64) }] }),
      req({ inputs: [{ fiType: "PAYSLIP", storageKey: key(1), sha256: H }] }),
      req({ inputs: [{ fiType: "DEPOSIT", storageKey: key(1), sha256: H, body: "x" }] }),
      req({
        inputs: [
          { fiType: "DEPOSIT", storageKey: key(1), sha256: H },
          { fiType: "DEPOSIT", storageKey: key(1), sha256: H },
        ],
      }),
      req({
        inputs: Array.from({ length: STATEMENT_ANALYSIS_MAX_INPUTS + 1 }, (_, i) => ({
          fiType: "DEPOSIT",
          storageKey: key(i),
          sha256: H,
        })),
      }),
      req({ reportPrefix: "tenant/tnt_udf/los" }),
      req({ reportPrefix: "s3://bucket/" }),
      req({ subjectRef: "x" }),
    ];
    for (const b of bad) expect(StatementAnalysisRequest.safeParse(b).success).toBe(false);
  });

  it("keeps the inputs and the report in one tenant", () => {
    expect(
      StatementAnalysisRequest.safeParse(
        req({ inputs: [{ fiType: "DEPOSIT", storageKey: key(1, "tnt_other"), sha256: H }] }),
      ).success,
    ).toBe(false);
  });

  it("refuses a subject reference holding an Aadhaar-like number", () => {
    expect(
      StatementAnalysisRequest.safeParse(req({ subjectRef: "cus:2345 6789 0124" })).success,
    ).toBe(false);
  });

  it("classes every field REGULATED, and the port's default is REGULATED", () => {
    const r = payloadClass(StatementAnalysisRequest);
    expect(r.complete).toBe(true);
    expect(r.bodyHighest).toBe("REGULATED");
    expect(portDefaultDataClass("STATEMENT_ANALYSIS")).toBe("REGULATED");
    expect(effectiveDataClass("STATEMENT_ANALYSIS", undefined, r)).toBe("REGULATED");
    expect(() => effectiveDataClass("STATEMENT_ANALYSIS", { dataClass: "CONFIDENTIAL" })).toThrow(
      expect.objectContaining({ code: "IPB-PORT-003" }),
    );
  });

  it("is catalogued as an R1 port with its interface (ADR-0012)", () => {
    expect(PORT_CATALOGUE.STATEMENT_ANALYSIS).toMatchObject({
      tier: 2,
      configPrefix: "int.statement_analysis.",
      interfaceDefined: true,
    });
    expect(R1_PORTS).toContain("STATEMENT_ANALYSIS");
  });
});

describe("STATEMENT_ANALYSIS result (PR-UDF-048)", () => {
  const done: StatementAnalysis = {
    analysisId: "sta_01JA0000000000000000000001",
    state: "COMPLETED",
    report: { storageKey: key(9), sha256: H },
    adapter: "platform-statement",
    method: "checksum-summary-v1",
    vendorRef: "sta_01JA0000000000000000000001",
    checkedAt: "2026-11-19T00:00:00.000Z",
  };

  it("carries a report only when COMPLETED and a reason only when FAILED", () => {
    expect(StatementAnalysisResult.safeParse(done).success).toBe(true);
    const { report: _r, ...noReport } = done;
    expect(StatementAnalysisResult.safeParse(noReport).success).toBe(false);
    expect(
      StatementAnalysisResult.safeParse({
        ...noReport,
        state: "FAILED",
        failureReason: "vendor_failed",
      }).success,
    ).toBe(true);
    expect(StatementAnalysisResult.safeParse({ ...noReport, state: "FAILED" }).success).toBe(false);
    expect(StatementAnalysisResult.safeParse({ ...noReport, state: "PENDING" }).success).toBe(true);
    expect(StatementAnalysisResult.safeParse({ ...done, summary: { balance: 1 } }).success).toBe(
      false,
    );
  });

  it("keeps only the port's fields", () => {
    const extra = { ...done, transactions: [{ amount: 1 }], failureReason: "vendor_failed" };
    expect(statementAnalysisResultOnly(extra as StatementAnalysis)).toEqual(done);
  });
});

describe("STATEMENT_ANALYSIS shared checks (PR-UDF-048)", () => {
  it("takes REGULATED only: lowering or raising the class is refused IPB-PORT-003 residency", () => {
    expect(() => assertStatementAnalysisClass("x")).not.toThrow();
    expect(() => assertStatementAnalysisClass("x", { dataClass: "REGULATED" })).not.toThrow();
    for (const dataClass of ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "SECRET"] as const)
      expect(() => assertStatementAnalysisClass("x", { dataClass })).toThrow(
        expect.objectContaining({
          code: "IPB-PORT-003",
          meta: { reason: "residency", definite: true },
        }),
      );
  });

  it("recognises a statement's shape only: a JSON object or a PDF", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(statementInputFormat(enc('{"account":{}}'))).toBe("json");
    expect(statementInputFormat(enc("%PDF-1.7\n"))).toBe("pdf");
    for (const s of ["[1,2]", "null", "plain text", "", "%PD"])
      expect(statementInputFormat(enc(s))).toBeUndefined();
    expect(statementInputFormat(new Uint8Array([0xff, 0xfe, 0x7b]))).toBeUndefined();
  });
});
