// COMPANY_DATA contract cases and an in-memory fake (IPB-01-15; LawDocsComply PR-LDC-02, R1-D-79).
// No adapter exists until the owner chooses a data source (OWNER-QUESTIONS #102); the first one
// runs `companyDataContractCases(itsSandboxFixtures)`. The fake lets products build against the
// port now: deterministic, fictional fixtures (no real company, person or lender), amounts in
// integer paise, and every result labelled with the register date it reflects.
// COMPANY_DATA contract cases and an in-memory fake (IPB-01-15; LawDocsComply PR-LDC-02, R1-D-79).
// No adapter exists until the owner chooses a data source (OWNER-QUESTIONS #102); the first one
// runs `companyDataContractCases(itsSandboxFixtures)`. The fake lets products build against the
// port now: deterministic, fictional fixtures (no real company, person or lender), amounts in
// integer paise, and every result labelled with the register date it reflects.
import { expect } from "vitest";
import {
  CIN,
  CinLookup,
  CompanyIdLookup,
  COMPANY_STATUSES,
  DIN,
  DIRECTOR_DESIGNATIONS,
  LlpinLookup,
  payloadClass,
  type CompanyDataEvidence,
  type CompanyDataPort,
} from "@infrabyx/contracts/ports";
import type { ContractCase } from "../contract.js";
import { type CompanyDataFixtures } from "@infrabyx/fakes";
export {
  type CompanyDataFixtures,
  COMPANY_DATA_FAKE_FIXTURES,
  type FakeCompanyEntity,
  FAKE_COMPANY_REGISTER,
  FakeCompanyData,
} from "@infrabyx/fakes";

// Word-bounded, so a PAN-shaped run inside a random ULID (e.g. a consent id) never matches.
const PAN_LIKE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const evidenceOk = (r: CompanyDataEvidence) => {
  expect(r.vendorRef && r.adapter && r.checkedAt).toBeTruthy();
  expect(r.asOf).toMatch(DATE);
  expect(r.asOf <= r.checkedAt.slice(0, 10)).toBe(true);
  expect(typeof r.stale).toBe("boolean");
};

const paise = (v: number | null) => v === null || (Number.isSafeInteger(v) && v >= 0);

export function companyDataContractCases(
  fx: CompanyDataFixtures,
): Array<ContractCase<CompanyDataPort>> {
  return [
    {
      name: "the lookup requests are INTERNAL; the adapter stays IN",
      async run(p) {
        for (const s of [CinLookup, LlpinLookup, CompanyIdLookup])
          expect(payloadClass(s).bodyHighest).toBe("INTERNAL");
        expect(p.descriptor.residency).toBe("IN");
      },
    },
    {
      name: "a malformed CIN, LLPIN or company id is refused before the source is called",
      async run(p) {
        await expect(p.lookupCin("U12345")).rejects.toThrow();
        await expect(p.lookupCin(fx.llp.llpin)).rejects.toThrow();
        await expect(p.lookupCin(fx.company.cin.toLowerCase())).rejects.toThrow();
        await expect(p.lookupLlpin(fx.company.cin)).rejects.toThrow();
        await expect(p.lookupLlpin("AAZ1234")).rejects.toThrow();
        await expect(p.getDirectors("ABCDEFGHIJ")).rejects.toThrow();
        await expect(p.getCharges(`${fx.company.cin} `)).rejects.toThrow();
      },
    },
    {
      name: "a company by CIN: master data with capital in integer paise and the register date",
      async run(p) {
        const r = await p.lookupCin(fx.company.cin);
        expect(r).not.toBeNull();
        if (!r) return;
        evidenceOk(r);
        expect(r).toMatchObject({ kind: "company", companyId: fx.company.cin });
        expect(r.name).toBe(fx.company.name);
        expect(r.listed).toBe(fx.company.cin.startsWith("L"));
        expect(COMPANY_STATUSES).toContain(r.status);
        expect(r.statusText).toBeTruthy();
        expect(r.incorporatedOn).toMatch(DATE);
        expect(r.roc && r.registeredOffice).toBeTruthy();
        expect(paise(r.authorisedCapitalPaise) && paise(r.paidUpCapitalPaise)).toBe(true);
        expect(r.contributionPaise).toBeNull();
        if (r.authorisedCapitalPaise !== null && r.paidUpCapitalPaise !== null)
          expect(r.paidUpCapitalPaise).toBeLessThanOrEqual(r.authorisedCapitalPaise);
      },
    },
    {
      name: "an LLP by LLPIN: kind llp, never listed, contribution in integer paise",
      async run(p) {
        const r = await p.lookupLlpin(fx.llp.llpin);
        expect(r).not.toBeNull();
        if (!r) return;
        evidenceOk(r);
        expect(r).toMatchObject({ kind: "llp", companyId: fx.llp.llpin, listed: false });
        expect(r.name).toBe(fx.llp.name);
        expect(r.companyClass).toBeNull();
        expect(r.authorisedCapitalPaise).toBeNull();
        expect(paise(r.contributionPaise)).toBe(true);
      },
    },
    {
      name: "an unknown CIN is null from a lookup and not_found from directors and charges",
      async run(p) {
        expect(CIN.test(fx.unknownCin)).toBe(true);
        expect(await p.lookupCin(fx.unknownCin)).toBeNull();
        for (const call of [p.getDirectors(fx.unknownCin), p.getCharges(fx.unknownCin)])
          await expect(call).rejects.toMatchObject({
            code: "IPB-PORT-001",
            meta: { reason: "not_found" },
          });
      },
    },
    {
      name: "directors carry a DIN, a designation and their dates; no PAN appears",
      async run(p) {
        for (const id of [fx.company.cin, fx.llp.llpin]) {
          const r = await p.getDirectors(id);
          evidenceOk(r);
          expect(r.companyId).toBe(id);
          expect(r.directors.length).toBeGreaterThan(0);
          for (const d of r.directors) {
            expect(d.din).toMatch(DIN);
            expect(d.name).toBeTruthy();
            expect(DIRECTOR_DESIGNATIONS).toContain(d.designation);
            expect(d.designationText).toBeTruthy();
            expect(d.appointedOn).toMatch(DATE);
            if (d.ceasedOn !== null) {
              expect(d.ceasedOn).toMatch(DATE);
              expect(d.ceasedOn >= d.appointedOn).toBe(true);
            }
          }
          expect(JSON.stringify(r)).not.toMatch(PAN_LIKE);
        }
        const llp = await p.getDirectors(fx.llp.llpin);
        expect(llp.directors.some((d) => d.designation === "designated_partner")).toBe(true);
      },
    },
    {
      name: "charges carry the holder, the amount in integer paise, the status and its dates",
      async run(p) {
        const r = await p.getCharges(fx.company.cin);
        evidenceOk(r);
        expect(r.companyId).toBe(fx.company.cin);
        expect(r.charges.length).toBeGreaterThan(0);
        for (const c of r.charges) {
          expect(c.chargeId && c.holder).toBeTruthy();
          expect(Number.isSafeInteger(c.amountPaise) && c.amountPaise > 0).toBe(true);
          expect(["open", "satisfied"]).toContain(c.status);
          expect(c.createdOn).toMatch(DATE);
          expect(c.status === "satisfied").toBe(c.satisfiedOn !== null);
          for (const d of [c.modifiedOn, c.satisfiedOn])
            if (d !== null) expect(d >= c.createdOn).toBe(true);
        }
      },
    },
  ];
}
