// PgStatementAnalysisStore on PostgreSQL 18 with every platform migration applied (Udofin
// PR-UDF-048, R1-D-202; threat model §3.144; connectors/0014): records by tenant under forced RLS,
// every column classed, the key and the request as hashes only (no subject, no input key, no
// statement), the conflict rule, the first final answer kept, the guard trigger, expiry and purge;
// then both adapters' contract cases on this store, and the HTTP adapter's keyed retry served on
// another instance with one vendor call, with the contract's sweep over the rows and the ledger.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findAadhaarLike } from "@infrabyx/contracts/aadhaar";
import type { StatementAnalysis } from "@infrabyx/contracts/ports";
import { sha256Hex, ulid } from "@infrabyx/crypto";
import {
  contractStatement,
  MemoryStorage,
  startPostgres,
  startStatementAnalysisStub,
  statementAnalysisContractCases,
  STATEMENT_ANALYSIS_STUB,
  withTenant,
  type StatementAnalysisFixtures,
  type StatementAnalysisStub,
  type TestDatabase,
} from "@infrabyx/testing";
import { HttpStatementAnalyser } from "../statement-analysis/http.js";
import { PlatformStatementAnalyser } from "../statement-analysis/platform.js";
import {
  PgStatementAnalysisStore,
  statementAnalysisKeyHash,
  statementAnalysisRequestHash,
  type StatementAnalysisStoreRequest,
} from "../statement-analysis/store.js";

let db: TestDatabase;
let stub: StatementAnalysisStub;
beforeAll(async () => {
  db = await startPostgres();
  stub = await startStatementAnalysisStub();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'LD', 'A'), ('tnt_b', 'LD', 'B')",
  );
});
afterAll(async () => {
  await stub?.close();
  await db?.end();
});

const store = (ttlHours?: number) =>
  new PgStatementAnalysisStore({
    kernel: db.kernel,
    audit: db.audit,
    context: (t) => withTenant(t, ["ORG_ADMIN"], { principal: { id: "svc_sta", type: "service" } }),
    ...(ttlHours !== undefined ? { ttlHours } : {}),
  });

const INPUT = `tenant/tnt_a/statements/${"01JA0000000000000000000001"}.json`;
const DIGEST = sha256Hex("statement bytes");
const req = (over: Partial<StatementAnalysisStoreRequest> = {}): StatementAnalysisStoreRequest => ({
  tenantId: "tnt_a",
  adapter: "platform-statement",
  idempotencyKey: "sta-key-1",
  request: {
    subjectRef: "cus:asha-0001",
    inputs: [{ fiType: "DEPOSIT", storageKey: INPUT, sha256: DIGEST }],
    reportPrefix: "tenant/tnt_a/statement_reports/",
  },
  ...over,
});
const answer = (
  id: string,
  state: StatementAnalysis["state"] = "COMPLETED",
): StatementAnalysis => ({
  analysisId: id,
  state,
  ...(state === "COMPLETED"
    ? {
        report: {
          storageKey: `tenant/tnt_a/statement_reports/01JA00000000000000000000R1.json`,
          sha256: "c".repeat(64),
        },
      }
    : {}),
  ...(state === "FAILED" ? { failureReason: "vendor_failed" as const } : {}),
  adapter: "platform-statement",
  method: "checksum-summary-v1",
  vendorRef: id,
  checkedAt: "2026-11-19T00:00:00.000Z",
});

const ledger = async (tenant = "tnt_a") =>
  (
    await db.admin.query(
      "select * from audit.ledger where tenant_id = $1 and action like 'connectors.statement_analysis.%' order by seq",
      [tenant],
    )
  ).rows;

