// Scope precedence PLATFORM → PLAN → BRAND → TENANT → ENTITY → USER (IPB-07-38).
import { SETTING_TIERS, tierRank, type SettingTier } from "@infrabyx/contracts/tiers";
import type { ResolutionScope, SettingDef, SettingScopeRef, StoredSetting } from "./types.js";
import { boundsError, tightenError, typeError } from "./validate.js";

/** Whether a value may be stored for `def` at `tier`. */
export function tierAllowed(def: SettingDef, tier: SettingTier): boolean {
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

export const TIERS = SETTING_TIERS;
