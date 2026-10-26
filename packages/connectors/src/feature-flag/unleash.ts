// FEATURE_FLAG reference adapter `unleash` (PL2 plan §6.4): self-hosted Unleash OSS through the Node
// SDK, which polls the client API and evaluates strategies locally. When the SDK has not synchronised
// within `maxStalenessMs` every evaluation throws FlagProviderUnavailable, so the PL1 FlagService
// serves its last-known-good snapshot (≤ 24 h) and then the kill-switch safe state (IPB-02-83).
// The flag registry is synced through the admin API; writes stay governed by FlagAdmin (PL1-D-11).
import { InMemStorageProvider, Unleash, UnleashEvents, type Context } from "unleash-client";
import { PortError } from "@infrabyx/contracts/errors";
import type {
  AdapterDescriptor,
  FeatureFlagManagement,
  FeatureFlagPort,
  FlagEvaluationContext,
  FlagSnapshot,
  FlagValue,
  PortHealth,
} from "@infrabyx/contracts/ports";
import { FlagProviderUnavailable, type FlagDef } from "@infrabyx/config/flags";
import { createEgress, type EgressResponse } from "../core/http.js";
import { assertHashedContext } from "./context.js";

export interface UnleashOptions {
  /** Unleash base URL without `/api` (e.g. `https://flags.internal`). */
  url: string;
  appName: string;
  /** Unleash environment the client token is scoped to. */
  environment: string;
  /** Client API token, resolved from SECRETS (`FLAGS_UNLEASH_API_TOKEN_REF`). */
  clientToken: string;
  /** Admin API token for registry sync and governed writes (`secrets/<env>/feature_flag/unleash/admin_token`). */
  adminToken?: string;
  project?: string;
  refreshIntervalMs?: number;
  /** Evaluations fail over to the FlagService snapshot after this long without a successful poll. */
  maxStalenessMs?: number;
  /** Hosts the adapter may call; defaults to the URL's host. */
  allow?: readonly string[];
  /** Tests only: plain HTTP to a loopback Unleash. */
  allowLoopbackHttp?: boolean;
  now?: () => number;
}

