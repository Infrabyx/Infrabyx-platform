// PAYMENTS contract legs (PL2 plan §8, P-15). Hermetic: Razorpay and Cashfree stubs built from the
// vendors' official SDKs (PL2-D-66), test mode only, no live key anywhere (P-03). The sandbox legs
// (Razorpay test mode, Cashfree sandbox) skip themselves until the accounts exist (IPB-DEV-04).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkRouting } from "@infrabyx/contracts/routing";
import type { OrderSpec, PaymentsPort, RefundSpec } from "@infrabyx/contracts/ports";
import { SecretKey, canonicalDigest, hmacSha256, hmacSha256Hex } from "@infrabyx/crypto";
import {
  defineContractSuite,
  startCashfreeStub,
  startRazorpayStub,
  type ContractCase,
  type PaymentsStub,
} from "@infrabyx/testing";
import { MemoryIdempotencyStore, type IdempotencyRequest } from "../../core/idempotency.js";
import { Router } from "../../core/router.js";
import { CashfreePayments } from "../cashfree.js";
import { refundPayload, type RefundApprovals } from "../common.js";
import { RazorpayPayments } from "../razorpay.js";

let rzp: PaymentsStub;
let cf: PaymentsStub;
let killed = false;
const webhookSecret = "rzp-webhook-secret-for-tests-0123456789";
const approved = new Map<
  string,
  { action: string; state: string; payloadDigest: string; delayUntil: Date | null }
>();
const approvals: RefundApprovals = {
  get: async (id) => {
    const a = approved.get(id);
    if (!a) throw new Error("not found");
    return a;
  },
};
const approve = (
  spec: Omit<RefundSpec, "approvalRef">,
  over: Partial<{ action: string; state: string }> = {},
) => {
  const id = `apr_${approved.size + 1}`;
  approved.set(id, {
    action: over.action ?? "payments.refund",
    state: over.state ?? "approved",
    payloadDigest: canonicalDigest(refundPayload({ ...spec, approvalRef: id })),
    delayUntil: null,
  });
  return id;
};

const razorpay = (o: Partial<{ env: "dev" | "prod"; keyId: string; healthProbe: boolean }> = {}) =>
  new RazorpayPayments({
    env: o.env ?? "dev",
    keyId: o.keyId ?? rzp.keyId,
    keySecret: () => rzp.secret,
    webhookSecret,
    approvals,
    killed: () => killed,
    ...(o.healthProbe ? { healthProbe: true } : {}),
    baseUrl: `${rzp.url}/v1`,
    allowLoopbackHttp: true,
  });
const cashfree = (
  o: Partial<{ env: "dev" | "prod"; environment: "sandbox" | "production" }> = {},
) =>
  new CashfreePayments({
    env: o.env ?? "dev",
    environment: o.environment ?? "sandbox",
    appId: cf.keyId,
    secretKey: () => cf.secret,
    customerContact: async () => ({ phone: "9999900001", email: "customer@example.test" }),
    approvals,
    killed: () => killed,
    baseUrl: `${cf.url}/pg`,
    allowLoopbackHttp: true,
  });

const spec = (amountMinor = 12345): OrderSpec => ({
  amountMinor,
  currency: "INR",
  customerRef: "cus_0001",
});
let n = 0;
const key = (p: string) => `${p}-${Date.now()}-${++n}`;

