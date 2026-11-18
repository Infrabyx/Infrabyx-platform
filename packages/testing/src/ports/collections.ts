// DISBURSEMENT_RAIL collection methods and PAYMENTS settlement lines: in-memory fakes and the
// contract cases every future adapter must pass (IPB-01-15; Finbyx PR-FBX-34 (1) and (2), R1-D-80).
// No adapter exists: presentation through a sponsor bank is money movement and waits for a tenant's
// sponsor bank and the owner's word. The fakes keep the rules the interfaces document: every debit
// item is a money call (approval, user or service initiator, idempotency key, integer paise), a key
// is presented at most once, "submitted" is never final, return codes are classed through
// `classifyReturnCode`, and a response file that does not match what was presented is refused.
// DISBURSEMENT_RAIL collection methods and PAYMENTS settlement lines: in-memory fakes and the
// contract cases every future adapter must pass (IPB-01-15; Finbyx PR-FBX-34 (1) and (2), R1-D-80).
// No adapter exists: presentation through a sponsor bank is money movement and waits for a tenant's
// sponsor bank and the owner's word. The fakes keep the rules the interfaces document: every debit
// item is a money call (approval, user or service initiator, idempotency key, integer paise), a key
// is presented at most once, "submitted" is never final, return codes are classed through
// `classifyReturnCode`, and a response file that does not match what was presented is refused.
import { expect } from "vitest";
import {
  DebitBatch,
  PRESENT_DEBIT_OPERATION,
  SettlementLine,
  payloadClass,
  type DisbursementRailPort,
  type MoneyAuthorisation,
  type PaymentsPort,
  type StatementLine,
} from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";
import type { ContractCase } from "../contract.js";
import { type DisbursementRailFixtures, type FakeDebitOutcome } from "@infrabyx/fakes";
export {
  type FakeDebitOutcome,
  FAKE_STATEMENT_LINES,
  FakeDisbursementRail,
  FAKE_SETTLEMENT_LINES,
  FakeSettlements,
  type DisbursementRailFixtures,
  DISBURSEMENT_RAIL_FAKE_FIXTURES,
} from "@infrabyx/fakes";

// -------------------------------------------------------------------------------- contract cases

/** A valid authorisation for contract runs; sandboxes accept any approval reference. */
const AUTH: MoneyAuthorisation = {
  approvalRef: "apr_contract_0001",
  initiatedBy: { principalId: "usr_contract", principalType: "user" },
};
/** An agent initiator, which every debit item must refuse (typed loosely on purpose). */
const AGENT_AUTH = {
  approvalRef: "apr_contract_0001",
  initiatedBy: { principalId: "agt_vidhi", principalType: "agent" },
} as unknown as MoneyAuthorisation;
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string }) => e.code ?? "error",
  );

