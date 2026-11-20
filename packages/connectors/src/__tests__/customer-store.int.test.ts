// PgCustomerAuthStore on PostgreSQL 18 with every platform migration applied (R1-D-19): the guard,
// challenges and devices are tenant-scoped under forced RLS, every mutation has a ledger entry,
// the guard schedule holds across store instances (replicas), a refresh hash rotates once, and a
// revoked device is refused by another replica within one cache refresh. The verified email
// (connectors/0015) is deleted only at account closure or on erasure (connectors/0016; R1-D-235).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdapterDescriptor, DpopTarget, PortHealth } from "@infrabyx/contracts";
import {
  canonicalDigest,
  MemoryReplayStore,
  newId,
  randomBytes,
  sha256Hex,
  toBase64Url,
} from "@infrabyx/crypto";
import { startPostgres, withTenant, type TestDatabase } from "@infrabyx/testing";
import { MemoryRevocationStore, type TokenVerifier } from "../identity/common.js";
import {
  CUSTOMER_STEP_UP_ACTION,
  CustomerIdentityBase,
  customerIdentitySettings,
  PgCustomerAuthStore,
  type ChallengeRecord,
} from "../identity/customer.js";
import { capturingSender } from "../identity/__tests__/dpop-device.js";

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
      "app_rw:customer_verified_email",
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
      { relname: "customer_verified_email", relforcerowsecurity: true },
    ]);
  });
});

describe("the verified email of a customer account (connectors/0015; PR-UDF-055, R1-D-224)", () => {
  it("records, replaces and reads the address under RLS, ledgered without it; delete only from 0016", async () => {
    const st = store();
    const t0 = Date.parse("2026-11-20T06:00:00Z");
    expect(await st.verifiedEmail("tnt_a", "kc-mail-1")).toBeUndefined();
    await st.saveVerifiedEmail("tnt_a", "kc-mail-1", "asha.rao@mail.example", t0);
    expect(await st.verifiedEmail("tnt_a", "kc-mail-1")).toEqual({
      email: "asha.rao@mail.example",
      verifiedAt: t0,
    });
    await st.saveVerifiedEmail("tnt_a", "kc-mail-1", "asha@new.example", t0 + 1000);
    expect(await st.verifiedEmail("tnt_a", "kc-mail-1")).toEqual({
      email: "asha@new.example",
      verifiedAt: t0 + 1000,
    });
    // Another tenant sees nothing, even for the same account id.
    expect(await st.verifiedEmail("tnt_b", "kc-mail-1")).toBeUndefined();
    const rows = (
      await db.admin.query(
        "select * from audit.ledger where action = 'identity.customer.email.verify' and resource_id = $1",
        [sha256Hex("customer:kc-mail-1")],
      )
    ).rows;
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain("example");
    const grants = await db.admin.query<{ p: string }>(
      `select grantee || ':' || privilege_type as p from information_schema.role_table_grants
        where table_schema = 'connectors' and table_name = 'customer_verified_email'
          and grantee in ('app_rw', 'app_ro') order by 1`,
    );
    expect(grants.rows.map((r) => r.p)).toEqual([
      "app_ro:SELECT",
      "app_rw:DELETE",
      "app_rw:INSERT",
      "app_rw:SELECT",
      "app_rw:UPDATE",
    ]);
    const classes = await db.admin.query<{ column_name: string; c: string }>(
      `select a.attname as column_name, col_description(a.attrelid, a.attnum) as c
         from pg_attribute a where a.attrelid = 'connectors.customer_verified_email'::regclass
          and a.attnum > 0 and not a.attisdropped order by a.attnum`,
    );
    expect(Object.fromEntries(classes.rows.map((r) => [r.column_name, r.c]))).toMatchObject({
      user_id: "dataclass:CONFIDENTIAL",
      email: "dataclass:CONFIDENTIAL",
    });
    // A malformed or upper-case address cannot be stored.
    await expect(
      st.saveVerifiedEmail("tnt_a", "kc-mail-2", "Not-Lower@Example.test", t0),
    ).rejects.toThrow();
  });
});

