// Linear-time patterns for CEL `matches` (PR-LDC-13; R1-plan M40; R1-D-71). A pattern is a string
// literal checked when the rule set is compiled (so when a draft is saved, before it can be
// submitted for publication) against a small RE2 subset whose meaning is the same in every engine:
// `zen` and `json-rules` evaluate it with `re2js` (a pure JavaScript port of RE2, linear time by
// construction), and the memory walk with `@marcbachmann/cel-js`, which runs `new RegExp(p)` with
// no flags. So the subset also has to be safe on a backtracking engine and mean the same there:
//
// - literals (Basic Multilingual Plane, no control characters), `\d`, `\w`, `\b`, `\t`, `\n`, `\r`,
//   escaped punctuation, `^`, `$`, positive classes `[...]` with ranges, `|`, `(...)` and
//   `(?:...)`, and the quantifiers `*`, `+`, `?`, `{n}`, `{n,}`, `{n,m}` (n ≤ m ≤ 1000), lazy or not;
// - refused: back-references (`\1`, `\k<..>`), look-around, atomic groups, named groups, inline
//   flags, possessive or stacked quantifiers, a quantified group that holds a quantifier or an
//   alternation (`(a+)+`, `(a*)*`, `(a|aa)+`), empty groups and classes, and the constructs whose
//   meaning differs between RE2 and a JavaScript RegExp without flags: `.`, negated classes, `\D`,
//   `\W`, `\s`, `\S` (characters outside the BMP, `\r` and U+2028/9), `\B` (true between the two
//   halves of a surrogate pair in JavaScript), `\x`, `\u`, `\p`, POSIX classes;
// - at most `MAX_PATTERN_LENGTH` characters. The text matched is at most `MAX_MATCH_INPUT` characters
//   (rule inputs are checked to that bound before any engine runs); a longer text fails closed.
// `matches` is an unanchored search, as in CEL.
import { RE2JS } from "re2js";

export const MAX_PATTERN_LENGTH = 256;
export const MAX_MATCH_INPUT = 4096;
const MAX_REPEAT = 1000;

/** Punctuation that may be escaped, in and out of a class; every engine reads it as itself. */
const ESCAPABLE = new Set([..."\\^$.|?*+()[]{}-/"]);

interface Info {
  /** The atom or sequence contains a quantifier. */
  quant: boolean;
  /** The atom or sequence contains an alternation. */
  alt: boolean;
}

class PatternRefusal extends Error {}

const refuse = (detail: string): never => {
  throw new PatternRefusal(detail);
};

function plainChar(ch: string, where: string): void {
  const c = ch.charCodeAt(0);
  if (c >= 0xd800 && c <= 0xdfff)
    refuse(`a character outside the Basic Multilingual Plane ${where}`);
  if (c < 0x20 || c === 0x7f) refuse(`a control character ${where}`);
}

/** A recursive-descent check of the subset; throws `PatternRefusal`. */
class Checker {
  private i = 0;
  constructor(private readonly p: string) {}

  run(): void {
    this.alternation();
    if (this.i < this.p.length) refuse(`unbalanced ) at ${this.i}`);
  }

  private peek(o = 0): string | undefined {
    return this.p[this.i + o];
  }

  private alternation(): Info {
    const info = this.sequence();
    while (this.peek() === "|") {
      this.i++;
      const s = this.sequence();
      info.quant ||= s.quant;
      info.alt = true;
    }
    return info;
  }

  private sequence(): Info {
    const info: Info = { quant: false, alt: false };
    for (;;) {
      const ch = this.peek();
      if (ch === undefined || ch === "|" || ch === ")") return info;
      const start = this.i;
      const atom = this.atom();
      if (atom === "assertion") {
        if (this.isQuantifier()) refuse(`nothing to repeat at ${this.i}`);
        continue;
      }
      if (this.quantifier()) {
        if (atom.quant) refuse(`nested quantifier in ${this.p.slice(start, this.i)}`);
        if (atom.alt) refuse(`quantified alternation in ${this.p.slice(start, this.i)}`);
        info.quant = true;
      }
      info.quant ||= atom.quant;
      info.alt ||= atom.alt;
    }
  }

  private isQuantifier(): boolean {
    const ch = this.peek();
    return ch === "*" || ch === "+" || ch === "?" || ch === "{";
  }

  /** Parse an optional quantifier after an atom; true when there was one. */
  private quantifier(): boolean {
    const ch = this.peek();
    if (ch === "*" || ch === "+" || ch === "?") this.i++;
    else if (ch === "{") {
      const m = /^\{(\d{1,4})(,(\d{0,4}))?\}/.exec(this.p.slice(this.i));
      if (!m) return refuse(`{ at ${this.i} is not a repeat count (escape it as \\{)`);
      const lo = Number(m[1]);
      const hi = m[2] === undefined ? lo : m[3] === "" ? Infinity : Number(m[3]);
      if (lo > MAX_REPEAT || (hi !== Infinity && hi > MAX_REPEAT))
        refuse(`repeat count above ${MAX_REPEAT}`);
      if (lo > hi) refuse(`repeat range {${lo},${hi}} is reversed`);
      this.i += m[0].length;
    } else return false;
    if (this.peek() === "?") this.i++; // lazy: the same boolean result
    if (this.isQuantifier()) refuse(`possessive or stacked quantifier at ${this.i}`);
    return true;
  }

