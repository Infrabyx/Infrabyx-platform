// Flag evaluation with last-known-good snapshot and kill-switch safe state (IPB-02-83, IPB-09-26).
import type {
  FeatureFlagPort,
  FlagEvaluationContext,
  FlagSnapshot,
} from "@infrabyx/contracts/ports";
import { defaultFlagRegistry, type FlagDef, type FlagKey, type FlagRegistry } from "./registry.js";
import type { FlagSnapshotStore } from "./providers.js";

export const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** One operations alert per flag key per window while the provider stays unreachable (PL3-D-13). */
export const ALERT_THROTTLE_MS = 5 * 60 * 1000;

export type FlagSource = "locked" | "provider" | "snapshot" | "safe-state" | "default";

export interface FlagEvaluation {
  key: string;
  value: boolean;
  source: FlagSource;
}

export interface FlagServiceOptions {
  provider: FeatureFlagPort;
  snapshots?: FlagSnapshotStore;
  registry?: FlagRegistry;
  /** Product code for product-qualified defaults (IPB-12 §12.5 "ON (UDF)"). */
  product?: string;
  now?: () => number;
  /** Called when a flag is served from the snapshot or safe state (console banner, IPB-09-AT-10). */
  onDegraded?: (e: FlagEvaluation, cause: unknown) => void;
  /**
   * Operations alert `ops.flags.provider_unreachable` (PL3-D-13), throttled per key. Wire it to the
   * OBSERVABILITY port or the `FlagProviderUnreachable` event; it carries flag keys only.
   */
  onAlert?: (a: FlagAlert) => void;
}

export interface FlagAlert {
  alert: "ops.flags.provider_unreachable";
  /** The flag being evaluated, or "*" when boot found the provider down. */
  key: string;
  servedFrom: "snapshot" | "safe-state" | "default" | "none";
  /** Age of the snapshot used, or null when none was usable. */
  snapshotAgeS: number | null;
  cause: unknown;
}

export class FlagService {
  private readonly o: FlagServiceOptions;
  private readonly registry: FlagRegistry;
  private cached: FlagSnapshot | null = null;
  private readonly alerted = new Map<string, number>();

  constructor(opts: FlagServiceOptions) {
    this.o = opts;
    this.registry = opts.registry ?? defaultFlagRegistry;
  }

  /** Typed boolean read; an unregistered key fails typecheck and throws IPB-ENG-008. */
  async isOn(key: FlagKey, ctx?: FlagEvaluationContext): Promise<boolean> {
    return (await this.evaluate(key, ctx)).value;
  }

  async evaluate(key: string, ctx?: FlagEvaluationContext): Promise<FlagEvaluation> {
    const def = this.registry.require(key);
    const fallback = this.defaultFor(def);
    if (def.locked) return { key, value: def.default, source: "locked" };
    // kill.* never take per-tenant overrides (IPB-09-27): evaluate without tenant or user keys.
    const evalCtx = def.kind === "kill" ? (ctx?.env ? { env: ctx.env } : undefined) : ctx;
    try {
      return {
        key,
        value: await this.o.provider.getBooleanValue(key, fallback, evalCtx),
        source: "provider",
      };
    } catch (cause) {
      const snap = await this.lastKnownGood();
      const v = snap?.values[key];
      const result: FlagEvaluation =
        typeof v === "boolean"
          ? { key, value: v, source: "snapshot" }
          : def.kind === "kill"
            ? { key, value: true, source: "safe-state" }
            : { key, value: fallback, source: "default" };
      this.o.onDegraded?.(result, cause);
      this.alert(key, result.source as FlagAlert["servedFrom"], snap, cause);
      return result;
    }
  }

  /**
   * Call once at startup, before the service reports ready (PL3-D-13). Fetches a snapshot from the
   * provider and persists it; when the provider is down, loads the persisted snapshot instead, so
   * after the first boot an evaluation always has a snapshot to fall back to (within 24 h).
   */
  async boot(): Promise<"provider" | "snapshot" | "none"> {
    try {
      await this.refreshSnapshot();
      return "provider";
    } catch (cause) {
      const s = await this.o.snapshots?.load().catch(() => null);
      if (s) this.cached = s;
      this.alert("*", s ? "snapshot" : "none", s ?? null, cause);
      return s ? "snapshot" : "none";
    }
  }

  /** Fetch a fresh snapshot from the provider and persist it; call on a schedule. */
  async refreshSnapshot(): Promise<FlagSnapshot> {
    const s = await this.o.provider.snapshot();
    this.cached = s;
    await this.o.snapshots?.save(s);
    return s;
  }

  private async lastKnownGood(): Promise<FlagSnapshot | null> {
    const s = this.cached ?? (await this.o.snapshots?.load().catch(() => null)) ?? null;
    if (!s) return null;
    const age = (this.o.now?.() ?? Date.now()) - Date.parse(s.fetchedAt);
    return age <= SNAPSHOT_MAX_AGE_MS ? s : null;
  }

  private alert(
    key: string,
    servedFrom: FlagAlert["servedFrom"],
    snap: FlagSnapshot | null,
    cause: unknown,
  ): void {
    if (!this.o.onAlert) return;
    const now = this.o.now?.() ?? Date.now();
    const last = this.alerted.get(key);
    if (last !== undefined && now - last < ALERT_THROTTLE_MS) return;
    this.alerted.set(key, now);
    const snapshotAgeS = snap
      ? Math.max(0, Math.floor((now - Date.parse(snap.fetchedAt)) / 1000))
      : null;
    this.o.onAlert({
      alert: "ops.flags.provider_unreachable",
      key,
      servedFrom,
      snapshotAgeS,
      cause,
    });
  }

  private defaultFor(def: FlagDef): boolean {
    const p = this.o.product?.toUpperCase();
    return (p !== undefined ? def.productDefaults?.[p] : undefined) ?? def.default;
  }
}
