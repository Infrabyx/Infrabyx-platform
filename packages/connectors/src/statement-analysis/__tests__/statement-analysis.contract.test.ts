// STATEMENT_ANALYSIS contract legs (Udofin PR-UDF-048, R1-D-202, ADR-0012). Hermetic: the
// in-platform `platform-statement` analyser over MemoryStorage, and the vendor-neutral
// `http-statement` adapter against its stub, whose shapes are stub-shaped [VERIFY] until a vendor is
// chosen (#152); both stay off and `unproven`. Then what only these adapters promise: off until their
// flags, the HTTP host required, no subject reference sent, a vendor's report kept by hash, and the
// router refusing an adapter that cannot carry REGULATED (IPB-01-16).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex, ulid } from "@infrabyx/crypto";
import {
  aaStatementAnalysisJoinCases,
  contractStatement,
  defineContractSuite,
  MemoryStorage,
  startStatementAnalysisStub,
  statementAnalysisContractCases,
  STATEMENT_ANALYSIS_STUB,
  type StatementAnalysisFixtures,
  type StatementAnalysisStub,
} from "@infrabyx/testing";
import type { RoutingFile } from "@infrabyx/contracts/routing";
import { DEFAULT_RESIDENCY_POLICY } from "@infrabyx/contracts/data-class";
import type { StatementAnalysisPort } from "@infrabyx/contracts/ports";
import { Router } from "../../core/router.js";
import { HttpStatementAnalyser, httpStatementFailure, mapHttpStatement } from "../http.js";
import { PlatformStatementAnalyser, PLATFORM_STATEMENT_REPORT_SCHEMA } from "../platform.js";

const TENANT = "tnt_udf";
const storage = new MemoryStorage();
const enc = (s: string) => new TextEncoder().encode(s);
let stub: StatementAnalysisStub;
let enabled = true;
let host = "analyser.example.in";

beforeAll(async () => {
  stub = await startStatementAnalysisStub();
});
afterAll(async () => stub?.close());

const platform = () =>
  new PlatformStatementAnalyser({ storage, enabled: () => enabled, tenantId: () => TENANT });
const http = () =>
  new HttpStatementAnalyser({
    storage,
    enabled: () => enabled,
    host: () => host,
    apiKey: () => stub.apiKey,
    tenantId: () => TENANT,
    baseUrl: stub.url,
    allowLoopbackHttp: true,
  });

const base = {
  storage,
  inputPrefix: `tenant/${TENANT}/statements/`,
  reportPrefix: `tenant/${TENANT}/statement_reports/`,
  completed: () => contractStatement(`completed-${ulid()}`),
  failed: () => enc(`not a statement ${ulid()}`),
};

describe("@IPB-01-15 STATEMENT_ANALYSIS hermetic leg (platform-statement)", () => {
  const fixtures: StatementAnalysisFixtures<PlatformStatementAnalyser> = {
    ...base,
    calls: (p) => p.analyses,
  };
  defineContractSuite("STATEMENT_ANALYSIS", platform, statementAnalysisContractCases(fixtures), {
    leg: "hermetic",
  });
  // PR-UDF-065: the fake AA's FI payloads, analysed by reference from the same STORAGE.
  defineContractSuite(
    "STATEMENT_ANALYSIS",
    platform,
    aaStatementAnalysisJoinCases<PlatformStatementAnalyser>({
      storage,
      dataPrefix: `tenant/${TENANT}/aa_fi/`,
      reportPrefix: base.reportPrefix,
      calls: (p) => p.analyses,
    }),
    { leg: "hermetic" },
  );
});

describe("@IPB-01-15 STATEMENT_ANALYSIS hermetic leg (http-statement, stub)", () => {
  const fixtures: StatementAnalysisFixtures<HttpStatementAnalyser> = {
    ...base,
    pending: {
      body: () => contractStatement(`${STATEMENT_ANALYSIS_STUB.pendingMarker} ${ulid()}`),
      async finish(p, id, outcome) {
        stub.complete((await p.status(id)).vendorRef, outcome);
      },
    },
    calls: () => stub.creates().length,
  };
  defineContractSuite("STATEMENT_ANALYSIS", http, statementAnalysisContractCases(fixtures), {
    leg: "hermetic",
  });
});

const put = async (body: Uint8Array) => {
  const storageKey = `${base.inputPrefix}${ulid()}.json`;
  await storage.put(storageKey, body, {
    bucketClass: "REGULATED",
    contentType: "application/json",
  });
  return { fiType: "DEPOSIT" as const, storageKey, sha256: sha256Hex(body) };
};
const ask = async (body = contractStatement(`own-${ulid()}`)) => ({
  subjectRef: "cus:asha-0001",
  inputs: [await put(body)],
  reportPrefix: base.reportPrefix,
});

