// startPostgres (PL1 plan §10): a fresh PostgreSQL database with the roles and every platform
// migration applied. IPB_TEST_PG_URL points at an existing server (CI service container); without
// it a PostgreSQL 18 container with pgvector starts through Testcontainers.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import pg from "pg";
import { PgAuditSink } from "@infrabyx/audit";
import { envUrl, envVar, validateEnv } from "@infrabyx/config/env";
import { randomBytes, sha256, toHex } from "@infrabyx/crypto";
import { PgKernel } from "@infrabyx/tenancy";
import {
  migrate,
  platformSources,
  readMigrations,
  type MigrationSource,
} from "@infrabyx/tenancy/migrate";
import { TEST_IMAGES } from "./containers.js";

const testEnv = z.object({
  APP_ENV: envVar(z.string(), {
    desc: "Deployment environment",
    example: "test",
    required: "opt",
    sens: "C",
    port: "APP",
  }),
  IPB_TEST_PG_URL: envVar(envUrl(), {
    desc: "Superuser URL of a PostgreSQL 16+ server for integration tests",
    example: "postgres://postgres@127.0.0.1:5432/postgres",
    required: "opt",
    sens: "C",
    port: "IPB",
  }),
});

export interface StartPostgresOptions {
  /** Product migrations applied after the platform ones. */
  migrations?: readonly MigrationSource[];
  /** Skip the platform migrations (only the given ones run). */
  platform?: boolean;
  /**
   * Directory from which platform packages are resolved. Default: the current directory (the
   * caller's package when its tests run there), then this package (PR-FBX-06).
   */
  resolveFrom?: string;
  /**
   * Refuse (IPB-MOD-001) when a platform package with migrations cannot be resolved, instead of
   * naming it on stderr and going on without its tables.
   */
  requirePlatform?: boolean;
  image?: string;
  /**
   * Run by `end()` before the suite's database is dropped, given the superuser client (PR-UDF-042):
   * for a last check over every table, such as `scanDatabaseForAadhaar(admin)`. If it throws, `end()`
   * still drops the database (and stops the container), then rejects with the hook's error.
   */
  beforeDrop?: (admin: pg.Client) => Promise<void> | void;
  /**
   * Copy the database from a template migrated once per server and migration set (LDC-67), instead
   * of migrating each database. Default `true` on a shared server (`IPB_TEST_PG_URL`); a server
   * started for this call alone has nothing to share, so it migrates directly. `false` migrates
   * this database itself, for a test of the migrations' own behaviour.
   */
  template?: boolean;
}

export interface TestDatabase {
  url: string;
  /** The template this database was copied from (LDC-67), or undefined when it was migrated itself. */
  template?: string;
  /** Pool for the kernel; transactions assume app_rw through SET LOCAL ROLE. */
  pool: pg.Pool;
  /** Superuser client for fixtures and raw inspection; bypasses RLS. */
  admin: pg.Client;
  kernel: PgKernel;
  audit: PgAuditSink;
  /**
   * Run `beforeDrop`, end the clients, drop the database and stop the container. Idempotent
   * (PR-UDF-063): a second call, later or concurrent, returns the first call's promise (it settles
   * the same way, the hook's error included) and runs nothing again.
   */
  end(): Promise<void>;
}

/** PostgreSQL 18 with pgvector, as CI's integration job runs it (PL4 plan §4.9). */
export const PG_TEST_IMAGE = TEST_IMAGES.pgvector.image;

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function serverUrl(image: string): Promise<{ url: string; stop?: () => Promise<void> }> {
  const r = await validateEnv(testEnv, { guards: [], defaultAppEnv: "test" });
  const url = r.ok ? r.values.IPB_TEST_PG_URL : undefined;
  if (url) return { url };
  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
  const c = await new PostgreSqlContainer(image).start();
  return { url: c.getConnectionUri(), stop: async () => void (await c.stop()) };
}

/** The template's name: one per migration set, so a changed, added or removed file makes a new one. */
export async function templateDatabaseName(sources: readonly MigrationSource[]): Promise<string> {
  const files = await readMigrations(sources);
  const set = JSON.stringify([TEMPLATE_FORMAT, files.map((f) => [f.source, f.file, f.sha256])]);
  return `tpl_${toHex(sha256(new TextEncoder().encode(set))).slice(0, 24)}`;
}

/** Bumped when the way a template is built changes, so old templates are not reused. */
const TEMPLATE_FORMAT = 1;

