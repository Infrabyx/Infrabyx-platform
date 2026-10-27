// Data-class and provider routing (IPB-03-18 to 03-24, §03.4.5; PL4 plan §4.3). The router turns a
// request's band, capabilities and pin into an ordered list of models that are each allowed to
// see the data, served by a healthy adapter of the right residency, and not switched off. It never
// widens eligibility: no candidate means `IPB-AI-021` (fail closed). Failover stays in the band.
import { IpbError } from "@infrabyx/contracts/errors";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { AiAdapterDescriptor, ModelCapability, RoutingBand } from "@infrabyx/contracts";
import { keySegment, type KillSwitches, type SettingsReader } from "./kill.js";
import { eligibility, type DefaultRef, type ModelRecord } from "./registry.js";

/** Any AI adapter: what routing needs to know about it. */
export interface RoutableAdapter {
  readonly descriptor: AiAdapterDescriptor;
  capabilities(): readonly ModelCapability[];
}

/**
 * Why an adapter may not serve at all (IPB-03-23): the observed region differs from the
 * configured one (`BLOCKED_CONFIG`), or the adapter's residency differs from the model record's.
 */
export function adapterBlock(a: RoutableAdapter, m: ModelRecord): string | null {
  const d = a.descriptor;
  if (d.region !== d.observedRegion)
    return `BLOCKED_CONFIG: region ${d.observedRegion ?? "unknown"} ≠ configured ${d.region ?? "none"}`;
  if (d.aiResidency !== m.residency)
    return `adapter residency ${d.aiResidency} ≠ model residency ${m.residency}`;
  return null;
}

const read = async (v: number | (() => Promise<number> | number)): Promise<number> =>
  typeof v === "number" ? v : v();

/** Per-process circuit breaker per model (IPB-03-21; PL4-D-01 A-05). */
export class Breaker {
  private readonly failures = new Map<string, number[]>();
  private readonly openUntil = new Map<string, number>();
  constructor(
    private readonly o: {
      failures: number | (() => Promise<number> | number);
      windowSeconds: number | (() => Promise<number> | number);
      now?: () => number;
    },
  ) {}

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  /** Open: refuse. After the window it half-opens and lets one call through. */
  isOpen(modelId: string): boolean {
    const until = this.openUntil.get(modelId);
    if (until === undefined) return false;
    if (this.now() < until) return true;
    this.openUntil.delete(modelId); // half-open: the next result decides
    this.failures.set(modelId, []);
    return false;
  }

  async failure(modelId: string): Promise<boolean> {
    const window = (await read(this.o.windowSeconds)) * 1000;
    const t = this.now();
    const list = (this.failures.get(modelId) ?? []).filter((x) => t - x < window);
    list.push(t);
    this.failures.set(modelId, list);
    if (list.length >= (await read(this.o.failures))) {
      this.openUntil.set(modelId, t + window);
      return true;
    }
    return false;
  }

  success(modelId: string): void {
    this.failures.delete(modelId);
    this.openUntil.delete(modelId);
  }
}

export interface RouteInput {
  featureKey: string;
  band: RoutingBand;
  capabilities: readonly ModelCapability[];
  /** The primary capability whose DEFAULT row orders the fallback list. */
  primary: ModelCapability;
  modelPin?: string;
  crossBorderAllowed: boolean;
}

export interface RouteCandidate<A extends RoutableAdapter> {
  model: ModelRecord;
  adapter: A;
}

export interface RoutePlan<A extends RoutableAdapter> {
  ordered: RouteCandidate<A>[];
  considered: { model_id: string; reason: string }[];
  reason: string;
}

/** `ai.routing.policy.<feature>.<band>` value. */
interface Policy {
  candidates: { model_id: string; weight?: number }[];
}

export class Router<A extends RoutableAdapter> {
  private readonly adapters: Map<string, A>;
  constructor(
    adapters: readonly A[],
    private readonly o: {
      settings: SettingsReader;
      kill: KillSwitches;
      breaker: Breaker;
      now?: () => Date;
    },
  ) {
    this.adapters = new Map(adapters.map((a) => [a.descriptor.adapterKey, a]));
  }

  private async policy(
    ctx: KernelContext,
    featureKey: string,
    band: RoutingBand,
  ): Promise<Policy | null> {
    try {
      const v = await this.o.settings.get(
        ctx,
        `ai.routing.policy.${keySegment(featureKey)}.${band}`,
      );
      if (v && typeof v === "object" && Array.isArray((v as Policy).candidates)) return v as Policy;
    } catch {
      /* unset: the DEFAULT order applies */
    }
    return null;
  }

  /**
   * The ordered candidates (IPB-03 §03.4.5 steps 1–3). A pin is honoured only if eligible, else
   * IPB-AI-012; an empty list is IPB-AI-021 with the reasons recorded.
   */
  async plan(
    ctx: KernelContext,
    snapshot: { models: ModelRecord[]; defaults: DefaultRef[] },
    i: RouteInput,
  ): Promise<RoutePlan<A>> {
    const now = this.o.now?.() ?? new Date();
    const considered: { model_id: string; reason: string }[] = [];
    const ok: RouteCandidate<A>[] = [];
    const check = async (m: ModelRecord): Promise<string | null> => {
      const e = eligibility(m, {
        band: i.band,
        crossBorderAllowed: i.crossBorderAllowed,
        capabilities: i.capabilities,
        now,
      });
      if (e) return e;
      const a = this.adapters.get(m.adapterKey);
      if (!a) return "adapter not configured";
      const blocked = adapterBlock(a, m);
      if (blocked) return blocked;
      const missing = i.capabilities.filter((c) => !a.capabilities().includes(c));
      if (missing.length) return `adapter lacks ${missing.join(", ")}`;
      if (await this.o.kill.adapterKilled(ctx, m.adapterKey)) return "adapter kill switch on";
      if (this.o.breaker.isOpen(m.modelId)) return "breaker open";
      return null;
    };

    if (i.modelPin) {
      const m = snapshot.models.find((x) => x.modelId === i.modelPin);
      const why = m ? await check(m) : "not in the registry";
      if (!m || why)
        throw new IpbError("IPB-AI-012", {
          detail: `pinned model ${i.modelPin} is not eligible: ${why}`,
          meta: { model_id: i.modelPin },
        });
      return {
        ordered: [{ model: m, adapter: this.adapters.get(m.adapterKey) as A }],
        considered: [],
        reason: "pin",
      };
    }

    const policy = await this.policy(ctx, i.featureKey, i.band);
    const byId = new Map(snapshot.models.map((m) => [m.modelId, m]));
    let order: ModelRecord[];
    let reason: string;
    if (policy) {
      order = [...policy.candidates]
        .sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1))
        .map((c) => byId.get(c.model_id))
        .filter((m): m is ModelRecord => m !== undefined);
      reason = "policy";
    } else {
      const def = snapshot.defaults.find((d) => d.capability === i.primary && d.band === i.band);
      const first = def ? byId.get(def.modelId) : undefined;
      order = [
        ...(first ? [first] : []),
        ...snapshot.models.filter(
          (m) => m !== first && (m.state === "APPROVED" || m.state === "DEFAULT"),
        ),
      ];
      reason = first ? "default" : "approved";
    }
    for (const m of order) {
      const why = await check(m);
      if (why) considered.push({ model_id: m.modelId, reason: why });
      else ok.push({ model: m, adapter: this.adapters.get(m.adapterKey) as A });
    }
    return { ordered: ok, considered, reason };
  }
}
