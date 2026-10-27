// PAYMENTS port (IPB-01 §01.4.4.2; PL2 plan §8, PL2-D-08 to PL2-D-10). Hosted or tokenised
// checkout only (PCI DSS SAQ A); card data never touches Infrabyx. Payment metadata is REGULATED
// and stays in India (RBI/2017-18/153, P-13). This port never computes invoices (OH8 is the billing
// engine of record) and never moves money out (PAYOUTS is a separate port).
import { z } from "zod";
import { PortError } from "../errors.js";
import type { IdempotencyLookup, Port, PortCall } from "./common.js";
import { classed } from "./payload-class.js";

const regulated = <T extends z.ZodType>(s: T): T => classed(s, "REGULATED");
const internal = <T extends z.ZodType>(s: T): T => classed(s, "INTERNAL");

/** Amount in minor units (paise): a safe integer above zero; never a float (P-04). */
export const AmountMinor = z
  .number()
  .int()
  .positive()
  .refine(Number.isSafeInteger, "amount must be a safe integer");

/** INR only in PL2 (P-04). */
export const Currency = z.literal("INR");

export const OrderSpec = z.object({
  amountMinor: regulated(AmountMinor),
  currency: regulated(Currency),
  /** Our customer reference (an ID, never a name or contact detail). */
  customerRef: regulated(z.string().min(1)),
  notes: internal(z.record(z.string(), z.string()).optional()),
});
export type OrderSpec = z.infer<typeof OrderSpec>;

export const RefundSpec = z.object({
  paymentId: regulated(z.string().min(1)),
  amountMinor: regulated(AmountMinor),
  reason: internal(z.string().min(1).max(255)),
  /** Approved maker-checker request for `payments.refund` (R3, P-07). */
  approvalRef: internal(z.string().min(1)),
});
export type RefundSpec = z.infer<typeof RefundSpec>;

export type PaymentStatus =
  | "created"
  | "attempted"
  | "authorized"
  | "captured"
  | "failed"
  | "refunded"
  | "partially_refunded";

export interface Order {
  orderId: string;
  /** Adapter that owns the order; in-flight orders complete on it (P-08). */
  adapter: string;
  amountMinor: number;
  currency: "INR";
  status: PaymentStatus;
  /** Our reference sent to the PA (Razorpay `receipt`); a reference, not a uniqueness guarantee (PL2-D-08). */
  reference: string;
}

export interface Refund {
  refundId: string;
  paymentId: string;
  amountMinor: number;
  status: "pending" | "processed" | "failed";
}

export interface PaymentEvent {
  /** Vendor event id used for inbox de-duplication (Razorpay `x-razorpay-event-id`, P-09). */
  vendorEventId: string;
  type:
    | "payment.captured"
    | "payment.failed"
    | "refund.processed"
    | "refund.failed"
    | "mandate.updated"
    | "other";
  orderId?: string;
  paymentId?: string;
  amountMinor?: number;
  /** Method category only (P-10): never card, VPA or account values. */
  method?: "card" | "upi" | "netbanking" | "wallet" | "emi" | "other";
  at: string;
}

/** Technical outcome counted by the failover success rate (P-08); customer and issuer declines are not. */
export type PaTechnicalOutcome = "ok" | "api_error" | "timeout" | "gateway_failure";

export interface ReconcileReport {
  from: string;
  to: string;
  payments: number;
  refunds: number;
  settlements: number;
  differences: Array<{ ref: string; kind: string; ours?: number; theirs?: number }>;
}

export interface PaymentsPort extends Port, IdempotencyLookup {
  createOrder(spec: OrderSpec, idempotencyKey: string, call?: PortCall): Promise<Order>;
  createCheckoutSession(
    orderId: string,
    returnUrls: { success: string; cancel: string },
  ): Promise<{ sessionRef: string; url?: string }>;
  /** Checkout-return signature check; the final state still comes from a webhook or a server fetch (P-09). */
  verifySignature(payload: Readonly<Record<string, string>>): Promise<boolean>;
  capture(paymentId: string, amountMinor: number): Promise<void>;
  /** Checks the PA's own refund list at execution time before refunding (P-07). */
  refund(spec: RefundSpec, idempotencyKey: string, call?: PortCall): Promise<Refund>;
  createMandate(
    spec: { customerRef: string; planRef: string; maxAmountMinor: number },
    idempotencyKey: string,
    call?: PortCall,
  ): Promise<{ mandateId: string }>;
  verifyWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
  ): Promise<PaymentEvent[]>;
  /** Read-only; never corrects anything (P-11). */
  reconcile(range: { from: string; to: string }): Promise<ReconcileReport>;
}

/**
 * Minor units to a decimal string with integer arithmetic only (P-04): 12345 → "123.45".
 * Cashfree takes rupees as a decimal; never divide a float.
 */
export function minorToDecimal(amountMinor: number, exponent = 2): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0)
    throw new PortError("IPB-PORT-001", "PAYMENTS", {
      detail: "amount must be a non-negative safe integer",
    });
  const v = BigInt(amountMinor);
  const base = 10n ** BigInt(exponent);
  const whole = v / base;
  const frac = (v % base).toString().padStart(exponent, "0");
  return exponent === 0 ? whole.toString() : `${whole}.${frac}`;
}

/** Decimal string to minor units, refusing anything that is not exact (P-04 exact-equality check). */
export function decimalToMinor(value: string, exponent = 2): number {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m)
    throw new PortError("IPB-PORT-001", "PAYMENTS", { detail: `not a decimal amount: ${value}` });
  const frac = m[2] ?? "";
  if (frac.length > exponent && /[^0]/.test(frac.slice(exponent)))
    throw new PortError("IPB-PORT-001", "PAYMENTS", {
      detail: `more than ${exponent} decimals: ${value}`,
    });
  const minor =
    BigInt(m[1] as string) * 10n ** BigInt(exponent) +
    BigInt((frac.slice(0, exponent) || "0").padEnd(exponent, "0"));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER))
    throw new PortError("IPB-PORT-001", "PAYMENTS", { detail: "amount exceeds a safe integer" });
  return Number(minor);
}
