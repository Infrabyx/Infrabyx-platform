// PAYMENTS mandate legs for `digio-mandate` (owner answer #100, R1-D-62). Hermetic: the Digio
// mandate stub, whose shapes are stub-shaped until the owner's account exists; the adapter stays
// `unproven` and off. The mandate contract cases, then the money controls only the adapter keeps:
// off until its flag, the kill switch, live credentials outside prod/dr, a key reused with another
// mandate, an unknown outcome recovered by our reference, the amount checked back exactly, and a
// callback that is only a trigger.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CONTRACT_AUTH,
  defineContractSuite,
  mandateContractCases,
  startDigioMandateStub,
  type ContractCase,
  type DigioMandateStub,
} from "@infrabyx/testing";
import {
  DigioMandates,
  digioAuthMode,
  mapDigioMandateState,
  MemoryMandateKeyStore,
  type DigioMandateOptions,
} from "../digio-mandate.js";

let stub: DigioMandateStub;
let enabled = true;
let killed = false;
const token = "t".repeat(48);
beforeAll(async () => {
  stub = await startDigioMandateStub();
});
afterAll(async () => stub?.close());

const make = (over: Partial<DigioMandateOptions> = {}) =>
  new DigioMandates({
    enabled: () => enabled,
    killed: () => killed,
    keys: new MemoryMandateKeyStore(),
    debtor: async () => ({
      name: "Asha Rao",
      identifier: "+919800000001",
      accountNumber: "000111222333",
      ifsc: "HDFC0000001",
      accountType: "savings",
    }),
    clientId: () => stub.clientId,
    clientSecret: () => stub.clientSecret,
    corporateConfigId: () => stub.corporateConfigId,
    webhookToken: () => token,
    env: "local",
    baseUrl: stub.url,
    allowLoopbackHttp: true,
    ...over,
  });

const reg = (over: Record<string, unknown> = {}) =>
  ({
    customerRef: "cus_1",
    channel: "UPI_AUTOPAY",
    maxAmountMinor: 10_000_00,
    frequency: "MONTHLY",
    startDate: "2026-12-01",
    debtorAccountRef: "bac_1",
    authorisation: CONTRACT_AUTH,
    ...over,
  }) as Parameters<DigioMandates["registerMandate"]>[0];

describe("@IPB-01-15 PAYMENTS mandate hermetic leg (Digio stub)", () => {
  defineContractSuite(
    "PAYMENTS",
    () => make(),
    mandateContractCases() as unknown as Array<ContractCase<DigioMandates>>,
    { leg: "hermetic" },
  );
});

