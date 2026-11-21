// FILE_TRANSFER reference adapter `sftp` (Udofin PR-UDF-071, Finbyx's BureauSubmitter its second user;
// R1-D-254, ADR-0014; Ecosystem Spec §3.11 and §12.2: "key-based (ed25519), host key pinned"). An SFTP
// v3 client over `ssh2` (MIT; the only file that imports it), one connection per call, to one
// counterparty's server named by the product's configuration. Ed25519 SSH client authentication and
// the SSH transport are used on the owner's instruction of 21 Nov 2026 07:30 IST (R1-D-249, C-29).
//
// Before anything is sent (no network): the switch `int.file_transfer.sftp.enabled`; the target's
// shape; the target host on the India-hosted allow-list `int.file_transfer.sftp.allow_hosts` (exact
// names or IP literals, each declaring residency `IN`); the path rule and the call's class. Then:
//
//   * Address guard (IPB-02-43): the host is resolved once (every answer), and any answer outside
//     public unicast (`isPublicAddress`, the egress guard's) refuses the call; the socket goes to the
//     address checked, so a second lookup cannot rebind it.
//   * Client key: the SECRETS value at the target's `clientKeySecret`, read for each connection, must
//     be one unencrypted OpenSSH `ssh-ed25519` key (`assertSshEd25519PrivateKey`). Public-key
//     authentication only: no password, keyboard-interactive, agent or agent forwarding.
//   * Host key: the server's key must be `ssh-ed25519` and match a pinned SHA-256 fingerprint
//     (`sshHostKeyPinned`, constant time) before authentication; nothing is learnt from the server.
//   * Algorithms: fixed lists (`SFTP_ALGORITHMS`), never the library's defaults: curve25519-sha256,
//     ssh-ed25519, AES-256-GCM and ChaCha20-Poly1305 (AEAD only, so no MAC is negotiated), no
//     compression. The library's own identification string is replaced by a fixed one.
//   * `put` opens the file WRITE | CREAT | EXCL (no TRUNC): the server refuses an existing path
//     atomically, so nothing is ever overwritten or truncated. A write that fails after the create
//     removes the partial file the call made (best effort, `meta.partial_removed`).
//   * `get` refuses a file whose size is over the cap before reading, and stops reading the moment
//     the bytes pass it (a file that grows while read).
//   * One deadline for the call (`timeoutMs`), a handshake timeout (`connectTimeoutMs`) and the call's
//     AbortSignal; a cancelled put still removes its partial file when it can.
//   * Errors carry fixed labels and details only: never the host, an address, a host key, the key, a
//     path from the server or a server message.
//
// The `testOnly*` options exist for the pinned SFTP container on the test runner only; settings never
// feed them, so a deployment cannot set them (as `GovernedEgress.testAllowLoopback`). Off by default
// and `unproven` until a counterparty's test server has been used.
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Client, ConnectConfig, SFTPWrapper, Stats } from "ssh2";
import { z } from "zod";
import { PortError } from "@infrabyx/contracts/errors";
import {
  assertFileTransferClass,
  assertFileTransferPath,
  assertNotAborted,
  fileTransferGetLimit,
  fileTransferListLimit,
  fileTransferRefusal,
  isFileTransferName,
  preparePut,
  FILE_TRANSFER_LIST_MAX,
  type AdapterDescriptor,
  type FileTransferCallOptions,
  type FileTransferEntry,
  type FileTransferFile,
  type FileTransferGetOptions,
  type FileTransferListing,
  type FileTransferListOptions,
  type FileTransferPort,
  type FileTransferPutOptions,
  type FileTransferPutResult,
  type FileTransferRefusal,
  type PortHealth,
  type SecretsPort,
} from "@infrabyx/contracts/ports";
import {
  SSH_FINGERPRINT,
  SshKeyError,
  assertSshEd25519PrivateKey,
  sha256Hex,
  sshHostKeyPinned,
  sshPublicKeyType,
} from "@infrabyx/crypto";
import { isPublicAddress } from "../egress/governed.js";

const ADAPTER = "sftp";

