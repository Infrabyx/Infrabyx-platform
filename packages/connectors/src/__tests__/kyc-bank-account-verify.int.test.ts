// PgBankAccountVerifyStore on PostgreSQL 18 with every platform migration applied (Udofin
// PR-UDF-043, R1-D-196; threat model §3.139; connectors/0012): keyed checks by hash under forced
// RLS, the ledger and the table without the key, the account number, the IFSC or the name asked
// (and no unkeyed hash of the account), the conflict rule, the first answer kept, expiry, the guard
// trigger, and the Digio adapter's retry served on another instance with exactly one vendor check,
// with the contract's sweep over the answers.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryReplayStore, sha256Hex } from "@infrabyx/crypto";
import { findAadhaarLike } from "@infrabyx/contracts/aadhaar";
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
import type { BankAccountResult } from "@infrabyx/contracts/ports";
import { DigioKyc } from "../kyc/digio.js";
import {
  bankAccountKeyHash,
  PgBankAccountVerifyStore,
  type BankAccountVerifyRequest,
} from "../kyc/bank-account.js";

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
  new PgBankAccountVerifyStore({
    kernel: db.kernel,
    audit: db.audit,
    context: (t) => withTenant(t, ["ORG_ADMIN"], { principal: { id: "svc_kyc", type: "service" } }),
    ...(ttlHours !== undefined ? { ttlHours } : {}),
  });

const ACCOUNT = "00777666555";
const req = (over: Partial<BankAccountVerifyRequest> = {}): BankAccountVerifyRequest => ({
  tenantId: "tnt_a",
  adapter: "digio-kyc",
  idempotencyKey: "bank-key-1",
  ifsc: "SBIN0000691",
  accountNumber: ACCOUNT,
  name: "Asha Rao",
  mode: "pennyless",
  ...over,
});

const result = (): BankAccountResult => ({
  vendorRef: "BAV0000000001",
  adapter: "digio-kyc",
  modelVersion: "bank-account-pennyless-v1",
  checkedAt: "2026-11-19T00:00:00.000Z",
  status: "valid",
  mode: "pennyless",
  nameAtBank: "ASHA RAO",
  nameMatch: "match",
});

const ledger = async (tenant = "tnt_a") =>
  (
    await db.admin.query(
      "select * from audit.ledger where tenant_id = $1 and action like 'connectors.kyc_bank_account.%' order by seq",
      [tenant],
    )
  ).rows;

