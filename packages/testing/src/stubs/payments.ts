// Razorpay and Cashfree PG stubs (PL2 plan §7, P-15), test mode only, from the vendors' API
// definitions (official SDKs) as summarised in PL2-D-66. They prove adapter logic only; the
// sandbox legs (Razorpay test mode, Cashfree sandbox) prove the vendors.
import { startStub, stubCredential, type StubReply, type VendorStub } from "./http.js";

export interface StubPayment {
  id: string;
  orderId: string;
  amount: number;
  refunded: number;
  status: "captured" | "failed" | "authorized";
  method: string;
}

export interface StubRefund {
  id: string;
  paymentId: string;
  orderId: string;
  amount: number;
  reference: string;
  status: string;
}

export interface PaymentsStub extends VendorStub {
  /** The key id (Razorpay) or app id (Cashfree) and the secret this stub accepts. */
  keyId: string;
  secret: string;
  readonly orders: Map<string, { id: string; amount: number; reference: string; status: string }>;
  readonly payments: Map<string, StubPayment>;
  readonly refunds: StubRefund[];
  readonly mandates: Map<string, { id: string; plan: string; reference: string }>;
  /** Mark an order paid by a captured payment, as the hosted checkout would. */
  pay(orderId: string, method?: string): StubPayment;
}

const baseState = () => ({
  orders: new Map<string, { id: string; amount: number; reference: string; status: string }>(),
  payments: new Map<string, StubPayment>(),
  refunds: [] as StubRefund[],
  mandates: new Map<string, { id: string; plan: string; reference: string }>(),
});

const rzpError = (status: number, description: string): StubReply => ({
  status,
  body: {
    error: { code: "BAD_REQUEST_ERROR", description, source: "NA", step: "NA", reason: "NA" },
  },
});

