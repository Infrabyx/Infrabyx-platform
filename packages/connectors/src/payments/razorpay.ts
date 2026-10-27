// PAYMENTS reference `razorpay` (PL2 plan §8, P-01): Razorpay over the egress client with HTTP Basic
// auth. Hosted (Standard) Checkout only, auto-capture (P-06), IN residency, REGULATED (P-13).
// Test mode only in PL2: a live key id (`rzp_live_`) is refused outside prod/dr, a test key inside
// them except for the health probe (P-03, P-14).
// - P-05: the order `receipt` is derived from the idempotency key, and `lookup` lists orders by it.
// - P-07: a refund needs an approved R3 request for exactly its payload; at execution time the
//   payment's own refund list is read first, so a refund with our receipt is returned, not repeated,
//   and the amount may not exceed what was captured minus earlier refunds. A refund or mandate whose
//   outcome is unknown is never looked up as "absent": it stays pending for a person.
// - P-09: webhooks verify `X-Razorpay-Signature` over the raw body; checkout returns verify
//   `razorpay_signature` over `order_id|payment_id`. Client-side success is never trusted.
// - P-11: `reconcile` is read-only.
// Vendor facts not yet proven against the test-mode API are marked [VERIFY] (sandbox leg).
import type { AppEnv } from "@infrabyx/contracts/env";
import { PortError } from "@infrabyx/contracts/errors";
import {
  OrderSpec,
  RefundSpec,
  type AdapterDescriptor,
  type LookupResult,
  type Order,
  type PaymentEvent,
  type PaymentsPort,
  type PaymentStatus,
  type PortCall,
  type PortHealth,
  type ReconcileReport,
  type Refund,
} from "@infrabyx/contracts/ports";
import { verifyRazorpaySignature } from "@infrabyx/crypto";
import { createEgress, type EgressResponse } from "../core/http.js";
import { header, parseJson, vendorError, webhookRefused } from "../messaging/common.js";
import {
  assertCredentialMode,
  assertNotKilled,
  assertRefundApproved,
  assertSameAmount,
  methodCategory,
  reference,
  type RefundApprovals,
} from "./common.js";

type Secret = string | (() => Promise<string> | string);
const read = async (s: Secret) => (typeof s === "string" ? s : s());

export interface RazorpayOptions {
  env: AppEnv;
  /** `PAYMENTS_RAZORPAY_KEY_ID` (not secret). */
  keyId: string;
  /** `secrets/<env>/payments/razorpay/key_secret` */
  keySecret: Secret;
  /** `secrets/<env>/payments/razorpay/webhook_secret` */
  webhookSecret: Secret;
  /** PL1 approvals engine view for refunds (P-07). */
  approvals?: RefundApprovals;
  /** `kill.payments` (P-12). */
  killed?: () => boolean | Promise<boolean>;
  /** The production health probe's separate test-mode credential (P-14). */
  healthProbe?: boolean;
  /** UPI AutoPay / eNACH: billing cycles of a mandate (default 120) [VERIFY]. */
  mandateTotalCount?: number;
  /** Our side of reconciliation: orders we believe were paid in the range. */
  ours?: (range: {
    from: string;
    to: string;
  }) => Promise<Array<{ orderId: string; amountMinor: number }>>;
  /** Tests only: the Razorpay stub. */
  baseUrl?: string;
  allowLoopbackHttp?: boolean;
  now?: () => number;
}

const BASE = "https://api.razorpay.com/v1";
const ORDER_STATUS: Readonly<Record<string, PaymentStatus>> = {
  created: "created",
  attempted: "attempted",
  paid: "captured",
};
const REFUND_STATUS: Readonly<Record<string, Refund["status"]>> = {
  pending: "pending",
  processed: "processed",
  failed: "failed",
};
const EVENTS: Readonly<Record<string, PaymentEvent["type"]>> = {
  "payment.captured": "payment.captured",
  "order.paid": "payment.captured",
  "payment.failed": "payment.failed",
  "refund.processed": "refund.processed",
  "refund.failed": "refund.failed",
};

