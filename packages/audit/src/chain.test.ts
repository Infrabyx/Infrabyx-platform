import { describe, expect, it } from "vitest";
import {
  GENESIS_HASH,
  canonicalEntry,
  entryHash,
  laneHeadMismatch,
  lanesRoot,
  verifyChain,
  type LedgerEntry,
} from "./chain.js";

function chain(n: number): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  let prev = GENESIS_HASH;
  for (let seq = 1; seq <= n; seq++) {
    const base = {
      id: `led_01J${String(seq).padStart(23, "0")}`,
      tenant_id: "tnt_a",
      seq,
      actor_id: "usr_a",
      actor_type: "user" as const,
      action: "cases.case.update",
      resource_type: "case",
      resource_id: `cas_${seq}`,
      before_digest: null,
      after_digest: "ab".repeat(32),
      corrects_id: null,
      trace_id: null,
      ip_hash: null,
      ua_hash: null,
      occurred_at: "2026-10-26T12:15:39.373Z",
    };
    const entry_hash = entryHash(prev, base);
    out.push({ ...base, prev_hash: prev, entry_hash });
    prev = entry_hash;
  }
  return out;
}

describe("ledger chain (PL1-C-01)", () => {
  it("canonical form is sorted JCS over the fixed field list", () => {
    const c = canonicalEntry(chain(1)[0] as LedgerEntry);
    expect(
      c.startsWith(
        '{"action":"cases.case.update","actor_id":"usr_a","actor_type":"user","after_digest":',
      ),
    ).toBe(true);
    expect(c).toContain('"seq":1,"tenant_id":"tnt_a","trace_id":null,"ua_hash":null}');
    expect(c).not.toContain("prev_hash");
  });
  it("verifies an intact chain and reports the first break", () => {
    const c = chain(50);
    expect(verifyChain(c)).toMatchObject({ ok: true, checked: 50, head: { seq: 50 } });
    const tampered = c.map((e) => (e.seq === 20 ? { ...e, after_digest: "cd".repeat(32) } : e));
    expect(verifyChain(tampered).break).toMatchObject({ seq: 20, reason: "hash-mismatch" });
    expect(verifyChain(c.filter((e) => e.seq !== 7)).break).toMatchObject({
      seq: 8,
      reason: "sequence-gap",
    });
    const relinked = c.map((e) => (e.seq === 30 ? { ...e, prev_hash: "0".repeat(64) } : e));
    expect(verifyChain(relinked).break).toMatchObject({ seq: 30, reason: "prev-hash-mismatch" });
  });
  it("continues from a known head", () => {
    const c = chain(10);
    const head = c[4] as LedgerEntry;
    expect(verifyChain(c, { seq: head.seq, hash: head.entry_hash })).toMatchObject({
      ok: true,
      checked: 5,
    });
  });
});

/** Entries spread over `lanes` lanes in turn, as concurrent transactions write them (audit/0006). */
function laned(n: number, lanes: number, startSeq = 1000, from?: LedgerEntry): LedgerEntry[] {
  const heads = new Map<number, { pos: number; hash: string }>();
  if (from) heads.set(0, { pos: from.seq, hash: from.entry_hash });
  const out: LedgerEntry[] = [];
  for (let i = 0; i < n; i++) {
    const lane = i % lanes;
    const h = heads.get(lane) ?? { pos: 0, hash: GENESIS_HASH };
    const base = {
      ...chain(1)[0]!,
      id: `led_01J${String(startSeq + i).padStart(23, "0")}`,
      seq: startSeq + i * 3,
      resource_id: `cas_l${i}`,
      lane,
      lane_seq: h.pos + 1,
    };
    const entry_hash = entryHash(h.hash, base);
    out.push({ ...base, prev_hash: h.hash, entry_hash });
    heads.set(lane, { pos: h.pos + 1, hash: entry_hash });
  }
  return out;
}

describe("chain lanes (PR-FBX-32, audit/0006)", () => {
  it("hashes the lane and its position, and only on laned entries", () => {
    const c = canonicalEntry(laned(1, 4)[0]!);
    expect(c).toContain('"ip_hash":null,"lane":0,"lane_seq":1,"occurred_at":');
    expect(canonicalEntry(chain(1)[0]!)).not.toContain('"lane"');
  });
  it("verifies interleaved lanes and finds an edit, a gap or a relink in any of them", () => {
    const c = laned(40, 4);
    const r = verifyChain(c);
    expect(r).toMatchObject({ ok: true, checked: 40, head: { seq: c.at(-1)!.seq } });
    expect(r.lanes.map((l) => [l.lane, l.seq])).toEqual([
      [0, 10],
      [1, 10],
      [2, 10],
      [3, 10],
    ]);
    expect(r.head.hash).toBe(lanesRoot(r.lanes));
    const edited = c.map((e, i) => (i === 21 ? { ...e, after_digest: "cd".repeat(32) } : e));
    expect(verifyChain(edited).break).toMatchObject({
      seq: c[21]!.seq,
      lane: 1,
      laneSeq: 6,
      reason: "hash-mismatch",
    });
    expect(verifyChain(c.filter((_, i) => i !== 6)).break).toMatchObject({
      lane: 2,
      laneSeq: 3,
      reason: "sequence-gap",
    });
    // An entry moved to another lane does not link there.
    const moved = c.map((e, i) => (i === 9 ? { ...e, lane: 2 } : e));
    expect(verifyChain(moved).ok).toBe(false);
  });
  it("continues each tenant's old chain in lane 0", () => {
    const old = chain(5);
    const next = laned(8, 2, 9000, old[4]);
    expect(next[0]).toMatchObject({ lane: 0, lane_seq: 6, prev_hash: old[4]!.entry_hash });
    const r = verifyChain([...old, ...next]);
    expect(r).toMatchObject({ ok: true, checked: 13 });
    expect(r.lanes).toEqual([
      { lane: 0, seq: 9, hash: next[6]!.entry_hash },
      { lane: 1, seq: 4, hash: next[7]!.entry_hash },
    ]);
  });
  it("a deleted tail shows against the stored lane heads", () => {
    const c = laned(12, 3);
    const stored = verifyChain(c).lanes;
    expect(laneHeadMismatch(verifyChain(c).lanes, stored)).toBeUndefined();
    expect(laneHeadMismatch(verifyChain(c.slice(0, 11)).lanes, stored)).toEqual(stored[2]);
  });
});
