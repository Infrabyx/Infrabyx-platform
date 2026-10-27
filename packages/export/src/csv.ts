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

function quote(s: string): string {
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV with a header row; `columns` gives the order. */
export function toCsv(
  columns: readonly string[],
  rows: ReadonlyArray<Record<string, unknown>>,
): Buffer {
  const lines = [columns.map(quote).join(",")];
  for (const r of rows) lines.push(columns.map((c) => quote(cellText(r[c]))).join(","));
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
