// Integration-test database for audit: fresh database on IPB_TEST_PG_URL with the tenancy
// and audit migrations applied (@infrabyx/testing generalises this with Testcontainers).
import { copyFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { randomBytes, toHex } from "@infrabyx/crypto";
import { migrate, platformSources } from "@infrabyx/tenancy/migrate";

const pkgRoot = join(fileURLToPath(import.meta.url), "../../..");

/**
 * A fresh database. With `auditUpTo` (e.g. "0005"), the audit migrations stop after that file, so a
 * test can write the old way and then apply the rest with `migrateRest()` (PR-FBX-32's upgrade).
 */
export async function freshDb(o: { auditUpTo?: string } = {}) {
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
  const auditDir = join(pkgRoot, "migrations");
  let firstDir = auditDir;
  if (o.auditUpTo) {
    firstDir = mkdtempSync(join(tmpdir(), "audit-mig-"));
    for (const f of readdirSync(auditDir))
      if (f === "checksums.json" || f.slice(0, 4) <= o.auditUpTo)
        copyFileSync(join(auditDir, f), join(firstDir, f));
  }
  const sources = [
    ...platformSources(pkgRoot, ["@infrabyx/tenancy"]),
    { name: "@infrabyx/audit", dir: firstDir },
  ];
  // Roles are cluster-wide, and tenancy/0003 grants app_ro a role that 0004 revokes: fresh databases
  // on one server migrate one at a time, so no test sees another database's half-applied grants.
  await root.query("select pg_advisory_lock(hashtext('infrabyx:test-migrate'))");
  try {
    await migrate({ client: admin, sources });
  } finally {
    await root.end(); // the session's end releases the lock
  }
  const pool = new pg.Pool({ connectionString: u.toString(), max: 25 });
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
    /** Apply the audit migrations held back by `auditUpTo`. */
    async migrateRest() {
      await migrate({
        client: admin,
        sources: [
          ...platformSources(pkgRoot, ["@infrabyx/tenancy"]),
          { name: "@infrabyx/audit", dir: auditDir },
        ],
      });
    },
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
