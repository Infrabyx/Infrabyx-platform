// Settings tiers (IPB-07-38) and action risk classes (IPB-02 §02.4.6.1).
import { z } from "zod";

/** Registry tiers in precedence order: earlier tiers set floors/ceilings, later tiers override within them. */
export const SETTING_TIERS = ["PLATFORM", "PLAN", "BRAND", "TENANT", "ENTITY", "USER"] as const;
export const SettingTier = z.enum(SETTING_TIERS);
export type SettingTier = z.infer<typeof SettingTier>;

export const tierRank = (t: SettingTier): number => SETTING_TIERS.indexOf(t);

/** Display tiers used by the Settings tree (IPB-07 §07.4.2): USER / ORG / PLATFORM. */
export const DISPLAY_TIERS = ["USER", "ORG", "PLATFORM"] as const;
export type DisplayTier = (typeof DISPLAY_TIERS)[number];

export function displayTier(t: SettingTier): DisplayTier {
  if (t === "USER") return "USER";
  if (t === "TENANT" || t === "ENTITY") return "ORG";
  return "PLATFORM";
}

/** Action risk classes (IPB-02 §02.4.6.1). */
export const RISK_CLASSES = ["R0", "R1", "R2", "R3", "R4", "R5"] as const;
export const RiskClass = z.enum(RISK_CLASSES);
export type RiskClass = z.infer<typeof RiskClass>;

export interface RiskPolicy {
  /** Maker-checker requirement. `configurable` = tenant may require it (R2 publish). */
  makerChecker: "no" | "configurable" | "locked";
  /** Default delay between approval and execution, in minutes (0 = none). */
  defaultDelayMinutes: number;
  /** Minimum delay a tenant may set, in minutes. */
  minDelayMinutes: number;
  /** Whether an agent (AGT_*) may be the maker. */
  agentMayMake: boolean;
  /** Number of distinct checkers required. */
  checkers: number;
}

export const RISK_POLICY: Readonly<Record<RiskClass, RiskPolicy>> = Object.freeze({
  R0: {
    makerChecker: "no",
    defaultDelayMinutes: 0,
    minDelayMinutes: 0,
    agentMayMake: true,
    checkers: 0,
  },
  R1: {
    makerChecker: "no",
    defaultDelayMinutes: 0,
    minDelayMinutes: 0,
    agentMayMake: true,
    checkers: 0,
  },
  R2: {
    makerChecker: "configurable",
    defaultDelayMinutes: 0,
    minDelayMinutes: 0,
    agentMayMake: true,
    checkers: 1,
  },
  R3: {
    makerChecker: "locked",
    defaultDelayMinutes: 0,
    minDelayMinutes: 0,
    agentMayMake: true,
    checkers: 1,
  },
  R4: {
    makerChecker: "locked",
    defaultDelayMinutes: 60,
    minDelayMinutes: 60,
    agentMayMake: false,
    checkers: 1,
  },
  R5: {
    makerChecker: "locked",
    defaultDelayMinutes: 72 * 60,
    minDelayMinutes: 72 * 60,
    agentMayMake: false,
    checkers: 1,
  },
});

/** Tenant deletion: two checkers and a locked 7-day delay (IPB-02-80, §02.4.6.1). */
export const TENANT_DELETE_POLICY: RiskPolicy = Object.freeze({
  makerChecker: "locked",
  defaultDelayMinutes: 7 * 24 * 60,
  minDelayMinutes: 7 * 24 * 60,
  agentMayMake: false,
  checkers: 2,
});
export const TENANT_DELETE_ACTION = "tenancy.tenant.delete";
