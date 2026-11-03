// The PR-FBX-29 fakes against their contract cases (R1-D-46).
import { describe, expect, it } from "vitest";
import { defineContractSuite } from "../contract.js";
import {
  FakeDocgen,
  FakeEsign,
  FakeEstamp,
  FakeMandates,
  FakePayouts,
  FakePdf,
  CONTRACT_AUTH,
  docgenContractCases,
  esignFakeCases,
  estampContractCases,
  mandateContractCases,
  payoutsContractCases,
  pdfContractCases,
} from "./documents-money.js";

defineContractSuite("ESTAMP", () => new FakeEstamp(), estampContractCases());
defineContractSuite("PAYOUTS", () => new FakePayouts(), payoutsContractCases());
defineContractSuite("DOCGEN", () => new FakeDocgen(), docgenContractCases());
defineContractSuite("PDF", () => new FakePdf(), pdfContractCases());

describe("the PAYMENTS mandate lifecycle fake (PR-FBX-29)", () => {
  for (const c of mandateContractCases()) it(c.name, () => c.run(new FakeMandates()));
  it("becomes active with a UMRN once the bank registers it", async () => {
    const m = new FakeMandates();
    const r = await m.registerMandate(
      {
        customerRef: "cus_1",
        channel: "UPI_AUTOPAY",
        maxAmountMinor: 10_000_00,
        frequency: "MONTHLY",
        startDate: "2026-12-01",
        debtorAccountRef: "bac_1",
        authorisation: CONTRACT_AUTH,
      },
      "mandate-key-0001",
    );
    expect(r.authorisationUrl).toBeTruthy();
    expect(m.confirm(r.mandateId).umrn).toMatch(/^FAKE/);
    expect((await m.mandateStatus(r.mandateId)).state).toBe("active");
  });
});

describe("the ESIGN fake (PR-FBX-29)", () => {
  for (const c of esignFakeCases()) it(c.name, () => c.run(new FakeEsign()));
});

describe("payouts and DDE settle only through the bank or the utility", () => {
  it("settles with a UTR, fails a closed account and returns the money", async () => {
    const p = new FakePayouts({ balanceMinor: 10_000, closedAccounts: ["000999999999"] });
    const ok = await p.createBeneficiary({
      beneficiaryRef: "c1",
      name: "A",
      ifsc: "HDFC0000001",
      account: "000123456789",
    });
    const bad = await p.createBeneficiary({
      beneficiaryRef: "c2",
      name: "B",
      ifsc: "HDFC0000001",
      account: "000999999999",
    });
    const spec = { mode: "IMPS" as const, purposeRef: "ln_1", authorisation: CONTRACT_AUTH };
    const a = await p.payout(
      { ...spec, beneficiaryId: ok.beneficiaryId, amountMinor: 4_000 },
      "payout-key-0001",
    );
    const b = await p.payout(
      { ...spec, beneficiaryId: bad.beneficiaryId, amountMinor: 4_000 },
      "payout-key-0002",
    );
    expect(a.state).toBe("accepted");
    expect(p.settle(a.payoutId)).toMatchObject({ state: "settled" });
    expect((await p.getStatus(a.payoutId)).utr).toBeTruthy();
    expect(p.settle(b.payoutId)).toMatchObject({
      state: "failed",
      failureReason: "account closed",
    });
    expect((await p.balance()).availableMinor).toBe(6_000);
    await expect(
      p.payout({ ...spec, beneficiaryId: ok.beneficiaryId, amountMinor: 9_000 }, "payout-key-0003"),
    ).rejects.toMatchObject({ code: "IPB-PORT-002" });
  });

  it("executes a DDE once every executant signs, then serves the executed document", async () => {
    const e = new FakeEstamp();
    const party = (r: string) => ({ partyRef: r, name: r });
    const c = await e.purchase(
      {
        state: "MH",
        instrument: "loan_agreement",
        dutyMinor: 50_000,
        considerationMinor: 50_000_000,
        firstParty: party("p1"),
        secondParty: party("p2"),
        purchaser: party("p1"),
        outputPrefix: "tenant/tnt_a/dms",
        authorisation: CONTRACT_AUTH,
      },
      "estamp-key-0001",
    );
    const d = await e.ddeRegister(
      {
        document: c.file!,
        certificateId: c.certificateId,
        executants: [party("p1"), party("p2")],
        outputPrefix: "tenant/tnt_a/dms",
      },
      "dde-key-0001",
    );
    await expect(e.ddeDownloadExecuted(d.ddeId)).rejects.toThrow();
    e.execute(d.ddeId, "p1");
    e.execute(d.ddeId, "p2");
    expect((await e.ddeStatus(d.ddeId)).state).toBe("executed");
    expect((await e.ddeDownloadExecuted(d.ddeId)).sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await e.covers("WB", "loan_agreement")).toBe(false);
  });
});
