// LDC-67 (R1-D-298): startPostgres migrates once per server and migration set into a template, then
// copies it per call, with the same schema and the same isolation as a freshly migrated database.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { startPostgres, templateDatabaseName, type TestDatabase } from "./postgres.js";

const opened: TestDatabase[] = [];
afterAll(async () => {
  await Promise.all(opened.map((d) => d.end()));
});

/** A throwaway migration set; `tag` makes it unique to the test, so parallel files never share it. */
function migrations(tag: string, sql = "create table t (id int primary key, v text);") {
  const dir = mkdtempSync(join(tmpdir(), "ldc67-"));
  writeFileSync(join(dir, "0001_init.sql"), `-- ${tag}\n${sql}\n`);
  return [{ name: `ldc67-${tag}`, dir }];
}

/** The server's maintenance database, from a test database's URL. */
let server: string | undefined;
async function serverQuery<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: server });
  await c.connect();
  try {
    return (await c.query<T>(sql, params)).rows;
  } finally {
    await c.end();
  }
}

const open = async (o: Parameters<typeof startPostgres>[0]) => {
  const d = await startPostgres(o);
  opened.push(d);
  const u = new URL(d.url);
  u.pathname = "/postgres";
  server = u.toString();
  return d;
};
const uniq = () => Math.random().toString(36).slice(2, 10);

// On a server started for one call (no shared `IPB_TEST_PG_URL`) nothing is shared, so these skip.
describe("startPostgres template databases (LDC-67)", () => {
  it("builds one template per set, closed to connections, and copies it per call", async (ctx) => {
    const m = migrations(uniq());
    const name = await templateDatabaseName(m);
    const a = await open({ platform: false, migrations: m });
    if (!a.template) return ctx.skip();
    expect(a.template).toBe(name);
    const b = await open({ platform: false, migrations: m });
    expect(b.template).toBe(name);
    expect(
      await serverQuery("select datistemplate, datallowconn from pg_database where datname = $1", [
        name,
      ]),
    ).toEqual([{ datistemplate: true, datallowconn: false }]);
    for (const d of [a, b]) {
      expect((await d.admin.query("select to_regclass('public.t') as t")).rows[0].t).toBe("t");
      expect((await d.admin.query("select file from meta.migration_checksums")).rows).toEqual([
        { file: "0001_init.sql" },
      ]);
    }
    expect(a.url).not.toBe(b.url);
  });

  it("keeps each copy isolated: a row written in one is in neither the other nor the template", async () => {
    const m = migrations(uniq());
    const a = await open({ platform: false, migrations: m });
    await a.admin.query("insert into t values (1, 'a')");
    const b = await open({ platform: false, migrations: m });
    expect((await b.admin.query("select count(*)::int as n from t")).rows[0].n).toBe(0);
  });

  it("a changed file is a new set and a new template", async () => {
    const tag = uniq();
    const one = migrations(tag);
    const two = migrations(tag, "create table t (id int primary key, v text, w text);");
    expect(await templateDatabaseName(one)).not.toBe(await templateDatabaseName(two));
    const d = await open({ platform: false, migrations: two });
    expect(
      (
        await d.admin.query(
          "select count(*)::int as n from information_schema.columns where table_name = 't'",
        )
      ).rows[0].n,
    ).toBe(3);
  });

  it("template: false migrates the database itself and builds no template", async () => {
    const m = migrations(uniq());
    const d = await open({ platform: false, migrations: m, template: false });
    expect(d.template).toBeUndefined();
    expect((await d.admin.query("select to_regclass('public.t') as t")).rows[0].t).toBe("t");
    expect(
      await serverQuery("select 1 from pg_database where datname = $1", [
        await templateDatabaseName(m),
      ]),
    ).toEqual([]);
  });

  it("a failed build leaves no template and no half-built database behind", async (ctx) => {
    if (!(await open({ platform: false, migrations: migrations(uniq()) })).template)
      return ctx.skip();
    const m = migrations(uniq(), "create table t (id int primary key); select 1/0;");
    const name = await templateDatabaseName(m);
    await expect(startPostgres({ platform: false, migrations: m })).rejects.toThrow();
    expect(
      await serverQuery("select datname from pg_database where datname like $1", [`${name}%`]),
    ).toEqual([]);
  });

  it("a template renamed but never marked is rebuilt, not copied", async (ctx) => {
    if (!(await open({ platform: false, migrations: migrations(uniq()) })).template)
      return ctx.skip();
    const m = migrations(uniq());
    const name = await templateDatabaseName(m);
    await serverQuery(`create database ${name}`); // empty, as if a run stopped before marking it
    const d = await open({ platform: false, migrations: m });
    expect((await d.admin.query("select to_regclass('public.t') as t")).rows[0].t).toBe("t");
    expect(
      await serverQuery("select datistemplate from pg_database where datname = $1", [name]),
    ).toEqual([{ datistemplate: true }]);
  });
});
