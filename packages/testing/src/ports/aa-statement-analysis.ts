// AA_FIU → STORAGE → STATEMENT_ANALYSIS join cases (IPB-01-15; Udofin PR-UDF-065, R1-D-243). An
// Account Aggregator's fetch lands each FI payload in STORAGE (REGULATED class, an IPB-01-27 key
// under the fetch's prefix, the SHA-256 of exactly the stored bytes) and a STATEMENT_ANALYSIS
// adapter analyses them by those references alone. The cases run against the analyser (`P`) with an
// AA over the same STORAGE (`FakeAccountAggregator` unless the fixtures give another): the analysis
// reads the stored payloads and writes a REGULATED report; a payload altered or removed after the
// fetch is refused before any analyser call; so is a payload outside the REGULATED class, a key
// outside IPB-01-27 and an AA fetch to a prefix outside it. Synthetic data only.
import { expect } from "vitest";
import { findAadhaarLike } from "@infrabyx/contracts/aadhaar";
import {
  isValidStorageKey,
  statementInputFormat,
  type AaConsent,
  type AaFetchResult,
  type AccountAggregatorPort,
  type FiType,
  type StatementAnalysisPort,
  type StatementAnalysisRequest,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { newId, sha256Hex, ulid } from "@infrabyx/crypto";
import { FakeAccountAggregator } from "@infrabyx/fakes";
import type { ContractCase } from "../contract.js";

/** Inputs of the join cases: one STORAGE that the AA writes and the analyser reads. */
export interface AaStatementAnalysisJoinFixtures<
  P extends StatementAnalysisPort = StatementAnalysisPort,
> {
  /** The STORAGE the AA writes FI payloads to and the analyser reads them from (and reports to). */
  storage: StoragePort;
  /** `tenant/<tenant>/<module>/` the AA writes FI payloads under, in the analyser's tenant. */
  dataPrefix: string;
  /** The same tenant's prefix for the analysis report. */
  reportPrefix: string;
  /** Analyses the analyser has been asked for so far. */
  calls(p: P): number;
  /** A fresh AA over `storage`; a `FakeAccountAggregator` over it by default. */
  aa?: () => AccountAggregatorPort;
  /** Plays the customer approving a consent at the AA; the fake's hook by default. */
  approve?: (aa: AccountAggregatorPort, consentId: string) => Promise<void>;
  /** The customer's AA handle; the fake's by default. */
  customerHandle?: string;
}

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

export function aaStatementAnalysisJoinCases<P extends StatementAnalysisPort>(
  fx: AaStatementAnalysisJoinFixtures<P>,
): Array<ContractCase<P>> {
  const makeAa = fx.aa ?? (() => new FakeAccountAggregator({ storage: fx.storage }));
  const approve = fx.approve ?? (async (aa, id) => (aa as FakeAccountAggregator).approve(id));
  let n = 0;

  /** An ACTIVE consent at a fresh AA, and one fetch of `fiTypes` under it. */
  const fetched = async (
    fiTypes: FiType[] = ["DEPOSIT", "TERM_DEPOSIT"],
  ): Promise<{ aa: AccountAggregatorPort; consent: AaConsent; result: AaFetchResult }> => {
    const aa = makeAa();
    const now = Date.now();
    const consent = await aa.requestConsent({
      customerHandle: fx.customerHandle ?? "asha.rao@fake-aa",
      subjectRef: `cus:aa-join-${++n}`,
      consentRef: newId("cpr"),
      purposeCode: "101",
      fiTypes,
      fetchType: "ONETIME",
      dataRange: {
        from: new Date(now - 180 * 86_400_000).toISOString(),
        to: new Date(now).toISOString(),
      },
      dataLife: { unit: "MONTH", value: 3 },
      consentStart: new Date(now).toISOString(),
      consentExpiry: new Date(now + 30 * 86_400_000).toISOString(),
    });
    await approve(aa, consent.consentId);
    const result = await aa.fetch({
      consentId: consent.consentId,
      range: { from: consent.dataRange.from, to: consent.dataRange.to },
      dataPrefix: fx.dataPrefix,
    });
    return { aa, consent, result };
  };
  /** The analysis request naming the fetch's payloads by reference only. */
  const request = (r: AaFetchResult): StatementAnalysisRequest => ({
    subjectRef: `cus:aa-join-${++n}`,
    inputs: r.payloads.map(({ fiType, storageKey, sha256 }) => ({ fiType, storageKey, sha256 })),
    reportPrefix: fx.reportPrefix,
  });
  const refusal = (p: Promise<unknown>) =>
    p.then(
      () => ({ code: "resolved", reason: undefined as string | undefined }),
      (e: { code?: string; meta?: { reason?: string } }) => ({
        code: e.code,
        reason: e.meta?.reason,
      }),
    );

  return [
    {
      name: "the AA's fetch lands each FI payload in STORAGE (REGULATED, an IPB-01-27 key, the SHA-256 of the stored bytes) and the analysis reads them by reference into a REGULATED report (PR-UDF-065)",
      async run(p) {
        const { result } = await fetched();
        expect(result.payloads.map((x) => x.fiType).sort()).toEqual(["DEPOSIT", "TERM_DEPOSIT"]);
        for (const x of result.payloads) {
          expect(isValidStorageKey(x.storageKey), x.storageKey).toBe(true);
          expect(x.storageKey.startsWith(fx.dataPrefix)).toBe(true);
          const obj = await fx.storage.get(x.storageKey);
          expect(obj.meta.bucketClass).toBe("REGULATED");
          expect(x.sha256).toMatch(/^[0-9a-f]{64}$/);
          expect(sha256Hex(obj.body)).toBe(x.sha256);
          // A ReBIT JSON object the analyser reads, synthetic: no Aadhaar-like number in it.
          expect(statementInputFormat(obj.body)).toBe("json");
          expect(findAadhaarLike(dec(obj.body))).toEqual([]);
        }
        const before = fx.calls(p);
        const req = request(result);
        const a = await p.analyse(req);
        expect(a.state).toBe("COMPLETED");
        expect(fx.calls(p)).toBe(before + 1);
        const report = a.report!;
        expect(isValidStorageKey(report.storageKey)).toBe(true);
        expect(report.storageKey.startsWith(fx.reportPrefix)).toBe(true);
        const stored = await fx.storage.get(report.storageKey);
        expect(stored.meta.bucketClass).toBe("REGULATED");
        expect(sha256Hex(stored.body)).toBe(report.sha256);
        // References only: nothing of the payloads reaches the answer.
        const text = JSON.stringify(a);
        expect(text).not.toContain("maskedAccNumber");
        expect(text).not.toContain(req.subjectRef);
        expect((await p.status(a.analysisId)).report).toEqual(a.report);
      },
    },
    {
      name: "an FI payload altered or removed after the fetch is refused hash_mismatch or input_missing before any analyser call (PR-UDF-065)",
      async run(p) {
        const { result } = await fetched(["DEPOSIT"]);
        const x = result.payloads[0]!;
        const before = fx.calls(p);
        // Altered in place: same key and class, other bytes.
        const original = await fx.storage.get(x.storageKey);
        const tampered = enc(dec(original.body).replace("SYNTHETIC CREDIT", "SYNTHETIC DEBIT"));
        expect(sha256Hex(tampered)).not.toBe(x.sha256);
        await fx.storage.put(x.storageKey, tampered, {
          bucketClass: "REGULATED",
          contentType: "application/json",
        });
        expect(await refusal(p.analyse(request(result)))).toEqual({
          code: "IPB-PORT-001",
          reason: "hash_mismatch",
        });
        // Removed: the reference names nothing.
        const second = await fetched(["DEPOSIT"]);
        await fx.storage.delete(second.result.payloads[0]!.storageKey);
        expect(await refusal(p.analyse(request(second.result)))).toEqual({
          code: "IPB-PORT-001",
          reason: "input_missing",
        });
        expect(fx.calls(p)).toBe(before);
      },
    },
    {
      name: "an FI payload outside the REGULATED class, a key outside IPB-01-27 or an AA prefix outside it is refused before any analyser call (PR-UDF-065)",
      async run(p) {
        const { aa, consent, result } = await fetched(["DEPOSIT"]);
        const x = result.payloads[0]!;
        const body = (await fx.storage.get(x.storageKey)).body;
        const before = fx.calls(p);
        // The same bytes copied to the CONFIDENTIAL class: refused for residency.
        const confidential = `${fx.dataPrefix}${ulid()}.json`;
        await fx.storage.put(confidential, body, {
          bucketClass: "CONFIDENTIAL",
          contentType: "application/json",
        });
        expect(
          await refusal(
            p.analyse({
              subjectRef: `cus:aa-join-${++n}`,
              inputs: [{ fiType: x.fiType, storageKey: confidential, sha256: x.sha256 }],
              reportPrefix: fx.reportPrefix,
            }),
          ),
        ).toEqual({ code: "IPB-PORT-003", reason: "residency" });
        // A key outside IPB-01-27 (the shape the fake AA used before PR-UDF-065): refused by the
        // request's schema.
        for (const storageKey of [
          `${fx.dataPrefix}${result.sessionId}-deposit.json`,
          `${fx.dataPrefix}nested/${ulid()}.json`,
          `loan_docs/${ulid()}.json`,
        ]) {
          expect(isValidStorageKey(storageKey), storageKey).toBe(false);
          await expect(
            p.analyse({
              subjectRef: `cus:aa-join-${++n}`,
              inputs: [{ fiType: x.fiType, storageKey, sha256: x.sha256 }],
              reportPrefix: fx.reportPrefix,
            }),
          ).rejects.toThrow();
        }
        expect(fx.calls(p)).toBe(before);
        // The AA refuses a prefix outside `tenant/<tenant>/<module>/` and stores nothing.
        const kept = (await fx.storage.list(fx.dataPrefix)).keys.length;
        for (const dataPrefix of ["loan_docs/", fx.dataPrefix.slice(0, -1), `${fx.dataPrefix}x/`])
          await expect(
            aa.fetch({
              consentId: consent.consentId,
              range: { from: consent.dataRange.from, to: consent.dataRange.to },
              dataPrefix,
            }),
          ).rejects.toThrow();
        expect((await fx.storage.list(fx.dataPrefix)).keys.length).toBe(kept);
      },
    },
  ];
}
