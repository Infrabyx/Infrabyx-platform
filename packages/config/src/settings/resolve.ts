// Scope precedence PLATFORM → PLAN → BRAND → TENANT → ENTITY → UNIT → USER (IPB-07-38, amended for
// PR-042: UNIT is an organisation unit, department or function; several units resolve outermost
// first, so the innermost wins).
import { SETTING_TIERS, tierRank, type SettingTier } from "@infrabyx/contracts/tiers";
import type { ResolutionScope, SettingDef, SettingScopeRef, StoredSetting } from "./types.js";
import { boundsError, tightenError, typeError } from "./validate.js";

/** Whether a value may be stored for `def` at `tier`. */
export function tierAllowed(def: SettingDef, tier: SettingTier): boolean {
  // UNIT only for a key that declares it, and only below the tenant (a TENANT, ENTITY or USER key).
  if (tier === "UNIT") return def.unitOverride === true && tierRank(def.tier) >= tierRank("TENANT");
  if (tier === "USER" && def.tier !== "USER") return def.userOverride;
  return tierRank(tier) <= tierRank(def.tier);
}

/** The scope references a read consults, in precedence order. */
export function scopeChain(scope: ResolutionScope): SettingScopeRef[] {
  const refs: SettingScopeRef[] = [{ tier: "PLATFORM", scopeId: null }];
  if (scope.planId) refs.push({ tier: "PLAN", scopeId: scope.planId });
  if (scope.brandId) refs.push({ tier: "BRAND", scopeId: scope.brandId });
  if (scope.tenantId) refs.push({ tier: "TENANT", scopeId: scope.tenantId });
  if (scope.entityId) refs.push({ tier: "ENTITY", scopeId: scope.entityId });
  for (const u of scope.unitIds ?? []) refs.push({ tier: "UNIT", scopeId: u });
  if (scope.userId) refs.push({ tier: "USER", scopeId: scope.userId });
  return refs;
}

export interface Resolution {
  value: unknown;
  /** Tier that supplied the value, or "default". */
  from: SettingTier | "default";
  /** Stored rows ignored because they would loosen a floor (should not exist; writes refuse them). */
  ignored: Array<{ tier: SettingTier; reason: string }>;
}

/** Resolve a value; `upTo` stops before a tier (used to find what a write at that tier inherits). */
export function resolve(
  def: SettingDef,
  rows: readonly StoredSetting[],
  upTo?: SettingTier,
): Resolution {
  let value: unknown = def.default ?? null;
  let from: Resolution["from"] = "default";
  const ignored: Resolution["ignored"] = [];
  if (def.locked) return { value, from, ignored };
  // Stable: rows of one tier (several units) keep the order they were given in, outermost first.
  const ordered = [...rows].sort((a, b) => tierRank(a.tier) - tierRank(b.tier));
  for (const r of ordered) {
    if (upTo && tierRank(r.tier) >= tierRank(upTo)) break;
    if (!tierAllowed(def, r.tier) || r.value === null) continue;
    const why =
      typeError(def, r.value) ?? boundsError(def, r.value) ?? tightenError(def, value, r.value);
    if (why) {
      ignored.push({ tier: r.tier, reason: why });
      continue;
    }
    value = r.value;
    from = r.tier;
  }
  return { value, from, ignored };
}

/** `rows` in the order of `refs` (the scope chain), so several UNIT rows resolve outermost first. */
export function inChainOrder(
  rows: readonly StoredSetting[],
  refs: readonly SettingScopeRef[],
): StoredSetting[] {
  const at = (r: StoredSetting) =>
    refs.findIndex((x) => x.tier === r.tier && x.scopeId === r.scopeId);
  return [...rows].sort((a, b) => at(a) - at(b));
}

const UNIT_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_UNITS = 8;

/** The caller's unit chain, checked: at most 8 distinct ids of 1 to 64 of [A-Za-z0-9_-]. */
export function unitChain(unitIds: readonly string[] | undefined): string[] {
  const ids = [...(unitIds ?? [])];
  if (ids.length > MAX_UNITS) throw new RangeError(`at most ${MAX_UNITS} organisation units`);
  if (ids.some((u) => typeof u !== "string" || !UNIT_ID.test(u)))
    throw new RangeError("a unit id is 1 to 64 of [A-Za-z0-9_-]");
  if (new Set(ids).size !== ids.length) throw new RangeError("a unit appears twice in the chain");
  return ids;
}

export const TIERS = SETTING_TIERS;
