// Database-level statutory audit capture (Finbyx PR-FBX-10 item 2, owner request 29 Oct 2026;
// R1-D-25; migration `audit/0003`). PostgreSQL appends one `audit.capture` row for every insert,
// update and delete on a registered table; this module reads them, re-computes the per-tenant hash
// chain exactly as `audit.capture_row()` does, and reports what would make the capture incomplete
// (`audit.capture_problems()`): a missing or disabled trigger or guard, a sequence gap, a changed
// row, a head that does not match. `AuditService.writeAnchor` signs the capture head of the day
// into the daily anchor (format 2), and `AuditService.verifyCapture` reports a break.
import type { KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import { canonicalize, sha256Hex } from "@infrabyx/crypto";
import { GENESIS_HASH, laneHeadMismatch, lanePosition, lanesRoot, type LaneHead } from "./chain.js";

export type CaptureOp = "insert" | "update" | "delete";

/** One captured change, with its JSON fields as PostgreSQL stores them (`jsonb::text`). */
export interface CaptureEntry {
  tenant_id: string;
  seq: number;
  table_name: string;
  op: CaptureOp;
  row_key: string;
  before_values: string | null;
  after_values: string | null;
  actor_id: string | null;
  entity_id: string | null;
  branch_id: string | null;
  breakglass_id: string | null;
  trace_id: string | null;
  action: string | null;
  reason: string | null;
  db_user: string;
  db_role: string;
  txid: string;
  /** ISO-8601 UTC with milliseconds. */
  occurred_at: string;
  prev_hash: string;
  entry_hash: string;
  /** The entry's lane and its position there (`audit/0006`, PR-FBX-32); null before it. */
  lane?: number | null;
  lane_seq?: string | number | null;
}

const digest = (v: string | null): string | null => (v === null ? null : sha256Hex(v));

/** The hashed form of an entry, field for field as `audit.capture_row()` builds it. */
export function canonicalCapture(e: Omit<CaptureEntry, "prev_hash" | "entry_hash">): string {
  // The lane and its position are hashed only when set, so entries before audit/0006 hash as before.
  const lane =
    e.lane === undefined || e.lane === null
      ? {}
      : { lane: Number(e.lane), lane_seq: Number(e.lane_seq) };
  return canonicalize({
    ...lane,
    action: e.action,
    actor_id: e.actor_id,
    after_digest: digest(e.after_values),
    before_digest: digest(e.before_values),
    branch_id: e.branch_id,
    breakglass_id: e.breakglass_id,
    db_role: e.db_role,
    db_user: e.db_user,
    entity_id: e.entity_id,
    occurred_at: e.occurred_at,
    op: e.op,
    reason_digest: digest(e.reason),
    row_key_digest: sha256Hex(e.row_key),
    seq: e.seq,
    table_name: e.table_name,
    tenant_id: e.tenant_id,
    trace_id: e.trace_id,
    txid: Number(e.txid),
  });
}

export const captureHash = (prev: string, e: Omit<CaptureEntry, "prev_hash" | "entry_hash">) =>
  sha256Hex(`${prev}\n${canonicalCapture(e)}`);

export interface CaptureBreak {
  seq: number;
  lane?: number;
  laneSeq?: number;
  reason: "hash-mismatch" | "prev-hash-mismatch" | "sequence-gap" | "head-mismatch";
}

export interface CaptureVerifyResult {
  ok: boolean;
  checked: number;
  /** The highest `seq` checked, and the root over every lane's head. */
  head: { seq: number; hash: string };
  /** Each lane's head after the check, by lane. */
  lanes: LaneHead[];
  break?: CaptureBreak;
  /** What makes the capture incomplete (`audit.capture_problems()`); empty when it is whole. */
  problems: string[];
}

/** Where verification starts: genesis by default, a lane-0 point, or every lane's known head. */
export type CaptureVerifyStart = { seq: number; hash: string } | { lanes: readonly LaneHead[] };

/** Verify a run of entries lane by lane from `start` (genesis by default); stops at the first break. */
export function verifyCaptureChain(
  entries: readonly CaptureEntry[],
  start?: CaptureVerifyStart,
): Omit<CaptureVerifyResult, "problems"> {
  const lanes = new Map<number, LaneHead>();
  if (start && "lanes" in start) for (const l of start.lanes) lanes.set(l.lane, { ...l });
  else if (start) lanes.set(0, { lane: 0, seq: start.seq, hash: start.hash });
  let checked = 0;
  let top = 0;
  const result = (ok: boolean, brk?: CaptureBreak) => {
    const all = [...lanes.values()].sort((a, b) => a.lane - b.lane);
    return {
      ok,
      checked,
      head: { seq: top, hash: lanesRoot(all) },
      lanes: all,
      ...(brk ? { break: brk } : {}),
    };
  };
  for (const e of [...entries].sort((a, b) => Number(a.seq) - Number(b.seq))) {
    const { lane, pos } = lanePosition(e);
    const h = lanes.get(lane) ?? { lane, seq: 0, hash: GENESIS_HASH };
    if (pos <= h.seq) continue;
    const fail = (reason: CaptureBreak["reason"]) =>
      result(false, { seq: Number(e.seq), lane, laneSeq: pos, reason });
    if (pos !== h.seq + 1) return fail("sequence-gap");
    if (e.prev_hash !== h.hash) return fail("prev-hash-mismatch");
    if (captureHash(h.hash, e) !== e.entry_hash) return fail("hash-mismatch");
    lanes.set(lane, { lane, seq: pos, hash: e.entry_hash });
    top = Math.max(top, Number(e.seq));
    checked++;
  }
  return result(true);
}

export interface CaptureFilter {
  table?: string;
  /** The row key, as the registered key columns' values (e.g. `{ id: "jrn_…" }`). */
  rowKey?: Record<string, unknown>;
  from?: Date;
  to?: Date;
  afterSeq?: number;
  limit?: number;
}

const COLUMNS = `tenant_id, seq::text as seq, table_name, op, row_key::text as row_key,
  before_values::text as before_values, after_values::text as after_values, actor_id, entity_id,
  branch_id, breakglass_id, trace_id, action, reason, db_user, db_role, txid::text as txid,
  to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as occurred_at,
  prev_hash, entry_hash, lane, lane_seq::text as lane_seq`;

type Row = Omit<CaptureEntry, "seq"> & { seq: string };
const toEntry = (r: Row): CaptureEntry => ({
  ...r,
  seq: Number(r.seq),
  lane: r.lane ?? null,
  lane_seq: r.lane_seq === null || r.lane_seq === undefined ? null : Number(r.lane_seq),
});

export async function selectCapture(tx: Tx, f: CaptureFilter = {}): Promise<CaptureEntry[]> {
  const where: string[] = [];
  const p: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    p.push(v);
    where.push(sql.replace("?", `$${p.length}`));
  };
  if (f.table) add("table_name = ?", f.table);
  if (f.rowKey) add("row_key = ?::jsonb", JSON.stringify(f.rowKey));
  if (f.from) add("occurred_at >= ?", f.from.toISOString());
  if (f.to) add("occurred_at < ?", f.to.toISOString());
  if (f.afterSeq !== undefined) add("seq > ?", f.afterSeq);
  p.push(Math.min(f.limit ?? 1000, 10_000));
  const r = await tx.query<Row>(
    `select ${COLUMNS} from audit.capture ${where.length ? `where ${where.join(" and ")}` : ""}
      order by audit.capture.seq limit $${p.length}`,
    p,
  );
  return r.rows.map(toEntry);
}