describe("connectors.kyc_bank_account_verify (PR-UDF-043, threat model §3.139)", () => {
  it("is tenant-scoped with RLS enabled and forced, granted as its peers, every column classed", async () => {
    const rls = await db.admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "select relrowsecurity, relforcerowsecurity from pg_class where oid = 'connectors.kyc_bank_account_verify'::regclass",
    );
    expect(rls.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    const grants = await db.admin.query<{ g: string }>(
      `select grantee || ':' || string_agg(privilege_type, ',' order by privilege_type) as g
         from information_schema.role_table_grants
        where table_schema = 'connectors' and table_name = 'kyc_bank_account_verify'
          and grantee in ('app_rw', 'app_ro') group by grantee order by grantee`,
    );
    expect(grants.rows.map((r) => r.g)).toEqual([
      "app_ro:SELECT",
      "app_rw:DELETE,INSERT,SELECT,UPDATE",
    ]);
    const classes = await db.admin.query<{ n: string; c: string | null }>(
      `select attname as n, col_description('connectors.kyc_bank_account_verify'::regclass, attnum) as c
         from pg_attribute where attrelid = 'connectors.kyc_bank_account_verify'::regclass
          and attnum > 0 and not attisdropped`,
    );
    expect(classes.rows.length).toBe(11);
    for (const r of classes.rows) expect(r.c).toMatch(/^dataclass:[A-Z]+$/);
    expect(classes.rows.find((r) => r.n === "result")?.c).toBe("dataclass:REGULATED");
  });

  it("reserves, completes and replays a keyed check; keeps hashes only, and no unkeyed hash of the account", async () => {
    const s = store();
    const r = await s.reserve(req());
    expect(r.kind).toBe("new");
    const id = (r as { id: string }).id;
    expect(await s.reserve(req())).toEqual({ kind: "pending", id });
    expect(await s.complete(req(), id, result())).toEqual(result());
    expect(await s.reserve(req())).toEqual({ kind: "done", result: result() });
    const rows = (await db.admin.query("select * from connectors.kyc_bank_account_verify")).rows;
    const text = JSON.stringify(rows);
    for (const v of ["bank-key-1", ACCOUNT, "SBIN0000691", "Asha Rao"])
      expect(text).not.toContain(v);
    // No plain digest of the account, alone or with the IFSC, is anywhere in the row.
    for (const d of [ACCOUNT, `SBIN0000691${ACCOUNT}`, `SBIN0000691:${ACCOUNT}`])
      expect(text).not.toContain(sha256Hex(d));
    expect(rows[0]).toMatchObject({
      key_hash: bankAccountKeyHash("bank-key-1"),
      mode: "pennyless",
      state: "done",
    });
    expect(Object.keys(rows[0] as object).sort()).toEqual(
      [
        "adapter",
        "created_at",
        "expires_at",
        "id",
        "key_hash",
        "mode",
        "request_hash",
        "result",
        "state",
        "tenant_id",
        "updated_at",
      ].sort(),
    );
  });

  it("the same key with another account, IFSC, name or mode is IPB-PORT-004; a later finisher does not overwrite the first answer", async () => {
    const s = store();
    for (const over of [
      { accountNumber: "00777666554" },
      { ifsc: "SBIN0000692" },
      { name: "Asha R" },
      { mode: "penny_drop" as const },
    ])
      await expect(s.reserve(req(over))).rejects.toMatchObject({
        code: "IPB-PORT-004",
        meta: { reason: "idempotency_conflict" },
      });
    const k = req({ idempotencyKey: "bank-key-2" });
    const r = await s.reserve(k);
    const id = (r as { id: string }).id;
    expect(await s.complete(k, id, result())).toEqual(result());
    expect(await s.complete(k, id, { ...result(), status: "closed" })).toEqual(result());
  });

  it("the ledger names the step and the record (its entry digests the key's hash and the mode); never the key, the account, the IFSC or the name", async () => {
    const rows = await ledger();
    expect(rows.map((r) => (r as { action: string }).action)).toEqual([
      "connectors.kyc_bank_account.reserve",
      "connectors.kyc_bank_account.found",
      "connectors.kyc_bank_account.complete",
      "connectors.kyc_bank_account.replay",
      "connectors.kyc_bank_account.reserve",
      "connectors.kyc_bank_account.complete",
      "connectors.kyc_bank_account.replay",
    ]);
    const all = JSON.stringify(rows);
    for (const v of ["bank-key-1", "bank-key-2", ACCOUNT, "SBIN0000691", "Asha Rao", "ASHA RAO"])
      expect(all).not.toContain(v);
    expect(findAadhaarLike(all)).toEqual([]);
  });

  it("another tenant neither reads the record nor collides with its key", async () => {
    const s = store();
    expect(
      await db.kernel.read(withTenant("tnt_b"), (tx) =>
        tx.query("select * from connectors.kyc_bank_account_verify"),
      ),
    ).toMatchObject({ rowCount: 0 });
    expect((await s.reserve(req({ tenantId: "tnt_b" }))).kind).toBe("new");
    await expect(
      db.kernel.mutate(withTenant("tnt_b"), (tx) =>
        tx.query(
          `insert into connectors.kyc_bank_account_verify
             (id, tenant_id, adapter, key_hash, request_hash, mode, state, expires_at)
           values ('kba_01JA0000000000000000000009', 'tnt_a', 'digio-kyc', $1, $1, 'pennyless', 'pending', now())`,
          ["b".repeat(64)],
        ),
      ),
    ).rejects.toThrow();
  });

  it("a final record is not changed, a record keeps its mode; an expired one is forgotten and purged", async () => {
    await expect(
      db.kernel.mutate(withTenant("tnt_a"), (tx) =>
        tx.query(
          "update connectors.kyc_bank_account_verify set state = 'pending', result = null where state = 'done'",
        ),
      ),
    ).rejects.toThrow(/final/);
    await expect(
      db.kernel.mutate(withTenant("tnt_b"), (tx) =>
        tx.query("update connectors.kyc_bank_account_verify set mode = 'penny_drop'"),
      ),
    ).rejects.toThrow(/keeps its key/);
    const short = store(0);
    const r = req({ idempotencyKey: "bank-key-exp" });
    expect((await short.reserve(r)).kind).toBe("new");
    expect((await short.reserve(r)).kind).toBe("new");
    expect(await short.purgeExpired("tnt_a")).toBe(1);
  });

  it("the Digio adapter's keyed retry is served on another instance with one vendor check; the contract sweep finds nothing", async () => {
    const s = store();
    const make = () =>
      new DigioKyc({
        storage: new MemoryStorage(),
        consents: new MemoryReplayStore(),
        bankAccountVerifies: s,
        enabled: () => true,
        clientId: () => dg.clientId,
        clientSecret: () => dg.clientSecret,
        currentTenant: () => "tnt_b",
        baseUrl: dg.url,
        allowLoopbackHttp: true,
      });
    const check = {
      ifsc: dg.bankAccount.ifsc,
      accountNumber: dg.bankAccount.accountNumber,
      name: dg.bankAccount.name,
    };
    const checks = dg.bankAccountChecks();
    const first = await make().bankAccountVerify(check, { idempotencyKey: "bank-adapter-1" });
    expect(await make().bankAccountVerify(check, { idempotencyKey: "bank-adapter-1" })).toEqual(
      first,
    );
    expect(dg.bankAccountChecks()).toBe(checks + 1);
    const fx: KycFixtures = {
      ...KYC_FAKE_FIXTURES,
      bank: check,
      bankAccount: {
        configuredMode: "pennyless",
        modes: ["pennyless"],
        unknownAccountNumber: dg.bankAccount.unknownAccountNumber,
        refusing: () => ({ port: make(), mode: "penny_drop", vendorCalls: dg.bankAccountChecks }),
        vendorCalls: () => dg.bankAccountChecks(),
      },
    };
    for (const c of kycContractCases(fx).filter((x) =>
      x.name.startsWith("bankAccountVerify (PR-UDF-043)"),
    ))
      await c.run(make());
    const rows = JSON.stringify(
      (await db.admin.query("select * from connectors.kyc_bank_account_verify")).rows,
    );
    for (const v of [
      dg.bankAccount.accountNumber,
      dg.bankAccount.unknownAccountNumber,
      dg.bankAccount.ifsc,
    ])
      expect(rows).not.toContain(v);
    expect(findAadhaarLike(rows)).toEqual([]);
    expect((await ledger("tnt_b")).length).toBeGreaterThan(2);
  });
});
