// Integration-test database with every platform migration applied (tenancy, audit, config, seed).
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { randomBytes, toHex } from "@infrabyx/crypto";
import { migrate, platformSources } from "@infrabyx/tenancy/migrate";

const pkgRoot = join(fileURLToPath(import.meta.url), "../../..");

export async function freshDb() {
  const base = process.env.IPB_TEST_PG_URL;
  if (!base) throw new Error("IPB_TEST_PG_URL is required for integration tests");
  const name = `t_${toHex(randomBytes(6))}`;
  const root = new pg.Client({ connectionString: base });
  await root.connect();
  await root.query(`create database ${name}`);
  await root.end();
  const u = new URL(base);
  u.pathname = `/${name}`;
  const admin = new pg.Client({ connectionString: u.toString() });
  await admin.connect();
  const sources = [
    ...platformSources(pkgRoot, ["@infrabyx/tenancy", "@infrabyx/audit", "@infrabyx/config"]),
    { name: "@infrabyx/seed", dir: join(pkgRoot, "migrations") },
  ];
  await migrate({ client: admin, sources });
  const pool = new pg.Pool({ connectionString: u.toString(), max: 10 });
  return {
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
