// PAYOUTS port (IPB-01 PAYOUTS; Finbyx PR-FBX-29, R1-D-46). Disbursement to customers and vendors.
// Interfaces and fakes only: no vendor adapter exists until the owner approves one (locked list:
// money movement). Every `payout` carries an idempotency key, an amount in integer paise, the
// approved maker-checker request and a user or service initiator, never an agent
// (`assertMoneyCall`). "accepted" is never final: only `settled` (with the UTR and value date),
// `failed` or `reversed` are. Payouts never fail over automatically (IPB-01).
import { z } from "zod";
import type { IdempotencyLookup, Port, PortCall, WebhookRequestMeta } from "./common.js";
import { IFSC } from "./kyc.js";
import { MoneyAuthorisation } from "./money.js";
import { AmountMinor } from "./payments.js";
import { classed } from "./payload-class.js";

const regulated = <T extends z.ZodType>(s: T): T => classed(s, "REGULATED");
const internal = <T extends z.ZodType>(s: T): T => classed(s, "INTERNAL");

export const PAYOUT_MODES = ["IMPS", "NEFT", "RTGS", "UPI"] as const;
export type PayoutMode = (typeof PAYOUT_MODES)[number];

export const AccountValidation = z
  .object({
    ifsc: regulated(z.string().regex(IFSC)),
    account: regulated(z.string().regex(/^[0-9]{6,18}$/)),
  })
  .strict();

export const BeneficiarySpec = z
  .object({
    /** The product's reference for the beneficiary (a customer or vendor id). */
    beneficiaryRef: regulated(z.string().min(1).max(120)),
    name: regulated(z.string().min(1).max(200)),
    ifsc: regulated(z.string().regex(IFSC)).optional(),
    account: regulated(z.string().regex(/^[0-9]{6,18}$/)).optional(),
    vpa: regulated(z.string().regex(/^[A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64}$/)).optional(),
  })
  .strict()
  .refine((b) => (b.ifsc && b.account) || b.vpa, "a bank account (IFSC and number) or a VPA");

export const PayoutSpec = z
  .object({
    beneficiaryId: internal(z.string().min(1).max(120)),
    amountMinor: regulated(AmountMinor),
    mode: internal(z.enum(PAYOUT_MODES)),
    /** What the payout is for, e.g. the loan or invoice reference. */
    purposeRef: internal(z.string().min(1).max(120)),
    authorisation: MoneyAuthorisation,
  })
  .strict();

export interface AccountValidationResult {
  valid: boolean;
  /** The account holder's name as the bank returns it (penny drop). */
  holderName: string | null;
  vendorRef: string;
  adapter: string;
  checkedAt: string;
}

export type PayoutState = "accepted" | "processing" | "settled" | "failed" | "reversed";
export const FINAL_PAYOUT_STATES: readonly PayoutState[] = ["settled", "failed", "reversed"];

export interface Payout {
  payoutId: string;
  beneficiaryId: string;
  amountMinor: number;
  mode: PayoutMode;
  state: PayoutState;
  /** The bank's unique transaction reference, once settled. */
  utr: string | null;
  valueDate: string | null;
  failureReason: string | null;
  vendorRef: string;
  adapter: string;
}

export interface PayoutsPort extends Port, IdempotencyLookup {
  createBeneficiary(
    spec: z.infer<typeof BeneficiarySpec>,
    call?: PortCall,
  ): Promise<{ beneficiaryId: string }>;
  /** Penny drop: the bank's account-holder name for the account. */
  validateAccount(
    req: z.infer<typeof AccountValidation>,
    idempotencyKey: string,
    call?: PortCall,
  ): Promise<AccountValidationResult>;
  /** Money-moving (`assertMoneyCall` first). The result is never final at "accepted". */
  payout(
    spec: z.infer<typeof PayoutSpec>,
    idempotencyKey: string,
    call?: PortCall,
  ): Promise<Payout>;
  getStatus(payoutId: string): Promise<Payout>;
  /** Settlement, failure and reversal events; parsed, then read back with `getStatus`. */
  handleWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    meta?: WebhookRequestMeta,
  ): Promise<Payout>;
  /** The disbursement account's balance in paise. */
  balance(): Promise<{ availableMinor: number; asOf: string }>;
}
