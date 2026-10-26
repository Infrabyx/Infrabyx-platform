// Settings stores. PgSettingsStore runs inside kernel transactions (RLS applies through SET LOCAL);
// MemorySettingsStore is for unit tests.
import type { Tx } from "@infrabyx/contracts/kernel";
import { newId } from "@infrabyx/crypto";
import type { SettingTier } from "@infrabyx/contracts/tiers";
import type { SettingScopeRef, StoredSetting } from "./types.js";

export interface SettingWrite {
  key: string;
  tier: SettingTier;
  scopeId: string | null;
  /** Tenant the row belongs to (null for PLATFORM, PLAN and BRAND rows). */
  tenantId: string | null;
  value: unknown;
  actorId: string;
}

export interface SettingsStore {
  read(tx: Tx | null, key: string, refs: readonly SettingScopeRef[]): Promise<StoredSetting[]>;
  /** Upsert (or delete when value is null); returns the previous value. */
  write(tx: Tx | null, w: SettingWrite): Promise<{ old: unknown; version: number }>;
}

export class MemorySettingsStore implements SettingsStore {
  private readonly rows = new Map<string, StoredSetting>();
  private id(key: string, tier: string, scopeId: string | null): string {
    return `${key}\u0000${tier}\u0000${scopeId ?? ""}`;
  }
  async read(
    _tx: Tx | null,
    key: string,
    refs: readonly SettingScopeRef[],
  ): Promise<StoredSetting[]> {
    return refs
      .map((r) => this.rows.get(this.id(key, r.tier, r.scopeId)))
      .filter((r): r is StoredSetting => r !== undefined);
  }
  async write(_tx: Tx | null, w: SettingWrite): Promise<{ old: unknown; version: number }> {
    const id = this.id(w.key, w.tier, w.scopeId);
    const prev = this.rows.get(id);
    const version = (prev?.version ?? 0) + 1;
    if (w.value === null) this.rows.delete(id);
    else
      this.rows.set(id, { key: w.key, tier: w.tier, scopeId: w.scopeId, value: w.value, version });
    return { old: prev?.value ?? null, version };
  }
}

/** Store on table config.setting_value (migrations/0001_config.sql). */
export class PgSettingsStore implements SettingsStore {
  async read(
    tx: Tx | null,
    key: string,
    refs: readonly SettingScopeRef[],
  ): Promise<StoredSetting[]> {
    if (!tx) throw new Error("PgSettingsStore needs a transaction");
    if (refs.length === 0) return [];
    const tiers = refs.map((r) => r.tier);
    const scopes = refs.map((r) => r.scopeId ?? "");
    const res = await tx.query<{
      key: string;
      tier: SettingTier;
      scope_id: string | null;
      value: unknown;
      version: number;
    }>(
      `select key, tier, scope_id, value, version
         from config.setting_value
        where key = $1
          and (tier, coalesce(scope_id, '')) in (select * from unnest($2::text[], $3::text[]))`,
      [key, tiers, scopes],
    );
    return res.rows.map((r) => ({
      key: r.key,
      tier: r.tier,
      scopeId: r.scope_id,
      value: r.value,
      version: r.version,
    }));
  }

  async write(tx: Tx | null, w: SettingWrite): Promise<{ old: unknown; version: number }> {
    if (!tx) throw new Error("PgSettingsStore needs a transaction");
    const prev = await tx.query<{ value: unknown; version: number }>(
      `select value, version from config.setting_value
        where key = $1 and tier = $2 and scope_id is not distinct from $3
        for update`,
      [w.key, w.tier, w.scopeId],
    );
    const old = prev.rows[0]?.value ?? null;
    const version = (prev.rows[0]?.version ?? 0) + 1;
    if (w.value === null) {
      await tx.query(
        `delete from config.setting_value where key = $1 and tier = $2 and scope_id is not distinct from $3`,
        [w.key, w.tier, w.scopeId],
      );
    } else {
      await tx.query(
        `insert into config.setting_value (id, key, tier, scope_id, tenant_id, value, version, updated_by)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
         on conflict (key, tier, scope_id) do update
           set value = excluded.value, version = excluded.version, updated_by = excluded.updated_by, updated_at = now()`,
        [
          newId("set"),
          w.key,
          w.tier,
          w.scopeId,
          w.tenantId,
          JSON.stringify(w.value),
          version,
          w.actorId,
        ],
      );
    }
    return { old, version };
  }
}
