// Cell values shared by the spreadsheet writers (`toXlsx`, `toOds`): a date is a `Date` or an ISO
// 8601 day or instant with an offset (a day that rolls over is refused); a number is finite, a safe
// bigint, or a decimal string. Not exported from the package.
export const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
export const DECIMAL_RE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export function instant(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v !== "string") return null;
  const m = DATE_RE.exec(v);
  if (m) {
    const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    // Refuse a day that rolls over (2026-02-30).
    return new Date(t).toISOString().slice(0, 10) === v ? t : null;
  }
  return DATETIME_RE.test(v) ? Date.parse(v) : null;
}

export function numberOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : null;
  }
  if (typeof v === "string" && DECIMAL_RE.test(v)) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
