// Synthetic identifiers and the "no real identifier" validator (IPB-11-25, @IPB-11-AT-05).
// Aadhaar-like values start 9999 and FAIL Verhoeff; PAN-like values have Z as the fourth character
// (ZZZZ[A-Z][0-9]{4}Z, PL1-D-07); IFSC TEST0 + 6; mobiles +91 99999 0xxxx; GSTIN with a wrong
// check character; CIN with the non-existent state code ZZ.
import type { Faker } from "@faker-js/faker";

const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** True when the digit string passes the Verhoeff check (real Aadhaar numbers do). */
export function verhoeffValid(digits: string): boolean {
  let c = 0;
  const a = [...digits].reverse().map(Number);
  for (let i = 0; i < a.length; i++)
    c = (D[c] as number[])[(P[i % 8] as number[])[a[i] as number] as number] as number;
  return c === 0;
}

const GST_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** The GSTIN check character for the first 14 characters. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const prod = GST_CHARS.indexOf(first14[i] as string) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(prod / 36) + (prod % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36] as string;
}

const digits = (f: Faker, n: number) => f.string.numeric({ length: n, allowLeadingZeros: true });

export const synthetic = {
  aadhaar(f: Faker): string {
    const body = `9999${digits(f, 7)}`;
    for (;;) {
      const last = String(f.number.int({ min: 0, max: 9 }));
      if (!verhoeffValid(body + last))
        return `${body.slice(0, 4)} ${body.slice(4, 8)} ${body.slice(8)}${last}`;
    }
  },
  pan(f: Faker): string {
    return `ZZZZ${f.string.alpha({ length: 1, casing: "upper" })}${digits(f, 4)}Z`;
  },
  ifsc(f: Faker): string {
    return `TEST0${digits(f, 6)}`;
  },
  mobile(f: Faker): string {
    return `+91 99999 0${digits(f, 4)}`;
  },
  gstin(f: Faker): string {
    const first14 = `27${synthetic.pan(f)}1Z`;
    const right = gstinCheckChar(first14);
    return first14 + (GST_CHARS[(GST_CHARS.indexOf(right) + 1) % 36] as string);
  },
  cin(f: Faker): string {
    return `U${digits(f, 5)}ZZ${f.number.int({ min: 2000, max: 2025 })}PTC${digits(f, 6)}`;
  },
  bankAccount(f: Faker): string {
    return `0000${digits(f, 8)}`;
  },
};

export interface IdentifierViolation {
  path: string;
  kind: "aadhaar" | "pan" | "gstin" | "cin" | "ifsc" | "mobile" | "email";
  reason: string;
}

const ALLOWED_REAL_EMAILS = new Set(["rjnprajapati@gmail.com"]);

function check(path: string, v: string, out: IdentifierViolation[]): void {
  const s = v.trim();
  const compact = s.replace(/\s/g, "");
  if (/^\d{12}$/.test(compact) && /^\d{4}\s?\d{4}\s?\d{4}$/.test(s)) {
    if (!compact.startsWith("9999"))
      out.push({ path, kind: "aadhaar", reason: "Aadhaar-like value must start with 9999" });
    else if (verhoeffValid(compact))
      out.push({ path, kind: "aadhaar", reason: "Aadhaar-like value passes Verhoeff" });
  } else if (/^[A-Z]{5}\d{4}[A-Z]$/.test(s)) {
    if (s[3] !== "Z")
      out.push({ path, kind: "pan", reason: "PAN-like value must have Z as fourth character" });
  } else if (/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s)) {
    if (gstinCheckChar(s.slice(0, 14)) === s[14])
      out.push({ path, kind: "gstin", reason: "GSTIN-like value has a valid checksum" });
  } else if (/^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/.test(s)) {
    if (s.slice(6, 8) !== "ZZ")
      out.push({ path, kind: "cin", reason: "CIN-like value must use state code ZZ" });
  } else if (/^[A-Z]{4}0[A-Z0-9]{6}$/.test(s)) {
    if (!s.startsWith("TEST0"))
      out.push({ path, kind: "ifsc", reason: "IFSC-like value must start with TEST0" });
  } else if (/^\+91[\s-]?\d{5}[\s-]?\d{5}$/.test(s)) {
    if (!/^\+91[\s-]?99999[\s-]?0\d{4}$/.test(s))
      out.push({ path, kind: "mobile", reason: "mobile must be +91 99999 0xxxx" });
  } else if (/^[^@\s]+@[^@\s]+\.[a-z]+$/i.test(s)) {
    if (!/\.test$/i.test(s) && !ALLOWED_REAL_EMAILS.has(s.toLowerCase()))
      out.push({ path, kind: "email", reason: "email must use a .test domain" });
  }
}

/** Walk seed rows and report any value that looks like a real identifier (IPB-SEED-004). */
export function findRealIdentifiers(value: unknown, path = "$"): IdentifierViolation[] {
  const out: IdentifierViolation[] = [];
  const walk = (v: unknown, p: string) => {
    if (typeof v === "string") check(p, v, out);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`);
  };
  walk(value, path);
  return out;
}
