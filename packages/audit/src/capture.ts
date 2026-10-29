// Database-level statutory audit capture (Finbyx PR-FBX-10 item 2, owner request 29 Oct 2026;
// R1-D-25; migration `audit/0003`). PostgreSQL appends one `audit.capture` row for every insert,
// update and delete on a registered table; this module reads them, re-computes the per-tenant hash
// chain exactly as `audit.capture_row()` does, and reports what would make the capture incomplete
// (`audit.capture_problems()`): a missing or disabled trigger or guard, a sequence gap, a changed
// row, a head that does not match. `AuditService.writeAnchor` signs the capture head of the day
// into the daily anchor (format 2), and `AuditService.verifyCapture` reports a break.
import type { KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import { canonicalize, sha256Hex } from "@infrabyx/crypto";
import { GENESIS_HASH } from "./chain.js";

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
}

const digest = (v: string | null): string | null => (v === null ? null : sha256Hex(v));

/** The hashed form of an entry, field for field as `audit.capture_row()` builds it. */
export function canonicalCapture(e: Omit<CaptureEntry, "prev_hash" | "entry_hash">): string {
  return canonicalize({
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
  reason: "hash-mismatch" | "prev-hash-mismatch" | "sequence-gap" | "head-mismatch";
}

export interface CaptureVerifyResult {
  ok: boolean;
  checked: number;
  head: { seq: number; hash: string };
  break?: CaptureBreak;
  /** What makes the capture incomplete (`audit.capture_problems()`); empty when it is whole. */
  problems: string[];
}

/** Verify a run of entries from `start` (genesis by default); stops at the first break. */
export function verifyCaptureChain(
  entries: readonly CaptureEntry[],
  start: { seq: number; hash: string } = { seq: 0, hash: GENESIS_HASH },
): Omit<CaptureVerifyResult, "problems"> {
  let prev = start.hash;
  let seq = start.seq;
  let checked = 0;
  for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
    if (e.seq <= start.seq) continue;
    const fail = (reason: CaptureBreak["reason"]) => ({
      ok: false,
      checked,
      head: { seq, hash: prev },
      break: { seq: e.seq, reason },
    });
    if (e.seq !== seq + 1) return fail("sequence-gap");
    if (e.prev_hash !== prev) return fail("prev-hash-mismatch");
    if (captureHash(prev, e) !== e.entry_hash) return fail("hash-mismatch");
    prev = e.entry_hash;
    seq = e.seq;
    checked++;
  }
  return { ok: true, checked, head: { seq, hash: prev } };
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
  prev_hash, entry_hash`;

type Row = Omit<CaptureEntry, "seq"> & { seq: string };
const toEntry = (r: Row): CaptureEntry => ({ ...r, seq: Number(r.seq) });

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

/** The tenant's capture head as PostgreSQL holds it (genesis when nothing was captured). */
export async function captureHead(tx: Tx): Promise<{ seq: number; hash: string }> {
  const r = await tx.query<{ seq: string; entry_hash: string }>(
    "select seq::text as seq, entry_hash from audit.capture_head",
  );
  const h = r.rows[0];
  return h ? { seq: Number(h.seq), hash: h.entry_hash } : { seq: 0, hash: GENESIS_HASH };
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
        let start = { seq: 0, hash: GENESIS_HASH };
        let checked = 0;
        for (;;) {
          const rows = await selectCapture(tx, { afterSeq: start.seq, limit: batch });
          const r = verifyCaptureChain(rows, start);
          checked += r.checked;
          if (!r.ok) return { ...r, checked, problems };
          start = r.head;
          if (rows.length < batch) break;
        }
        const head = await captureHead(tx);
        if (head.seq !== start.seq || head.hash !== start.hash)
          return {
            ok: false,
            checked,
            head: start,
            break: { seq: head.seq, reason: "head-mismatch" as const },
            problems,
          };
        return { ok: problems.length === 0, checked, head: start, problems };
      },
      { snapshot: true },
    );
  }
}
