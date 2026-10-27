// Migration runner (PL1-D-02 / D-04, IPB-01 §01.4.6, IPB-09-32): applies platform package
// migrations in dependency order, then the product's own, records SHA-256 checksums in
// meta.migration_checksums and refuses a released file that has changed.
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { IpbError } from "@infrabyx/contracts/errors";
import { sha256Hex } from "@infrabyx/crypto";

/**
 * Platform packages that ship migrations, in apply order (PL1 plan §3.1). A package that is not
 * installed is skipped, so a product keeps one migrate command: installing @infrabyx/connectors
 * adds its schema to the next run (PL2-D-34).
 */
export const PLATFORM_MIGRATION_PACKAGES = [
  "@infrabyx/tenancy",
  "@infrabyx/audit",
  "@infrabyx/config",
  "@infrabyx/seed",
  "@infrabyx/connectors",
  "@infrabyx/rules",
  "@infrabyx/workflow",
  "@infrabyx/notify",
  "@infrabyx/export",
  "@infrabyx/ai",
  "@infrabyx/vidhi",
] as const;

export interface MigrationSource {
  /** Package name or product label recorded with each file. */
  name: string;
  dir: string;
}

export interface MigrationFile {
  source: string;
  file: string;
  sql: string;
  sha256: string;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

/** Statements that must run outside a transaction mark themselves with this header line. */
export const NO_TRANSACTION_MARKER = "-- infrabyx:no-transaction";
const LOCK_KEY = 7_270_140_001; // advisory lock id for concurrent runners

/** Locate installed platform packages' migrations/ directories from `fromDir` (default cwd). */
export function platformSources(
  fromDir = process.cwd(),
  names: readonly string[] = PLATFORM_MIGRATION_PACKAGES,
): MigrationSource[] {
  const req = createRequire(join(resolve(fromDir), "package.json"));
  const out: MigrationSource[] = [];
  for (const name of names) {
    let pkgJson: string;
    try {
      pkgJson = req.resolve(`${name}/package.json`);
    } catch {
      // Not installed from `fromDir` (e.g. the platform repository root): use the sibling package.
      const sibling = join(
        dirname(fileURLToPath(import.meta.url)),
        "../../..",
        name.split("/")[1] as string,
        "package.json",
      );
      if (!existsSync(sibling)) continue;
      pkgJson = sibling;
    }
    out.push({ name, dir: join(dirname(pkgJson), "migrations") });
  }
  return out;
}

export async function readMigrations(
  sources: readonly MigrationSource[],
): Promise<MigrationFile[]> {
  const files: MigrationFile[] = [];
  for (const s of sources) {
    let names: string[];
    try {
      names = (await readdir(s.dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
    } catch {
      continue;
    }
    for (const f of names) {
      const sql = await readFile(join(s.dir, f), "utf8");
      files.push({ source: s.name, file: f, sql, sha256: sha256Hex(sql) });
    }
  }
  return files;
}

const META_SQL = `
create schema if not exists meta;
revoke all on schema meta from public;
create table if not exists meta.migration_checksums (
  source      text        not null,
  file        text        not null,
  sha256      text        not null check (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at  timestamptz not null default now(),
  primary key (source, file)
);
comment on column meta.migration_checksums.source is 'dataclass:INTERNAL';
comment on column meta.migration_checksums.file is 'dataclass:INTERNAL';
comment on column meta.migration_checksums.sha256 is 'dataclass:INTERNAL';
comment on column meta.migration_checksums.applied_at is 'dataclass:INTERNAL';`;

export interface MigrateOptions {
  /** Connection as the migration identity (owner or a member of app_migrate). */
  client: pg.Client | pg.PoolClient;
  sources: readonly MigrationSource[];
  /** Report what would run without applying. */
  dryRun?: boolean;
  log?: (line: string) => void;
}

export async function migrate(o: MigrateOptions): Promise<MigrateResult> {
  const log = o.log ?? (() => undefined);
  const files = await readMigrations(o.sources);
  const c = o.client;
  await c.query("select pg_advisory_lock($1)", [LOCK_KEY]);
  try {
    await c.query(META_SQL);
    const known = new Map(
      (
        await c.query<{ source: string; file: string; sha256: string }>(
          "select source, file, sha256 from meta.migration_checksums",
        )
      ).rows.map((r) => [`${r.source}/${r.file}`, r.sha256]),
    );
    // Refuse edits to released files before applying anything (IPB-09 checksum-immutable).
    const edited = files.filter(
      (f) => known.has(`${f.source}/${f.file}`) && known.get(`${f.source}/${f.file}`) !== f.sha256,
    );
    if (edited.length) {
      throw new IpbError("IPB-ENG-005", {
        detail: `released migrations changed: ${edited.map((f) => `${f.source}/${f.file}`).join(", ")}`,
        meta: { rule: "checksum-immutable" },
      });
    }
    const result: MigrateResult = { applied: [], skipped: [] };
    for (const f of files) {
      const id = `${f.source}/${f.file}`;
      if (known.has(id)) {
        result.skipped.push(id);
        continue;
      }
      if (o.dryRun) {
        result.applied.push(id);
        continue;
      }
      const inTx = !f.sql.startsWith(NO_TRANSACTION_MARKER);
      try {
        if (inTx) await c.query("begin");
        await c.query(f.sql);
        await c.query(
          "insert into meta.migration_checksums (source, file, sha256) values ($1, $2, $3)",
          [f.source, f.file, f.sha256],
        );
        if (inTx) await c.query("commit");
      } catch (e) {
        if (inTx) await c.query("rollback").catch(() => undefined);
        throw new Error(`migration ${id} failed: ${(e as Error).message}`, { cause: e });
      }
      log(`applied ${id}`);
      result.applied.push(id);
    }
    return result;
  } finally {
    await c.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
  }
}