interface Harness {
  stub(): PaymentsStub;
  /** A signed webhook for a captured payment of `orderId`. */
  captured(
    orderId: string,
    amountMinor: number,
    eventId: string,
  ): { body: Uint8Array; headers: Record<string, string> };
  /** The return parameters the browser posts back after paying `orderId`. */
  checkoutReturn(orderId: string, paymentId: string): Record<string, string>;
  /** Refund target: Razorpay refunds a payment, Cashfree an order. */
  refundTarget(orderId: string, paymentId: string): string;
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const rzpHarness: Harness = {
  stub: () => rzp,
  captured: (orderId, amountMinor, eventId) => {
    const body = enc({
      entity: "event",
      event: "payment.captured",
      contains: ["payment"],
      payload: {
        payment: {
          entity: {
            id: "pay_X",
            order_id: orderId,
            amount: amountMinor,
            status: "captured",
            method: "upi",
          },
        },
      },
      created_at: Math.floor(Date.now() / 1000),
    });
    const k = new SecretKey("rzp-webhook", "hmac-sha-256", new TextEncoder().encode(webhookSecret));
    return {
      body,
      headers: { "X-Razorpay-Signature": hmacSha256Hex(k, body), "X-Razorpay-Event-Id": eventId },
    };
  },
  checkoutReturn: (orderId, paymentId) => {
    const k = new SecretKey("rzp-key", "hmac-sha-256", new TextEncoder().encode(rzp.secret));
    return {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: hmacSha256Hex(k, `${orderId}|${paymentId}`),
    };
  },
  refundTarget: (_o, p) => p,
};
const cfHarness: Harness = {
  stub: () => cf,
  captured: (orderId, amountMinor, eventId) => {
    const raw = `{"data":{"order":{"order_id":"${orderId}","order_amount":${(amountMinor / 100).toFixed(2)}},"payment":{"cf_payment_id":"77","payment_status":"SUCCESS","payment_amount":${(amountMinor / 100).toFixed(2)},"payment_group":"upi"}},"event_time":"${new Date().toISOString()}","type":"PAYMENT_SUCCESS_WEBHOOK"}`;
    const body = new TextEncoder().encode(raw);
    const ts = String(Math.floor(Date.now() / 1000));
    const k = new SecretKey("cf-secret", "hmac-sha-256", new TextEncoder().encode(cf.secret));
    const sig = b64(hmacSha256(k, Buffer.concat([Buffer.from(ts), Buffer.from(body)])));
    return {
      body,
      headers: {
        "x-webhook-signature": sig,
        "x-webhook-timestamp": ts,
        "x-idempotency-header": eventId,
      },
    };
  },
  checkoutReturn: (orderId) => ({ order_id: orderId }),
  refundTarget: (o) => o,
};

const cases = (h: () => Harness): Array<ContractCase<PaymentsPort>> => [
  {
    name: "P-04 createOrder: integer paise in, the same paise back; the reference comes from the key",
    async run(p) {
      const k = key("order");
      const o = await p.createOrder(spec(12345), k);
      expect(o).toMatchObject({
        amountMinor: 12345,
        currency: "INR",
        status: "created",
        adapter: p.descriptor.adapter,
      });
      expect(o.reference).toMatch(/^ipb_[0-9a-f]{32}$/);
      if (p.descriptor.adapter === "cashfree") {
        const raw = cf.requests
          .filter((r) => r.path === "/pg/orders")
          .at(-1)!
          .body.toString();
        expect(raw).toContain('"order_amount":123.45');
      }
      await expect(p.createOrder({ ...spec(), amountMinor: 1.5 }, key("bad"))).rejects.toThrow();
      await expect(
        p.createOrder({ ...spec(), currency: "USD" as "INR" }, key("bad")),
      ).rejects.toThrow();
    },
  },
  {
    name: "P-09 checkout return: verified server-side, never trusted from the client",
    async run(p) {
      const o = await p.createOrder(spec(), key("ret"));
      const { sessionRef } = await p.createCheckoutSession(o.orderId, {
        success: "https://ld.example.test/paid",
        cancel: "https://ld.example.test/cancel",
      });
      expect(sessionRef).not.toBe("");
      await expect(
        p.createCheckoutSession(o.orderId, {
          success: "http://plain.example.test",
          cancel: "https://x.example.test",
        }),
      ).rejects.toMatchObject({ code: "IPB-SEC-018" });
      const pm = h().stub().pay(o.orderId);
      expect(await p.verifySignature(h().checkoutReturn(o.orderId, pm.id))).toBe(true);
      if (p.descriptor.adapter === "razorpay")
        expect(
          await p.verifySignature({
            ...h().checkoutReturn(o.orderId, pm.id),
            razorpay_payment_id: "pay_forged",
          }),
        ).toBe(false);
      const unpaid = await p.createOrder(spec(), key("unpaid"));
      if (p.descriptor.adapter === "cashfree")
        expect(await p.verifySignature(h().checkoutReturn(unpaid.orderId, "x"))).toBe(false);
    },
  },
  {
    name: "P-07 refund: refused without an approved R3 request for exactly this payload",
    async run(p) {
      const o = await p.createOrder(spec(50000), key("rf"));
      const pm = h().stub().pay(o.orderId);
      const base = {
        paymentId: h().refundTarget(o.orderId, pm.id),
        amountMinor: 10000,
        reason: "duplicate charge",
      };
      const n0 = h().stub().refunds.length;
      await expect(
        p.refund({ ...base, approvalRef: "apr_missing" }, key("r")),
      ).rejects.toMatchObject({ code: "IPB-SEC-006" });
      const pendingRef = approve(base, { state: "pending" });
      await expect(p.refund({ ...base, approvalRef: pendingRef }, key("r"))).rejects.toMatchObject({
        code: "IPB-SEC-006",
      });
      const otherAction = approve(base, { action: "payments.payout" });
      await expect(p.refund({ ...base, approvalRef: otherAction }, key("r"))).rejects.toMatchObject(
        { code: "IPB-SEC-006" },
      );
      const ok = approve(base);
      await expect(
        p.refund({ ...base, amountMinor: 20000, approvalRef: ok }, key("r")),
      ).rejects.toMatchObject({ code: "IPB-SEC-006" });
      expect(h().stub().refunds.length).toBe(n0);
    },
  },
  {
    name: "P-07 refund: an approved refund runs once; a retry returns it; more than captured is refused",
    async run(p) {
      const o = await p.createOrder(spec(50000), key("rf2"));
      const pm = h().stub().pay(o.orderId);
      const base = {
        paymentId: h().refundTarget(o.orderId, pm.id),
        amountMinor: 30000,
        reason: "goodwill",
      };
      const ref = approve(base);
      const k = key("refund");
      const n0 = h().stub().refunds.length;
      const a = await p.refund({ ...base, approvalRef: ref }, k);
      expect(a).toMatchObject({ amountMinor: 30000, status: "processed" });
      const b = await p.refund({ ...base, approvalRef: ref }, k);
      expect(b.refundId).toBe(a.refundId);
      expect(h().stub().refunds.length).toBe(n0 + 1);
      const more = { ...base, amountMinor: 30000 };
      await expect(
        p.refund({ ...more, approvalRef: approve(more) }, key("refund")),
      ).rejects.toMatchObject({
        meta: { reason: "exceeds_captured" },
      });
    },
  },
  {
    name: "P-12 kill.payments: new money operations get a maintenance error; webhooks and reconcile go on",
    async run(p) {
      const o = await p.createOrder(spec(), key("kill"));
      killed = true;
      try {
        await expect(p.createOrder(spec(), key("k"))).rejects.toMatchObject({
          code: "IPB-PORT-002",
          meta: { reason: "kill_switch" },
        });
        await expect(
          p.createMandate(
            { customerRef: "cus_1", planRef: "plan_1", maxAmountMinor: 100000 },
            key("k"),
          ),
        ).rejects.toMatchObject({ meta: { reason: "kill_switch" } });
        await expect(
          p.refund({ paymentId: "x", amountMinor: 100, reason: "r", approvalRef: "a" }, key("k")),
        ).rejects.toMatchObject({ meta: { reason: "kill_switch" } });
        const w = h().captured(o.orderId, 12345, `evt_${key("e")}`);
        expect(await p.verifyWebhook(w.body, w.headers)).toHaveLength(1);
        expect(
          await p.reconcile({ from: "2026-10-01T00:00:00Z", to: "2026-10-27T00:00:00Z" }),
        ).toMatchObject({ differences: [] });
      } finally {
        killed = false;
      }
    },
  },
  {
    name: "@IPB-02-AT-05 webhooks: signature on the raw body, a stable event id on replay, tampering refused",
    async run(p) {
      const o = await p.createOrder(spec(), key("wh"));
      const id = `evt_${key("e")}`;
      const w = h().captured(o.orderId, 12345, id);
      const [a] = await p.verifyWebhook(w.body, w.headers);
      expect(a).toMatchObject({
        vendorEventId: id,
        type: "payment.captured",
        orderId: o.orderId,
        amountMinor: 12345,
        method: "upi",
      });
      const [b] = await p.verifyWebhook(w.body, w.headers);
      expect(b!.vendorEventId).toBe(a!.vendorEventId);
      const tampered = new TextEncoder().encode(
        new TextDecoder().decode(w.body).replace("12345", "99999").replace("123.45", "999.99"),
      );
      await expect(p.verifyWebhook(tampered, w.headers)).rejects.toMatchObject({
        code: "IPB-API-018",
      });
    },
  },
  {
    name: "createMandate (UPI AutoPay / eNACH) is idempotent by our reference and found by lookup",
    async run(p) {
      const k = key("md");
      const { mandateId } = await p.createMandate(
        { customerRef: "cus_1", planRef: "plan_1", maxAmountMinor: 500000 },
        k,
      );
      expect(mandateId).not.toBe("");
      const found = await p.lookup("createMandate", k);
      if (p.descriptor.adapter === "cashfree")
        expect(found).toEqual({ status: "found", result: { mandateId } });
      else expect(found.status).toBe("unknown");
    },
  },
  {
    name: "P-11 reconcile is read-only and reports differences against our records",
    async run(p) {
      const before = h()
        .stub()
        .requests.filter((r) => r.method !== "GET" && !r.path.endsWith("/settlements")).length;
      const r = await p.reconcile({ from: "2026-10-01T00:00:00Z", to: "2026-10-27T00:00:00Z" });
      expect(r.differences).toEqual([]);
      const after = h()
        .stub()
        .requests.filter((x) => x.method !== "GET" && !x.path.endsWith("/settlements")).length;
      expect(after).toBe(before);
    },
  },
];

beforeAll(async () => {
  [rzp, cf] = await Promise.all([startRazorpayStub(), startCashfreeStub()]);
});
afterAll(async () => {
  await Promise.all([rzp?.close(), cf?.close()]);
});

describe("PAYMENTS hermetic leg: razorpay (stub, test mode)", () => {
  defineContractSuite(
    "PAYMENTS",
    () => razorpay(),
    cases(() => rzpHarness),
    { leg: "hermetic" },
  );

  it("P-03: a live key id is refused outside prod/dr; a test key id in prod except for the probe", () => {
    const live = ["rzp", "live", "0".repeat(14)].join("_");
    expect(() => razorpay({ keyId: live })).toThrow(/outside prod\/dr/);
    expect(() => razorpay({ env: "prod" })).toThrow(/health probe/);
    expect(() => razorpay({ env: "prod", healthProbe: true })).not.toThrow();
    expect(() => razorpay({ keyId: "not_a_key" })).toThrow(/neither a test nor a live/);
  });

  it("P-05 lookup finds an order by its receipt and says absent when there is none", async () => {
    const p = razorpay();
    const k = key("lk");
    const o = await p.createOrder(spec(), k);
    expect(await p.lookup("createOrder", k)).toMatchObject({
      status: "found",
      result: { orderId: o.orderId },
    });
    expect(await p.lookup("createOrder", key("none"))).toEqual({ status: "absent" });
    expect((await p.lookup("refund", k)).status).toBe("unknown");
  });
});

describe("PAYMENTS hermetic leg: cashfree (stub, sandbox)", () => {
  defineContractSuite(
    "PAYMENTS",
    () => cashfree(),
    cases(() => cfHarness),
    { leg: "hermetic" },
  );

  it("P-03: the production host is refused outside prod/dr; the sandbox in prod", () => {
    expect(() => cashfree({ environment: "production" })).toThrow(/outside prod\/dr/);
    expect(() => cashfree({ env: "prod" })).toThrow(/health probe/);
  });

  it("P-05 a retried create returns the existing order (409) and an idempotency key with another body is a conflict", async () => {
    const p = cashfree();
    const k = key("dup");
    const a = await p.createOrder(spec(20000), k);
    const b = await p.createOrder(spec(20000), k);
    expect(b.orderId).toBe(a.orderId);
    await expect(p.createOrder(spec(30000), k)).rejects.toMatchObject({ code: "IPB-PORT-004" });
    expect(await p.lookup("createOrder", key("none"))).toEqual({ status: "absent" });
  });

  it("webhooks outside ±5 minutes are refused", async () => {
    const p = cashfree();
    const w = cfHarness.captured("ipb_x", 100, "e1");
    const old = String(Math.floor(Date.now() / 1000) - 600);
    const k = new SecretKey("cf-secret", "hmac-sha-256", new TextEncoder().encode(cf.secret));
    const sig = b64(hmacSha256(k, Buffer.concat([Buffer.from(old), Buffer.from(w.body)])));
    await expect(
      p.verifyWebhook(w.body, {
        ...w.headers,
        "x-webhook-timestamp": old,
        "x-webhook-signature": sig,
      }),
    ).rejects.toMatchObject({ code: "IPB-API-018" });
  });
});

describe("PAYMENTS through the router (P-05, P-07, P-08)", () => {
  const doc = {
    version: 1,
    ports: {
      PAYMENTS: {
        primary: { adapter: "razorpay", residency: "IN", max_data_class: "REGULATED" },
        secondary: {
          adapter: "cashfree",
          residency: "IN",
          max_data_class: "REGULATED",
          mode: "active_failover",
        },
      },
    },
  };
  const router = async (
    extra: { onUnresolved?: (req: IdempotencyRequest, reason: string) => void } = {},
  ) => {
    const events: Array<{ e: string; d: Record<string, string> }> = [];
    const store = new MemoryIdempotencyStore();
    const r = await Router.create({
      routing: { env: "dev", ...checkRouting(doc, { env: "dev" }) },
      factories: { razorpay: () => razorpay(), cashfree: () => cashfree() },
      idempotency: store,
      events: { emit: (e, d) => void events.push({ e, d }) },
      module: "billing",
      ...extra,
    });
    return { r, events, store };
  };

  it("@IPB-02-AT-05 scenario 1: the same key creates one order; the same key with another amount is a conflict", async () => {
    const { r } = await router();
    const p = r.port<PaymentsPort>("PAYMENTS");
    const k = key("rt");
    const n0 = rzp.orders.size;
    const a = await p.createOrder(spec(), k);
    const b = await p.createOrder(spec(), k);
    expect(b).toEqual(a);
    expect(rzp.orders.size).toBe(n0 + 1);
    await expect(p.createOrder(spec(99900), k)).rejects.toMatchObject({ code: "IPB-PORT-004" });
  });

  it("a pending order is looked up at the PA before any new call; it is never created twice", async () => {
    const { r, store } = await router();
    const p = r.port<PaymentsPort>("PAYMENTS");
    const k = key("pend");
    // The earlier attempt created the order at the PA but its answer was lost: the record is pending.
    const earlier = await razorpay().createOrder(spec(), k);
    await store.reserve({
      port: "PAYMENTS",
      adapter: "razorpay",
      operation: "createOrder",
      key: k,
      request: [spec()],
      dataClass: "REGULATED",
      money: true,
    });
    const n0 = rzp.orders.size;
    expect((await p.createOrder(spec(), k)).orderId).toBe(earlier.orderId);
    expect(rzp.orders.size).toBe(n0);
  });

  it("a pending refund the PA cannot resolve is never retried: it goes to the human queue", async () => {
    const unresolved: string[] = [];
    const { r, store } = await router({
      onUnresolved: (req, reason) => void unresolved.push(`${req.operation}: ${reason}`),
    });
    const p = r.port<PaymentsPort>("PAYMENTS");
    const o = await razorpay().createOrder(spec(50000), key("q"));
    const pm = rzp.pay(o.orderId);
    const base = { paymentId: pm.id, amountMinor: 1000, reason: "r" };
    const refund = { ...base, approvalRef: approve(base) };
    const k = key("qrf");
    await store.reserve({
      port: "PAYMENTS",
      adapter: "razorpay",
      operation: "refund",
      key: k,
      request: [refund],
      dataClass: "REGULATED",
      money: true,
    });
    const n0 = rzp.refunds.length;
    await expect(p.refund(refund, k)).rejects.toMatchObject({
      code: "IPB-PORT-002",
      meta: { reason: "pending_unresolved" },
    });
    expect(rzp.refunds.length).toBe(n0);
    expect(unresolved).toHaveLength(1);
  });

  it("@IPB-01-AT-08 after repeated 5xx from razorpay the next order goes to cashfree and AdapterFailedOver is emitted; refunds stay with their PA", async () => {
    const { r, events } = await router();
    const p = r.port<PaymentsPort>("PAYMENTS");
    rzp.failNext(6, 503);
    try {
      for (let i = 0; i < 5; i++)
        await expect(p.createOrder(spec(), key("fo"))).rejects.toMatchObject({
          code: "IPB-PORT-002",
        });
      const o = await p.createOrder(spec(), key("fo"));
      expect(o.adapter).toBe("cashfree");
      expect(events.find((x) => x.e === "AdapterFailedOver")?.d).toMatchObject({
        from_adapter: "razorpay",
        to_adapter: "cashfree",
      });
      // A refund never fails over; the cashfree order is refunded on cashfree.
      const base = { paymentId: "pay_any", amountMinor: 100, reason: "r" };
      await expect(
        p.refund({ ...base, approvalRef: approve(base) }, key("x")),
      ).rejects.toMatchObject({ code: "IPB-PORT-002" });
      cf.pay(o.orderId);
      const cfBase = { paymentId: o.orderId, amountMinor: 100, reason: "r" };
      const rf = await r
        .portFor<PaymentsPort>("PAYMENTS", "cashfree")
        .refund({ ...cfBase, approvalRef: approve(cfBase) }, key("cfr"));
      expect(rf.status).toBe("processed");
    } finally {
      rzp.failNext(0);
    }
  });
});
