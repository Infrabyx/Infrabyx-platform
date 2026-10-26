// The ledger hash chain (PL1-C-01), reproduced exactly as the audit.ledger_chain() trigger
// computes it: entry_hash = sha256_hex(prev_hash ‖ "\n" ‖ JCS(entry)).
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
  return canonicalize(body);
}

export function entryHash(
  prevHash: string,
  e: Omit<LedgerEntry, "prev_hash" | "entry_hash">,
): string {
  return sha256Hex(`${prevHash}\n${canonicalEntry(e)}`);
}

export interface ChainBreak {
  seq: number;
  id: string;
  reason: "hash-mismatch" | "prev-hash-mismatch" | "sequence-gap" | "head-mismatch";
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  head: { seq: number; hash: string };
  break?: ChainBreak;
}

/**
 * Verify one tenant's chain. `start` continues from a known point (an anchor or an earlier
 * verification); by default the chain starts at genesis.
 */
export function verifyChain(
  entries: readonly LedgerEntry[],
  start: { seq: number; hash: string } = { seq: 0, hash: GENESIS_HASH },
): VerifyResult {
  let prev = start.hash;
  let seq = start.seq;
  let checked = 0;
  for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
    if (e.seq <= start.seq) continue;
    const fail = (reason: ChainBreak["reason"]): VerifyResult => ({
      ok: false,
      checked,
      head: { seq, hash: prev },
      break: { seq: e.seq, id: e.id, reason },
    });
    if (e.seq !== seq + 1) return fail("sequence-gap");
    if (e.prev_hash !== prev) return fail("prev-hash-mismatch");
    if (entryHash(prev, e) !== e.entry_hash) return fail("hash-mismatch");
    prev = e.entry_hash;
    seq = e.seq;
    checked++;
  }
  return { ok: true, checked, head: { seq, hash: prev } };
}
