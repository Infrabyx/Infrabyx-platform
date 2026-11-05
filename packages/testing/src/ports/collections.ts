// DISBURSEMENT_RAIL collection methods and PAYMENTS settlement lines: in-memory fakes and the
// contract cases every future adapter must pass (IPB-01-15; Finbyx PR-FBX-34 (1) and (2), R1-D-80).
// No adapter exists: presentation through a sponsor bank is money movement and waits for a tenant's
// sponsor bank and the owner's word. The fakes keep the rules the interfaces document: every debit
// item is a money call (approval, user or service initiator, idempotency key, integer paise), a key
// is presented at most once, "submitted" is never final, return codes are classed through
// `classifyReturnCode`, and a response file that does not match what was presented is refused.
import { expect } from "vitest";
import { PortError } from "@infrabyx/contracts/errors";
import {
  DebitBatch,
  PRESENT_DEBIT_OPERATION,
  SettlementLine,
  StatementRange,
  assertDebitBatch,
  classifyReturnCode,
  payloadClass,
  type AdapterDescriptor,
  type CollectionChannel,
  type DebitBatchReceipt,
  type DebitItem,
  type DebitItemReceipt,
  type DisbursementRailPort,
  type LookupResult,
  type MoneyAuthorisation,
  type PaymentsPort,
  type PortHealth,
  type PresentationResponse,
  type PresentationResult,
  type ReconcileReport,
  type StatementLine,
} from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";
import type { ContractCase } from "../contract.js";

const PORT = "DISBURSEMENT_RAIL";
const ADAPTER = "fake-disbursement-rail";

const refuse = (reason: string, detail: string) =>
  new PortError("IPB-PORT-001", PORT, { adapter: ADAPTER, detail, meta: { reason } });

/** An outcome the fake sponsor bank gives an item: paid, or returned with a code. */
export type FakeDebitOutcome = "paid" | { code: string };

interface Presentation {
  body: string;
  receipt: Omit<DebitItemReceipt, "replayed">;
  channel: CollectionChannel;
  debitDate: string;
  batchRef: string;
  result?: PresentationResult;
}

interface FakeResponseFile {
  format: "fake-npci-response-1";
  batchId: string;
  channel: CollectionChannel;
  results: Array<{
    presentationId: string;
    amountMinor: number;
    status: "ACCEPTED" | "RETURNED";
    code?: string;
    utr?: string;
  }>;
}

/** Statement lines the fake account starts with (fictional). */
export const FAKE_STATEMENT_LINES: readonly StatementLine[] = [
  {
    lineId: "stl_0001",
    valueDate: "2026-11-02",
    amountMinor: 1_250_000,
    direction: "credit",
    reference: "FAKEUTR000000001",
    narration: "SETTLEMENT FAKE GATEWAY",
  },
  {
    lineId: "stl_0002",
    valueDate: "2026-11-03",
    amountMinor: 35_400,
    direction: "debit",
    reference: null,
    narration: "BANK CHARGES",
  },
  {
    lineId: "stl_0003",
    valueDate: "2026-12-01",
    amountMinor: 500_000,
    direction: "credit",
    reference: "FAKEUTR000000002",
    narration: "SETTLEMENT FAKE GATEWAY",
  },
];

/**
 * A fake sponsor bank. `respond()` plays the bank's response file for a batch; reading it marks
 * each item paid or returned, and each paid item credits the account's statement on the debit date.
 */
