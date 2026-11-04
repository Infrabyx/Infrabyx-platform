// Settings stores. PgSettingsStore runs inside kernel transactions (RLS applies through SET LOCAL);
// MemorySettingsStore is for unit tests.
import type { Tx } from "@infrabyx/contracts/kernel";
import { newId } from "@infrabyx/crypto";
import type { SettingTier } from "@infrabyx/contracts/tiers";
import type { SettingChange, SettingHistoryPage, SettingScopeRef, StoredSetting } from "./types.js";

export interface SettingWrite {
  key: string;
  tier: SettingTier;
  scopeId: string | null;
  /** Tenant the row belongs to (null for PLATFORM, PLAN and BRAND rows). */
  tenantId: string | null;
  value: unknown;
  actorId: string;
}

/** A change to keep in the history, written in the same transaction as the value and the ledger. */
export interface SettingChangeWrite extends Omit<SettingChange, "id" | "at"> {
  /** Tenant the change belongs to (null for PLATFORM, PLAN and BRAND). */
  tenantId: string | null;
}

export interface SettingHistoryQuery extends SettingScopeRef {
  key: string;
  /** 1 to MAX_HISTORY_PAGE. */
  limit: number;
  /** A `nextCursor` from the previous page. */
  cursor?: string;
}

export const MAX_HISTORY_PAGE = 100;
const CURSOR = /^[1-9]\d{0,17}$/;

/** A history cursor as a number, or a RangeError for one this store did not hand out. */
export function historyCursor(cursor: string | undefined): number | undefined {
  if (cursor === undefined) return undefined;
  if (!CURSOR.test(cursor)) throw new RangeError("invalid history cursor");
  return Number(cursor);
}

export interface SettingsStore {
  read(tx: Tx | null, key: string, refs: readonly SettingScopeRef[]): Promise<StoredSetting[]>;
  /** Upsert (or delete when value is null); returns the previous value. */
  write(tx: Tx | null, w: SettingWrite): Promise<{ old: unknown; version: number }>;
  /** Keep a change in the per-value history (PR-LDC-17, R1-D-82); a store without it keeps none. */
  appendChange?(tx: Tx | null, c: SettingChangeWrite): Promise<void>;
  /** The changes of one key at one scope, newest first. */
  history?(tx: Tx | null, q: SettingHistoryQuery): Promise<SettingHistoryPage>;
}

export class MemorySettingsStore implements SettingsStore {
  private readonly rows = new Map<string, StoredSetting>();
  private readonly changes: (SettingChange & { seq: number })[] = [];
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
  async appendChange(_tx: Tx | null, c: SettingChangeWrite): Promise<void> {
    const { tenantId: _tenant, ...change } = c;
    const seq = this.changes.length + 1;
    this.changes.push({ ...change, id: newId("sch"), at: new Date().toISOString(), seq });
  }
  async history(_tx: Tx | null, q: SettingHistoryQuery): Promise<SettingHistoryPage> {
    const before = historyCursor(q.cursor) ?? Number.MAX_SAFE_INTEGER;
    const hits = this.changes
      .filter(
        (c) => c.key === q.key && c.tier === q.tier && c.scopeId === q.scopeId && c.seq < before,
      )
      .reverse();
    const page = hits.slice(0, q.limit);
    const more = hits.length > q.limit;
    return {
      items: page.map(({ seq: _seq, ...c }) => c),
      nextCursor: more ? String(page.at(-1)!.seq) : null,
    };
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

  /** Into config.setting_change (migrations/0003), insert-only under forced RLS. */
  async appendChange(tx: Tx | null, c: SettingChangeWrite): Promise<void> {
    if (!tx) throw new Error("PgSettingsStore needs a transaction");
    await tx.query(
      `insert into config.setting_change
         (id, ledger_id, key, tier, scope_id, tenant_id, old_value, new_value, version, actor_id,
          mc_request_id)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)`,
      [
        newId("sch"),
        c.ledgerId,
        c.key,
        c.tier,
        c.scopeId,
        c.tenantId,
        c.old === null || c.old === undefined ? null : JSON.stringify(c.old),
        c.new === null || c.new === undefined ? null : JSON.stringify(c.new),
        c.version,
        c.actorId,
        c.approvalRequestId,
      ],
    );
  }

  async history(tx: Tx | null, q: SettingHistoryQuery): Promise<SettingHistoryPage> {
    if (!tx) throw new Error("PgSettingsStore needs a transaction");
    const before = historyCursor(q.cursor);
    const r = await tx.query<{
      seq: string;
      id: string;
      ledger_id: string;
      key: string;
      tier: SettingTier;
      scope_id: string | null;
      actor_id: string;
      changed_at: Date;
      old_value: unknown;
      new_value: unknown;
      version: number;
      mc_request_id: string | null;
    }>(
      `select seq::text as seq, id, ledger_id, key, tier, scope_id, actor_id, changed_at, old_value,
              new_value, version, mc_request_id
         from config.setting_change
        where key = $1 and tier = $2 and scope_id is not distinct from $3
          and ($4::bigint is null or seq < $4::bigint)
        order by seq desc
        limit $5`,
      [q.key, q.tier, q.scopeId, before ?? null, q.limit + 1],
    );
    const page = r.rows.slice(0, q.limit);
    return {
      items: page.map((c) => ({
        id: c.id,
        ledgerId: c.ledger_id,
        key: c.key,
        tier: c.tier,
        scopeId: c.scope_id,
        actorId: c.actor_id,
        at: c.changed_at.toISOString(),
        old: c.old_value ?? null,
        new: c.new_value ?? null,
        version: c.version,
        approvalRequestId: c.mc_request_id,
      })),
      nextCursor: r.rows.length > q.limit ? page.at(-1)!.seq : null,
    };
  }
}
