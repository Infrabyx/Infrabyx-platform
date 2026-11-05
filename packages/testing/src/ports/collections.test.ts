// PR-FBX-34 (1) and (2) (R1-D-80): the DISBURSEMENT_RAIL collection contract and the PAYMENTS
// settlement-line contract run against the fakes, as every adapter will.
import { describe, expect, it } from "vitest";
import {
  NPCI_RETURN_CODES,
  RETURN_ATTRIBUTIONS,
  bounceChargeable,
  classifyReturnCode,
} from "@infrabyx/contracts/ports";
import { defineContractSuite } from "../contract.js";
import {
  DISBURSEMENT_RAIL_FAKE_FIXTURES,
  FakeDisbursementRail,
  FakeSettlements,
  disbursementRailContractCases,
  settlementLineContractCases,
} from "./collections.js";

defineContractSuite(
  "DISBURSEMENT_RAIL",
  () => new FakeDisbursementRail(),
  disbursementRailContractCases(DISBURSEMENT_RAIL_FAKE_FIXTURES),
);
describe("UPI AutoPay on the DISBURSEMENT_RAIL fake", () => {
  defineContractSuite(
    "DISBURSEMENT_RAIL",
    () => new FakeDisbursementRail(),
    disbursementRailContractCases({
      ...DISBURSEMENT_RAIL_FAKE_FIXTURES,
      channel: "UPI_AUTOPAY",
      mandateRef: "fakeumn0000000001@fakebank",
      codes: { rePresentable: "Z9", final: "Z9X", unknown: "U99" },
    }).filter((c) => !c.name.startsWith("reads the response file")),
  );
});

describe("PAYMENTS settlement lines on the fake (PR-FBX-34 (2))", () => {
  for (const c of settlementLineContractCases()) it(c.name, () => c.run(new FakeSettlements()));
  it("refuses a line whose net does not balance", () => {
    expect(
      () =>
        new FakeSettlements([
          {
            settlementId: "setl_bad",
            source: "gateway",
            utr: null,
            grossMinor: 100,
            feesMinor: 2,
            taxMinor: 0,
            netMinor: 99,
            settledOn: "2026-11-02",
          },
        ]),
    ).toThrow(/net is gross/);
  });
});

const ITEM = {
  itemRef: "due_1",
  mandateRef: "FAKE0000000000000001",
  amountMinor: 1_000_00,
  attempt: 1,
  purposeRef: "loan_1",
  idempotencyKey: "debit-key-0001",
  authorisation: {
    approvalRef: "apr_0001",
    initiatedBy: { principalId: "usr_1", principalType: "user" as const },
  },
};
const BATCH = { batchRef: "b1", channel: "NACH" as const, debitDate: "2026-11-10", items: [ITEM] };

describe("the NPCI return-code table", () => {
  it("classes only insufficient balance as re-presentable, and unknown codes as final", () => {
    expect(classifyReturnCode("NACH", "04")).toMatchObject({
      class: "re_presentable",
      codeKnown: true,
    });
    expect(classifyReturnCode("UPI_AUTOPAY", "Z9").class).toBe("re_presentable");
    for (const c of ["05", "99", "", "constructor", "__proto__"])
      expect(classifyReturnCode("NACH", c)).toMatchObject({ class: "final", codeKnown: false });
    const rePresentable = Object.entries(NPCI_RETURN_CODES).flatMap(([ch, t]) =>
      Object.entries(t)
        .filter(([, v]) => v.class === "re_presentable")
        .map(([k]) => `${ch}:${k}`),
    );
    expect(rePresentable).toEqual(["NACH:04", "UPI_AUTOPAY:Z9"]);
    expect(Object.isFrozen(NPCI_RETURN_CODES.NACH)).toBe(true);
  });
});

