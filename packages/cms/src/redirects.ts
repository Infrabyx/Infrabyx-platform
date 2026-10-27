// Redirect rules (IPB-04-10, IPB-04-20; `@IPB-04-AT-08`; PL5 plan §5.5). 301, 302 and 410; loops
// and chains longer than one hop are refused at save (`IPB-CMS-009`); a legacy CSV import is a dry
// run that commits nothing until confirmed; a slug change adds a 301 and repoints earlier
// redirects at the new path, so chains never form.
export interface RedirectRule {
  from: string;
  /** null for 410 Gone. */
  to: string | null;
  status: 301 | 302 | 410;
}

const PATH = /^\/[^\s?#]*$/;
const TARGET = /^(\/[^\s]*|https:\/\/[^\s]+)$/;

export const normalisePath = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

/** Why a rule cannot be added to `existing` (empty when it can). */
export function redirectProblems(existing: readonly RedirectRule[], rule: RedirectRule): string[] {
  const problems: string[] = [];
  const from = normalisePath(rule.from);
  const to = rule.to === null ? null : normalisePath(rule.to);
  if (!PATH.test(from)) problems.push(`from "${rule.from}" is not a site path`);
  if ((rule.status === 410) !== (to === null))
    problems.push("410 has no target; 301 and 302 need one");
  if (to !== null && !TARGET.test(to))
    problems.push(`to "${rule.to}" is not a site path or https: URL`);
  if (to === from) problems.push(`loop: ${from} → ${from}`);
  const byFrom = new Map(existing.map((r) => [normalisePath(r.from), r]));
  if (byFrom.has(from))
    problems.push(`${from} already redirects to ${byFrom.get(from)!.to ?? "410"}`);
  if (to !== null) {
    const next = byFrom.get(to);
    if (next) {
      // Follow the chain to tell a loop from a chain.
      const trail = [from, to];
      let cur: RedirectRule | undefined = next;
      let loop = false;
      while (cur?.to) {
        const n = normalisePath(cur.to);
        trail.push(n);
        if (trail.indexOf(n) < trail.length - 1) {
          loop = true;
          break;
        }
        cur = byFrom.get(n);
      }
      problems.push(
        loop
          ? `loop: ${trail.join(" → ")}`
          : `chain longer than one hop: ${from} → ${to} → ${next.to ?? "410"}`,
      );
    }
  }
  const into = existing.filter((r) => r.to !== null && normalisePath(r.to) === from);
  for (const r of into)
    problems.push(`chain longer than one hop: ${normalisePath(r.from)} → ${from} → ${to ?? "410"}`);
  return problems;
}

/** Earlier redirects that pointed at `oldPath`, repointed at `newPath` (no chain is created). */
export function repointed(
  existing: readonly (RedirectRule & { id: string })[],
  oldPath: string,
  newPath: string,
): { id: string; to: string }[] {
  return existing
    .filter((r) => r.to !== null && normalisePath(r.to) === normalisePath(oldPath))
    .filter((r) => normalisePath(r.from) !== normalisePath(newPath))
    .map((r) => ({ id: r.id, to: newPath }));
}

export interface CsvRow {
  line: number;
  rule: RedirectRule;
}

/** Parse `from_path,to_path,status` CSV (header required; quoted fields allowed). */
export function parseRedirectCsv(csv: string): {
  rows: CsvRow[];
  invalid: { line: number; reason: string }[];
} {
  const rows: CsvRow[] = [];
  const invalid: { line: number; reason: string }[] = [];
  const lines = csv.replace(/\r\n?/g, "\n").split("\n");
  const cells = (l: string) =>
    [...l.matchAll(/(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g)].map((m) =>
      (m[1] ?? m[2] ?? "").replace(/""/g, '"').trim(),
    );
  const head = cells(lines[0] ?? "").map((h) => h.toLowerCase());
  const [fi, ti, si] = ["from_path", "to_path", "status"].map((h) => head.indexOf(h));
  if (fi === undefined || fi < 0 || ti === undefined || ti < 0) {
    invalid.push({ line: 1, reason: "header must contain from_path and to_path" });
    return { rows, invalid };
  }
  lines.slice(1).forEach((l, i) => {
    const line = i + 2;
    if (!l.trim()) return;
    const c = cells(l);
    const status = si !== undefined && si >= 0 && c[si] ? Number(c[si]) : 301;
    if (status !== 301 && status !== 302 && status !== 410) {
      invalid.push({ line, reason: `status ${c[si!]} is not 301, 302 or 410` });
      return;
    }
    const to = c[ti] ? c[ti]! : null;
    rows.push({ line, rule: { from: c[fi]!, to: status === 410 ? null : to, status } });
  });
  return { rows, invalid };
}

export interface DryRunReport {
  /** Rows that would be added. */
  accepted: CsvRow[];
  conflicts: { line: number; reason: string }[];
  loops: { line: number; reason: string }[];
  chains: { line: number; reason: string }[];
  invalid: { line: number; reason: string }[];
}

/**
 * The legacy import dry run (`@IPB-04-AT-08`): every row is checked against the existing map and
 * the rows accepted before it. Nothing is written; the caller commits `accepted` only after the
 * editor confirms.
 */
export function dryRun(existing: readonly RedirectRule[], csv: string): DryRunReport {
  const { rows, invalid } = parseRedirectCsv(csv);
  const report: DryRunReport = {
    accepted: [],
    conflicts: [],
    loops: [],
    chains: [],
    invalid: [...invalid],
  };
  const map = [...existing];
  for (const row of rows) {
    const problems = redirectProblems(map, row.rule);
    if (!problems.length) {
      report.accepted.push(row);
      map.push(row.rule);
      continue;
    }
    for (const p of problems) {
      const entry = { line: row.line, reason: p };
      if (p.startsWith("loop")) report.loops.push(entry);
      else if (p.startsWith("chain")) report.chains.push(entry);
      else if (p.includes("already redirects")) report.conflicts.push(entry);
      else report.invalid.push(entry);
    }
  }
  return report;
}
