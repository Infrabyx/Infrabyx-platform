// PR-UDF-016 (security; IPB-02-12): the read-only role writes nothing. A login holding only
// app_ro tries every write it could reach (directly, through the inherited roles, and by
// switching to a service role); each is refused with 42501. Then, over the catalogue, no role
// reachable from app_ro or any other read-only or auditor role, by INHERIT or by SET, holds a
// write privilege on any table, column or sequence; and no service role is inherited.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { platformSources } from "./migrate/index.js";
import { freshDb, type TestDb } from "./__tests__/pg.js";

let db: TestDb;
const PASSWORD = "ro-probe-only-in-this-test";

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "ro-roles-"));
  writeFileSync(
    join(dir, "0001_relaytest.sql"),
    `create schema relaytest;
grant usage on schema relaytest to app_rw, app_ro;
create table relaytest.outbox (
  id text primary key, tenant_id text not null, type text not null, envelope jsonb not null,
  created_at timestamptz not null default now(), dispatched_at timestamptz,
  attempts integer not null default 0);
alter table relaytest.outbox enable row level security;
alter table relaytest.outbox force row level security;
create policy outbox_tenant on relaytest.outbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on relaytest.outbox to app_rw;
grant select on relaytest.outbox to app_ro;
select tenancy.register_outbox('relaytest');
`,
  );
  db = await freshDb([...platformSources(), { name: "relaytest", dir }]);
  await db.admin.query(`create role ro_probe login password '${PASSWORD}' inherit`);
  await db.admin.query("grant app_ro to ro_probe");
  await db.admin.query(
    `insert into relaytest.outbox (id, tenant_id, type, envelope) values ('e1', 'tnt_a', 't', '{}')`,
  );
});
afterAll(async () => {
  await db?.admin.query("drop owned by ro_probe").catch(() => {});
  await db?.admin.query("drop role if exists ro_probe").catch(() => {});
  await db?.end();
});

async function asProbe<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const u = new URL(db.url);
  u.username = "ro_probe";
  u.password = PASSWORD;
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** "42501" only for a privilege refusal; an RLS refusal (also 42501) or anything else differs. */
const sqlstate = (c: pg.Client, sql: string) =>
  c.query(sql).then(
    () => "ok",
    (e: { code?: string; message?: string }) =>
      e.code === "42501" && /permission denied/.test(e.message ?? "")
        ? "42501"
        : `${e.code ?? "error"}: ${e.message ?? ""}`,
  );

describe("@IPB-02-12 PR-UDF-016 the read-only role writes nothing", () => {
  it("a login holding only app_ro is refused every write (42501), as itself and as app_ro", async () => {
    const writes = [
      `insert into audit.ledger (id) values ('led_x')`,
      `update relaytest.outbox set attempts = attempts + 1, dispatched_at = now()`,
      `delete from relaytest.outbox`,
      `insert into tenancy.tenant (id, product, name) values ('tnt_x', 'UDF', 'x')`,
    ];
    await asProbe(async (c) => {
      await c.query(
        "select set_config('app.tenant_id', 'tnt_a', false), set_config('app.scope', 'platform', false)",
      );
      for (const w of writes) expect(await sqlstate(c, w), w).toBe("42501");
      await c.query("set role app_ro");
      for (const w of writes) expect(await sqlstate(c, w), w).toBe("42501");
    });
  });

  it("app_ro cannot switch to the outbox relay's role, the one service role that writes", async () => {
    await asProbe(async (c) => {
      expect(await sqlstate(c, "set role svc_outbox_relay")).toBe("42501");
    });
  });

  it("no role reachable from a read-only or auditor role holds a write privilege", async () => {
    const roles = (
      await db.admin.query<{ rolname: string }>(
        `select rolname from pg_roles where rolname ~ '(^app_ro$|_ro$|audit)' and rolname !~ '^pg_'`,
      )
    ).rows.map((r) => r.rolname);
    expect(roles).toContain("app_ro");
    for (const role of roles) {
      const found = await db.admin.query<{ grantee: string; object: string; privilege: string }>(
        `with reach as (
           select r.oid, r.rolname from pg_roles r
            where pg_has_role($1, r.oid, 'USAGE') or pg_has_role($1, r.oid, 'SET')
           union select 0, 'PUBLIC'
         ),
         tables as (
           select c.oid, c.relnamespace::regnamespace::text || '.' || c.relname as object, c.relacl, c.relkind
             from pg_class c
            where c.relnamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
              and c.relnamespace::regnamespace::text !~ '^pg_toast'
              and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
         )
         select reach.rolname as grantee, t.object, a.privilege_type as privilege
           from tables t, aclexplode(t.relacl) a join reach on reach.oid = a.grantee
          where (t.relkind <> 'S' and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'))
             or (t.relkind = 'S' and a.privilege_type in ('UPDATE', 'USAGE'))
         union all
         select reach.rolname, t.object || '.' || att.attname, a.privilege_type
           from tables t join pg_attribute att on att.attrelid = t.oid and att.attacl is not null,
                aclexplode(att.attacl) a join reach on reach.oid = a.grantee
          where a.privilege_type in ('INSERT', 'UPDATE')`,
        [role],
      );
      expect(found.rows, `${role} reaches a write privilege`).toEqual([]);
    }
  });

  it("app_rw and app_ro inherit no service role; app_rw can still switch to them", async () => {
    const m = await db.admin.query<{
      role: string;
      member: string;
      inherit: boolean;
      set: boolean;
    }>(
      `select r.rolname as role, m.rolname as member, a.inherit_option as inherit, a.set_option as set
         from pg_auth_members a join pg_roles r on r.oid = a.roleid join pg_roles m on m.oid = a.member
        where m.rolname in ('app_ro', 'app_rw') and r.rolname like 'svc\\_%'`,
    );
    expect(m.rows.length).toBeGreaterThan(0);
    expect(m.rows.filter((r) => r.inherit)).toEqual([]);
    expect(m.rows.filter((r) => r.member === "app_rw" && !r.set)).toEqual([]);
    expect(
      m.rows.find((r) => r.member === "app_ro" && r.role === "svc_outbox_relay"),
    ).toBeUndefined();
    const roles = await db.admin.query<{ rolname: string; rolinherit: boolean }>(
      `select rolname, rolinherit from pg_roles where rolname in ('app_ro', 'app_rw') order by 1`,
    );
    expect(roles.rows).toEqual([
      { rolname: "app_ro", rolinherit: false },
      { rolname: "app_rw", rolinherit: false },
    ]);
  });
});
