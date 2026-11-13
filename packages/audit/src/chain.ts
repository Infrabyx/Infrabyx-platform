// The ledger hash chains (PL1-C-01), reproduced exactly as the audit.ledger_chain() trigger
// computes them: entry_hash = sha256_hex(prev_hash ‖ "\n" ‖ JCS(entry)). Since `audit/0006`
// (PR-FBX-32, ADR-0005) a tenant's ledger is a set of lanes, each its own chain; entries written
// before it have no lane and are lane 0, positioned by their `seq`.
import { canonicalize, sha256Hex } from "@infrabyx/crypto";

export const GENESIS_HASH = "0".repeat(64);

export type ActorType = "user" | "service" | "agent" | "breakglass";

export interface LedgerEntry {
  id: string;
  tenant_id: string;
  seq: number;
  actor_id: string;
  actor_type: ActorType;
  action: string;
  resource_type: string;
  resource_id: string;
  before_digest: string | null;
  after_digest: string | null;
  corrects_id: string | null;
  trace_id: string | null;
  ip_hash: string | null;
  ua_hash: string | null;
  /** The context's branch (`audit/0004`, R1-D-26); hashed only when set. */
  branch_id?: string | null;
  /** Business ids (`audit/0010`, PR-LDC-30); hashed only when set. */
  business_ids?: readonly string[] | null;
  /** The entry's lane and its position there (`audit/0006`); hashed only when set. */
  lane?: number | null;
  lane_seq?: number | string | null;
  /** ISO-8601 UTC with milliseconds, e.g. 2026-10-26T12:15:39.373Z. */
  occurred_at: string;
  prev_hash: string;
  entry_hash: string;
}

/** The fields covered by the hash, in the trigger's order (JCS sorts them anyway). */
export const HASHED_FIELDS = [
  "action",
  "actor_id",
  "actor_type",
  "after_digest",
  "before_digest",
  "corrects_id",
  "id",
  "ip_hash",
  "occurred_at",
  "resource_id",
  "resource_type",
  "seq",
  "tenant_id",
  "trace_id",
  "ua_hash",
] as const;

export function canonicalEntry(e: Omit<LedgerEntry, "prev_hash" | "entry_hash">): string {
  const body: Record<string, unknown> = {};
  for (const f of HASHED_FIELDS) body[f] = e[f];
  // The branch joins the hash only when set, so entries without one hash as before audit/0004.
  if (e.branch_id !== undefined && e.branch_id !== null) body.branch_id = e.branch_id;
  // So do the business ids, in their stored order, so every entry before audit/0010 hashes as before.
  if (e.business_ids !== undefined && e.business_ids !== null)
    body.business_ids = [...e.business_ids];
  // So do the lane and the position, so every entry before audit/0006 hashes as before.
  if (e.lane !== undefined && e.lane !== null) {
    body.lane = Number(e.lane);
    body.lane_seq = Number(e.lane_seq);
  }
  return canonicalize(body);
}

export function entryHash(
  prevHash: string,
  e: Omit<LedgerEntry, "prev_hash" | "entry_hash">,
): string {
  return sha256Hex(`${prevHash}\n${canonicalEntry(e)}`);
}

export interface ChainBreak {
  /** The entry's `seq`, and its lane and position in that lane. */
  seq: number;
  id: string;
  lane?: number;
  laneSeq?: number;
  reason: "hash-mismatch" | "prev-hash-mismatch" | "sequence-gap" | "head-mismatch";
}

/** A lane's last entry: its position in the lane and its hash (genesis: 0 and 64 zeros). */
export interface LaneHead {
  lane: number;
  seq: number;
  hash: string;
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  /** The highest `seq` checked, and the root over every lane's head (`lanesRoot`). */
  head: { seq: number; hash: string };
  /** Each lane's head after the check, by lane. */
  lanes: LaneHead[];
  break?: ChainBreak;
}

/** An entry's lane and position: lane 0 at its `seq` for entries written before `audit/0006`. */
export function lanePosition(e: {
  seq: number | string;
  lane?: number | null;
  lane_seq?: number | string | null;
}): { lane: number; pos: number } {
  return e.lane === undefined || e.lane === null
    ? { lane: 0, pos: Number(e.seq) }
    : { lane: Number(e.lane), pos: Number(e.lane_seq) };
}

/** The root over lane heads that anchors sign (format 3): SHA-256 of their canonical list. */
export function lanesRoot(lanes: readonly LaneHead[]): string {
  const sorted = [...lanes]
    .filter((l) => l.seq > 0)
    .sort((a, b) => a.lane - b.lane)
    .map((l) => ({ lane: l.lane, seq: l.seq, hash: l.hash }));
  return sha256Hex(canonicalize(sorted));
}

/** Where verification starts: genesis by default, a lane-0 point, or every lane's known head. */
export type VerifyStart = { seq: number; hash: string } | { lanes: readonly LaneHead[] };

const startLanes = (start: VerifyStart | undefined): Map<number, LaneHead> => {
  const m = new Map<number, LaneHead>();
  if (!start) return m;
  if ("lanes" in start) for (const l of start.lanes) m.set(l.lane, { ...l });
  else m.set(0, { lane: 0, seq: start.seq, hash: start.hash });
  return m;
};

/**
 * Verify one tenant's chains, lane by lane: each lane's positions run without a gap from its start
 * and each entry links to the one before it in its lane. `start` continues from a known point (an
 * anchor or an earlier verification); by default every lane starts at genesis.
 */
export function verifyChain(entries: readonly LedgerEntry[], start?: VerifyStart): VerifyResult {
  const lanes = startLanes(start);
  const head = (lane: number) => lanes.get(lane) ?? { lane, seq: 0, hash: GENESIS_HASH };
  let checked = 0;
  let top = 0;
  const result = (ok: boolean, brk?: ChainBreak): VerifyResult => {
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
    const h = head(lane);
    if (pos <= h.seq) continue;
    const fail = (reason: ChainBreak["reason"]) =>
      result(false, { seq: Number(e.seq), id: e.id, lane, laneSeq: pos, reason });
    if (pos !== h.seq + 1) return fail("sequence-gap");
    if (e.prev_hash !== h.hash) return fail("prev-hash-mismatch");
    if (entryHash(h.hash, e) !== e.entry_hash) return fail("hash-mismatch");
    lanes.set(lane, { lane, seq: pos, hash: e.entry_hash });
    top = Math.max(top, Number(e.seq));
    checked++;
  }
  return result(true);
}

/**
 * Compare the lanes a verification ended on with the lane heads the database holds (a deleted tail
 * shows here); the first lane that differs, or undefined.
 */
export function laneHeadMismatch(
  verified: readonly LaneHead[],
  stored: readonly LaneHead[],
): LaneHead | undefined {
  const v = new Map(verified.map((l) => [l.lane, l]));
  for (const s of stored) {
    const got = v.get(s.lane) ?? { lane: s.lane, seq: 0, hash: GENESIS_HASH };
    if (got.seq !== s.seq || got.hash !== s.hash) return s;
  }
  return undefined;
}
