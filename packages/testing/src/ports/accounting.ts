// ACCOUNTING sink fake and contract cases (Finbyx PR-FBX-46; R1-D-122). The fake keeps a ledger
// in memory: a test scripts how the next submission of a journal goes (`acknowledge`, `reject`,
// `pend`) and settles a pending one with `settle`. Acknowledged entries update the trial balance.
// The cases hold every adapter to the port's rules: people or services post (never agents),
// entries balance in integer paise before any call, one batch per journal id and digest, an
// acknowledged batch is final, and the trial balance balances.
import { expect } from "vitest";
import { PortError } from "@infrabyx/contracts/errors";
import {
  assertBalancedBatch,
  type AccountingPostResult,
  type AccountingSinkPort,
  type AdapterDescriptor,
  type JournalBatch,
  type PortHealth,
  type TrialBalance,
} from "@infrabyx/contracts/ports";
import { canonicalDigest } from "@infrabyx/crypto";
import type { ContractCase } from "../contract.js";

export type ScriptedPosting = "acknowledge" | "reject" | "pend";

interface FakeJournal {
  batch: JournalBatch;
  result: AccountingPostResult;
}

const iso = () => new Date().toISOString();

export class FakeAccountingSink implements AccountingSinkPort {
  readonly descriptor: AdapterDescriptor = {
    port: "ACCOUNTING",
    adapter: "fake-accounting",
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
  };
  private readonly journals = new Map<string, FakeJournal>();
  private readonly scripts = new Map<string, ScriptedPosting[]>();
  /** Acknowledged lines, by voucher date, for the trial balance. */
  private readonly posted: Array<{
    date: string;
    ledger: string;
    side: "debit" | "credit";
    paise: number;
  }> = [];
  private voucher = 0;

  /** How the next submissions of `journalId` go, in order (default: acknowledged). */
  script(journalId: string, ...outcomes: ScriptedPosting[]): void {
    this.scripts.set(journalId, outcomes);
  }

  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: iso() };
  }

  async post(raw: JournalBatch): Promise<AccountingPostResult> {
    const batch = assertBalancedBatch("ACCOUNTING", raw);
    const digest = canonicalDigest(batch);
    const prior = this.journals.get(batch.journalId);
    if (prior) {
      if (prior.result.digest !== digest)
        throw new PortError("IPB-PORT-004", "ACCOUNTING", {
          meta: { key: batch.journalId },
          detail: "a different batch under the same journal id is never posted",
        });
      return structuredClone(prior.result);
    }
    const j: FakeJournal = {
      batch,
      result: {
        journalId: batch.journalId,
        digest,
        state: "PENDING",
        ledgerRefs: null,
        reasonCode: null,
        reason: null,
        attempts: 0,
        updatedAt: iso(),
      },
    };
    this.journals.set(batch.journalId, j);
    this.submit(j);
    return structuredClone(j.result);
  }

  /** Test control: settle a pending journal as the ledger would. */
  settle(journalId: string, outcome: "acknowledge" | "reject"): void {
    const j = this.must(journalId);
    if (j.result.state !== "PENDING") throw new Error("the journal is not pending");
    this.apply(j, outcome);
  }

  async status(journalId: string): Promise<AccountingPostResult> {
    return structuredClone(this.must(journalId).result);
  }

  async replay(journalId: string): Promise<AccountingPostResult> {
    const j = this.must(journalId);
    if (j.result.state === "ACKNOWLEDGED")
      throw new PortError("IPB-PORT-003", "ACCOUNTING", {
        detail: "an acknowledged journal is final and is never replayed",
      });
    this.submit(j);
    return structuredClone(j.result);
  }

  async trialBalance(asOf: string): Promise<TrialBalance> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf))
      throw new PortError("IPB-UX-004", "ACCOUNTING", { detail: "asOf is YYYY-MM-DD" });
    const by = new Map<string, { debitPaise: number; creditPaise: number }>();
    for (const p of this.posted) {
      if (p.date > asOf) continue;
      const t = by.get(p.ledger) ?? { debitPaise: 0, creditPaise: 0 };
      if (p.side === "debit") t.debitPaise += p.paise;
      else t.creditPaise += p.paise;
      by.set(p.ledger, t);
    }
    const lines = [...by]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([ledger, t]) => ({ ledger, ...t }));
    return {
      asOf,
      lines,
      totalDebitPaise: lines.reduce((s, l) => s + l.debitPaise, 0),
      totalCreditPaise: lines.reduce((s, l) => s + l.creditPaise, 0),
    };
  }

  private submit(j: FakeJournal): void {
    j.result.attempts += 1;
    const outcome = this.scripts.get(j.batch.journalId)?.shift() ?? "acknowledge";
    if (outcome === "pend") {
      j.result.state = "PENDING";
      j.result.updatedAt = iso();
    } else this.apply(j, outcome);
  }

  private apply(j: FakeJournal, outcome: "acknowledge" | "reject"): void {
    if (outcome === "reject") {
      j.result.state = "REJECTED";
      j.result.reasonCode = "ledger_unknown";
      j.result.reason = "a ledger named in the batch does not exist in the books";
    } else {
      const refs: Record<string, string> = {};
      for (const e of j.batch.entries) {
        refs[e.reference] = `VCH-${String(++this.voucher).padStart(6, "0")}`;
        for (const l of e.lines)
          this.posted.push({ date: e.date, ledger: l.ledger, side: l.side, paise: l.amountPaise });
      }
      j.result.state = "ACKNOWLEDGED";
      j.result.ledgerRefs = refs;
      j.result.reasonCode = null;
      j.result.reason = null;
    }
    j.result.updatedAt = iso();
  }

  private must(journalId: string): FakeJournal {
    const j = this.journals.get(journalId);
    if (!j) throw new PortError("IPB-UX-004", "ACCOUNTING", { detail: `no journal ${journalId}` });
    return j;
  }
}

