// FEATURE_FLAG adapters used in PL1 (IPB-01 §01.4.4.2): in-memory (tests), file (local) and a
// PostgreSQL-backed provider (the fallback alternative). Unleash lands in PL2.
import { readFile, writeFile } from "node:fs/promises";
import type { PortHealth } from "@infrabyx/contracts/ports";
import type {
  FeatureFlagManagement,
  FeatureFlagPort,
  FlagEvaluationContext,
  FlagSnapshot,
  FlagValue,
} from "@infrabyx/contracts/ports";
import type { Tx } from "@infrabyx/contracts/kernel";

export class FlagProviderUnavailable extends Error {
  constructor(message = "flag provider unreachable") {
    super(message);
    this.name = "FlagProviderUnavailable";
  }
}

abstract class MapProvider implements FeatureFlagPort, FeatureFlagManagement {
  abstract readonly descriptor: FeatureFlagPort["descriptor"];
  protected abstract load(): Promise<Map<string, FlagValue>>;
  protected abstract store(values: Map<string, FlagValue>): Promise<void>;

  async health(): Promise<PortHealth> {
    const t = Date.now();
    try {
      await this.load();
      return { status: "up", latency_ms: Date.now() - t, checked_at: new Date().toISOString() };
    } catch {
      return { status: "down", latency_ms: Date.now() - t, checked_at: new Date().toISOString() };
    }
  }
  private async get<T extends FlagValue>(
    key: string,
    def: T,
    check: (v: FlagValue) => boolean,
  ): Promise<T> {
    const v = (await this.load()).get(key);
    return v !== undefined && check(v) ? (v as T) : def;
  }
  getBooleanValue(key: string, def: boolean, _ctx?: FlagEvaluationContext): Promise<boolean> {
    return this.get(key, def, (v) => typeof v === "boolean");
  }
  getStringValue(key: string, def: string, _ctx?: FlagEvaluationContext): Promise<string> {
    return this.get(key, def, (v) => typeof v === "string");
  }
  getNumberValue(key: string, def: number, _ctx?: FlagEvaluationContext): Promise<number> {
    return this.get(key, def, (v) => typeof v === "number");
  }
  getObjectValue<T extends Record<string, unknown>>(
    key: string,
    def: T,
    _ctx?: FlagEvaluationContext,
  ): Promise<T> {
    return this.get(key, def, (v) => typeof v === "object" && v !== null);
  }
  async snapshot(): Promise<FlagSnapshot> {
    return { values: Object.fromEntries(await this.load()), fetchedAt: new Date().toISOString() };
  }
  async setValue(key: string, value: FlagValue, _actor: string): Promise<void> {
    const m = await this.load();
    m.set(key, value);
    await this.store(m);
  }
  async listFlags(prefix = ""): Promise<string[]> {
    return [...(await this.load()).keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}

/** In-memory provider; `down = true` simulates an unreachable provider. */
export class MemoryFlagProvider extends MapProvider {
  readonly descriptor = {
    port: "FEATURE_FLAG",
    adapter: "memory",
    residency: "IN" as const,
    maxDataClass: "INTERNAL" as const,
  };
  down = false;
  private readonly values: Map<string, FlagValue>;
  constructor(initial: Record<string, FlagValue> = {}) {
    super();
    this.values = new Map(Object.entries(initial));
  }
  protected async load(): Promise<Map<string, FlagValue>> {
    if (this.down) throw new FlagProviderUnavailable();
    return this.values;
  }
  protected async store(): Promise<void> {}
}

/** JSON file provider for local development: `{ "kill.webhooks": false, ... }`. */
export class FileFlagProvider extends MapProvider {
  readonly descriptor = {
    port: "FEATURE_FLAG",
    adapter: "file",
    residency: "IN" as const,
    maxDataClass: "INTERNAL" as const,
  };
  constructor(private readonly path: string) {
    super();
  }
  protected async load(): Promise<Map<string, FlagValue>> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (e) {
      throw new FlagProviderUnavailable(
        `flag file ${this.path} unreadable: ${(e as Error).message}`,
      );
    }
    return new Map(Object.entries(JSON.parse(text) as Record<string, FlagValue>));
  }
  protected async store(values: Map<string, FlagValue>): Promise<void> {
    await writeFile(this.path, `${JSON.stringify(Object.fromEntries(values), null, 2)}\n`);
  }
}

/** Minimal query surface: a pool or a transaction. */
export interface Queryable {
  query<R = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

/**
 * PostgreSQL provider on config.flag_value (platform rows, no tenant data). Writes made through
 * `setValueInTx` join the caller's kernel transaction, so the ledger row and the flag change
 * commit together.
 */
export class PgFlagProvider extends MapProvider {
  readonly descriptor = {
    port: "FEATURE_FLAG",
    adapter: "postgres",
    residency: "IN" as const,
    maxDataClass: "INTERNAL" as const,
  };
  constructor(private readonly db: Queryable) {
    super();
  }
  protected async load(): Promise<Map<string, FlagValue>> {
    try {
      const r = await this.db.query<{ flag_key: string; value: FlagValue }>(
        "select flag_key, value from config.flag_value",
      );
      return new Map(r.rows.map((x) => [x.flag_key, x.value]));
    } catch (e) {
      throw new FlagProviderUnavailable((e as Error).message);
    }
  }
  protected async store(): Promise<void> {
    throw new Error("PgFlagProvider writes go through setValue/setValueInTx");
  }
  override async setValue(key: string, value: FlagValue, actor: string): Promise<void> {
    await upsertFlag(this.db, key, value, actor);
  }
  async setValueInTx(tx: Tx, key: string, value: FlagValue, actor: string): Promise<void> {
    await upsertFlag(tx, key, value, actor);
  }
}

async function upsertFlag(
  db: Queryable,
  key: string,
  value: FlagValue,
  actor: string,
): Promise<void> {
  await db.query(
    `insert into config.flag_value (flag_key, value, updated_by) values ($1, $2::jsonb, $3)
     on conflict (flag_key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
    [key, JSON.stringify(value), actor],
  );
}

/** Last-known-good snapshot store (IPB-01: snapshot ≤ 24 h). */
export interface FlagSnapshotStore {
  load(): Promise<FlagSnapshot | null>;
  save(s: FlagSnapshot): Promise<void>;
}

export class MemorySnapshotStore implements FlagSnapshotStore {
  constructor(private s: FlagSnapshot | null = null) {}
  async load(): Promise<FlagSnapshot | null> {
    return this.s;
  }
  async save(s: FlagSnapshot): Promise<void> {
    this.s = s;
  }
}

/** Snapshot rows in config.flag_snapshot. */
export class PgSnapshotStore implements FlagSnapshotStore {
  constructor(private readonly db: Queryable) {}
  async load(): Promise<FlagSnapshot | null> {
    const r = await this.db.query<{
      flag_key: string;
      value: FlagValue;
      fetched_at: Date | string;
    }>("select flag_key, value, fetched_at from config.flag_snapshot");
    if (r.rows.length === 0) return null;
    const oldest = r.rows.reduce(
      (m, x) => Math.min(m, new Date(x.fetched_at).getTime()),
      Number.POSITIVE_INFINITY,
    );
    return {
      values: Object.fromEntries(r.rows.map((x) => [x.flag_key, x.value])),
      fetchedAt: new Date(oldest).toISOString(),
    };
  }
  async save(s: FlagSnapshot): Promise<void> {
    const keys = Object.keys(s.values);
    await this.db.query(
      `insert into config.flag_snapshot (flag_key, value, fetched_at)
       select k, v, $3::timestamptz from unnest($1::text[], $2::jsonb[]) as t(k, v)
       on conflict (flag_key) do update set value = excluded.value, fetched_at = excluded.fetched_at`,
      [keys, keys.map((k) => JSON.stringify(s.values[k])), s.fetchedAt],
    );
  }
}
