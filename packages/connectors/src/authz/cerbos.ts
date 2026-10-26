// AUTHZ reference adapter `cerbos` (PL2 plan §6.6): a Cerbos PDP sidecar over HTTP. The platform
// policy pack (`policy/cerbos`, PL2-D-51) is loaded through the Admin API into a dynamic store, or
// mounted from disk. Deny by default; PDP failure is a deny (IPB-AUTHZ-001).
import { HTTP } from "@cerbos/http";
import { parse as parseYaml } from "yaml";
import { PortError } from "@infrabyx/contracts/errors";
import type {
  AdapterDescriptor,
  AuthzDecision,
  AuthzPort,
  AuthzPrincipal,
  AuthzResource,
  PortHealth,
  ResourcePlan,
} from "@infrabyx/contracts/ports";
import { AllowCache, agentGuard, pdpDown } from "./common.js";

export interface CerbosOptions {
  /** PDP HTTP address, e.g. https://cerbos:3592 (plain HTTP only to loopback in tests). */
  url: string;
  /** Admin API credentials from SECRETS, for loadPolicies (dynamic store only). */
  admin?: { username: string; password: string };
  decisionCacheSeconds?: number;
  allowLoopbackHttp?: boolean;
  now?: () => number;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

const toCerbosPrincipal = (p: AuthzPrincipal) => ({
  id: p.id,
  roles: [...p.roles],
  attr: { ...(p.attr ?? {}) } as Record<string, never>,
});
const toCerbosResource = (r: AuthzResource) => ({
  kind: r.kind,
  id: r.id,
  attr: { ...(r.attr ?? {}) } as Record<string, never>,
});

export class CerbosAuthz implements AuthzPort {
  readonly descriptor: AdapterDescriptor = {
    port: "AUTHZ",
    adapter: "cerbos",
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
  };
  private readonly client: HTTP;
  private readonly cache: AllowCache;

  constructor(private readonly o: CerbosOptions) {
    const u = new URL(o.url);
    if (u.protocol !== "https:" && !(o.allowLoopbackHttp && LOOPBACK.has(u.hostname)))
      throw new PortError("IPB-SEC-018", "AUTHZ", {
        adapter: "cerbos",
        detail: "Cerbos URL must be https",
      });
    this.client = new HTTP(o.url, o.admin ? { adminCredentials: o.admin } : {});
    this.cache = new AllowCache((o.decisionCacheSeconds ?? 5) * 1000, o.now);
  }

  async check(
    principal: AuthzPrincipal,
    resource: AuthzResource,
    action: string,
    ctx?: Readonly<Record<string, unknown>>,
  ): Promise<AuthzDecision> {
    const guard = agentGuard(principal, action);
    if (guard) return guard;
    const k = this.cache.key(principal, resource, action, ctx);
    if (this.cache.hit(k)) return { allowed: true, policy: "cache" };
    try {
      const r = await this.client.checkResource({
        principal: toCerbosPrincipal(principal),
        resource: toCerbosResource(resource),
        actions: [action],
        includeMetadata: true,
      });
      const d: AuthzDecision = {
        allowed: r.isAllowed(action) === true,
        ...(r.metadata?.actions[action]?.matchedPolicy
          ? { policy: r.metadata.actions[action].matchedPolicy }
          : {}),
      };
      this.cache.put(k, d);
      return d;
    } catch {
      return pdpDown("cerbos");
    }
  }

  async checkBatch(
    principal: AuthzPrincipal,
    items: ReadonlyArray<{ resource: AuthzResource; actions: readonly string[] }>,
  ): Promise<Array<{ resourceId: string; decisions: Record<string, AuthzDecision> }>> {
    try {
      const r = await this.client.checkResources({
        principal: toCerbosPrincipal(principal),
        resources: items.map((i) => ({
          resource: toCerbosResource(i.resource),
          actions: [...i.actions],
        })),
      });
      return items.map((i) => {
        const res = r.findResult({ kind: i.resource.kind, id: i.resource.id });
        const decisions: Record<string, AuthzDecision> = {};
        for (const a of i.actions)
          decisions[a] = agentGuard(principal, a) ?? { allowed: res?.isAllowed(a) === true };
        return { resourceId: i.resource.id, decisions };
      });
    } catch {
      return items.map((i) => ({
        resourceId: i.resource.id,
        decisions: Object.fromEntries(i.actions.map((a) => [a, pdpDown("cerbos")])),
      }));
    }
  }

  /** Query plan for list filtering; an agent asking for a forbidden verb is always denied. */
  async planResources(
    principal: AuthzPrincipal,
    kind: string,
    action: string,
  ): Promise<ResourcePlan> {
    if (agentGuard(principal, action)) return { kind: "always_denied" };
    try {
      const r = await this.client.planResources({
        principal: toCerbosPrincipal(principal),
        resource: { kind },
        action,
      });
      if (r.kind === "KIND_ALWAYS_ALLOWED") return { kind: "always_allowed" };
      if (r.kind === "KIND_ALWAYS_DENIED") return { kind: "always_denied" };
      return { kind: "conditional", condition: (r as { condition: unknown }).condition };
    } catch {
      return { kind: "always_denied" };
    }
  }

  /** Loads YAML or JSON policy files through the Admin API (dynamic store, admin credentials). */
  async loadPolicies(bundle: {
    version: string;
    files: Readonly<Record<string, string>>;
  }): Promise<void> {
    if (!this.o.admin)
      throw new PortError("IPB-PORT-001", "AUTHZ", {
        adapter: "cerbos",
        detail: "loadPolicies needs Admin API credentials",
      });
    const policies = Object.entries(bundle.files)
      .filter(([name]) => /\.(ya?ml|json)$/.test(name))
      .map(([, text]) => parseYaml(text) as never);
    await this.client.addOrUpdatePolicies({ policies });
  }

  async explain(decision: AuthzDecision): Promise<string> {
    return JSON.stringify({
      allowed: decision.allowed,
      policy: decision.policy ?? null,
      ref: decision.ref ?? null,
    });
  }

  async health(): Promise<PortHealth> {
    const t = Date.now();
    try {
      await this.client.checkHealth();
      return { status: "up", latency_ms: Date.now() - t, checked_at: new Date().toISOString() };
    } catch {
      return { status: "down", latency_ms: Date.now() - t, checked_at: new Date().toISOString() };
    }
  }
}
