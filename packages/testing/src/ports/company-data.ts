// COMPANY_DATA contract cases and an in-memory fake (IPB-01-15; LawDocsComply PR-LDC-02, R1-D-79).
// No adapter exists until the owner chooses a data source (OWNER-QUESTIONS #102); the first one
// runs `companyDataContractCases(itsSandboxFixtures)`. The fake lets products build against the
// port now: deterministic, fictional fixtures (no real company, person or lender), amounts in
// integer paise, and every result labelled with the register date it reflects.
import { expect } from "vitest";
import { PortError } from "@infrabyx/contracts/errors";
import {
  CIN,
  CinLookup,
  CompanyIdLookup,
  COMPANY_STATUSES,
  DIN,
  DIRECTOR_DESIGNATIONS,
  LLPIN,
  LlpinLookup,
  payloadClass,
  type AdapterDescriptor,
  type Charge,
  type ChargeList,
  type CompanyDataEvidence,
  type CompanyDataPort,
  type CompanyRecord,
  type Director,
  type DirectorList,
  type PortHealth,
} from "@infrabyx/contracts/ports";
import type { ContractCase } from "../contract.js";

// Word-bounded, so a PAN-shaped run inside a random ULID (e.g. a consent id) never matches.
const PAN_LIKE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Inputs a COMPANY_DATA adapter's contract run needs: identifiers its source knows. */
export interface CompanyDataFixtures {
  /** A company with at least one director and at least one charge. */
  company: { cin: string; name: string };
  /** An LLP with at least one designated partner. */
  llp: { llpin: string; name: string };
  /** A well-formed CIN the register does not know. */
  unknownCin: string;
}

export const COMPANY_DATA_FAKE_FIXTURES: CompanyDataFixtures = {
  company: { cin: "U62099KA2019PTC000001", name: "Fixture Analytics Private Limited" },
  llp: { llpin: "AAZ-0001", name: "Fixture Advisors LLP" },
  unknownCin: "U74999DL2020PTC999999",
};

export interface FakeCompanyEntity {
  record: Omit<CompanyRecord, keyof CompanyDataEvidence>;
  directors: Director[];
  charges: Charge[];
}

/** The fake register: one private company, one listed company and one LLP, all fictional. */
export const FAKE_COMPANY_REGISTER: readonly FakeCompanyEntity[] = [
  {
    record: {
      kind: "company",
      companyId: "U62099KA2019PTC000001",
      name: "Fixture Analytics Private Limited",
      status: "active",
      statusText: "Active",
      listed: false,
      companyClass: "Private",
      incorporatedOn: "2019-06-14",
      roc: "RoC-Bangalore",
      registeredOffice: "1 Fixture Road, Bengaluru, Karnataka 560001",
      authorisedCapitalPaise: 100_000_000,
      paidUpCapitalPaise: 10_000_000,
      contributionPaise: null,
      lastAgmOn: "2025-09-29",
      lastBalanceSheetOn: "2025-03-31",
    },
    directors: [
      {
        din: "00000001",
        name: "Asha Rao",
        designation: "managing_director",
        designationText: "Managing Director",
        appointedOn: "2019-06-14",
        ceasedOn: null,
      },
      {
        din: "00000002",
        name: "Ravi Iyer",
        designation: "director",
        designationText: "Director",
        appointedOn: "2019-06-14",
        ceasedOn: null,
      },
      {
        din: "00000003",
        name: "Meera Shah",
        designation: "additional_director",
        designationText: "Additional Director",
        appointedOn: "2021-01-04",
        ceasedOn: "2022-09-30",
      },
    ],
    charges: [
      {
        chargeId: "100000001",
        holder: "Fixture Lender Limited",
        amountPaise: 2_500_000_000,
        status: "open",
        createdOn: "2023-02-10",
        modifiedOn: "2024-05-20",
        satisfiedOn: null,
      },
      {
        chargeId: "100000002",
        holder: "Fixture Trustee Limited",
        amountPaise: 500_000_000,
        status: "satisfied",
        createdOn: "2020-08-01",
        modifiedOn: null,
        satisfiedOn: "2022-07-15",
      },
    ],
  },
  {
    record: {
      kind: "company",
      companyId: "L65910MH1995PLC000002",
      name: "Fixture Holdings Limited",
      status: "active",
      statusText: "Active",
      listed: true,
      companyClass: "Public",
      incorporatedOn: "1995-03-01",
      roc: "RoC-Mumbai",
      registeredOffice: "2 Fixture Lane, Mumbai, Maharashtra 400001",
      authorisedCapitalPaise: 50_000_000_000,
      paidUpCapitalPaise: 25_000_000_000,
      contributionPaise: null,
      lastAgmOn: "2025-08-28",
      lastBalanceSheetOn: "2025-03-31",
    },
    directors: [
      {
        din: "00000004",
        name: "Kabir Menon",
        designation: "independent_director",
        designationText: "Independent Director",
        appointedOn: "2018-04-01",
        ceasedOn: null,
      },
    ],
    charges: [],
  },
  {
    record: {
      kind: "llp",
      companyId: "AAZ-0001",
      name: "Fixture Advisors LLP",
      status: "active",
      statusText: "Active",
      listed: false,
      companyClass: null,
      incorporatedOn: "2017-11-20",
      roc: "RoC-Delhi",
      registeredOffice: "3 Fixture Marg, New Delhi, Delhi 110001",
      authorisedCapitalPaise: null,
      paidUpCapitalPaise: null,
      contributionPaise: 20_000_000,
      lastAgmOn: null,
      lastBalanceSheetOn: "2025-03-31",
    },
    directors: [
      {
        din: "00000005",
        name: "Nisha Kapoor",
        designation: "designated_partner",
        designationText: "Designated Partner",
        appointedOn: "2017-11-20",
        ceasedOn: null,
      },
      {
        din: "00000006",
        name: "Arjun Das",
        designation: "designated_partner",
        designationText: "Designated Partner",
        appointedOn: "2017-11-20",
        ceasedOn: null,
      },
    ],
    charges: [],
  },
];

