// PgDigilockerPullStore on PostgreSQL 18 with every platform migration applied (Udofin PR-UDF-040,
// R1-D-193; threat model §3.136; connectors/0010): keyed pulls by hash under forced RLS, the
// ledger without the key, the session or a storage key, the conflict and session rules, expiry,
// the guard trigger, and the Digio adapter's retry served on another instance.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryReplayStore } from "@infrabyx/crypto";
import {
  DIGILOCKER_CONTRACT_RETURN_URL,
  MemoryStorage,
  startDigioKycStub,
  startPostgres,
  withTenant,
  type DigioKycStub,
  type TestDatabase,
} from "@infrabyx/testing";
import type { DigilockerDocument } from "@infrabyx/contracts/ports";
import { DigioKyc } from "../kyc/digio.js";
import { PgDigilockerPullStore, type DigilockerPullRequest } from "../kyc/digilocker-pulls.js";

let db: TestDatabase;
let dg: DigioKycStub;
beforeAll(async () => {
  db = await startPostgres();
  dg = await startDigioKycStub();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'LD', 'A'), ('tnt_b', 'LD', 'B')",
  );
});
afterAll(async () => {
  await dg?.close();
  await db?.end();
});

const store = (ttlHours?: number) =>
  new PgDigilockerPullStore({
    kernel: db.kernel,
    audit: db.audit,
    context: (t) => withTenant(t, ["ORG_ADMIN"], { principal: { id: "svc_kyc", type: "service" } }),
    ...(ttlHours !== undefined ? { ttlHours } : {}),
  });

const req = (over: Partial<DigilockerPullRequest> = {}): DigilockerPullRequest => ({
  tenantId: "tnt_a",
  adapter: "digio-kyc",
  idempotencyKey: "dl-key-1",
  consentSession: "KIDT000000001",
  docTypes: ["PANCR", "ADHAR"],
  ...over,
});

const doc = (t: "PANCR" | "ADHAR"): DigilockerDocument => ({
  docType: t,
  file: {
    storageKey: `tenant/tnt_a/kyc/01JA00000000000000000000${t === "PANCR" ? "01" : "02"}.pdf`,
    sha256: "a".repeat(64),
  },
  issuer: "digilocker",
  evidence: {
    vendorRef: "KIDT000000001",
    adapter: "digio-kyc",
    modelVersion: "kyc-v2",
    checkedAt: "2026-11-19T00:00:00.000Z",
  },
  signatureValid: null,
});