/** The SSH algorithms offered, and the only ones (C-29). */
export const SFTP_ALGORITHMS = {
  kex: ["curve25519-sha256", "curve25519-sha256@libssh.org"],
  serverHostKey: ["ssh-ed25519"],
  cipher: ["aes256-gcm@openssh.com", "chacha20-poly1305@openssh.com"],
  // Never negotiated (every cipher is AEAD); the protocol needs a non-empty list.
  hmac: ["hmac-sha2-256-etm@openssh.com"],
  compress: ["none"],
} as const;

/** The identification string sent in place of the library's (which names it and its version). */
export const SFTP_CLIENT_IDENT = "InfrabyxFileTransfer_1";

export const SFTP_DEFAULTS = { port: 22, connectTimeoutMs: 15_000, timeoutMs: 120_000 } as const;
/** How long a cancelled call may take to remove a partial file before the connection is cut. */
const CLEANUP_GRACE_MS = 5_000;
const CHUNK = 1024 * 1024;
const OPEN = { READ: 0x01, WRITE: 0x02, CREAT: 0x08, EXCL: 0x20 } as const;
const STATUS = { EOF: 1, NO_SUCH_FILE: 2, PERMISSION_DENIED: 3 } as const;
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;

const HOST_NAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const host = z
  .string()
  .max(253)
  .refine(
    (h) => HOST_NAME.test(h) || isIP(h) !== 0,
    "an exact lower-case host name or an IP literal",
  );

/** One counterparty's server, from the product's configuration. */
export const SftpTarget = z
  .object({
    host,
    port: z.number().int().min(1).max(65_535).optional(),
    username: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/),
    /** The server's host key fingerprints (`SHA256:…`, as `ssh-keygen -l -E sha256` prints them). */
    hostKeySha256: z.array(z.string().regex(SSH_FINGERPRINT)).min(1).max(4),
    /** The SECRETS path of the client's OpenSSH Ed25519 private key. */
    clientKeySecret: z.string().min(1).max(512).regex(/^\S+$/),
  })
  .strict();
export type SftpTarget = z.infer<typeof SftpTarget>;

/** One entry of `int.file_transfer.sftp.allow_hosts`. */
export const SftpAllowedHost = z
  .object({
    host,
    /** Declared from the tenant's signed attestation of the server's location (§12.2). */
    residency: z.string().max(16),
    /** A reference to that attestation (Vendor Assurance Room or contract id), never its content. */
    attestation: z.string().max(256).optional(),
  })
  .strict();
export const SftpAllowList = z.array(SftpAllowedHost).max(256);
export type SftpAllowedHost = z.infer<typeof SftpAllowedHost>;

type Resolve = (h: string) => Promise<ReadonlyArray<{ address: string; family: number }>>;

export interface SftpFileTransferOptions {
  /** `int.file_transfer.sftp.enabled`, read on every call; off by default. */
  enabled: () => Promise<boolean> | boolean;
  /** `int.file_transfer.sftp.allow_hosts`, read on every call; empty refuses every connection. */
  allowHosts: () => Promise<unknown> | unknown;
  /** The counterparty's server (the product's configuration), read on every call. */
  target: () => Promise<unknown> | unknown;
  /** Where the client key is read from (`get` only). */
  secrets: Pick<SecretsPort, "get">;
  connectTimeoutMs?: number;
  /** The whole call, from the checks to the last byte. */
  timeoutMs?: number;
  /** `health()` connects and resolves the home directory (off: a probe every 30 s would load the counterparty). */
  healthProbe?: boolean;
  /** Tests only: resolve names without DNS. */
  testOnlyResolve?: Resolve;
  /** Tests only: admit 127.0.0.1 and ::1 (the SFTP container on the runner). Never in a deployment. */
  testOnlyAllowLoopback?: boolean;
}

interface Run {
  /** The cancellation reason once the deadline passed or the call was aborted. */
  cancelled(): "timeout" | "aborted" | null;
}

const refuse = (
  reason: FileTransferRefusal,
  detail: string,
  meta?: Record<string, string | number | boolean>,
): PortError => fileTransferRefusal(ADAPTER, reason, detail, meta);

export class SftpFileTransfer implements FileTransferPort {
  readonly descriptor: AdapterDescriptor = {
    port: "FILE_TRANSFER",
    adapter: ADAPTER,
    residency: "IN",
    maxDataClass: "REGULATED",
  };

  constructor(private readonly o: SftpFileTransferOptions) {}

