// FILE_TRANSFER port: an SFTP client to one counterparty's server (Udofin PR-UDF-071, Finbyx's
// BureauSubmitter its second user; R1-D-254, ADR-0014; Ecosystem Spec §3.11 file-transfer fallback
// and §12.2 SFTP targets). Three methods, each one connection: `list` a directory, `get` a file
// under a byte cap (the bytes and their SHA-256), and `put` a new file that must not exist yet
// (there is no overwrite mode: `ifAbsent` is the literal `true`, and an adapter creates the file
// exclusively, never by a stat followed by a write).
//
// What every adapter keeps, and the contract cases in @infrabyx/testing check: paths are relative to
// the account's home, in safe segments (`fileTransferPath`); the call's class is at least the port
// default REGULATED and never SECRET; refusals carry a fixed label in `meta.reason`
// (`FILE_TRANSFER_REFUSALS`) and never a host, an address, a host key, a key or a server message.
// The `sftp` reference adapter (connectors) adds the transport rules: the host on the India-hosted
// allow-list, every resolved address public, the host key pinned by SHA-256 fingerprint (no trust on
// first use), an Ed25519 client key from SECRETS, and fixed modern algorithms.
import { z } from "zod";
import { PortError, type IpbErrorCode } from "../errors.js";
import type { Port, PortCall } from "./common.js";
import { effectiveDataClass } from "./payload-class.js";

const PORT = "FILE_TRANSFER";

/** The fixed labels of a refusal (`meta.reason`); each names one code below. */
export const FILE_TRANSFER_REFUSALS = {
  adapter_disabled: "IPB-PORT-001",
  adapter_unconfigured: "IPB-PORT-001",
  /** The client key in SECRETS is not one unencrypted OpenSSH ssh-ed25519 key. */
  client_key: "IPB-PORT-001",
  data_class: "IPB-PORT-003",
  /** The allow-list entry for the host does not declare residency `IN`. */
  residency: "IPB-PORT-003",
  invalid_path: "IPB-SEC-018",
  /** The host is not on the India-hosted allow-list. */
  not_allowed: "IPB-SEC-018",
  /** The host resolves to (or is) an address outside public unicast. */
  address: "IPB-SEC-018",
  /** The server's host key matches no pinned fingerprint. */
  host_key_mismatch: "IPB-SEC-018",
  too_large: "IPB-SEC-013",
  not_found: "IPB-STOR-001",
  not_a_file: "IPB-STOR-001",
  /** `put` on a path that exists: nothing was written. */
  exists: "IPB-STOR-003",
  dns: "IPB-PORT-002",
  auth_failed: "IPB-PORT-002",
  timeout: "IPB-PORT-002",
  aborted: "IPB-PORT-002",
  unavailable: "IPB-PORT-002",
} as const satisfies Record<string, IpbErrorCode>;
export type FileTransferRefusal = keyof typeof FILE_TRANSFER_REFUSALS;

/** A refusal with its fixed label and its code; `meta` holds only fixed labels and numbers. */
export function fileTransferRefusal(
  adapter: string,
  reason: FileTransferRefusal,
  detail: string,
  meta: Record<string, string | number | boolean> = {},
): PortError {
  return new PortError(FILE_TRANSFER_REFUSALS[reason], PORT, {
    adapter,
    detail,
    meta: { ...meta, reason },
  });
}

/** `get`: the cap when the call names none (32 MiB), and the most any call may ask (256 MiB). */
export const FILE_TRANSFER_GET_DEFAULT_BYTES = 32 * 1024 * 1024;
export const FILE_TRANSFER_MAX_BYTES = 256 * 1024 * 1024;
/** `list`: entries when the call names none, and the most any call may ask. */
export const FILE_TRANSFER_LIST_DEFAULT = 1_000;
export const FILE_TRANSFER_LIST_MAX = 10_000;
/** Path limits: segments and characters. */
export const FILE_TRANSFER_MAX_SEGMENTS = 16;
export const FILE_TRANSFER_MAX_PATH = 1024;

const SEGMENT = /^(?!\.{1,2}$)(?!-)[A-Za-z0-9._-]{1,255}$/;

/** Whether `name` is one safe path segment (a file or directory name the port can name back). */
export function isFileTransferName(name: string): boolean {
  return typeof name === "string" && SEGMENT.test(name);
}

/**
 * A path relative to the account's home: safe segments joined by `/` (no leading `/`, no `.` or
 * `..`, no empty segment, no backslash or control character). `.` alone names the home when
 * `allowHome` is set (`list`). Returns the path, or null when it is refused.
 */
export function fileTransferPath(p: unknown, o: { allowHome?: boolean } = {}): string | null {
  if (typeof p !== "string") return null;
  if (p === "." && o.allowHome) return ".";
  if (p.length === 0 || p.length > FILE_TRANSFER_MAX_PATH) return null;
  const parts = p.split("/");
  if (parts.length > FILE_TRANSFER_MAX_SEGMENTS) return null;
  return parts.every(isFileTransferName) ? p : null;
}