/** Only what retireLogin needs of an IdP: the login's owner, and retiring it. */
class StoreOnlyIdp extends CustomerIdentityBase {
  readonly descriptor: AdapterDescriptor = {
    port: "IDENTITY",
    adapter: "store-only",
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
  };
  readonly signInProofTarget: DpopTarget = { htm: "POST", htu: "https://id.example.test/token" };
  protected readonly nativeBinding = false;
  protected readonly verifier = {} as TokenVerifier;
  readonly owners = new Map<string, string>();
  readonly retired: string[] = [];
  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: new Date().toISOString() };
  }
  protected async resolveUser(): Promise<string> {
    throw new Error("not used");
  }
  protected async idpSend(): Promise<{ ref: Record<string, string>; code: string }> {
    throw new Error("not used");
  }
  protected async idpVerify(): Promise<null> {
    return null;
  }
  protected async idpRefresh(): Promise<null> {
    return null;
  }
  protected async idpEndSession(): Promise<void> {}
  protected override async idpFindUser(tenantId: string, _c: string, login: string) {
    return this.owners.get(`${tenantId}|${login}`);
  }
  protected override async idpRetireLogin(a: { tenantId: string; login: string }) {
    this.owners.delete(`${a.tenantId}|${a.login}`);
    this.retired.push(a.login);
  }
}

