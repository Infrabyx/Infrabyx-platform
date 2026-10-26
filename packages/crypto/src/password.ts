// Seed passwords exactly per IPB-11 §11.4.7 (PL1-C-08): 24 base62 characters plus exactly two
// symbols from "-_.!@#" at random positions, from randomBytes(32) with rejection sampling, at least
// one upper, lower, digit and symbol, and no persona, product or year substrings.
import { randomBytes } from "./random.js";

const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const SYMBOLS = "-_.!@#";
export const SEED_PASSWORD_LENGTH = 26;

/** Unbiased draws from a stream of randomBytes(32) blocks. */
class Draws {
  private buf = randomBytes(32);
  private i = 0;
  next(max: number): number {
    const limit = 256 - (256 % max);
    for (;;) {
      if (this.i >= this.buf.byteLength) {
        this.buf = randomBytes(32);
        this.i = 0;
      }
      const b = this.buf[this.i++] as number;
      if (b < limit) return b % max;
    }
  }
}

export interface SeedPasswordOptions {
  /** Substrings that must not appear (persona key, product label, years), compared case-insensitively. */
  forbidden?: readonly string[];
}

export function isValidSeedPassword(p: string, forbidden: readonly string[] = []): boolean {
  if (p.length < 24) return false;
  const symbols = [...p].filter((c) => SYMBOLS.includes(c)).length;
  if (symbols !== 2) return false;
  if (![...p].every((c) => BASE62.includes(c) || SYMBOLS.includes(c))) return false;
  if (!/[A-Z]/.test(p) || !/[a-z]/.test(p) || !/[0-9]/.test(p)) return false;
  const lower = p.toLowerCase();
  return !forbidden.some((f) => f.length >= 3 && lower.includes(f.toLowerCase()));
}

export function generateSeedPassword(opts: SeedPasswordOptions = {}): string {
  const forbidden = [...(opts.forbidden ?? []), ...yearSubstrings()];
  for (let attempt = 0; attempt < 1000; attempt++) {
    const d = new Draws();
    const chars: string[] = [];
    for (let i = 0; i < 24; i++) chars.push(BASE62[d.next(BASE62.length)] as string);
    for (let s = 0; s < 2; s++)
      chars.splice(d.next(chars.length + 1), 0, SYMBOLS[d.next(SYMBOLS.length)] as string);
    const p = chars.join("");
    if (isValidSeedPassword(p, forbidden)) return p;
  }
  throw new Error("could not generate a valid seed password");
}

function yearSubstrings(): string[] {
  const y = new Date().getUTCFullYear();
  return [String(y - 1), String(y), String(y + 1)];
}