/** The tenant's capture lane heads as PostgreSQL holds them (none when nothing was captured). */
export async function captureLanes(tx: Tx): Promise<LaneHead[]> {
  const r = await tx.query<{ lane: number; lane_seq: string; entry_hash: string }>(
    "select lane, lane_seq::text as lane_seq, entry_hash from audit.capture_lane order by lane",
  );
  return r.rows.map((h) => ({ lane: Number(h.lane), seq: Number(h.lane_seq), hash: h.entry_hash }));
}

/** The highest `seq` captured for the tenant and the root over its lane heads. */
export async function captureHead(tx: Tx): Promise<{ seq: number; hash: string }> {
  const lanes = await captureLanes(tx);
  const r = await tx.query<{ seq: string | null }>(
    "select max(seq)::text as seq from audit.capture",
  );
  return { seq: Number(r.rows[0]?.seq ?? 0), hash: lanesRoot(lanes) };
}

export class StatutoryCapture {
  constructor(private readonly o: { kernel: MutationKernel; batch?: number }) {}

  /** The captured changes of the context tenant (auditors, the export slice). */
  query(ctx: KernelContext, f: CaptureFilter = {}): Promise<CaptureEntry[]> {
    return this.o.kernel.read(ctx, (tx) => selectCapture(tx, f));
  }

  /**
   * The gap detector: the whole chain of the context tenant, its head, and every way the capture
   * could be off. `ok` is false on any break or problem.
   */
  async verify(ctx: KernelContext): Promise<CaptureVerifyResult> {
    const batch = this.o.batch ?? 5000;
    return this.o.kernel.read(
      ctx,
      async (tx) => {
        const problems = (
          await tx.query<{ p: string }>("select audit.capture_problems() as p")
        ).rows.map((r) => r.p);
        let lanes: LaneHead[] = [];
        let afterSeq = 0;
        let top = 0;
        let checked = 0;
        for (;;) {
          const rows = await selectCapture(tx, { afterSeq, limit: batch });
          const r = verifyCaptureChain(rows, { lanes });
          checked += r.checked;
          if (!r.ok) return { ...r, checked, problems };
          lanes = r.lanes;
          top = Math.max(top, r.head.seq);
          if (rows.length < batch) break;
          afterSeq = Number(rows[rows.length - 1]!.seq);
        }
        const done = { seq: top, hash: lanesRoot(lanes) };
        const off = laneHeadMismatch(lanes, await captureLanes(tx));
        if (off)
          return {
            ok: false,
            checked,
            head: done,
            lanes,
            break: { seq: top, lane: off.lane, laneSeq: off.seq, reason: "head-mismatch" as const },
            problems,
          };
        return { ok: problems.length === 0, checked, head: done, lanes, problems };
      },
      { snapshot: true },
    );
  }
}
