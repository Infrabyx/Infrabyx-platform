// ACCOUNTING sink fake and contract cases (Finbyx PR-FBX-46; R1-D-122). The fake keeps a ledger
// in memory: a test scripts how the next submission of a journal goes (`acknowledge`, `reject`,
// `pend`) and settles a pending one with `settle`. Acknowledged entries update the trial balance.
// The cases hold every adapter to the port's rules: people or services post (never agents),
// entries balance in integer paise before any call, one batch per journal id and digest, an
// acknowledged batch is final, and the trial balance balances.
// ACCOUNTING sink fake and contract cases (Finbyx PR-FBX-46; R1-D-122). The fake keeps a ledger
// in memory: a test scripts how the next submission of a journal goes (`acknowledge`, `reject`,
// `pend`) and settles a pending one with `settle`. Acknowledged entries update the trial balance.
// The cases hold every adapter to the port's rules: people or services post (never agents),
// entries balance in integer paise before any call, one batch per journal id and digest, an
// acknowledged batch is final, and the trial balance balances.
import { expect } from "vitest";
import type { AccountingSinkPort, JournalBatch } from "@infrabyx/contracts/ports";
import type { ContractCase } from "../contract.js";
import { type ScriptedPosting } from "@infrabyx/fakes";
export { type ScriptedPosting, FakeAccountingSink } from "@infrabyx/fakes";

/** Scripts outcomes on the adapter under test (the fake's own controls, or a sandbox's). */
export interface AccountingScript {
  script(journalId: string, ...outcomes: ScriptedPosting[]): void;
  /**
   * Settles a pending journal. An adapter whose answer comes from elsewhere (the TallyPrime
   * agent, R1-D-178) may return a promise that resolves once the answer is in; the cases await it.
   */
  settle(journalId: string, outcome: "acknowledge" | "reject"): void | Promise<void>;
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
        await s.settle(b.journalId, "acknowledge");
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
