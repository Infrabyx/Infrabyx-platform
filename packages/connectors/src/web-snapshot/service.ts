// `PlatformWebSnapshot`, the web snapshot service (LawDocsComply PR-LDC-40, R1-D-117, R1-D-150,
// R1-D-176; threat model §3.125; plan `docs/phases/R1-web-snapshot-plan.md`). One public page is
// fetched through the EGRESS port (the `governed` adapter: allow-list, DNS pinning, refused
// ranges, every redirect re-checked), stored as received in the tenant's STORAGE with its SHA-256,
// scanned by the AV port, and recorded in `connectors.web_snapshot` (connectors/0006) with its
// ledger entry in the same transaction. Nothing is rendered and nothing else is fetched.
//
//   * Who: the caller's own context. Agents, external principals, break-glass sessions, platform
//     contexts and impersonation are refused (`IPB-SEC-004`): a snapshot is a tenant user's act.
//   * Only HTTP 200 is kept; the media type must be on `WEB_SNAPSHOT_CONTENT_TYPES` and a binary
//     type must start with its signature (`IPB-SEC-010`), so a page cannot pass as a PDF.
//   * The copy is released only on a `CLEAN` scan (`scanDecision`); `ERROR` keeps it quarantined
//     until `rescan`, `INFECTED` rejects it. `open` checks the stored bytes against the record.
//   * The ledger entry names hosts, type, size, hash and state; the full URLs go in `after`, which
//     the ledger keeps as a digest. The tenant id never leaves in the request.
import { PortError, IpbError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel } from "@infrabyx/contracts/kernel";
import {
  scanDecision,
  resolveWebSnapshotLimits,
  webSnapshotDownloadHeaders,
  WebSnapshotRequest,
  WEB_SNAPSHOT_CONTENT_TYPES,
  WEB_SNAPSHOT_EXTENSIONS,
  WEB_SNAPSHOT_ID_REGEX,
  WEB_SNAPSHOT_MAX_REDIRECTS,
  isValidStorageKey,
  type BucketClass,
  type EgressPort,
  type FileScanPort,
  type FileScanResult,
  type OpenedWebSnapshot,
  type StorageCompartment,
  type StoragePort,
  type WebSnapshot,
  type WebSnapshotContentType,
  type WebSnapshotEncoding,
  type WebSnapshotPort,
  type WebSnapshotState,
} from "@infrabyx/contracts/ports";
import { newId, sha256Hex } from "@infrabyx/crypto";
import type { RateLimitResult, RateLimitRule } from "@infrabyx/tenancy";

const PORT = "EGRESS";
const ADAPTER = "web-snapshot";
/** The rate-limit bucket of snapshots; the key is the tenant. */
export const WEB_SNAPSHOT_RATE_BUCKET = "web_snapshot";
/** A syntactically valid ULID, to check a prefix with the IPB-01-27 key rule. */
const PROBE_ULID = "01JAAAAAAAAAAAAAAAAAAAAAAA";

export interface PlatformWebSnapshotOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  egress: EgressPort;
  storage: StoragePort;
  av: FileScanPort;
  /** `RateLimiter` from `@infrabyx/tenancy` (or anything with its `consume`). */
  rateLimiter: {
    consume(
      ctx: Pick<KernelContext, "tenantId">,
      bucket: string,
      key: string,
      rule: RateLimitRule,
    ): Promise<RateLimitResult>;
  };
  /** `int.web_snapshot.enabled` (off by default). */
  enabled: () => Promise<boolean> | boolean;
  /** The tenant's `int.web_snapshot.allow_hosts`. */
  allowHosts: (tenantId: string) => Promise<readonly string[]> | readonly string[];
  /** `int.web_snapshot.per_hour` (default 60). */
  perHour?: (tenantId: string) => Promise<number> | number;
  now?: () => Date;
}

type Q = { query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> };

interface Row {
  id: string;
  tenant_id: string;
  requested_url: string;
  final_url: string;
  redirects: string[];
  http_status: number;
  content_type: WebSnapshotContentType;
  charset: string | null;
  content_encoding: WebSnapshotEncoding;
  bytes: number;
  sha256: string;
  storage_key: string;
  bucket_class: BucketClass;
  compartment: StorageCompartment | null;
  fetched_at: Date;
  state: WebSnapshotState;
  scan_verdict: string;
  scan_engine: string | null;
  scan_reason: string | null;
  scan_threat: string | null;
  scanned_at: Date;
  reference: string | null;
  requested_by: string;
  retain_until: Date | null;
}

