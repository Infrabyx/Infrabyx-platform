// SECRETS alternative `vault` (PL2 plan §6.1): Vault or OpenBao KV v2 over HTTPS through the egress
// client. `lease` is native through the database secrets engine for paths mapped in `dynamic`
// (dynamic PostgreSQL credentials); other paths return the static value. `audit` is unsupported:
// Vault audit devices are not queryable. Auth: Kubernetes service-account login in clusters
// (`SECRETS_VAULT_ROLE`), or a token (dev and CI containers only).
import { readFile } from "node:fs/promises";
import { PortError } from "@infrabyx/contracts/errors";
import type {
  AdapterDescriptor,
  PortHealth,
  SecretMeta,
  SecretsPort,
  SecretValue,
} from "@infrabyx/contracts/ports";
import { createEgress, type EgressResponse } from "../core/http.js";
import { checkPath, metaToTags, notFound, tagsToMeta } from "./common.js";

export type VaultAuth =
  | { kind: "token"; token: string }
  | { kind: "kubernetes"; role: string; mount?: string; jwtPath?: string };

export interface VaultSecretsOptions {
  address: string;
  auth: VaultAuth;
  /** KV v2 mount (default `secret`). */
  mount?: string;
  namespace?: string;
  pathPrefix?: string;
  /** Secret paths served by `lease` from a database secrets engine role. */
  dynamic?: Readonly<Record<string, { mount?: string; role: string }>>;
  /** Tests only: plain HTTP to a loopback Vault. */
  allowLoopbackHttp?: boolean;
}

export class VaultSecrets implements SecretsPort {
  readonly descriptor: AdapterDescriptor = {
    port: "SECRETS",
    adapter: "vault",
    residency: "IN",
    maxDataClass: "SECRET",
    capabilities: { audit: "unsupported" },
  };
  private readonly egress: ReturnType<typeof createEgress>;
  private token: string | null = null;
  private tokenExpires = 0;