describe("connectors.kyc_digilocker_pull (PR-UDF-040, threat model §3.136)", () => {
  it("is tenant-scoped with RLS enabled and forced, and granted as its peers", async () => {
    const rls = await db.admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "select relrowsecurity, relforcerowsecurity from pg_class where oid = 'connectors.kyc_digilocker_pull'::regclass",
    );
    expect(rls.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    const grants = await db.admin.query<{ g: string }>(
      `select grantee || ':' || string_agg(privilege_type, ',' order by privilege_type) as g
         from information_schema.role_table_grants
        where table_schema = 'connectors' and table_name = 'kyc_digilocker_pull'
          and grantee in ('app_rw', 'app_ro') group by grantee order by grantee`,
    );
    expect(grants.rows.map((r) => r.g)).toEqual([
      "app_ro:SELECT",
      "app_rw:DELETE,INSERT,SELECT,UPDATE",
    ]);
    const classes = await db.admin.query<{ c: string | null }>(
      `select col_description('connectors.kyc_digilocker_pull'::regclass, attnum) as c
         from pg_attribute where attrelid = 'connectors.kyc_digilocker_pull'::regclass
          and attnum > 0 and not attisdropped`,
    );
    for (const r of classes.rows) expect(r.c).toMatch(/^dataclass:[A-Z]+$/);
  });

  it("reserves, completes and finds a keyed pull; keeps hashes and references only", async () => {
    const s = store();
    expect(await s.find(req())).toEqual({ kind: "none" });
    const r = await s.reserve(req());
    expect(r.kind).toBe("new");
    const id = (r as { id: string }).id;
    expect(await s.find(req())).toEqual({ kind: "pending", id });
    const docs = [doc("PANCR"), doc("ADHAR")];
    expect(await s.complete(req(), id, docs)).toEqual(docs);
    // The same request in another order is the same pull.
    expect(await s.find(req({ docTypes: ["ADHAR", "PANCR"] }))).toEqual({
      kind: "done",
      documents: docs,
    });
    const row = JSON.stringify(
      (await db.admin.query("select * from connectors.kyc_digilocker_pull")).rows,
    );
    expect(row).not.toContain("dl-key-1");
    const consentHash = (
      await db.admin.query<{ consent_hash: string }>(
        "select consent_hash from connectors.kyc_digilocker_pull",
      )
    ).rows[0]!.consent_hash;
    expect(consentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the ledger names the step and the record, never the key, the session or a storage key", async () => {
    const rows = (
      await db.admin.query<{ action: string; resource_id: string }>(
        "select * from audit.ledger where tenant_id = 'tnt_a' and action like 'connectors.kyc_digilocker.%' order by seq",
      )
    ).rows;
    expect(rows.map((r) => r.action)).toEqual([
      "connectors.kyc_digilocker.reserve",
      "connectors.kyc_digilocker.complete",
    ]);
    expect(rows.map((r) => r.resource_id)).toEqual([
      expect.stringMatching(/^kdl_/),
      expect.stringMatching(/^kdl_/),
    ]);
    const all = JSON.stringify(rows);
    expect(all).not.toContain("dl-key-1");
    expect(all).not.toContain("KIDT000000001");
    expect(all).not.toContain("tenant/tnt_a/kyc/");
  });

  it("the same key with another session or other types is IPB-PORT-004; another key on the session is refused", async () => {
    const s = store();
    await expect(s.find(req({ consentSession: "KIDT000000099" }))).rejects.toMatchObject({
      code: "IPB-PORT-004",
      meta: { reason: "idempotency_conflict" },
    });
    await expect(s.reserve(req({ docTypes: ["PANCR"] }))).rejects.toMatchObject({
      code: "IPB-PORT-004",
    });
    expect(await s.reserve(req({ idempotencyKey: "dl-key-2" }))).toEqual({
      kind: "session_taken",
    });
    const r = await s.reserve(req({ idempotencyKey: "dl-key-3", consentSession: "KIDT000000003" }));
    await s.refuse(
      req({ idempotencyKey: "dl-key-3", consentSession: "KIDT000000003" }),
      (r as { id: string }).id,
    );
    expect(
      await s.find(req({ idempotencyKey: "dl-key-3", consentSession: "KIDT000000003" })),
    ).toEqual({ kind: "refused" });
  });

  it("another tenant neither reads the record nor collides with its key or session", async () => {
    const s = store();
    expect(
      await db.kernel.read(withTenant("tnt_b"), (tx) =>
        tx.query("select * from connectors.kyc_digilocker_pull"),
      ),
    ).toMatchObject({ rowCount: 0 });
    expect(await s.find(req({ tenantId: "tnt_b" }))).toEqual({ kind: "none" });
    expect((await s.reserve(req({ tenantId: "tnt_b" }))).kind).toBe("new");
    // Writing tnt_a's row from tnt_b's context is refused by the policy.
    await expect(
      db.kernel.mutate(withTenant("tnt_b"), (tx) =>
        tx.query(
          `insert into connectors.kyc_digilocker_pull
             (id, tenant_id, adapter, key_hash, consent_hash, request_hash, state, expires_at)
           values ('kdl_01JA0000000000000000000009', 'tnt_a', 'digio-kyc', $1, $1, $1, 'pending', now())`,
          ["b".repeat(64)],
        ),
      ),
    ).rejects.toThrow();
  });

  it("a final record is not changed; an expired one is forgotten and purged", async () => {
    await expect(
      db.kernel.mutate(withTenant("tnt_a"), (tx) =>
        tx.query(
          "update connectors.kyc_digilocker_pull set state = 'pending', documents = null where state = 'done'",
        ),
      ),
    ).rejects.toThrow(/final/);
    const short = store(0);
    const r = req({ idempotencyKey: "dl-key-exp", consentSession: "KIDT000000077" });
    expect((await short.reserve(r)).kind).toBe("new");
    // Expired at once: the key is forgotten, and a new reserve replaces the record.
    expect(await short.find(r)).toEqual({ kind: "none" });
    expect((await short.reserve(r)).kind).toBe("new");
    expect(await short.purgeExpired("tnt_a")).toBe(1);
    expect(
      (
        await db.admin.query(
          "select count(*)::int as n from audit.ledger where action = 'connectors.kyc_digilocker.purge'",
        )
      ).rows[0],
    ).toEqual({ n: 1 });
  });

  it("the Digio adapter's keyed retry is served on another instance from the store", async () => {
    const s = store();
    const storage = new MemoryStorage();
    const consents = new MemoryReplayStore();
    const make = () =>
      new DigioKyc({
        storage,
        consents,
        pulls: s,
        enabled: () => true,
        clientId: () => dg.clientId,
        clientSecret: () => dg.clientSecret,
        currentTenant: () => "tnt_a",
        digilockerReturnHosts: [new URL(DIGILOCKER_CONTRACT_RETURN_URL).hostname],
        baseUrl: dg.url,
        allowLoopbackHttp: true,
      });
    const consentSession = dg.completedDigilocker(["PANCR", "ADHAR"]);
    const first = await make().digilockerPull(
      { consentSession, docTypes: ["PANCR", "ADHAR"] },
      { idempotencyKey: "dl-adapter-1" },
    );
    const before = dg.requests.length;
    const again = await make().digilockerPull(
      { consentSession, docTypes: ["PANCR", "ADHAR"] },
      { idempotencyKey: "dl-adapter-1" },
    );
    expect(again).toEqual(first);
    expect(dg.requests.length).toBe(before);
    await expect(
      make().digilockerPull(
        { consentSession, docTypes: ["PANCR"] },
        { idempotencyKey: "dl-adapter-2" },
      ),
    ).rejects.toMatchObject({ meta: { reason: "consent_used" } });
  });
});
