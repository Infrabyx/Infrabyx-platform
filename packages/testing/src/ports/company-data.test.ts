// PR-LDC-02 (R1-D-79): the COMPANY_DATA contract runs against the fake, as every adapter will.
import { describe, expect, it } from "vitest";
import { defineContractSuite } from "../contract.js";
import {
  COMPANY_DATA_FAKE_FIXTURES,
  FakeCompanyData,
  companyDataContractCases,
} from "./company-data.js";

defineContractSuite(
  "COMPANY_DATA",
  () => new FakeCompanyData(),
  companyDataContractCases(COMPANY_DATA_FAKE_FIXTURES),
);

describe("the COMPANY_DATA fake", () => {
  it("refuses a malformed identifier without reaching the source", async () => {
    const f = new FakeCompanyData();
    await expect(f.lookupCin("not-a-cin")).rejects.toThrow();
    await expect(f.getCharges("AAZ-01")).rejects.toThrow();
    expect(f.calls).toBe(0);
    await f.lookupCin(COMPANY_DATA_FAKE_FIXTURES.unknownCin);
    expect(f.calls).toBe(1);
  });

  it("labels a stale cache with the register date it reflects", async () => {
    const f = new FakeCompanyData({ asOf: "2026-10-15", stale: true });
    const r = await f.lookupCin("L65910MH1995PLC000002");
    expect(r).toMatchObject({ stale: true, asOf: "2026-10-15", listed: true });
    const charges = await f.getCharges("L65910MH1995PLC000002");
    expect(charges.charges).toEqual([]);
  });

  it("returns copies: a caller's change does not reach the register", async () => {
    const f = new FakeCompanyData();
    const a = await f.getDirectors(COMPANY_DATA_FAKE_FIXTURES.company.cin);
    a.directors[0]!.name = "changed";
    const b = await f.getDirectors(COMPANY_DATA_FAKE_FIXTURES.company.cin);
    expect(b.directors[0]!.name).toBe("Asha Rao");
  });
});
