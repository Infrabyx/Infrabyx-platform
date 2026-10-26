// Fakes for the ports PL1 consumes (PL1 plan §10): SECRETS, KMS, STORAGE, FEATURE_FLAG, IDENTITY.
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  IdentityProvisioning,
  ObjectMeta,
  PortHealth,
  ProvisionUserSpec,
  SecretMeta,
  SecretValue,
  SecretsPort,
  StoragePort,
  StoredObject,
} from "@infrabyx/contracts/ports";
import { isValidStorageKey } from "@infrabyx/contracts/ports";
import { LocalKms, sha256Hex } from "@infrabyx/crypto";

export { MemoryFlagProvider, MemorySnapshotStore } from "@infrabyx/config/flags";

const up = (): PortHealth => ({
  status: "up",
  latency_ms: 0,
  checked_at: new Date().toISOString(),
});

export const fakeKms = (): LocalKms => new LocalKms();

export class MemorySecrets implements SecretsPort {
  readonly descriptor = {
    port: "SECRETS",
    adapter: "memory",
    residency: "IN",
    maxDataClass: "SECRET",
  } as const;
  private readonly store = new Map<string, SecretValue[]>();
  private readonly log: Array<{ at: string; actor: string; op: string; path: string }> = [];
  failWrites = false;
  async health(): Promise<PortHealth> {
    return up();
  }
  async get(path: string, version?: string): Promise<SecretValue> {
    const versions = this.store.get(path) ?? [];
    const v = version ? versions.find((x) => x.version === version) : versions.at(-1);
    if (!v) throw new Error(`secret ${path} not found`);
    this.log.push({ at: new Date().toISOString(), actor: "test", op: "get", path });
    return v;
  }
  async put(path: string, value: string, meta: SecretMeta = {}): Promise<{ version: string }> {
    if (this.failWrites) throw new Error("vault unavailable");
    const versions = this.store.get(path) ?? [];
    const version = String(versions.length + 1);
    versions.push({ value, version, meta: { ...meta, lastRotated: new Date().toISOString() } });
    this.store.set(path, versions);
    this.log.push({ at: new Date().toISOString(), actor: "test", op: "put", path });
    return { version };
  }
  async rotate(
    path: string,
    rotator: (current: SecretValue) => Promise<string>,
  ): Promise<{ version: string }> {
    return this.put(path, await rotator(await this.get(path)));
  }
  async list(prefix: string): Promise<string[]> {
    return [...this.store.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
  async lease(path: string, ttlSeconds: number): Promise<SecretValue & { expiresAt: string }> {
    return {
      ...(await this.get(path)),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }
  async audit(path: string): Promise<Array<{ at: string; actor: string; op: string }>> {
    return this.log.filter((l) => l.path === path).map(({ at, actor, op }) => ({ at, actor, op }));
  }
  /** Number of versions stored at a path (tests never read values into assertions messages). */
  versions(path: string): number {
    return this.store.get(path)?.length ?? 0;
  }
}

interface Obj {
  body: Uint8Array;
  meta: ObjectMeta;
  retainUntil?: Date;
  deleted?: boolean;
}

export class MemoryStorage implements StoragePort {
  readonly descriptor = {
    port: "STORAGE",
    adapter: "memory",
    residency: "IN",
    maxDataClass: "REGULATED",
  } as const;
  readonly objects = new Map<string, Obj>();
  constructor(private readonly now: () => Date = () => new Date()) {}
  async health(): Promise<PortHealth> {
    return up();
  }
  private check(key: string): void {
    if (!isValidStorageKey(key)) throw new Error(`invalid storage key ${key}`);
  }
  async put(key: string, body: Uint8Array, meta: ObjectMeta): Promise<void> {
    this.check(key);
    const cur = this.objects.get(key);
    if (cur?.retainUntil && cur.retainUntil > this.now())
      throw new IpbError("IPB-STOR-003", { detail: "object is under retention" });
    this.objects.set(key, { body, meta: { ...meta, sha256: sha256Hex(body) } });
  }
  async putWithRetention(
    key: string,
    body: Uint8Array,
    retainUntil: Date,
    meta: ObjectMeta,
  ): Promise<void> {
    this.check(key);
    if (this.objects.has(key))
      throw new IpbError("IPB-STOR-003", { detail: "write-once object exists" });
    this.objects.set(key, { body, meta: { ...meta, sha256: sha256Hex(body) }, retainUntil });
  }
  async get(key: string): Promise<StoredObject> {
    const o = this.objects.get(key);
    if (!o || o.deleted) throw new IpbError("IPB-STOR-001", { meta: { key } });
    return {
      key,
      body: o.body,
      meta: o.meta,
      ...(o.retainUntil ? { retainUntil: o.retainUntil.toISOString() } : {}),
    };
  }
  /** Presigned URLs live at most 5 minutes (IPB-02-15). */
  async presign(key: string, op: "get" | "put", ttlSeconds: number): Promise<string> {
    this.check(key);
    if (!(ttlSeconds > 0 && ttlSeconds <= 300))
      throw new RangeError("presigned URL TTL must be 1–300 s (IPB-02-15)");
    return `memory://${key}?op=${op}&exp=${Math.floor(this.now().getTime() / 1000) + ttlSeconds}`;
  }
  async delete(key: string): Promise<void> {
    const o = this.objects.get(key);
    if (!o) throw new IpbError("IPB-STOR-001", { meta: { key } });
    if (o.retainUntil && o.retainUntil > this.now())
      throw new IpbError("IPB-STOR-003", { detail: "object is under retention" });
    o.deleted = true;
  }
  async list(prefix: string): Promise<{ keys: string[] }> {
    return {
      keys: [...this.objects.entries()]
        .filter(([k, o]) => k.startsWith(prefix) && !o.deleted)
        .map(([k]) => k)
        .sort(),
    };
  }
  async assertImmutable(key: string): Promise<void> {
    const o = this.objects.get(key);
    if (!o?.retainUntil || o.retainUntil <= this.now())
      throw new IpbError("IPB-STOR-003", { detail: "object is not under retention" });
  }
  async replicateTo(
    target: StoragePort,
    prefix: string,
  ): Promise<{ copied: number; verified: number }> {
    let copied = 0;
    for (const [k, o] of this.objects) {
      if (!k.startsWith(prefix) || o.deleted) continue;
      if (o.retainUntil) await target.putWithRetention(k, o.body, o.retainUntil, o.meta);
      else await target.put(k, o.body, o.meta);
      copied++;
    }
    return { copied, verified: copied };
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
    if (!u) throw new Error(`no user ${email}`);
    u.password = { value: password, temporary };
  }
}
