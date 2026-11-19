// STATEMENT_ANALYSIS contract cases (IPB-01-15; Udofin PR-UDF-048, R1-D-202, ADR-0012). The fake
// (here), the in-platform `platform-statement` analyser and the vendor-neutral `http-statement`
// adapter (against its stub, `@infrabyx/connectors`) all pass them: a completed analysis leaves a
// REGULATED report in STORAGE under the request's prefix whose bytes match its SHA-256; a pending one
// is followed by `status`; a failed one names a reason and no report; an input outside the
// REGULATED class, or a call class other than REGULATED, is refused `IPB-PORT-003` before any
// analyser call; a missing or altered input is refused before any analyser call; a keyed retry
// answers the same analysis with one analyser call, and the key with other statements is
// `IPB-PORT-004`; every answer holds references and hashes only, with no Aadhaar-like number.
import { expect } from "vitest";
import { findAadhaarLike } from "@infrabyx/contracts/aadhaar";
import {
  StatementAnalysisRequest,
  StatementAnalysisResult,
  isValidStorageKey,
  payloadClass,
  portDefaultDataClass,
  type StatementAnalysis,
  type StatementAnalysisPort,
  type StatementAnalysisRequest as Req,
} from "@infrabyx/contracts/ports";
import { sha256Hex, ulid } from "@infrabyx/crypto";
import {
  FAKE_STATEMENT_ANALYSIS,
  FakeStatementAnalysis,
  signFakeStatementAnalysisNotification,
  type StatementAnalysisFixtures,
} from "@infrabyx/fakes";
import type { StoragePort } from "@infrabyx/contracts/ports";
import type { ContractCase } from "../contract.js";
export {
  FAKE_STATEMENT_ANALYSIS,
  FakeStatementAnalysis,
  fakeStatementAnalysisWebhookKeys,
  signFakeStatementAnalysisNotification,
  type StatementAnalysisFixtures,
} from "@infrabyx/fakes";

const enc = (s: string) => new TextEncoder().encode(s);

/** A ReBIT-shaped DEPOSIT payload as AA_FIU stores it. Test data only: no real account. */
export const contractStatement = (note = "contract"): Uint8Array =>
  enc(
    JSON.stringify({
      account: { type: "deposit", version: "1.1.3", maskedAccNumber: "XXXXXXXX4321" },
      note,
    }),
  );

/** The fake's fixtures over `storage` (the one the fake is built with). */
export function statementAnalysisFakeFixtures(
  storage: StoragePort,
): StatementAnalysisFixtures<StatementAnalysisPort> {
  return {
    storage,
    inputPrefix: "tenant/tnt_udf/statements/",
    reportPrefix: "tenant/tnt_udf/statement_reports/",
    completed: () => contractStatement(`completed-${ulid()}`),
    failed: () => enc(`not a statement ${ulid()}`),
    pending: {
      body: () => contractStatement(`${FAKE_STATEMENT_ANALYSIS.pendingMarker} ${ulid()}`),
      finish: (p, id, outcome) => (p as FakeStatementAnalysis).settle(id, outcome),
    },
    calls: (p) => (p as FakeStatementAnalysis).analyses,
    notify: (_p, id) => signFakeStatementAnalysisNotification(id),
  };
}

const RESULT_KEYS = new Set([
  "analysisId",
  "state",
  "report",
  "failureReason",
  "adapter",
  "method",
  "vendorRef",
  "checkedAt",
]);

