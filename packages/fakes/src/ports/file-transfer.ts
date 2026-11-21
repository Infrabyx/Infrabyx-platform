// FILE_TRANSFER fake (Udofin PR-UDF-071, R1-D-254, ADR-0014): an in-memory file server, the CI-green
// alternative to the `sftp` adapter. It keeps the port's rules as every adapter must: the path rule,
// the class (at least REGULATED, never SECRET), the byte cap of `get` (checked on the stored size, so
// nothing past the cap is returned), no overwrite (`put` on an existing path is `exists` and changes
// nothing), `not_found` (also for a put into a directory that does not exist, as on a real server)
// and `not_a_file`, the list cap, an `enabled` switch and the call's abort signal. It has no
// transport: the host, address, host-key and client-key rules are the `sftp` adapter's.
import {
  assertFileTransferClass,
  assertFileTransferPath,
  assertNotAborted,
  fileTransferGetLimit,
  fileTransferListLimit,
  fileTransferRefusal,
  isFileTransferName,
  preparePut,
  type AdapterDescriptor,
  type FileTransferEntry,
  type FileTransferFile,
  type FileTransferGetOptions,
  type FileTransferListing,
  type FileTransferListOptions,
  type FileTransferPort,
  type FileTransferPutOptions,
  type FileTransferPutResult,
  type PortHealth,
} from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";

const ADAPTER = "fake-file-transfer";

/** Inputs a FILE_TRANSFER adapter's contract run needs. */
export interface FileTransferFixtures<P extends FileTransferPort = FileTransferPort> {
  /** A directory that exists and the account may write to (relative to the home). */
  writableDir(p: P): Promise<string> | string;
  /** A directory that exists inside `dir` (for the `not_a_file` and listing cases). */
  subdirOf(p: P, dir: string): Promise<string> | string;
}

export interface FakeFileTransferOptions {
  enabled?: () => boolean;
  now?: () => Date;
}

interface Stored {
  bytes: Uint8Array;
  modifiedAt: string;
}

const byName = (a: FileTransferEntry, b: FileTransferEntry): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

export class FakeFileTransfer implements FileTransferPort {
  readonly descriptor: AdapterDescriptor = {
    port: "FILE_TRANSFER",
    adapter: ADAPTER,
    residency: "IN",
    maxDataClass: "REGULATED",
  };
  private readonly files = new Map<string, Stored>();
  private readonly dirs = new Set<string>();
  private runs = 0;

  constructor(private readonly o: FakeFileTransferOptions = {}) {}

  /** The files held, by path (copies). */
  get stored(): ReadonlyMap<string, Uint8Array> {
    return new Map([...this.files].map(([k, v]) => [k, new Uint8Array(v.bytes)]));
  }

  async health(): Promise<PortHealth> {
    return {
      status: this.on() ? "up" : "down",
      latency_ms: 0,
      checked_at: this.now().toISOString(),
    };
  }

  /** Put a file directly, making its directories (a counterparty's file to read). */
  seed(path: string, bytes: Uint8Array): void {
    const p = assertFileTransferPath(ADAPTER, path);
    if (this.files.has(p) || this.dirs.has(p))
      throw fileTransferRefusal(ADAPTER, "exists", "the path exists");
    const parts = p.split("/");
    if (parts.length > 1) this.mkdir(parts.slice(0, -1).join("/"));
    this.files.set(p, { bytes: new Uint8Array(bytes), modifiedAt: this.now().toISOString() });
  }