  async health(): Promise<PortHealth> {
    const t = Date.now();
    const at = () => new Date().toISOString();
    try {
      if (!this.o.healthProbe) {
        await this.prepare();
        return { status: "up", latency_ms: 0, checked_at: at(), detail: { probed: false } };
      }
      await this.session(undefined, async (sftp) => {
        await new Promise<void>((res, rej) => sftp.realpath(".", (e) => (e ? rej(e) : res())));
      });
      return {
        status: "up",
        latency_ms: Date.now() - t,
        checked_at: at(),
        detail: { probed: true },
      };
    } catch (e) {
      const reason = (e as PortError).meta?.reason;
      return {
        status: "down",
        latency_ms: Date.now() - t,
        checked_at: at(),
        detail: { reason: typeof reason === "string" ? reason : "unavailable" },
      };
    }
  }

  async list(dir: string, o?: FileTransferListOptions): Promise<FileTransferListing> {
    const d = this.checkCall(dir, o, true);
    const max = fileTransferListLimit(o);
    return this.session(o, async (sftp, run) => {
      let handle: Buffer;
      try {
        handle = await call<Buffer>((cb) => sftp.opendir(d, cb));
      } catch (e) {
        throw await this.classify(sftp, d, e, "dir");
      }
      const entries: FileTransferEntry[] = [];
      let skipped = 0;
      let seen = 0;
      try {
        for (;;) {
          const c = run.cancelled();
          if (c) throw refuse(c, c === "timeout" ? "the call timed out" : "the call was aborted");
          let batch: Array<{ filename: string; attrs: Stats }> | false;
          try {
            batch = await call<Array<{ filename: string; attrs: Stats }> | false>((cb) =>
              sftp.readdir(handle, cb as never),
            );
          } catch (e) {
            if ((e as { code?: number }).code === STATUS.EOF) break;
            throw e;
          }
          if (!batch) break;
          for (const f of batch) {
            if (f.filename === "." || f.filename === "..") continue;
            if (!isFileTransferName(f.filename)) {
              skipped++;
              continue;
            }
            seen++;
            if (entries.length <= FILE_TRANSFER_LIST_MAX)
              entries.push(entryOf(f.filename, f.attrs));
          }
          if (entries.length > FILE_TRANSFER_LIST_MAX) break;
        }
      } finally {
        await closeQuietly(sftp, handle);
      }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return {
        dir: d,
        entries: entries.slice(0, max),
        truncated: seen > max,
        skipped,
      };
    });
  }

  async get(path: string, o?: FileTransferGetOptions): Promise<FileTransferFile> {
    const p = this.checkCall(path, o, false);
    const max = fileTransferGetLimit(o);
    return this.session(o, async (sftp, run) => {
      let handle: Buffer;
      try {
        handle = await call<Buffer>((cb) => sftp.open(p, OPEN.READ, cb));
      } catch (e) {
        throw await this.classify(sftp, p, e, "file");
      }
      try {
        const st = await call<Stats>((cb) => sftp.fstat(handle, cb));
        if (((st.mode ?? 0) & S_IFMT) !== S_IFREG) throw refuse("not_a_file", "not a regular file");
        if ((st.size ?? 0) > max) throw tooLarge(max);
        const chunks: Buffer[] = [];
        let total = 0;
        for (;;) {
          const c = run.cancelled();
          if (c) throw refuse(c, c === "timeout" ? "the call timed out" : "the call was aborted");
          // Ask for at most one byte past the cap, so a file that grew is seen without reading on.
          const want = Math.min(CHUNK, max + 1 - total);
          const buf = Buffer.allocUnsafe(want);
          const n = await call<number>((cb) =>
            sftp.read(handle, buf, 0, want, total, (e, bytes) => cb(e, bytes)),
          );
          if (n === 0) break;
          total += n;
          if (total > max) throw tooLarge(max);
          chunks.push(buf.subarray(0, n));
        }
        const bytes = new Uint8Array(Buffer.concat(chunks, total));
        return { path: p, bytes, size: total, sha256: sha256Hex(bytes) };
      } finally {
        await closeQuietly(sftp, handle);
      }
    });
  }

