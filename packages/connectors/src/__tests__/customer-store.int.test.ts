// PgCustomerAuthStore on PostgreSQL 18 with every platform migration applied (R1-D-19): the guard,
// challenges and devices are tenant-scoped under forced RLS, every mutation has a ledger entry,
// the guard schedule holds across store instances (replicas), a refresh hash rotates once, and a
// revoked device is refused by another replica within one cache refresh.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, randomBytes, toBase64Url } from "@infrabyx/crypto";
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

  it("every mutation is ledgered; no table grants delete; RLS is forced", async () => {
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
      `select count(*)::text as n from information_schema.role_table_grants
        where table_schema = 'connectors' and table_name like 'customer_%' and privilege_type = 'DELETE'
          and grantee in ('app_rw', 'app_ro')`,
    );
    expect(grants.rows[0]!.n).toBe("0");
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
