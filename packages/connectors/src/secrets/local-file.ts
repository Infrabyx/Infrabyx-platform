// SECRETS adapter `local-file` (LawDocsComply LDC-65; R1-D-299): secrets in one JSON file, or in
// memory, for a product's local stack and its tests only, so `seed:credentials` and the services
// run without Vault. Refused in every other environment, twice over:
//   * the constructor refuses any `appEnv` but `local` and `test` (`IPB-PORT-001`, `local_only`);
//   * `sandbox-status.json` lists it unproven and off by `int.secrets.local_file.enabled`, so the
//     routing check refuses it in staging, pre-prod, prod and dr.
// The file holds values in plain text, so it is created 0600 in a 0700 directory, written whole to
// a temporary file and renamed, under a lock file so a seed run and a service never interleave.
// Its default place, `.infrabyx/local-secrets.json`, is git-ignored. Paths follow
// secrets/<env>/<port>/<adapter>/<key> and an optional prefix, as every SECRETS adapter's.
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PortError } from "@infrabyx/contracts/errors";
import type { AppEnv } from "@infrabyx/contracts/env";
import type {
  AdapterDescriptor,
  PortHealth,
  SecretMeta,
  SecretsPort,
  SecretValue,
} from "@infrabyx/contracts/ports";
import { checkPath, notFound } from "./common.js";

/** The only environments this adapter runs in. */
export const LOCAL_SECRETS_ENVS: readonly AppEnv[] = Object.freeze(["local", "test"]);

/** Where the file lives unless `file` says otherwise (git-ignored). */
export const LOCAL_SECRETS_DEFAULT_FILE = ".infrabyx/local-secrets.json";

export interface LocalFileSecretsOptions {
  /** `APP_ENV`. Anything but `local` or `test` is refused. */
  appEnv: AppEnv;
  /** The JSON file; `null` keeps everything in memory (one process). Default `LOCAL_SECRETS_DEFAULT_FILE`. */
  file?: string | null;
  /** Refuse any path outside this prefix, e.g. `secrets/local/`. */
  prefix?: string;
  /** Recorded as the actor of each operation (default `local`). */
  actor?: string;
  now?: () => Date;
}

interface Version {
  version: string;
  value: string;
  meta: SecretMeta;
}
interface Store {
  format: 1;
  secrets: Record<string, Version[]>;
  audit: Array<{ at: string; actor: string; op: string; path: string }>;
}

const empty = (): Store => ({ format: 1, secrets: {}, audit: [] });
const LOCK_WAIT_MS = 5_000;
const LOCK_STALE_MS = 30_000;
const AUDIT_KEEP = 10_000;