export function statementAnalysisContractCases<P extends StatementAnalysisPort>(
  fx: StatementAnalysisFixtures<P>,
): Array<ContractCase<P>> {
  let n = 0;
  const key = () => `sa-contract-${Date.now().toString(36)}-${++n}`;
  /** Store a statement and name it as an input. */
  const input = async (
    body: Uint8Array,
    bucketClass: "REGULATED" | "CONFIDENTIAL" = "REGULATED",
  ) => {
    const storageKey = `${fx.inputPrefix}${ulid()}.json`;
    await fx.storage.put(storageKey, body, {
      bucketClass,
      contentType: "application/json",
      sha256: sha256Hex(body),
    });
    return { fiType: "DEPOSIT" as const, storageKey, sha256: sha256Hex(body) };
  };
  const request = async (bodies: Uint8Array[]): Promise<Req> => ({
    subjectRef: `cus:contract-${++n}`,
    inputs: await Promise.all(bodies.map((b) => input(b))),
    reportPrefix: fx.reportPrefix,
  });
  /** References only, the port's keys only, and no Aadhaar-like number (hex digests read as words). */
  const clean = (v: unknown) => {
    const text = JSON.stringify(v);
    expect(findAadhaarLike(text, { letters: "join" })).toEqual([]);
    return text;
  };
  const wellFormed = (p: P, a: StatementAnalysis) => {
    expect(StatementAnalysisResult.safeParse(a).success, JSON.stringify(a)).toBe(true);
    for (const k of Object.keys(a)) expect(RESULT_KEYS.has(k), k).toBe(true);
    expect(a.adapter).toBe(p.descriptor.adapter);
    clean(a);
  };
  const reportOk = async (a: StatementAnalysis) => {
    expect(a.state).toBe("COMPLETED");
    const r = a.report!;
    expect(isValidStorageKey(r.storageKey)).toBe(true);
    expect(r.storageKey.startsWith(fx.reportPrefix)).toBe(true);
    const obj = await fx.storage.get(r.storageKey);
    expect(obj.meta.bucketClass).toBe("REGULATED");
    expect(sha256Hex(obj.body)).toBe(r.sha256);
  };
  const refusal = (p: Promise<unknown>) =>
    p.then(
      () => ({ code: "resolved", reason: undefined as string | undefined }),
      (e: { code?: string; meta?: { reason?: string }; message?: string }) => {
        clean({ code: e.code, meta: e.meta, message: e.message });
        return { code: e.code, reason: e.meta?.reason };
      },
    );

  const cases: Array<ContractCase<P>> = [
    {
      name: "is REGULATED and IN: every request field is classed REGULATED, and so is the port's default",
      async run(p) {
        const c = payloadClass(StatementAnalysisRequest);
        expect(c.complete).toBe(true);
        expect(c.bodyHighest).toBe("REGULATED");
        expect(portDefaultDataClass("STATEMENT_ANALYSIS")).toBe("REGULATED");
        expect(p.descriptor.residency).toBe("IN");
        expect(p.descriptor.maxDataClass).toBe("REGULATED");
      },
    },
    {
      name: "completed: a REGULATED report under the prefix whose bytes match its SHA-256; status answers the same",
      async run(p) {
        const req = await request([fx.completed(), fx.completed()]);
        const a = await p.analyse(req);
        wellFormed(p, a);
        await reportOk(a);
        expect(a.failureReason).toBeUndefined();
        const s = await p.status(a.analysisId);
        wellFormed(p, s);
        expect(s.state).toBe("COMPLETED");
        expect(s.report).toEqual(a.report);
        expect(s.analysisId).toBe(a.analysisId);
        // References only: no input's bytes or the subject reference reach the answer.
        const text = clean([a, s]);
        expect(text).not.toContain(req.subjectRef);
        expect(text).not.toContain("maskedAccNumber");
      },
    },
    {
      name: "failed: an unreadable statement answers FAILED with a reason and no report",
      async run(p) {
        const a = await p.analyse(await request([fx.failed()]));
        wellFormed(p, a);
        expect(a.state).toBe("FAILED");
        expect(a.report).toBeUndefined();
        expect(a.failureReason).toBeDefined();
        expect((await p.status(a.analysisId)).state).toBe("FAILED");
      },
    },
    {
      name: "residency: an input outside the REGULATED class, or a call class other than REGULATED, is refused IPB-PORT-003 before any analyser call",
      async run(p) {
        const before = fx.calls(p);
        const body = fx.completed();
        const outside = await input(body, "CONFIDENTIAL");
        expect(
          await refusal(
            p.analyse({
              subjectRef: "cus:contract",
              inputs: [outside],
              reportPrefix: fx.reportPrefix,
            }),
          ),
        ).toEqual({ code: "IPB-PORT-003", reason: "residency" });
        const req = await request([fx.completed()]);
        for (const dataClass of ["CONFIDENTIAL", "SECRET"] as const)
          expect(await refusal(p.analyse(req, { dataClass }))).toEqual({
            code: "IPB-PORT-003",
            reason: "residency",
          });
        expect(fx.calls(p)).toBe(before);
        // REGULATED stated outright is the port's class, and is accepted.
        expect((await p.analyse(req, { dataClass: "REGULATED" })).state).toBe("COMPLETED");
      },
    },
    {
      name: "a missing statement, or one whose bytes do not match its SHA-256, is refused before any analyser call",
      async run(p) {
        const before = fx.calls(p);
        const missing = {
          fiType: "DEPOSIT" as const,
          storageKey: `${fx.inputPrefix}${ulid()}.json`,
          sha256: sha256Hex(fx.completed()),
        };
        expect(
          await refusal(
            p.analyse({
              subjectRef: "cus:contract",
              inputs: [missing],
              reportPrefix: fx.reportPrefix,
            }),
          ),
        ).toEqual({ code: "IPB-PORT-001", reason: "input_missing" });
        const stored = await input(fx.completed());
        const altered = { ...stored, sha256: sha256Hex(fx.completed()) };
        expect(
          await refusal(
            p.analyse({
              subjectRef: "cus:contract",
              inputs: [altered],
              reportPrefix: fx.reportPrefix,
            }),
          ),
        ).toEqual({ code: "IPB-PORT-001", reason: "hash_mismatch" });
        expect(fx.calls(p)).toBe(before);
      },
    },
    {
      name: "idempotent: a keyed retry answers the same analysis with one analyser call",
      async run(p) {
        const req = await request([fx.completed()]);
        const k = key();
        const before = fx.calls(p);
        const a = await p.analyse(req, { idempotencyKey: k });
        const b = await p.analyse(structuredClone(req), { idempotencyKey: k });
        expect(b).toEqual(a);
        expect(fx.calls(p)).toBe(before + 1);
        // Without a key, or with another key, it is a new analysis.
        const c = await p.analyse(req, { idempotencyKey: key() });
        expect(c.analysisId).not.toBe(a.analysisId);
        expect(fx.calls(p)).toBe(before + 2);
      },
    },
    {
      name: "conflict: the key with other statements, subject or prefix is IPB-PORT-004 with no analyser call",
      async run(p) {
        const req = await request([fx.completed()]);
        const k = key();
        await p.analyse(req, { idempotencyKey: k });
        const before = fx.calls(p);
        const other = await request([fx.completed()]);
        for (const changed of [
          other,
          { ...req, subjectRef: `${req.subjectRef}-other` },
          { ...req, inputs: [...req.inputs, ...other.inputs] },
        ])
          expect(await refusal(p.analyse(changed, { idempotencyKey: k }))).toEqual({
            code: "IPB-PORT-004",
            reason: "idempotency_conflict",
          });
        expect(fx.calls(p)).toBe(before);
      },
    },
    {
      name: "status of an unknown analysis is refused unknown_analysis",
      async run(p) {
        expect(await refusal(p.status(`sta_${ulid()}`))).toEqual({
          code: "IPB-PORT-001",
          reason: "unknown_analysis",
        });
      },
    },
  ];

  if (fx.pending) {
    const pending = fx.pending;
    cases.push({
      name: "pending: no report until the analyser finishes; status then answers COMPLETED or FAILED",
      async run(p) {
        const k = key();
        const req = await request([pending.body()]);
        const a = await p.analyse(req, { idempotencyKey: k });
        wellFormed(p, a);
        expect(a.state).toBe("PENDING");
        expect(a.report).toBeUndefined();
        expect((await p.status(a.analysisId)).state).toBe("PENDING");
        await pending.finish(p, a.analysisId, "COMPLETED");
        const done = await p.status(a.analysisId);
        wellFormed(p, done);
        await reportOk(done);
        // A keyed retry now answers the finished analysis, still with one analyser call.
        const calls = fx.calls(p);
        expect((await p.analyse(req, { idempotencyKey: k })).state).toBe("COMPLETED");
        expect(fx.calls(p)).toBe(calls);
        const f = await p.analyse(await request([pending.body()]));
        await pending.finish(p, f.analysisId, "FAILED");
        const failed = await p.status(f.analysisId);
        wellFormed(p, failed);
        expect(failed.state).toBe("FAILED");
        expect(failed.report).toBeUndefined();
      },
    });
  }

  cases.push({
    name: "handleWebhook: a signed notification is read back (its own state never trusted); an unsigned or altered one is refused",
    method: "handleWebhook",
    invoke: (p) => p.handleWebhook(enc("{}"), {}),
    async run(p) {
      if (!fx.notify || !fx.pending)
        throw new Error("an adapter with a webhook gives notify and pending");
      const a = await p.analyse(await request([fx.pending.body()]));
      const n = await fx.notify(p, a.analysisId);
      const got = await p.handleWebhook(n.body, n.headers);
      expect(got.analysisId).toBe(a.analysisId);
      // The notification claims COMPLETED; the analysis read back is still PENDING.
      expect(got.analysis.state).toBe("PENDING");
      wellFormed(p, got.analysis);
      // The same notification again is a replay.
      expect((await refusal(p.handleWebhook(n.body, n.headers))).code).toBe("IPB-API-018");
      const m = await fx.notify(p, a.analysisId);
      const tampered = enc(new TextDecoder().decode(m.body).replace(a.analysisId, `sta_${ulid()}`));
      expect((await refusal(p.handleWebhook(tampered, m.headers))).code).toBe("IPB-API-018");
      expect((await refusal(p.handleWebhook(m.body, {}))).code).toBe("IPB-API-018");
      expect((await refusal(p.handleWebhook(enc("not json"), m.headers))).code).toBe("IPB-API-018");
    },
  });
  return cases;
}
