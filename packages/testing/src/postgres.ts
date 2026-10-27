// startPostgres (PL1 plan §10): a fresh PostgreSQL database with the roles and every platform
// migration applied. IPB_TEST_PG_URL points at an existing server (CI service container); without
// it a postgres:18 container starts through Testcontainers.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import pg from "pg";
import { PgAuditSink } from "@infrabyx/audit";
import { envUrl, envVar, validateEnv } from "@infrabyx/config/env";
import { randomBytes, toHex } from "@infrabyx/crypto";
import { PgKernel } from "@infrabyx/tenancy";
import { migrate, platformSources, type MigrationSource } from "@infrabyx/tenancy/migrate";

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
  /** Directory from which platform packages are resolved (default: this package). */
  resolveFrom?: string;
  image?: string;
}

export interface TestDatabase {
  url: string;
  /** Pool for the kernel; transactions assume app_rw through SET LOCAL ROLE. */
  pool: pg.Pool;
  /** Superuser client for fixtures and raw inspection; bypasses RLS. */
  admin: pg.Client;
  kernel: PgKernel;
  audit: PgAuditSink;
  end(): Promise<void>;
}

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function serverUrl(image: string): Promise<{ url: string; stop?: () => Promise<void> }> {
  const r = await validateEnv(testEnv, { guards: [], defaultAppEnv: "test" });
  const url = r.ok ? r.values.IPB_TEST_PG_URL : undefined;
  if (url) return { url };
  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
  const c = await new PostgreSqlContainer(image).start();
  return { url: c.getConnectionUri(), stop: async () => void (await c.stop()) };
}

export async function startPostgres(o: StartPostgresOptions = {}): Promise<TestDatabase> {
  const server = await serverUrl(o.image ?? "postgres:18");
  const name = `t_${toHex(randomBytes(6))}`;
  const root = new pg.Client({ connectionString: server.url });
  await root.connect();
  await root.query(`create database ${name}`);
  await root.end();
  const u = new URL(server.url);
  u.pathname = `/${name}`;
  const url = u.toString();
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const sources = [
    ...(o.platform === false ? [] : platformSources(o.resolveFrom ?? pkgRoot)),
    ...(o.migrations ?? []),
  ];
  await migrate({ client: admin, sources });
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
  return {
    url,
    pool,
    admin,
    kernel: new PgKernel({ pool }),
    audit: new PgAuditSink(),
    async end() {
      ending = true;
      await pool.end();
      await admin.end();
      const r = new pg.Client({ connectionString: server.url });
      await r.connect();
      await r.query(`drop database if exists ${name} with (force)`);
      await r.end();
      await server.stop?.();
    },
  };
}