interface RzpOrder {
  id: string;
  amount: number;
  currency: string;
  receipt?: string;
  status: string;
}
interface RzpRefund {
  id: string;
  payment_id: string;
  amount: number;
  receipt?: string | null;
  status: string;
}
interface RzpPayment {
  id: string;
  order_id?: string;
  amount: number;
  amount_refunded?: number;
  status: string;
  method?: string;
  created_at?: number;
}

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

export class RazorpayPayments implements PaymentsPort {
  readonly descriptor: AdapterDescriptor = {
    port: "PAYMENTS",
    adapter: "razorpay",
    residency: "IN",
    maxDataClass: "REGULATED",
  };
  private readonly egress;

  constructor(private readonly o: RazorpayOptions) {
    const mode = o.keyId.startsWith("rzp_live_")
      ? "live"
      : o.keyId.startsWith("rzp_test_")
        ? "test"
        : null;
    if (!mode)
      throw new PortError("IPB-PORT-005", "PAYMENTS", {
        adapter: "razorpay",
        detail: "the key id is neither a test nor a live Razorpay key id",
      });
    assertCredentialMode(this.descriptor, o.env, mode, { healthProbe: o.healthProbe === true });
    this.egress = createEgress({
      port: "PAYMENTS",
      adapter: "razorpay",
      allow: ["api.razorpay.com"],
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
  }

  private async call(method: string, path: string, body?: unknown): Promise<EgressResponse> {
    const auth = Buffer.from(`${this.o.keyId}:${await read(this.o.keySecret)}`).toString("base64");
    return this.egress(`${(this.o.baseUrl ?? BASE).replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        authorization: `Basic ${auth}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  private async json<T>(method: string, path: string, what: string, body?: unknown): Promise<T> {
    const r = await this.call(method, path, body);
    if (r.status >= 300) throw vendorError("PAYMENTS", "razorpay", r.status, what);
    return r.json<T>();
  }

  private order(o: RzpOrder, ours?: number): Order {
    if (o.currency !== "INR")
      throw new PortError("IPB-PORT-002", "PAYMENTS", {
        adapter: "razorpay",
        detail: `unexpected currency ${o.currency}`,
      });
    if (ours !== undefined) assertSameAmount(this.descriptor, ours, o.amount);
    return {
      orderId: o.id,
      adapter: "razorpay",
      amountMinor: o.amount,
      currency: "INR",
      status: ORDER_STATUS[o.status] ?? "created",
      reference: o.receipt ?? "",
    };
  }

  async createOrder(spec: OrderSpec, idempotencyKey: string, _call?: PortCall): Promise<Order> {
    await assertNotKilled(this.descriptor, this.o.killed, "createOrder");
    const s = OrderSpec.parse(spec);
    const receipt = reference("ipb_", idempotencyKey);
    const o = await this.json<RzpOrder>("POST", "/orders", "createOrder", {
      amount: s.amountMinor,
      currency: s.currency,
      receipt,
      notes: { ...s.notes, ipb_customer: s.customerRef },
    });
    return this.order(o, s.amountMinor);
  }

  async createCheckoutSession(
    orderId: string,
    returnUrls: { success: string; cancel: string },
  ): Promise<{ sessionRef: string; url?: string }> {
    await assertNotKilled(this.descriptor, this.o.killed, "createCheckoutSession");
    for (const u of [returnUrls.success, returnUrls.cancel])
      if (new URL(u).protocol !== "https:")
        throw new PortError("IPB-SEC-018", "PAYMENTS", {
          adapter: "razorpay",
          detail: "return URLs must be HTTPS",
        });
    const o = await this.json<RzpOrder>("GET", `/orders/${encodeURIComponent(orderId)}`, "order");
    if (o.status === "paid")
      throw new PortError("IPB-PORT-001", "PAYMENTS", {
        adapter: "razorpay",
        detail: "the order is already paid",
        meta: { reason: "order_paid", definite: true },
      });
    // Standard Checkout opens on the browser with key id and order id (hosted, SAQ A).
    return { sessionRef: o.id };
  }

  async verifySignature(payload: Readonly<Record<string, string>>): Promise<boolean> {
    const order = payload.razorpay_order_id;
    const payment = payload.razorpay_payment_id;
    const sig = payload.razorpay_signature;
    if (!order || !payment || !sig) return false;
    return verifyRazorpaySignature(
      await read(this.o.keySecret),
      new TextEncoder().encode(`${order}|${payment}`),
      sig,
    );
  }

  async capture(paymentId: string, amountMinor: number): Promise<void> {
    const p = await this.json<RzpPayment>(
      "POST",
      `/payments/${encodeURIComponent(paymentId)}/capture`,
      "capture",
      { amount: amountMinor, currency: "INR" },
    );
    assertSameAmount(this.descriptor, amountMinor, p.amount);
  }

  async refund(spec: RefundSpec, idempotencyKey: string, _call?: PortCall): Promise<Refund> {
    await assertNotKilled(this.descriptor, this.o.killed, "refund");
    const s = RefundSpec.parse(spec);
    await assertRefundApproved(this.descriptor, this.o.approvals, s, this.o.now);
    const receipt = reference("ipb_rf_", idempotencyKey, 30);
    const pid = encodeURIComponent(s.paymentId);
    // The PA's own record at execution time (P-07).
    const p = await this.json<RzpPayment>("GET", `/payments/${pid}`, "refund");
    const list = await this.json<{ items?: RzpRefund[] }>(
      "GET",
      `/payments/${pid}/refunds`,
      "refund",
    );
    const mine = list.items?.find((r) => r.receipt === receipt);
    if (mine) return this.refundOf(mine);
    if (p.status !== "captured" && p.status !== "refunded")
      throw new PortError("IPB-PORT-001", "PAYMENTS", {
        adapter: "razorpay",
        detail: `payment is ${p.status}, not captured`,
        meta: { reason: "not_captured", definite: true },
      });
    const remaining = p.amount - (p.amount_refunded ?? 0);
    if (s.amountMinor > remaining)
      throw new PortError("IPB-PORT-001", "PAYMENTS", {
        adapter: "razorpay",
        detail: "refund exceeds the captured amount minus earlier refunds",
        meta: { reason: "exceeds_captured", definite: true },
      });
    const r = await this.json<RzpRefund>("POST", `/payments/${pid}/refund`, "refund", {
      amount: s.amountMinor,
      speed: "normal",
      receipt,
      notes: { ipb_approval: s.approvalRef },
    });
    assertSameAmount(this.descriptor, s.amountMinor, r.amount);
    return this.refundOf(r);
  }

  private refundOf(r: RzpRefund): Refund {
    return {
      refundId: r.id,
      paymentId: r.payment_id,
      amountMinor: r.amount,
      status: REFUND_STATUS[r.status] ?? "pending",
    };
  }

  async createMandate(
    spec: { customerRef: string; planRef: string; maxAmountMinor: number },
    idempotencyKey: string,
    _call?: PortCall,
  ): Promise<{ mandateId: string }> {
    await assertNotKilled(this.descriptor, this.o.killed, "createMandate");
    if (!Number.isSafeInteger(spec.maxAmountMinor) || spec.maxAmountMinor <= 0)
      throw new PortError("IPB-PORT-001", "PAYMENTS", {
        adapter: "razorpay",
        detail: "the mandate maximum is a positive integer in minor units (P-04)",
      });
    const sub = await this.json<{ id: string }>("POST", "/subscriptions", "createMandate", {
      plan_id: spec.planRef,
      total_count: this.o.mandateTotalCount ?? 120,
      customer_notify: 1,
      notes: {
        ipb_ref: reference("ipb_md_", idempotencyKey, 30),
        ipb_customer: spec.customerRef,
        ipb_max_minor: String(spec.maxAmountMinor),
      },
    });
    return { mandateId: sub.id };
  }

  /**
   * Router lookup for a pending operation (P-05, P-07). Orders are found by receipt; refunds and
   * mandates cannot be searched by our reference, so they are never reported absent.
   */
  async lookup(operation: string, idempotencyKey: string): Promise<LookupResult<unknown>> {
    if (operation !== "createOrder")
      return { status: "unknown", reason: `razorpay cannot search ${operation} by our reference` };
    const receipt = reference("ipb_", idempotencyKey);
    const r = await this.call("GET", `/orders?receipt=${encodeURIComponent(receipt)}`).catch(
      () => null,
    );
    if (!r || r.status >= 300) return { status: "unknown", reason: "razorpay order search failed" };
    const hit = r.json<{ items?: RzpOrder[] }>().items?.find((o) => o.receipt === receipt);
    return hit ? { status: "found", result: this.order(hit) } : { status: "absent" };
  }

  async verifyWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
  ): Promise<PaymentEvent[]> {
    const sig = header(headers, "x-razorpay-signature") ?? "";
    if (!verifyRazorpaySignature(await read(this.o.webhookSecret), rawBody, sig))
      throw webhookRefused("PAYMENTS", "razorpay", "X-Razorpay-Signature does not verify");
    const eventId = header(headers, "x-razorpay-event-id");
    if (!eventId) throw webhookRefused("PAYMENTS", "razorpay", "no X-Razorpay-Event-Id");
    const b = parseJson("PAYMENTS", "razorpay", rawBody) as {
      event?: string;
      created_at?: number;
      payload?: { payment?: { entity?: RzpPayment }; refund?: { entity?: RzpRefund } };
    };
    const payment = b.payload?.payment?.entity;
    const refund = b.payload?.refund?.entity;
    const event = b.event ?? "";
    const type: PaymentEvent["type"] =
      EVENTS[event] ?? (event.startsWith("subscription.") ? "mandate.updated" : "other");
    const amount = refund?.amount ?? payment?.amount;
    const paymentId = refund?.payment_id ?? payment?.id;
    return [
      {
        vendorEventId: eventId,
        type,
        ...(payment?.order_id ? { orderId: payment.order_id } : {}),
        ...(paymentId ? { paymentId } : {}),
        ...(amount !== undefined ? { amountMinor: amount } : {}),
        ...(payment?.method ? { method: methodCategory(payment.method) } : {}),
        at: new Date((b.created_at ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      },
    ];
  }

  private async all<T>(path: string, range: { from: string; to: string }): Promise<T[]> {
    const out: T[] = [];
    for (let skip = 0; skip < 1000; skip += 100) {
      const q = `from=${unix(range.from)}&to=${unix(range.to)}&count=100&skip=${skip}`;
      const page = await this.json<{ items?: T[] }>("GET", `${path}?${q}`, "reconcile");
      out.push(...(page.items ?? []));
      if ((page.items?.length ?? 0) < 100) break;
    }
    return out;
  }

  async reconcile(range: { from: string; to: string }): Promise<ReconcileReport> {
    const [payments, refunds, settlements] = await Promise.all([
      this.all<RzpPayment>("/payments", range),
      this.all<RzpRefund>("/refunds", range),
      this.all<{ id: string }>("/settlements", range),
    ]);
    const differences: ReconcileReport["differences"] = [];
    if (this.o.ours) {
      const captured = new Map<string, number>();
      for (const p of payments)
        if (p.status === "captured" && p.order_id)
          captured.set(p.order_id, (captured.get(p.order_id) ?? 0) + p.amount);
      const ours = await this.o.ours(range);
      for (const x of ours) {
        const theirs = captured.get(x.orderId);
        if (theirs === undefined)
          differences.push({ ref: x.orderId, kind: "missing_at_pa", ours: x.amountMinor });
        else if (theirs !== x.amountMinor)
          differences.push({
            ref: x.orderId,
            kind: "amount_mismatch",
            ours: x.amountMinor,
            theirs,
          });
        captured.delete(x.orderId);
      }
      for (const [ref, theirs] of captured)
        differences.push({ ref, kind: "unknown_to_us", theirs });
    }
    return {
      from: range.from,
      to: range.to,
      payments: payments.length,
      refunds: refunds.length,
      settlements: settlements.length,
      differences,
    };
  }

  async health(): Promise<PortHealth> {
    const t0 = Date.now();
    let status: PortHealth["status"];
    try {
      const r = await this.call("GET", "/orders?count=1");
      status = r.status === 200 ? "up" : r.status === 429 ? "degraded" : "down";
    } catch {
      status = "down";
    }
    return { status, latency_ms: Date.now() - t0, checked_at: new Date().toISOString() };
  }
}