const notFound = (companyId: string) =>
  new PortError("IPB-PORT-001", "COMPANY_DATA", {
    adapter: "fake-company-data",
    detail: "the register has no such company",
    meta: { reason: "not_found", definite: true, kind: LLPIN.test(companyId) ? "llp" : "company" },
  });

/**
 * In-memory register. `asOf` is the register date every result reflects; `stale: true` plays the
 * failover path that serves the cache when the source is down (results labelled `stale`).
 */
export class FakeCompanyData implements CompanyDataPort {
  readonly descriptor: AdapterDescriptor = {
    port: "COMPANY_DATA",
    adapter: "fake-company-data",
    residency: "IN",
    maxDataClass: "INTERNAL",
  };
  private readonly byId: Map<string, FakeCompanyEntity>;
  private readonly now: () => Date;
  private readonly asOf: string;
  stale: boolean;
  /** How many lookups reached the "source" (malformed identifiers never do). */
  calls = 0;
  private n = 0;
  constructor(
    o: {
      register?: readonly FakeCompanyEntity[];
      asOf?: string;
      stale?: boolean;
      now?: () => Date;
    } = {},
  ) {
    this.byId = new Map((o.register ?? FAKE_COMPANY_REGISTER).map((e) => [e.record.companyId, e]));
    this.now = o.now ?? (() => new Date());
    this.asOf = o.asOf ?? "2026-11-01";
    this.stale = o.stale ?? false;
  }

  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: this.now().toISOString() };
  }

  private ev(): CompanyDataEvidence {
    return {
      vendorRef: `fake-company-data-${++this.n}`,
      adapter: "fake-company-data",
      asOf: this.asOf,
      stale: this.stale,
      checkedAt: this.now().toISOString(),
    };
  }

  private find(companyId: string): FakeCompanyEntity | undefined {
    this.calls++;
    return this.byId.get(companyId);
  }

  async lookupCin(cin: string): Promise<CompanyRecord | null> {
    const { cin: id } = CinLookup.parse({ cin });
    const e = this.find(id);
    return e ? { ...structuredClone(e.record), ...this.ev() } : null;
  }

  async lookupLlpin(llpin: string): Promise<CompanyRecord | null> {
    const { llpin: id } = LlpinLookup.parse({ llpin });
    const e = this.find(id);
    return e ? { ...structuredClone(e.record), ...this.ev() } : null;
  }

  async getDirectors(companyId: string): Promise<DirectorList> {
    const { companyId: id } = CompanyIdLookup.parse({ companyId });
    const e = this.find(id);
    if (!e) throw notFound(id);
    return { ...this.ev(), companyId: id, directors: structuredClone(e.directors) };
  }

  async getCharges(companyId: string): Promise<ChargeList> {
    const { companyId: id } = CompanyIdLookup.parse({ companyId });
    const e = this.find(id);
    if (!e) throw notFound(id);
    return { ...this.ev(), companyId: id, charges: structuredClone(e.charges) };
  }
}

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
