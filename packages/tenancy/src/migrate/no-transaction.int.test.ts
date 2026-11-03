// PR-UDF-031: a file marked `-- infrabyx:no-transaction` runs one statement at a time, so a
// lint-clean CREATE INDEX CONCURRENTLY on an existing table applies; a failure part-way names how
// far it got and leaves the file unrecorded, so the next run repeats it.
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, type MigrationSource } from "./index.js";
import { freshDb, type TestDb } from "../__tests__/pg.js";

let db: TestDb;
let src: MigrationSource;

beforeAll(async () => {
  db = await freshDb([]);
  const dir = await mkdtemp(join(tmpdir(), "notx-"));
  src = { name: "product", dir };
  await writeFile(
    join(dir, "0001_table.sql"),
    "set lock_timeout = '5s';\nset statement_timeout = '60s';\ncreate schema p;\ncreate table p.t (id int primary key, k text);\ninsert into p.t values (1, 'a'), (2, 'b');\n",
  );
  await writeFile(
    join(dir, "0002_index.sql"),
    "-- infrabyx:no-transaction\nset lock_timeout = '5s';\nset statement_timeout = '600s';\ncreate unique index concurrently if not exists t_k_idx on p.t (k);\n",
  );
});
afterAll(async () => db?.end());

describe("no-transaction migrations (PR-UDF-031)", () => {
  it("applies CREATE INDEX CONCURRENTLY on an existing table", async () => {
    const r = await migrate({ client: db.admin, sources: [src] });
    expect(r.applied).toEqual(["product/0001_table.sql", "product/0002_index.sql"]);
    const idx = await db.admin.query(
      "select indisvalid from pg_index where indexrelid = 'p.t_k_idx'::regclass",
    );
    expect(idx.rows[0]?.indisvalid).toBe(true);
  });

  it("reports a part-way failure and repeats the file on the next run", async () => {
    await writeFile(
      join(src.dir, "0003_bad.sql"),
      "-- infrabyx:no-transaction\nset lock_timeout = '5s';\nset statement_timeout = '60s';\ncreate index concurrently if not exists t_id_idx on p.t (id);\ncreate index concurrently no_such on p.missing (x);\n",
    );
    await expect(migrate({ client: db.admin, sources: [src] })).rejects.toThrow(
      /3 of 4 statements applied/,
    );
    const rec = await db.admin.query(
      "select 1 from meta.migration_checksums where file = '0003_bad.sql'",
    );
    expect(rec.rows).toHaveLength(0);
  });
});
