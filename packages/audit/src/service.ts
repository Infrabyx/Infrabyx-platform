// Ledger reads, corrections, verification and signed anchors (IPB-02-51, §02.4.7.1).
import type {
  AuditEntryInput,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import type { KmsPort, StoragePort } from "@infrabyx/contracts/ports";
import { storageKey } from "@infrabyx/contracts/ports";
import { IpbError } from "@infrabyx/contracts/errors";
import { internalEvent } from "@infrabyx/config/events";
import {
  canonicalize,
  newId,
  signRecord,
  verifyRecord,
  type SecretKey,
  type SignatureRecord,
} from "@infrabyx/crypto";
import {
  GENESIS_HASH,
  laneHeadMismatch,
  lanePosition,
  lanesRoot,
  verifyChain,
  type LaneHead,
  type LedgerEntry,
  type VerifyResult,
} from "./chain.js";
import {
  StatutoryCapture,
  captureLanes,
  verifyCaptureChain,
  type CaptureEntry,
  type CaptureVerifyResult,
} from "./capture.js";
import type { PgAuditSink } from "./sink.js";
import { BUSINESS_ID_PATTERN } from "@infrabyx/contracts/kernel";

export const LEDGER_RETENTION_DAYS = 2922; // 8 years (IPB-02-52)
export const ANCHOR_FORMAT = "infrabyx-audit-anchor/1";
/** An anchor that also signs the statutory capture's head (R1-D-25); written once a tenant has one. */
export const ANCHOR_FORMAT_CAPTURE = "infrabyx-audit-anchor/2";
/**
 * An anchor over chain lanes (PR-FBX-32, ADR-0005): every lane head of the ledger and of the
 * capture at the end of the day; `head_hash` and `capture_head_hash` are `lanesRoot` of each list.
 */
export const ANCHOR_FORMAT_LANES = "infrabyx-audit-anchor/3";

export interface AnchorBody {
  format: typeof ANCHOR_FORMAT | typeof ANCHOR_FORMAT_CAPTURE | typeof ANCHOR_FORMAT_LANES;
  tenant_id: string;
  anchor_date: string;
  seq: number;
  head_hash: string;
  head_entry_id: string | null;
  /** Format 2: the last captured change of the anchor date (`audit.capture`) and its hash. */
  capture_seq?: number;
  capture_head_hash?: string;
  /** Format 3: each ledger lane's head at the end of the day (`seq` is the position in the lane). */
  lanes?: LaneHead[];
  /** Format 3: each capture lane's head at the end of the day. */
  capture_lanes?: LaneHead[];
  created_at: string;
}

export interface AnchorFile extends AnchorBody {
  signature: SignatureRecord;
}

export interface LedgerFilter {
  resourceType?: string;
  resourceId?: string;
  action?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
  afterSeq?: number;
  limit?: number;
  /** Entries that carry this business id (PR-LDC-30; the GIN index of `audit/0011`). */
  businessId?: string;
}

/** The action and resource type `ExternalReads` (`@infrabyx/tenancy`) ledgers each read under. */
export const EXTERNAL_READ_LEDGER_ACTION = "platform.external_read";
const EXTERNAL_READ_RESOURCE = "external_read";

/** A count of ledgered external reads with the first and last read time (ISO 8601, UTC). */
export interface ExternalReadTotal {
  /** Ledgered reads: one entry per `ExternalReads.read` call. */
  reads: number;
  firstReadAt: string;
  lastReadAt: string;
}

/** Reads of one table under one grant in the day (PR-LDC-10, R1-D-81). */
export interface ExternalReadCount extends ExternalReadTotal {
  grantId: string;
  /** The grantee's principal id (the entry's actor), never their name or contact details. */
  granteeId: string;
  /** The table read, `schema.table`. */
  table: string;
}

/**
 * One tenant's external reads on one UTC day, counted from its `platform.external_read` ledger
 * entries. It carries ids, counts and times only: no IP or user-agent hash, trace id, digest or
 * grantee name. An entry holds its row count only inside a digest, so reads are counted, not rows.
 */
export interface ExternalReadSummary {
  tenantId: string;
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  reads: number;
  firstReadAt: string | null;
  lastReadAt: string | null;
  /** Per grant and table, ordered by grant, then table. */
  byGrantTable: ExternalReadCount[];
  /** Per grantee (principal), with the grants they read under. */
  byGrantee: (ExternalReadTotal & { granteeId: string; grantIds: string[] })[];
  /** Per table read. */
  byTable: (ExternalReadTotal & { table: string })[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function rollUp<T extends ExternalReadTotal>(
  into: Map<string, T>,
  key: string,
  c: ExternalReadCount,
  make: () => T,
): T {
  const t = into.get(key) ?? make();
  t.reads += c.reads;
  if (!t.firstReadAt || c.firstReadAt < t.firstReadAt) t.firstReadAt = c.firstReadAt;
  if (!t.lastReadAt || c.lastReadAt > t.lastReadAt) t.lastReadAt = c.lastReadAt;
  into.set(key, t);
  return t;
}

const sortedValues = <T>(m: Map<string, T>): T[] =>
  [...m.entries()].sort(([a], [b]) => cmp(a, b)).map(([, v]) => v);

export interface AuditServiceOptions {
  kernel: MutationKernel;
  sink: PgAuditSink;
  product: string;
  outbox?: OutboxWriter;
  storage?: StoragePort;
  kms?: KmsPort;
  /** KMS signing key for anchors, e.g. LOCAL_KMS_KEYS.anchorSigning with LocalKms. */
  anchorKeyId?: string;
  pseudonymKey?: SecretKey;
  retentionDays?: number;
}

interface Row extends Omit<LedgerEntry, "seq" | "occurred_at" | "lane_seq"> {
  seq: string | number;
  lane_seq?: string | number | null;
  occurred_at: Date;
}
const toEntry = (r: Row): LedgerEntry => ({
  ...r,
  seq: Number(r.seq),
  lane: r.lane ?? null,
  lane_seq: r.lane_seq === null || r.lane_seq === undefined ? null : Number(r.lane_seq),
  occurred_at: r.occurred_at.toISOString(),
});

/** The ledger lane heads as PostgreSQL holds them for the context tenant. */
async function ledgerLanes(tx: Tx): Promise<LaneHead[]> {
  const r = await tx.query<{ lane: number; lane_seq: string; entry_hash: string }>(
    "select lane, lane_seq::text as lane_seq, entry_hash from audit.ledger_lane order by lane",
  );
  return r.rows.map((h) => ({ lane: Number(h.lane), seq: Number(h.lane_seq), hash: h.entry_hash }));
}

interface DayHead extends LaneHead {
  entrySeq: number;
  id?: string;
}

/**
 * Each lane's last entry stamped before `before` (the anchor's day end), for `audit.ledger` or
 * `audit.capture`; lane 0 falls back to the entries written before `audit/0006`.
 */
async function dayHeads(
  tx: Tx,
  table: "ledger" | "capture",
  lanes: readonly number[],
  before: string,
): Promise<DayHead[]> {
  const idCol = table === "ledger" ? "id" : "null::text as id";
  const out: DayHead[] = [];
  for (const lane of lanes) {
    let r = await tx.query<{ id: string | null; seq: string; pos: string; entry_hash: string }>(
      `select ${idCol}, seq::text as seq, lane_seq::text as pos, entry_hash from audit.${table}
        where lane = $1 and occurred_at < ($2::date + 1)::timestamp at time zone 'UTC'
        order by lane_seq desc limit 1`,
      [lane, before],
    );
    if (!r.rows[0] && lane === 0)
      r = await tx.query(
        `select ${idCol}, seq::text as seq, seq::text as pos, entry_hash from audit.${table}
          where lane is null and occurred_at < ($1::date + 1)::timestamp at time zone 'UTC'
          order by audit.${table}.seq desc limit 1`,
        [before],
      );
    const h = r.rows[0];
    if (h)
      out.push({
        lane,
        seq: Number(h.pos),
        hash: h.entry_hash,
        entrySeq: Number(h.seq),
        ...(h.id ? { id: h.id } : {}),
      });
  }
  return out;
}

const plain = (h: readonly DayHead[]): LaneHead[] =>
  h.map(({ lane, seq, hash }) => ({ lane, seq, hash }));

export class AuditService {
  constructor(private readonly o: AuditServiceOptions) {}

  /** Tenant-scoped read for the Audit trails node and the tenant export slice (IPB-02-18). */
  async query(ctx: KernelContext, f: LedgerFilter = {}): Promise<LedgerEntry[]> {
    return this.o.kernel.read(ctx, (tx) => this.select(tx, f));
  }

  /**
   * The history of one business id (LawDocsComply PR-LDC-30, R1-D-125): every entry that carries it,
   * in ledger order, with actor, time, action and the before and after digests. Tenant-scoped by the
   * ledger's RLS; `afterSeq` and `limit` (at most 10,000, default 1,000) page through it.
   */
  async history(
    ctx: KernelContext,
    businessId: string,
    page: { afterSeq?: number; limit?: number } = {},
  ): Promise<LedgerEntry[]> {
    if (!BUSINESS_ID_PATTERN.test(businessId)) throw new RangeError("invalid business id");
    return this.o.kernel.read(ctx, (tx) =>
      this.select(tx, { ...page, limit: page.limit ?? 1_000, businessId }),
    );
  }

  /**
   * The context tenant's external reads on `day` (`YYYY-MM-DD`, UTC) for its daily report
   * (PR-LDC-10, R1-D-81): reads per grant and table, per grantee and per table, each with its first
   * and last read time, from the `platform.external_read` entries `ExternalReads` writes. It reads
   * in the tenant's context, so the ledger's RLS keeps it to that tenant; an external grantee may
   * not call it.
   */
  async externalReadSummary(ctx: KernelContext, day: string): Promise<ExternalReadSummary> {
    if (ctx.principal.type === "external")
      throw new IpbError("IPB-SEC-005", {
        detail: "an external grantee does not read the tenant's external-read summary",
      });
    if (!DAY.test(day) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day)
      throw new RangeError("day must be a calendar date, YYYY-MM-DD");
    const rows = await this.o.kernel.read(
      ctx,
      async (tx) =>
        (
          await tx.query<{
            resource_id: string;
            actor_id: string;
            reads: string;
            first_at: Date;
            last_at: Date;
          }>(
            `select resource_id, actor_id, count(*)::text as reads, min(occurred_at) as first_at,
                    max(occurred_at) as last_at
               from audit.ledger
              where action = $1 and resource_type = $2
                and occurred_at >= $3::date::timestamp at time zone 'UTC'
                and occurred_at < ($3::date + 1)::timestamp at time zone 'UTC'
              group by resource_id, actor_id`,
            [EXTERNAL_READ_LEDGER_ACTION, EXTERNAL_READ_RESOURCE, day],
          )
        ).rows,
    );
    const byGrantTable: ExternalReadCount[] = rows
      .map((r) => {
        // `<grant>/<table>`, as ExternalReads writes it.
        const cut = r.resource_id.indexOf("/");
        return {
          grantId: cut < 0 ? r.resource_id : r.resource_id.slice(0, cut),
          granteeId: r.actor_id,
          table: cut < 0 ? "" : r.resource_id.slice(cut + 1),
          reads: Number(r.reads),
          firstReadAt: r.first_at.toISOString(),
          lastReadAt: r.last_at.toISOString(),
        };
      })
      .sort(
        (a, b) =>
          cmp(a.grantId, b.grantId) || cmp(a.table, b.table) || cmp(a.granteeId, b.granteeId),
      );
    const empty = () => ({ reads: 0, firstReadAt: "", lastReadAt: "" });
    const grantees = new Map<
      string,
      ExternalReadTotal & { granteeId: string; grantIds: string[] }
    >();
    const tables = new Map<string, ExternalReadTotal & { table: string }>();
    const all = new Map<string, ExternalReadTotal>();
    for (const c of byGrantTable) {
      const g = rollUp(grantees, c.granteeId, c, () => ({
        granteeId: c.granteeId,
        grantIds: [],
        ...empty(),
      }));
      if (!g.grantIds.includes(c.grantId)) g.grantIds.push(c.grantId);
      rollUp(tables, c.table, c, () => ({ table: c.table, ...empty() }));
      rollUp(all, "", c, empty);
    }
    const total = all.get("");
    return {
      tenantId: ctx.tenantId,
      day,
      reads: total?.reads ?? 0,
      firstReadAt: total?.firstReadAt ?? null,
      lastReadAt: total?.lastReadAt ?? null,
      byGrantTable,
      byGrantee: sortedValues(grantees),
      byTable: sortedValues(tables),
    };
  }

  /** A correction is a new entry referencing the original; nothing is ever updated (NN-02). */
  async correct(
    tx: Tx,
    correctsId: string,
    entry: Omit<AuditEntryInput, "correctsId">,
  ): Promise<{ id: string }> {
    const r = await tx.query("select 1 from audit.ledger where id = $1", [correctsId]);
    if (r.rows.length === 0) throw new Error(`ledger entry ${correctsId} not found in this tenant`);
    return this.o.sink.record(tx, { ...entry, correctsId });
  }

  /** Recompute the tenant's chain; on a break, emit LedgerChainBroken (weekly verifier job). */
  async verify(ctx: KernelContext): Promise<VerifyResult> {
    const result = await this.o.kernel.read(
      ctx,
      async (tx) => {
        const r = verifyChain(await this.select(tx, {}));
        if (!r.ok) return r;
        // A deleted tail leaves its lane head ahead of the entries (PR-FBX-32).
        const off = laneHeadMismatch(r.lanes, await ledgerLanes(tx));
        return off
          ? {
              ...r,
              ok: false,
              break: {
                seq: r.head.seq,
                id: `lane:${off.lane}`,
                lane: off.lane,
                laneSeq: off.seq,
                reason: "head-mismatch" as const,
              },
            }
          : r;
      },
      { snapshot: true },
    );
    if (!result.ok && result.break) {
      const brk = result.break;
      await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          await this.o.sink.record(tx, {
            action: "audit.chain.break_detected",
            resourceType: "ledger",
            resourceId: brk.id,
            after: brk,
          });
          await this.emit(tx, "LedgerChainBroken", {
            tenant_id: ctx.tenantId,
            seq: brk.seq,
            entry_id: brk.id,
            reason: brk.reason,
          });
        },
        { action: "audit.chain.break_detected" },
      );
    }
    return result;
  }

  /**
   * The statutory capture's gap detector for the context tenant (R1-D-25): the chain, its head and
   * `audit.capture_problems()`. A break or a problem is ledgered and raises LedgerChainBroken.
   */
  async verifyCapture(ctx: KernelContext): Promise<CaptureVerifyResult> {
    const result = await new StatutoryCapture({ kernel: this.o.kernel }).verify(ctx);
    if (!result.ok) {
      const reason = result.break ? `capture-${result.break.reason}` : "capture-incomplete";
      await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          await this.o.sink.record(tx, {
            action: "audit.capture.break_detected",
            resourceType: "audit.capture",
            resourceId: String(result.break?.seq ?? result.head.seq),
            after: { reason, break: result.break ?? null, problems: result.problems },
          });
          await this.emit(tx, "LedgerChainBroken", {
            tenant_id: ctx.tenantId,
            seq: result.break?.seq ?? result.head.seq,
            entry_id: `capture:${result.break?.seq ?? result.head.seq}`,
            reason,
          });
        },
        { action: "audit.capture.break_detected" },
      );
    }
    return result;
  }

  /** Build, sign and store the anchor for `date` (YYYY-MM-DD, UTC) for the context tenant. */
  async writeAnchor(ctx: KernelContext, date: string, now = new Date()): Promise<AnchorFile> {
    const { storage, kms, anchorKeyId } = this.o;
    if (!storage || !kms || !anchorKeyId)
      throw new Error("anchors need STORAGE, KMS and anchorKeyId");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date must be YYYY-MM-DD");
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        // Every lane head of both chains at the end of the day (format 3, PR-FBX-32).
        const ledger = await dayHeads(
          tx,
          "ledger",
          (await ledgerLanes(tx)).map((l) => l.lane),
          date,
        );
        const capture = await dayHeads(
          tx,
          "capture",
          (await captureLanes(tx)).map((l) => l.lane),
          date,
        );
        const last = [...ledger].sort((a, b) => b.entrySeq - a.entrySeq)[0];
        const body: AnchorBody = {
          format: ANCHOR_FORMAT_LANES,
          tenant_id: ctx.tenantId,
          anchor_date: date,
          seq: last?.entrySeq ?? 0,
          head_hash: lanesRoot(plain(ledger)),
          head_entry_id: last?.id ?? null,
          lanes: plain(ledger),
          ...(capture.length
            ? {
                capture_seq: Math.max(...capture.map((c) => c.entrySeq)),
                capture_head_hash: lanesRoot(plain(capture)),
                capture_lanes: plain(capture),
              }
            : {}),
          created_at: now.toISOString(),
        };
        const signature = await signRecord(kms, anchorKeyId, canonicalize(body), { now });
        const file: AnchorFile = { ...body, signature };
        const id = newId("anc");
        const key = storageKey(ctx.tenantId, "audit", id.slice("anc_".length), "json");
        const retainUntil = new Date(
          Date.parse(`${date}T00:00:00Z`) +
            (this.o.retentionDays ?? LEDGER_RETENTION_DAYS) * 86_400_000,
        );
        await storage.putWithRetention(
          key,
          new TextEncoder().encode(`${JSON.stringify(file, null, 2)}\n`),
          retainUntil,
          {
            bucketClass: "AUDIT",
            contentType: "application/json",
          },
        );
        await tx.query(
          `insert into audit.anchor (id, tenant_id, anchor_date, seq, head_hash, signature, alg, key_id, storage_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            id,
            ctx.tenantId,
            date,
            body.seq,
            body.head_hash,
            signature.value,
            signature.alg,
            signature.key_id,
            key,
          ],
        );
        await this.o.sink.record(tx, {
          action: "audit.anchor.write",
          resourceType: "anchor",
          resourceId: id,
          after: body,
        });
        await this.emit(tx, "LedgerAnchorWritten", {
          tenant_id: ctx.tenantId,
          anchor_date: date,
          seq: body.seq,
          head_hash: body.head_hash,
          storage_key: key,
        });
        return file;
      },
      { action: "audit.anchor.write" },
    );
  }

  private async select(tx: Tx, f: LedgerFilter): Promise<LedgerEntry[]> {
    const where: string[] = [];
    const p: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      p.push(v);
      where.push(sql.replace("?", `$${p.length}`));
    };
    if (f.resourceType) add("resource_type = ?", f.resourceType);
    if (f.resourceId) add("resource_id = ?", f.resourceId);
    if (f.action) add("action = ?", f.action);
    if (f.actorId) add("actor_id = ?", f.actorId);
    if (f.from) add("occurred_at >= ?", f.from);
    if (f.to) add("occurred_at < ?", f.to);
    if (f.afterSeq !== undefined) add("seq > ?", f.afterSeq);
    if (f.businessId !== undefined) add("business_ids @> array[?]::text[]", f.businessId);
    const limit = f.limit ? ` limit ${Math.max(1, Math.min(10_000, Math.floor(f.limit)))}` : "";
    const r = await tx.query<Row>(
      `select * from audit.ledger${where.length ? ` where ${where.join(" and ")}` : ""} order by seq${limit}`,
      p,
    );
    return r.rows.map(toEntry);
  }

  private async emit(
    tx: Tx,
    event: "LedgerAnchorWritten" | "LedgerChainBroken",
    data: Record<string, unknown>,
  ): Promise<void> {
    if (!this.o.outbox) return;
    const envelope = internalEvent({
      product: this.o.product,
      event,
      tenantId: tx.ctx.tenantId,
      data,
      actorId: tx.ctx.principal.id,
      ...(this.o.pseudonymKey ? { pseudonymKey: this.o.pseudonymKey } : {}),
    });
    await this.o.outbox.publish(tx, "audit", { envelope });
  }
}

/** Verify an anchor file with the public key alone (Trust Centre download, IPB-02 §02.4.7.1). */
export function verifyAnchorFile(file: AnchorFile, publicKeySpkiDer: Uint8Array): boolean {
  const { signature, ...body } = file;
  return verifyRecord(signature, canonicalize(body), publicKeySpkiDer);
}

/** A tenant verifies its exported ledger slice up to a signed anchor. */
export function verifyAgainstAnchor(
  entries: readonly LedgerEntry[],
  file: AnchorFile,
  publicKeySpkiDer: Uint8Array,
): VerifyResult & { signatureValid: boolean } {
  const signatureValid = verifyAnchorFile(file, publicKeySpkiDer);
  if (file.format === ANCHOR_FORMAT_LANES) {
    const heads = file.lanes ?? [];
    const upTo = new Map(heads.map((l) => [l.lane, l.seq]));
    const r = verifyChain(
      entries.filter((e) => {
        const { lane, pos } = lanePosition(e);
        return pos <= (upTo.get(lane) ?? 0);
      }),
    );
    const off = r.ok
      ? (laneHeadMismatch(r.lanes, heads) ??
        (lanesRoot(heads) === file.head_hash ? undefined : heads[0]))
      : undefined;
    if (off)
      return {
        ...r,
        ok: false,
        signatureValid,
        break: {
          seq: file.seq,
          id: file.head_entry_id ?? "",
          lane: off.lane,
          laneSeq: off.seq,
          reason: "head-mismatch",
        },
      };
    return { ...r, signatureValid };
  }
  const r = verifyChain(entries.filter((e) => e.seq <= file.seq));
  if (
    r.ok &&
    (r.head.seq !== file.seq ||
      (r.lanes.find((l) => l.lane === 0)?.hash ?? GENESIS_HASH) !== file.head_hash)
  ) {
    return {
      ...r,
      ok: false,
      signatureValid,
      break: { seq: file.seq, id: file.head_entry_id ?? "", reason: "head-mismatch" },
    };
  }
  return { ...r, signatureValid };
}

/** A tenant or auditor verifies the exported capture up to a signed anchor (format 2). */
export function verifyCaptureAgainstAnchor(
  entries: readonly CaptureEntry[],
  file: AnchorFile,
  publicKeySpkiDer: Uint8Array,
): Omit<CaptureVerifyResult, "problems"> & { signatureValid: boolean } {
  const signatureValid = verifyAnchorFile(file, publicKeySpkiDer);
  const none = { seq: 0, hash: GENESIS_HASH };
  if (file.format === ANCHOR_FORMAT_LANES && file.capture_lanes) {
    const heads = file.capture_lanes;
    const upTo = new Map(heads.map((l) => [l.lane, l.seq]));
    const r = verifyCaptureChain(
      entries.filter((e) => {
        const { lane, pos } = lanePosition(e);
        return pos <= (upTo.get(lane) ?? 0);
      }),
    );
    const off = r.ok
      ? (laneHeadMismatch(r.lanes, heads) ??
        (lanesRoot(heads) === file.capture_head_hash ? undefined : heads[0]))
      : undefined;
    if (off)
      return {
        ...r,
        ok: false,
        break: {
          seq: file.capture_seq ?? 0,
          lane: off.lane,
          laneSeq: off.seq,
          reason: "head-mismatch",
        },
        signatureValid,
      };
    return { ...r, signatureValid };
  }
  if (file.format !== ANCHOR_FORMAT_CAPTURE || file.capture_seq === undefined)
    return {
      ok: false,
      checked: 0,
      head: none,
      lanes: [],
      break: { seq: 0, reason: "head-mismatch" },
      signatureValid,
    };
  const r = verifyCaptureChain(entries.filter((e) => e.seq <= file.capture_seq!));
  if (
    r.ok &&
    (r.head.seq !== file.capture_seq ||
      (r.lanes.find((l) => l.lane === 0)?.hash ?? GENESIS_HASH) !== file.capture_head_hash)
  )
    return {
      ...r,
      ok: false,
      break: { seq: file.capture_seq, reason: "head-mismatch" },
      signatureValid,
    };
  return { ...r, signatureValid };
}
