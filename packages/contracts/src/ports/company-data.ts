// COMPANY_DATA port (IPB-01 §01.4.4.2; LawDocsComply PR-LDC-02, R1-plan M46, R1-D-79). Company
// master data, directors and charges from the Ministry of Corporate Affairs' public register, looked
// up by CIN or LLPIN. Interface, fake and contract cases only: no adapter is built until the owner
// chooses a data source (OWNER-QUESTIONS #102, R1-D-65); direct MCA21 scraping is forbidden by
// IPB-01 (terms of use). The data is public register data (IPB-01: PUBLIC/INTERNAL, `IN`
// preferred), but director names and DINs identify people, so results are never logged in full.
// Every result carries `asOf`, the date of the register data it reflects, so a stale cache served
// on failover is labelled (IPB-01). Amounts are integer paise. IPB-01's `getFilings`,
// `gstinLookup` and `watch` are added, optional, with the first adapter that provides them.
import { z } from "zod";
import type { Port, PortCall } from "./common.js";
import { classed } from "./payload-class.js";

const internal = <T extends z.ZodType>(s: T): T => classed(s, "INTERNAL");

/**
 * Corporate Identity Number: listing status (L or U), 5-digit industry code, 2-letter state code,
 * 4-digit year of incorporation, 3-letter ownership class and 6-digit registration number.
 */
export const CIN = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
/** LLP Identification Number, e.g. `AAA-1234` (`F…` for a foreign LLP). */
export const LLPIN = /^[A-Z]{3}-[0-9]{4}$/;
/** Director Identification Number (also the DPIN of an LLP's designated partner): 8 digits. */
export const DIN = /^[0-9]{8}$/;

export const CinLookup = z.object({ cin: internal(z.string().regex(CIN)) }).strict();
export const LlpinLookup = z.object({ llpin: internal(z.string().regex(LLPIN)) }).strict();
/** Directors and charges are read for a company (CIN) or an LLP (LLPIN). */
export const CompanyIdLookup = z
  .object({ companyId: internal(z.string().regex(new RegExp(`${CIN.source}|${LLPIN.source}`))) })
  .strict();

/** True for a well-formed CIN or LLPIN. */
export function isCompanyId(id: string): boolean {
  return CIN.test(id) || LLPIN.test(id);
}

export const COMPANY_KINDS = ["company", "llp"] as const;
export type CompanyKind = (typeof COMPANY_KINDS)[number];

/** The register's company status, normalised; `statusText` keeps the register's own words. */
export const COMPANY_STATUSES = [
  "active",
  "strike_off",
  "under_process_of_striking_off",
  "amalgamated",
  "under_liquidation",
  "liquidated",
  "dissolved",
  "dormant",
  "converted",
  "other",
] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

/** Director and partner designations, normalised; `designationText` keeps the register's words. */
export const DIRECTOR_DESIGNATIONS = [
  "director",
  "managing_director",
  "whole_time_director",
  "additional_director",
  "alternate_director",
  "nominee_director",
  "independent_director",
  "designated_partner",
  "partner",
  "other",
] as const;
export type DirectorDesignation = (typeof DIRECTOR_DESIGNATIONS)[number];

/** What every result carries for traceability (as `KycEvidence`), and the register date. */
export interface CompanyDataEvidence {
  vendorRef: string;
  adapter: string;
  /** Date (YYYY-MM-DD) of the register data the result reflects. */
  asOf: string;
  /** True when served from cache after the source failed (IPB-01 failover: stale with `as_of`). */
  stale: boolean;
  checkedAt: string;
}

export interface CompanyRecord extends CompanyDataEvidence {
  kind: CompanyKind;
  /** The CIN of a company, or the LLPIN of an LLP. */
  companyId: string;
  name: string;
  status: CompanyStatus;
  statusText: string;
  /** For a company: from the CIN's first letter. Always false for an LLP. */
  listed: boolean;
  /** Private, public, one-person, section 8 and so on, in the register's words; null for an LLP. */
  companyClass: string | null;
  incorporatedOn: string;
  /** The Registrar of Companies, e.g. `RoC-Mumbai`. */
  roc: string;
  registeredOffice: string;
  /** Companies: authorised and paid-up capital in integer paise; null for an LLP. */
  authorisedCapitalPaise: number | null;
  paidUpCapitalPaise: number | null;
  /** LLPs: the total obligation of contribution in integer paise; null for a company. */
  contributionPaise: number | null;
  /** Dates of the last annual general meeting and balance sheet on the register, when filed. */
  lastAgmOn: string | null;
  lastBalanceSheetOn: string | null;
}

export interface Director {
  din: string;
  name: string;
  designation: DirectorDesignation;
  designationText: string;
  appointedOn: string;
  /** Null while the director is in office. */
  ceasedOn: string | null;
}

export interface DirectorList extends CompanyDataEvidence {
  companyId: string;
  /** Current and past directors (or designated partners) the register lists. */
  directors: Director[];
}

export type ChargeStatus = "open" | "satisfied";

export interface Charge {
  /** The register's charge id. */
  chargeId: string;
  /** The charge holder (a lender or trustee), as the register names it. */
  holder: string;
  /** The amount secured, in integer paise. */
  amountPaise: number;
  status: ChargeStatus;
  createdOn: string;
  /** The latest modification, when the charge was modified. */
  modifiedOn: string | null;
  /** Set exactly when the status is `satisfied`. */
  satisfiedOn: string | null;
}

export interface ChargeList extends CompanyDataEvidence {
  companyId: string;
  charges: Charge[];
}

/**
 * COMPANY_DATA lookups. A malformed identifier is refused before any source is called; an
 * identifier the register does not know is `null` from a lookup and `IPB-PORT-001` with
 * `meta.reason: "not_found"` from `getDirectors` and `getCharges`.
 */
export interface CompanyDataPort extends Port {
  lookupCin(cin: string, call?: PortCall): Promise<CompanyRecord | null>;
  lookupLlpin(llpin: string, call?: PortCall): Promise<CompanyRecord | null>;
  /** `companyId` is a CIN or an LLPIN (an LLP's designated partners). */
  getDirectors(companyId: string, call?: PortCall): Promise<DirectorList>;
  getCharges(companyId: string, call?: PortCall): Promise<ChargeList>;
}