  /** Make a directory and its parents, as the counterparty's server would have them. */
  mkdir(path: string): void {
    const p = assertFileTransferPath(ADAPTER, path);
    const parts = p.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const d = parts.slice(0, i).join("/");
      if (this.files.has(d)) throw fileTransferRefusal(ADAPTER, "exists", "a file is at the path");
      this.dirs.add(d);
    }
  }

  /** A new, empty directory no other run of this fake used. */
  freshDir(): string {
    this.runs += 1;
    const d = `run-${this.runs}`;
    this.mkdir(d);
    return d;
  }

  async list(dir: string, o?: FileTransferListOptions): Promise<FileTransferListing> {
    const d = this.begin(dir, o, true);
    if (d !== "." && this.files.has(d))
      throw fileTransferRefusal(ADAPTER, "not_a_file", "the path is a file, not a directory");
    if (d !== "." && !this.dirs.has(d))
      throw fileTransferRefusal(ADAPTER, "not_found", "no such directory");
    const prefix = d === "." ? "" : `${d}/`;
    const child = (path: string): string | null => {
      if (!path.startsWith(prefix)) return null;
      const rest = path.slice(prefix.length);
      return rest.includes("/") || !isFileTransferName(rest) ? null : rest;
    };
    const entries: FileTransferEntry[] = [];
    for (const [path, f] of this.files) {
      const name = child(path);
      if (name)
        entries.push({ name, type: "file", size: f.bytes.byteLength, modifiedAt: f.modifiedAt });
    }
    const at = this.now().toISOString();
    for (const path of this.dirs) {
      const name = child(path);
      if (name) entries.push({ name, type: "directory", size: 0, modifiedAt: at });
    }
    entries.sort(byName);
    const max = fileTransferListLimit(o);
    return { dir: d, entries: entries.slice(0, max), truncated: entries.length > max, skipped: 0 };
  }

  async get(path: string, o?: FileTransferGetOptions): Promise<FileTransferFile> {
    const p = this.begin(path, o, false);
    const f = this.files.get(p);
    if (!f) {
      if (this.dirs.has(p))
        throw fileTransferRefusal(ADAPTER, "not_a_file", "the path is a directory");
      throw fileTransferRefusal(ADAPTER, "not_found", "no such file");
    }
    const max = fileTransferGetLimit(o);
    if (f.bytes.byteLength > max)
      throw fileTransferRefusal(ADAPTER, "too_large", `the file is over ${max} bytes`, {
        maxBytes: max,
      });
    const bytes = new Uint8Array(f.bytes);
    return { path: p, bytes, size: bytes.byteLength, sha256: sha256Hex(bytes) };
  }

  async put(
    path: string,
    bytes: Uint8Array,
    o: FileTransferPutOptions,
  ): Promise<FileTransferPutResult> {
    if (!this.on()) throw fileTransferRefusal(ADAPTER, "adapter_disabled", "the fake is off");
    const p = preparePut(ADAPTER, path, bytes, o);
    assertNotAborted(ADAPTER, o?.signal);
    // Exclusive create: an existing file or directory refuses, and nothing changes.
    if (this.files.has(p) || this.dirs.has(p))
      throw fileTransferRefusal(ADAPTER, "exists", "the path exists; nothing was written");
    const parent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".";
    if (parent !== "." && !this.dirs.has(parent))
      throw fileTransferRefusal(ADAPTER, "not_found", "no such directory");
    const copy = new Uint8Array(bytes);
    this.files.set(p, { bytes: copy, modifiedAt: this.now().toISOString() });
    return { path: p, size: copy.byteLength, sha256: sha256Hex(copy) };
  }

  private begin(
    path: string,
    o: FileTransferListOptions | FileTransferGetOptions | undefined,
    allowHome: boolean,
  ): string {
    if (!this.on()) throw fileTransferRefusal(ADAPTER, "adapter_disabled", "the fake is off");
    const p = assertFileTransferPath(ADAPTER, path, { allowHome });
    assertFileTransferClass(ADAPTER, o);
    assertNotAborted(ADAPTER, o?.signal);
    return p;
  }

  private on(): boolean {
    return this.o.enabled ? this.o.enabled() : true;
  }

  private now(): Date {
    return this.o.now ? this.o.now() : new Date();
  }
}

/** The fake's fixtures. */
export const fileTransferFakeFixtures: FileTransferFixtures<FileTransferPort> = {
  writableDir: (p) => (p as FakeFileTransfer).freshDir(),
  subdirOf: (p, dir) => {
    const d = `${dir}/sub`;
    (p as FakeFileTransfer).mkdir(d);
    return d;
  },
};
