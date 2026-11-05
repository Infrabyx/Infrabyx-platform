// Settings registry types (IPB-07 §07.3.3, §07.5).
import type { SettingTier } from "@infrabyx/contracts/tiers";

export type SettingType =
  | "bool"
  | "int"
  | "decimal"
  | "string"
  | "enum"
  | "string[]"
  | "enum[]"
  | "cidr[]"
  | "json"
  | "locale"
  | "route"
  | "time"
  | "range"
  | "date";

export type Tighten = "min" | "max" | "superset" | "subset" | true | false;

export interface SettingDef {
  key: string;
  tier: SettingTier;
  type: SettingType;
  default: unknown;
  values?: readonly string[];
  min?: number;
  max?: number;
  locked: boolean;
  tighten?: Tighten;
  userOverride: boolean;
  /**
   * The key may be set per organisation unit, department or function (UNIT, between ENTITY and
   * USER; PR-042). Declared per key (`unit_override` in settings-tree.yaml); off by default.
   */
  unitOverride?: boolean;
  /** Roles that may change; "self" = the owning user; "pipeline"/"system" = no human writes. */
  change: readonly string[];
  mc: false | "R2" | "R4" | "R5";
  /**
   * Bool keys only: turning the value from true to false needs maker-checker at this class, while
   * every other change applies directly (kill switches: activate at once, deactivate with a
   * checker; IPB-03-48, PL4 plan §3.5).
   */
  mcDeactivate?: "R2" | "R4";
  help?: string;
  /** Present for templated keys such as int.{port}.primary. */
  pattern?: string;
  source: string;
  note?: string;
}

/** Where a stored value applies. `scopeId` is the plan, brand, tenant, entity, unit or user id; null for PLATFORM. */
export interface SettingScopeRef {
  tier: SettingTier;
  scopeId: string | null;
}

/** The chain of scopes a read resolves through. */
export interface ResolutionScope {
  planId?: string;
  brandId?: string;
  tenantId?: string;
  entityId?: string;
  /** Organisation units, outermost first; an inner unit overrides an outer one. */
  unitIds?: readonly string[];
  userId?: string;
}

/** One change of a setting at one scope (config/0003; PR-LDC-17, R1-D-82). */
export interface SettingChange {
  id: string;
  /** The `settings.setting.change` ledger entry written in the same transaction. */
  ledgerId: string;
  key: string;
  tier: SettingTier;
  scopeId: string | null;
  /** Who made the change (the principal of the transaction that applied it). */
  actorId: string;
  /** When it was applied (ISO 8601, UTC). */
  at: string;
  /** The value at this scope before, or null when none was set there. */
  old: unknown;
  /** The value after, or null when the value at this scope was cleared. */
  new: unknown;
  /** The stored row's version after the change. */
  version: number;
  /** The approval request that carried it, when it was applied through maker-checker. */
  approvalRequestId: string | null;
}

export interface SettingHistoryPage {
  /** Newest first. */
  items: SettingChange[];
  /** Pass as `cursor` for the next (older) page; null when there is none. */
  nextCursor: string | null;
}

export interface StoredSetting {
  key: string;
  tier: SettingTier;
  scopeId: string | null;
  value: unknown;
  version: number;
}
