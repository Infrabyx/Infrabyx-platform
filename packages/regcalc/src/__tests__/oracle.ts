// The oracle harness (R1-regcalc plan §2): the owner's worked examples in docs/regulatory-models,
// recalculated in Excel so every formula cell holds its stored result, are the oracles. A test
// opens one workbook, checks its bytes against the filed SHA256SUMS first (R1-D-297: a changed
// stored result fails here before it can change an oracle), and asserts the code's figure for each
// output cell: money to the paisa, rates to 1e-10, text and flags exactly. `uncovered()` lists the
// formula cells no assertion reached, so "every output cell" is checked, not claimed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { sha256Hex } from "@infrabyx/crypto";
import { readXlsx, readZip, type XlsxCellValue } from "@infrabyx/export";
import { D, type Dec } from "../decimal.js";

export const MODELS_ROOT = fileURLToPath(
  new URL("../../../../docs/regulatory-models/", import.meta.url),
);

/** The filed hash of `rel` (a path under docs/regulatory-models), or a thrown error. */
export function filedHash(rel: string): string {
  const sums = readFileSync(`${MODELS_ROOT}SHA256SUMS`, "utf8");
  for (const line of sums.split("\n")) {
    const m = /^([0-9a-f]{64}) {2}\.\/(.+)$/.exec(line);
    if (m && m[2] === rel) return m[1]!;
  }
  throw new Error(`${rel} is not in docs/regulatory-models/SHA256SUMS`);
}

const xmlText = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** Each sheet's cells that hold a formula, read from the workbook's XML. */
export function formulaCells(bytes: Uint8Array): Map<string, string[]> {
  const z = readZip(bytes);
  const text = (p: string) => {
    const b = z.get(p);
    if (!b) throw new Error(`workbook part ${p} missing`);
    return b.toString("utf8");
  };
  const rels = new Map<string, string>();
  for (const m of text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) rels.set(id, target.replace(/^\/?(xl\/)?/, "xl/"));
  }
  const out = new Map<string, string[]>();
  for (const m of text("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)) {
    const name = xmlText(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? "");
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1] ?? "";
    const xml = text(rels.get(rid) ?? "");
    const cells: string[] = [];
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+[0-9]+)"/.exec(c[1] ?? "")?.[1];
      if (ref && c[2] && /<f[\s/>]/.test(c[2])) cells.push(ref);
    }
    out.set(name, cells);
  }
  return out;
}

