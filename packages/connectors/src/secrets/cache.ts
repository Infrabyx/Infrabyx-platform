// In-memory secret cache (IPB-01 SECRETS failover, PL2 plan §6.1): values refresh every
// `cacheSeconds` (900, `int.secrets.cache_seconds`). When a refresh fails after expiry the
// adapter reports `down` (the pod goes not-ready) while the last value keeps being served, and a
// value older than 24 h is never served. Values never leave memory.
import type { PortHealth, SecretMeta, SecretsPort, SecretValue } from "@infrabyx/contracts/ports";

export interface SecretCacheOptions {
  cacheSeconds?: number;
  maxStaleSeconds?: number;
  now?: () => number;
}

interface Entry {
  value: SecretValue;
  fetchedAt: number;
}

export class CachedSecrets implements SecretsPort {
  private readonly entries = new Map<string, Entry>();
  private readonly failing = new Set<string>();
  private readonly now: () => number;

  constructor(
    readonly inner: SecretsPort,
    private readonly o: SecretCacheOptions = {},
  ) {
    this.now = o.now ?? Date.now;
  }

  get descriptor() {
    return this.inner.descriptor;
  }

  private ttl(): number {
    return (this.o.cacheSeconds ?? 900) * 1000;
  }

  async get(path: string, version?: string): Promise<SecretValue> {
    // Pinned versions are immutable and fetched as asked.
    if (version !== undefined) return this.inner.get(path, version);
    const e = this.entries.get(path);
    const age = e ? this.now() - e.fetchedAt : Number.POSITIVE_INFINITY;
    if (e && age <= this.ttl()) return e.value;
    try {
      const value = await this.inner.get(path);
      this.entries.set(path, { value, fetchedAt: this.now() });
      this.failing.delete(path);
      return value;
    } catch (err) {
      this.failing.add(path);
      if (e && age <= (this.o.maxStaleSeconds ?? 86_400) * 1000) return e.value;
      this.entries.delete(path);
      throw err;
    }
  }

  async put(path: string, value: string, meta?: SecretMeta): Promise<{ version: string }> {
    const r = await this.inner.put(path, value, meta);
    this.entries.delete(path);
    return r;
  }

  async rotate(
    path: string,
    rotator: (current: SecretValue) => Promise<string>,
  ): Promise<{ version: string }> {
    const r = await this.inner.rotate(path, rotator);
    this.entries.delete(path);
    return r;
  }

  list(prefix: string): Promise<string[]> {
    return this.inner.list(prefix);
  }

  lease(path: string, ttlSeconds: number): Promise<SecretValue & { expiresAt: string }> {
    return this.inner.lease(path, ttlSeconds);
  }

  audit(path: string): Promise<Array<{ at: string; actor: string; op: string }>> {
    return this.inner.audit(path);
  }

  /** `down` (not-ready) while any cached secret failed its last refresh. */
  async health(): Promise<PortHealth> {
    const h = await this.inner.health();
    return this.failing.size > 0 ? { ...h, status: "down" } : h;
  }

  /** Drop every cached value (rotation drills, shutdown). */
  clear(): void {
    this.entries.clear();
    this.failing.clear();
  }
}
