// Lighthouse gate (IPB-06-54(c), `@IPB-06-AT-02`; IPB-04-91 budgets). This evaluates a Lighthouse
// result (LHR JSON) against `a11y.ci.lighthouse_min` (95, may not be lowered) and the IPB-04 lab
// budgets `web.seo.budget.*`. Running Lighthouse is the CI job's step; this package does not
// depend on it (PL5-D-03).

export const LIGHTHOUSE_FLOOR = 95;
export const DEFAULT_BUDGETS = { lcp_ms: 2500, cls: 0.1, inp_ms: 200 } as const;

/** The parts of a Lighthouse result this gate reads. */
export interface LighthouseResult {
  finalUrl?: string;
  finalDisplayedUrl?: string;
  categories: {
    accessibility?: { score: number | null; auditRefs: { id: string; weight: number }[] };
  };
  audits: Record<
    string,
    { id?: string; title: string; score: number | null; numericValue?: number }
  >;
}

export interface LighthouseVerdict {
  url: string;
  ok: boolean;
  /** Accessibility score, 0 to 100. */
  score: number | null;
  min: number;
  /** Accessibility audits that did not pass, by weight. */
  failingAudits: { id: string; title: string; weight: number }[];
  budgetFailures: { metric: string; value: number; budget: number }[];
}

export function evaluateLighthouse(
  lhr: LighthouseResult,
  o: { min?: number; budgets?: Partial<Record<keyof typeof DEFAULT_BUDGETS, number>> } = {},
): LighthouseVerdict {
  const min = o.min ?? LIGHTHOUSE_FLOOR;
  if (min < LIGHTHOUSE_FLOOR)
    throw new Error(`a11y.ci.lighthouse_min may not be lowered below ${LIGHTHOUSE_FLOOR}`);
  const budgets = { ...DEFAULT_BUDGETS, ...o.budgets };
  const cat = lhr.categories.accessibility;
  const score = cat?.score == null ? null : Math.round(cat.score * 100);

  const failingAudits = (cat?.auditRefs ?? [])
    .filter((r) => r.weight > 0)
    .map((r) => ({ ref: r, audit: lhr.audits[r.id] }))
    .filter(({ audit }) => audit && audit.score !== null && audit.score < 1)
    .map(({ ref, audit }) => ({ id: ref.id, title: audit!.title, weight: ref.weight }))
    .sort((a, b) => b.weight - a.weight);

  // A navigation run cannot measure INP; total blocking time is its lab stand-in (PL5-D-03).
  const metrics: [string, string, number][] = [
    ["lcp_ms", "largest-contentful-paint", budgets.lcp_ms],
    ["cls", "cumulative-layout-shift", budgets.cls],
    ["inp_ms", "interaction-to-next-paint", budgets.inp_ms],
  ];
  const budgetFailures: LighthouseVerdict["budgetFailures"] = [];
  for (const [metric, id, budget] of metrics) {
    const audit =
      lhr.audits[id] ?? (metric === "inp_ms" ? lhr.audits["total-blocking-time"] : undefined);
    const value = audit?.numericValue;
    if (value !== undefined && value > budget) budgetFailures.push({ metric, value, budget });
  }

  return {
    url: lhr.finalDisplayedUrl ?? lhr.finalUrl ?? "",
    ok: score !== null && score >= min && budgetFailures.length === 0,
    score,
    min,
    failingAudits,
    budgetFailures,
  };
}

export function formatLighthouseVerdict(v: LighthouseVerdict): string {
  const lines = [
    `${v.ok ? "PASS" : "FAIL"} ${v.url}: accessibility ${v.score ?? "n/a"} (minimum ${v.min})`,
  ];
  for (const a of v.failingAudits) lines.push(`  audit ${a.id} (weight ${a.weight}): ${a.title}`);
  for (const b of v.budgetFailures) lines.push(`  budget ${b.metric}: ${b.value} over ${b.budget}`);
  return lines.join("\n");
}