const colIndex = (letters: string) =>
  [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

/** `B13` → `[12, 1]` (zero-based row, column). */
export function a1(ref: string): [number, number] {
  const m = /^([A-Z]+)([0-9]+)$/.exec(ref);
  if (!m) throw new Error(`not an A1 reference: ${ref}`);
  return [Number(m[2]) - 1, colIndex(m[1]!)];
}

const MONEY_TOLERANCE = new D("0.005");
const RATE_TOLERANCE = new D("1e-10");

export class Oracle {
  readonly sheets: Map<string, XlsxCellValue[][]>;
  readonly formulas: Map<string, string[]>;
  private readonly covered = new Set<string>();

  constructor(
    readonly rel: string,
    bytes: Uint8Array,
  ) {
    this.sheets = new Map(readXlsx(bytes).map((s) => [s.name, s.rows]));
    this.formulas = formulaCells(bytes);
  }

  /** The stored value of `sheet!ref` (an input or a formula's stored result). */
  value(sheet: string, ref: string): XlsxCellValue {
    const rows = this.sheets.get(sheet);
    if (!rows) throw new Error(`${this.rel}: no sheet ${sheet}`);
    const [r, c] = a1(ref);
    return rows[r]?.[c] ?? null;
  }

  /** The stored value as a Decimal (an input cell typed as text or number). */
  num(sheet: string, ref: string): Dec {
    const v = this.value(sheet, ref);
    if (v === null || v === "") return new D(0);
    if (typeof v !== "number" && typeof v !== "string")
      throw new Error(`${sheet}!${ref} is not a number`);
    return new D(typeof v === "number" ? v.toString() : v.trim());
  }

  private mark(sheet: string, ref: string) {
    this.covered.add(`${sheet}!${ref}`);
  }

  private close(sheet: string, ref: string, actual: Dec | string, tol: Dec) {
    this.mark(sheet, ref);
    const want = this.num(sheet, ref);
    const got = typeof actual === "string" ? new D(actual) : actual;
    expect(
      got.minus(want).abs().lte(tol),
      `${this.rel} ${sheet}!${ref}: got ${got.toString()}, the model has ${want.toString()}`,
    ).toBe(true);
  }

  /** A money cell, to the paisa. */
  money(sheet: string, ref: string, actual: Dec | string): void {
    this.close(sheet, ref, actual, MONEY_TOLERANCE);
  }

  /** A rate or ratio cell, to 1e-10. */
  rate(sheet: string, ref: string, actual: Dec | string): void {
    this.close(sheet, ref, actual, RATE_TOLERANCE);
  }

  /** A text, flag or date cell, exactly (a date as `YYYY-MM-DD`). */
  exact(sheet: string, ref: string, actual: string | number | boolean): void {
    this.mark(sheet, ref);
    let want = this.value(sheet, ref);
    if (typeof want === "string" && /^\d{4}-\d{2}-\d{2}T/.test(want)) want = want.slice(0, 10);
    expect(want, `${this.rel} ${sheet}!${ref}`).toBe(actual);
  }

  /** A formula cell the model leaves empty (a schedule row past the term). */
  blank(sheet: string, ref: string): void {
    this.mark(sheet, ref);
    const v = this.value(sheet, ref);
    expect(v === null || v === "", `${this.rel} ${sheet}!${ref} is ${String(v)}`).toBe(true);
  }

  /** The formula cells no assertion has reached (in `sheets`, or every sheet). */
  uncovered(sheets?: readonly string[]): string[] {
    const out: string[] = [];
    for (const [s, refs] of this.formulas)
      if (!sheets || sheets.includes(s))
        for (const r of refs) if (!this.covered.has(`${s}!${r}`)) out.push(`${s}!${r}`);
    return out;
  }
}

/** Opens `rel` (or `bytes` given for it) after checking it against the filed SHA256SUMS. */
export function openOracle(
  rel: string,
  bytes: Uint8Array = new Uint8Array(readFileSync(`${MODELS_ROOT}${rel}`)),
): Oracle {
  const want = filedHash(rel);
  const got = sha256Hex(bytes);
  if (got !== want)
    throw new Error(`${rel}: SHA-256 ${got} is not the filed ${want}; the oracle is not used`);
  return new Oracle(rel, bytes);
}

/** The owner's worked examples this package reproduces (R1-regcalc plan §2). */
export const ORACLES = {
  kfs: "01 NBFC Models/Responsible Business Conduct/Loan Pricing Calculator/KFS-M01 APR Calculator – Worked Example (fictitious NBFC).xlsx",
  lend: "01 NBFC Models/Credit Facilities/Lending Limits Monitor/LEND-M01 Lending Limits Monitor – Worked Example (fictitious NBFC).xlsx",
  ews: "01 NBFC Models/Fraud Risk Management/Early Warning Model/EWS-M01 Fraud Early Warning Model – Worked Example (fictitious NBFC).xlsx",
  app01:
    "01 NBFC Models/Registration, Exemptions and Framework for Scale Based Regulation/Applicability Engine/APP-M01 Applicability Engine – Worked Example (fictitious NBFC).xlsx",
  /** The APP-M01 master (no shared formulas): the pack-fidelity check reads its formula text. */
  app01Master:
    "01 NBFC Models/Registration, Exemptions and Framework for Scale Based Regulation/Applicability Engine/APP-M01 Applicability Engine Master Model.xlsx",
  // The sector engines are filed as unfilled masters (no profile): their stored results are the
  // empty-profile state, and each line's rule is checked against its formula (R1-D-311).
  app02:
    "02 Sector Applicability Engines/SEBI/APP-M02 Applicability Engine for SEBI Listed Entities.xlsx",
  app03:
    "02 Sector Applicability Engines/SEBI/APP-M03 Applicability Engine for SEBI Market Intermediaries.xlsx",
  app04:
    "02 Sector Applicability Engines/IFSCA/APP-M04 Applicability Engine for IFSCA Entities.xlsx",
  app05:
    "02 Sector Applicability Engines/IRDAI/APP-M05 Applicability Engine for Insurance Intermediaries.xlsx",
  app06:
    "02 Sector Applicability Engines/Co-operative Societies/APP-M06 Applicability Engine for Co-operative Societies.xlsx",
  app07:
    "02 Sector Applicability Engines/Payments and Fintech/APP-M07 Applicability Engine for Payment System Operators and Fintech Entities.xlsx",
  // The owner's worked examples of the sector engines (28 Nov 2026; R1-D-324): ComplyCl's recorded
  // inputs (REG-MODELS-05), recalculated in Excel 16.115.2. They replace the synthetic oracles.
  app02we:
    "02 Sector Applicability Engines/SEBI/APP-M02 Applicability Engine for SEBI Listed Entities – Worked Example (fictitious listed entity).xlsx",
  app03we:
    "02 Sector Applicability Engines/SEBI/APP-M03 Applicability Engine for SEBI Market Intermediaries – Worked Example (fictitious stock broker).xlsx",
  app04we:
    "02 Sector Applicability Engines/IFSCA/APP-M04 Applicability Engine for IFSCA Entities – Worked Example (fictitious IFSC finance company).xlsx",
  app05we:
    "02 Sector Applicability Engines/IRDAI/APP-M05 Applicability Engine for Insurance Intermediaries – Worked Example (fictitious insurance broker).xlsx",
  app06we:
    "02 Sector Applicability Engines/Co-operative Societies/APP-M06 Applicability Engine for Co-operative Societies – Worked Example (fictitious multi-State credit society).xlsx",
  app07we:
    "02 Sector Applicability Engines/Payments and Fintech/APP-M07 Applicability Engine for Payment System Operators and Fintech Entities – Worked Example (fictitious payment aggregator).xlsx",
} as const;

/** Each sheet's formula text by cell, from the workbook's XML (shared-formula children absent). */
export function formulaText(bytes: Uint8Array): Map<string, Map<string, string>> {
  const z = readZip(bytes);
  const text = (p: string) => z.get(p)!.toString("utf8");
  const rels = new Map<string, string>();
  for (const m of text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) rels.set(id, target.replace(/^\/?(xl\/)?/, "xl/"));
  }
  const out = new Map<string, Map<string, string>>();
  for (const m of text("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)) {
    const name = xmlText(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? "");
    const xml = text(rels.get(/\br:id="([^"]+)"/.exec(m[0])?.[1] ?? "") ?? "");
    const cells = new Map<string, string>();
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+[0-9]+)"/.exec(c[1] ?? "")?.[1];
      const f = c[2] ? /<f[^>]*>([^<]*)<\/f>/.exec(c[2]) : null;
      if (ref && f) cells.set(ref, xmlText(f[1]!));
    }
    out.set(name, cells);
  }
  return out;
}
