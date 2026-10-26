// FEATURE_FLAG alternative `config-db` (PL2 plan §6.4): the PL1 PostgreSQL provider on
// config.flag_value. It has no targeting, so a context is checked for hashed IDs and otherwise ignored.
import type {
  AdapterDescriptor,
  FeatureFlagManagement,
  FeatureFlagPort,
  FlagEvaluationContext,
  FlagSnapshot,
  FlagValue,
  PortHealth,
} from "@infrabyx/contracts/ports";
import { PgFlagProvider, type Queryable } from "@infrabyx/config/flags";
import { assertHashedContext } from "./context.js";

export class ConfigDbFlags implements FeatureFlagPort, FeatureFlagManagement {
  readonly descriptor: AdapterDescriptor = {
    port: "FEATURE_FLAG",
    adapter: "config-db",
    residency: "IN",
    maxDataClass: "INTERNAL",
    capabilities: { targeting: "unsupported" },
  };
  readonly provider: PgFlagProvider;

  constructor(db: Queryable) {
    this.provider = new PgFlagProvider(db);
  }

  health(): Promise<PortHealth> {
    return this.provider.health();
  }
  async getBooleanValue(key: string, def: boolean, ctx?: FlagEvaluationContext): Promise<boolean> {
    assertHashedContext("config-db", ctx);
    return this.provider.getBooleanValue(key, def);
  }
  async getStringValue(key: string, def: string, ctx?: FlagEvaluationContext): Promise<string> {
    assertHashedContext("config-db", ctx);
    return this.provider.getStringValue(key, def);
  }
  async getNumberValue(key: string, def: number, ctx?: FlagEvaluationContext): Promise<number> {
    assertHashedContext("config-db", ctx);
    return this.provider.getNumberValue(key, def);
  }
  async getObjectValue<T extends Record<string, unknown>>(
    key: string,
    def: T,
    ctx?: FlagEvaluationContext,
  ): Promise<T> {
    assertHashedContext("config-db", ctx);
    return this.provider.getObjectValue(key, def);
  }
  snapshot(): Promise<FlagSnapshot> {
    return this.provider.snapshot();
  }
  setValue(key: string, value: FlagValue, actor: string): Promise<void> {
    return this.provider.setValue(key, value, actor);
  }
  listFlags(prefix?: string): Promise<string[]> {
    return this.provider.listFlags(prefix);
  }
}
