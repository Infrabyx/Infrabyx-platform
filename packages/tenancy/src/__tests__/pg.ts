// Integration-test database: a fresh database per call on the server named by
// IPB_TEST_PG_URL (CI provides a PostgreSQL 18 service with pgvector). @infrabyx/testing adds Testcontainers.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { randomBytes, toHex } from "@infrabyx/crypto";
import { migrate, type MigrationSource } from "../migrate/index.js";

const pkgRoot = join(fileURLToPath(import.meta.url), "../../..");
export const TENANCY_SOURCE: MigrationSource = {
  name: "@infrabyx/tenancy",
  dir: join(pkgRoot, "migrations"),
};

export interface TestDb {
  url: string;
  pool: pg.Pool;
  /** Superuser client for fixtures and raw inspection (bypasses RLS). */
  admin: pg.Client;
  end(): Promise<void>;
}

export async function freshDb(
  sources: readonly MigrationSource[] = [TENANCY_SOURCE],
): Promise<TestDb> {
  const base = process.env.IPB_TEST_PG_URL;
  if (!base) throw new Error("IPB_TEST_PG_URL is required for integration tests");
  const name = `t_${toHex(randomBytes(6))}`;
  const root = new pg.Client({ connectionString: base });
  await root.connect();
  await root.query(`create database ${name}`);
  await root.end();
  const u = new URL(base);
  u.pathname = `/${name}`;
  const url = u.toString();
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await migrate({ client: admin, sources });
  const pool = new pg.Pool({ connectionString: url, max: 25 });
  return {
    url,
    pool,
    admin,
    async end() {
      await pool.end();
      await admin.end();
      const r = new pg.Client({ connectionString: base });
      await r.connect();
      await r.query(`drop database if exists ${name} with (force)`);
      await r.end();
    },
  };
}
