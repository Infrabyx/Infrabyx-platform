// Type, bound and tighten checks (IPB-07-38, IPB-02-86).
import { IpbError } from "@infrabyx/contracts/errors";
import type { SettingDef } from "./types.js";

const CIDR =
  /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\/(?:3[0-2]|[12]?\d)|[0-9a-fA-F:]+\/(?:12[0-8]|1[01]\d|[1-9]?\d))$/;
const LOCALE = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|-\d{3})?$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

function isJson(v: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (v === null || typeof v === "boolean" || typeof v === "string") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => isJson(x, depth + 1));
  if (typeof v === "object") return Object.values(v as object).every((x) => isJson(x, depth + 1));
  return false;
}

/** Returns a reason when the value has the wrong type, or null when it fits. */
export function typeError(def: SettingDef, v: unknown): string | null {
  if (v === null) return null; // null = no value at this tier
  const strs = (a: unknown): a is string[] =>
    Array.isArray(a) && a.every((x) => typeof x === "string");
  switch (def.type) {
    case "bool":
      return typeof v === "boolean" ? null : "expected boolean";
    case "int":
      return Number.isInteger(v) ? null : "expected integer";
    case "decimal":
      return typeof v === "number" && Number.isFinite(v) ? null : "expected number";
    case "string":
      return typeof v === "string" ? null : "expected string";
    case "enum":
      return typeof v === "string" && (def.values ?? []).includes(v)
        ? null
        : `expected one of ${(def.values ?? []).join(", ")}`;
    case "string[]":
      return strs(v) ? null : "expected string[]";
    case "enum[]":
      return strs(v) && v.every((x) => (def.values ?? []).includes(x))
        ? null
        : "expected subset of allowed values";
    case "cidr[]":
      return strs(v) && v.every((x) => CIDR.test(x)) ? null : "expected CIDR list";
    case "json":
      return isJson(v) ? null : "expected JSON value";
    case "locale":
      return typeof v === "string" && LOCALE.test(v) ? null : "expected BCP 47 locale";
    case "route":
      return typeof v === "string" && v.startsWith("/") ? null : "expected route";
    case "time":
      return typeof v === "string" && TIME.test(v) ? null : "expected HH:MM";
    case "range": {
      const [a, b] = typeof v === "string" ? v.split("-") : [];
      return a && b && TIME.test(a) && TIME.test(b) ? null : "expected HH:MM-HH:MM";
    }
    case "date":
      return typeof v === "string" && DATE.test(v) ? null : "expected YYYY-MM-DD";
  }
}

export function boundsError(def: SettingDef, v: unknown): string | null {
  if (typeof v !== "number") return null;
  if (def.min !== undefined && v < def.min) return `below floor ${def.min}`;
  if (def.max !== undefined && v > def.max) return `above ceiling ${def.max}`;
  return null;
}

function superset(next: unknown, base: unknown): boolean {
  if (base === null || base === undefined) return true;
  if (Array.isArray(base))
    return (
      Array.isArray(next) &&
      base.every((b) => next.some((n) => JSON.stringify(n) === JSON.stringify(b)))
    );
  if (typeof base === "object") {
    if (typeof next !== "object" || next === null || Array.isArray(next)) return false;
    return Object.entries(base as Record<string, unknown>).every(([k, bv]) =>
      superset((next as Record<string, unknown>)[k], bv),
    );
  }
  return JSON.stringify(next) === JSON.stringify(base);
}

/** A lower tier may only make `tighten` keys stricter than what it inherits (IPB-07-38). */
export function tightenError(def: SettingDef, inherited: unknown, next: unknown): string | null {
  if (def.tighten === undefined || inherited === null || inherited === undefined || next === null)
    return null;
  switch (def.tighten) {
    case "min":
      return typeof next === "number" && typeof inherited === "number" && next < inherited
        ? `may only be raised from ${inherited}`
        : null;
    case "max":
      return typeof next === "number" && typeof inherited === "number" && next > inherited
        ? `may only be lowered from ${inherited}`
        : null;
    case "superset":
      return superset(next, inherited) ? null : "may only add to the inherited value";
    case true:
      return inherited === true && next !== true
        ? "may not be switched off below the tier that switched it on"
        : null;
    case false:
      return inherited === false && next !== false
        ? "may not be switched on below the tier that switched it off"
        : null;
    default:
      return null;
  }
}

export function assertValid(def: SettingDef, v: unknown): void {
  const t = typeError(def, v);
  if (t) throw new IpbError("IPB-UX-008", { detail: `${def.key}: ${t}`, meta: { key: def.key } });
  const b = boundsError(def, v);
  if (b) throw new IpbError("IPB-UX-008", { detail: `${def.key}: ${b}`, meta: { key: def.key } });
}