describe("R1-D-202 the statement analysis adapters", () => {
  it("are off until their flags: nothing is read or sent, and health is down", async () => {
    enabled = false;
    try {
      const sent = stub.requests.length;
      for (const p of [platform(), http()]) {
        await expect(p.analyse(await ask())).rejects.toMatchObject({
          code: "IPB-PORT-001",
          meta: { reason: "adapter_disabled" },
        });
        expect((await p.health()).status).toBe("down");
      }
      expect(stub.requests.length).toBe(sent);
    } finally {
      enabled = true;
    }
  });

  it("the HTTP adapter needs its host, and calls no other", async () => {
    for (const bad of ["", "not a host", "https://analyser.example.in/x"]) {
      host = bad;
      try {
        await expect(http().analyse(await ask())).rejects.toMatchObject({
          code: "IPB-PORT-001",
          meta: { reason: "adapter_unconfigured" },
        });
        expect((await http().health()).status).toBe("down");
      } finally {
        host = "analyser.example.in";
      }
    }
    expect((await http().health()).status).toBe("up");
  });

  it("sends the statements but never the subject reference, and keeps the vendor's report by hash", async () => {
    const req = await ask();
    const a = await http().analyse(req);
    expect(a.state).toBe("COMPLETED");
    expect(a.method).toBe(`http:${STATEMENT_ANALYSIS_STUB.method}`);
    const sent = stub.creates().at(-1)!;
    expect(sent.headers.authorization).toBe(`Bearer ${stub.apiKey}`);
    expect(sent.body.toString("utf8")).not.toContain(req.subjectRef);
    expect(sent.json<{ referenceId: string }>().referenceId).toBe(a.analysisId);
    const report = await storage.get(a.report!.storageKey);
    expect(sha256Hex(report.body)).toBe(a.report!.sha256);
    expect(JSON.parse(new TextDecoder().decode(report.body)).digests).toEqual([
      req.inputs[0]!.sha256,
    ]);
  });

  it("maps a vendor failure label; a vendor outage on status keeps the analysis PENDING; the answer is checked", async () => {
    const a = await http().analyse(await ask(enc(`unreadable ${ulid()}`)));
    expect(a).toMatchObject({ state: "FAILED", failureReason: "unreadable_input" });
    const h = http();
    const p = await h.analyse(
      await ask(contractStatement(`${STATEMENT_ANALYSIS_STUB.pendingMarker} ${ulid()}`)),
    );
    expect(p.state).toBe("PENDING");
    // Another instance (another store) does not know the analysis.
    await expect(http().status(p.analysisId)).rejects.toMatchObject({
      code: "IPB-PORT-001",
      meta: { reason: "unknown_analysis" },
    });
    // The read is retried once; two failures are an outage, and the record stays PENDING.
    stub.failNext(2, 500);
    await expect(h.status(p.analysisId)).rejects.toMatchObject({ code: "IPB-PORT-002" });
    expect((await h.status(p.analysisId)).state).toBe("PENDING");
    stub.complete(p.vendorRef, "FAILED");
    expect(await h.status(p.analysisId)).toMatchObject({
      state: "FAILED",
      failureReason: "unsupported_input",
    });
    expect(() => mapHttpStatement({ status: "COMPLETED" })).toThrow();
    expect(() => mapHttpStatement({ id: "x", status: "DONE" })).toThrow();
    expect(() => mapHttpStatement({ id: "x", status: "COMPLETED" })).toThrow();
    expect(mapHttpStatement({ id: "x", status: "queued", method: "a b" })).toEqual({
      id: "x",
      state: "PENDING",
      method: "http:unknown",
    });
    expect(httpStatementFailure("SOMETHING_ELSE")).toBe("vendor_failed");
  });

  it("the in-platform report is a checksum summary with nothing from the statement", async () => {
    const body = contractStatement(`secret-note-${ulid()}`);
    const a = await platform().analyse(await ask(body));
    const report = JSON.parse(
      new TextDecoder().decode((await storage.get(a.report!.storageKey)).body),
    ) as { schema: string; statements: Array<Record<string, unknown>> };
    expect(report.schema).toBe(PLATFORM_STATEMENT_REPORT_SCHEMA);
    expect(report.statements).toEqual([
      { fiType: "DEPOSIT", sha256: sha256Hex(body), bytes: body.byteLength, format: "json" },
    ]);
    expect(JSON.stringify(report)).not.toContain("secret-note");
    const pdf = await platform().analyse(await ask(enc(`%PDF-1.7 ${ulid()}`)));
    expect(pdf.state).toBe("COMPLETED");
  });

  it("@IPB-01-16 the router refuses an instance that cannot carry REGULATED, and one that disagrees with its descriptor", async () => {
    const file = (residency: "IN" | "GLOBAL", maxClass: "REGULATED" | "CONFIDENTIAL") =>
      ({
        version: 1,
        product: "udf",
        env: "local",
        ports: {
          STATEMENT_ANALYSIS: {
            primary: { adapter: "platform-statement", residency, max_data_class: maxClass },
          },
        },
      }) as unknown as RoutingFile;
    const build = (f: RoutingFile) =>
      Router.create({
        routing: {
          env: "local",
          file: f,
          policyFor: () => ({ ...DEFAULT_RESIDENCY_POLICY }) as never,
        },
        factories: { "platform-statement": () => platform() },
      });
    await expect(build(file("GLOBAL", "REGULATED"))).rejects.toMatchObject({
      code: "IPB-PORT-005",
    });
    // An instance routed as IN but capped below REGULATED is refused at the call, before any read.
    const r = await build(file("IN", "CONFIDENTIAL"));
    const p = r.port<StatementAnalysisPort>("STATEMENT_ANALYSIS");
    const before = (r.adapter("STATEMENT_ANALYSIS") as PlatformStatementAnalyser).analyses;
    await expect(p.analyse(await ask())).rejects.toMatchObject({ code: "IPB-PORT-003" });
    await expect(p.status(`sta_${ulid()}`)).rejects.toMatchObject({ code: "IPB-PORT-003" });
    expect((r.adapter("STATEMENT_ANALYSIS") as PlatformStatementAnalyser).analyses).toBe(before);
    // Routed as it declares itself, the call goes through.
    const ok = await build(file("IN", "REGULATED"));
    expect(
      (await ok.port<StatementAnalysisPort>("STATEMENT_ANALYSIS").analyse(await ask())).state,
    ).toBe("COMPLETED");
  });
});
