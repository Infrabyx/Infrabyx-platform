// ACCOUNTING port, the sink half (Finbyx PR-FBX-46; R1-D-122): posting a product's journal batches
// into a tenant's books (TallyPrime first, through a local agent; SAP and Zoho Books only when a
// tenant needs them) and reading the trial balance back to reconcile. Interfaces, the in-memory
// fake and the contract cases only; the TallyPrime adapter follows in wave 15 after its design and
// threat-model entry. Posting to the books records money already moved; it moves none. The rules
// every adapter keeps:
//   * a batch is posted by a person or the product's service, never an agent;
//   * every entry is checked before any call: integer paise only, at least one debit and one
//     credit, and debits equal credits (P-04); a batch that fails is refused, never half-posted;
//   * `post` is idempotent on the journal id together with the batch's canonical SHA-256: the
//     same batch again answers its current result, a changed batch under the same id is refused
//     (IPB-PORT-004), so nothing is posted twice;
//   * the answer is `ACKNOWLEDGED` (with the ledger's references), `REJECTED` (with a reason
//     code) or `PENDING`; an acknowledged batch is final and is never replayed;
//   * `trialBalance(asOf)` reads the ledger's balances in paise for reconciliation.
import { z } from "zod";
import { PortError } from "../errors.js";
import type { Port, PortCall } from "./common.js";
import { classed } from "./payload-class.js";

const internal = <T extends z.ZodType>(s: T): T => classed(s, "INTERNAL");
const confidential = <T extends z.ZodType>(s: T): T => classed(s, "CONFIDENTIAL");

/** The largest amount on one line or in one total: 10^15 paise, inside the safe-integer range. */
export const ACCOUNTING_MAX_PAISE = 1_000_000_000_000_000;
export const ACCOUNTING_MAX_ENTRIES = 1_000;
export const ACCOUNTING_MAX_LINES = 500;

export const ACCOUNTING_STATES = ["PENDING", "ACKNOWLEDGED", "REJECTED"] as const;
export type AccountingState = (typeof ACCOUNTING_STATES)[number];

/** Text a ledger accepts: printable, no control characters. */
const ledgerText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .regex(/^[^\u0000-\u001f\u007f]+$/, "no control characters");
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d, "a calendar date");

export const JournalLine = z
  .object({
    /** The ledger (account) name or code in the tenant's books. */
    ledger: internal(ledgerText(120)),
    side: internal(z.enum(["debit", "credit"])),
    amountPaise: confidential(z.number().int().positive().max(ACCOUNTING_MAX_PAISE)),
    costCentre: internal(ledgerText(120)).optional(),
    narration: confidential(ledgerText(500)).optional(),
  })
  .strict();
export type JournalLine = z.infer<typeof JournalLine>;

export const JournalEntry = z
  .object({
    /** The voucher type in the tenant's books (`Journal`, `Receipt`, `Payment`, …). */
    voucherType: internal(z.string().regex(/^[A-Za-z][A-Za-z0-9 _-]{1,39}$/)),
    /** The voucher date (the books' date, not the posting time). */
    date: internal(isoDate),
    /** The product's own voucher reference, unique within the batch. */
    reference: internal(z.string().regex(/^[A-Za-z0-9_./:-]{1,64}$/)),
    narration: confidential(ledgerText(500)).optional(),
    lines: z.array(JournalLine).min(2).max(ACCOUNTING_MAX_LINES),
  })
  .strict();
export type JournalEntry = z.infer<typeof JournalEntry>;

export const JournalBatch = z
  .object({
    /** The product's journal id (TallyPrime REMOTEID or GUID); with the digest, the idempotency key. */
    journalId: internal(z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/)),
    /** Who posts it: a staff member, or the product's service on their behalf. */
    initiatedBy: internal(
      z.object({ type: z.enum(["user", "service"]), id: z.string().min(3).max(120) }).strict(),
    ),
    entries: z.array(JournalEntry).min(1).max(ACCOUNTING_MAX_ENTRIES),
  })
  .strict();
export type JournalBatch = z.infer<typeof JournalBatch>;

/**
 * The check every adapter (and the fake) runs before any call: an agent is refused with
 * `IPB-SEC-004`; a malformed batch, a duplicate voucher reference, an entry without both sides or
 * whose debits and credits differ with `IPB-UX-004`. Returns the parsed batch.
 */
export function assertBalancedBatch(port: string, raw: unknown): JournalBatch {
  if ((raw as { initiatedBy?: { type?: unknown } } | null)?.initiatedBy?.type === "agent")
    throw new PortError("IPB-SEC-004", port, { detail: "an agent never posts to the books" });
  const r = JournalBatch.safeParse(raw);
  const refuse = (detail: string) => new PortError("IPB-UX-004", port, { detail });
  if (!r.success)
    throw refuse(`the batch is malformed at ${r.error.issues[0]?.path.join(".") || "its root"}`);
  const refs = new Set<string>();
  for (const e of r.data.entries) {
    if (refs.has(e.reference)) throw refuse(`voucher reference ${e.reference} is used twice`);
    refs.add(e.reference);
    let debit = 0;
    let credit = 0;
    for (const l of e.lines) {
      if (l.side === "debit") debit += l.amountPaise;
      else credit += l.amountPaise;
    }
    if (debit === 0 || credit === 0)
      throw refuse(`voucher ${e.reference} needs at least one debit and one credit`);
    if (debit > ACCOUNTING_MAX_PAISE || credit > ACCOUNTING_MAX_PAISE)
      throw refuse(`voucher ${e.reference} totals more than ${ACCOUNTING_MAX_PAISE} paise`);
    if (debit !== credit)
      throw refuse(
        `voucher ${e.reference} is not balanced: debits ${debit} paise, credits ${credit} paise`,
      );
  }
  return r.data;
}

export interface AccountingPostResult {
  journalId: string;
  /** The canonical SHA-256 of the batch as posted. */
  digest: string;
  state: AccountingState;
  /** The ledger's references (voucher numbers or GUIDs) by the product's reference, once acknowledged. */
  ledgerRefs: Readonly<Record<string, string>> | null;
  /** Why the ledger refused it (`ledger_unknown`, `period_closed`, `duplicate_voucher`, …). */
  reasonCode: string | null;
  reason: string | null;
  /** Submissions so far: 1, then one more per replay. */
  attempts: number;
  /** ISO 8601 instant of the last change. */
  updatedAt: string;
}

export interface TrialBalanceLine {
  ledger: string;
  debitPaise: number;
  creditPaise: number;
}

export interface TrialBalance {
  /** The date the balances are as of (inclusive). */
  asOf: string;
  lines: TrialBalanceLine[];
  totalDebitPaise: number;
  totalCreditPaise: number;
}

export interface AccountingSinkPort extends Port {
  /** Post a batch; idempotent on its journal id and digest. */
  post(batch: JournalBatch, call?: PortCall): Promise<AccountingPostResult>;
  /** The batch's current result. */
  status(journalId: string, call?: PortCall): Promise<AccountingPostResult>;
  /** Submit a pending or rejected batch again, unchanged; refused (`IPB-PORT-003`) once acknowledged. */
  replay(journalId: string, call?: PortCall): Promise<AccountingPostResult>;
  /** The ledger's balances as of `asOf` (YYYY-MM-DD), in paise. */
  trialBalance(asOf: string, call?: PortCall): Promise<TrialBalance>;
}