export class FakeDisbursementRail implements DisbursementRailPort {
  readonly descriptor: AdapterDescriptor = {
    port: PORT,
    adapter: ADAPTER,
    residency: "IN",
    maxDataClass: "REGULATED",
  };
  private readonly byKey = new Map<string, Presentation>();
  private readonly byId = new Map<string, Presentation>();
  private readonly batches = new Map<string, string[]>();
  private readonly lines: StatementLine[];
  private readonly now: () => Date;
  private n = 0;
  /** How many files were sent to the bank (replays and refusals send none). */
  filesSent = 0;
  constructor(o: { statement?: readonly StatementLine[]; now?: () => Date } = {}) {
    this.lines = structuredClone([...(o.statement ?? FAKE_STATEMENT_LINES)]);
    this.now = o.now ?? (() => new Date());
  }

  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: this.now().toISOString() };
  }

  async lookup(operation: string, idempotencyKey: string): Promise<LookupResult<unknown>> {
    const p = operation === PRESENT_DEBIT_OPERATION ? this.byKey.get(idempotencyKey) : undefined;
    return p ? { status: "found", result: { ...p.receipt } } : { status: "absent" };
  }

  async presentDebitBatch(raw: unknown): Promise<DebitBatchReceipt> {
    const b = assertDebitBatch(PORT, raw);
    const bodyOf = (it: DebitItem) => JSON.stringify({ channel: b.channel, item: it });
    // Every key is checked before anything is sent: one conflict refuses the whole batch.
    for (const it of b.items) {
      const prior = this.byKey.get(it.idempotencyKey);
      if (prior && prior.body !== bodyOf(it))
        throw new PortError("IPB-PORT-004", PORT, {
          adapter: ADAPTER,
          detail: "idempotency key reused with a different debit item",
          meta: { itemRef: it.itemRef },
        });
    }
    const fresh = b.items.filter((it) => !this.byKey.has(it.idempotencyKey));
    const batchId = fresh.length ? `dbt_${++this.n}` : null;
    if (batchId) {
      this.filesSent++;
      this.batches.set(batchId, []);
      for (const it of fresh) {
        const presentationId = `prs_${sha256Hex(`${batchId}:${it.idempotencyKey}`).slice(0, 20)}`;
        const p: Presentation = {
          body: bodyOf(it),
          channel: b.channel,
          debitDate: b.debitDate,
          batchRef: b.batchRef,
          receipt: {
            itemRef: it.itemRef,
            idempotencyKey: it.idempotencyKey,
            presentationId,
            batchId,
            amountMinor: it.amountMinor,
            state: "submitted",
          },
        };
        this.byKey.set(it.idempotencyKey, p);
        this.byId.set(presentationId, p);
        this.batches.get(batchId)?.push(presentationId);
      }
    }
    return {
      batchId,
      batchRef: b.batchRef,
      channel: b.channel,
      debitDate: b.debitDate,
      items: b.items.map((it) => {
        const p = this.byKey.get(it.idempotencyKey) as Presentation;
        return { ...p.receipt, replayed: p.receipt.batchId !== batchId };
      }),
      vendorRef: `fake-rail-${++this.n}`,
      adapter: ADAPTER,
      submittedAt: this.now().toISOString(),
    };
  }

  /**
   * Test hook: the sponsor bank's response file for a batch. Items not named in `outcomes` (keyed
   * by item reference) are paid.
   */
  respond(batchId: string, outcomes: Readonly<Record<string, FakeDebitOutcome>> = {}): Uint8Array {
    const ids = this.batches.get(batchId);
    if (!ids) throw new Error(`no batch ${batchId}`);
    const first = this.byId.get(ids[0] as string) as Presentation;
    const file: FakeResponseFile = {
      format: "fake-npci-response-1",
      batchId,
      channel: first.channel,
      results: ids.map((id) => {
        const p = this.byId.get(id) as Presentation;
        const o = outcomes[p.receipt.itemRef] ?? "paid";
        return o === "paid"
          ? {
              presentationId: id,
              amountMinor: p.receipt.amountMinor,
              status: "ACCEPTED" as const,
              utr: `FAKEUTR${sha256Hex(id).slice(0, 9).toUpperCase()}`,
            }
          : {
              presentationId: id,
              amountMinor: p.receipt.amountMinor,
              status: "RETURNED" as const,
              code: o.code,
            };
      }),
    };
    return new TextEncoder().encode(JSON.stringify(file));
  }

  async readPresentationResponse(rawFile: Uint8Array): Promise<PresentationResponse> {
    let file: FakeResponseFile;
    try {
      file = JSON.parse(new TextDecoder().decode(rawFile)) as FakeResponseFile;
    } catch {
      throw refuse("malformed", "the response file is not readable");
    }
    if (
      file?.format !== "fake-npci-response-1" ||
      typeof file.batchId !== "string" ||
      !Array.isArray(file.results)
    )
      throw refuse("malformed", "the response file is not in the expected format");
    // Validate the whole file before any result is applied.
    const results: Array<[Presentation, PresentationResult]> = [];
    for (const r of file.results) {
      const p = this.byId.get(r?.presentationId);
      if (!p || p.receipt.batchId !== file.batchId)
        throw refuse("unknown_presentation", "the file names an item that was not presented");
      if (r.amountMinor !== p.receipt.amountMinor)
        throw refuse("amount_mismatch", "the file's amount differs from the presented amount");
      const paid = r.status === "ACCEPTED";
      if (!paid && (r.status !== "RETURNED" || typeof r.code !== "string" || !r.code))
        throw refuse("malformed", "a returned item needs its return code");
      const cls = paid ? null : classifyReturnCode(p.channel, r.code as string);
      const result: PresentationResult = {
        presentationId: p.receipt.presentationId,
        itemRef: p.receipt.itemRef,
        idempotencyKey: p.receipt.idempotencyKey,
        amountMinor: p.receipt.amountMinor,
        outcome: paid ? "paid" : "returned",
        returnCode: paid ? null : (r.code as string),
        returnReason: cls?.reason ?? null,
        returnClass: cls?.class ?? null,
        returnAttribution: cls?.attribution ?? null,
        codeKnown: cls?.codeKnown ?? null,
        settlementRef: paid ? (r.utr ?? null) : null,
        settledOn: paid ? p.debitDate : null,
      };
      if (p.result && JSON.stringify(p.result) !== JSON.stringify(result))
        throw refuse("conflicting_result", "the file contradicts a result already read");
      results.push([p, result]);
    }
    for (const [p, result] of results) {
      if (!p.result && result.outcome === "paid")
        this.lines.push({
          lineId: `stl_${p.receipt.presentationId}`,
          valueDate: p.debitDate,
          amountMinor: p.receipt.amountMinor,
          direction: "credit",
          reference: result.settlementRef,
          narration: `${p.channel === "NACH" ? "NACH" : "UPI AUTOPAY"} CR ${p.batchRef}`,
        });
      p.result = result;
      p.receipt.state = result.outcome;
    }
    return {
      batchId: file.batchId,
      channel: file.channel,
      results: results.map(([, r]) => ({ ...r })),
      vendorRef: `fake-rail-${++this.n}`,
      adapter: ADAPTER,
      readAt: this.now().toISOString(),
    };
  }

  async statementLines(range: { from: string; to: string }): Promise<StatementLine[]> {
    const r = StatementRange.parse(range);
    return this.lines
      .filter((l) => l.valueDate >= r.from && l.valueDate <= r.to)
      .sort((a, b) => a.valueDate.localeCompare(b.valueDate) || a.lineId.localeCompare(b.lineId))
      .map((l) => ({ ...l }));
  }
}

