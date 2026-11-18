// ACCOUNTING sink fake and contract cases (Finbyx PR-FBX-46; R1-D-122). The fake keeps a ledger
// in memory: a test scripts how the next submission of a journal goes (`acknowledge`, `reject`,
// `pend`) and settles a pending one with `settle`. Acknowledged entries update the trial balance.
// The cases hold every adapter to the port's rules: people or services post (never agents),
// entries balance in integer paise before any call, one batch per journal id and digest, an
// acknowledged batch is final, and the trial balance balances.
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
