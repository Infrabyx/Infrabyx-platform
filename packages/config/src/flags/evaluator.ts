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
/**
 * Escalation points of the provider-unreachable alert, measured from the last provider contact
 * (OWNER-QUESTIONS #20, PL3-D-17): operations hear at 1 h and again at 12 h, well before the
 * 24 h snapshot limit turns the kill switches on.
 */
export const ALERT_ESCALATIONS = [
  { level: "1h", afterMs: 60 * 60 * 1000 },
  { level: "12h", afterMs: 12 * 60 * 60 * 1000 },
] as const;
export type AlertEscalation = (typeof ALERT_ESCALATIONS)[number]["level"];

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
  /** Seconds since the last provider contact (the newest snapshot, or the first failure). */
  outageS: number;
  /**
   * Set once per outage when the outage passes 1 h and again at 12 h (PL3-D-17). An escalation
   * alert is never throttled and carries key "*".
   */
  escalation?: AlertEscalation;
  cause: unknown;
}

export class FlagService {
  private readonly o: FlagServiceOptions;
  private readonly registry: FlagRegistry;
  private cached: FlagSnapshot | null = null;
  private readonly alerted = new Map<string, number>();
  /** Last successful provider read, or the fetch time of the newest snapshot seen (ms). */
  private lastContact: number | null = null;
  private readonly escalated = new Set<AlertEscalation>();

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
      const value = await this.o.provider.getBooleanValue(key, fallback, evalCtx);
      this.contact(this.now());
      return { key, value, source: "provider" };
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
      if (s) {
        this.cached = s;
        this.lastContact = Date.parse(s.fetchedAt);
      }
      this.alert("*", s ? "snapshot" : "none", s ?? null, cause);
      return s ? "snapshot" : "none";
    }
  }

  /** Fetch a fresh snapshot from the provider and persist it; call on a schedule. */
  async refreshSnapshot(): Promise<FlagSnapshot> {
    const s = await this.o.provider.snapshot();
    this.contact(this.now());
    this.cached = s;
    await this.o.snapshots?.save(s);
    return s;
  }

  private async lastKnownGood(): Promise<FlagSnapshot | null> {
    const s = this.cached ?? (await this.o.snapshots?.load().catch(() => null)) ?? null;
    if (!s) return null;
    const fetched = Date.parse(s.fetchedAt);
    // A persisted snapshot dates the last provider contact across a restart during an outage.
    if (this.lastContact === null || fetched > this.lastContact) this.lastContact = fetched;
    return this.now() - fetched <= SNAPSHOT_MAX_AGE_MS ? s : null;
  }

  private now(): number {
    return this.o.now?.() ?? Date.now();
  }

  private contact(at: number): void {
    this.lastContact = at;
    this.escalated.clear();
  }

  private alert(
    key: string,
    servedFrom: FlagAlert["servedFrom"],
    snap: FlagSnapshot | null,
    cause: unknown,
  ): void {
    if (!this.o.onAlert) return;
    const now = this.now();
    this.lastContact ??= now;
    const outageMs = Math.max(0, now - this.lastContact);
    const outageS = Math.floor(outageMs / 1000);
    const snapshotAgeS = snap
      ? Math.max(0, Math.floor((now - Date.parse(snap.fetchedAt)) / 1000))
      : null;
    const base = { alert: "ops.flags.provider_unreachable" as const, servedFrom, snapshotAgeS };
    for (const e of ALERT_ESCALATIONS) {
      if (outageMs < e.afterMs || this.escalated.has(e.level)) continue;
      this.escalated.add(e.level);
      this.o.onAlert({ ...base, key: "*", outageS, escalation: e.level, cause });
    }
    const last = this.alerted.get(key);
    if (last !== undefined && now - last < ALERT_THROTTLE_MS) return;
    this.alerted.set(key, now);
    this.o.onAlert({ ...base, key, outageS, cause });
  }

  private defaultFor(def: FlagDef): boolean {
    const p = this.o.product?.toUpperCase();
    return (p !== undefined ? def.productDefaults?.[p] : undefined) ?? def.default;
  }
}
