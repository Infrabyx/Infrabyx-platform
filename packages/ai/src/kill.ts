// Kill switches (IPB-03-48, 03-49; PL4 plan §3.5). The switches are settings keys: `ai.kill.all`,
// `ai.kill.adapter.<key>`, `ai.kill.feature.<key>` and `ai.kill.tenant`, plus the tenant's
// `ai.enabled`. They turn on at once and turn off only through a checker (`mc_deactivate` in the
// settings registry). Reads are cached for at most 30 seconds, so a change reaches every gateway
// instance within 60 seconds. A switch that cannot be read and was never read counts as on.
import type { KernelContext } from "@infrabyx/contracts/kernel";

/** The slice of `SettingsService` the gateway reads. */
export interface SettingsReader {
  get(ctx: KernelContext, key: string): Promise<unknown>;
}

/** `ld.summarise_document` → `ld_summarise_document`: the `{feature}`/`{key}` segment of a key. */
export const keySegment = (s: string): string => s.toLowerCase().replace(/[^a-z0-9_-]/g, "_");

export interface KillState {
  /** The first switch found on, or null. `ai.enabled=false` reports as `ai.enabled`. */
  on: string | null;
}

export class KillSwitches {
  private readonly cache = new Map<string, { at: number; value: boolean }>();
  constructor(
    private readonly settings: SettingsReader,
    private readonly o: { cacheSeconds?: number; now?: () => number } = {},
  ) {}

  private async flag(ctx: KernelContext, key: string, onWhen: boolean): Promise<boolean> {
    const now = (this.o.now ?? Date.now)();
    const ttl = (this.o.cacheSeconds ?? 30) * 1000;
    const ck = `${ctx.tenantId}|${key}`;
    const hit = this.cache.get(ck);
    if (hit && now - hit.at < ttl) return hit.value;
    try {
      const v = (await this.settings.get(ctx, key)) === onWhen;
      this.cache.set(ck, { at: now, value: v });
      return v;
    } catch {
      // Unreadable: keep the last value; with none, fail closed (IPB-03-20).
      return hit ? hit.value : true;
    }
  }

  /** Gateway-level switches for this tenant and feature (IPB-AI-001 when one is on). */
  async gateway(ctx: KernelContext, featureKey: string): Promise<KillState> {
    if (await this.flag(ctx, "ai.enabled", false)) return { on: "ai.enabled" };
    for (const key of [
      "ai.kill.all",
      "ai.kill.tenant",
      `ai.kill.feature.${keySegment(featureKey)}`,
    ])
      if (await this.flag(ctx, key, true)) return { on: key };
    return { on: null };
  }

  /** True when the provider-level switch for an adapter is on (IPB-03-49). */
  async adapterKilled(ctx: KernelContext, adapterKey: string): Promise<boolean> {
    return this.flag(ctx, `ai.kill.adapter.${keySegment(adapterKey)}`, true);
  }

  /** Forget cached values (on a SettingChanged signal for an `ai.kill.*` key). */
  invalidate(): void {
    this.cache.clear();
  }
}
