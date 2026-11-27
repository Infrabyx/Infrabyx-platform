// BUREAU contract legs for TransUnion CIBIL (OWNER-QUESTIONS #97, R1-D-61). Hermetic: the CIBIL
// stub, whose shapes are stub-shaped until the owner's sandbox exists; the adapter stays
// `unproven` and off. Then what only `cibil` promises: off until its flag, CIBIL only, a pending
// report completed by read-back, the raw report in STORAGE by hash, and the product's reference
// kept home.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, sha256Hex } from "@infrabyx/crypto";
import {
  contractConsentArtefact,
  bureauScannedWriteContractCases,
  creditBureauContractCases,
  FakeFileScan,
  CREDIT_BUREAU_FAKE_FIXTURES,
  malformedConsentArtefacts,
  defineContractSuite,
  MemoryStorage,
  startCibilStub,
  type CibilStub,
  type CreditBureauFixtures,
} from "@infrabyx/testing";
import {
  CibilBureau,
  cibilDpdBucket,
  cibilEmiPaise,
  cibilEventPullId,
  mapCibilReport,
  type CibilPullRecord,
} from "../cibil.js";

let stub: CibilStub;
const storage = new MemoryStorage();
// PR-FBX-57: every report is quarantined and scanned before it is ready.
const av = new FakeFileScan(storage);
let enabled = true;
const PREFIX = "tenant/tnt_bureau/los/";

beforeAll(async () => {
  stub = await startCibilStub();
});
afterAll(async () => stub?.close());

const make = () => {
  const pulls = new Map<string, CibilPullRecord>();
  return new CibilBureau({
    storage,
    scan: av,
    appEnv: "test",
    pulls: { get: async (k) => pulls.get(k), set: async (k, v) => void pulls.set(k, v) },
    enabled: () => enabled,
    memberId: () => stub.memberId,
    apiKey: () => stub.apiKey,
    baseUrl: stub.url,
    allowLoopbackHttp: true,
  });
};

const req = (pan: string, name: string, over: Record<string, unknown> = {}) => ({
  bureau: "cibil" as const,
  enquiry: "soft" as const,
  purpose: "new_credit" as const,
  consentRef: newId("cpr"),
  subject: { subjectRef: "cus:asha-0001", kind: "individual" as const, name, pan },
  reportPrefix: PREFIX,
  ...over,
});

describe("@IPB-01-15 BUREAU hermetic leg (CIBIL stub)", () => {
  const fixtures: CreditBureauFixtures = {
    ...CREDIT_BUREAU_FAKE_FIXTURES,
    reportPrefix: PREFIX,
    get known() {
      return stub.subjects.known;
    },
    get noHit() {
      return stub.subjects.noHit;
    },
  };
  defineContractSuite("BUREAU", make, creditBureauContractCases(fixtures), { leg: "hermetic" });
});

describe("@IPB-02-AT-16 BUREAU scanned writes (CIBIL stub; PR-FBX-57)", () => {
  defineContractSuite(
    "BUREAU",
    make,
    bureauScannedWriteContractCases({
      storage,
      prefix: PREFIX,
      vendorRemarks: (t) => stub.reportRemarks(t),
      scannerMode: (m) => (av.mode = m),
      pull: (p) => p.pull(req(stub.subjects.known.pan, stub.subjects.known.name)),
    }),
    { leg: "hermetic" },
  );

  it("without FILE_SCAN a completed pull refuses scan_required and stores nothing; a pending one still answers", async () => {
    const warnings: string[] = [];
    const pulls = new Map<string, CibilPullRecord>();
    const p = new CibilBureau({
      storage,
      appEnv: "prod",
      warn: (m) => warnings.push(m),
      pulls: { get: async (k) => pulls.get(k), set: async (k, v) => void pulls.set(k, v) },
      enabled: () => enabled,
      memberId: () => stub.memberId,
      apiKey: () => stub.apiKey,
      baseUrl: stub.url,
      allowLoopbackHttp: true,
    });
    // One start-up warning outside local and test, naming the adapter and the missing port.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("BUREAU adapter cibil");
    expect(warnings[0]).toContain("FILE_SCAN");
    const before = (await storage.list(PREFIX)).keys.length;
    await expect(
      p.pull(req(stub.subjects.known.pan, stub.subjects.known.name)),
    ).rejects.toMatchObject({ code: "IPB-SEC-015", meta: { reason: "scan_required" } });
    expect((await storage.list(PREFIX)).keys.length).toBe(before);
    expect((await p.pull(req(stub.subjects.pending.pan, stub.subjects.pending.name))).state).toBe(
      "pending",
    );
  });

  it("warns only outside local and test", () => {
    for (const appEnv of ["local", "test"] as const) {
      const warnings: string[] = [];
      new CibilBureau({
        storage,
        appEnv,
        warn: (m) => warnings.push(m),
        pulls: { get: async () => undefined, set: async () => undefined },
        enabled: () => false,
        memberId: () => "m",
        apiKey: () => "k",
      });
      expect(warnings).toEqual([]);
    }
    const warnings: string[] = [];
    new CibilBureau({
      storage,
      scan: av,
      appEnv: "prod",
      warn: (m) => warnings.push(m),
      pulls: { get: async () => undefined, set: async () => undefined },
      enabled: () => false,
      memberId: () => "m",
      apiKey: () => "k",
    });
    expect(warnings).toEqual([]);
  });
});