  async put(
    path: string,
    bytes: Uint8Array,
    o: FileTransferPutOptions,
  ): Promise<FileTransferPutResult> {
    const p = preparePut(ADAPTER, path, bytes, o);
    assertNotAborted(ADAPTER, o?.signal);
    const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sha256 = sha256Hex(bytes);
    return this.session(o, async (sftp, run) => {
      let handle: Buffer;
      try {
        // Exclusive create: the server refuses an existing path; nothing is truncated.
        handle = await call<Buffer>((cb) =>
          sftp.open(p, OPEN.WRITE | OPEN.CREAT | OPEN.EXCL, { mode: 0o640 }, cb),
        );
      } catch (e) {
        throw await this.classify(sftp, p, e, "create");
      }
      try {
        for (let at = 0; at < data.length; at += CHUNK) {
          const c = run.cancelled();
          if (c) throw refuse(c, c === "timeout" ? "the call timed out" : "the call was aborted");
          const len = Math.min(CHUNK, data.length - at);
          await call<void>((cb) => sftp.write(handle, data, at, len, at, (e) => cb(e)));
        }
        const st = await call<Stats>((cb) => sftp.fstat(handle, cb));
        if ((st.size ?? -1) !== data.length)
          throw refuse("unavailable", "the server holds another size than was written");
        await call<void>((cb) => sftp.close(handle, (e) => cb(e)));
        handle = Buffer.alloc(0);
        return { path: p, size: data.length, sha256 };
      } catch (e) {
        if (handle.length > 0) await closeQuietly(sftp, handle);
        // The call created this file: remove what it wrote, so a retry can create it again.
        const removed = await call<void>((cb) => sftp.unlink(p, (x) => cb(x))).then(
          () => true,
          () => false,
        );
        const base =
          e instanceof PortError ? e : refuse("unavailable", "the write did not complete");
        throw new PortError(base.code, "FILE_TRANSFER", {
          adapter: ADAPTER,
          detail: base.detail ?? "the write did not complete",
          meta: { ...(base.meta ?? {}), partial_removed: removed },
        });
      }
    });
  }

  // ---- checks before the network ---------------------------------------------------------------

  private checkCall(
    path: string,
    o: FileTransferCallOptions | undefined,
    allowHome: boolean,
  ): string {
    const p = assertFileTransferPath(ADAPTER, path, { allowHome });
    assertFileTransferClass(ADAPTER, o);
    assertNotAborted(ADAPTER, o?.signal);
    return p;
  }

  /** The switch, the target and the allow-list (no network). */
  private async prepare(): Promise<{ target: SftpTarget; port: number }> {
    if (!(await this.o.enabled())) throw refuse("adapter_disabled", "the SFTP adapter is off");
    const t = SftpTarget.safeParse(await this.o.target());
    if (!t.success) throw refuse("adapter_unconfigured", "no valid SFTP target is configured");
    const list = SftpAllowList.safeParse((await this.o.allowHosts()) ?? []);
    if (!list.success) throw refuse("adapter_unconfigured", "the SFTP allow-list is not valid");
    const entry = list.data.find((e) => e.host === t.data.host);
    if (!entry) throw refuse("not_allowed", "the target is not on the India-hosted allow-list");
    if (entry.residency !== "IN")
      throw refuse("residency", "the allow-list entry does not declare residency IN");
    return { target: t.data, port: t.data.port ?? SFTP_DEFAULTS.port };
  }

  private async resolveOnce(h: string): Promise<{ address: string }> {
    let answers: ReadonlyArray<{ address: string; family: number }>;
    if (isIP(h) !== 0) answers = [{ address: h, family: isIP(h) }];
    else {
      try {
        answers = await (this.o.testOnlyResolve
          ? this.o.testOnlyResolve(h)
          : dnsLookup(h, { all: true, verbatim: true }));
      } catch {
        throw refuse("dns", "the target did not resolve");
      }
    }
    if (answers.length === 0) throw refuse("dns", "the target has no address");
    const loopbackOk = this.o.testOnlyAllowLoopback === true;
    for (const a of answers) {
      const ok =
        isPublicAddress(a.address) ||
        (loopbackOk && (a.address === "127.0.0.1" || a.address === "::1"));
      if (!ok) throw refuse("address", "the target resolves to a refused address range");
    }
    return { address: answers[0]!.address };
  }

