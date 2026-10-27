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
  /** Roles that may change; "self" = the owning user; "pipeline"/"system" = no human writes. */
  change: readonly string[];
  mc: false | "R2" | "R4" | "R5";
  help?: string;
  /** Present for templated keys such as int.{port}.primary. */
  pattern?: string;
  source: string;
  note?: string;
}

/** Where a stored value applies. `scopeId` is the plan, brand, tenant, entity or user id; null for PLATFORM. */
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
  userId?: string;
}

export interface StoredSetting {
  key: string;
  tier: SettingTier;
  scopeId: string | null;
  value: unknown;
  version: number;
}