export async function startPostgres(o: StartPostgresOptions = {}): Promise<TestDatabase> {
  // Resolved first, so a refusal leaves no database behind.
  const sources = [
    ...(o.platform === false
      ? []
      : platformSources(o.resolveFrom ?? [process.cwd(), pkgRoot], undefined, {
          missing: o.requirePlatform ? "error" : "skip",
          onSkipped: (names) =>
            process.stderr.write(
              `startPostgres: not installed, migrations skipped: ${names.join(", ")}\n`,
            ),
        })),
    ...(o.migrations ?? []),
  ];
  const server = await serverUrl(o.image ?? PG_TEST_IMAGE);
  const name = `t_${toHex(randomBytes(6))}`;
  const useTemplate = o.template !== false && server.stop === undefined;
  const template = useTemplate ? await templateDatabaseName(sources) : undefined;
  const root = new pg.Client({ connectionString: server.url });
  await root.connect();
  const dbUrl = (db: string) => {
    const u = new URL(server.url);
    u.pathname = `/${db}`;
    return u.toString();
  };
  // Roles are cluster-wide, and tenancy/0003 grants app_ro a role that 0004 revokes: databases on
  // one server migrate one at a time, so no test sees another database's half-applied grants. The
  // same lock makes one caller build a missing template while the others wait for it (LDC-67).
  await root.query("select pg_advisory_lock(hashtext('infrabyx:test-migrate'))");
  try {
    if (template) {
      const found = await root.query<{ datistemplate: boolean }>(
        "select datistemplate from pg_database where datname = $1",
        [template],
      );
      // Renamed but never marked (a run stopped between the two statements): not complete.
      if (found.rows[0]?.datistemplate === false)
        await root.query(`drop database ${template} with (force)`);
      if (found.rows[0]?.datistemplate !== true)
        await buildTemplate(root, template, sources, dbUrl);
      // A copy has the template's schema, roles' grants, data and migration checksums, and is this
      // test's alone: nothing written here reaches the template or another copy.
      await root.query(`create database ${name} template ${template}`);
    } else {
      await root.query(`create database ${name}`);
      const c = new pg.Client({ connectionString: dbUrl(name) });
      await c.connect();
      try {
        await migrate({ client: c, sources });
      } finally {
        await c.end();
      }
    }
  } finally {
    await root.end(); // the session's end releases the lock
  }
  const url = dbUrl(name);
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const pool = new pg.Pool({ connectionString: url, max: 25 });
  // `drop database … with (force)` in `end()` can reach a client whose socket is still closing; the
  // server's "terminating connection due to administrator command" (57P01) is then expected and
  // must not surface as an unhandled error. Any other error still does.
  let ending = false;
  const tolerateShutdown = (c: pg.Client | pg.PoolClient) =>
    c.on("error", (e: Error & { code?: string }) => {
      if (!(ending && e.code === "57P01")) throw e;
    });
  pool.on("connect", tolerateShutdown);
  pool.on("error", (e: Error & { code?: string }) => {
    if (!(ending && e.code === "57P01")) throw e;
  });
  tolerateShutdown(admin);
  // `end()` runs once (PR-UDF-063): a second call, later or while the first runs, gets the first
  // call's promise, so the hook runs once and the database is dropped once.
  let ended: Promise<void> | undefined;
  return {
    url,
    ...(template ? { template } : {}),
    pool,
    admin,
    kernel: new PgKernel({ pool }),
    audit: new PgAuditSink(),
    end() {
      ended ??= endOnce();
      return ended;
    },
  };

  async function endOnce(): Promise<void> {
    let hook: { error: unknown } | undefined;
    if (o.beforeDrop)
      try {
        await o.beforeDrop(admin);
      } catch (error) {
        hook = { error };
      }
    ending = true;
    try {
      await pool.end();
      await admin.end();
      const r = new pg.Client({ connectionString: server.url });
      await r.connect();
      await r.query(`drop database if exists ${name} with (force)`);
      await r.end();
    } finally {
      await server.stop?.();
    }
    if (hook) throw hook.error;
  }
}

/**
 * Migrate a database under a building name, then rename it to the template's and close it to
 * connections, so a template exists only once complete. A failed migration drops the half-built
 * database and rethrows; nothing is left behind for the next caller to copy.
 */
async function buildTemplate(
  root: pg.Client,
  template: string,
  sources: readonly MigrationSource[],
  dbUrl: (db: string) => string,
): Promise<void> {
  const building = `${template}_b${toHex(randomBytes(3))}`;
  await root.query(`create database ${building}`);
  try {
    const c = new pg.Client({ connectionString: dbUrl(building) });
    await c.connect();
    try {
      await migrate({ client: c, sources });
    } finally {
      await c.end();
    }
    await root.query(`alter database ${building} rename to ${template}`);
    await root.query(`alter database ${template} with is_template true allow_connections false`);
  } catch (e) {
    await root.query(`drop database if exists ${building} with (force)`).catch(() => undefined);
    throw e;
  }
}