export async function startRazorpayStub(): Promise<PaymentsStub> {
  const keyId = `rzp_test_${stubCredential()
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 14)}`;
  const secret = stubCredential();
  const st = baseState();
  let seq = 0;
  const id = (p: string) => `${p}_STUB${(++seq).toString().padStart(10, "0")}`;
  const stub = await startStub((r): StubReply => {
    const expected = `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}`;
    if (r.headers.authorization !== expected) return rzpError(401, "Authentication failed");
    const p = r.path.replace(/^\/v1/, "");
    if (r.method === "POST" && p === "/orders") {
      const b = r.json<{ amount: number; currency: string; receipt?: string }>();
      if (!Number.isInteger(b.amount) || b.amount < 100) return rzpError(400, "amount invalid");
      if ((b.receipt ?? "").length > 40) return rzpError(400, "receipt too long");
      const o = {
        id: id("order"),
        amount: b.amount,
        reference: b.receipt ?? "",
        status: "created",
      };
      st.orders.set(o.id, o);
      return {
        status: 200,
        body: {
          id: o.id,
          entity: "order",
          amount: o.amount,
          currency: b.currency,
          receipt: o.reference,
          status: o.status,
        },
      };
    }
    if (r.method === "GET" && p === "/orders") {
      const receipt = r.query.get("receipt");
      const items = [...st.orders.values()]
        .filter((o) => !receipt || o.reference === receipt)
        .map((o) => ({
          id: o.id,
          amount: o.amount,
          currency: "INR",
          receipt: o.reference,
          status: o.status,
        }));
      return { status: 200, body: { entity: "collection", count: items.length, items } };
    }
    const order = /^\/orders\/([^/]+)$/.exec(p);
    if (r.method === "GET" && order) {
      const o = st.orders.get(order[1]!);
      return o
        ? {
            status: 200,
            body: {
              id: o.id,
              amount: o.amount,
              currency: "INR",
              receipt: o.reference,
              status: o.status,
            },
          }
        : rzpError(400, "The id provided does not exist");
    }
    const pay = /^\/payments\/([^/]+)(\/refunds|\/refund|\/capture)?$/.exec(p);
    if (pay) {
      const pm = st.payments.get(pay[1]!);
      if (!pm) return rzpError(400, "The id provided does not exist");
      const view = () => ({
        id: pm.id,
        entity: "payment",
        order_id: pm.orderId,
        amount: pm.amount,
        currency: "INR",
        amount_refunded: pm.refunded,
        status: pm.refunded >= pm.amount ? "refunded" : pm.status,
        method: pm.method,
      });
      if (r.method === "GET" && !pay[2]) return { status: 200, body: view() };
      if (r.method === "GET" && pay[2] === "/refunds") {
        const items = st.refunds
          .filter((x) => x.paymentId === pm.id)
          .map((x) => ({
            id: x.id,
            entity: "refund",
            payment_id: x.paymentId,
            amount: x.amount,
            receipt: x.reference,
            status: x.status,
          }));
        return { status: 200, body: { entity: "collection", count: items.length, items } };
      }
      if (r.method === "POST" && pay[2] === "/capture") return { status: 200, body: view() };
      if (r.method === "POST" && pay[2] === "/refund") {
        const b = r.json<{ amount: number; receipt?: string }>();
        if (b.amount > pm.amount - pm.refunded) return rzpError(400, "refund amount exceeds");
        pm.refunded += b.amount;
        const rf = {
          id: id("rfnd"),
          paymentId: pm.id,
          orderId: pm.orderId,
          amount: b.amount,
          reference: b.receipt ?? "",
          status: "processed",
        };
        st.refunds.push(rf);
        return {
          status: 200,
          body: {
            id: rf.id,
            entity: "refund",
            payment_id: pm.id,
            amount: rf.amount,
            receipt: rf.reference,
            status: rf.status,
          },
        };
      }
    }
    if (r.method === "POST" && p === "/subscriptions") {
      const b = r.json<{ plan_id: string; notes?: Record<string, string> }>();
      const m = { id: id("sub"), plan: b.plan_id, reference: b.notes?.ipb_ref ?? "" };
      st.mandates.set(m.id, m);
      return {
        status: 200,
        body: { id: m.id, entity: "subscription", plan_id: m.plan, status: "created" },
      };
    }
    if (r.method === "GET" && (p === "/payments" || p === "/refunds" || p === "/settlements")) {
      const items =
        p === "/payments"
          ? [...st.payments.values()].map((x) => ({
              id: x.id,
              order_id: x.orderId,
              amount: x.amount,
              status: x.status,
              method: x.method,
            }))
          : p === "/refunds"
            ? st.refunds.map((x) => ({
                id: x.id,
                payment_id: x.paymentId,
                amount: x.amount,
                status: x.status,
              }))
            : [];
      const skip = Number(r.query.get("skip") ?? 0);
      return { status: 200, body: { entity: "collection", items: items.slice(skip, skip + 100) } };
    }
    return rzpError(404, `no stub route ${r.method} ${r.path}`);
  });
  const s: PaymentsStub = Object.assign(stub, {
    keyId,
    secret,
    ...st,
    pay(orderId: string, method = "upi") {
      const o = st.orders.get(orderId);
      if (!o) throw new Error(`no order ${orderId}`);
      o.status = "paid";
      const pm: StubPayment = {
        id: id("pay"),
        orderId,
        amount: o.amount,
        refunded: 0,
        status: "captured",
        method,
      };
      st.payments.set(pm.id, pm);
      return pm;
    },
  });
  return s;
}

const cfError = (status: number, type: string, message: string): StubReply => ({
  status,
  body: { message, code: type, type },
});

