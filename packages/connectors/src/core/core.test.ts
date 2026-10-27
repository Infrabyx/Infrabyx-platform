import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkRouting } from "@infrabyx/contracts/routing";
import { PortError } from "@infrabyx/contracts/errors";
import type { KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import type { EmailMessage, Port, PortHealth } from "@infrabyx/contracts/ports";
import { CircuitBreaker } from "./breaker.js";
import { HealthRegistry } from "./health.js";
import { createEgress, hostAllowed } from "./http.js";
import { MemoryIdempotencyStore, runIdempotent, type IdempotencyRequest } from "./idempotency.js";
import { Router, type AdapterFactory, type RouterOptions, type RoutingEvent } from "./router.js";
import { acceptWebhook } from "./webhooks.js";

const up = (): PortHealth => ({
  status: "up",
  latency_ms: 1,
  checked_at: new Date().toISOString(),
});

/** A configurable fake adapter: records calls, can fail on demand. */
class Fake implements Port {
  calls: string[] = [];
  failNext = 0;
  constructor(
    readonly descriptor: Port["descriptor"],
    private readonly impl: Record<string, (...a: unknown[]) => unknown> = {},
    private readonly healthStatus: PortHealth["status"] = "up",
  ) {
    return new Proxy(this, {
      get: (t, p) => {
        if (p in t) return (t as unknown as Record<string | symbol, unknown>)[p];
        if (typeof p !== "string" || p === "then") return undefined;
        return async (...a: unknown[]) => {
          t.calls.push(p);
          if (t.failNext > 0) {
            t.failNext--;
            throw new PortError("IPB-PORT-002", descriptor.port, { adapter: descriptor.adapter });
          }
          return t.impl[p] ? t.impl[p](...a) : { ok: true, by: descriptor.adapter };
        };
      },
    });
  }
  async health(): Promise<PortHealth> {
    return { ...up(), status: this.healthStatus };
  }
}

const email: EmailMessage = {
  to: ["a@example.com"],
  template: "welcome",
  vars: {},
  brand: "infrabyx",
};

async function build(
  doc: unknown,
  adapters: Record<string, Fake>,
  extra: Partial<RouterOptions> = {},
) {
  const routing = { env: "dev", ...checkRouting(doc, { env: "dev" }) };
  const events: Array<{ e: RoutingEvent; d: Record<string, string> }> = [];
  const factories: Record<string, AdapterFactory> = Object.fromEntries(
    Object.entries(adapters).map(([k, v]) => [k, () => v]),
  );
  const router = await Router.create({
    routing,
    factories,
    events: { emit: (e, d) => void events.push({ e, d }) },
    module: "test",
    traceId: () => "trace-1",
    ...extra,
  });
  return { router, events };
}

describe("circuit breaker (IPB-01-18)", () => {
  it("opens after 5 consecutive failures, half-opens after 30 s, closes on a trial success", () => {
    let t = 0;
    const b = new CircuitBreaker({}, () => t);
    for (let i = 0; i < 4; i++) expect(b.onFailure()).toBeUndefined();
    expect(b.onFailure()).toBe("opened");
    expect(b.tryPass()).toBe(false);
    t += 30_000;
    expect(b.state).toBe("half_open");
    expect([b.tryPass(), b.tryPass(), b.tryPass(), b.tryPass()]).toEqual([true, true, true, false]);
    expect(b.onSuccess()).toBe("closed");
    expect(b.tryPass()).toBe(true);
  });

  it("opens on a 50 % error rate over the window once the sample is large enough", () => {
    let t = 0;
    const b = new CircuitBreaker({}, () => t);
    const seq = [true, false, true, false, true, false];
    const transitions = seq.map((ok) => {
      t += 1000;
      return ok ? b.onSuccess() : b.onFailure();
    });
    // 3 failures in 6 calls reaches 50 % with the sample at the 5-call minimum.
    expect(transitions).toEqual([undefined, undefined, undefined, undefined, undefined, "opened"]);
  });

  it("a failure during half-open reopens", () => {
    let t = 0;
    const b = new CircuitBreaker({ failure_threshold: 1 }, () => t);
    b.onFailure();
    t += 30_000;
    expect(b.tryPass()).toBe(true);
    expect(b.onFailure()).toBe("opened");
    expect(b.tryPass()).toBe(false);
  });
});

describe("router: data class and residency (IPB-01-16, PL2-D-03, IPB-DEV-05)", () => {
  it("@IPB-01-AT-06 refuses a REGULATED call to a GLOBAL adapter before any request, and emits the event", async () => {
    const llm = new Fake({
      port: "LLM",
      adapter: "anthropic-direct",
      residency: "GLOBAL",
      maxDataClass: "INTERNAL",
    });
    const { router, events } = await build(
      {
        version: 1,
        ports: {
          LLM: {
            primary: {
              adapter: "anthropic-direct",
              residency: "GLOBAL",
              max_data_class: "INTERNAL",
            },
          },
        },
      },
      { "anthropic-direct": llm },
    );
    const port = router.port<Port & { complete(r: unknown, c: unknown): Promise<unknown> }>("LLM");
    await expect(port.complete({ prompt: "x" }, { dataClass: "REGULATED" })).rejects.toMatchObject({
      code: "IPB-PORT-003",
    });
    expect(llm.calls).toEqual([]);
    expect(events).toEqual([
      {
        e: "ResidencyViolationBlocked",
        d: {
          port: "LLM",
          adapter: "anthropic-direct",
          data_class: "REGULATED",
          module: "test",
          trace_id: "trace-1",
        },
      },
    ]);
  });

  it("refuses a caller that states a class below the port default", async () => {
    const s3 = new Fake({
      port: "STORAGE",
      adapter: "s3",
      residency: "IN",
      maxDataClass: "SECRET",
    });
    const { router } = await build(
      {
        version: 1,
        ports: {
          STORAGE: { primary: { adapter: "s3", residency: "IN", max_data_class: "SECRET" } },
        },
      },
      { s3 },
    );
    const st = router.port<Port & { put(...a: unknown[]): Promise<unknown> }>("STORAGE");
    // STORAGE.put has no PortCall slot in the spec yet; a raise-only check runs on ports that declare one.
    await expect(st.put("k", new Uint8Array(), { bucketClass: "GENERAL" })).resolves.toMatchObject({
      ok: true,
    });
    const brevo = new Fake({
      port: "EMAIL",
      adapter: "brevo",
      residency: "GLOBAL",
      maxDataClass: "INTERNAL",
    });
    const { router: r2 } = await build(
      {
        version: 1,
        ports: {
          EMAIL: {
            primary: {
              adapter: "brevo",
              residency: "GLOBAL",
              max_data_class: "INTERNAL",
              dpa_ref: "vad_dpa",
            },
          },
        },
      },
      { brevo },
    );
    const em = r2.port<Port & { send(m: EmailMessage, c?: unknown): Promise<unknown> }>("EMAIL");
    await expect(em.send(email, { dataClass: "PUBLIC" })).rejects.toMatchObject({
      code: "IPB-PORT-003",
    });
    await expect(em.send(email, { dataClass: "CONFIDENTIAL" })).rejects.toMatchObject({
      code: "IPB-PORT-003",
    });
    await expect(em.send(email)).resolves.toMatchObject({ by: "brevo" });
  });

  it("a GLOBAL messaging adapter receives recipients only with a DPA reference", async () => {
    const meta = new Fake({
      port: "WHATSAPP",
      adapter: "meta-cloud",
      residency: "GLOBAL",
      maxDataClass: "INTERNAL",
    });
    const routing = {
      env: "dev",
      ...checkRouting(
        {
          version: 1,
          ports: {
            WHATSAPP: {
              primary: {
                adapter: "meta-cloud",
                residency: "GLOBAL",
                max_data_class: "INTERNAL",
                dpa_ref: "vad_x",
              },
            },
          },
        },
        { env: "dev" },
      ),
    };
    // The routing check already demands dpa_ref; simulate a file that lost it after loading.
    delete (routing.file.ports.WHATSAPP?.primary as { dpa_ref?: string }).dpa_ref;
    const router = await Router.create({ routing, factories: { "meta-cloud": () => meta } });
    const wa = router.port<Port & { sendSession(m: unknown): Promise<unknown> }>("WHATSAPP");
    await expect(wa.sendSession({ to: "+919800000000", text: "hi" })).rejects.toMatchObject({
      code: "IPB-PORT-003",
    });
    expect(meta.calls).toEqual([]);
  });

  it("refuses an adapter that claims less than its routing entry (IPB-PORT-005)", async () => {
    const weak = new Fake({ port: "KMS", adapter: "x", residency: "IN", maxDataClass: "INTERNAL" });
    await expect(
      build(
        {
          version: 1,
          ports: { KMS: { primary: { adapter: "x", residency: "IN", max_data_class: "SECRET" } } },
        },
        { x: weak },
      ),
    ).rejects.toMatchObject({ code: "IPB-PORT-005" });
  });

  it("an unsupported capability is IPB-PORT-001 with reason unsupported", async () => {
    const sm = new Fake({
      port: "SECRETS",
      adapter: "aws-sm",
      residency: "IN",
      maxDataClass: "SECRET",
      capabilities: { lease: "unsupported" },
    });
    const { router } = await build(
      {
        version: 1,
        ports: {
          SECRETS: { primary: { adapter: "aws-sm", residency: "IN", max_data_class: "SECRET" } },
        },
      },
      { "aws-sm": sm },
    );
    await expect(
      router
        .port<Port & { lease(p: string, t: number): Promise<unknown> }>("SECRETS")
        .lease("p", 60),
    ).rejects.toMatchObject({
      code: "IPB-PORT-001",
      meta: { reason: "unsupported" },
    });
  });
});

describe("router: failover (IPB-01-18)", () => {
  const pay = (adapter: string) =>
    new Fake({ port: "PAYMENTS", adapter, residency: "IN", maxDataClass: "REGULATED" });
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
  const spec = { amountMinor: 100, currency: "INR", customerRef: "cus_1" };

  it("@IPB-01-AT-08 after repeated 5xx the next order goes to the secondary and AdapterFailedOver is emitted", async () => {
    const razorpay = pay("razorpay");
    const cashfree = pay("cashfree");
    razorpay.failNext = 6;
    const { router, events } = await build(
      doc,
      { razorpay, cashfree },
      { idempotency: new MemoryIdempotencyStore() },
    );
    const p = router.port<Port & { createOrder(s: unknown, k: string): Promise<{ by: string }> }>(
      "PAYMENTS",
    );
    for (let i = 0; i < 5; i++)
      await expect(p.createOrder(spec, `k-${i}`)).rejects.toMatchObject({ code: "IPB-PORT-002" });
    const seventh = await p.createOrder(spec, "k-7");
    expect(seventh.by).toBe("cashfree");
    expect(events.find((x) => x.e === "AdapterFailedOver")?.d).toEqual({
      port: "PAYMENTS",
      from_adapter: "razorpay",
      to_adapter: "cashfree",
      reason: "circuit_open",
      data_class_max: "REGULATED",
    });
  });

  it("P-08: refunds and mandates never fail over; portFor pins a call to the PA that owns it", async () => {
    const razorpay = pay("razorpay");
    const cashfree = pay("cashfree");
    razorpay.failNext = 5;
    const { router } = await build(
      doc,
      { razorpay, cashfree },
      { idempotency: new MemoryIdempotencyStore() },
    );
    type P = Port & {
      createOrder(s: unknown, k: string): Promise<{ by: string }>;
      refund(s: unknown, k: string): Promise<{ by: string }>;
    };
    const p = router.port<P>("PAYMENTS");
    for (let i = 0; i < 5; i++)
      await expect(p.createOrder(spec, `o-${i}`)).rejects.toMatchObject({ code: "IPB-PORT-002" });
    // The primary's circuit is open: a new order moves, a refund does not.
    expect((await p.createOrder(spec, "o-next")).by).toBe("cashfree");
    const refund = { paymentId: "pay_1", amountMinor: 100, reason: "r", approvalRef: "apr_1" };
    await expect(p.refund(refund, "r-1")).rejects.toMatchObject({ code: "IPB-PORT-002" });
    // An order captured on cashfree is refunded on cashfree, even while razorpay is healthy again.
    expect((await router.portFor<P>("PAYMENTS", "cashfree").refund(refund, "r-2")).by).toBe(
      "cashfree",
    );
    expect(() => router.portFor("PAYMENTS", "payu")).toThrow(/not routed/);
  });

  it("a money operation without an idempotency key is refused (P-05)", async () => {
    const { router } = await build(
      doc,
      { razorpay: pay("razorpay"), cashfree: pay("cashfree") },
      { idempotency: new MemoryIdempotencyStore() },
    );
    await expect(
      router
        .port<Port & { createOrder(s: unknown, k?: string): Promise<unknown> }>("PAYMENTS")
        .createOrder(spec),
    ).rejects.toMatchObject({
      code: "IPB-PORT-001",
    });
  });

  it("read_only_failover serves reads from the replica and fails writes fast with IPB-STOR-002 (IPB-DEV-06)", async () => {
    const primary = new Fake({
      port: "STORAGE",
      adapter: "s3",
      residency: "IN",
      maxDataClass: "SECRET",
    });
    const replica = new Fake({
      port: "STORAGE",
      adapter: "minio",
      residency: "IN",
      maxDataClass: "SECRET",
    });
    primary.failNext = 5;
    const { router } = await build(
      {
        version: 1,
        ports: {
          STORAGE: {
            primary: { adapter: "s3", residency: "IN", max_data_class: "SECRET" },
            secondary: {
              adapter: "minio",
              residency: "IN",
              max_data_class: "SECRET",
              mode: "read_only_failover",
            },
          },
        },
      },
      { s3: primary, minio: replica },
    );
    const st = router.port<
      Port & { get(k: string): Promise<{ by: string }>; put(...a: unknown[]): Promise<unknown> }
    >("STORAGE");
    for (let i = 0; i < 5; i++) await expect(st.get("k")).rejects.toBeDefined();
    expect((await st.get("k")).by).toBe("minio");
    await expect(st.put("k", new Uint8Array(), {})).rejects.toMatchObject({ code: "IPB-STOR-002" });
    expect(replica.calls).toEqual(["get"]);
  });
});

describe("idempotency: pending first, vendor lookup, no blind money retries (plan §3.5, P-05, P-07)", () => {
  const req = (over: Partial<IdempotencyRequest> = {}): IdempotencyRequest => ({
    port: "PAYMENTS",
    adapter: "razorpay",
    operation: "refund",
    key: "ref-1",
    request: { paymentId: "pay_1", amountMinor: 100 },
    dataClass: "REGULATED",
    money: true,
    ...over,
  });

  it("returns the stored result for the same key and request; IPB-PORT-004 for a different request", async () => {
    const store = new MemoryIdempotencyStore();
    let n = 0;
    const call = async () => ({ id: `r${++n}` });
    expect(await runIdempotent({ store, req: req(), call })).toEqual({ id: "r1" });
    expect(await runIdempotent({ store, req: req(), call })).toEqual({ id: "r1" });
    expect(n).toBe(1);
    await expect(
      runIdempotent({
        store,
        req: req({ request: { paymentId: "pay_1", amountMinor: 200 } }),
        call,
      }),
    ).rejects.toMatchObject({
      code: "IPB-PORT-004",
    });
  });

  it("@IPB-02-AT-05 an unknown outcome stays pending; the retry looks it up before calling again", async () => {
    const store = new MemoryIdempotencyStore();
    const timeout = () => Promise.reject(new PortError("IPB-PORT-002", "PAYMENTS"));
    await expect(runIdempotent({ store, req: req(), call: timeout })).rejects.toMatchObject({
      code: "IPB-PORT-002",
    });
    let called = 0;
    const call = async () => ({ id: `r${++called}` });
    const found = await runIdempotent({
      store,
      req: req(),
      call,
      lookup: async () => ({ status: "found", result: { id: "rfnd_vendor" } }),
    });
    expect(found).toEqual({ id: "rfnd_vendor" });
    expect(called).toBe(0);
  });

  it("a pending refund the lookup cannot resolve is not re-sent and goes to a person", async () => {
    const store = new MemoryIdempotencyStore();
    await runIdempotent({
      store,
      req: req(),
      call: () => Promise.reject(new Error("socket hang up")),
    }).catch(() => undefined);
    const unresolved: string[] = [];
    let called = 0;
    await expect(
      runIdempotent({
        store,
        req: req(),
        call: async () => ++called,
        lookup: async () => ({ status: "unknown", reason: "vendor 503" }),
        onUnresolved: (_r, reason) => void unresolved.push(reason),
      }),
    ).rejects.toMatchObject({ code: "IPB-PORT-002", meta: { reason: "pending_unresolved" } });
    expect(called).toBe(0);
    expect(unresolved).toEqual(["vendor lookup inconclusive: vendor 503"]);
    // Without any lookup, a money operation is never re-sent either.
    await expect(
      runIdempotent({ store, req: req(), call: async () => ++called }),
    ).rejects.toMatchObject({ code: "IPB-PORT-002" });
    expect(called).toBe(0);
  });

  it("re-sends only when the vendor authoritatively reports the operation absent", async () => {
    const store = new MemoryIdempotencyStore();
    await runIdempotent({
      store,
      req: req(),
      call: () => Promise.reject(new Error("reset")),
    }).catch(() => undefined);
    expect(
      await runIdempotent({
        store,
        req: req(),
        call: async () => "sent",
        lookup: async () => ({ status: "absent" }),
      }),
    ).toBe("sent");
  });

  it("a definite vendor rejection frees the key for a retry", async () => {
    const store = new MemoryIdempotencyStore();
    const rejected = new PortError("IPB-PORT-001", "PAYMENTS", { meta: { definite: true } });
    await expect(
      runIdempotent({ store, req: req(), call: () => Promise.reject(rejected) }),
    ).rejects.toBe(rejected);
    expect(await runIdempotent({ store, req: req(), call: async () => "ok" })).toBe("ok");
  });

  it("non-money side effects without a lookup are retried (at least once)", async () => {
    const store = new MemoryIdempotencyStore();
    const r = req({ port: "EMAIL", operation: "send", money: false, dataClass: "INTERNAL" });
    await runIdempotent({ store, req: r, call: () => Promise.reject(new Error("reset")) }).catch(
      () => undefined,
    );
    expect(await runIdempotent({ store, req: r, call: async () => "sent" })).toBe("sent");
  });
});

describe("@IPB-01-AT-13 health aggregation", () => {
  const port = (p: string, status: PortHealth["status"]) =>
    new Fake(
      { port: p, adapter: p.toLowerCase(), residency: "IN", maxDataClass: "SECRET" },
      {},
      status,
    );
  it("a non-critical port down is degraded; a critical one is down; results are cached", async () => {
    let t = 0;
    const h = new HealthRegistry({ now: () => t });
    h.register("KMS", "primary", port("KMS", "up"));
    h.register("CACHE", "primary", port("CACHE", "down"));
    const body = await h.ready();
    expect(body.status).toBe("degraded");
    expect(body.checks.find((c) => c.port === "CACHE")).toMatchObject({
      status: "down",
      adapter: "cache",
    });
    const h2 = new HealthRegistry({ now: () => t });
    h2.register("KMS", "primary", port("KMS", "down"));
    expect((await h2.ready()).status).toBe("down");
    t += 5_000;
    expect(await h.ready()).toBe(body);
    t += 10_000;
    expect(await h.ready()).not.toBe(body);
  });
});

describe("egress client (IPB-02-43)", () => {
  let server: ReturnType<typeof createServer>;
  let base = "";
  let hits = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      hits++;
      if (req.url === "/flaky" && hits % 2 === 1) {
        res.writeHead(503, { "retry-after": "0" });
        return void res.end();
      }
      if (req.url === "/redirect") {
        res.writeHead(302, { location: "https://evil.example" });
        return void res.end();
      }
      if (req.url === "/big") return void res.end("x".repeat(2048));
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const egress = (extra = {}) =>
    createEgress({
      port: "EMAIL",
      adapter: "brevo",
      allow: ["api.brevo.com"],
      allowLoopbackHttp: true,
      backoffMs: 1,
      ...extra,
    });

  it("refuses hosts off the allow-list, plain HTTP and redirects with IPB-SEC-018", async () => {
    await expect(egress()("https://evil.example/x")).rejects.toMatchObject({ code: "IPB-SEC-018" });
    await expect(egress({ allowLoopbackHttp: false })(`${base}/ok`)).rejects.toMatchObject({
      code: "IPB-SEC-018",
    });
    await expect(egress()(`${base}/redirect`)).rejects.toMatchObject({ code: "IPB-SEC-018" });
    expect(hostAllowed("a.api.example.com", ["*.example.com"])).toBe(true);
    expect(hostAllowed("example.com", ["*.example.com"])).toBe(false);
  });

  it("retries a 503 for safe methods and caps the response size", async () => {
    expect((await egress()(`${base}/flaky`)).json()).toEqual({ ok: true });
    await expect(egress({ maxBytes: 100 })(`${base}/big`)).rejects.toMatchObject({
      code: "IPB-PORT-002",
    });
  });
});

describe("@IPB-02-AT-05 inbound webhooks: verify, de-duplicate, queue", () => {
  const ctx: KernelContext = {
    tenantId: "tnt_1",
    principal: { id: "svc_webhooks", type: "service", roles: [] },
  };
  const kernel: MutationKernel = {
    mutate: async (_c, fn) =>
      fn({
        ctx,
        query: async () => ({ rows: [], rowCount: 0 }),
        markAudited() {},
        audited: true,
      } as Tx),
    read: async (_c, fn) => fn({} as Tx),
  };
  it("answers 401 for an unverified payload and acknowledges duplicates without processing them", async () => {
    const seen = new Set<string>();
    const queued: string[] = [];
    const base = {
      kernel,
      ctx,
      audit: { record: async () => ({ id: "led_1" }) },
      schema: "billing",
      consumer: "razorpay",
      firstSeen: async (_tx: Tx, _s: string, _c: string, id: string) =>
        seen.has(id) ? false : (seen.add(id), true),
      enqueue: async (_tx: Tx, e: { vendorEventId: string }) => void queued.push(e.vendorEventId),
    };
    const refused: string[] = [];
    expect(
      await acceptWebhook({
        ...base,
        verify: () => Promise.reject(new PortError("IPB-PORT-003", "PAYMENTS")),
        onRefused: (r) => void refused.push(r),
      }),
    ).toEqual({ status: 401, accepted: 0, duplicates: 0 });
    expect(refused).toEqual(["IPB-PORT-003"]);
    const verify = async () => [{ vendorEventId: "evt_1" }];
    expect(await acceptWebhook({ ...base, verify })).toEqual({
      status: 200,
      accepted: 1,
      duplicates: 0,
    });
    expect(await acceptWebhook({ ...base, verify })).toEqual({
      status: 200,
      accepted: 0,
      duplicates: 1,
    });
    expect(queued).toEqual(["evt_1"]);
  });
});
