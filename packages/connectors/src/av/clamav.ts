// AV reference adapter `clamav` (IPB-01 AV: ClamAV in-cluster; IPB-02-44; LawDocsComply PR-LDC-41,
// R1-D-117; R1-plan M86). Scans a STORAGE object by streaming it to clamd's `INSTREAM` command.
//   * In the cluster only: clamd speaks plain TCP (port 3310) with no TLS, so the adapter connects
//     only when the configured host resolves to a loopback or private address (RFC 1918, CGNAT,
//     IPv6 unique-local); anything else is `ERROR` (`unavailable`) and the bytes are never sent.
//     The deployment's network policy limits who reaches clamd (threat model §3.113).
//   * Fail-closed: every failure is a verdict, never an exception a caller could swallow: engine
//     error, timeout, a size over `maxBytes` (keep it at or below clamd's `StreamMaxLength`), bytes
//     that do not match the reference's SHA-256, and a signature set older than
//     `maxSignatureAgeHours` (IPB-02-44 wants daily updates; 48 hours by default) are all `ERROR`.
//   * Only the verdict, the threat name and the engine version come back; the file's bytes are
//     never logged. Off behind `int.av.clamav.enabled` (`ERROR` with reason `disabled` while off).
//   * No vendor SDK: the clamd protocol is a few lines over `node:net`.
import { isIP, Socket } from "node:net";
import { lookup } from "node:dns/promises";
import {
  FileScanRequest,
  type AdapterDescriptor,
  type DocFileRef,
  type FileScanPort,
  type FileScanResult,
  type PortCall,
  type PortHealth,
  type ScanErrorReason,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";

const PORT = "AV";
const ADAPTER = "clamav";
const CHUNK = 64 * 1024;

export interface ClamavFileScanOptions {
  /** clamd's host in the cluster (a Service name or a private address). */
  host: string;
  /** clamd's TCP port (default 3310). */
  port?: number;
  /** Where the files to scan are read from (the tenant's STORAGE). */
  storage: StoragePort;
  /** `int.av.clamav.enabled` (off by default). */
  enabled: () => Promise<boolean> | boolean;
  /** Per-scan timeout (default 60 s). */
  timeoutMs?: number;
  /** Largest file sent to clamd (default 25 MiB, clamd's default `StreamMaxLength`). */
  maxBytes?: number;
  /** Signature sets older than this are `ERROR` (`stale_signatures`); default 48 hours. */
  maxSignatureAgeHours?: number;
  now?: () => Date;
  /** Tests only: resolve names without DNS. */
  resolve?: (host: string) => Promise<string>;
}

interface EngineVersion {
  engine: string;
  signaturesAt: Date | null;
}

export class ClamavFileScan implements FileScanPort {
  readonly descriptor: AdapterDescriptor = {
    port: PORT,
    adapter: ADAPTER,
    residency: "IN",
    maxDataClass: "REGULATED",
  };
  private version: { v: EngineVersion; at: number } | null = null;

  constructor(private readonly o: ClamavFileScanOptions) {}

  private get now(): Date {
    return this.o.now?.() ?? new Date();
  }

  async health(): Promise<PortHealth> {
    const started = Date.now();
    const done = (status: PortHealth["status"], v?: EngineVersion): PortHealth => ({
      status,
      latency_ms: Date.now() - started,
      checked_at: new Date().toISOString(),
      ...(v ? { detail: this.freshness(v) } : {}),
    });
    try {
      const pong = await this.command("zPING\0", 5_000);
      if (pong !== "PONG") return done("down");
      const v = await this.engineVersion(true);
      return done(this.stale(v) ? "degraded" : "up", v);
    } catch {
      return done("down");
    }
  }

  /**
   * Signature-database freshness for the health answer (PR-LDC-41): the engine, when the loaded
   * signatures were built, their age in whole hours and the limit past which every scan is `ERROR`.
   * A set with no build time counts as stale.
   */
  private freshness(v: EngineVersion): Record<string, string | number | boolean | null> {
    const max = this.o.maxSignatureAgeHours ?? 48;
    const age = v.signaturesAt
      ? Math.max(0, Math.floor((this.now.getTime() - v.signaturesAt.getTime()) / 3_600_000))
      : null;
    return {
      engine: v.engine.slice(0, 128),
      signatures_at: v.signaturesAt?.toISOString() ?? null,
      signature_age_hours: age,
      max_signature_age_hours: max,
      signatures_fresh: !this.stale(v),
    };
  }

  async scan(raw: DocFileRef, _call?: PortCall): Promise<FileScanResult> {
    const file = FileScanRequest.parse(raw);
    let engine: EngineVersion | null = null;
    const result = (
      verdict: FileScanResult["verdict"],
      extra: { threat?: string; reason?: ScanErrorReason } = {},
    ): FileScanResult => ({
      verdict,
      file,
      threat: extra.threat ?? null,
      reason: extra.reason ?? null,
      engine: engine?.engine ?? null,
      signaturesAt: engine?.signaturesAt?.toISOString() ?? null,
      scannedAt: this.now.toISOString(),
      adapter: ADAPTER,
    });
    if (!(await this.o.enabled())) return result("ERROR", { reason: "disabled" });

    let body: Uint8Array;
    try {
      body = (await this.o.storage.get(file.storageKey)).body;
    } catch {
      return result("ERROR", { reason: "unavailable" });
    }
    if (sha256Hex(body) !== file.sha256) return result("ERROR", { reason: "hash_mismatch" });
    if (body.length > (this.o.maxBytes ?? 25 * 1024 * 1024))
      return result("ERROR", { reason: "too_large" });

    try {
      engine = await this.engineVersion(false);
    } catch (e) {
      return result("ERROR", { reason: reasonOf(e) });
    }
    if (this.stale(engine)) return result("ERROR", { reason: "stale_signatures" });

    let reply: string;
    try {
      reply = await this.command(instream(body), this.o.timeoutMs ?? 60_000);
    } catch (e) {
      return result("ERROR", { reason: reasonOf(e) });
    }
    return parseScanReply(reply, result);
  }

  private stale(v: EngineVersion): boolean {
    if (!v.signaturesAt) return true;
    const maxMs = (this.o.maxSignatureAgeHours ?? 48) * 3_600_000;
    return this.now.getTime() - v.signaturesAt.getTime() > maxMs;
  }

  /** `VERSION`, cached for five minutes (the signature set changes at most a few times a day). */
  private async engineVersion(fresh: boolean): Promise<EngineVersion> {
    const t = Date.now();
    if (!fresh && this.version && t - this.version.at < 300_000) return this.version.v;
    const v = parseVersion(
      await this.command("zVERSION\0", Math.min(this.o.timeoutMs ?? 60_000, 10_000)),
    );
    this.version = { v, at: t };
    return v;
  }

  /** One clamd command on a fresh connection; resolves with the reply up to its NUL. */
  private async command(payload: string | Buffer[], timeoutMs: number): Promise<string> {
    const address = await this.address();
    return new Promise<string>((resolve, reject) => {
      const sock = new Socket();
      const chunks: Buffer[] = [];
      let settled = false;
      const finish = (err: Error | null) => {
        if (settled) return;
        settled = true;
        sock.destroy();
        const reply = Buffer.concat(chunks)
          .toString("utf8")
          .replace(/\0[\s\S]*$/, "")
          .trim();
        // clamd may answer (a size limit) and close while the stream is still being written.
        if (reply) resolve(reply);
        else reject(err ?? new ScanFailure("engine_error"));
      };
      sock.setTimeout(timeoutMs, () => finish(new ScanFailure("timeout")));
      sock.on("data", (d: Buffer) => {
        chunks.push(d);
        if (d.includes(0)) finish(null);
      });
      sock.on("end", () => finish(null));
      sock.on("error", () => finish(new ScanFailure("unavailable")));
      sock.connect({ host: address, port: this.o.port ?? 3310 }, () => {
        const parts = typeof payload === "string" ? [Buffer.from(payload, "latin1")] : payload;
        // Writes queue in order (backpressure only buffers); a failed write is an `error` event.
        for (const p of parts) sock.write(p);
      });
    });
  }

  /** The configured host, only when it is loopback or private (no plain TCP beyond the cluster). */
  private async address(): Promise<string> {
    const h = this.o.host.replace(/^\[|\]$/g, "");
    const a = isIP(h) ? h : await (this.o.resolve ?? defaultResolve)(h);
    if (!isClusterAddress(a)) throw new ScanFailure("unavailable");
    return a;
  }
}

class ScanFailure extends Error {
  constructor(readonly reason: ScanErrorReason) {
    super(reason);
  }
}

function reasonOf(e: unknown): ScanErrorReason {
  return e instanceof ScanFailure ? e.reason : "engine_error";
}

async function defaultResolve(host: string): Promise<string> {
  try {
    return (await lookup(host)).address;
  } catch {
    throw new ScanFailure("unavailable");
  }
}

/** `zINSTREAM\0`, then chunks of `<uint32 BE length><bytes>`, ended by a zero length. */
export function instream(body: Uint8Array): Buffer[] {
  const out: Buffer[] = [Buffer.from("zINSTREAM\0", "latin1")];
  for (let i = 0; i < body.length; i += CHUNK) {
    const part = Buffer.from(body.subarray(i, i + CHUNK));
    const len = Buffer.alloc(4);
    len.writeUInt32BE(part.length, 0);
    out.push(len, part);
  }
  out.push(Buffer.alloc(4));
  return out;
}

export function parseScanReply(
  reply: string,
  result: (
    v: FileScanResult["verdict"],
    extra?: { threat?: string; reason?: ScanErrorReason },
  ) => FileScanResult,
): FileScanResult {
  if (/^stream: OK$/.test(reply)) return result("CLEAN");
  const found = /^stream: (.+) FOUND$/.exec(reply);
  if (found?.[1]) return result("INFECTED", { threat: found[1].slice(0, 200) });
  if (/size limit exceeded/i.test(reply)) return result("ERROR", { reason: "too_large" });
  return result("ERROR", { reason: "engine_error" });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `ClamAV 1.5.4/27812/Mon Nov  9 08:24:07 2026` → engine `ClamAV 1.5.4/27812` and the date (UTC). */
export function parseVersion(reply: string): EngineVersion {
  const m = /^(ClamAV [^/\s]+)(?:\/(\d+))?(?:\/(.+))?$/.exec(reply.trim());
  if (!m?.[1]) throw new ScanFailure("engine_error");
  const engine = m[2] ? `${m[1]}/${m[2]}` : m[1];
  const d = /^\w{3} (\w{3})\s+(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec((m[3] ?? "").trim());
  const month = d ? MONTHS.indexOf(d[1] as string) : -1;
  const signaturesAt =
    d && month >= 0 ? new Date(Date.UTC(+d[6]!, month, +d[2]!, +d[3]!, +d[4]!, +d[5]!)) : null;
  return { engine, signaturesAt };
}

/** Loopback, RFC 1918, CGNAT (100.64.0.0/10) and IPv6 loopback or unique-local (fc00::/7). */
export function isClusterAddress(a: string): boolean {
  if (isIP(a) === 4) {
    const [x, y] = a.split(".").map(Number) as [number, number];
    return (
      x === 127 ||
      x === 10 ||
      (x === 172 && y >= 16 && y <= 31) ||
      (x === 192 && y === 168) ||
      (x === 100 && y >= 64 && y <= 127)
    );
  }
  if (isIP(a) === 6) {
    const s = a.toLowerCase();
    if (s === "::1") return true;
    const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (v4?.[1]) return isClusterAddress(v4[1]);
    return /^f[cd][0-9a-f]{2}:/.test(s);
  }
  return false;
}
