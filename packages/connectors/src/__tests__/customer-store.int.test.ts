// PgCustomerAuthStore on PostgreSQL 18 with every platform migration applied (R1-D-19): the guard,
// challenges and devices are tenant-scoped under forced RLS, every mutation has a ledger entry,
// the guard schedule holds across store instances (replicas), a refresh hash rotates once, and a
// revoked device is refused by another replica within one cache refresh.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, randomBytes, sha256Hex, toBase64Url } from "@infrabyx/crypto";
import { startPostgres, withTenant, type TestDatabase } from "@infrabyx/testing";
import {
  customerIdentitySettings,
  PgCustomerAuthStore,
  type ChallengeRecord,
} from "../identity/customer.js";

let db: TestDatabase;
beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'LD', 'A'), ('tnt_b', 'LD', 'B')",
  );
});
afterAll(async () => db?.end());

const s = customerIdentitySettings();
const store = (now: () => number = Date.now) =>
  new PgCustomerAuthStore({
    kernel: db.kernel,
    audit: db.audit,
    context: (t) => withTenant(t),
    now,
  });
const JKT = "a".repeat(43);
const challenge = (over: Partial<ChallengeRecord> = {}): ChallengeRecord => ({
  id: toBase64Url(randomBytes(16)),
  tenantId: "tnt_a",
  userId: "kc-user-1",
  channel: "sms",
  jkt: JKT,
  idpRef: { challenge: "c".repeat(22), username: "cus0" },
  attempts: 0,
  expiresAt: Date.now() + 300_000,
  ...over,
});