export interface SyncResult {
  created: string[];
  updated: string[];
  unchanged: string[];
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export class UnleashFlags implements FeatureFlagPort, FeatureFlagManagement {
  readonly descriptor: AdapterDescriptor = {
    port: "FEATURE_FLAG",
    adapter: "unleash",
    residency: "IN",
    maxDataClass: "INTERNAL",
    capabilities: { setValue: "native" },
  };
  private readonly client: Unleash;
  private readonly egress: ReturnType<typeof createEgress>;
  private readonly now: () => number;
  private lastSync = 0;
  private lastError: string | null = null;

  private constructor(private readonly o: UnleashOptions) {
    const u = new URL(o.url);
    if (u.protocol !== "https:" && !(o.allowLoopbackHttp && LOOPBACK.has(u.hostname)))
      throw new PortError("IPB-SEC-018", "FEATURE_FLAG", {
        adapter: "unleash",
        detail: "Unleash URL must be https",
      });
    this.now = o.now ?? Date.now;
    this.egress = createEgress({
      port: "FEATURE_FLAG",
      adapter: "unleash",
      allow: o.allow ?? [u.hostname],
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
    this.client = new Unleash({
      url: `${o.url.replace(/\/$/, "")}/api/`,
      appName: o.appName,
      environment: o.environment,
      customHeaders: { Authorization: o.clientToken },
      refreshInterval: o.refreshIntervalMs ?? 15_000,
      // Toggle state stays in memory; the FlagService snapshot is the persisted last-known-good.
      storageProvider: new InMemStorageProvider(),
      disableMetrics: true,
      disableAutoStart: true,
      skipInstanceCountWarning: true,
    });
    const ok = () => {
      this.lastSync = this.now();
      this.lastError = null;
    };
    this.client.on(UnleashEvents.Synchronized, ok);
    this.client.on(UnleashEvents.Changed, ok);
    this.client.on(UnleashEvents.Unchanged, ok);
    this.client.on(UnleashEvents.Error, (e: Error) => {
      this.lastError = e.message;
    });
    this.client.on(UnleashEvents.Warn, () => {});
  }

  /** Create the adapter and wait for the first poll (bounded by `timeoutMs`; a failure is not fatal). */
  static async start(o: UnleashOptions, timeoutMs = 10_000): Promise<UnleashFlags> {
    const a = new UnleashFlags(o);
    await Promise.race([a.client.start(), new Promise((r) => setTimeout(r, timeoutMs).unref())]);
    return a;
  }

  private fresh(): void {
    const max = this.o.maxStalenessMs ?? 4 * (this.o.refreshIntervalMs ?? 15_000);
    if (!this.lastSync || this.now() - this.lastSync > max)
      throw new FlagProviderUnavailable(
        `unleash not synchronised for ${this.lastSync ? this.now() - this.lastSync : "∞"} ms${this.lastError ? `: ${this.lastError}` : ""}`,
      );
  }

  private context(ctx?: FlagEvaluationContext): Context {
    assertHashedContext("unleash", ctx);
    const properties: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(ctx?.attributes ?? {}))
      properties[k] = typeof v === "boolean" ? String(v) : v;
    if (ctx?.tenantKey) properties.tenantKey = ctx.tenantKey;
    return {
      ...(ctx?.userKey ? { userId: ctx.userKey } : {}),
      environment: ctx?.env ?? this.o.environment,
      properties,
    };
  }

  async getBooleanValue(key: string, def: boolean, ctx?: FlagEvaluationContext): Promise<boolean> {
    this.fresh();
    const c = this.context(ctx);
    if (!this.client.getFeatureToggleDefinition(key)) return def;
    return this.client.isEnabled(key, c, def);
  }

  /** Non-boolean values come from the enabled variant's payload. */
  private variant(key: string, ctx?: FlagEvaluationContext): string | undefined {
    this.fresh();
    const v = this.client.getVariant(key, this.context(ctx));
    return v.enabled && v.feature_enabled ? v.payload?.value : undefined;
  }

  async getStringValue(key: string, def: string, ctx?: FlagEvaluationContext): Promise<string> {
    return this.variant(key, ctx) ?? def;
  }

  async getNumberValue(key: string, def: number, ctx?: FlagEvaluationContext): Promise<number> {
    const n = Number(this.variant(key, ctx));
    return Number.isFinite(n) ? n : def;
  }

  async getObjectValue<T extends Record<string, unknown>>(
    key: string,
    def: T,
    ctx?: FlagEvaluationContext,
  ): Promise<T> {
    const raw = this.variant(key, ctx);
    if (raw === undefined) return def;
    try {
      const v = JSON.parse(raw) as unknown;
      return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as T) : def;
    } catch {
      return def;
    }
  }

  /** Booleans for every toggle, evaluated without a tenant or user (the kill-switch view). */
  async snapshot(): Promise<FlagSnapshot> {
    this.fresh();
    const values: Record<string, FlagValue> = {};
    for (const f of this.client.getFeatureToggleDefinitions())
      values[f.name] = this.client.isEnabled(f.name, { environment: this.o.environment });
    return { values, fetchedAt: new Date(this.lastSync).toISOString() };
  }

  async health(): Promise<PortHealth> {
    const t = this.now();
    let status: PortHealth["status"] = "up";
    try {
      this.fresh();
      if (this.lastError) status = "degraded";
    } catch {
      status = "down";
    }
    return { status, latency_ms: 0, checked_at: new Date(t).toISOString() };
  }

  // ---- admin API: registry sync and governed writes -------------------------------------------

  private async admin(
    path: string,
    init: RequestInit = {},
    ok: readonly number[] = [200],
  ): Promise<EgressResponse> {
    if (!this.o.adminToken)
      throw new PortError("IPB-PORT-001", "FEATURE_FLAG", {
        adapter: "unleash",
        detail: "no admin token configured",
      });
    const r = await this.egress(`${this.o.url.replace(/\/$/, "")}/api/admin${path}`, {
      ...init,
      headers: {
        Authorization: this.o.adminToken,
        "content-type": "application/json",
        ...init.headers,
      },
    });
    if (!ok.includes(r.status))
      throw new PortError(
        r.status === 401 || r.status === 403 ? "IPB-PORT-001" : "IPB-PORT-002",
        "FEATURE_FLAG",
        {
          adapter: "unleash",
          detail: `admin ${init.method ?? "GET"} ${path.split("/").slice(0, 4).join("/")} answered ${r.status}`,
        },
      );
    return r;
  }

  private get project(): string {
    return this.o.project ?? "default";
  }

  /**
   * Make Unleash hold every exact registry flag (IPB-09-24). New toggles take the registry default;
   * an existing toggle's on/off state is never touched (operators and FlagAdmin own it), only its
   * description and type. Locked flags are evaluated by FlagService and not synced. Idempotent.
   */
  async syncRegistry(defs: readonly FlagDef[]): Promise<SyncResult> {
    const res: SyncResult = { created: [], updated: [], unchanged: [] };
    const base = `/projects/${this.project}/features`;
    for (const d of defs) {
      if (d.pattern || d.locked || d.state === "removed") continue;
      const type =
        d.kind === "kill"
          ? "kill-switch"
          : d.kind === "exp"
            ? "experiment"
            : d.kind === "ops"
              ? "operational"
              : "release";
      const description =
        `${d.description} · owner ${d.owner} · expires ${d.expiry ?? "never"} · ${d.source}`.slice(
          0,
          1000,
        );
      const got = await this.admin(`${base}/${encodeURIComponent(d.key)}`, {}, [200, 404]);
      if (got.status === 404) {
        await this.admin(
          base,
          {
            method: "POST",
            body: JSON.stringify({ name: d.key, type, description, impressionData: false }),
          },
          [200, 201],
        );
        if (d.default) await this.setEnabled(d.key, true);
        res.created.push(d.key);
        continue;
      }
      const cur = got.json<{ type?: string; description?: string }>();
      if (cur.type === type && cur.description === description) {
        res.unchanged.push(d.key);
        continue;
      }
      await this.admin(`${base}/${encodeURIComponent(d.key)}`, {
        method: "PATCH",
        body: JSON.stringify([
          { op: "replace", path: "/description", value: description },
          { op: "replace", path: "/type", value: type },
        ]),
      });
      res.updated.push(d.key);
    }
    return res;
  }

  private async setEnabled(key: string, on: boolean): Promise<void> {
    const env = `/projects/${this.project}/features/${encodeURIComponent(key)}/environments/${encodeURIComponent(this.o.environment)}`;
    if (on) {
      const strategies = await this.admin(`${env}/strategies`);
      if (strategies.json<unknown[]>().length === 0)
        await this.admin(`${env}/strategies`, {
          method: "POST",
          body: JSON.stringify({
            name: "flexibleRollout",
            parameters: { rollout: "100", stickiness: "default", groupId: key },
          }),
        });
    }
    await this.admin(`${env}/${on ? "on" : "off"}`, { method: "POST" });
  }

  /** Boolean switch in this adapter's environment; call through FlagAdmin so the change is governed and ledgered. */
  async setValue(key: string, value: FlagValue, _actor: string): Promise<void> {
    if (typeof value !== "boolean")
      throw new PortError("IPB-PORT-001", "FEATURE_FLAG", {
        adapter: "unleash",
        detail: "only boolean values are written; variants are managed in Unleash",
        meta: { reason: "unsupported" },
      });
    await this.setEnabled(key, value);
  }

  async listFlags(prefix = ""): Promise<string[]> {
    const r = await this.admin(`/projects/${this.project}/features`);
    return r
      .json<{ features: Array<{ name: string }> }>()
      .features.map((f) => f.name)
      .filter((n) => n.startsWith(prefix))
      .sort();
  }

  stop(): void {
    this.client.destroy();
  }
}
