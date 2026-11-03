// AA_FIU contract legs for Setu (OWNER-QUESTIONS #97, R1-D-61). Hermetic: the Setu FIU stub, whose
// shapes are stub-shaped until the owner's sandbox exists; the adapter stays `unproven` and off.
// Then what only `setu-aa` promises: off until its flag, payloads in STORAGE by hash with only a
// masked account returned, a slow session answered PENDING, and an unknown consent refused.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, sha256Hex } from "@infrabyx/crypto";
import {
  accountAggregatorContractCases,
  defineContractSuite,
  MemoryStorage,
  startSetuAaStub,
  type AccountAggregatorFixtures,
  type SetuAaStub,
} from "@infrabyx/testing";
import { maskAccount, SetuAccountAggregator, setuFiType, type SetuConsentRecord } from "../setu.js";

let stub: SetuAaStub;
const storage = new MemoryStorage();
let enabled = true;
const PREFIX = "tenant/tnt_aa/los/";

beforeAll(async () => {
  stub = await startSetuAaStub();
});
afterAll(async () => stub?.close());

const make = () => {
  const consents = new Map<string, SetuConsentRecord>();
  return new SetuAccountAggregator({
    storage,
    consents: { get: async (k) => consents.get(k), set: async (k, v) => void consents.set(k, v) },
    enabled: () => enabled,
    clientId: () => stub.clientId,
    clientSecret: () => stub.clientSecret,
    productInstanceId: () => stub.productInstanceId,
    pollAttempts: 3,
    pollDelayMs: 0,
    baseUrl: stub.url,
    allowLoopbackHttp: true,
  });
};

const ask = () => {
  const now = Date.now();
  return {
    customerHandle: stub.customerHandle,
    subjectRef: "cus:asha-0001",
    consentRef: newId("cpr"),
    purposeCode: "101" as const,
    fiTypes: ["DEPOSIT" as const],
    fetchType: "ONETIME" as const,
    dataRange: {
      from: new Date(now - 180 * 86_400_000).toISOString(),
      to: new Date(now).toISOString(),
    },
    dataLife: { unit: "MONTH" as const, value: 3 },
    consentStart: new Date(now).toISOString(),
    consentExpiry: new Date(now + 30 * 86_400_000).toISOString(),
  };
};

describe("@IPB-01-15 AA_FIU hermetic leg (Setu stub)", () => {
  const fixtures: AccountAggregatorFixtures = {
    get customerHandle() {
      return stub.customerHandle;
    },
    consentRef: () => newId("cpr"),
    dataPrefix: PREFIX,
    approve: async (_p, id) => stub.approve(id),
  };
  defineContractSuite("AA_FIU", make, accountAggregatorContractCases(fixtures), {
    leg: "hermetic",
  });
});

describe("R1-D-61 the Setu AA adapter", () => {
  it("is off until int.aa_fiu.setu.enabled: nothing reaches Setu and health is down", async () => {
    enabled = false;
    try {
      const p = make();
      const before = stub.requests.length;
      await expect(p.requestConsent(ask())).rejects.toMatchObject({
        code: "IPB-PORT-001",
        meta: { reason: "adapter_disabled" },
      });
      expect((await p.health()).status).toBe("down");
      expect(stub.requests.length).toBe(before);
    } finally {
      enabled = true;
    }
  });

  it("stores each payload by its hash and returns only the masked account", async () => {
    const p = make();
    const a = ask();
    const c = await p.requestConsent(a);
    expect(await p.approvalUrl(c.consentId)).toContain(c.consentId);
    // The product's references stay home.
    const sent = stub.requests.findLast((x) => x.path === "/v2/consents")!.body.toString("utf8");
    expect(sent).not.toContain(a.subjectRef);
    expect(sent).not.toContain(a.consentRef);
    stub.approve(c.consentId);
    const r = await p.fetch({ consentId: c.consentId, range: c.dataRange, dataPrefix: PREFIX });
    expect(r.state).toBe("COMPLETED");
    expect(r.payloads).toHaveLength(1);
    const x = r.payloads[0]!;
    const stored = await storage.get(x.storageKey);
    expect(sha256Hex(stored.body)).toBe(x.sha256);
    expect(stored.meta.bucketClass).toBe("REGULATED");
    expect(x.maskedAccount).toMatch(/^X+[0-9]{4}$/);
  });

  it("answers PENDING when Setu has not finished the session within its polls", async () => {
    const p = make();
    const c = await p.requestConsent(ask());
    stub.approve(c.consentId);
    stub.pendingReads(5);
    try {
      const r = await p.fetch({ consentId: c.consentId, range: c.dataRange, dataPrefix: PREFIX });
      expect(r.state).toBe("PENDING");
      expect(r.payloads).toEqual([]);
    } finally {
      stub.pendingReads(0);
    }
  });

  it("refuses a notification for a consent it did not ask for", async () => {
    await expect(
      make().handleWebhook(
        new TextEncoder().encode(
          JSON.stringify({ type: "CONSENT_STATUS_UPDATE", consentId: "not-ours-0001" }),
        ),
        {},
      ),
    ).rejects.toMatchObject({ code: "IPB-PORT-001", meta: { reason: "unknown_consent" } });
  });

  it("maps ReBIT account types and masks any full account number", () => {
    expect(["deposit", "term-deposit", "mutualfunds", "gstr1_3b", "loan"].map(setuFiType)).toEqual([
      "DEPOSIT",
      "TERM_DEPOSIT",
      "MUTUAL_FUNDS",
      "GST_GSTR1_3B",
      undefined,
    ]);
    expect(maskAccount("XXXXXXXX4321")).toBe("XXXXXXXX4321");
    expect(maskAccount("123456789012")).toBe("XXXXXXXX9012");
    expect(maskAccount("AC-0012345678")).toBe("XXXXXXXXX5678");
    expect(maskAccount(undefined)).toBe("XXXX");
  });
});
