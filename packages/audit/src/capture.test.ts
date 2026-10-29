// The statutory capture chain in TypeScript (R1-D-25): each break is reported at its entry; the
// SQL side is proved equal by capture.int.test.ts, which verifies rows the trigger wrote.
import { describe, expect, it } from "vitest";
import { captureHash, verifyCaptureChain, type CaptureEntry } from "./capture.js";
import { GENESIS_HASH } from "./chain.js";

function chain(n: number): CaptureEntry[] {
  const out: CaptureEntry[] = [];
  let prev = GENESIS_HASH;
  for (let seq = 1; seq <= n; seq++) {
    const e = {
      tenant_id: "tnt_a",
      seq,
      table_name: "books.journal_line",
      op: seq === 1 ? ("insert" as const) : ("update" as const),
      row_key: `{"id": "l1"}`,
      before_values: seq === 1 ? null : `{"amount": ${seq - 1}}`,
      after_values: `{"amount": ${seq}}`,
      actor_id: "usr_a",
      entity_id: null,
      branch_id: null,
      breakglass_id: null,
      trace_id: null,
      action: "books.journal.post",
      reason: seq === 2 ? "rounding fix" : null,
      db_user: "api",
      db_role: "app_rw",
      txid: String(900 + seq),
      occurred_at: `2026-10-29T06:00:0${seq}.000Z`,
    };
    const entry_hash = captureHash(prev, e);
    out.push({ ...e, prev_hash: prev, entry_hash });
    prev = entry_hash;
  }
  return out;
}

describe("@IPB-02-51 statutory capture chain (R1-D-25)", () => {
  it("verifies a whole chain and continues from a known head", () => {
    const c = chain(5);
    expect(verifyCaptureChain(c)).toMatchObject({ ok: true, checked: 5, head: { seq: 5 } });
    const head = { seq: 2, hash: c[1]!.entry_hash };
    expect(verifyCaptureChain(c, head)).toMatchObject({ ok: true, checked: 3 });
  });

  it("reports an edited value, an edited reason, a removed entry and a re-linked entry", () => {
    const c = chain(5);
    const value = c.map((e) => (e.seq === 3 ? { ...e, after_values: `{"amount": 99}` } : e));
    expect(verifyCaptureChain(value).break).toEqual({ seq: 3, reason: "hash-mismatch" });
    const reason = c.map((e) => (e.seq === 2 ? { ...e, reason: "other" } : e));
    expect(verifyCaptureChain(reason).break).toEqual({ seq: 2, reason: "hash-mismatch" });
    expect(verifyCaptureChain(c.filter((e) => e.seq !== 4)).break).toEqual({
      seq: 5,
      reason: "sequence-gap",
    });
    const relinked = c.map((e) => (e.seq === 4 ? { ...e, prev_hash: GENESIS_HASH } : e));
    expect(verifyCaptureChain(relinked).break).toEqual({ seq: 4, reason: "prev-hash-mismatch" });
  });
});
