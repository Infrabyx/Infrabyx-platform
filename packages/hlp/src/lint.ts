// hlp-lint (IPB-07-43, `@IPB-07-AT-02`, `@IPB-07-AT-15`). Collects the help keys a build uses (the
// `helpKey` prop, `help_key` and `help` fields in catalogues and the settings tree, `helpKey` in
// the error catalogue) and checks them against the registry:
//   IPB-HLP-001 a used key is absent, or only a draft on the production branch;
//   IPB-HLP-002 a plain definition over 40 words (any locale);
//   IPB-HLP-003 a LAW citation without a PLT_LEGAL_REVIEWER reviewer of record (non-draft entries);
//   IPB-HLP-004 a used key that is deprecated without `superseded_by`.
// `hlp.shared.*` keys resolve in the shared group registry (Ecosystem §6.38) and are accepted.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { HELP_KEY, PLAIN_MAX_WORDS, hasLawCitation, wordCount, type HelpEntry } from "./entry.js";

export interface HelpLintFinding {
  severity: "error" | "warning";
  code?: "IPB-HLP-001" | "IPB-HLP-002" | "IPB-HLP-003" | "IPB-HLP-004";
  key: string;
  /** File (and line) where the key is used or defined. */
  where: string;
  message: string;
}

export interface KeyUse {
  key: string;
  file: string;
  line: number;
}

const SHARED = /^hlp\.shared\./;

// `helpKey="hlp.x.y"`, `helpKey: "hlp.x.y"`, `help_key: hlp.x.y`, `help: hlp.x.y` (settings tree).
const USE =
  /\b(?:helpKey|help_key|help)\s*[:=]\s*\{?\s*["'`]?([a-z][a-z0-9_]*\.[a-z0-9_.]+)["'`]?/g;
const SCANNED = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".yaml", ".yml", ".json"]);

/** Help keys used in the given text (one entry per use, with its line). */
export function keysInText(text: string, file: string): KeyUse[] {
  const out: KeyUse[] = [];
  text.split("\n").forEach((l, i) => {
    for (const m of l.matchAll(USE)) {
      const key = m[1]!.replace(/\.$/, "");
      out.push({ key, file, line: i + 1 });
    }
  });
  return out;
}

/** Walk files and directories (skipping node_modules, dist and tests) and collect key uses. */
export function collectKeys(paths: readonly string[]): KeyUse[] {
  const out: KeyUse[] = [];
  const walk = (p: string) => {
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const f of readdirSync(p).sort())
        if (!["node_modules", "dist", "__tests__", "__fixtures__"].includes(f)) walk(join(p, f));
    } else if (SCANNED.has(extname(p)) && !/\.test\.[tj]sx?$/.test(p)) {
      out.push(...keysInText(readFileSync(p, "utf8"), p));
    }
  };
  for (const p of paths) walk(p);
  return out;
}

export interface HelpLintOptions {
  /** Drafts satisfy the lint only off the production branch (IPB-07-43). */
  allowDraft?: boolean;
  /** Where each entry was defined, for messages. */
  sources?: ReadonlyMap<string, string>;
}

/** Entry-level checks that hold whatever uses the registry. */
export function lintEntries(
  entries: readonly HelpEntry[],
  o: HelpLintOptions = {},
): HelpLintFinding[] {
  const out: HelpLintFinding[] = [];
  const where = (k: string) => o.sources?.get(k) ?? "registry";
  const keys = new Set(entries.map((e) => e.key));
  for (const e of entries) {
    const plains: [string, string][] = [
      ["en", e.plain],
      ...Object.entries(e.locales).map(([l, v]): [string, string] => [l, v.plain]),
    ];
    for (const [l, text] of plains) {
      const n = wordCount(text);
      if (n > PLAIN_MAX_WORDS)
        out.push({
          severity: "error",
          code: "IPB-HLP-002",
          key: e.key,
          where: where(e.key),
          message: `plain definition (${l}) has ${n} words; at most ${PLAIN_MAX_WORDS}`,
        });
    }
    if (
      hasLawCitation(e) &&
      e.status !== "draft" &&
      e.reviewer_of_record?.role !== "PLT_LEGAL_REVIEWER"
    )
      out.push({
        severity: "error",
        code: "IPB-HLP-003",
        key: e.key,
        where: where(e.key),
        message: "entry with a LAW citation needs a PLT_LEGAL_REVIEWER reviewer of record",
      });
    if (e.superseded_by && !keys.has(e.superseded_by))
      out.push({
        severity: "error",
        key: e.key,
        where: where(e.key),
        message: `superseded_by ${e.superseded_by} is not in the registry`,
      });
    if (e.status === "deprecated" && e.superseded_by === e.key)
      out.push({
        severity: "error",
        key: e.key,
        where: where(e.key),
        message: "an entry cannot supersede itself",
      });
  }
  return out;
}

/** Check every use against the registry, plus the entry-level checks. */
export function lintHelp(
  entries: readonly HelpEntry[],
  uses: readonly KeyUse[],
  o: HelpLintOptions = {},
): HelpLintFinding[] {
  const out = lintEntries(entries, o);
  const byKey = new Map(entries.map((e) => [e.key, e]));
  for (const u of uses) {
    const at = `${u.file}:${u.line}`;
    if (SHARED.test(u.key)) continue;
    if (!HELP_KEY.test(u.key)) {
      out.push({
        severity: "error",
        code: "IPB-HLP-001",
        key: u.key,
        where: at,
        message: `${u.key} is not a help key (hlp.<module>.<term>)`,
      });
      continue;
    }
    const e = byKey.get(u.key);
    if (!e) {
      out.push({
        severity: "error",
        code: "IPB-HLP-001",
        key: u.key,
        where: at,
        message: `help key ${u.key} is not in the registry`,
      });
      continue;
    }
    if ((e.status === "draft" || e.status === "in_review") && !o.allowDraft)
      out.push({
        severity: "error",
        code: "IPB-HLP-001",
        key: u.key,
        where: at,
        message: `help key ${u.key} is ${e.status}; only published entries count on the production branch`,
      });
    if (e.status === "deprecated")
      out.push(
        e.superseded_by
          ? {
              severity: "warning",
              key: u.key,
              where: at,
              message: `help key ${u.key} is deprecated; use ${e.superseded_by}`,
            }
          : {
              severity: "error",
              code: "IPB-HLP-004",
              key: u.key,
              where: at,
              message: `help key ${u.key} is deprecated without superseded_by while still referenced`,
            },
      );
  }
  return out;
}

/**
 * IPB-07-50: a key may leave the registry only when no build references it. Compare the keys of
 * the previous registry with the new one (`IPB-HLP-004` for a removed key still in use).
 */
export function lintRemovals(
  before: readonly string[],
  after: readonly HelpEntry[],
  uses: readonly KeyUse[],
): HelpLintFinding[] {
  const now = new Set(after.map((e) => e.key));
  const used = new Map(uses.map((u) => [u.key, `${u.file}:${u.line}`]));
  return before
    .filter((k) => !now.has(k) && used.has(k))
    .map((k) => ({
      severity: "error" as const,
      code: "IPB-HLP-004" as const,
      key: k,
      where: used.get(k)!,
      message: `help key ${k} was removed but is still referenced; deprecate it with superseded_by instead`,
    }));
}
