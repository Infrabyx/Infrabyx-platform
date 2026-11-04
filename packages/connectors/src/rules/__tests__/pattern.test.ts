// `matches` patterns (PR-LDC-13; R1-plan M40; R1-D-71): the linear-time subset, its bounds, and
// that re2js (zen, json-rules) and a JavaScript RegExp without flags (the memory walk) agree on
// every pattern the subset accepts.
import { describe, expect, it } from "vitest";
import { linearPattern, MAX_MATCH_INPUT, MAX_PATTERN_LENGTH, patternRefusal } from "../index.js";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;

describe("matches patterns: the linear-time subset", () => {
  it("accepts the subset", () => {
    for (const p of [
      "NBFC",
      "^L\\d{5}[A-Z]{2}\\d{4}(PLC|PTC)\\d{6}$",
      "\\bco-?op(erative)?\\b",
      "(?:ab)+c",
      "[a-z\\-_.]{2,}",
      "[\\d\\w]+$",
      "a{0}b{1,}c{2,5}?",
      "बैंक|bank",
      "\\.\\*\\+\\?\\(\\)\\[\\]\\{\\}\\|\\^\\$\\\\\\/",
      "a|",
      "x\\ty\\nz\\r",
    ])
      expect(patternRefusal(p), p).toBeNull();
  });

  it("refuses back-references, look-around, atomic, possessive and nested quantifiers", () => {
    for (const p of [
      "(a)\\1",
      "(?<n>a)\\k<n>",
      "(?=a)",
      "(?!a)",
      "(?<=a)b",
      "(?<!a)b",
      "(?>a+)",
      "a*+",
      "a++",
      "a?+",
      "a{2}+",
      "a**",
      "(a+)+",
      "(a*)*",
      "(a|aa)+",
      "(?:a|b)*",
      "((a)+)?",
      "(?i)a",
      "(?P<n>a)",
    ])
      expect(patternRefusal(p), p).not.toBeNull();
  });

  it("refuses constructs whose meaning differs between RE2 and a RegExp without flags", () => {
    for (const p of [
      ".",
      "a.*b",
      "[^a]",
      "\\D",
      "\\W",
      "\\s",
      "\\S",
      "\\B",
      "\\x41",
      "\\u0041",
      "\\p{L}",
      "[[:alpha:]]",
      "\\A",
      "\\z",
      "a{,3}",
      "{",
      "a{2",
      "]",
      "}",
      "[a-]",
      "[\\d-z]",
      "[z-a]",
      "[]",
      "()",
      "(",
      ")",
      "\\",
      "😀",
      "a\u0001",
      "a{1001}",
      "*a",
      "^*",
      "\\b+",
    ])
      expect(patternRefusal(p), p).not.toBeNull();
  });

  it("bounds the pattern and the text", () => {
    expect(patternRefusal("")).not.toBeNull();
    expect(patternRefusal("a".repeat(MAX_PATTERN_LENGTH))).toBeNull();
    expect(patternRefusal("a".repeat(MAX_PATTERN_LENGTH + 1))).toMatch(/longer/);
    const re = linearPattern("b$");
    expect(re.test(`${"a".repeat(MAX_MATCH_INPUT - 1)}b`)).toBe(true);
    expect(() => re.test("a".repeat(MAX_MATCH_INPUT + 1))).toThrow(/too long/);
    expect(() => re.test(7 as unknown as string)).toThrow(TypeError);
    expect(() => linearPattern("(a+)+")).toThrow(/refused/);
  });

  it("is an unanchored search with no flags", () => {
    expect(linearPattern("NBFC").test("An NBFC Ltd")).toBe(true);
    expect(linearPattern("nbfc").test("An NBFC Ltd")).toBe(false);
    expect(linearPattern("^An").test("An NBFC")).toBe(true);
    expect(linearPattern("^NBFC").test("An NBFC")).toBe(false);
    expect(linearPattern("Ltd$").test("Ltd\n")).toBe(false);
  });

  it("re2js and RegExp agree on generated patterns and texts", () => {
    const r = rng(20261104);
    const tokens = [
      "a",
      "b",
      "1",
      "-",
      " ",
      "é",
      "ब",
      "\\d",
      "\\w",
      "\\b",
      "^",
      "$",
      "[a-c]",
      "[\\d_]",
      "[ब-ह]",
      "[a\\-]",
      "(",
      ")",
      "(?:",
      "|",
      "*",
      "+",
      "?",
      "{2}",
      "{1,3}",
      "{0,}",
      "*?",
      "\\.",
      "\\n",
    ];
    const alphabet = ["a", "b", "c", "1", "2", "-", "_", " ", "é", "ब", "ह", ".", "\n", "\r"];
    const extra = [" ", "😀", "𝔸"];
    let accepted = 0;
    for (let i = 0; i < 4000; i++) {
      const p = Array.from({ length: 1 + Math.floor(r() * 8) }, () => pick(r, tokens)).join("");
      if (patternRefusal(p) !== null) continue;
      accepted++;
      const js = new RegExp(p);
      const re = linearPattern(p);
      for (let j = 0; j < 25; j++) {
        const s = Array.from({ length: Math.floor(r() * 12) }, () =>
          pick(r, r() < 0.15 ? extra : alphabet),
        ).join("");
        expect(re.test(s), `${JSON.stringify(p)} on ${JSON.stringify(s)}`).toBe(js.test(s));
      }
    }
    expect(accepted).toBeGreaterThan(500);
  });
});
