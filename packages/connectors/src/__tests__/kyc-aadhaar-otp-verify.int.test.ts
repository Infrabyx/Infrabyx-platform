// PgAadhaarOtpVerifyStore on PostgreSQL 18 with every platform migration applied (Udofin
// PR-UDF-041, R1-D-194; threat model §3.137; connectors/0011): keyed verifies by hash under forced
// RLS, the ledger and the table without the key, the transaction, the code or the number, the
// conflict rule, the first answer kept (a result or a refusal), expiry, the guard trigger, and the
// Digio adapter's retry served on another instance with the contract's sweep over the ledger.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryReplayStore } from "@infrabyx/crypto";
import {
  kycContractCases,
  KYC_FAKE_FIXTURES,
  MemoryStorage,
  startDigioKycStub,
  startPostgres,
  withTenant,
  type DigioKycStub,
  type KycFixtures,
  type TestDatabase,
} from "@infrabyx/testing";
import type { AadhaarOtpResult } from "@infrabyx/contracts/ports";
import { DigioKyc } from "../kyc/digio.js";
import {
  aadhaarOtpKeyHash,
  PgAadhaarOtpVerifyStore,
  type AadhaarOtpVerifyRequest,
} from "../kyc/aadhaar-otp.js";

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
  new PgAadhaarOtpVerifyStore({
    kernel: db.kernel,
    audit: db.audit,
    context: (t) => withTenant(t, ["ORG_ADMIN"], { principal: { id: "svc_kyc", type: "service" } }),
    ...(ttlHours !== undefined ? { ttlHours } : {}),
  });

const req = (over: Partial<AadhaarOtpVerifyRequest> = {}): AadhaarOtpVerifyRequest => ({
  tenantId: "tnt_a",
  adapter: "digio-kyc",
  idempotencyKey: "otp-key-1",
  txn: "AOTT00000001",
  otp: "482913",
  ...over,
});

const result = (): AadhaarOtpResult => ({
  vendorRef: "AOTT00000001",
  adapter: "digio-kyc",
  modelVersion: "aadhaar-otp-v2",
  checkedAt: "2026-11-19T00:00:00.000Z",
  ekyc: { storageKey: "tenant/tnt_a/kyc/01JA0000000000000000000001.xml", sha256: "a".repeat(64) },
  signatureValid: true,
  uidLast4: "0420",
});

const UID_LIKE = /(?<![0-9])(?:[0-9]{12}|[0-9]{16})(?![0-9])/;
const ledger = async (tenant = "tnt_a") =>
  (
    await db.admin.query(
      "select * from audit.ledger where tenant_id = $1 and action like 'connectors.kyc_aadhaar_otp.%' order by seq",
      [tenant],
    )
  ).rows;