/** The path, or `invalid_path` before anything is sent. */
export function assertFileTransferPath(
  adapter: string,
  p: unknown,
  o: { allowHome?: boolean } = {},
): string {
  const ok = fileTransferPath(p, o);
  if (ok === null)
    throw fileTransferRefusal(
      adapter,
      "invalid_path",
      "a path relative to the home, in segments of A-Z a-z 0-9 . _ -",
    );
  return ok;
}

/** The call's class: at least the port default (REGULATED) and never SECRET. */
export function assertFileTransferClass(adapter: string, call?: PortCall): void {
  let cls;
  try {
    cls = effectiveDataClass(PORT, call);
  } catch {
    throw fileTransferRefusal(adapter, "data_class", "a caller may not lower the class");
  }
  if (cls === "SECRET")
    throw fileTransferRefusal(adapter, "data_class", "SECRET data is never sent to a file server");
}

/** Options every method takes: the PortCall fields and an abort signal. */
export interface FileTransferCallOptions extends PortCall {
  signal?: AbortSignal;
}

export interface FileTransferListOptions extends FileTransferCallOptions {
  /** At most this many entries (default 1 000, at most 10 000); past it `truncated` is true. */
  maxEntries?: number;
}

export interface FileTransferGetOptions extends FileTransferCallOptions {
  /** Refuse (`too_large`) a file over this many bytes (default 32 MiB, at most 256 MiB). */
  maxBytes?: number;
}

export interface FileTransferPutOptions extends FileTransferCallOptions {
  /** Required: the file must not exist (exclusive create); there is no overwrite. */
  ifAbsent: true;
}

export const FILE_TRANSFER_ENTRY_TYPES = ["file", "directory", "other"] as const;

export const FileTransferEntry = z
  .object({
    name: z.string().refine(isFileTransferName),
    type: z.enum(FILE_TRANSFER_ENTRY_TYPES),
    size: z.number().int().nonnegative(),
    modifiedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type FileTransferEntry = z.infer<typeof FileTransferEntry>;

export interface FileTransferListing {
  dir: string;
  /** Sorted by name. */
  entries: FileTransferEntry[];
  /** More entries exist than `maxEntries`. */
  truncated: boolean;
  /** Entries left out because their names are not safe segments (the port could not name them). */
  skipped: number;
}

export interface FileTransferFile {
  path: string;
  bytes: Uint8Array;
  size: number;
  /** Lower-case hex SHA-256 of exactly `bytes`. */
  sha256: string;
}

export interface FileTransferPutResult {
  path: string;
  size: number;
  /** Lower-case hex SHA-256 of the bytes written. */
  sha256: string;
}

export interface FileTransferPort extends Port {
  /** The entries of a directory (`.` is the home), sorted by name, at most `maxEntries`. */
  list(dir: string, o?: FileTransferListOptions): Promise<FileTransferListing>;
  /** A regular file's bytes and SHA-256, refused `too_large` past `maxBytes` (never read past it). */
  get(path: string, o?: FileTransferGetOptions): Promise<FileTransferFile>;
  /** A new file; refused `exists` when the path exists, and then nothing is written. */
  put(path: string, bytes: Uint8Array, o: FileTransferPutOptions): Promise<FileTransferPutResult>;
}

/** The resolved list limit of a call. */
export function fileTransferListLimit(o?: FileTransferListOptions): number {
  const n = o?.maxEntries ?? FILE_TRANSFER_LIST_DEFAULT;
  return Number.isInteger(n) && n > 0
    ? Math.min(n, FILE_TRANSFER_LIST_MAX)
    : FILE_TRANSFER_LIST_DEFAULT;
}

/** The resolved byte cap of a `get`. */
export function fileTransferGetLimit(o?: FileTransferGetOptions): number {
  const n = o?.maxBytes ?? FILE_TRANSFER_GET_DEFAULT_BYTES;
  return Number.isInteger(n) && n > 0
    ? Math.min(n, FILE_TRANSFER_MAX_BYTES)
    : FILE_TRANSFER_GET_DEFAULT_BYTES;
}

/** The checks of a `put` before anything is sent: the path, the class, the size and `ifAbsent`. */
export function preparePut(
  adapter: string,
  path: unknown,
  bytes: unknown,
  o: FileTransferPutOptions | undefined,
): string {
  const p = assertFileTransferPath(adapter, path);
  assertFileTransferClass(adapter, o);
  if (o?.ifAbsent !== true)
    throw fileTransferRefusal(
      adapter,
      "invalid_path",
      "put needs { ifAbsent: true }; there is no overwrite",
    );
  if (!(bytes instanceof Uint8Array))
    throw fileTransferRefusal(adapter, "invalid_path", "the bytes must be a Uint8Array");
  if (bytes.byteLength > FILE_TRANSFER_MAX_BYTES)
    throw fileTransferRefusal(adapter, "too_large", `at most ${FILE_TRANSFER_MAX_BYTES} bytes`, {
      maxBytes: FILE_TRANSFER_MAX_BYTES,
    });
  return p;
}

/** `aborted` when the call's signal has fired. */
export function assertNotAborted(adapter: string, signal?: AbortSignal): void {
  if (signal?.aborted) throw fileTransferRefusal(adapter, "aborted", "the call was aborted");
}