  private async clientKey(path: string): Promise<string> {
    let value: string;
    try {
      value = (await this.o.secrets.get(path)).value;
    } catch {
      throw refuse("unavailable", "the client key could not be read from SECRETS");
    }
    try {
      assertSshEd25519PrivateKey(value);
    } catch (e) {
      throw refuse(
        "client_key",
        "the client key is not one unencrypted OpenSSH ssh-ed25519 key",
        e instanceof SshKeyError ? { key_problem: e.reason } : {},
      );
    }
    return value;
  }

  // ---- one connection per call -------------------------------------------------------------------

  private async session<T>(
    o: FileTransferCallOptions | undefined,
    fn: (sftp: SFTPWrapper, run: Run) => Promise<T>,
  ): Promise<T> {
    const timeoutMs = Math.max(1, this.o.timeoutMs ?? SFTP_DEFAULTS.timeoutMs);
    const deadline = Date.now() + timeoutMs;
    let cancelled: "timeout" | "aborted" | null = null;
    const signal = o?.signal;
    const run: Run = { cancelled: () => cancelled ?? (signal?.aborted ? "aborted" : null) };
    const before = async <V>(p: Promise<V>): Promise<V> => {
      const ms = deadline - Date.now();
      if (ms <= 0) throw refuse("timeout", "the call timed out");
      let timer: NodeJS.Timeout | undefined;
      let onAbort: (() => void) | undefined;
      try {
        return await Promise.race([
          p,
          new Promise<never>((_, rej) => {
            timer = setTimeout(() => rej(refuse("timeout", "the call timed out")), ms);
            onAbort = () => rej(refuse("aborted", "the call was aborted"));
            signal?.addEventListener("abort", onAbort, { once: true });
          }),
        ]);
      } finally {
        clearTimeout(timer);
        if (onAbort) signal?.removeEventListener("abort", onAbort);
      }
    };

    const { target, port } = await this.prepare();
    const { address } = await before(this.resolveOnce(target.host));
    const privateKey = await before(this.clientKey(target.clientKeySecret));
    const { Client: SshClient } = (await import("ssh2")).default;
    const conn: Client = new SshClient();
    let hostKeyRefused = false;
    const cfg: ConnectConfig = {
      host: address,
      port,
      username: target.username,
      privateKey,
      authHandler: ["publickey"],
      tryKeyboard: false,
      agentForward: false,
      hostVerifier: (key: Buffer) => {
        const ok =
          sshPublicKeyType(key) === "ssh-ed25519" && sshHostKeyPinned(key, target.hostKeySha256);
        if (!ok) hostKeyRefused = true;
        return ok;
      },
      algorithms: {
        kex: [...SFTP_ALGORITHMS.kex],
        serverHostKey: [...SFTP_ALGORITHMS.serverHostKey],
        cipher: [...SFTP_ALGORITHMS.cipher],
        hmac: [...SFTP_ALGORITHMS.hmac],
        compress: [...SFTP_ALGORITHMS.compress],
      },
      readyTimeout: Math.max(1, this.o.connectTimeoutMs ?? SFTP_DEFAULTS.connectTimeoutMs),
      ident: SFTP_CLIENT_IDENT,
      keepaliveInterval: 0,
    };

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let grace: NodeJS.Timeout | undefined;
      const cut = () => {
        try {
          conn.destroy();
        } catch {
          // already closed
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        clearTimeout(grace);
        signal?.removeEventListener("abort", onAbort);
      };
      const fail = (e: PortError) => {
        if (settled) return;
        settled = true;
        cleanup();
        cut();
        reject(e);
      };
      const finish = (v: T) => {
        if (settled) return;
        settled = true;
        cleanup();
        conn.end();
        resolve(v);
      };
      let working = false;
      const cancel = (why: "timeout" | "aborted") => {
        if (settled || cancelled) return;
        cancelled = why;
        const e = refuse(why, why === "timeout" ? "the call timed out" : "the call was aborted");
        // Before the session is up, nothing to clean: cut now. Afterwards, let `fn` stop at its next
        // step (and remove a partial file) for a short grace, then cut.
        if (!working) fail(e);
        else grace = setTimeout(() => fail(e), CLEANUP_GRACE_MS);
      };
      const onAbort = () => cancel("aborted");
      const timer = setTimeout(() => cancel("timeout"), Math.max(1, deadline - Date.now()));
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) return cancel("aborted");

      conn.on("ready", () => {
        conn.sftp((err, sftp) => {
          if (err) return fail(refuse("unavailable", "the server refused the SFTP subsystem"));
          working = true;
          fn(sftp, run).then(finish, (e: unknown) =>
            fail(e instanceof PortError ? e : refuse("unavailable", "the SFTP call failed")),
          );
        });
      });
      conn.on("error", (e: Error & { level?: string }) => {
        if (hostKeyRefused)
          return fail(refuse("host_key_mismatch", "the server's host key matches no pinned key"));
        if (e.level === "client-authentication")
          return fail(refuse("auth_failed", "the server refused the client key"));
        if (e.level === "client-timeout") return fail(refuse("timeout", "the handshake timed out"));
        fail(refuse("unavailable", "the SFTP server could not be reached", { cause: causeOf(e) }));
      });
      conn.on("close", () => {
        if (hostKeyRefused)
          return fail(refuse("host_key_mismatch", "the server's host key matches no pinned key"));
        fail(refuse("unavailable", "the connection closed"));
      });
      try {
        conn.connect(cfg);
      } catch {
        fail(refuse("unavailable", "the SFTP connection could not start"));
      }
    });
  }

  /** What a failed open means, by asking the server for the path's type (no path in the answer). */
  private async classify(
    sftp: SFTPWrapper,
    p: string,
    e: unknown,
    want: "file" | "dir" | "create",
  ): Promise<PortError> {
    if (e instanceof PortError) return e;
    const st = await call<Stats>((cb) => sftp.stat(p, cb)).then(
      (s) => s,
      () => null,
    );
    const code = (e as { code?: number }).code;
    if (want === "create") {
      if (st) return refuse("exists", "the path exists; nothing was written");
      if (code === STATUS.NO_SUCH_FILE) return refuse("not_found", "no such directory");
      return refuse("unavailable", "the server refused to create the file", {
        cause: code === STATUS.PERMISSION_DENIED ? "permission_denied" : "failure",
      });
    }
    if (!st) {
      if (code === STATUS.NO_SUCH_FILE || code === undefined)
        return refuse("not_found", want === "dir" ? "no such directory" : "no such file");
      return refuse("unavailable", "the server refused to open the path", {
        cause: code === STATUS.PERMISSION_DENIED ? "permission_denied" : "failure",
      });
    }
    const type = (st.mode ?? 0) & S_IFMT;
    if (want === "dir" && type !== S_IFDIR)
      return refuse("not_a_file", "the path is not a directory");
    if (want === "file" && type !== S_IFREG) return refuse("not_a_file", "not a regular file");
    return refuse("unavailable", "the server refused to open the path", {
      cause: code === STATUS.PERMISSION_DENIED ? "permission_denied" : "failure",
    });
  }
}

