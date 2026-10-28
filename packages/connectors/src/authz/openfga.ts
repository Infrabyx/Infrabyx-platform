// AUTHZ alternative `openfga` (PL2 plan §6.6, D-04): OpenFGA, self-hosted. The store holds only the
// authorization model (`policy/openfga/model.json`, same decision table as the Cerbos pack); every
// check sends contextual tuples derived from the principal's roles and attributes and the
// resource's attributes, so no tuple data is stored in OpenFGA (PL2-D-52). `planResources` is
// unsupported: ListObjects needs stored tuples. Deny by default; PDP failure is a deny.
// The adapter calls OpenFGA's HTTP API directly: the SDK pinned an axios release with open advisories
// that products could not override (PR-FBX-05).
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
import { AllowCache, agentGuard, isAgent, pdpDown } from "./common.js";

export interface OpenFgaOptions {
  apiUrl: string;
  storeId: string;
  /** Model id; loadPolicies writes a model and switches to it. */
  authorizationModelId?: string;
  /** Preshared key from SECRETS (`secrets/<env>/authz/openfga/preshared_key`). */
  presharedKey?: string;
  decisionCacheSeconds?: number;
  allowLoopbackHttp?: boolean;
  now?: () => number;
}

/** PL1 role floor → tenant relations in the model. */
const TENANT_RELATION: Readonly<Record<string, string>> = {
  ORG_OWNER: "owner",
  ORG_ADMIN: "admin",
  ORG_MAKER: "maker",
  ORG_CHECKER: "checker",
  ORG_MEMBER: "member",
  ORG_AUDITOR_RO: "auditor",
};

