// ipb:at-report (PL1 plan §3.4, §11): which @IPB-..-AT-.. and @NN-.. tags the tests carry, their
// results when a Vitest JSON report is given, and which spec ATs have no test yet. Report only.
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const TAG = /@(IPB-\d{2}-AT-\d{2,3}|NN-\d{2}|IPB-\d{2}-\d{2,3})\b/g;
const TEST_FILE = /\.(?:int\.|e2e\.)?test\.(?:ts|tsx|mts|mjs|js|jsx)$/;
const SKIP = new Set(["node_modules", "dist", ".git", ".turbo", "coverage", ".next"]);

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

export interface TagUse {
  tag: string;
  files: string[];
  status?: "passed" | "failed" | "mixed" | "not-run";
}

/** Tags found in test files under `root`. */
export async function collectTags(root: string): Promise<Map<string, TagUse>> {
  const tags = new Map<string, TagUse>();
  for (const f of (await walk(root)).filter((p) => TEST_FILE.test(p))) {
    const text = await readFile(f, "utf8");
    for (const m of text.matchAll(TAG)) {
      const t = m[1] as string;
      const u = tags.get(t) ?? { tag: t, files: [] };
      const rel = relative(root, f);
      if (!u.files.includes(rel)) u.files.push(rel);
      tags.set(t, u);
    }
  }
  return tags;
}

interface VitestJson {
  testResults?: Array<{
    assertionResults?: Array<{
      fullName?: string;
      ancestorTitles?: string[];
      title?: string;
      status?: string;
    }>;
  }>;
}

/** Merge results from Vitest `--reporter=json` files. */
export async function applyResults(
  tags: Map<string, TagUse>,
  files: readonly string[],
): Promise<void> {
  const seen = new Map<string, Set<string>>();
  for (const f of files) {
    const j = JSON.parse(await readFile(f, "utf8")) as VitestJson;
    for (const tr of j.testResults ?? []) {
      for (const a of tr.assertionResults ?? []) {
        const name = a.fullName ?? [...(a.ancestorTitles ?? []), a.title ?? ""].join(" ");
        for (const m of name.matchAll(TAG)) {
          const s = seen.get(m[1] as string) ?? new Set<string>();
          s.add(a.status === "passed" ? "passed" : "failed");
          seen.set(m[1] as string, s);
        }
      }
    }
  }
  for (const u of tags.values()) {
    const s = seen.get(u.tag);
    u.status = !s
      ? "not-run"
      : s.size > 1
        ? "mixed"
        : (([...s][0] as "passed" | "failed") ?? "not-run");
  }
}

/** Acceptance tests declared in the spec (`@IPB-nn-AT-nn` scenario tags). */
export async function specAts(specDir: string): Promise<string[]> {
  const ats = new Set<string>();
  for (const f of (await readdir(specDir)).filter((x) => x.endsWith(".md"))) {
    for (const m of (await readFile(join(specDir, f), "utf8")).matchAll(
      /^@(IPB-\d{2}-AT-\d{2,3})\b/gm,
    ))
      ats.add(m[1] as string);
  }
  return [...ats].sort();
}

export function renderReport(
  tags: Map<string, TagUse>,
  spec: readonly string[] = [],
  files: readonly string[] = [],
): string {
  const rows = [...tags.values()].sort((a, b) => a.tag.localeCompare(b.tag));
  const lines = [
    "| Tag | Status | Test files |",
    "|---|---|---|",
    ...rows.map((r) => `| ${r.tag} | ${r.status ?? "found"} | ${r.files.join(", ")} |`),
  ];
  if (spec.length) {
    const missing = spec.filter((a) => !tags.has(a));
    if (files.length) lines.unshift(`Filter: ${files.join(", ")}`);
    lines.push(
      "",
      `Spec ATs with a tagged test: ${spec.length - missing.length} of ${spec.length}.`,
      `Not yet covered: ${missing.join(", ") || "none"}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