function entryOf(name: string, a: Stats): FileTransferEntry {
  const t = (a.mode ?? 0) & S_IFMT;
  const mtime = typeof a.mtime === "number" && Number.isFinite(a.mtime) ? a.mtime : 0;
  return {
    name,
    type: t === S_IFREG ? "file" : t === S_IFDIR ? "directory" : "other",
    size: t === S_IFREG && Number.isSafeInteger(a.size) && a.size >= 0 ? a.size : 0,
    modifiedAt: new Date(mtime * 1000).toISOString(),
  };
}

function tooLarge(max: number): PortError {
  return refuse("too_large", `the file is over ${max} bytes`, { maxBytes: max });
}

/** A fixed label for a socket error's cause (errno names only). */
function causeOf(e: Error): string {
  const c = (e as NodeJS.ErrnoException).code;
  return typeof c === "string" && /^E[A-Z]{2,20}$/.test(c) ? c : "error";
}

function call<T>(f: (cb: (e: Error | null | undefined, v?: T) => void) => void): Promise<T> {
  return new Promise<T>((res, rej) => {
    try {
      f((e, v) => (e ? rej(e) : res(v as T)));
    } catch (x) {
      rej(x);
    }
  });
}

async function closeQuietly(sftp: SFTPWrapper, handle: Buffer): Promise<void> {
  await call<void>((cb) => sftp.close(handle, (e) => cb(e))).catch(() => undefined);
}
