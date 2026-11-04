// Dataset writers (Ecosystem §12.1 formats): CSV per RFC 4180 (UTF-8 with BOM, CRLF, every field
// quoted when needed, no thousands separators), JSONL with sorted keys, ISO 8601 instants in UTC
// with milliseconds. Values are formatted one way only, so the same rows give the same bytes.
import { canonicalize } from "@infrabyx/crypto";

const BOM = "﻿";

/** One cell value as text: null → empty; instants ISO 8601 UTC; arrays and objects as JCS JSON. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "boolean") return String(v);
  if (v instanceof Uint8Array) return Buffer.from(v).toString("base64");
  return canonicalize(v);
}

/**
 * Characters that make a spreadsheet read a text cell as a formula when it starts with one of them
 * (OWASP "CSV injection"): `=`, `+`, `-`, `@`, tab and carriage return.
 */
export const FORMULA_TRIGGERS: readonly string[] = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Formula-injection neutralisation for text bound for a spreadsheet: text starting with a formula
 * trigger gets a leading apostrophe, so the program shows it as text and never evaluates it. Other
 * text is unchanged. `toXlsx` applies it to every string cell; `toCsv` applies it when asked.
 */
export function neutraliseFormula(s: string): string {
  return s.length > 0 && FORMULA_TRIGGERS.includes(s[0] as string) ? `'${s}` : s;
}

function quote(s: string): string {
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface CsvOptions {
  /**
   * Neutralise formula injection (`neutraliseFormula`) in the header and every cell. Off by
   * default, so archive datasets keep the exact values the verifier and JSONL carry; turn it on for
   * a CSV meant to be opened in a spreadsheet.
   */
  neutraliseFormulas?: boolean;
}

/** CSV with a header row; `columns` gives the order. */
export function toCsv(
  columns: readonly string[],
  rows: ReadonlyArray<Record<string, unknown>>,
  o: CsvOptions = {},
): Buffer {
  const f = o.neutraliseFormulas ? neutraliseFormula : (s: string) => s;
  const lines = [columns.map((c) => quote(f(c))).join(",")];
  for (const r of rows) lines.push(columns.map((c) => quote(f(cellText(r[c])))).join(","));
  return Buffer.from(BOM + lines.join("\r\n") + "\r\n", "utf8");
}

/** The JSON value of a cell for JSONL (instants as ISO strings, bigints as strings). */
export function jsonValue(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) return Buffer.from(v).toString("base64");
  return v ?? null;
}

/** One canonical JSON object per line. */
export function toJsonl(
  columns: readonly string[],
  rows: ReadonlyArray<Record<string, unknown>>,
): Buffer {
  const out: string[] = [];
  for (const r of rows) {
    const o: Record<string, unknown> = {};
    for (const c of columns) o[c] = jsonValue(r[c]);
    out.push(canonicalize(o));
  }
  return Buffer.from(out.map((l) => `${l}\n`).join(""), "utf8");
}
