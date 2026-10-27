// Directory-backed STORAGE for local, dev, test and preview (`STORAGE_DIR`; refused elsewhere by
// `siteEnv`). The seed and the site run as separate processes, so the brand logo and media written
// by the seed must outlive it. Each object is one file named by its key's hash with a JSON header
// line; retention and tombstones behave as in the in-memory store this extends. Production uses
// the `s3` STORAGE adapter from `@infrabyx/connectors/storage`.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ObjectMeta } from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";
import { MemoryStorage } from "@infrabyx/testing";

interface Header {
  key: string;
  meta: ObjectMeta;
  retainUntil?: string;
  deleted?: boolean;
}

export class DirStorage extends MemoryStorage {
  // Plain fields only: the seed runs this file with Node's type stripping (no parameter properties).
  private readonly dir: string;

  constructor(dir: string) {
    super();
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".obj")) continue;
      const raw = readFileSync(join(dir, f));
      const nl = raw.indexOf(10);
      const h = JSON.parse(raw.subarray(0, nl).toString("utf8")) as Header;
      this.objects.set(h.key, {
        body: new Uint8Array(raw.subarray(nl + 1)),
        meta: h.meta,
        ...(h.retainUntil ? { retainUntil: new Date(h.retainUntil) } : {}),
        ...(h.deleted ? { deleted: true } : {}),
      });
    }
  }

  private flush(key: string): void {
    const o = this.objects.get(key);
    if (!o) return;
    const h: Header = {
      key,
      meta: o.meta,
      ...(o.retainUntil ? { retainUntil: o.retainUntil.toISOString() } : {}),
      ...(o.deleted ? { deleted: true } : {}),
    };
    const head = Buffer.from(`${JSON.stringify(h)}\n`, "utf8");
    writeFileSync(join(this.dir, `${sha256Hex(key)}.obj`), Buffer.concat([head, o.body]));
  }

  override async put(key: string, body: Uint8Array, meta: ObjectMeta): Promise<void> {
    await super.put(key, body, meta);
    this.flush(key);
  }

  override async putWithRetention(
    key: string,
    body: Uint8Array,
    retainUntil: Date,
    meta: ObjectMeta,
  ): Promise<void> {
    await super.putWithRetention(key, body, retainUntil, meta);
    this.flush(key);
  }

  override async delete(key: string): Promise<void> {
    await super.delete(key);
    this.flush(key);
  }
}