describe("deleting the verified email (connectors/0016; owner answer #161 (3), R1-D-233, R1-D-235)", () => {
  const t0 = Date.parse("2026-11-20T13:00:00Z");
  const idp = () =>
    new StoreOnlyIdp({
      store: store(),
      sender: capturingSender().sender,
      replay: new MemoryReplayStore(),
      revocations: new MemoryRevocationStore(),
      emailCapture: true,
    });
  /** The ledger keeps digests of `before` and `after` (audit/0001), so the entries are compared by them. */
  const ledger = async (action: string, userId: string) =>
    (
      await db.admin.query<{
        tenant_id: string;
        resource_type: string;
        before_digest: string | null;
        after_digest: string | null;
      }>(
        `select tenant_id, resource_type, before_digest, after_digest from audit.ledger
          where action = $1 and resource_id = $2 order by occurred_at, seq`,
        [action, sha256Hex(`customer:${userId}`)],
      )
    ).rows;
  const deletions = (userId: string) => ledger("identity.customer.verified_email.delete", userId);
  const at = (t: number) => new Date(t).toISOString();
  const row = async (tenantId: string, userId: string) =>
    (
      await db.admin.query(
        "select 1 from connectors.customer_verified_email where tenant_id = $1 and user_id = $2",
        [tenantId, userId],
      )
    ).rows.length;

  it("retireLogin deletes the account's row and its devices, ledgered as account_closed without the address", async () => {
    const st = store();
    const p = idp();
    const userId = "kc-close-1";
    await st.saveVerifiedEmail("tnt_a", userId, "close.one@mail.example", t0);
    await st.saveVerifiedEmail("tnt_b", userId, "close.other@mail.example", t0);
    await st.createDevice({
      id: newId("dev"),
      tenantId: "tnt_a",
      userId,
      jkt: JKT,
      idpSession: "sess-close-1",
      refreshHash: sha256Hex("close-1"),
      createdAt: t0,
      lastUsedAt: t0,
    });
    p.owners.set("tnt_a|+919800000301", userId);
    await p.retireLogin({ tenantId: "tnt_a", userId, channel: "sms", login: "+919800000301" });
    expect(p.retired).toEqual(["+919800000301"]);
    expect(await row("tnt_a", userId)).toBe(0);
    expect(await p.verifiedEmail("tnt_a", userId)).toBeNull();
    expect(await st.listDevices("tnt_a", userId)).toEqual([]);
    // Another tenant's row of the same account id is untouched (RLS).
    expect(await row("tnt_b", userId)).toBe(1);
    // One entry, in the account's tenant, by the account's hash; neither side names the address.
    expect(await deletions(userId)).toEqual([
      {
        tenant_id: "tnt_a",
        resource_type: "identity.customer_account",
        before_digest: canonicalDigest({ verified_at: at(t0) }),
        after_digest: canonicalDigest({ reason: "account_closed", found: true }),
      },
    ]);
    const raw = await db.admin.query("select * from audit.ledger where resource_id = $1", [
      sha256Hex(`customer:${userId}`),
    ]);
    expect(JSON.stringify(raw.rows)).not.toContain("example");
    // The account's retirement is on the record too.
    expect(await ledger("identity.customer.login.retire", userId)).toHaveLength(1);
  });

  it("erasure deletes the row, ledgered as erasure_request with the reference; a second erasure deletes nothing; a new proof works", async () => {
    const st = store();
    const p = idp();
    const userId = "kc-erase-1";
    await st.saveVerifiedEmail("tnt_a", userId, "erase.one@mail.example", t0);
    await st.saveVerifiedEmail("tnt_b", userId, "erase.other@mail.example", t0);
    expect(
      await p.eraseVerifiedEmail({ tenantId: "tnt_a", userId, requestRef: "dsr:2026-11-20:1" }),
    ).toEqual({ erased: true });
    expect(await row("tnt_a", userId)).toBe(0);
    expect(await row("tnt_b", userId)).toBe(1);
    // Idempotent: nothing to delete, no failure, a found:false entry for the request.
    expect(
      await p.eraseVerifiedEmail({ tenantId: "tnt_a", userId, requestRef: "dsr:2026-11-20:1" }),
    ).toEqual({ erased: false });
    const ref = "dsr:2026-11-20:1";
    expect(await deletions(userId)).toEqual([
      {
        tenant_id: "tnt_a",
        resource_type: "identity.customer_account",
        before_digest: canonicalDigest({ verified_at: at(t0) }),
        after_digest: canonicalDigest({ reason: "erasure_request", found: true, request_ref: ref }),
      },
      {
        tenant_id: "tnt_a",
        resource_type: "identity.customer_account",
        before_digest: null,
        after_digest: canonicalDigest({
          reason: "erasure_request",
          found: false,
          request_ref: ref,
        }),
      },
    ]);
    // A replacement proof after the deletion is recorded as before (a fresh row, not a replace).
    await st.saveVerifiedEmail("tnt_a", userId, "erase.new@mail.example", t0 + 1000);
    expect(await st.verifiedEmail("tnt_a", userId)).toEqual({
      email: "erase.new@mail.example",
      verifiedAt: t0 + 1000,
    });
    const verify = (await ledger("identity.customer.email.verify", userId)).filter(
      (r) => r.tenant_id === "tnt_a",
    );
    expect(verify.map((r) => r.after_digest)).toEqual([
      canonicalDigest({ verified_at: at(t0), replaced: false }),
      canonicalDigest({ verified_at: at(t0 + 1000), replaced: false }),
    ]);
    const raw = await db.admin.query("select * from audit.ledger where resource_id = $1", [
      sha256Hex(`customer:${userId}`),
    ]);
    expect(JSON.stringify(raw.rows)).not.toContain("example");
  });

  it("only the deletion's kernel action deletes; app_rw gains delete on this table only", async () => {
    const st = store();
    await st.saveVerifiedEmail("tnt_a", "kc-guard-del", "guard@mail.example", t0);
    // Any other kernel action is refused by 0016's trigger, whatever it says it is doing.
    await expect(
      db.kernel.mutate(
        withTenant("tnt_a"),
        (tx) =>
          tx.query("delete from connectors.customer_verified_email where user_id = 'kc-guard-del'"),
        { action: "identity.customer.purge" },
      ),
    ).rejects.toThrow(/deleted only at account closure or on erasure/);
    expect(await row("tnt_a", "kc-guard-del")).toBe(1);
    // Under the deletion's action, another tenant's row is out of reach (forced RLS).
    const other = await db.kernel.mutate(
      withTenant("tnt_b"),
      async (tx) => {
        const r = await tx.query(
          "delete from connectors.customer_verified_email where user_id = 'kc-guard-del'",
        );
        await db.audit.record(tx as never, {
          action: "identity.customer.verified_email.delete",
          resourceType: "identity.customer_account",
          resourceId: sha256Hex("customer:kc-guard-del"),
          after: { reason: "erasure_request", found: false },
        });
        return r.rowCount;
      },
      { action: "identity.customer.verified_email.delete" },
    );
    expect(other).toBe(0);
    expect(await row("tnt_a", "kc-guard-del")).toBe(1);
    // A connectors table without a delete grant still refuses app_rw (the grant is scoped).
    await expect(
      db.kernel.mutate(
        withTenant("tnt_a"),
        (tx) => tx.query("delete from connectors.web_snapshot"),
        { action: "identity.customer.verified_email.delete" },
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.kernel.mutate(
        withTenant("tnt_a"),
        (tx) => tx.query("delete from connectors.tally_journal"),
        { action: "identity.customer.verified_email.delete" },
      ),
    ).rejects.toThrow(/permission denied/);
    // The whole set of connectors tables app_rw may delete from: 0016 adds one, nothing else.
    const del = await db.admin.query<{ t: string }>(
      `select table_name as t from information_schema.role_table_grants
        where table_schema = 'connectors' and grantee = 'app_rw' and privilege_type = 'DELETE'
        order by 1`,
    );
    expect(del.rows.map((r) => r.t)).toEqual([
      "customer_device",
      "customer_otp_challenge",
      "customer_otp_guard",
      "customer_verified_email",
      "idempotency_record",
      "kyc_aadhaar_otp_verify",
      "kyc_bank_account_verify",
      "kyc_digilocker_pull",
      "kyc_score_check",
      "session_revocation",
      "statement_analysis",
    ]);
    // No other role but the table's owner may delete from it (app_ro, app_external, svc_* cannot).
    const others = await db.admin.query(
      `select grantee from information_schema.role_table_grants
        where table_schema = 'connectors' and table_name = 'customer_verified_email'
          and privilege_type = 'DELETE' and grantee <> 'app_rw'
          and grantee <> (select pg_get_userbyid(relowner) from pg_class
                           where oid = 'connectors.customer_verified_email'::regclass)`,
    );
    expect(others.rows).toEqual([]);
    // RLS stays enabled and forced.
    const rls = await db.admin.query(
      `select relrowsecurity, relforcerowsecurity from pg_class
        where oid = 'connectors.customer_verified_email'::regclass`,
    );
    expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
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

describe("the step-up of a device session (connectors/0017; PR-UDF-056, R1-D-244)", () => {
  const t0 = Date.parse("2026-11-20T15:00:00Z");
  const at = (t: number) => new Date(t).toISOString();
  const newDevice = async (st: PgCustomerAuthStore, userId: string, jkt = JKT) => {
    const id = newId("dev");
    await st.createDevice({
      id,
      tenantId: "tnt_a",
      userId,
      jkt,
      idpSession: `sess-${id}`,
      refreshHash: sha256Hex(id),
      createdAt: t0,
      lastUsedAt: t0,
    });
    return id;
  };
  const stepUps = async (deviceId: string) =>
    (
      await db.admin.query<{ tenant_id: string; resource_type: string; after_digest: string }>(
        `select tenant_id, resource_type, after_digest from audit.ledger
          where action = $1 and resource_id = $2 order by occurred_at, seq`,
        [CUSTOMER_STEP_UP_ACTION, deviceId],
      )
    ).rows;

  it("adds two nullable INTERNAL columns and refuses an unknown level", async () => {
    const cols = await db.admin.query<{ n: string; c: string; nn: boolean }>(
      `select a.attname as n, col_description(a.attrelid, a.attnum) as c, a.attnotnull as nn
         from pg_attribute a where a.attrelid = 'connectors.customer_device'::regclass
          and a.attname in ('step_up_at', 'step_up_acr') order by a.attname`,
    );
    expect(cols.rows).toEqual([
      { n: "step_up_acr", c: "dataclass:INTERNAL", nn: false },
      { n: "step_up_at", c: "dataclass:INTERNAL", nn: false },
    ]);
    const st = store();
    const id = await newDevice(st, "kc-step-0");
    await expect(
      db.admin.query(
        "update connectors.customer_device set step_up_acr = 'pwd', step_up_at = now() where id = $1",
        [id],
      ),
    ).rejects.toThrow(/check/);
  });

  it("records the step-up on an unrevoked device only, ledgered, under RLS; the time never moves back", async () => {
    const st = store();
    const id = await newDevice(st, "kc-step-1");
    expect((await st.listDevices("tnt_a", "kc-step-1"))[0]?.stepUpAt).toBeUndefined();
    expect(await st.recordStepUp("tnt_a", id, "otp", t0 + 60_000)).toBe(true);
    expect(await st.recordStepUp("tnt_a", id, "otp", t0 + 30_000)).toBe(true);
    expect((await st.listDevices("tnt_a", "kc-step-1"))[0]).toMatchObject({
      stepUpAt: t0 + 60_000,
      stepUpAcr: "otp",
    });
    // Another tenant cannot reach the row (forced RLS).
    expect(await st.recordStepUp("tnt_b", id, "otp", t0 + 90_000)).toBe(false);
    // A refresh keeps the step-up.
    expect(await st.rotateRefresh("tnt_a", id, sha256Hex(id), "5".repeat(64), t0 + 95_000)).toBe(
      true,
    );
    expect((await st.listDevices("tnt_a", "kc-step-1"))[0]?.stepUpAt).toBe(t0 + 60_000);
    // A revoked device is not stepped up.
    await st.revokeDevice("tnt_a", id, "sign_out", t0 + 100_000);
    expect(await st.recordStepUp("tnt_a", id, "otp", t0 + 120_000)).toBe(false);
    expect((await st.listDevices("tnt_a", "kc-step-1"))[0]?.stepUpAt).toBe(t0 + 60_000);
    // Every call is on the record, in the caller's tenant, without any login or code.
    expect(await stepUps(id)).toEqual(
      [
        ["tnt_a", t0 + 60_000, true],
        ["tnt_a", t0 + 30_000, true],
        ["tnt_b", t0 + 90_000, false],
        ["tnt_a", t0 + 120_000, false],
      ].map(([tenant_id, t, found]) => ({
        tenant_id,
        resource_type: "identity.customer_device",
        after_digest: canonicalDigest({ acr: "otp", step_up_at: at(t as number), found }),
      })),
    );
  });

  it("`fresh` reads past the device cache; the writer's own cache is dropped at once", async () => {
    let t = Date.now();
    const writer = store(() => t);
    const reader = store(() => t);
    const jkt = "b".repeat(43);
    const id = await newDevice(writer, "kc-step-2", jkt);
    expect((await reader.activeDevice("tnt_a", "kc-step-2", jkt))?.stepUpAt).toBeUndefined();
    expect((await writer.activeDevice("tnt_a", "kc-step-2", jkt))?.stepUpAt).toBeUndefined();
    await writer.recordStepUp("tnt_a", id, "otp", t);
    expect((await writer.activeDevice("tnt_a", "kc-step-2", jkt))?.stepUpAt).toBe(t);
    // Another replica's cache still answers the old row for up to 15 s; `fresh` does not.
    expect((await reader.activeDevice("tnt_a", "kc-step-2", jkt))?.stepUpAt).toBeUndefined();
    expect((await reader.activeDevice("tnt_a", "kc-step-2", jkt, { fresh: true }))?.stepUpAt).toBe(
      t,
    );
    t += 1000;
    expect((await reader.activeDevice("tnt_a", "kc-step-2", jkt))?.stepUpAt).toBe(t - 1000);
  });
});
