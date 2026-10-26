// seed:purge (IPB-11-31): remove exactly the rows a profile created, newest first, in one
// transaction, as the migration identity. Refused in prod/dr/pre-prod. A non-seed row that
// references a seeded row makes the purge fail and roll back, leaving everything intact.
import type pg from "pg";
import { canonicalDigest, newId } from "@infrabyx/crypto";
import { assertSeedAllowed, type SeedEnv, type SeedProfile } from "./guard.js";

export interface PurgeResult {
  deleted: number;
  byTable: Record<string, number>;
}

const QUALIFIED = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;
const IDENT = /^[a-z_][a-z0-9_]*$/;

export async function purgeSeed(
  client: pg.Client | pg.PoolClient,
  env: SeedEnv,
  profile: SeedProfile,
): Promise<PurgeResult> {
  assertSeedAllowed(env);
  const result: PurgeResult = { deleted: 0, byTable: {} };
  await client.query("begin");
  try {
    const rows = await client.query<{
      ord: string;
      table_name: string;
      row_key: Record<string, unknown>;
    }>("select ord, table_name, row_key from seed.seed_row where profile = $1 order by ord desc", [
      profile,
    ]);
    for (const r of rows.rows) {
      if (!QUALIFIED.test(r.table_name)) throw new Error(`invalid table ${r.table_name}`);
      const cols = Object.keys(r.row_key);
      if (!cols.every((c) => IDENT.test(c))) throw new Error(`invalid key for ${r.table_name}`);
      const del = await client.query(
        `delete from ${r.table_name} where ${cols.map((c, i) => `${c} = $${i + 1}`).join(" and ")}`,
        cols.map((c) => r.row_key[c]),
      );
      result.deleted += del.rowCount ?? 0;
      result.byTable[r.table_name] = (result.byTable[r.table_name] ?? 0) + (del.rowCount ?? 0);
    }
    await client.query("delete from seed.seed_row where profile = $1", [profile]);
    // Ledger the purge in the platform tenant chain, in the same transaction (NN-45).
    await client.query(
      "select set_config('app.tenant_id', 'tnt_platform', true), set_config('app.actor_id', 'svc_seed', true)",
    );
    await client.query(
      `insert into audit.ledger (id, tenant_id, seq, actor_id, actor_type, action, resource_type, resource_id, after_digest, occurred_at, prev_hash, entry_hash)
       values ($1, 'tnt_platform', 0, 'svc_seed', 'service', 'seed.profile.purge', 'seed_profile', $2, $3, now(), repeat('0', 64), repeat('0', 64))`,
      [newId("led"), profile, canonicalDigest(result.byTable)],
    );
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
}