/** Rupee decimal text in a JSON body to paise without floating point; refuses > 2 decimals. */
const paiseOf = (raw: string, field: string): number | null => {
  const m = new RegExp(`"${field}"\\s*:\\s*"?(\\d+)(?:\\.(\\d{1,2}))?"?[,}]`).exec(raw);
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0")) : null;
};
const rupees = (paise: number) =>
  `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;

export async function startCashfreeStub(): Promise<PaymentsStub> {
  const keyId = `TEST${stubCredential()
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 20)}`;
  const secret = stubCredential();
  const st = baseState();
  const replay = new Map<string, { body: string; reply: StubReply }>();
  let seq = 0;
  const view = (o: { id: string; amount: number; status: string }) =>
    `{"order_id":"${o.id}","order_amount":${rupees(o.amount)},"order_currency":"INR","order_status":"${o.status}","payment_session_id":"session_${o.id}"}`;
  const stub = await startStub((r): StubReply => {
    if (r.headers["x-client-id"] !== keyId || r.headers["x-client-secret"] !== secret)
      return cfError(401, "authentication_error", "authentication Failed");
    if (!r.headers["x-api-version"])
      return cfError(400, "invalid_request_error", "x-api-version missing");
    const raw = r.body.toString("utf8");
    const idem = r.headers["x-idempotency-key"];
    if (r.method === "POST" && idem) {
      const seen = replay.get(idem);
      if (seen && seen.body !== raw)
        return cfError(422, "idempotency_error", "idempotency key reused");
      if (seen) return seen.reply;
    }
    const remember = (reply: StubReply) => {
      if (r.method === "POST" && idem) replay.set(idem, { body: raw, reply });
      return reply;
    };
    const p = r.path.replace(/^\/pg/, "");
    if (r.method === "POST" && p === "/orders") {
      const b = r.json<{ order_id: string; customer_details?: { customer_phone?: string } }>();
      const amount = paiseOf(raw, "order_amount");
      if (amount === null || amount < 100)
        return cfError(400, "invalid_request_error", "order_amount invalid");
      if (!b.customer_details?.customer_phone)
        return cfError(400, "invalid_request_error", "customer_phone required");
      if (st.orders.has(b.order_id))
        return cfError(409, "invalid_request_error", "order already exists");
      const o = { id: b.order_id, amount, reference: b.order_id, status: "ACTIVE" };
      st.orders.set(o.id, o);
      return remember({ status: 200, body: JSON.parse(view(o)) as unknown, headers: {} });
    }
    const ord = /^\/orders\/([^/]+)(\/refunds|\/authorization)?$/.exec(p);
    if (ord) {
      const o = st.orders.get(ord[1]!);
      if (!o) return cfError(404, "invalid_request_error", "order not found");
      if (r.method === "GET" && !ord[2])
        return { status: 200, body: JSON.parse(view(o)) as unknown };
      const refundsOf = () => st.refunds.filter((x) => x.orderId === o.id);
      const rview = (x: StubRefund) => ({
        refund_id: x.reference,
        order_id: x.orderId,
        cf_payment_id: x.paymentId,
        refund_amount: Number(rupees(x.amount)),
        refund_status: x.status,
      });
      if (r.method === "GET" && ord[2] === "/refunds")
        return { status: 200, body: refundsOf().map(rview) };
      if (r.method === "POST" && ord[2] === "/refunds") {
        const b = r.json<{ refund_id: string }>();
        const amount = paiseOf(raw, "refund_amount");
        const done = refundsOf().reduce((s2, x) => s2 + x.amount, 0);
        if (amount === null || amount > o.amount - done)
          return cfError(400, "invalid_request_error", "refund amount exceeds");
        if (!/^[A-Za-z0-9]{3,40}$/.test(b.refund_id))
          return cfError(400, "invalid_request_error", "refund_id invalid");
        const pm = [...st.payments.values()].find((x) => x.orderId === o.id);
        const rf: StubRefund = {
          id: `cf_rf_${++seq}`,
          paymentId: pm?.id ?? "",
          orderId: o.id,
          amount,
          reference: b.refund_id,
          status: "SUCCESS",
        };
        st.refunds.push(rf);
        if (pm) pm.refunded += amount;
        return remember({ status: 200, body: rview(rf) });
      }
      if (r.method === "POST" && ord[2] === "/authorization")
        return { status: 200, body: { order_id: o.id } };
    }
    if (r.method === "POST" && p === "/subscriptions") {
      const b = r.json<{ subscription_id: string; plan_details?: { plan_id?: string } }>();
      st.mandates.set(b.subscription_id, {
        id: b.subscription_id,
        plan: b.plan_details?.plan_id ?? "",
        reference: b.subscription_id,
      });
      return remember({
        status: 200,
        body: { subscription_id: b.subscription_id, subscription_status: "INITIALIZED" },
      });
    }
    const sub = /^\/subscriptions\/([^/]+)$/.exec(p);
    if (r.method === "GET" && sub) {
      const m = st.mandates.get(sub[1]!);
      return m
        ? { status: 200, body: { subscription_id: m.id, subscription_status: "INITIALIZED" } }
        : cfError(404, "invalid_request_error", "subscription not found");
    }
    if (r.method === "POST" && p === "/settlements")
      return { status: 200, body: { cursor: null, limit: 1000, data: [] } };
    return cfError(404, "invalid_request_error", `no stub route ${r.method} ${r.path}`);
  });
  const s: PaymentsStub = Object.assign(stub, {
    keyId,
    secret,
    ...st,
    pay(orderId: string, method = "upi") {
      const o = st.orders.get(orderId);
      if (!o) throw new Error(`no order ${orderId}`);
      o.status = "PAID";
      const pm: StubPayment = {
        id: `cf_pay_${++seq}`,
        orderId,
        amount: o.amount,
        refunded: 0,
        status: "captured",
        method,
      };
      st.payments.set(pm.id, pm);
      return pm;
    },
  });
  return s;
}