describe("the DISBURSEMENT_RAIL fake's response file", () => {
  it("refuses a file naming an item that was not presented, or another amount, and applies nothing", async () => {
    const r = new FakeDisbursementRail();
    const sent = await r.presentDebitBatch(BATCH);
    const good = JSON.parse(new TextDecoder().decode(r.respond(sent.batchId as string))) as {
      results: Array<{ presentationId: string; amountMinor: number }>;
    };
    const tamper = (f: (x: typeof good) => void) => {
      const c = structuredClone(good);
      f(c);
      return new TextEncoder().encode(JSON.stringify(c));
    };
    await expect(
      r.readPresentationResponse(tamper((c) => (c.results[0]!.presentationId = "prs_unknown"))),
    ).rejects.toMatchObject({ code: "IPB-PORT-001", meta: { reason: "unknown_presentation" } });
    await expect(
      r.readPresentationResponse(tamper((c) => (c.results[0]!.amountMinor += 1))),
    ).rejects.toMatchObject({ meta: { reason: "amount_mismatch" } });
    await expect(
      r.readPresentationResponse(new TextEncoder().encode("not json")),
    ).rejects.toMatchObject({ meta: { reason: "malformed" } });
    expect((await r.lookup("presentDebit", ITEM.idempotencyKey)).status).toBe("found");
    expect((await r.presentDebitBatch(BATCH)).items[0]?.state).toBe("submitted");
  });

  it("refuses a second file contradicting the first, and credits the statement once", async () => {
    const r = new FakeDisbursementRail({ statement: [] });
    const sent = await r.presentDebitBatch(BATCH);
    const paid = r.respond(sent.batchId as string);
    await r.readPresentationResponse(paid);
    await r.readPresentationResponse(paid);
    await expect(
      r.readPresentationResponse(r.respond(sent.batchId as string, { due_1: { code: "04" } })),
    ).rejects.toMatchObject({ meta: { reason: "conflicting_result" } });
    const lines = await r.statementLines({ from: "2026-11-10", to: "2026-11-10" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ direction: "credit", amountMinor: 1_000_00 });
    expect(r.filesSent).toBe(1);
  });
});

describe("PR-FBX-36 whose return it is (the owner's table, #119)", () => {
  it("attributes NACH 04, 01, 06 and UPI Z9 to the borrower; everything else, unknown codes too, is not", () => {
    for (const c of ["04", "01", "06"])
      expect(classifyReturnCode("NACH", c).attribution).toBe("BORROWER");
    expect(classifyReturnCode("UPI_AUTOPAY", "Z9")).toMatchObject({ attribution: "BORROWER" });
    for (const c of ["02", "03", "07", "08", "09"])
      expect(classifyReturnCode("NACH", c).attribution).toBe("NOT_BORROWER");
    expect(classifyReturnCode("NACH", "99")).toMatchObject({
      attribution: "NOT_BORROWER",
      codeKnown: false,
    });
    for (const ch of Object.values(NPCI_RETURN_CODES))
      for (const info of Object.values(ch)) expect(RETURN_ATTRIBUTIONS).toContain(info.attribution);
    expect(bounceChargeable(classifyReturnCode("NACH", "04"))).toBe(true);
    expect(bounceChargeable(classifyReturnCode("NACH", "07"))).toBe(false);
    expect(bounceChargeable(classifyReturnCode("NACH", "99"))).toBe(false);
    expect(bounceChargeable({ attribution: null })).toBe(false);
  });

  it("is a platform floor: a tenant list only shrinks the borrower's codes, never widens them", () => {
    const tenant = { borrowerCodes: ["04", "07", "99"] };
    expect(classifyReturnCode("NACH", "04", tenant).attribution).toBe("BORROWER");
    // Platform says borrower, tenant left it out: not the borrower's.
    expect(classifyReturnCode("NACH", "01", tenant).attribution).toBe("NOT_BORROWER");
    expect(classifyReturnCode("NACH", "06", tenant).attribution).toBe("NOT_BORROWER");
    // Tenant names it, platform does not: never widened.
    expect(classifyReturnCode("NACH", "07", tenant).attribution).toBe("NOT_BORROWER");
    expect(classifyReturnCode("NACH", "99", tenant).attribution).toBe("NOT_BORROWER");
    // An empty list means no code is the borrower's.
    expect(classifyReturnCode("NACH", "04", { borrowerCodes: [] }).attribution).toBe(
      "NOT_BORROWER",
    );
  });
});
