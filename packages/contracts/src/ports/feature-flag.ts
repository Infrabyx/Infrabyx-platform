// FEATURE_FLAG port, OpenFeature-shaped (IPB-01 §01.4.4.2, IPB-09-24).
import type { Port } from "./common.js";

export interface FlagEvaluationContext {
  /** Hashed tenant id (IPB-01: flag contexts carry hashed ids). */
  tenantKey?: string;
  userKey?: string;
  env?: string;
  attributes?: Record<string, string | number | boolean>;
}

export type FlagValue = boolean | string | number | Record<string, unknown>;

export interface FlagSnapshot {
  values: Record<string, FlagValue>;
  fetchedAt: string;
}

export interface FeatureFlagPort extends Port {
  getBooleanValue(
    key: string,
    defaultValue: boolean,
    ctx?: FlagEvaluationContext,
  ): Promise<boolean>;
  getStringValue(key: string, defaultValue: string, ctx?: FlagEvaluationContext): Promise<string>;
  getNumberValue(key: string, defaultValue: number, ctx?: FlagEvaluationContext): Promise<number>;
  getObjectValue<T extends Record<string, unknown>>(
    key: string,
    defaultValue: T,
    ctx?: FlagEvaluationContext,
  ): Promise<T>;
  /** Full snapshot for last-known-good caching (IPB-01: snapshot ≤ 24 h). */
  snapshot(): Promise<FlagSnapshot>;
}

export interface FeatureFlagManagement {
  setValue(key: string, value: FlagValue, actor: string): Promise<void>;
  listFlags(prefix?: string): Promise<string[]>;
}