describe("connectors.kyc_aadhaar_otp_verify (PR-UDF-041, threat model §3.137)", () => {
  it("is tenant-scoped with RLS enabled and forced, granted as its peers, every column classed", async () => {
    const rls = await db.admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "select relrowsecurity, relforcerowsecurity from pg_class where oid = 'connectors.kyc_aadhaar_otp_verify'::regclass",
    );
    expect(rls.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    const grants = await db.admin.query<{ g: string }>(
      `select grantee || ':' || string_agg(privilege_type, ',' order by privilege_type) as g
         from information_schema.role_table_grants
        where table_schema = 'connectors' and table_name = 'kyc_aadhaar_otp_verify'
          and grantee in ('app_rw', 'app_ro') group by grantee order by grantee`,
    );
    expect(grants.rows.map((r) => r.g)).toEqual([
      "app_ro:SELECT",
      "app_rw:DELETE,INSERT,SELECT,UPDATE",
    ]);
    const classes = await db.admin.query<{ c: string | null }>(
      `select col_description('connectors.kyc_aadhaar_otp_verify'::regclass, attnum) as c
         from pg_attribute where attrelid = 'connectors.kyc_aadhaar_otp_verify'::regclass
          and attnum > 0 and not attisdropped`,
    );
    expect(classes.rows.length).toBe(11);
    for (const r of classes.rows) expect(r.c).toMatch(/^dataclass:[A-Z]+$/);
  });

  it("reserves, completes and replays a keyed verify; keeps hashes and references only", async () => {
    const s = store();
    const r = await s.reserve(req());
    expect(r.kind).toBe("new");
    const id = (r as { id: string }).id;
    expect(await s.reserve(req())).toEqual({ kind: "pending", id });
    expect(await s.complete(req(), id, result())).toEqual(result());
    expect(await s.reserve(req())).toEqual({ kind: "done", result: result() });
    const rows = (await db.admin.query("select * from connectors.kyc_aadhaar_otp_verify")).rows;
    const text = JSON.stringify(rows);
    expect(text).not.toContain("otp-key-1");
    expect(text).not.toContain("482913");
    expect(rows[0]).toMatchObject({ key_hash: aadhaarOtpKeyHash("otp-key-1"), state: "done" });
    // The txn is in the stored result only as the vendor's reference; never as a match key.
    expect(Object.keys(rows[0] as object).sort()).toEqual(
      [
        "adapter",
        "created_at",
        "expires_at",
        "id",
        "key_hash",
        "reason",
        "request_hash",
        "result",
        "state",
        "tenant_id",
        "updated_at",
      ].sort(),
    );
  });

  it("the same key with another code or transaction is IPB-PORT-004; a refusal is kept as the first answer", async () => {
    const s = store();
    for (const over of [{ otp: "000111" }, { txn: "AOTT00000002" }])
      await expect(s.reserve(req(over))).rejects.toMatchObject({
        code: "IPB-PORT-004",
        meta: { reason: "idempotency_conflict" },
      });
    const k = req({ idempotencyKey: "otp-key-2", txn: "AOTT00000003", otp: "000111" });
    const r = await s.reserve(k);
    expect(await s.refuse(k, (r as { id: string }).id, "otp_invalid")).toEqual({
      kind: "refused",
      reason: "otp_invalid",
    });
    expect(await s.reserve(k)).toEqual({ kind: "refused", reason: "otp_invalid" });
    // A later finisher does not overwrite the first answer.
    await expect(s.complete(k, (r as { id: string }).id, result())).rejects.toMatchObject({
      meta: { reason: "otp_invalid" },
    });
  });

  it("the ledger names the step, the record and the key's hash; never the key, the transaction, the code or a storage key", async () => {
    const rows = await ledger();
    expect(rows.map((r) => (r as { action: string }).action)).toEqual([
      "connectors.kyc_aadhaar_otp.reserve",
      "connectors.kyc_aadhaar_otp.found",
      "connectors.kyc_aadhaar_otp.complete",
      "connectors.kyc_aadhaar_otp.replay",
      "connectors.kyc_aadhaar_otp.reserve",
      "connectors.kyc_aadhaar_otp.refuse",
      "connectors.kyc_aadhaar_otp.replay",
      "connectors.kyc_aadhaar_otp.replay",
    ]);
    const all = JSON.stringify(rows);
    for (const s of ["otp-key-1", "otp-key-2", "AOTT0000000", "482913", "000111", "tenant/tnt_a/"])
      expect(all).not.toContain(s);
    expect(all.replace(/[0-9a-f]{64}/g, "")).not.toMatch(UID_LIKE);
  });

  it("another tenant neither reads the record nor collides with its key", async () => {
    const s = store();
    expect(
      await db.kernel.read(withTenant("tnt_b"), (tx) =>
        tx.query("select * from connectors.kyc_aadhaar_otp_verify"),
      ),
    ).toMatchObject({ rowCount: 0 });
    expect((await s.reserve(req({ tenantId: "tnt_b" }))).kind).toBe("new");
    await expect(
      db.kernel.mutate(withTenant("tnt_b"), (tx) =>
        tx.query(
          `insert into connectors.kyc_aadhaar_otp_verify
             (id, tenant_id, adapter, key_hash, request_hash, state, expires_at)
           values ('kao_01JA0000000000000000000009', 'tnt_a', 'digio-kyc', $1, $1, 'pending', now())`,
          ["b".repeat(64)],
        ),
      ),
    ).rejects.toThrow();
  });

  it("a final record is not changed; an expired one is forgotten and purged", async () => {
    await expect(
      db.kernel.mutate(withTenant("tnt_a"), (tx) =>
        tx.query(
          "update connectors.kyc_aadhaar_otp_verify set state = 'pending', result = null where state = 'done'",
        ),
      ),
    ).rejects.toThrow(/final/);
    await expect(
      db.kernel.mutate(withTenant("tnt_a"), (tx) =>
        tx.query("update connectors.kyc_aadhaar_otp_verify set key_hash = $1", ["c".repeat(64)]),
      ),
    ).rejects.toThrow();
    const short = store(0);
    const r = req({ idempotencyKey: "otp-key-exp", txn: "AOTT00000077" });
    expect((await short.reserve(r)).kind).toBe("new");
    expect((await short.reserve(r)).kind).toBe("new");
    expect(await short.purgeExpired("tnt_a")).toBe(1);
  });

  it("the Digio adapter's keyed retry is served on another instance; the contract sweep finds no number in answers or the ledger", async () => {
    const s = store();
    const storage = new MemoryStorage();
    const make = (notifiedEntity = true) =>
      new DigioKyc({
        storage,
        consents: new MemoryReplayStore(),
        aadhaarOtpVerifies: s,
        notifiedEntity,
        enabled: () => true,
        clientId: () => dg.clientId,
        clientSecret: () => dg.clientSecret,
        currentTenant: () => "tnt_b",
        baseUrl: dg.url,
        allowLoopbackHttp: true,
      });
    const consent = { version: "1.0", textHash: "ab".repeat(32), at: new Date().toISOString() };
    const t = await make().aadhaarOtpRequest({
      uid: dg.aadhaarOtp.uid,
      uidKind: "AADHAAR",
      consent,
    });
    const first = await make().aadhaarOtpVerify(
      { txn: t.txn, otp: dg.aadhaarOtp.otp },
      { idempotencyKey: "otp-adapter-1" },
    );
    const before = dg.requests.length;
    expect(
      await make().aadhaarOtpVerify(
        { txn: t.txn, otp: dg.aadhaarOtp.otp },
        { idempotencyKey: "otp-adapter-1" },
      ),
    ).toEqual(first);
    expect(dg.requests.length).toBe(before);
    // The contract's sweep, with the ledger this store wrote.
    const fx: KycFixtures = {
      ...KYC_FAKE_FIXTURES,
      aadhaarOtp: {
        ...dg.aadhaarOtp,
        notNotified: () => ({ port: make(false), vendorCalls: () => dg.requests.length }),
        vendorCalls: () => dg.requests.length,
        ledger: () => ledger("tnt_b"),
      },
    };
    const sweep = kycContractCases(fx).find((c) => c.name.includes("no field of any answer"));
    expect(sweep).toBeDefined();
    await sweep!.run(make());
    const rows = JSON.stringify(
      (await db.admin.query("select * from connectors.kyc_aadhaar_otp_verify")).rows,
    );
    // The transaction may be the vendor's reference in a stored result; never the number or code.
    for (const n of [
      dg.aadhaarOtp.uid,
      dg.aadhaarOtp.vid,
      dg.aadhaarOtp.unlinkedUid,
      `"${dg.aadhaarOtp.otp}"`,
    ])
      expect(rows).not.toContain(n);
    expect(rows.replace(/[0-9a-f]{64}/g, "")).not.toMatch(UID_LIKE);
    expect((await ledger("tnt_b")).length).toBeGreaterThan(2);
  });
});
