#!/usr/bin/env node
// infrabyx-migrate --db <url> | --db-file <path> [--dir <product migrations>] [--name <product>] [--dry-run]
// Applies platform migrations (tenancy, audit, config, seed, connectors) then the product's own.
// --db-file reads the URL from a file (the secrets CSI mount in the chart's migration job), so the
// URL and its password never appear in arguments or the environment (IPB-02-28).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";
import { migrate, platformSources, type MigrationSource } from "./index.js";

/** The database URL from `--db` or from the first line of `--db-file`; exactly one of them. */
export function dbUrl(db?: string, dbFile?: string): string | undefined {
  if (db && dbFile) return undefined;
  if (dbFile) return readFileSync(dbFile, "utf8").split("\n")[0]?.trim() || undefined;
  return db || undefined;
}

export async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      db: { type: "string" },
      "db-file": { type: "string" },
      dir: { type: "string" },
      name: { type: "string", default: "product" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const db = dbUrl(values.db, values["db-file"]);
  if (!db) {
    process.stderr.write(
      "usage: infrabyx-migrate --db <postgres url> | --db-file <path> [--dir migrations] [--name product] [--dry-run]\n",
    );
    return 2;
  }
  const sources: MigrationSource[] = [...platformSources()];
  if (values.dir) sources.push({ name: values.name, dir: values.dir });
  const client = new pg.Client({ connectionString: db });
  await client.connect();
  try {
    const r = await migrate({
      client,
      sources,
      dryRun: values["dry-run"],
      log: (l) => process.stdout.write(`${l}\n`),
    });
    process.stdout.write(
      `${values["dry-run"] ? "would apply" : "applied"} ${r.applied.length}, already applied ${r.skipped.length}\n`,
    );
    return 0;
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e: unknown) => {
      process.stderr.write(`${(e as Error).message}\n`);
      process.exit(1);
    },
  );
}
