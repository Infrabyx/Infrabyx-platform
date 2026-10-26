import { describe, expect, it } from "vitest";
import { GENESIS_HASH, canonicalEntry, entryHash, verifyChain, type LedgerEntry } from "./chain.js";

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