describe("PgCustomerAuthStore (connectors/0004)", () => {
  it("the send guard holds across replicas: one code per interval, then the window", async () => {
    const t0 = Date.now();
    const a = store();
    const b = store();
    await a.reserveSend("tnt_a", "kc-guard-1", s, t0);
    await expect(b.reserveSend("tnt_a", "kc-guard-1", s, t0 + 1000)).rejects.toMatchObject({
      code: "IPB-SEC-019",
      meta: { reason: "resend_interval" },
    });
    // Another tenant is another account.
    await b.reserveSend("tnt_b", "kc-guard-1", s, t0 + 1000);
  });

  it("attempts count per code; failures lock the account; a success clears them", async () => {
    const st = store();
    const t0 = Date.now();
    const c = challenge({ userId: "kc-lock-1" });
    await st.saveChallenge(c);
    for (let f = 1; f <= 5; f++) {
      const got = await st.attempt("tnt_a", c.id, s, t0);
      expect(got.attempts).toBe(f);
      await st.settle("tnt_a", c.id, false, s, t0);
    }
    // The code is out of tries (and consumed); the account is backing off.
    await expect(st.attempt("tnt_a", c.id, s, t0)).rejects.toMatchObject({ code: "IPB-IDN-001" });
    const c2 = challenge({ userId: "kc-lock-1" });
    await st.saveChallenge(c2);
    await expect(st.attempt("tnt_a", c2.id, s, t0 + 1000)).rejects.toMatchObject({
      code: "IPB-SEC-019",
      meta: { reason: "backoff" },
    });
    await st.attempt("tnt_a", c2.id, s, t0 + 31_000);
    await st.settle("tnt_a", c2.id, true, s, t0 + 31_000);
    const g = await db.admin.query<{ failures: number }>(
      "select failures from connectors.customer_otp_guard where tenant_id = 'tnt_a' and failures = 0",
    );
    expect(g.rows.length).toBeGreaterThan(0);
    await expect(st.attempt("tnt_a", c2.id, s, t0 + 32_000)).rejects.toMatchObject({
      meta: { reason: "challenge" },
    });
    // Under RLS another tenant sees nothing.
    expect(await st.getChallenge("tnt_b", c2.id)).toBeUndefined();
  });

  it("devices: the refresh hash rotates once; a revoked device is refused by another replica within 15 s", async () => {
    let t = Date.now();
    const writer = store();
    const reader = store(() => t);
    const id = newId("dev");
    await writer.createDevice({
      id,
      tenantId: "tnt_a",
      userId: "kc-dev-1",
      jkt: JKT,
      idpSession: "sess-1",
      refreshHash: "1".repeat(64),
      label: "phone",
      createdAt: t,
      lastUsedAt: t,
    });
    expect((await writer.deviceByRefresh("tnt_a", "1".repeat(64)))?.id).toBe(id);
    expect(await writer.rotateRefresh("tnt_a", id, "1".repeat(64), "2".repeat(64), t)).toBe(true);
    expect(await writer.rotateRefresh("tnt_a", id, "1".repeat(64), "3".repeat(64), t)).toBe(false);
    expect((await reader.activeDevice("tnt_a", "kc-dev-1", JKT))?.id).toBe(id);
    await writer.revokeDevice("tnt_a", id, "sign_out", t);
    t += 14_000;
    expect((await reader.activeDevice("tnt_a", "kc-dev-1", JKT))?.id).toBe(id);
    t += 1_001;
    expect(await reader.activeDevice("tnt_a", "kc-dev-1", JKT)).toBeUndefined();
    expect(await writer.rotateRefresh("tnt_a", id, "2".repeat(64), "4".repeat(64), t)).toBe(false);
    expect((await writer.listDevices("tnt_a", "kc-dev-1"))[0]).toMatchObject({
      revokedReason: "sign_out",
    });
    expect(await writer.listDevices("tnt_b", "kc-dev-1")).toEqual([]);
  });

  it("every mutation is ledgered; only app_rw may delete, under the retention floors; RLS is forced", async () => {
    const actions = (
      await db.admin.query<{ action: string }>(
        "select distinct action from audit.ledger where action like 'identity.customer.%' order by action",
      )
    ).rows.map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "identity.customer.challenge.attempt",
        "identity.customer.challenge.create",
        "identity.customer.challenge.failed",
        "identity.customer.challenge.verified",
        "identity.customer.device.create",
        "identity.customer.device.refresh",
        "identity.customer.device.revoke",
        "identity.customer.otp.reserve",
      ]),
    );
    const grants = await db.admin.query<{ n: string }>(
      `select grantee || ':' || table_name as n from information_schema.role_table_grants
        where table_schema = 'connectors' and table_name like 'customer_%' and privilege_type = 'DELETE'
          and grantee in ('app_rw', 'app_ro') order by 1`,
    );
    expect(grants.rows.map((r) => r.n)).toEqual([
      "app_rw:customer_device",
      "app_rw:customer_otp_challenge",
      "app_rw:customer_otp_guard",
    ]);
    const floors = await db.admin.query<{ tablename: string; permissive: string; cmd: string }>(
      `select tablename, permissive, cmd from pg_policies
        where schemaname = 'connectors' and policyname like 'customer_%_delete_retention' order by 1`,
    );
    expect(floors.rows).toEqual(
      ["customer_device", "customer_otp_challenge", "customer_otp_guard"].map((tablename) => ({
        tablename,
        permissive: "RESTRICTIVE",
        cmd: "DELETE",
      })),
    );
    const rls = await db.admin.query<{ relname: string; relforcerowsecurity: boolean }>(
      "select relname, relforcerowsecurity from pg_class where relname like 'customer_%' and relkind = 'r' order by relname",
    );
    expect(rls.rows).toEqual([
      { relname: "customer_device", relforcerowsecurity: true },
      { relname: "customer_otp_challenge", relforcerowsecurity: true },
      { relname: "customer_otp_guard", relforcerowsecurity: true },
    ]);
  });
});