const COLUMNS = `id, tenant_id, requested_url, final_url, redirects, http_status, content_type, charset,
  content_encoding, bytes, sha256, storage_key, bucket_class, compartment, fetched_at, state,
  scan_verdict, scan_engine, scan_reason, scan_threat, scanned_at, reference, requested_by, retain_until`;

const toSnapshot = (r: Row): WebSnapshot => ({
  id: r.id,
  tenantId: r.tenant_id,
  requestedUrl: r.requested_url,
  finalUrl: r.final_url,
  redirects: r.redirects,
  httpStatus: r.http_status,
  contentType: r.content_type,
  charset: r.charset,
  contentEncoding: r.content_encoding,
  bytes: r.bytes,
  sha256: r.sha256,
  fetchedAt: new Date(r.fetched_at).toISOString(),
  file: { storageKey: r.storage_key, sha256: r.sha256 },
  bucketClass: r.bucket_class,
  compartment: r.compartment,
  state: r.state,
  scan: {
    verdict: r.scan_verdict,
    engine: r.scan_engine,
    reason: r.scan_reason,
    threat: r.scan_threat,
    scannedAt: new Date(r.scanned_at).toISOString(),
  },
  reference: r.reference,
  requestedBy: r.requested_by,
  retainUntil: r.retain_until ? new Date(r.retain_until).toISOString() : null,
});

