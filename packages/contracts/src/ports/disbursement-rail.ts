// DISBURSEMENT_RAIL port, a product port of IPB-01 §01.4.4.3 owned by FBX (Finbyx platform request
// PR-FBX-34 (1) and (2), R1-plan M51, R1-D-80, ADR-0006): disbursement and collection rails through
// the regulated entity's sponsor bank. This minor adds the collection half: a debit batch presented
// against registered mandates (NACH and UPI AutoPay), the sponsor bank's response file read into
// per-item results with NPCI return codes, and the collection account's statement lines.
// Interfaces and fakes only: no adapter is built until a tenant names its sponsor bank and the owner
// gives the word (locked list: money movement; OWNER-QUESTIONS #100). Every debit item is a money
// call (`assertMoneyCall`: an approved maker-checker request, a user or service initiator, never an
// agent, an idempotency key) with its amount in integer paise; a key is presented at most once.
// "submitted" is never final: only the response file makes an item paid or returned. Everything is
// REGULATED and stays `IN`. Disbursement methods (PAYOUTS-shaped) are added, optional, later.
import { z } from "zod";
import { PortError } from "../errors.js";
import type { IdempotencyLookup, Port, PortCall } from "./common.js";
import { MoneyAuthorisation, MoneyIdempotencyKey, assertMoneyCall } from "./money.js";
import { AmountMinor } from "./payments.js";
import { classed } from "./payload-class.js";

const regulated = <T extends z.ZodType>(s: T): T => classed(s, "REGULATED");
const internal = <T extends z.ZodType>(s: T): T => classed(s, "INTERNAL");

/** Collection channels presented through the sponsor bank: NACH (eNACH or physical) and UPI AutoPay. */
export const COLLECTION_CHANNELS = ["NACH", "UPI_AUTOPAY"] as const;
export type CollectionChannel = (typeof COLLECTION_CHANNELS)[number];

/** The `lookup` operation that finds a debit item's presentation by its idempotency key. */
export const PRESENT_DEBIT_OPERATION = "presentDebit";

/** The most items one batch may carry; a larger run is split into several batches. */
export const DEBIT_BATCH_MAX_ITEMS = 10_000;

/** One debit against a registered mandate: a money call of its own. */
export const DebitItem = z
  .object({
    /** The product's reference for the due being collected (an instalment id). */
    itemRef: internal(z.string().min(1).max(64)),
    /** NPCI's mandate reference: the UMRN of a NACH mandate, the UMN of a UPI AutoPay mandate. */
    mandateRef: regulated(z.string().regex(/^[A-Za-z0-9@._-]{8,64}$/)),
    amountMinor: regulated(AmountMinor),
    /** 1 for the first presentation of a due; 2 and above for a re-presentation. */
    attempt: internal(z.number().int().min(1).max(9)),
    /** What the debit is for, e.g. the loan reference. */
    purposeRef: internal(z.string().min(1).max(120)),
    idempotencyKey: internal(MoneyIdempotencyKey.clone()),
    authorisation: MoneyAuthorisation,
  })
  .strict();
export type DebitItem = z.infer<typeof DebitItem>;

export const DebitBatch = z
  .object({
    /** The product's reference for the batch (its file name stem at the sponsor bank). */
    batchRef: internal(z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/)),
    channel: internal(z.enum(COLLECTION_CHANNELS)),
    /** The debit date asked of NPCI. */
    debitDate: internal(z.iso.date()),
    items: z.array(DebitItem).min(1).max(DEBIT_BATCH_MAX_ITEMS),
  })
  .strict();
export type DebitBatch = z.infer<typeof DebitBatch>;

/**
 * The check every DISBURSEMENT_RAIL adapter (and fake) runs on a batch before anything leaves:
 * `assertMoneyCall` on each item (an agent is `IPB-SEC-004`; a missing approval, initiator or key
 * is `IPB-UX-004`), the schema (integer paise, a well-formed mandate reference), and one key and one
 * item reference per item (a repeated key is `IPB-PORT-004`). The whole batch is refused on any
 * failure; nothing is presented.
 */
export function assertDebitBatch(port: string, raw: unknown): DebitBatch {
  const items = (raw as { items?: unknown } | null | undefined)?.items;
  if (Array.isArray(items))
    for (const it of items)
      assertMoneyCall(
        port,
        (it as { authorisation?: unknown } | null)?.authorisation,
        (it as { idempotencyKey?: unknown } | null)?.idempotencyKey,
      );
  const b = DebitBatch.parse(raw);
  const keys = new Set<string>();
  const refs = new Set<string>();
  for (const it of b.items) {
    if (keys.has(it.idempotencyKey))
      throw new PortError("IPB-PORT-004", port, {
        detail: "an idempotency key appears twice in the batch",
        meta: { itemRef: it.itemRef },
      });
    if (refs.has(it.itemRef))
      throw new PortError("IPB-PORT-004", port, {
        detail: "an item reference appears twice in the batch",
        meta: { itemRef: it.itemRef },
      });
    keys.add(it.idempotencyKey);
    refs.add(it.itemRef);
  }
  return b;
}

/** A presentation's state: `submitted` until the response file says `paid` or `returned`. */
export type PresentationState = "submitted" | "paid" | "returned";

