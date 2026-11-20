// startPostgres({ beforeDrop }) and scanDatabaseForAadhaar (PR-UDF-042, R1-D-195); the idempotent
// end(), every column type, named fields, the row cap and the empty sweep (PR-UDF-063, R1-D-242). The drop is seen
// from a second connection to the server's maintenance database: on a server that outlives the
// suite (CI's service container, `pnpm check:full`), the database is gone after `end()`; on a
// Testcontainers server, `end()` has stopped the server too, after the drop.
import pg from "pg";
import { describe, expect, it } from "vitest";
import { verhoeffValid } from "@infrabyx/contracts/aadhaar";
import {
  AadhaarScanEmptyError,
  AadhaarScanLimitError,
  scanDatabaseForAadhaar,
  sweepDatabaseForAadhaar,
  type AadhaarDatabaseFind,
  type AadhaarDatabaseScan,
  type AadhaarDatabaseScanOptions,
} from "./aadhaar-scan/index.js";
import { startPostgres, type TestDatabase } from "./postgres.js";

const withCheck = (stem: string): string => {
  for (let d = 0; d < 10; d++) if (verhoeffValid(`${stem}${d}`)) return `${stem}${d}`;
  throw new RangeError("no check digit");
};
const UID = withCheck("23456789012");
const VID = withCheck("912345678901234");
const PHONE = withCheck("91987654321");

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

describe("PR-UDF-063 TestDatabase.end() is idempotent", () => {
  it("runs the hook and the drop once, for a second call later or at the same time", async () => {
    let runs = 0;
    const db = await startPostgres({ platform: false, beforeDrop: () => void runs++ });
    const monitor = await monitorOf(db);
    const name = dbName(db);
    const [a, b] = [db.end(), db.end()];
    expect(a).toBe(b);
    await Promise.all([a, b]);
    await db.end();
    expect(runs).toBe(1);
    expect([false, "server stopped"]).toContain(await exists(monitor, name));
    await monitor.end().catch(() => {});
  });

  it("a second call after a failing hook settles the same way, and runs nothing again", async () => {
    const boom = new Error("the hook failed");
    let runs = 0;
    const db = await startPostgres({
      platform: false,
      beforeDrop: () => {
        runs++;
        throw boom;
      },
    });
    await expect(db.end()).rejects.toBe(boom);
    await expect(db.end()).rejects.toBe(boom);
    expect(runs).toBe(1);
  });
});

describe("PR-UDF-042 scanDatabaseForAadhaar", () => {
  it("reads every column of every table, masked finds only, from beforeDrop", async () => {
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
    const field = { kind: "FIELD", masked: "(value withheld)" };
    expect(finds).toEqual([
      { ...at, table: "other", column: "body", kind: "VID", masked: v },
      { ...at, table: "t", column: "note", kind: "AADHAAR", masked: m },
      { ...at, table: "t", column: "code", kind: "VID", masked: v },
      // PR-UDF-063: the `uid` field of the jsonb document, then the number in it.
      { ...at, table: "t", column: "doc", ...field, field: "uid" },
      { ...at, table: "t", column: "doc", kind: "AADHAAR", masked: m },
      { ...at, table: "t", column: "tags", kind: "AADHAAR", masked: m },
      { ...at, table: "t", column: "l", kind: "AADHAAR", masked: m },
      // PR-UDF-063: a bigint column is read too.
      { ...at, table: "t", column: "n", kind: "AADHAAR", masked: m },
    ]);
    expect(skipped.map((f) => `${f.table}.${f.column}`)).toEqual([
      "t.note",
      "t.code",
      "t.doc",
      "t.doc",
      "t.l",
      "t.n",
    ]);
    expect(JSON.stringify(finds)).not.toContain(UID.slice(0, 8));
    expect(JSON.stringify(finds)).not.toContain(VID.slice(0, 8));
  });
});

