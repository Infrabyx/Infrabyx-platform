// startPostgres({ beforeDrop }) and scanDatabaseForAadhaar (PR-UDF-042, R1-D-195). The drop is seen
// from a second connection to the server's maintenance database: on a server that outlives the
// suite (CI's service container, `pnpm check:full`), the database is gone after `end()`; on a
// Testcontainers server, `end()` has stopped the server too, after the drop.
import pg from "pg";
import { describe, expect, it } from "vitest";
import { verhoeffValid } from "@infrabyx/contracts/aadhaar";
import { scanDatabaseForAadhaar, type AadhaarDatabaseFind } from "./aadhaar-scan/index.js";
import { startPostgres, type TestDatabase } from "./postgres.js";

const withCheck = (stem: string): string => {
  for (let d = 0; d < 10; d++) if (verhoeffValid(`${stem}${d}`)) return `${stem}${d}`;
  throw new RangeError("no check digit");
};
const UID = withCheck("23456789012");
const VID = withCheck("912345678901234");

/** A client on the server's maintenance database, which `end()` never drops. */
async function monitorOf(db: TestDatabase): Promise<pg.Client> {
  const u = new URL(db.url);
  u.pathname = "/postgres";
  const m = new pg.Client({ connectionString: u.toString() });
  m.on("error", () => {}); // the server may stop under it (Testcontainers)
  await m.connect();
  return m;
}

/** Whether the database still exists, or "server stopped" when the server went with it. */
async function exists(m: pg.Client, name: string): Promise<boolean | "server stopped"> {
  try {
    const r = await m.query("select 1 from pg_database where datname = $1", [name]);
    return r.rowCount === 1;
  } catch {
    return "server stopped";
  }
}

const dbName = (db: TestDatabase) => new URL(db.url).pathname.slice(1);

describe("PR-UDF-042 startPostgres({ beforeDrop })", () => {
  it("runs the hook with the admin client before the database is dropped", async () => {
    const seen: (boolean | number | string)[] = [];
    const ref: { monitor?: pg.Client } = {};
    const db = await startPostgres({
      platform: false,
      beforeDrop: async (admin) => {
        const r = await admin.query<{ n: string; v: number }>(
          "select current_database() as n, (select v from hook_probe) as v",
        );
        seen.push(r.rows[0]!.n, r.rows[0]!.v, await exists(ref.monitor!, r.rows[0]!.n));
      },
    });
    const monitor = (ref.monitor = await monitorOf(db));
    await db.admin.query("create table hook_probe (v int); insert into hook_probe values (7)");
    const name = dbName(db);
    await db.end();
    expect(seen).toEqual([name, 7, true]);
    expect([false, "server stopped"]).toContain(await exists(monitor, name));
    await expect(db.admin.query("select 1")).rejects.toThrow();
    await monitor.end().catch(() => {});
  });

  it("still drops the database when the hook throws, then rejects with the hook's error", async () => {
    const boom = new Error("the hook failed");
    const db = await startPostgres({
      platform: false,
      beforeDrop: () => {
        throw boom;
      },
    });
    const monitor = await monitorOf(db);
    const name = dbName(db);
    expect(await exists(monitor, name)).toBe(true);
    await expect(db.end()).rejects.toBe(boom);
    expect([false, "server stopped"]).toContain(await exists(monitor, name));
    await expect(db.pool.query("select 1")).rejects.toThrow();
    await monitor.end().catch(() => {});
  });
});

describe("PR-UDF-042 scanDatabaseForAadhaar", () => {
  it("reads every text-like column of every table, masked finds only, from beforeDrop", async () => {
    let finds: AadhaarDatabaseFind[] = [];
    let skipped: AadhaarDatabaseFind[] = [];
    const db = await startPostgres({
      platform: false,
      beforeDrop: async (admin) => {
        finds = await scanDatabaseForAadhaar(admin);
        skipped = await scanDatabaseForAadhaar(admin, { skip: ["s.t.tags", "s.other"] });
      },
    });
    const spaced = UID.replace(/(\d{4})(?=\d)/g, "$1 ");
    await db.admin.query(`
      create schema s;
      create domain s.label as text;
      create table s.t (id int, note text, code varchar(40), doc jsonb, tags text[], l s.label,
                        n bigint, u uuid);
      create table s.other (body text);
      create table s.clean (body text, doc json);
      alter table s.t enable row level security;
      alter table s.t force row level security;`);
    await db.admin.query(
      "insert into s.t values (1, $1, $2, $3, $4, $5, $6, $7), (2, null, null, null, null, null, null, null)",
      [
        `uid ${spaced}`,
        `ref-${VID}`,
        JSON.stringify({ hash: `ab${UID}cd`, id: `0190aaaa-bbbb-7ccc-8ddd-${UID}`, uid: UID }),
        ["x", `+${UID}`],
        `${UID}`,
        UID,
        "0190aaaa-bbbb-7ccc-8ddd-000000000000",
      ],
    );
    await db.admin.query("insert into s.other values ($1)", [`body ${VID}`]);
    await db.admin.query("insert into s.clean values ('nothing here', '{\"n\": 1234567890123}')");
    await db.end();
    const last4 = UID.slice(-4);
    const m = `XXXX XXXX ${last4}`;
    const v = `XXXX XXXX XXXX ${VID.slice(-4)}`;
    const at = { schema: "s", ctid: "(0,1)" };
    expect(finds).toEqual([
      { ...at, table: "other", column: "body", kind: "VID", masked: v },
      { ...at, table: "t", column: "note", kind: "AADHAAR", masked: m },
      { ...at, table: "t", column: "code", kind: "VID", masked: v },
      { ...at, table: "t", column: "doc", kind: "AADHAAR", masked: m },
      { ...at, table: "t", column: "tags", kind: "AADHAAR", masked: m },
      { ...at, table: "t", column: "l", kind: "AADHAAR", masked: m },
    ]);
    expect(skipped.map((f) => `${f.table}.${f.column}`)).toEqual([
      "t.note",
      "t.code",
      "t.doc",
      "t.l",
    ]);
    expect(JSON.stringify(finds)).not.toContain(UID.slice(0, 8));
    expect(JSON.stringify(finds)).not.toContain(VID.slice(0, 8));
  });
});