export interface DebitItemReceipt {
  itemRef: string;
  idempotencyKey: string;
  /** The rail's id for this key's presentation; the same on every replay of the key. */
  presentationId: string;
  /** The batch that carried the presentation (an earlier one for a replay). */
  batchId: string;
  amountMinor: number;
  state: PresentationState;
  /** True when the key was presented before with the same item, so nothing was sent again. */
  replayed: boolean;
}

export interface DebitBatchReceipt {
  /** The rail's id of the file sent; null when every item was a replay and nothing was sent. */
  batchId: string | null;
  batchRef: string;
  channel: CollectionChannel;
  debitDate: string;
  items: DebitItemReceipt[];
  vendorRef: string;
  adapter: string;
  submittedAt: string;
}

export type ReturnClass = "re_presentable" | "final";

export interface ReturnCodeInfo {
  reason: string;
  class: ReturnClass;
}

/**
 * NPCI return reason codes, kept small and conservative. `re_presentable` means the due may be
 * presented again (a new item: a fresh idempotency key, `attempt` + 1, and an approval); `final`
 * means it may not be without a person's review. A code not in this table is classed `final`
 * (`codeKnown: false`), so nothing is re-presented on a code nobody has checked.
 * [VERIFY] each entry against the sponsor bank's response file specification before an adapter
 * goes live; the bank's own codes are added to the adapter's mapping, not here. Sources: NPCI's
 * published NACH debit return reasons (codes 01 to 09) and NPCI's UPI response codes (Z9).
 */
export const NPCI_RETURN_CODES: Readonly<
  Record<CollectionChannel, Readonly<Record<string, Readonly<ReturnCodeInfo>>>>
> = Object.freeze({
  NACH: Object.freeze({
    "01": rc("Account closed or transferred", "final"),
    "02": rc("No such account", "final"),
    "03": rc("Account description does not tally", "final"),
    "04": rc("Balance insufficient", "re_presentable"),
    "06": rc("Payment stopped by drawer", "final"),
    "07": rc("Payment stopped under court order or account under litigation", "final"),
    "08": rc("Mandate not received", "final"),
    "09": rc("Miscellaneous (others)", "final"),
  }),
  UPI_AUTOPAY: Object.freeze({
    Z9: rc("Insufficient funds in the customer's account", "re_presentable"),
  }),
});

function rc(reason: string, cls: ReturnClass): Readonly<ReturnCodeInfo> {
  return Object.freeze({ reason, class: cls });
}

/** Class a return code; an unknown code is `final` with `codeKnown: false`. */
export function classifyReturnCode(
  channel: CollectionChannel,
  code: string,
): ReturnCodeInfo & { codeKnown: boolean } {
  const hit = Object.hasOwn(NPCI_RETURN_CODES[channel], code)
    ? NPCI_RETURN_CODES[channel][code]
    : undefined;
  return hit
    ? { ...hit, codeKnown: true }
    : { reason: "Unknown return code", class: "final", codeKnown: false };
}

export interface PresentationResult {
  presentationId: string;
  itemRef: string;
  idempotencyKey: string;
  amountMinor: number;
  outcome: "paid" | "returned";
  /** Set when returned: the NPCI (or bank) code, its reason, class and whether the table knows it. */
  returnCode: string | null;
  returnReason: string | null;
  returnClass: ReturnClass | null;
  codeKnown: boolean | null;
  /** Set when paid: the settlement reference (UTR or NPCI transaction reference) and date. */
  settlementRef: string | null;
  settledOn: string | null;
}

export interface PresentationResponse {
  batchId: string;
  channel: CollectionChannel;
  results: PresentationResult[];
  vendorRef: string;
  adapter: string;
  readAt: string;
}

export const StatementRange = z
  .object({ from: internal(z.iso.date()), to: internal(z.iso.date()) })
  .strict()
  .refine((r) => r.from <= r.to, "the range starts on or before its end");

export interface StatementLine {
  /** The bank's stable id of the line (for de-duplication across reads). */
  lineId: string;
  valueDate: string;
  amountMinor: number;
  direction: "credit" | "debit";
  /** The UTR or the bank's transaction reference, when the bank gives one. */
  reference: string | null;
  narration: string;
}

/** The collection half of DISBURSEMENT_RAIL. */
export interface CollectionRail {
  /**
   * Money-moving (`assertDebitBatch` first). Each key is presented at most once: a key presented
   * before with the same item is a replay (its first presentation, nothing sent); with another item
   * it is `IPB-PORT-004` and the whole batch is refused.
   */
  presentDebitBatch(batch: z.input<typeof DebitBatch>, call?: PortCall): Promise<DebitBatchReceipt>;
  /**
   * Parses the sponsor bank's response file into a result per item. A file naming an item that was
   * not presented, with another amount, or contradicting a result already read is refused
   * (`IPB-PORT-001`); reading the same file again gives the same results.
   */
  readPresentationResponse(rawFile: Uint8Array, call?: PortCall): Promise<PresentationResponse>;
  /** The collection account's statement lines whose value date is within the range (inclusive). */
  statementLines(range: z.input<typeof StatementRange>, call?: PortCall): Promise<StatementLine[]>;
}

export interface DisbursementRailPort extends Port, IdempotencyLookup, CollectionRail {}