  private atom(): Info | "assertion" {
    const ch = this.peek() as string;
    switch (ch) {
      case "^":
      case "$":
        this.i++;
        return "assertion";
      case "(":
        return this.group();
      case "[":
        this.cls();
        return { quant: false, alt: false };
      case "\\":
        return this.escape();
      case ".":
        return refuse("`.` is not in the subset (use a character class)");
      case "*":
      case "+":
      case "?":
      case "{":
        return refuse(`nothing to repeat at ${this.i}`);
      case "]":
      case "}":
        return refuse(`escape ${ch} at ${this.i}`);
      default:
        plainChar(ch, `at ${this.i}`);
        this.i++;
        return { quant: false, alt: false };
    }
  }

  private group(): Info {
    this.i++;
    if (this.peek() === "?") {
      if (this.peek(1) !== ":")
        refuse(
          "only (...) and (?:...) groups are allowed (no look-around, atomic, named or flag groups)",
        );
      this.i += 2;
    }
    if (this.peek() === ")") refuse("empty group");
    const info = this.alternation();
    if (this.peek() !== ")") refuse("unbalanced (");
    this.i++;
    return info;
  }

  private escape(): Info | "assertion" {
    const e = this.peek(1);
    if (e === undefined) return refuse("trailing backslash");
    this.i += 2;
    if (e === "b") return "assertion";
    if (e === "d" || e === "w" || e === "t" || e === "n" || e === "r" || ESCAPABLE.has(e))
      return { quant: false, alt: false };
    if (/\d/.test(e) || e === "k") return refuse("back-references are not allowed");
    return refuse(`\\${e} is not in the subset`);
  }

  private cls(): void {
    const open = this.i;
    this.i++;
    if (this.peek() === "^") refuse("negated classes are not in the subset");
    if (this.peek() === "]") refuse("empty class");
    for (;;) {
      const ch = this.peek();
      if (ch === undefined) refuse(`unterminated class at ${open}`);
      if (ch === "]") {
        this.i++;
        return;
      }
      const lo = this.classItem();
      if (this.peek() === "-") {
        if (lo === null) refuse("a class escape cannot start a range");
        this.i++;
        if (this.peek() === "]" || this.peek() === undefined)
          refuse("escape a literal - in a class as \\-");
        const hi = this.classItem();
        if (hi === null) refuse("a class escape cannot end a range");
        if ((lo as number) > (hi as number)) refuse("reversed range in a class");
      }
    }
  }

  /** One class member: its code unit for a literal, null for a class escape (`\d`, `\w`). */
  private classItem(): number | null {
    const ch = this.peek() as string;
    if (ch === "[") return refuse("escape [ inside a class (POSIX classes are not in the subset)");
    if (ch === "-") return refuse("escape a literal - in a class as \\-");
    if (ch === "\\") {
      const e = this.peek(1);
      if (e === undefined) return refuse("trailing backslash");
      this.i += 2;
      if (e === "d" || e === "w") return null;
      if (e === "t") return 9;
      if (e === "n") return 10;
      if (e === "r") return 13;
      if (ESCAPABLE.has(e)) return e.charCodeAt(0);
      return refuse(`\\${e} is not in the subset inside a class`);
    }
    plainChar(ch, "in a class");
    this.i++;
    return ch.charCodeAt(0);
  }
}

/** A compiled `matches` pattern: an unanchored RE2 search over at most `MAX_MATCH_INPUT` chars. */
export interface LinearPattern {
  readonly source: string;
  test(text: string): boolean;
}

/** Why `pattern` is outside the linear-time subset, or null when it is inside it. */
export function patternRefusal(pattern: string): string | null {
  if (pattern.length === 0) return "empty pattern";
  if (pattern.length > MAX_PATTERN_LENGTH) return `pattern longer than ${MAX_PATTERN_LENGTH}`;
  try {
    new Checker(pattern).run();
  } catch (e) {
    if (e instanceof PatternRefusal) return e.message;
    throw e;
  }
  // Belt and braces: both engines must accept what the subset accepts.
  try {
    new RegExp(pattern);
    RE2JS.compile(pattern);
  } catch {
    return "pattern does not compile";
  }
  return null;
}

const cache = new Map<string, LinearPattern>();
const CACHE_SIZE = 512;

/** Compile a pattern that `patternRefusal` accepted; throws on one it refuses. */
export function linearPattern(pattern: string): LinearPattern {
  const hit = cache.get(pattern);
  if (hit) return hit;
  const why = patternRefusal(pattern);
  if (why) throw new Error(`matches pattern refused: ${why}`);
  const re = RE2JS.compile(pattern);
  const compiled: LinearPattern = {
    source: pattern,
    test(text) {
      // Fails closed: a non-string or an over-long text is an evaluation error (UNDETERMINED).
      if (typeof text !== "string") throw new TypeError("matches needs a string");
      if (text.length > MAX_MATCH_INPUT) throw new RangeError("matches input too long");
      return re.test(text);
    },
  };
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  cache.set(pattern, compiled);
  return compiled;
}
