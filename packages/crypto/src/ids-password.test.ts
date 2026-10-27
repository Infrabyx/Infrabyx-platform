import { describe, expect, it } from "vitest";
import { ULID_REGEX, idSchema } from "@infrabyx/contracts/ids";
import { deterministicId, newId, ulid, ulidTime } from "./ulid.js";
import { Draws, generateSeedPassword, isValidSeedPassword } from "./password.js";
import { sha256 } from "./hash.js";

describe("ULIDs and ids", () => {
  it("produces valid ULIDs and prefixed ids", () => {
    for (let i = 0; i < 1000; i++) expect(ULID_REGEX.test(ulid())).toBe(true);
    expect(idSchema("led").safeParse(newId("led")).success).toBe(true);
    expect(() => newId("BAD")).toThrow();
  });
  it("encodes the timestamp", () => {
    const t = Date.UTC(2026, 9, 26, 10, 0, 0, 123);
    expect(ulidTime(newId("evt", t))).toBe(t);
  });
  it("derives stable seed ids from namespace and natural key (PL1-C-07)", () => {
    const anchor = new Date(Date.UTC(2026, 9, 25));
    const a = deterministicId("usr", "seed:LDC", "test.admin", anchor);
    expect(a).toBe(deterministicId("usr", "seed:LDC", "test.admin", anchor));
    expect(a).not.toBe(deterministicId("usr", "seed:LDC", "test.maker", anchor));
    expect(ulidTime(a)).toBe(anchor.getTime());
    expect(idSchema("usr").safeParse(a).success).toBe(true);
  });
});

describe("seed passwords (IPB-11 §11.4.7, PL1-C-08)", () => {
  const sample = Array.from({ length: 5000 }, () =>
    generateSeedPassword({ forbidden: ["admin", "ldc", "lawdocs"] }),
  );
  it("follows the rule: ≥24 chars, base62 + exactly two symbols, all classes", () => {
    for (const p of sample) {
      expect(p.length).toBeGreaterThanOrEqual(24);
      expect(isValidSeedPassword(p, ["admin", "ldc"])).toBe(true);
      expect([...p].filter((c) => "-_.!@#".includes(c))).toHaveLength(2);
    }
  });
  it("is unique and avoids forbidden substrings", () => {
    expect(new Set(sample).size).toBe(sample.length);
    expect(sample.some((p) => /admin|ldc|lawdocs/i.test(p))).toBe(false);
    expect(sample.some((p) => p.includes(String(new Date().getUTCFullYear())))).toBe(false);
  });
  it("rejects weak candidates", () => {
    expect(isValidSeedPassword("short")).toBe(false);
    expect(isValidSeedPassword("abcdefghijklmnopqrstuvwxyz")).toBe(false);
  });
});

// The character draw itself, from a seeded byte source, so the result is reproducible. Finished
// passwords are not uniform by design (a password without a digit or with a forbidden word is
// redrawn, which raises the share of digits), so they are checked only against their rules above.
describe("unbiased draw (rejection sampling, PL1-C-08)", () => {
  /** Deterministic byte source: SHA-256 in counter mode over a fixed seed. */
  const seeded = (seed: string) => {
    let counter = 0;
    return (n: number) => {
      const out = new Uint8Array(n);
      for (let o = 0; o < n; o += 32) out.set(sha256(`${seed}:${counter++}`).subarray(0, n - o), o);
      return out;
    };
  };

  it("draws base62 indices uniformly (χ² test, 61 dof, p≈0.001 bound)", () => {
    const d = new Draws(seeded("ipb-password-draw"));
    const n = 124_000;
    const counts = new Array<number>(62).fill(0);
    for (let k = 0; k < n; k++) counts[d.next(62)]!++;
    const expected = n / 62;
    const chi = counts.reduce((acc, c) => acc + (c - expected) ** 2 / expected, 0);
    expect(chi).toBeLessThan(100.9);
  });

  it("skips bytes at or above the rejection limit instead of folding them (no modulo bias)", () => {
    // 256 - (256 % 62) = 248: bytes 248..255 must be rejected, not reduced modulo 62.
    const blocks = [Uint8Array.from([255, 250, 248, 247, ...new Array<number>(28).fill(0)])];
    const d = new Draws(() => blocks.shift() ?? new Uint8Array(32));
    expect(d.next(62)).toBe(247 % 62);
    expect(d.next(62)).toBe(0);
  });
});