export function disbursementRailContractCases(
  fx: DisbursementRailFixtures,
): Array<ContractCase<DisbursementRailPort>> {
  const run = sha256Hex(`${Date.now()}:${Math.random()}`).slice(0, 10);
  const key = (s: string) => `ct-${run}-${s}`;
  const item = (s: string, over: Record<string, unknown> = {}) => ({
    itemRef: `due_${run}_${s}`,
    mandateRef: fx.mandateRef,
    amountMinor: 1_000_00,
    attempt: 1,
    purposeRef: "loan_contract",
    idempotencyKey: key(s),
    authorisation: AUTH,
    ...over,
  });
  // Typed loosely on purpose: the refusal cases send malformed items.
  const batch = (items: unknown[]) =>
    ({
      batchRef: `ct_${run}`,
      channel: fx.channel,
      debitDate: fx.debitDate,
      items,
    }) as never;
  const absent = async (p: DisbursementRailPort, s: string) =>
    expect((await p.lookup(PRESENT_DEBIT_OPERATION, key(s))).status).toBe("absent");
  return [
    {
      name: "classes debit items REGULATED; stays IN",
      async run(p) {
        expect(payloadClass(DebitBatch).bodyHighest).toBe("REGULATED");
        expect(p.descriptor.residency).toBe("IN");
        expect(p.descriptor.maxDataClass).toBe("REGULATED");
      },
    },
    {
      name: "presents each key once: a replay returns the first presentation and sends nothing; submitted is not final",
      async run(p) {
        const a = await p.presentDebitBatch(batch([item("p1"), item("p2")]));
        expect(a.batchId).toBeTruthy();
        expect(a.items.map((i) => [i.state, i.replayed])).toEqual([
          ["submitted", false],
          ["submitted", false],
        ]);
        const b = await p.presentDebitBatch(batch([item("p1"), item("p2")]));
        expect(b.batchId).toBeNull();
        expect(b.items.every((i) => i.replayed)).toBe(true);
        expect(b.items.map((i) => i.presentationId)).toEqual(a.items.map((i) => i.presentationId));
        const found = await p.lookup(PRESENT_DEBIT_OPERATION, key("p1"));
        expect(found.status).toBe("found");
      },
    },
    {
      name: "a key repeated in a batch, or reused with another item, refuses the whole batch",
      async run(p) {
        expect(
          await code(
            p.presentDebitBatch(batch([item("d1"), item("d1b", { idempotencyKey: key("d1") })])),
          ),
        ).toBe("IPB-PORT-004");
        await absent(p, "d1");
        await p.presentDebitBatch(batch([item("d2")]));
        expect(
          await code(
            p.presentDebitBatch(batch([item("d2", { amountMinor: 2_000_00 }), item("d3")])),
          ),
        ).toBe("IPB-PORT-004");
        await absent(p, "d3");
      },
    },
    {
      name: "refuses an agent, a missing approval or key, and amounts that are not integer paise; nothing is presented",
      async run(p) {
        const ok = item("r0");
        expect(
          await code(p.presentDebitBatch(batch([ok, item("r1", { authorisation: AGENT_AUTH })]))),
        ).toBe("IPB-SEC-004");
        expect(
          await code(p.presentDebitBatch(batch([ok, item("r2", { authorisation: undefined })]))),
        ).toBe("IPB-UX-004");
        expect(
          await code(p.presentDebitBatch(batch([ok, item("r3", { idempotencyKey: "short" })]))),
        ).toBe("IPB-UX-004");
        for (const amountMinor of [1.5, 0, -100, Number.MAX_SAFE_INTEGER + 2])
          expect(
            await code(p.presentDebitBatch(batch([ok, item("r4", { amountMinor })]))),
          ).not.toBeNull();
        expect(await code(p.presentDebitBatch(batch([])))).not.toBeNull();
        await absent(p, "r0");
        await absent(p, "r4");
      },
    },
    {
      name: "reads the response file: paid with its settlement reference; returns classed re-presentable or final",
      async run(p) {
        const sent = await p.presentDebitBatch(
          batch([item("o1"), item("o2"), item("o3"), item("o4")]),
        );
        const ref = (s: string) => `due_${run}_${s}`;
        const outcomes: Record<string, FakeDebitOutcome> = {
          [ref("o1")]: "paid",
          [ref("o2")]: { code: fx.codes.rePresentable },
          [ref("o3")]: { code: fx.codes.final },
          ...(fx.codes.unknown ? { [ref("o4")]: { code: fx.codes.unknown } } : {}),
        };
        const file = await fx.respond(p, sent.batchId as string, outcomes);
        const res = await p.readPresentationResponse(file);
        expect(res.batchId).toBe(sent.batchId);
        const by = new Map(res.results.map((r) => [r.itemRef, r]));
        expect(by.get(ref("o1"))).toMatchObject({
          outcome: "paid",
          returnCode: null,
          returnClass: null,
        });
        expect(by.get(ref("o1"))?.settlementRef).toBeTruthy();
        expect(by.get(ref("o2"))).toMatchObject({
          outcome: "returned",
          returnCode: fx.codes.rePresentable,
          returnClass: "re_presentable",
          codeKnown: true,
          settlementRef: null,
        });
        expect(by.get(ref("o3"))).toMatchObject({
          outcome: "returned",
          returnClass: "final",
          codeKnown: true,
        });
        if (fx.codes.unknown)
          expect(by.get(ref("o4"))).toMatchObject({ returnClass: "final", codeKnown: false });
        for (const r of res.results) expect(Number.isSafeInteger(r.amountMinor)).toBe(true);
        expect((await p.readPresentationResponse(file)).results).toEqual(res.results);
        const again = await p.presentDebitBatch(batch([item("o2")]));
        expect(again.items[0]).toMatchObject({ replayed: true, state: "returned" });
      },
    },
    {
      name: "statement lines lie within the range, in integer paise, with a direction; an inverted range is refused",
      async run(p) {
        const lines = await p.statementLines(fx.statementRange);
        expect(lines.length).toBeGreaterThan(0);
        expect(new Set(lines.map((l) => l.lineId)).size).toBe(lines.length);
        for (const l of lines) {
          expect(l.valueDate >= fx.statementRange.from && l.valueDate <= fx.statementRange.to).toBe(
            true,
          );
          expect(Number.isSafeInteger(l.amountMinor) && l.amountMinor > 0).toBe(true);
          expect(["credit", "debit"]).toContain(l.direction);
          expect(typeof l.narration).toBe("string");
        }
        const day = (lines[0] as StatementLine).valueDate;
        for (const l of await p.statementLines({ from: day, to: day }))
          expect(l.valueDate).toBe(day);
        await expect(
          p.statementLines({ from: fx.statementRange.to, to: fx.statementRange.from }),
        ).rejects.toThrow();
      },
    },
  ];
}

/** Contract cases of PAYMENTS `reconcile` settlement lines (an adapter that reports them). */
export function settlementLineContractCases(
  fx: { range: { from: string; to: string } } = {
    range: { from: "2026-11-01", to: "2026-11-30" },
  },
): Array<ContractCase<Pick<PaymentsPort, "reconcile">>> {
  const inRange = (d: string, r: { from: string; to: string }) =>
    d >= r.from.slice(0, 10) && d <= r.to.slice(0, 10);
  return [
    {
      name: "settlement lines are typed, within the range, in integer paise, and net balances",
      async run(p) {
        expect(payloadClass(SettlementLine).bodyHighest).toBe("REGULATED");
        const r = await p.reconcile(fx.range);
        const lines = r.settlementLines ?? [];
        expect(lines.length).toBeGreaterThan(0);
        expect(r.settlements).toBe(lines.length);
        expect(new Set(lines.map((l) => l.settlementId)).size).toBe(lines.length);
        for (const l of lines) {
          expect(SettlementLine.safeParse(l).success).toBe(true);
          expect(inRange(l.settledOn, fx.range)).toBe(true);
        }
      },
    },
    {
      name: "a narrower range returns only its own settlements",
      async run(p) {
        const all = (await p.reconcile(fx.range)).settlementLines ?? [];
        const day = (all[0] as SettlementLine).settledOn;
        const one = (await p.reconcile({ from: day, to: day })).settlementLines ?? [];
        expect(one.length).toBeGreaterThan(0);
        for (const l of one) expect(l.settledOn).toBe(day);
      },
    },
  ];
}