describe("R1-D-62 the Digio mandate adapter", () => {
  it("is off until int.payments.digio_mandate.enabled, and paused by kill.payments: nothing reaches Digio", async () => {
    const before = stub.requests.length;
    enabled = false;
    try {
      await expect(make().registerMandate(reg(), "mandate-off-0001")).rejects.toMatchObject({
        code: "IPB-PORT-001",
        meta: { reason: "adapter_disabled" },
      });
      expect((await make().health()).status).toBe("down");
    } finally {
      enabled = true;
    }
    killed = true;
    try {
      await expect(make().registerMandate(reg(), "mandate-kill-0001")).rejects.toMatchObject({
        meta: { reason: "kill_switch" },
      });
    } finally {
      killed = false;
    }
    expect(stub.requests.length).toBe(before);
  });

  it("refuses a production credential outside prod/dr and physical NACH, before Digio", async () => {
    const before = stub.requests.length;
    await expect(
      make({ mode: "production" }).registerMandate(reg(), "mandate-live-0001"),
    ).rejects.toMatchObject({ code: "IPB-PORT-005" });
    await expect(
      make().registerMandate(
        reg({ channel: "PHYSICAL_NACH", formRef: "tenant/tnt_1/los/form.pdf" }),
        "mandate-phys-0001",
      ),
    ).rejects.toMatchObject({ meta: { reason: "unsupported" } });
    expect(stub.requests.length).toBe(before);
  });

  it("registers in integer paise sent as exact rupees, and becomes active with the bank's UMRN", async () => {
    const p = make();
    const m = await p.registerMandate(reg({ maxAmountMinor: 12_345_67 }), "mandate-amt-0001");
    expect(m).toMatchObject({ state: "pending_customer", umrn: null, maxAmountMinor: 12_345_67 });
    expect(m.authorisationUrl).toContain(m.mandateId);
    const sent = stub.requests.filter((r) => r.path.endsWith("/create_form")).at(-1)!;
    const body = sent.json<{ mandate_data: Record<string, unknown> }>();
    expect(body.mandate_data.maximum_amount).toBe("12345.67");
    expect(String(body.mandate_data.customer_ref_number)).toMatch(/^mdt[0-9a-f]{24}$/);
    expect(JSON.stringify(body)).not.toContain(CONTRACT_AUTH.approvalRef);
    stub.confirm(m.mandateId);
    const active = await p.mandateStatus(m.mandateId);
    expect(active.state).toBe("active");
    expect(active.umrn).toMatch(/^STUB/);
  });

  it("refuses a key reused with another mandate, and an amount Digio reports differently", async () => {
    const p = make();
    const m = await p.registerMandate(reg(), "mandate-reuse-0001");
    await expect(
      p.registerMandate(reg({ maxAmountMinor: 20_000_00 }), "mandate-reuse-0001"),
    ).rejects.toMatchObject({ code: "IPB-PORT-004" });
    stub.tamperAmount(m.mandateId, "10000.01");
    await expect(p.registerMandate(reg(), "mandate-reuse-0001")).rejects.toMatchObject({
      code: "IPB-PORT-002",
      meta: { reason: "amount_mismatch" },
    });
  });

  it("after an unknown outcome, finds the first mandate by our reference instead of creating another", async () => {
    let t = 0;
    const keys = new MemoryMandateKeyStore(() => t);
    const p = make({ keys, now: () => t });
    stub.failNext(1, 503); // POST is not retried by the egress client
    await expect(p.registerMandate(reg(), "mandate-lost-0001")).rejects.toMatchObject({
      code: "IPB-PORT-002",
    });
    // The key stays claimed; Digio has no mandate with our reference yet, so a quick retry waits.
    await expect(p.registerMandate(reg(), "mandate-lost-0001")).rejects.toMatchObject({
      meta: { reason: "in_flight" },
    });
    t += 180_000;
    const createdBefore = stub.created;
    const m = await p.registerMandate(reg(), "mandate-lost-0001");
    expect(stub.created).toBe(createdBefore + 1);
    // A further retry reads the same mandate back.
    expect((await p.registerMandate(reg(), "mandate-lost-0001")).mandateId).toBe(m.mandateId);
    expect(stub.created).toBe(createdBefore + 1);
  });

  it("takes a callback only with our secret, and returns the state read back from Digio", async () => {
    const p = make();
    const m = await p.registerMandate(reg(), "mandate-hook-0001");
    const body = new TextEncoder().encode(
      JSON.stringify({ payload: { mandate: { id: m.mandateId, state: "register_success" } } }),
    );
    await expect(p.handleWebhook(body, {}, { query: "ipb_token=wrong" })).rejects.toMatchObject({
      code: "IPB-API-018",
    });
    const back = await p.handleWebhook(body, {}, { query: `ipb_token=${token}` });
    expect(back.state).toBe("pending_customer");
    await expect(
      p.handleWebhook(new TextEncoder().encode("{}"), {}, { query: `ipb_token=${token}` }),
    ).rejects.toMatchObject({ code: "IPB-API-018" });
  });

  it("maps the stub-shaped states and channels conservatively", () => {
    expect(mapDigioMandateState("register_success")).toBe("active");
    expect(mapDigioMandateState("auth_fail")).toBe("rejected");
    expect(() => mapDigioMandateState("something_new")).toThrow();
    expect(digioAuthMode("ENACH_AADHAAR")).toEqual({ auth_mode: "esign" });
    expect(() => digioAuthMode("PHYSICAL_NACH")).toThrow();
  });
});