describe("R1-D-61 the CIBIL adapter", () => {
  it("is off until int.bureau.cibil.enabled: nothing reaches CIBIL and health is down", async () => {
    enabled = false;
    try {
      const p = make();
      const before = stub.requests.length;
      await expect(
        p.pull(req(stub.subjects.known.pan, stub.subjects.known.name)),
      ).rejects.toMatchObject({ code: "IPB-PORT-001", meta: { reason: "adapter_disabled" } });
      expect((await p.health()).status).toBe("down");
      expect(stub.requests.length).toBe(before);
    } finally {
      enabled = true;
    }
  });

  it("serves CIBIL only: a pull for another CIC is refused before anything leaves", async () => {
    const before = stub.requests.length;
    await expect(
      make().pull(req(stub.subjects.known.pan, stub.subjects.known.name, { bureau: "experian" })),
    ).rejects.toMatchObject({ code: "IPB-PORT-001", meta: { reason: "unsupported_bureau" } });
    expect(stub.requests.length).toBe(before);
  });

  it("completes a pending report by reading it back, and stores the raw report by its hash", async () => {
    const p = make();
    const r = await p.pull(req(stub.subjects.pending.pan, stub.subjects.pending.name));
    expect(r.state).toBe("pending");
    // An event naming the pull before CIBIL finishes changes nothing.
    const early = await p.handleWebhook(
      new TextEncoder().encode(JSON.stringify({ memberReference: r.pullId, status: "COMPLETED" })),
      {},
    );
    expect(early.state).toBe("pending");
    stub.complete(r.vendorRef);
    const done = await p.handleWebhook(
      new TextEncoder().encode(JSON.stringify({ memberReference: r.pullId })),
      {},
    );
    expect(done.state).toBe("ready");
    expect(done.formatVersion).toBe("cibil-cir-4.0");
    const stored = await storage.get(done.report!.storageKey);
    expect(sha256Hex(stored.body)).toBe(done.report!.sha256);
    expect(stored.meta.bucketClass).toBe("REGULATED");
    expect(done.report!.scan?.verdict).toBe("CLEAN");
    // The raw report keeps the CIC's identifiers; the result never carries them.
    expect(new TextDecoder().decode(stored.body)).toContain(stub.subjects.pending.pan);
    expect(JSON.stringify(done)).not.toContain(stub.subjects.pending.pan);
  });

  it("refuses an event naming an unknown pull", async () => {
    await expect(
      make().handleWebhook(
        new TextEncoder().encode(JSON.stringify({ memberReference: newId("bpl") })),
        {},
      ),
    ).rejects.toMatchObject({ code: "IPB-PORT-001", meta: { reason: "unknown_pull" } });
    expect(cibilEventPullId({ memberReference: "../../etc" })).toBeUndefined();
  });

  it("sends CIBIL the subject's identifiers but not the product's references", async () => {
    const before = stub.requests.length;
    const r = req(stub.subjects.known.pan, stub.subjects.known.name, {
      enquiry: "hard",
      amountPaise: 50_000_000,
    });
    await make().pull(r);
    const sent = stub.requests.slice(before).find((x) => x.method === "POST")!;
    const body = sent.json<Record<string, unknown>>();
    expect(body).toMatchObject({ enquiryType: "HARD", enquiryAmount: 500_000 });
    const text = sent.body.toString("utf8");
    expect(text).not.toContain(r.subject.subjectRef);
    expect(text).not.toContain(r.consentRef);
  });

  it("takes a product's own consent artefact, keeps it in the pull record and never sends it (PR-UDF-049)", async () => {
    const pulls = new Map<string, CibilPullRecord>();
    const p = new CibilBureau({
      storage,
      scan: av,
      pulls: { get: async (k) => pulls.get(k), set: async (k, v) => void pulls.set(k, v) },
      enabled: () => enabled,
      memberId: () => stub.memberId,
      apiKey: () => stub.apiKey,
      baseUrl: stub.url,
      allowLoopbackHttp: true,
    });
    const ref = contractConsentArtefact();
    const before = stub.requests.length;
    const asked = req(stub.subjects.known.pan, stub.subjects.known.name, { consentArtefact: ref });
    const r = await p.pull(asked);
    expect(r).toMatchObject({ consentRef: asked.consentRef, consentArtefact: ref });
    expect(pulls.get(r.pullId)).toMatchObject({
      consentRef: asked.consentRef,
      consentArtefact: ref,
    });
    expect(await p.status(r.pullId)).toMatchObject({
      consentRef: asked.consentRef,
      consentArtefact: ref,
    });
    const sent = stub.requests.slice(before).map((x) => x.body.toString("utf8"));
    for (const text of sent) {
      expect(text).not.toContain(ref.id);
      expect(text).not.toContain(ref.kind);
      expect(text).not.toContain(asked.consentRef);
    }
    // A pull without an artefact, and a record written before PR-UDF-049, read back as before.
    const plain = await p.pull(req(stub.subjects.known.pan, stub.subjects.known.name));
    expect(pulls.get(plain.pullId)).not.toHaveProperty("consentArtefact");
    expect(await p.status(plain.pullId)).not.toHaveProperty("consentArtefact");
  });

  it("refuses a malformed consent artefact before anything reaches CIBIL", async () => {
    const before = stub.requests.length;
    for (const consentArtefact of malformedConsentArtefacts())
      await expect(
        make().pull(req(stub.subjects.known.pan, stub.subjects.known.name, { consentArtefact })),
      ).rejects.toThrow();
    expect(stub.requests.length).toBe(before);
  });

  it("maps the report in integer paise and buckets days past due", () => {
    expect(["000", "015", "045", "075", "120", "200"].map((d) => cibilDpdBucket(+d))).toEqual([
      "0",
      "1-30",
      "31-60",
      "61-90",
      "91-180",
      "180+",
    ]);
    const s = mapCibilReport(
      {
        scores: [{ scoreName: "CIBILTUSC3", score: "000" }],
        accounts: [
          {
            memberType: "HFC",
            accountType: "home_loan",
            ownershipIndicator: "4",
            highCreditAmount: "2,500,000",
            currentBalance: 1999999.5,
            amountOverdue: "-5",
            paymentHistory: "030000095",
            accountStatus: "RESTRUCTURED",
            dateOpened: "01022020",
          },
        ],
        enquiries: [{ enquiryDate: "01012020" }],
      },
      new Date("2026-11-03T00:00:00Z"),
    );
    expect(s.score).toBeNull();
    expect(s.tradelines[0]).toMatchObject({
      lenderType: "hfc",
      ownership: "joint",
      sanctionedPaise: 250_000_000,
      currentPaise: 199_999_950,
      overduePaise: 0,
      currentDpd: "1-30",
      worstDpd12m: "91-180",
      status: "restructured",
      openedOn: "2020-02-01",
    });
    expect(s.enquiries).toEqual({ last30d: 0, last90d: 0, last365d: 0 });
    // No `emiAmount` on the account: the CIC reported none (PR-FBX-35).
    expect(s.tradelines[0]!.emiPaise).toBeNull();
  });

  it("maps the reported EMI to integer paise, and anything else to null, never zero (R1-D-84)", async () => {
    expect(cibilEmiPaise("15000")).toBe(1_500_000);
    expect(cibilEmiPaise("1,25,000")).toBe(12_500_000);
    expect(cibilEmiPaise(4321.5)).toBe(432_150);
    expect(cibilEmiPaise(" 999.05 ")).toBe(99_905);
    for (const none of [undefined, null, "", "  ", "0", 0, "-500", -1, "NA", "1e9", {}, true])
      expect(cibilEmiPaise(none)).toBeNull();
    // Through the adapter: the stub's card reports none, its personal loan an instalment.
    const r = await make().pull(req(stub.subjects.known.pan, stub.subjects.known.name));
    expect(r.summary?.tradelines.map((t) => [t.accountType, t.emiPaise])).toEqual([
      ["credit_card", null],
      ["personal_loan", 1_500_000],
    ]);
  });
});