export class LocalFileSecrets implements SecretsPort {
  readonly descriptor: AdapterDescriptor = {
    port: "SECRETS",
    adapter: "local-file",
    residency: "IN",
    maxDataClass: "SECRET",
  };
  private readonly file: string | null;
  private memory: Store = empty();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly o: LocalFileSecretsOptions) {
    if (!LOCAL_SECRETS_ENVS.includes(o.appEnv))
      throw new PortError("IPB-PORT-001", "SECRETS", {
        adapter: "local-file",
        detail: `the local-file SECRETS adapter runs only in ${LOCAL_SECRETS_ENVS.join(" and ")}`,
        meta: { reason: "local_only", appEnv: o.appEnv },
      });
    this.file = o.file === null ? null : resolve(o.file ?? LOCAL_SECRETS_DEFAULT_FILE);
  }

  async health(): Promise<PortHealth> {
    const t = Date.now();
    let status: PortHealth["status"] = "up";
    try {
      await this.read();
    } catch {
      status = "down";
    }
    return { status, latency_ms: Date.now() - t, checked_at: new Date().toISOString() };
  }

  async get(path: string, version?: string): Promise<SecretValue> {
    checkPath("local-file", path, this.o.prefix);
    return this.change(path, "get", (s) => {
      const versions = s.secrets[path] ?? [];
      const v = version ? versions.find((x) => x.version === version) : versions.at(-1);
      if (!v) throw notFound("local-file", path);
      return { value: v.value, version: v.version, meta: { ...v.meta } };
    });
  }

  async put(path: string, value: string, meta: SecretMeta = {}): Promise<{ version: string }> {
    checkPath("local-file", path, this.o.prefix);
    return this.change(path, "put", (s) => {
      const versions = (s.secrets[path] ??= []);
      const version = String(versions.length + 1);
      versions.push({
        version,
        value,
        meta: { ...meta, dataClass: "SECRET", lastRotated: this.now().toISOString() },
      });
      return { version };
    });
  }

  async rotate(
    path: string,
    rotator: (current: SecretValue) => Promise<string>,
  ): Promise<{ version: string }> {
    const current = await this.get(path);
    return this.put(path, await rotator(current), current.meta);
  }

  async list(prefix: string): Promise<string[]> {
    const s = await this.read();
    return Object.keys(s.secrets)
      .filter((k) => k.startsWith(prefix) && (s.secrets[k]?.length ?? 0) > 0)
      .sort();
  }

  async lease(path: string, ttlSeconds: number): Promise<SecretValue & { expiresAt: string }> {
    // No dynamic credentials here: the stored value, with the asked expiry.
    const v = await this.get(path);
    return { ...v, expiresAt: new Date(this.now().getTime() + ttlSeconds * 1000).toISOString() };
  }

  async audit(path: string): Promise<Array<{ at: string; actor: string; op: string }>> {
    checkPath("local-file", path, this.o.prefix);
    return (await this.read()).audit
      .filter((a) => a.path === path)
      .map(({ at, actor, op }) => ({ at, actor, op }));
  }

  private now(): Date {
    return this.o.now?.() ?? new Date();
  }

  /** Read, apply `fn`, record the operation and write back, one change at a time (in and across processes). */
  private change<T>(path: string, op: string, fn: (s: Store) => T): Promise<T> {
    const run = async (): Promise<T> => {
      const unlock = await this.lock();
      try {
        const s = await this.read();
        const out = fn(s);
        s.audit.push({ at: this.now().toISOString(), actor: this.o.actor ?? "local", op, path });
        if (s.audit.length > AUDIT_KEEP) s.audit.splice(0, s.audit.length - AUDIT_KEEP);
        await this.write(s);
        return out;
      } finally {
        await unlock();
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async read(): Promise<Store> {
    if (this.file === null) return this.memory;
    let raw: string;
    try {
      raw = await readFile(this.file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return empty();
      throw this.unavailable();
    }
    try {
      const s = JSON.parse(raw) as Store;
      if (s.format !== 1 || typeof s.secrets !== "object" || !Array.isArray(s.audit)) throw 0;
      return s;
    } catch {
      // Never echo the file: it holds secret values.
      throw new PortError("IPB-PORT-002", "SECRETS", {
        adapter: "local-file",
        detail: "the local secrets file is not a valid store",
        meta: { reason: "corrupt" },
      });
    }
  }

  private async write(s: Store): Promise<void> {
    if (this.file === null) {
      this.memory = s;
      return;
    }
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(s)}\n`, { mode: 0o600 });
    await rename(tmp, this.file);
  }

  private async lock(): Promise<() => Promise<void>> {
    if (this.file === null) return async () => undefined;
    const lockFile = `${this.file}.lock`;
    await mkdir(dirname(lockFile), { recursive: true, mode: 0o700 });
    const until = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try {
        const h = await open(lockFile, "wx", 0o600);
        await h.close();
        return () => rm(lockFile, { force: true });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw this.unavailable();
        // A lock left by a process that died is taken over once stale.
        const age = await stat(lockFile).then(
          (st) => Date.now() - st.mtimeMs,
          () => 0,
        );
        if (age > LOCK_STALE_MS) await rm(lockFile, { force: true });
        else if (Date.now() > until) throw this.unavailable();
        else await new Promise((r) => setTimeout(r, 25));
      }
    }
  }

  private unavailable(): PortError {
    return new PortError("IPB-PORT-002", "SECRETS", {
      adapter: "local-file",
      detail: "the local secrets file cannot be read or locked",
      meta: { reason: "unavailable" },
    });
  }
}