describe("connectors.statement_analysis (PR-UDF-048, threat model §3.144)", () => {
  it("is tenant-scoped with RLS enabled and forced, granted as its peers, every column classed", async () => {
    const rls = await db.admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "select relrowsecurity, relforcerowsecurity from pg_class where oid = 'connectors.statement_analysis'::regclass",
    );
    expect(rls.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    const grants = await db.admin.query<{ g: string }>(
      `select grantee || ':' || string_agg(privilege_type, ',' order by privilege_type) as g
         from information_schema.role_table_grants
        where table_schema = 'connectors' and table_name = 'statement_analysis'
          and grantee in ('app_rw', 'app_ro') group by grantee order by grantee`,
    );
    expect(grants.rows.map((r) => r.g)).toEqual([
      "app_ro:SELECT",
      "app_rw:DELETE,INSERT,SELECT,UPDATE",
    ]);
    const classes = await db.admin.query<{ n: string; c: string | null }>(
      `select attname as n, col_description('connectors.statement_analysis'::regclass, attnum) as c
         from pg_attribute where attrelid = 'connectors.statement_analysis'::regclass
          and attnum > 0 and not attisdropped`,
    );
    expect(classes.rows.length).toBe(12);
    for (const r of classes.rows) expect(r.c).toMatch(/^dataclass:[A-Z]+$/);
    expect(classes.rows.find((r) => r.n === "result")?.c).toBe("dataclass:REGULATED");
  });

  it("reserves, records and replays a keyed analysis; keeps hashes only", async () => {
    const s = store();
    const r = await s.reserve(req());
    expect(r.kind).toBe("new");
    const id = r.analysisId;
    expect(await s.reserve(req())).toEqual({ kind: "requested", analysisId: id });
    expect(await s.get("tnt_a", "platform-statement", id)).toEqual({
      analysisId: id,
      reportPrefix: "tenant/tnt_a/statement_reports/",
    });
    expect(await s.record("tnt_a", "platform-statement", id, answer(id, "PENDING"))).toEqual(
      answer(id, "PENDING"),
    );
    expect(await s.record("tnt_a", "platform-statement", id, answer(id))).toEqual(answer(id));
    expect(await s.reserve(req())).toEqual({
      kind: "answered",
      analysisId: id,
      result: answer(id),
    });
    const rows = (await db.admin.query("select * from connectors.statement_analysis")).rows;
    const text = JSON.stringify(rows);
    for (const v of ["sta-key-1", "cus:asha-0001", INPUT, DIGEST]) expect(text).not.toContain(v);
    expect(rows[0]).toMatchObject({
      id,
      key_hash: statementAnalysisKeyHash("sta-key-1"),
      request_hash: statementAnalysisRequestHash(req().request),
      state: "completed",
      vendor_ref: id,
    });
    expect(Object.keys(rows[0] as object).sort()).toEqual(
      [
        "adapter",
        "created_at",
        "expires_at",
        "id",
        "key_hash",
        "report_prefix",
        "request_hash",
        "result",
        "state",
        "tenant_id",
        "updated_at",
        "vendor_ref",
      ].sort(),
    );
  });

  it("the key with another request is IPB-PORT-004; a final answer is never overwritten; unkeyed calls are each new", async () => {
    const s = store();
    for (const over of [
      { subjectRef: "cus:other" },
      { reportPrefix: "tenant/tnt_a/other_reports/" },
      { inputs: [{ fiType: "TERM_DEPOSIT" as const, storageKey: INPUT, sha256: DIGEST }] },
      { inputs: [{ fiType: "DEPOSIT" as const, storageKey: INPUT, sha256: "d".repeat(64) }] },
    ])
      await expect(
        s.reserve(req({ request: { ...req().request, ...over } })),
      ).rejects.toMatchObject({ code: "IPB-PORT-004", meta: { reason: "idempotency_conflict" } });
    const k = req({ idempotencyKey: "sta-key-2" });
    const id = (await s.reserve(k)).analysisId;
    expect(await s.record("tnt_a", "platform-statement", id, answer(id, "FAILED"))).toEqual(
      answer(id, "FAILED"),
    );
    expect(await s.record("tnt_a", "platform-statement", id, answer(id))).toEqual(
      answer(id, "FAILED"),
    );
    const { idempotencyKey: _k, ...unkeyed } = req();
    const a = await s.reserve(unkeyed);
    const b = await s.reserve(unkeyed);
    expect(a.kind).toBe("new");
    expect(b.kind).toBe("new");
    expect(a.analysisId).not.toBe(b.analysisId);
  });

  it("the ledger names the step, the row, the key's hash and the state; never the key, subject or inputs", async () => {
    const rows = await ledger();
    expect(rows.map((r) => (r as { action: string }).action).slice(0, 6)).toEqual([
      "connectors.statement_analysis.reserve",
      "connectors.statement_analysis.found",
      "connectors.statement_analysis.record",
      "connectors.statement_analysis.record",
      "connectors.statement_analysis.replay",
      "connectors.statement_analysis.reserve",
    ]);
    const all = JSON.stringify(rows);
    for (const v of ["sta-key-1", "sta-key-2", "cus:asha-0001", INPUT, DIGEST])
      expect(all).not.toContain(v);
    expect(findAadhaarLike(all, { letters: "join" })).toEqual([]);
  });

  it("another tenant neither reads the record nor collides with its key; a row's prefix is its tenant's", async () => {
    const s = store();
    expect(
      await db.kernel.read(withTenant("tnt_b"), (tx) =>
        tx.query("select * from connectors.statement_analysis"),
      ),
    ).toMatchObject({ rowCount: 0 });
    const a = (await s.reserve(req())).analysisId;
    expect(await s.get("tnt_b", "platform-statement", a)).toBeUndefined();
    const b = await s.reserve(
      req({
        tenantId: "tnt_b",
        request: { ...req().request, reportPrefix: "tenant/tnt_b/statement_reports/" },
      }),
    );
    expect(b.kind).toBe("new");
    await expect(
      db.kernel.mutate(withTenant("tnt_b"), (tx) =>
        tx.query(
          `insert into connectors.statement_analysis
             (id, tenant_id, adapter, request_hash, report_prefix, state, expires_at)
           values ($1, 'tnt_b', 'platform-statement', $2, 'tenant/tnt_a/x/', 'requested', now())`,
          [`sta_${ulid()}`, "b".repeat(64)],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      db.kernel.mutate(withTenant("tnt_b"), (tx) =>
        tx.query(
          `insert into connectors.statement_analysis
             (id, tenant_id, adapter, request_hash, report_prefix, state, expires_at)
           values ($1, 'tnt_a', 'platform-statement', $2, 'tenant/tnt_a/x/', 'requested', now())`,
          [`sta_${ulid()}`, "b".repeat(64)],
        ),
      ),
    ).rejects.toThrow();
  });

  it("a final record is not changed, a record keeps its binding and its vendor reference; an expired one is forgotten and purged", async () => {
    await expect(
      db.kernel.mutate(withTenant("tnt_a"), (tx) =>
        tx.query(
          "update connectors.statement_analysis set state = 'pending' where state = 'completed'",
        ),
      ),
    ).rejects.toThrow(/final/);
    await expect(
      db.kernel.mutate(withTenant("tnt_a"), (tx) =>
        tx.query(
          "update connectors.statement_analysis set report_prefix = 'tenant/tnt_a/moved/' where state = 'requested'",
        ),
      ),
    ).rejects.toThrow(/keeps its binding/);
    const s = store();
    const id = (await s.reserve(req({ idempotencyKey: "sta-key-3" }))).analysisId;
    await s.record("tnt_a", "platform-statement", id, {
      ...answer(id, "PENDING"),
      vendorRef: "v-1",
    });
    await expect(
      db.kernel.mutate(withTenant("tnt_a"), (tx) =>
        tx.query("update connectors.statement_analysis set vendor_ref = 'v-2' where id = $1", [id]),
      ),
    ).rejects.toThrow(/vendor reference/);
    // Another vendor reference for the analysis is not kept.
    expect(
      await s.record("tnt_a", "platform-statement", id, { ...answer(id), vendorRef: "v-2" }),
    ).toMatchObject({ state: "PENDING", vendorRef: "v-1" });
    const short = store(0);
    const r = req({ idempotencyKey: "sta-key-exp" });
    const first = await short.reserve(r);
    expect(await short.get("tnt_a", "platform-statement", first.analysisId)).toBeUndefined();
    expect((await short.reserve(r)).kind).toBe("new");
    expect(await short.purgeExpired("tnt_a")).toBeGreaterThanOrEqual(1);
  });
});

describe("the statement analysis adapters on PostgreSQL (PR-UDF-048)", () => {
  const storage = new MemoryStorage();
  const base = {
    storage,
    inputPrefix: "tenant/tnt_b/statements/",
    reportPrefix: "tenant/tnt_b/statement_reports/",
    completed: () => contractStatement(`completed-${ulid()}`),
    failed: () => new TextEncoder().encode(`not a statement ${ulid()}`),
  };
  const platform = () =>
    new PlatformStatementAnalyser({
      storage,
      store: store(),
      enabled: () => true,
      tenantId: () => "tnt_b",
    });
  const http = () =>
    new HttpStatementAnalyser({
      storage,
      store: store(),
      enabled: () => true,
      host: () => "analyser.example.in",
      apiKey: () => stub.apiKey,
      tenantId: () => "tnt_b",
      baseUrl: stub.url,
      allowLoopbackHttp: true,
    });

  it("pass the contract cases on the PostgreSQL store", async () => {
    const pf: StatementAnalysisFixtures<PlatformStatementAnalyser> = {
      ...base,
      calls: (p) => p.analyses,
    };
    const hf: StatementAnalysisFixtures<HttpStatementAnalyser> = {
      ...base,
      pending: {
        body: () => contractStatement(`${STATEMENT_ANALYSIS_STUB.pendingMarker} ${ulid()}`),
        async finish(p, id, outcome) {
          stub.complete((await p.status(id)).vendorRef, outcome);
        },
      },
      calls: () => stub.creates().length,
    };
    const one = platform();
    for (const c of statementAnalysisContractCases(pf)) if (!c.method) await c.run(one);
    const two = http();
    for (const c of statementAnalysisContractCases(hf)) if (!c.method) await c.run(two);
  });

  it("the HTTP adapter's keyed retry is served on another instance with one vendor call; rows and ledger hold no statement", async () => {
    const body = contractStatement(`retry-${ulid()}`);
    const storageKey = `${base.inputPrefix}${ulid()}.json`;
    await storage.put(storageKey, body, { bucketClass: "REGULATED" });
    const r = {
      subjectRef: "cus:retry-0001",
      inputs: [{ fiType: "DEPOSIT" as const, storageKey, sha256: sha256Hex(body) }],
      reportPrefix: base.reportPrefix,
    };
    const calls = stub.creates().length;
    const first = await http().analyse(r, { idempotencyKey: "sta-adapter-1" });
    expect(await http().analyse(r, { idempotencyKey: "sta-adapter-1" })).toEqual(first);
    expect(stub.creates().length).toBe(calls + 1);
    expect((await http().status(first.analysisId)).state).toBe("COMPLETED");
    const rows = JSON.stringify(
      (await db.admin.query("select * from connectors.statement_analysis")).rows,
    );
    const led = JSON.stringify(await ledger("tnt_b"));
    for (const text of [rows, led]) {
      for (const v of ["cus:retry-0001", storageKey, sha256Hex(body), "sta-adapter-1"])
        expect(text).not.toContain(v);
      expect(findAadhaarLike(text, { letters: "join" })).toEqual([]);
    }
  });
});