/** The leading bytes each binary type must start with (its file signature). */
const SIGNATURES: Partial<Record<WebSnapshotContentType, (b: Uint8Array) => boolean>> = {
  "application/pdf": (b) => starts(b, [0x25, 0x50, 0x44, 0x46, 0x2d]), // %PDF-
  "image/png": (b) => starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": (b) => starts(b, [0xff, 0xd8, 0xff]),
  "image/gif": (b) =>
    starts(b, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    starts(b, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
  "image/webp": (b) =>
    starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b.subarray(8), [0x57, 0x45, 0x42, 0x50]),
};
function starts(b: Uint8Array, sig: readonly number[]): boolean {
  return b.length >= sig.length && sig.every((x, i) => b[i] === x);
}

/** `text/html; charset=UTF-8` → `{ type: "text/html", charset: "UTF-8" }`. */
export function parseContentType(h: string): { type: string; charset: string | null } {
  const [type = "", ...params] = h.split(";");
  let charset: string | null = null;
  for (const p of params) {
    const m = /^\s*charset\s*=\s*"?([A-Za-z0-9._-]{1,40})"?\s*$/i.exec(p);
    if (m?.[1]) charset = m[1];
  }
  return { type: type.trim().toLowerCase(), charset };
}

const refused = (
  code: "IPB-SEC-003" | "IPB-SEC-004" | "IPB-SEC-010",
  detail: string,
  reason: string,
) => new PortError(code, PORT, { adapter: ADAPTER, detail, meta: { reason } });

export class PlatformWebSnapshot implements WebSnapshotPort {
  constructor(private readonly o: PlatformWebSnapshotOptions) {}

  private now(): Date {
    return this.o.now?.() ?? new Date();
  }

  /**
   * A snapshot is a tenant user's or service's act in its own tenant: an agent is `IPB-SEC-004`,
   * an impersonation `IPB-SEC-003`, and an external principal, a break-glass session, a platform
   * context or platform staff `IPB-SEC-004` too (the IPB has no separate code; `meta.reason` says
   * which).
   */
  private assertCaller(ctx: KernelContext): void {
    const p = ctx.principal;
    if (ctx.act) throw refused("IPB-SEC-003", "not during impersonation", "impersonation");
    const reason =
      p.type === "agent"
        ? "agent"
        : p.type === "external"
          ? "external"
          : p.type === "breakglass" || ctx.breakGlassGrantId !== undefined
            ? "break_glass"
            : ctx.scope === "platform" || p.roles.some((r) => r.startsWith("PLT_"))
              ? "platform"
              : null;
    if (reason) throw refused("IPB-SEC-004", "this caller may not take web snapshots", reason);
  }

  async archive(ctx: KernelContext, input: WebSnapshotRequest): Promise<WebSnapshot> {
    this.assertCaller(ctx);
    if (!(await this.o.enabled()))
      throw new PortError("IPB-PORT-001", PORT, {
        adapter: ADAPTER,
        detail: "web snapshots are off",
      });
    const req = WebSnapshotRequest.parse(input);
    const tenantId = ctx.tenantId;
    if (
      !isValidStorageKey(`${req.outputPrefix}/${PROBE_ULID}.html`) ||
      !req.outputPrefix.startsWith(`tenant/${tenantId}/`)
    )
      throw new IpbError("IPB-SEC-018", {
        detail:
          "a snapshot is written under the caller's own tenant prefix, tenant/<tenant>/<module>",
        meta: { reason: "prefix" },
      });
    if (req.retainUntil !== undefined && Date.parse(req.retainUntil) <= this.now().getTime())
      throw new RangeError("retainUntil is not in the future");
    const limits = resolveWebSnapshotLimits(req.limits);
    const perHour = Math.trunc(Number((await this.o.perHour?.(tenantId)) ?? 60));
    await this.o.rateLimiter.consume(ctx, WEB_SNAPSHOT_RATE_BUCKET, tenantId, {
      limit: Math.min(Math.max(perHour, 1), 1_000_000),
      windowSeconds: 3600,
    });

    const allowHosts = [...(await this.o.allowHosts(tenantId))];
    const res = await this.o.egress.fetch(req.url, {
      maxBytes: limits.maxBytes,
      timeoutMs: limits.timeoutMs,
      maxRedirects: WEB_SNAPSHOT_MAX_REDIRECTS,
      allowHosts,
      accept: "text/html,application/xhtml+xml,text/plain,application/pdf,image/*;q=0.8",
    });
    if (res.status !== 200)
      throw new PortError("IPB-PORT-002", PORT, {
        adapter: ADAPTER,
        detail: `the page answered ${res.status}; only 200 is kept`,
        meta: { reason: "status", vendorStatus: res.status },
      });
    if (res.body.byteLength > limits.maxBytes)
      throw new PortError("IPB-SEC-013", PORT, {
        adapter: ADAPTER,
        detail: `the page is over ${limits.maxBytes} bytes`,
        meta: { reason: "too_large" },
      });
    const ct = parseContentType(res.contentType);
    if (!(WEB_SNAPSHOT_CONTENT_TYPES as readonly string[]).includes(ct.type))
      throw refused(
        "IPB-SEC-010",
        "the page's media type is not one a snapshot may have",
        "content_type",
      );
    const type = ct.type as WebSnapshotContentType;
    const sig = SIGNATURES[type];
    if (sig && !sig(res.body))
      throw refused("IPB-SEC-010", `the bytes are not ${type}`, "signature");

    const id = newId("wsn");
    const sha256 = sha256Hex(res.body);
    // IPB-01-27 keys: `tenant/<tenant>/<module>/<ULID>.<ext>` (the snapshot id's ULID).
    const storageKey = `${req.outputPrefix}/${id.slice(4)}.${WEB_SNAPSHOT_EXTENSIONS[type]}`;
    const fetchedAt = this.now();
    const meta = {
      contentType: type,
      bucketClass: req.bucketClass,
      ...(req.compartment ? { compartment: req.compartment } : {}),
      sha256,
      tags: { kind: "web_snapshot", snapshot: id },
    };
    if (req.retainUntil)
      await this.o.storage.putWithRetention(storageKey, res.body, new Date(req.retainUntil), meta);
    else await this.o.storage.put(storageKey, res.body, meta);

    const scan = await this.o.av.scan({ storageKey, sha256 }, { tenantId });
    const state = stateOf(scan);
    const finalUrl = res.finalUrl ?? req.url;
    const redirects = (res.redirects ?? []).slice(0, WEB_SNAPSHOT_MAX_REDIRECTS);
    const row = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const q = tx as unknown as Q;
        const r = await q.query<Row>(
          `insert into connectors.web_snapshot (id, tenant_id, requested_url, final_url, redirects,
             http_status, content_type, charset, content_encoding, bytes, sha256, storage_key,
             bucket_class, compartment, fetched_at, state, scan_verdict, scan_engine, scan_reason,
             scan_threat, scanned_at, reference, requested_by, retain_until)
           values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
             $18, $19, $20, $21, $22, $23, $24)
           returning ${COLUMNS}`,
          [
            id,
            tenantId,
            req.url,
            finalUrl,
            JSON.stringify(redirects),
            res.status,
            type,
            ct.charset,
            res.contentEncoding ?? "identity",
            res.body.byteLength,
            sha256,
            storageKey,
            req.bucketClass,
            req.compartment ?? null,
            fetchedAt.toISOString(),
            state,
            scan.verdict,
            scan.engine,
            scan.reason,
            scan.threat,
            scan.scannedAt,
            req.reference ?? null,
            ctx.principal.id,
            req.retainUntil ?? null,
          ],
        );
        await this.o.audit.record(tx, {
          action: "connectors.web_snapshot.archive",
          resourceType: "connectors.web_snapshot",
          resourceId: id,
          after: {
            host: new URL(req.url).hostname,
            finalHost: new URL(finalUrl).hostname,
            requestedUrl: req.url,
            finalUrl,
            redirects: redirects.length,
            contentType: type,
            bytes: res.body.byteLength,
            sha256,
            state,
            verdict: scan.verdict,
          },
          ...(req.reference ? { businessIds: [businessId(req.reference)].filter(isId) } : {}),
        });
        return r.rows[0]!;
      },
      { action: "connectors.web_snapshot.archive" },
    );
    return toSnapshot(row);
  }

  async get(ctx: KernelContext, id: string): Promise<WebSnapshot | null> {
    if (!WEB_SNAPSHOT_ID_REGEX.test(id)) return null;
    const r = await this.o.kernel.read(ctx, (tx) =>
      (tx as unknown as Q).query<Row>(
        `select ${COLUMNS} from connectors.web_snapshot where id = $1`,
        [id],
      ),
    );
    return r.rows[0] ? toSnapshot(r.rows[0]) : null;
  }

  async open(ctx: KernelContext, id: string): Promise<OpenedWebSnapshot> {
    const s = await this.get(ctx, id);
    if (!s) throw new IpbError("IPB-STOR-001", { detail: "no such web snapshot" });
    if (s.state === "REJECTED")
      throw new PortError("IPB-SEC-011", PORT, {
        adapter: ADAPTER,
        detail: "the snapshot was rejected by the scan",
        meta: { reason: "infected" },
      });
    if (s.state !== "RELEASED")
      throw new PortError("IPB-SEC-015", PORT, {
        adapter: ADAPTER,
        detail: "the snapshot is quarantined pending a scan",
        meta: { reason: "quarantined" },
      });
    const obj = await this.o.storage.get(s.file.storageKey);
    if (obj.body.byteLength !== s.bytes || sha256Hex(obj.body) !== s.sha256)
      throw new PortError("IPB-SEC-015", PORT, {
        adapter: ADAPTER,
        detail: "the stored bytes do not match the snapshot's SHA-256",
        meta: { reason: "hash_mismatch" },
      });
    return { snapshot: s, body: obj.body, headers: webSnapshotDownloadHeaders(s) };
  }

  async rescan(ctx: KernelContext, id: string): Promise<WebSnapshot> {
    this.assertCaller(ctx);
    const s = await this.get(ctx, id);
    if (!s) throw new IpbError("IPB-STOR-001", { detail: "no such web snapshot" });
    if (s.state !== "QUARANTINED") return s;
    const scan = await this.o.av.scan(s.file, { tenantId: ctx.tenantId });
    const state = stateOf(scan);
    if (state === "QUARANTINED") return s;
    const row = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await (tx as unknown as Q).query<Row>(
          `update connectors.web_snapshot
              set state = $2, scan_verdict = $3, scan_engine = $4, scan_reason = $5, scan_threat = $6,
                  scanned_at = greatest(scanned_at, $7::timestamptz)
            where id = $1 and state = 'QUARANTINED'
          returning ${COLUMNS}`,
          [id, state, scan.verdict, scan.engine, scan.reason, scan.threat, scan.scannedAt],
        );
        if (!r.rows[0]) return null;
        await this.o.audit.record(tx, {
          action: "connectors.web_snapshot.rescan",
          resourceType: "connectors.web_snapshot",
          resourceId: id,
          before: { state: "QUARANTINED" },
          after: { state, verdict: scan.verdict, sha256: s.sha256 },
        });
        return r.rows[0];
      },
      { action: "connectors.web_snapshot.rescan" },
    );
    return row ? toSnapshot(row) : ((await this.get(ctx, id)) ?? s);
  }
}

function stateOf(scan: FileScanResult): WebSnapshotState {
  const d = scanDecision(scan);
  return d.action === "release" ? "RELEASED" : d.action === "reject" ? "REJECTED" : "QUARANTINED";
}

/** A product reference as a ledger business id (only when it fits the pattern). */
function businessId(ref: string): string {
  return ref.trim();
}
function isId(v: string): boolean {
  return /^[A-Za-z0-9_.:@/+=-]{1,128}$/.test(v);
}
