// PAYMENTS alternative `cashfree` (PL2 plan §8, P-01): Cashfree PG over the egress client. Hosted
// checkout only (payment session id for Cashfree's JS checkout), auto-capture (P-06), IN residency,
// REGULATED (P-13). Test mode only in PL2: the production host is refused outside prod/dr, the
// sandbox inside them except for the health probe (P-03, P-14).
// - P-05: `order_id`, `refund_id` and `subscription_id` are derived from the idempotency key, and
//   `x-idempotency-key` carries a UUID derived from it; lookup fetches the order or subscription by
//   our id. Only a 404 counts as "absent" (Cashfree may answer 400 for unknown ids [VERIFY]).
// - P-07: refunds need an approved R3 request; the order's refund list is read first, so a refund
//   with our id is returned, not repeated; the amount may not exceed what was paid minus earlier
//   refunds. A refund whose outcome is unknown is never reported absent.
// - P-09: webhooks verify `x-webhook-signature` (base64 HMAC of timestamp ‖ raw body, ±5 min);
//   a checkout return is checked by fetching the order server-side.
// - Amounts go to Cashfree as rupee decimals built with integer arithmetic only (P-04).
// - Cashfree needs the customer's phone (and email for mandates) on orders: the caller supplies a
//   resolver; contact details go only to this IN adapter.
// Vendor facts from Cashfree's official SDKs (PL2-D-66); unproven details are marked [VERIFY].
import type { AppEnv } from "@infrabyx/contracts/env";
import { PortError } from "@infrabyx/contracts/errors";
import {
  OrderSpec,
  RefundSpec,
  decimalToMinor,
  minorToDecimal,
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
import { sha256, sha256Hex, toHex, verifyCashfreeSignature } from "@infrabyx/crypto";
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

export interface CashfreeOptions {
  env: AppEnv;
  /** `sandbox` everywhere in PL2; `production` only in prod/dr (P-03). */
  environment: "sandbox" | "production";
  /** `PAYMENTS_CASHFREE_APP_ID` (not secret). */
  appId: string;
  /** `secrets/<env>/payments/cashfree/secret_key`; also signs webhooks. */
  secretKey: Secret;
  /** Contact details Cashfree requires for an order or mandate; never sent anywhere else. */
  customerContact: (customerRef: string) => Promise<{ phone: string; email?: string }>;
  approvals?: RefundApprovals;
  killed?: () => boolean | Promise<boolean>;
  healthProbe?: boolean;
  /** `x-api-version` (default 2023-08-01) [VERIFY against the current version]. */
  apiVersion?: string;
  ours?: (range: {
    from: string;
    to: string;
  }) => Promise<Array<{ orderId: string; amountMinor: number }>>;
  /** Tests only: the Cashfree stub. */
  baseUrl?: string;
  allowLoopbackHttp?: boolean;
  now?: () => number;
}

const HOSTS = { sandbox: "sandbox.cashfree.com", production: "api.cashfree.com" } as const;
const ORDER_STATUS: Readonly<Record<string, PaymentStatus>> = {
  ACTIVE: "created",
  PAID: "captured",
  EXPIRED: "failed",
  TERMINATED: "failed",
  TERMINATION_REQUESTED: "failed",
};
const REFUND_STATUS: Readonly<Record<string, Refund["status"]>> = {
  SUCCESS: "processed",
  PENDING: "pending",
  ONHOLD: "pending",
  CANCELLED: "failed",
  FAILED: "failed",
};

/** A stable UUID (version 4 layout) derived from our key for `x-idempotency-key`. */
export function cashfreeIdempotencyKey(key: string): string {
  const h = sha256(`ipb/cashfree-idempotency/${key}`).slice(0, 16);
  h[6] = (h[6]! & 0x0f) | 0x40;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = toHex(h);
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Alphanumeric ids: `refund_id` allows letters and digits only (3–40) [VERIFY]. */
const alnumRef = (prefix: string, key: string) =>
  `${prefix}${sha256Hex(`ipb/payments/${key}`).slice(0, 30)}`;

interface CfOrder {
  order_id: string;
  order_amount: number | string;
  order_currency: string;
  order_status: string;
  payment_session_id?: string;
}
interface CfRefund {
  refund_id: string;
  order_id: string;
  cf_payment_id?: string | number;
  refund_amount: number | string;
  refund_status: string;
}

/** A vendor amount to minor units, refusing anything that is not exactly representable (P-04). */
const minor = (v: number | string): number => {
  if (typeof v === "string") return decimalToMinor(v);
  const fixed = v.toFixed(2);
  if (!Number.isFinite(v) || Number(fixed) !== v)
    throw new PortError("IPB-PORT-002", "PAYMENTS", {
      adapter: "cashfree",
      detail: "cashfree returned an amount with more than two decimals",
      meta: { reason: "amount_mismatch" },
    });
  return decimalToMinor(fixed);
};

/** Marks a decimal string to be written as a bare JSON number, never through a float (P-04). */
class Decimal {
  constructor(readonly text: string) {}
}
const decimal = (amountMinor: number) => new Decimal(minorToDecimal(amountMinor));
/** JSON with Decimal values written as their exact text. */
function toJson(body: unknown): string {
  const marks: string[] = [];
  const text = JSON.stringify(body, (_k, v: unknown) =>
    v instanceof Decimal ? `\u0000dec${marks.push(v.text) - 1}\u0000` : v,
  );
  return text.replace(/"\\u0000dec(\d+)\\u0000"/g, (_m, i: string) => marks[Number(i)]!);
}

export class CashfreePayments implements PaymentsPort {
  readonly descriptor: AdapterDescriptor = {
    port: "PAYMENTS",
    adapter: "cashfree",
    residency: "IN",
    maxDataClass: "REGULATED",
    capabilities: { reconcile: "emulated" },
  };
  private readonly egress;

  constructor(private readonly o: CashfreeOptions) {
    assertCredentialMode(this.descriptor, o.env, o.environment === "production" ? "live" : "test", {
      healthProbe: o.healthProbe === true,
    });
    this.egress = createEgress({
      port: "PAYMENTS",
      adapter: "cashfree",
      allow: [HOSTS[o.environment]],
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
  }

  private get base(): string {
    return (this.o.baseUrl ?? `https://${HOSTS[this.o.environment]}/pg`).replace(/\/$/, "");
  }

  private async call(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<EgressResponse> {
    return this.egress(`${this.base}${path}`, {
      method,
      headers: {
        "x-client-id": this.o.appId,
        "x-client-secret": await read(this.o.secretKey),
        "x-api-version": this.o.apiVersion ?? "2023-08-01",
        accept: "application/json",
        ...(idempotencyKey ? { "x-idempotency-key": cashfreeIdempotencyKey(idempotencyKey) } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: toJson(body) }),
    });
  }

  private async json<T>(method: string, path: string, what: string, body?: unknown, key?: string) {
    const r = await this.call(method, path, body, key);
    if (r.status === 422)
      throw new PortError("IPB-PORT-004", "PAYMENTS", {
        adapter: "cashfree",
        detail: `${what}: idempotency key reused with a different request`,
      });
    if (r.status >= 300) throw vendorError("PAYMENTS", "cashfree", r.status, what);
    return r.json<T>();
  }

  private order(o: CfOrder, ours?: number): Order {
    if (o.order_currency !== "INR")
      throw new PortError("IPB-PORT-002", "PAYMENTS", {
        adapter: "cashfree",
        detail: `unexpected currency ${o.order_currency}`,
      });
    const amountMinor = minor(o.order_amount);
    if (ours !== undefined) assertSameAmount(this.descriptor, ours, amountMinor);
    return {
      orderId: o.order_id,
      adapter: "cashfree",
      amountMinor,
      currency: "INR",
      status: ORDER_STATUS[o.order_status] ?? "created",
      reference: o.order_id,
    };
  }

  private async getOrder(orderId: string): Promise<CfOrder> {
    return this.json<CfOrder>("GET", `/orders/${encodeURIComponent(orderId)}`, "order");
  }

  async createOrder(spec: OrderSpec, idempotencyKey: string, _call?: PortCall): Promise<Order> {
    await assertNotKilled(this.descriptor, this.o.killed, "createOrder");
    const s = OrderSpec.parse(spec);
    const orderId = reference("ipb_", idempotencyKey);
    const contact = await this.o.customerContact(s.customerRef);
    const r = await this.call(
      "POST",
      "/orders",
      {
        order_id: orderId,
        order_amount: decimal(s.amountMinor),
        order_currency: s.currency,
        customer_details: { customer_id: s.customerRef, customer_phone: contact.phone },
        ...(s.notes ? { order_tags: s.notes } : {}),
      },
      idempotencyKey,
    );
    // 409: our order id already exists, created by an earlier attempt: return that order.
    if (r.status === 409) return this.order(await this.getOrder(orderId), s.amountMinor);
    if (r.status === 422)
      throw new PortError("IPB-PORT-004", "PAYMENTS", {
        adapter: "cashfree",
        detail: "idempotency key reused with a different request",
      });
    if (r.status >= 300) throw vendorError("PAYMENTS", "cashfree", r.status, "createOrder");
    return this.order(r.json<CfOrder>(), s.amountMinor);
  }

  async createCheckoutSession(
    orderId: string,
    returnUrls: { success: string; cancel: string },
  ): Promise<{ sessionRef: string; url?: string }> {
    await assertNotKilled(this.descriptor, this.o.killed, "createCheckoutSession");
    for (const u of [returnUrls.success, returnUrls.cancel])
      if (new URL(u).protocol !== "https:")
        throw new PortError("IPB-SEC-018", "PAYMENTS", {
          adapter: "cashfree",
          detail: "return URLs must be HTTPS",
        });
    const o = await this.getOrder(orderId);
    if (o.order_status !== "ACTIVE" || !o.payment_session_id)
      throw new PortError("IPB-PORT-001", "PAYMENTS", {
        adapter: "cashfree",
        detail: `the order is ${o.order_status}, not open for payment`,
        meta: { reason: "order_not_active", definite: true },
      });
    return { sessionRef: o.payment_session_id };
  }

  /** Cashfree's return carries no signature: the order is fetched server-side (P-09). */
  async verifySignature(payload: Readonly<Record<string, string>>): Promise<boolean> {
    const id = payload.order_id;
    if (!id) return false;
    const o = await this.getOrder(id).catch(() => null);
    return o?.order_status === "PAID";
  }

  async capture(paymentId: string, amountMinor: number): Promise<void> {
    // Cashfree authorises by order; `paymentId` is our order id here (P-06: unused in PL2).
    await this.json("POST", `/orders/${encodeURIComponent(paymentId)}/authorization`, "capture", {
      action: "CAPTURE",
      amount: decimal(amountMinor),
    });
  }

  async refund(spec: RefundSpec, idempotencyKey: string, _call?: PortCall): Promise<Refund> {
    await assertNotKilled(this.descriptor, this.o.killed, "refund");
    const s = RefundSpec.parse(spec);
    await assertRefundApproved(this.descriptor, this.o.approvals, s, this.o.now);
    // Cashfree refunds by order: `paymentId` is the order id the payment belongs to.
    const orderId = encodeURIComponent(s.paymentId);
    const refundId = alnumRef("ipbrf", idempotencyKey);
    const o = await this.getOrder(s.paymentId);
    const prior = await this.json<CfRefund[]>("GET", `/orders/${orderId}/refunds`, "refund");
    const mine = prior.find((r) => r.refund_id === refundId);
    if (mine) return this.refundOf(mine);
    if (o.order_status !== "PAID")
      throw new PortError("IPB-PORT-001", "PAYMENTS", {
        adapter: "cashfree",
        detail: `order is ${o.order_status}, not paid`,
        meta: { reason: "not_captured", definite: true },
      });
    const refunded = prior
      .filter((r) => REFUND_STATUS[r.refund_status] !== "failed")
      .reduce((sum, r) => sum + minor(r.refund_amount), 0);
    if (s.amountMinor > minor(o.order_amount) - refunded)
      throw new PortError("IPB-PORT-001", "PAYMENTS", {
        adapter: "cashfree",
        detail: "refund exceeds the paid amount minus earlier refunds",
        meta: { reason: "exceeds_captured", definite: true },
      });
    const r = await this.json<CfRefund>(
      "POST",
      `/orders/${orderId}/refunds`,
      "refund",
      {
        refund_id: refundId,
        refund_amount: decimal(s.amountMinor),
        refund_note: s.reason.slice(0, 100),
        refund_speed: "STANDARD",
      },
      idempotencyKey,
    );
    assertSameAmount(this.descriptor, s.amountMinor, minor(r.refund_amount));
    return this.refundOf(r);
  }

  private refundOf(r: CfRefund): Refund {
    return {
      refundId: r.refund_id,
      paymentId: r.order_id,
      amountMinor: minor(r.refund_amount),
      status: REFUND_STATUS[r.refund_status] ?? "pending",
    };
  }

  async createMandate(
    spec: { customerRef: string; planRef: string; maxAmountMinor: number },
    idempotencyKey: string,
    _call?: PortCall,
  ): Promise<{ mandateId: string }> {
    await assertNotKilled(this.descriptor, this.o.killed, "createMandate");
    const contact = await this.o.customerContact(spec.customerRef);
    if (!contact.email)
      throw new PortError("IPB-PORT-001", "PAYMENTS", {
        adapter: "cashfree",
        detail: "a Cashfree mandate needs the customer's email",
        meta: { reason: "invalid_request", definite: true },
      });
    const id = reference("ipb_md_", idempotencyKey, 30);
    await this.json(
      "POST",
      "/subscriptions",
      "createMandate",
      {
        subscription_id: id,
        customer_details: { customer_email: contact.email, customer_phone: contact.phone },
        plan_details: { plan_id: spec.planRef },
        subscription_tags: { ipb_max_minor: String(spec.maxAmountMinor) },
      },
      idempotencyKey,
    );
    return { mandateId: id };
  }

  /** Orders and mandates are fetched by our id; refunds need the order, so they stay unknown. */
  async lookup(operation: string, idempotencyKey: string): Promise<LookupResult<unknown>> {
    const by = (path: string) =>
      this.call("GET", path).catch(() => null) as Promise<EgressResponse | null>;
    if (operation === "createOrder") {
      const r = await by(`/orders/${reference("ipb_", idempotencyKey)}`);
      if (r?.status === 200) return { status: "found", result: this.order(r.json<CfOrder>()) };
      if (r?.status === 404) return { status: "absent" };
      return { status: "unknown", reason: "cashfree order fetch inconclusive" };
    }
    if (operation === "createMandate") {
      const id = reference("ipb_md_", idempotencyKey, 30);
      const r = await by(`/subscriptions/${id}`);
      if (r?.status === 200) return { status: "found", result: { mandateId: id } };
      if (r?.status === 404) return { status: "absent" };
      return { status: "unknown", reason: "cashfree subscription fetch inconclusive" };
    }
    return { status: "unknown", reason: `cashfree cannot find ${operation} without its order` };
  }

  async verifyWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
  ): Promise<PaymentEvent[]> {
    const ts = header(headers, "x-webhook-timestamp") ?? "";
    const sig = header(headers, "x-webhook-signature") ?? "";
    const ok = verifyCashfreeSignature(await read(this.o.secretKey), rawBody, ts, sig, {
      ...(this.o.now ? { now: this.o.now() } : {}),
    });
    if (!ok) throw webhookRefused("PAYMENTS", "cashfree", "x-webhook-signature does not verify");
    const b = parseJson("PAYMENTS", "cashfree", rawBody) as {
      type?: string;
      event_time?: string;
      data?: {
        order?: { order_id?: string; order_amount?: number | string };
        payment?: {
          cf_payment_id?: string | number;
          payment_amount?: number | string;
          payment_group?: string;
        };
        refund?: CfRefund;
      };
    };
    const vendorEventId =
      header(headers, "x-idempotency-header") ?? sha256Hex(rawBody).slice(0, 40);
    const t = b.type ?? "";
    const refund = b.data?.refund;
    const type: PaymentEvent["type"] =
      t === "PAYMENT_SUCCESS_WEBHOOK"
        ? "payment.captured"
        : t === "PAYMENT_FAILED_WEBHOOK"
          ? "payment.failed"
          : t === "REFUND_STATUS_WEBHOOK"
            ? REFUND_STATUS[refund?.refund_status ?? ""] === "processed"
              ? "refund.processed"
              : REFUND_STATUS[refund?.refund_status ?? ""] === "failed"
                ? "refund.failed"
                : "other"
            : t.startsWith("SUBSCRIPTION_")
              ? "mandate.updated"
              : "other";
    const orderId = b.data?.order?.order_id ?? refund?.order_id;
    const paymentId = b.data?.payment?.cf_payment_id ?? refund?.cf_payment_id;
    const amount = refund?.refund_amount ?? b.data?.payment?.payment_amount;
    const at = Date.parse(b.event_time ?? "");
    return [
      {
        vendorEventId,
        type,
        ...(orderId ? { orderId } : {}),
        ...(paymentId !== undefined ? { paymentId: String(paymentId) } : {}),
        ...(amount !== undefined ? { amountMinor: minor(amount) } : {}),
        ...(b.data?.payment?.payment_group
          ? { method: methodCategory(b.data.payment.payment_group) }
          : {}),
        at: Number.isFinite(at) ? new Date(at).toISOString() : new Date().toISOString(),
      },
    ];
  }

  /** Read-only (P-11): our paid orders checked against Cashfree; settlements counted. */
  async reconcile(range: { from: string; to: string }): Promise<ReconcileReport> {
    const differences: ReconcileReport["differences"] = [];
    const ours = this.o.ours ? (await this.o.ours(range)).slice(0, 500) : [];
    for (const x of ours) {
      const r = await this.call("GET", `/orders/${encodeURIComponent(x.orderId)}`);
      if (r.status === 404) {
        differences.push({ ref: x.orderId, kind: "missing_at_pa", ours: x.amountMinor });
        continue;
      }
      if (r.status >= 300) throw vendorError("PAYMENTS", "cashfree", r.status, "reconcile");
      const o = r.json<CfOrder>();
      const theirs = minor(o.order_amount);
      if (o.order_status !== "PAID")
        differences.push({
          ref: x.orderId,
          kind: `not_paid_${o.order_status.toLowerCase()}`,
          ours: x.amountMinor,
          theirs,
        });
      else if (theirs !== x.amountMinor)
        differences.push({ ref: x.orderId, kind: "amount_mismatch", ours: x.amountMinor, theirs });
    }
    const st = await this.json<{ data?: unknown[] }>("POST", "/settlements", "reconcile", {
      pagination: { limit: 1000 },
      filters: { start_date: range.from, end_date: range.to },
    });
    return {
      from: range.from,
      to: range.to,
      payments: ours.length,
      refunds: 0,
      settlements: st.data?.length ?? 0,
      differences,
    };
  }

  async health(): Promise<PortHealth> {
    const t0 = Date.now();
    let status: PortHealth["status"];
    try {
      // An authenticated fetch of an id that never exists: 404 (or 400) means up and authorised.
      const r = await this.call("GET", "/orders/ipb_health_probe_absent");
      status = r.status === 404 || r.status === 400 ? "up" : r.status === 429 ? "degraded" : "down";
    } catch {
      status = "down";
    }
    return { status, latency_ms: Date.now() - t0, checked_at: new Date().toISOString() };
  }
}