describe("retention of customer sign-in state (connectors/0005; owner answer #86, R1-D-23)", () => {
  const H = 3_600_000;
  const cutoffs = (now: number) => ({
    challengesExpiredBefore: now - 24 * H,
    devicesUnusedSince: now - 365 * 24 * H,
    guardsEndedBefore: now,
    sendWindowMs: 600_000,
    lockoutMs: 900_000,
  });
  const device = async (tenantId: string, userId: string, lastUsedAt: number) => {
    const id = newId("dev");
    await store().createDevice({
      id,
      tenantId,
      userId,
      jkt: JKT,
      idpSession: `sess-${id}`,
      refreshHash: sha256Hex(id),
      createdAt: lastUsedAt,
      lastUsedAt,
    });
    await db.admin.query(
      "update connectors.customer_device set last_used_at = $2, created_at = $2 where id = $1",
      [id, new Date(lastUsedAt).toISOString()],
    );
    return id;
  };
  const guard = (tenantId: string, hash: string, windowStart: number, lockedUntil?: number) =>
    db.admin.query(
      `insert into connectors.customer_otp_guard (tenant_id, account_hash, window_start, locked_until)
       values ($1, $2, $3, $4)`,
      [
        tenantId,
        hash,
        new Date(windowStart).toISOString(),
        lockedUntil ? new Date(lockedUntil).toISOString() : null,
      ],
    );
  const exists = async (table: string, col: string, v: string) =>
    (await db.admin.query(`select 1 from connectors.${table} where ${col} = $1`, [v])).rows
      .length === 1;

  it("the job deletes what is due in its tenant only, one ledger entry per row", async () => {
    const now = Date.now();
    const st = store();
    const old = challenge({ userId: "kc-ret-1", expiresAt: now - 25 * H });
    const recent = challenge({ userId: "kc-ret-1", expiresAt: now - 23 * H });
    const otherTenant = challenge({
      tenantId: "tnt_b",
      userId: "kc-ret-1",
      expiresAt: now - 25 * H,
    });
    for (const c of [old, recent, otherTenant]) await st.saveChallenge(c);
    const ended = "e".repeat(64);
    const locked = "f".repeat(64);
    await guard("tnt_a", ended, now - 2 * H);
    await guard("tnt_a", locked, now - 2 * H, now + H);
    const stale = await device("tnt_a", "kc-ret-2", now - 366 * 24 * H);
    const used = await device("tnt_a", "kc-ret-2", now - 300 * 24 * H);
    const got = await st.purge("tnt_a", cutoffs(now), 100);
    expect(got).toEqual({ challenges: 1, guards: 1, devices: 1 });
    expect(await exists("customer_otp_challenge", "id", old.id)).toBe(false);
    expect(await exists("customer_otp_challenge", "id", recent.id)).toBe(true);
    expect(await exists("customer_otp_challenge", "id", otherTenant.id)).toBe(true);
    expect(await exists("customer_otp_guard", "account_hash", ended)).toBe(false);
    expect(await exists("customer_otp_guard", "account_hash", locked)).toBe(true);
    expect(await exists("customer_device", "id", stale)).toBe(false);
    expect(await exists("customer_device", "id", used)).toBe(true);
    const ledger = await db.admin.query<{ resource_id: string; tenant_id: string }>(
      "select resource_id, tenant_id from audit.ledger where action = 'identity.customer.purge'",
    );
    expect(ledger.rows.map((r) => r.resource_id).sort()).toEqual([old.id, ended, stale].sort());
    expect(new Set(ledger.rows.map((r) => r.tenant_id))).toEqual(new Set(["tnt_a"]));
    // Nothing more is due: nothing deleted, nothing ledgered.
    expect(await st.purge("tnt_a", cutoffs(now), 100)).toEqual({
      challenges: 0,
      guards: 0,
      devices: 0,
    });
    expect(
      (await db.admin.query("select 1 from audit.ledger where action = 'identity.customer.purge'"))
        .rows.length,
    ).toBe(3);
  });

  it("PostgreSQL keeps the floors whatever the caller asks", async () => {
    // A tenant of its own, so rows the other tests made old enough do not count here.
    await db.admin.query(
      "insert into tenancy.tenant (id, product, name) values ('tnt_c', 'LD', 'C')",
    );
    const now = Date.now();
    const st = store();
    const c = challenge({ tenantId: "tnt_c", userId: "kc-floor-1", expiresAt: now - 10 * 60_000 });
    await st.saveChallenge(c);
    const hash = "d".repeat(64);
    await guard("tnt_c", hash, now - 2 * H, now + H);
    const live = await device("tnt_c", "kc-floor-2", now - 24 * H);
    // A caller that asks for everything gets only what the floors allow.
    const all = { ...cutoffs(now), challengesExpiredBefore: now, devicesUnusedSince: now };
    const got = await st.purge("tnt_c", { ...all, guardsEndedBefore: now + 2 * H }, 100);
    expect(got).toEqual({ challenges: 0, guards: 0, devices: 0 });
    expect(await exists("customer_otp_challenge", "id", c.id)).toBe(true);
    expect(await exists("customer_otp_guard", "account_hash", hash)).toBe(true);
    expect(await exists("customer_device", "id", live)).toBe(true);
    // An unrevoked device is not deleted by the unbind path either; a revoked one is, at once.
    expect(await st.deleteDevice("tnt_c", live, "unbound")).toBe(false);
    await st.revokeDevice("tnt_c", live, "sign_out", now);
    expect(await st.deleteDevice("tnt_c", live, "unbound")).toBe(true);
    expect(await exists("customer_device", "id", live)).toBe(false);
    expect(await st.listDevices("tnt_c", "kc-floor-2")).toEqual([]);
  });
});
