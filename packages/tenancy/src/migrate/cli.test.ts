import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dbUrl, main } from "./cli.js";

describe("infrabyx-migrate database URL", () => {
  const dir = mkdtempSync(join(tmpdir(), "ipb-migrate-"));
  const file = join(dir, "db_migrate_url");
  writeFileSync(file, "postgres://app_migrate@db.example.test:5432/app\n");

  it("reads --db, or the first line of --db-file (the chart's secrets mount)", () => {
    expect(dbUrl("postgres://a@h/db")).toBe("postgres://a@h/db");
    expect(dbUrl(undefined, file)).toBe("postgres://app_migrate@db.example.test:5432/app");
  });

  it("refuses both or neither", async () => {
    expect(dbUrl("postgres://a@h/db", file)).toBeUndefined();
    expect(dbUrl()).toBeUndefined();
    expect(await main([])).toBe(2);
    expect(await main(["--db", "postgres://a@h/db", "--db-file", file])).toBe(2);
  });
});