/** An OpenFGA tuple key: `user` has `relation` on `object`. */
export interface TupleKey {
  user: string;
  relation: string;
  object: string;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const TIMEOUT_MS = 3000;

/** An OpenFGA API error, with the HTTP status. */
class OpenFgaHttpError extends Error {
  constructor(readonly statusCode: number) {
    super(`OpenFGA answered ${statusCode}`);
  }
}

/** POST `body` to `path` under `apiUrl` (any base path kept) and return the JSON answer. */
async function post<T>(
  apiUrl: string,
  path: string,
  body: unknown,
  presharedKey?: string,
): Promise<T> {
  const r = await fetch(`${apiUrl.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(presharedKey ? { authorization: `Bearer ${presharedKey}` } : {}),
    },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new OpenFgaHttpError(r.status);
  return (await r.json()) as T;
}
const ID = /^[A-Za-z0-9_.:@-]{1,128}$/;
const str = (v: unknown): string | undefined =>
  typeof v === "string" && ID.test(v) ? v : undefined;

/** Contextual tuples for one principal and resource (exported for tests). */
export function contextualTuples(p: AuthzPrincipal, r: AuthzResource): TupleKey[] {
  const user = `user:${p.id}`;
  const out: TupleKey[] = [];
  const ptenant = str(p.attr?.tenant_id);
  if (ptenant)
    for (const role of p.roles) {
      const rel = TENANT_RELATION[role];
      if (rel) out.push({ user, relation: rel, object: `tenant:${ptenant}` });
    }
  if (isAgent(p) && ptenant) out.push({ user, relation: "agent", object: `tenant:${ptenant}` });
  if (p.roles.some((x) => x.startsWith("OPS_")) && Array.isArray(p.attr?.product_scope))
    for (const prod of p.attr.product_scope as unknown[]) {
      const s = str(prod);
      if (s) out.push({ user, relation: "ops", object: `product:${s}` });
    }
  const obj = `${r.kind}:${r.id}`;
  const rtenant = str(r.attr?.tenant_id);
  if (rtenant) out.push({ user: `tenant:${rtenant}`, relation: "tenant", object: obj });
  const rprod = str(r.attr?.product);
  if (rprod) out.push({ user: `product:${rprod}`, relation: "product", object: obj });
  const maker = str(r.attr?.maker_id);
  if (maker) out.push({ user: `user:${maker}`, relation: "maker_of", object: obj });
  if (isAgent(p)) out.push({ user, relation: "agent_actor", object: obj });
  return out;
}

export class OpenFgaAuthz implements AuthzPort {
  readonly descriptor: AdapterDescriptor = {
    port: "AUTHZ",
    adapter: "openfga",
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
    capabilities: { planResources: "unsupported" },
  };
  private modelId: string | undefined;
  private readonly cache: AllowCache;

  constructor(private readonly o: OpenFgaOptions) {
    const u = new URL(o.apiUrl);
    if (u.protocol !== "https:" && !(o.allowLoopbackHttp && LOOPBACK.has(u.hostname)))
      throw new PortError("IPB-SEC-018", "AUTHZ", {
        adapter: "openfga",
        detail: "OpenFGA URL must be https",
      });
    if (!ID.test(o.storeId))
      throw new PortError("IPB-PORT-005", "AUTHZ", {
        adapter: "openfga",
        detail: "invalid OpenFGA store id",
      });
    this.modelId = o.authorizationModelId;
    this.cache = new AllowCache((o.decisionCacheSeconds ?? 5) * 1000, o.now);
  }

  private store(path: string): string {
    return `/stores/${encodeURIComponent(this.o.storeId)}/${path}`;
  }

  async check(
    principal: AuthzPrincipal,
    resource: AuthzResource,
    action: string,
    ctx?: Readonly<Record<string, unknown>>,
  ): Promise<AuthzDecision> {
    const guard = agentGuard(principal, action);
    if (guard) return guard;
    if (
      !ID.test(principal.id) ||
      !ID.test(resource.id) ||
      !/^[a-z][a-z0-9_]{0,63}$/.test(resource.kind)
    )
      return { allowed: false, policy: "ipb.invalid_identifier" };
    const k = this.cache.key(principal, resource, action, ctx);
    if (this.cache.hit(k)) return { allowed: true, policy: "cache" };
    try {
      const r = await post<{ allowed?: boolean }>(
        this.o.apiUrl,
        this.store("check"),
        {
          tuple_key: {
            user: `user:${principal.id}`,
            relation: action,
            object: `${resource.kind}:${resource.id}`,
          },
          contextual_tuples: { tuple_keys: contextualTuples(principal, resource) },
          ...(this.modelId ? { authorization_model_id: this.modelId } : {}),
        },
        this.o.presharedKey,
      );
      const d: AuthzDecision = {
        allowed: r.allowed === true,
        policy: `openfga:${resource.kind}#${action}`,
      };
      this.cache.put(k, d);
      return d;
    } catch (e) {
      // An unknown type or relation is a 400 from OpenFGA: deny, not an outage.
      const status = e instanceof OpenFgaHttpError ? e.statusCode : undefined;
      return status && status >= 400 && status < 500
        ? { allowed: false, policy: "ipb.no_such_relation" }
        : pdpDown("openfga");
    }
  }

  async checkBatch(
    principal: AuthzPrincipal,
    items: ReadonlyArray<{ resource: AuthzResource; actions: readonly string[] }>,
  ): Promise<Array<{ resourceId: string; decisions: Record<string, AuthzDecision> }>> {
    return Promise.all(
      items.map(async (i) => ({
        resourceId: i.resource.id,
        decisions: Object.fromEntries(
          await Promise.all(
            i.actions.map(async (a) => [a, await this.check(principal, i.resource, a)] as const),
          ),
        ),
      })),
    );
  }

  async planResources(): Promise<ResourcePlan> {
    throw new PortError("IPB-PORT-001", "AUTHZ", {
      adapter: "openfga",
      detail:
        "planResources needs stored tuples; the platform model is evaluated from contextual tuples only",
      meta: { reason: "unsupported" },
    });
  }

  /** Writes `model.json` from the bundle as a new authorization model and switches to it. */
  async loadPolicies(bundle: {
    version: string;
    files: Readonly<Record<string, string>>;
  }): Promise<void> {
    const text = bundle.files["model.json"];
    if (!text)
      throw new PortError("IPB-PORT-005", "AUTHZ", {
        adapter: "openfga",
        detail: "bundle has no model.json",
      });
    const r = await post<{ authorization_model_id: string }>(
      this.o.apiUrl,
      this.store("authorization-models"),
      JSON.parse(text),
      this.o.presharedKey,
    );
    this.modelId = r.authorization_model_id;
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
      const r = await fetch(new URL("/healthz", this.o.apiUrl), {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return {
        status: r.ok ? "up" : "down",
        latency_ms: Date.now() - t,
        checked_at: new Date().toISOString(),
      };
    } catch {
      return { status: "down", latency_ms: Date.now() - t, checked_at: new Date().toISOString() };
    }
  }

  /** Create a store (setup and tests); returns its id. */
  static async createStore(apiUrl: string, name: string): Promise<string> {
    return (await post<{ id: string }>(apiUrl, "/stores", { name })).id;
  }
}