/** Scripts outcomes on the adapter under test (the fake's own controls, or a sandbox's). */
export interface AccountingScript {
  script(journalId: string, ...outcomes: ScriptedPosting[]): void;
  settle(journalId: string, outcome: "acknowledge" | "reject"): void;
}

let n = 0;
const batch = (paise = 150_000_00): JournalBatch => ({
  journalId: `jrn-${Date.now()}-${++n}`,
  initiatedBy: { type: "service", id: "svc_finance_posting" },
  entries: [
    {
      voucherType: "Journal",
      date: "2026-11-02",
      reference: `JV-${n}-1`,
      narration: "Disbursement of loan_0001",
      lines: [
        { ledger: "Loans and Advances", side: "debit", amountPaise: paise },
        { ledger: "Bank Current Account", side: "credit", amountPaise: paise },
      ],
    },
  ],
});
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string }) => e.code ?? "error",
  );

export function accountingContractCases(s: AccountingScript): ContractCase<AccountingSinkPort>[] {
  return [
    {
      name: "a balanced batch is acknowledged with the ledger's references and shows in the trial balance",
      async run(p) {
        const before = await p.trialBalance("2026-12-31");
        const b = batch(2_500_00);
        const r = await p.post(b);
        expect(r).toMatchObject({ journalId: b.journalId, state: "ACKNOWLEDGED", attempts: 1 });
        expect(r.digest).toMatch(/^[0-9a-f]{64}$/);
        expect(Object.keys(r.ledgerRefs ?? {})).toEqual([b.entries[0]!.reference]);
        expect(await p.status(b.journalId)).toEqual(r);
        const after = await p.trialBalance("2026-12-31");
        expect(after.totalDebitPaise - before.totalDebitPaise).toBe(2_500_00);
        expect(after.totalDebitPaise).toBe(after.totalCreditPaise);
        const earlier = await p.trialBalance("2026-11-01");
        expect(earlier.totalDebitPaise).toBeLessThanOrEqual(before.totalDebitPaise);
      },
    },
    {
      name: "one batch per journal id: the same batch answers its result, a changed one is refused",
      async run(p) {
        const b = batch();
        const a = await p.post(b);
        expect(await p.post(structuredClone(b))).toEqual(a);
        const changed = structuredClone(b);
        changed.entries[0]!.lines[0]!.amountPaise += 1;
        changed.entries[0]!.lines[1]!.amountPaise += 1;
        expect(await code(p.post(changed))).toBe("IPB-PORT-004");
        expect((await p.status(b.journalId)).digest).toBe(a.digest);
      },
    },
    {
      name: "a rejected or pending batch is replayed unchanged; an acknowledged one never is",
      async run(p) {
        const b = batch();
        s.script(b.journalId, "reject", "pend");
        const r = await p.post(b);
        expect(r).toMatchObject({ state: "REJECTED", ledgerRefs: null });
        expect(r.reasonCode).toMatch(/^[a-z_]+$/);
        const again = await p.replay(b.journalId);
        expect(again).toMatchObject({ state: "PENDING", attempts: 2, digest: r.digest });
        s.settle(b.journalId, "acknowledge");
        expect((await p.status(b.journalId)).state).toBe("ACKNOWLEDGED");
        expect(await code(p.replay(b.journalId))).toBe("IPB-PORT-003");
      },
    },
    {
      name: "unbalanced, one-sided, fractional or duplicate-reference batches are refused before any call",
      async run(p) {
        const tb = await p.trialBalance("2026-12-31");
        const unbalanced = batch();
        unbalanced.entries[0]!.lines[1]!.amountPaise -= 1;
        expect(await code(p.post(unbalanced))).toBe("IPB-UX-004");
        const oneSided = batch();
        oneSided.entries[0]!.lines[1]!.side = "debit";
        expect(await code(p.post(oneSided))).toBe("IPB-UX-004");
        const fraction = batch();
        fraction.entries[0]!.lines[0]!.amountPaise = 10.5;
        fraction.entries[0]!.lines[1]!.amountPaise = 10.5;
        expect(await code(p.post(fraction))).toBe("IPB-UX-004");
        const dup = batch();
        dup.entries.push(structuredClone(dup.entries[0]!));
        expect(await code(p.post(dup))).toBe("IPB-UX-004");
        expect(await p.trialBalance("2026-12-31")).toEqual(tb);
        for (const j of [unbalanced, oneSided, fraction, dup])
          expect(await code(p.status(j.journalId))).not.toBeNull();
      },
    },
    {
      name: "an agent never posts to the books",
      async run(p) {
        const b = { ...batch(), initiatedBy: { type: "agent", id: "agt_vidhi" } };
        expect(await code(p.post(b as unknown as JournalBatch))).toBe("IPB-SEC-004");
      },
    },
  ];
}