/** Settlement lines the fake gateway reports (fictional; net = gross - fees - tax + adjustments). */
export const FAKE_SETTLEMENT_LINES: readonly SettlementLine[] = [
  {
    settlementId: "setl_fake_0001",
    source: "gateway",
    utr: "FAKEUTR000000001",
    grossMinor: 1_275_000,
    feesMinor: 21_186,
    taxMinor: 3_814,
    netMinor: 1_250_000,
    settledOn: "2026-11-02",
  },
  {
    settlementId: "setl_fake_0002",
    source: "npci",
    utr: "FAKEUTR000000003",
    grossMinor: 600_000,
    feesMinor: 0,
    taxMinor: 0,
    adjustmentsMinor: -100_000,
    netMinor: 500_000,
    settledOn: "2026-11-05",
  },
  {
    settlementId: "setl_fake_0003",
    source: "gateway",
    utr: null,
    grossMinor: 100_000,
    feesMinor: 2_000,
    taxMinor: 360,
    netMinor: 97_640,
    settledOn: "2026-12-01",
  },
];

/** PAYMENTS `reconcile` with typed settlement lines, on its own (the rest of PAYMENTS is not faked here). */
export class FakeSettlements implements Pick<PaymentsPort, "reconcile"> {
  private readonly lines: SettlementLine[];
  constructor(lines: readonly SettlementLine[] = FAKE_SETTLEMENT_LINES) {
    this.lines = lines.map((l) => SettlementLine.parse(l));
  }

  async reconcile(range: { from: string; to: string }): Promise<ReconcileReport> {
    const from = range.from.slice(0, 10);
    const to = range.to.slice(0, 10);
    const settlementLines = this.lines
      .filter((l) => l.settledOn >= from && l.settledOn <= to)
      .map((l) => ({ ...l }));
    return {
      from: range.from,
      to: range.to,
      payments: 0,
      refunds: 0,
      settlements: settlementLines.length,
      differences: [],
      settlementLines,
    };
  }
}

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

/** Inputs a DISBURSEMENT_RAIL adapter's contract run needs (its sponsor bank's sandbox). */
export interface DisbursementRailFixtures {
  channel: CollectionChannel;
  /** A mandate registered and active at the sandbox (UMRN or UMN). */
  mandateRef: string;
  debitDate: string;
  /** Return codes the sandbox can produce: one re-presentable, one final, and optionally one unknown. */
  codes: { rePresentable: string; final: string; unknown?: string };
  /** The sponsor bank's response file for a batch (the fake's hook or the sandbox's). */
  respond: (
    p: DisbursementRailPort,
    batchId: string,
    outcomes: Readonly<Record<string, FakeDebitOutcome>>,
  ) => Promise<Uint8Array> | Uint8Array;
  /** A range in which the collection account's statement has at least one line. */
  statementRange: { from: string; to: string };
}

export const DISBURSEMENT_RAIL_FAKE_FIXTURES: DisbursementRailFixtures = {
  channel: "NACH",
  mandateRef: "FAKE0000000000000001",
  debitDate: "2026-11-10",
  codes: { rePresentable: "04", final: "01", unknown: "ZZ" },
  respond: (p, batchId, outcomes) => (p as FakeDisbursementRail).respond(batchId, outcomes),
  statementRange: { from: "2026-11-01", to: "2026-11-30" },
};

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
