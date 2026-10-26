// In-memory SECRETS and IDENTITY fakes for seed tests (the shared fakes live in @infrabyx/testing).
import type {
  IdentityProvisioning,
  PortHealth,
  ProvisionUserSpec,
  SecretMeta,
  SecretValue,
  SecretsPort,
} from "@infrabyx/contracts/ports";

export class MemorySecrets implements SecretsPort {
  readonly descriptor = {
    port: "SECRETS",
    adapter: "memory",
    residency: "IN",
    maxDataClass: "SECRET",
  } as const;
  readonly store = new Map<string, SecretValue[]>();
  failWrites = false;
  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: new Date().toISOString() };
  }
  async get(path: string): Promise<SecretValue> {
    const v = this.store.get(path)?.at(-1);
    if (!v) throw new Error("not found");
    return v;
  }
  async put(path: string, value: string, meta: SecretMeta = {}): Promise<{ version: string }> {
    if (this.failWrites) throw new Error("vault unavailable");
    const versions = this.store.get(path) ?? [];
    const version = String(versions.length + 1);
    versions.push({ value, version, meta });
    this.store.set(path, versions);
    return { version };
  }
  async rotate(): Promise<{ version: string }> {
    throw new Error("not used");
  }
  async list(prefix: string): Promise<string[]> {
    return [...this.store.keys()].filter((k) => k.startsWith(prefix));
  }
  async lease(path: string): Promise<SecretValue & { expiresAt: string }> {
    return { ...(await this.get(path)), expiresAt: new Date(Date.now() + 60_000).toISOString() };
  }
  async audit(): Promise<Array<{ at: string; actor: string; op: string }>> {
    return [];
  }
}

export class MemoryIdentity implements IdentityProvisioning {
  readonly users = new Map<string, ProvisionUserSpec>();
  async provisionUser(spec: ProvisionUserSpec): Promise<{ id: string }> {
    this.users.set(spec.email, spec);
    return { id: spec.email };
  }
  async setPassword(email: string, password: string, temporary: boolean): Promise<void> {
    const u = this.users.get(email);
    if (u) u.password = { value: password, temporary };
  }
}
