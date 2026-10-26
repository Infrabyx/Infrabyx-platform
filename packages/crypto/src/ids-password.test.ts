import { describe, expect, it } from "vitest";
import { ULID_REGEX, idSchema } from "@infrabyx/contracts/ids";
import { deterministicId, newId, ulid, ulidTime } from "./ulid.js";
import { generateSeedPassword, isValidSeedPassword } from "./password.js";

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
  it("draws base62 characters without bias (χ² test, 61 dof, p≈0.001 bound)", () => {
    const counts = new Map<string, number>();
    let n = 0;
    for (const p of sample)
      for (const c of p)
        if (/[A-Za-z0-9]/.test(c)) {
          counts.set(c, (counts.get(c) ?? 0) + 1);
          n++;
        }
    const expected = n / 62;
    let chi = 0;
    for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")
      chi += ((counts.get(c) ?? 0) - expected) ** 2 / expected;
    expect(chi).toBeLessThan(100.9);
  });
  it("rejects weak candidates", () => {
    expect(isValidSeedPassword("short")).toBe(false);
    expect(isValidSeedPassword("abcdefghijklmnopqrstuvwxyz")).toBe(false);
  });
});
