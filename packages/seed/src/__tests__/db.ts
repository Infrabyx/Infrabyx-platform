// Integration-test database with every platform migration applied (tenancy, audit, config, seed, connectors).
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
  const u = new URL(base);
  u.pathname = `/${name}`;
  const admin = new pg.Client({ connectionString: u.toString() });
  await admin.connect();
  const sources = [
    ...platformSources(pkgRoot, ["@infrabyx/tenancy", "@infrabyx/audit", "@infrabyx/config"]),
    { name: "@infrabyx/seed", dir: join(pkgRoot, "migrations") },
  ];
  // Roles are cluster-wide, and tenancy/0003 grants app_ro a role that 0004 revokes: fresh databases
  // on one server migrate one at a time, so no test sees another database's half-applied grants.
  await root.query("select pg_advisory_lock(hashtext('infrabyx:test-migrate'))");
  try {
    await migrate({ client: admin, sources });
  } finally {
    await root.end(); // the session's end releases the lock
  }
  const pool = new pg.Pool({ connectionString: u.toString(), max: 10 });
  // As in @infrabyx/testing `startPostgres`: `drop database … with (force)` in `end()` can reach a
  // client whose socket is still closing; the server's 57P01 ("terminating connection due to
  // administrator command") is then expected and must not surface as an unhandled error. Any
  // other error still does.
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
    pool,
    admin,
    async end() {
      ending = true;
      await pool.end();
      await admin.end();
      const r = new pg.Client({ connectionString: base });
      await r.connect();
      await r.query(`drop database if exists ${name} with (force)`);
      await r.end();
    },
  };
}