describe("PR-UDF-063 sweepDatabaseForAadhaar", () => {
  /** A database built by `setup`, swept from beforeDrop with `o`; the sweep, or its error. */
  async function sweep(
    setup: (admin: pg.Client) => Promise<unknown>,
    o: AadhaarDatabaseScanOptions = {},
  ): Promise<AadhaarDatabaseScan> {
    let r: AadhaarDatabaseScan | undefined;
    const db = await startPostgres({
      platform: false,
      beforeDrop: async (admin) => void (r = await sweepDatabaseForAadhaar(admin, o)),
    });
    await setup(db.admin);
    await db.end();
    return r!;
  }
  const where = (s: AadhaarDatabaseScan) =>
    s.finds.map((f) => `${f.table}.${f.column}${f.field ? `.${f.field}` : ""}:${f.kind}`);

  it("flags a column or JSON field named like an Aadhaar carrier whenever it holds a value", async () => {
    const r = await sweep(async (admin) => {
      await admin.query(`
        create table people (id int, aadhaar_number text, "uidToken" text, uid bigint,
                             "AADHAAR" boolean, aadhaar_no text[], aadhaar_last_digits text,
                             uid_kind text, profile jsonb, body text);`);
      await admin.query(
        `insert into people values
           (1, $1, 'tok_01JA', 42, true, '{}', '0124', 'AADHAAR', $2, $3),
           (2, '', '  ', null, false, '{NULL,""}', null, null, '{"uid": null, "kyc": []}', null)`,
        [
          // Not Verhoeff-valid, and not twelve digits: flagged for its name all the same.
          `${UID.slice(0, -1)}${(Number(UID.at(-1)) + 1) % 10}`,
          JSON.stringify({ kyc: [{ aadhaarNumber: "x" }], uid_kind: "VID" }),
          JSON.stringify({ customer: { uid: 7 } }),
        ],
      );
    });
    expect(where(r)).toEqual([
      "people.aadhaar_number:FIELD",
      "people.uidToken:FIELD",
      "people.uid:FIELD",
      "people.profile.kyc.0.aadhaarNumber:FIELD",
      "people.body.customer.uid:FIELD",
    ]);
    expect(r.finds.every((f) => f.masked === "(value withheld)")).toBe(true);
    // With `meta.migration_checksums` (empty without migrations), which is read too.
    expect(r).toMatchObject({ tables: 2, rows: 2 });
  });

  it("reads every column type: numeric, integer arrays, json as written, bytea, composites", async () => {
    const r = await sweep(async (admin) => {
      await admin.query(`
        create type pair as (a text, b numeric);
        create table money (id int, amount numeric(20, 0), share numeric(30, 2), counts bigint[],
                            raw json, blob bytea, blob_hex bytea, p pair, at timestamptz);`);
      await admin.query(
        `insert into money values (1, $1, $2, $3, $4, convert_to($5, 'UTF8'), $6, row('x', $7)::pair, now())`,
        [
          VID,
          `${UID}.00`,
          [1, UID],
          // json keeps duplicate keys as written; jsonb would keep the last only.
          `{"a": "${UID}", "a": "y"}`,
          `ref ${UID}`,
          Buffer.from(UID.replace(/(..)/g, "$1"), "hex"),
          UID,
        ],
      );
    });
    expect(where(r)).toEqual([
      "money.amount:VID",
      "money.share:AADHAAR",
      "money.counts:AADHAAR",
      "money.raw:AADHAAR",
      "money.blob:AADHAAR",
      "money.blob_hex:AADHAAR",
      "money.p:AADHAAR",
    ]);
    // With the decimal look-alike allowed, the numeric(30, 2) value is let through.
    const allowed = await sweep(
      async (admin) => {
        await admin.query("create table m (share numeric(30, 2), phone text)");
        await admin.query("insert into m values ($1, $2)", [`${UID}.00`, `+${PHONE}`]);
      },
      { allow: ["decimal", "e164_in"] },
    );
    expect(allowed.finds).toEqual([]);
    const strict = await sweep(async (admin) => {
      await admin.query("create table m (share numeric(30, 2), phone text)");
      await admin.query("insert into m values ($1, $2)", [`${UID}.00`, `+${PHONE}`]);
    });
    expect(where(strict)).toEqual(["m.share:AADHAAR", "m.phone:AADHAAR"]);
  });

  it("reads past one batch, and rejects past maxRows rather than pass a partial read", async () => {
    const setup = async (admin: pg.Client) => {
      await admin.query("create table big (n int, note text)");
      await admin.query("insert into big select g, 'clean' from generate_series(1, 250) g");
      await admin.query("insert into big values (251, $1)", [`late ${UID}`]);
    };
    const r = await sweep(setup);
    expect(r).toMatchObject({ tables: 2, rows: 251 });
    expect(r.finds.map((f) => f.kind)).toEqual(["AADHAAR"]);
    let error: unknown;
    const db = await startPostgres({
      platform: false,
      beforeDrop: async (admin) => {
        try {
          await sweepDatabaseForAadhaar(admin, { maxRows: 200 });
        } catch (e) {
          error = e;
        }
      },
    });
    await setup(db.admin);
    await db.end();
    expect(error).toBeInstanceOf(AadhaarScanLimitError);
  });

  it("rejects a sweep that reads no table or no row, unless allowEmpty", async () => {
    const errors: unknown[] = [];
    const scans: AadhaarDatabaseScan[] = [];
    const db = await startPostgres({
      platform: false,
      beforeDrop: async (admin) => {
        for (const o of [{}, { skip: ["public.empty"] }])
          await sweepDatabaseForAadhaar(admin, o).catch((e: unknown) => errors.push(e));
        scans.push(await sweepDatabaseForAadhaar(admin, { allowEmpty: true }));
        await scanDatabaseForAadhaar(admin).catch((e: unknown) => errors.push(e));
      },
    });
    await db.admin.query("create table empty (body text)");
    await db.end();
    expect(errors).toHaveLength(3);
    for (const e of errors) expect(e).toBeInstanceOf(AadhaarScanEmptyError);
    // `empty` and `meta.migration_checksums`, both without a row.
    expect(scans).toEqual([{ finds: [], tables: 2, rows: 0 }]);
  });
});
