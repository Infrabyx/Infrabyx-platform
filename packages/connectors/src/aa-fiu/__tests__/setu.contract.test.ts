// AA_FIU contract legs for Setu (OWNER-QUESTIONS #97, R1-D-61). Hermetic: the Setu FIU stub, whose
// shapes are stub-shaped until the owner's sandbox exists; the adapter stays `unproven` and off.
// Then what only `setu-aa` promises: off until its flag, payloads in STORAGE by hash with only a
// masked account returned, a slow session answered PENDING, and an unknown consent refused.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, sha256Hex } from "@infrabyx/crypto";
import {
  accountAggregatorContractCases,
  contractProductConsentRef,
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

const make = (consents = new Map<string, SetuConsentRecord>(), approvalHosts?: string[]) => {
  return new SetuAccountAggregator({
    storage,
    consents: { get: async (k) => consents.get(k), set: async (k, v) => void consents.set(k, v) },
    ...(approvalHosts ? { approvalHosts } : {}),
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
    get fiuId() {
      return stub.fiuId;
    },
    reportFiu: async (_p, id, fiu) => stub.reportFiu(id, fiu),
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
    // The deprecated adapter method answers the link the consent now carries (PR-UDF-050).
    expect(c.approvalUrl).toContain(c.consentId);
    expect(await p.approvalUrl(c.consentId)).toBe(c.approvalUrl);
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

  it("refuses a consent for another FIU, or for none, and keeps nothing (PR-UDF-050)", async () => {
    const consents = new Map<string, SetuConsentRecord>();
    const p = make(consents);
    const before = stub.requests.length;
    await expect(p.requestConsent({ ...ask(), fiuId: "another-fiu" })).rejects.toMatchObject({
      code: "IPB-PORT-001",
      meta: { reason: "fiu_mismatch", definite: true },
    });
    expect(consents.size).toBe(0);
    // The FIU is not sent: Setu records the FIU behind the product instance.
    const created = stub.requests.slice(before).find((x) => x.path === "/v2/consents")!;
    expect(created.body.toString("utf8")).not.toContain("another-fiu");
    // A consent Setu reports with no FIU mismatches one asked for.
    const ours = await p.requestConsent({ ...ask(), fiuId: stub.fiuId });
    expect(ours.fiuId).toBe(stub.fiuId);
    expect(consents.get(ours.consentId)?.fiuId).toBe(stub.fiuId);
    stub.reportFiu(ours.consentId, undefined);
    await expect(p.consentStatus(ours.consentId)).rejects.toMatchObject({
      meta: { reason: "fiu_mismatch" },
    });
  });

  it("refuses an approval link off its hosts or not https, keeps nothing and never echoes it (PR-UDF-050)", async () => {
    for (const base of [
      "https://elsewhere.example/consents/webview/",
      "http://fiu-sandbox.setu.co/consents/webview/",
      "https://user:pw@fiu-sandbox.setu.co/consents/webview/",
    ]) {
      const consents = new Map<string, SetuConsentRecord>();
      stub.linkBase(base);
      try {
        const err = await make(consents)
          .requestConsent(ask())
          .then(
            () => undefined,
            (e: unknown) => e,
          );
        expect(err).toMatchObject({
          code: "IPB-PORT-001",
          meta: { reason: "approval_url_not_allowed", definite: true },
        });
        expect(`${(err as Error).message} ${JSON.stringify(err)}`).not.toContain("webview");
        expect(consents.size).toBe(0);
      } finally {
        stub.linkBase(undefined);
      }
    }
    // A host the product lists is accepted, exactly (no suffix match).
    stub.linkBase("https://consent.example.in/webview/");
    try {
      const ok = await make(undefined, ["consent.example.in"]).requestConsent(ask());
      expect(ok.approvalUrl?.startsWith("https://consent.example.in/webview/")).toBe(true);
      await expect(make(undefined, ["example.in"]).requestConsent(ask())).rejects.toMatchObject({
        meta: { reason: "approval_url_not_allowed" },
      });
    } finally {
      stub.linkBase(undefined);
    }
  });

  it("never sends a product's own consent artefact to Setu (PR-UDF-050)", async () => {
    const ref = contractProductConsentRef();
    const before = stub.requests.length;
    const c = await make().requestConsent({ ...ask(), consentRef: ref });
    expect(c.state).toBe("PENDING");
    for (const x of stub.requests.slice(before)) {
      expect(x.body.toString("utf8")).not.toContain(ref.id);
      expect(x.body.toString("utf8")).not.toContain(ref.kind);
    }
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