  constructor(private readonly o: VaultSecretsOptions) {
    this.egress = createEgress({
      port: "SECRETS",
      adapter: "vault",
      allow: [new URL(o.address).hostname],
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
  }

  private get mount(): string {
    return this.o.mount ?? "secret";
  }

  private async authToken(): Promise<string> {
    if (this.o.auth.kind === "token") return this.o.auth.token;
    if (this.token && Date.now() < this.tokenExpires) return this.token;
    const a = this.o.auth;
    const jwt = (
      await readFile(a.jwtPath ?? "/var/run/secrets/kubernetes.io/serviceaccount/token", "utf8")
    ).trim();
    const r = await this.raw(
      "POST",
      `/v1/auth/${a.mount ?? "kubernetes"}/login`,
      { role: a.role, jwt },
      false,
    );
    const auth = r.json<{ auth: { client_token: string; lease_duration: number } }>().auth;
    this.token = auth.client_token;
    // Renew a minute early.
    this.tokenExpires = Date.now() + Math.max(0, auth.lease_duration - 60) * 1000;
    return this.token;
  }

  private async raw(
    method: string,
    path: string,
    body?: unknown,
    authed = true,
  ): Promise<EgressResponse> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (authed) headers["X-Vault-Token"] = await this.authToken();
    if (this.o.namespace) headers["X-Vault-Namespace"] = this.o.namespace;
    const r = await this.egress(`${this.o.address.replace(/\/$/, "")}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return r;
  }

  private async call<T>(
    method: string,
    path: string,
    body?: unknown,
    ok: readonly number[] = [200, 204],
  ): Promise<{ status: number; data: T | null }> {
    const r = await this.raw(method, path, body);
    if (!ok.includes(r.status)) {
      if (r.status === 404) return { status: 404, data: null };
      throw new PortError(r.status === 403 ? "IPB-PORT-001" : "IPB-PORT-002", "SECRETS", {
        adapter: "vault",
        detail: `${method} ${path.split("/").slice(0, 3).join("/")} answered ${r.status}`,
      });
    }
    return { status: r.status, data: r.body.byteLength ? r.json<T>() : null };
  }

  private enc(path: string): string {
    return path.split("/").map(encodeURIComponent).join("/");
  }

  async get(path: string, version?: string): Promise<SecretValue> {
    checkPath("vault", path, this.o.pathPrefix);
    const q = version ? `?version=${encodeURIComponent(version)}` : "";
    const [d, m] = await Promise.all([
      this.call<{
        data: {
          data: { value?: string } | null;
          metadata: { version: number; created_time: string };
        };
      }>("GET", `/v1/${this.mount}/data/${this.enc(path)}${q}`),
      this.call<{ data: { custom_metadata: Record<string, string> | null; updated_time: string } }>(
        "GET",
        `/v1/${this.mount}/metadata/${this.enc(path)}`,
      ),
    ]);
    const value = d.data?.data.data?.value;
    if (d.status === 404 || typeof value !== "string") throw notFound("vault", path);
    return {
      value,
      version: String(d.data!.data.metadata.version),
      meta: tagsToMeta(m.data?.data.custom_metadata ?? {}, m.data?.data.updated_time),
    };
  }

  async put(path: string, value: string, meta?: SecretMeta): Promise<{ version: string }> {
    checkPath("vault", path, this.o.pathPrefix);
    const r = await this.call<{ data: { version: number } }>(
      "POST",
      `/v1/${this.mount}/data/${this.enc(path)}`,
      { data: { value } },
    );
    if (meta)
      await this.call("POST", `/v1/${this.mount}/metadata/${this.enc(path)}`, {
        custom_metadata: metaToTags(meta),
      });
    return { version: String(r.data!.data.version) };
  }

  /** KV v2 keeps earlier versions, so the previous value stays readable during the overlap. */
  async rotate(
    path: string,
    rotator: (current: SecretValue) => Promise<string>,
  ): Promise<{ version: string }> {
    const current = await this.get(path);
    const r = await this.call<{ data: { version: number } }>(
      "POST",
      `/v1/${this.mount}/data/${this.enc(path)}`,
      {
        data: { value: await rotator(current) },
        options: { cas: Number(current.version) },
      },
    );
    return { version: String(r.data!.data.version) };
  }

  async list(prefix: string): Promise<string[]> {
    const dir = prefix.includes("/") ? prefix.slice(0, prefix.lastIndexOf("/") + 1) : "";
    const out: string[] = [];
    const walk = async (d: string): Promise<void> => {
      const r = await this.call<{ data: { keys: string[] } }>(
        "GET",
        `/v1/${this.mount}/metadata/${this.enc(d.replace(/\/$/, ""))}${d ? "/" : ""}?list=true`,
      );
      for (const k of r.data?.data.keys ?? []) {
        const full = `${d}${k}`;
        if (k.endsWith("/")) {
          if (full.startsWith(prefix) || prefix.startsWith(full)) await walk(full);
        } else if (full.startsWith(prefix)) out.push(full);
      }
    };
    await walk(dir);
    return out.sort();
  }

  async lease(path: string, ttlSeconds: number): Promise<SecretValue & { expiresAt: string }> {
    const dyn = this.o.dynamic?.[path];
    if (!dyn) {
      const v = await this.get(path);
      return { ...v, expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString() };
    }
    const r = await this.call<{
      lease_id: string;
      lease_duration: number;
      data: { username: string; password: string };
    }>("GET", `/v1/${dyn.mount ?? "database"}/creds/${encodeURIComponent(dyn.role)}`);
    if (!r.data) throw notFound("vault", path);
    const secs = Math.min(ttlSeconds, r.data.lease_duration);
    return {
      value: JSON.stringify({ username: r.data.data.username, password: r.data.data.password }),
      version: r.data.lease_id,
      meta: { dataClass: "SECRET" },
      expiresAt: new Date(Date.now() + secs * 1000).toISOString(),
    };
  }

  async audit(): Promise<Array<{ at: string; actor: string; op: string }>> {
    throw new PortError("IPB-PORT-001", "SECRETS", {
      adapter: "vault",
      detail: "audit is unsupported: Vault audit devices are not queryable",
      meta: { reason: "unsupported" },
    });
  }

  async health(): Promise<PortHealth> {
    const t = Date.now();
    try {
      const r = await this.raw("GET", "/v1/sys/health", undefined, false);
      const ok = r.status === 200 || r.status === 429; // 429: standby, still serving reads
      return {
        status: ok ? "up" : "down",
        latency_ms: Date.now() - t,
        checked_at: new Date().toISOString(),
      };
    } catch {
      return { status: "down", latency_ms: Date.now() - t, checked_at: new Date().toISOString() };
    }
  }
}
