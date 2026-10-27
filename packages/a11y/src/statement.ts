// Accessibility statement generator (IPB-06-57, §06.4.9; IPB-05 template 10). The statement is
// computed from the release record, which holds the CI results per route and theme, the signed
// manual checklist, the AT runs and the open accessibility defects. The input has no status field,
// so conformance cannot be typed in; only the known-issues narrative is free text. A journey with
// an open P1 or P2 defect is never "Conforms" (`IPB-A11Y-010`, `@IPB-06-AT-19`).
import { z } from "zod";
import { releaseChecklist } from "./checklist.js";
import { wcagMapping, isUnverified } from "./mapping.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date as YYYY-MM-DD");
const route = z.string().regex(/^\/[^\s]*$/);

export const THEMES_REQUIRED = ["light", "dark"] as const;
export const DEFECT_SEVERITIES = ["P1", "P2", "P3", "P4"] as const;
/** Open defects at these severities stop a journey from being "Conforms". */
export const BLOCKING_SEVERITIES: readonly string[] = ["P1", "P2"];

export const ReleaseRecordSchema = z
  .object({
    product: z.string().regex(/^[A-Z]{2,4}$/),
    product_name: z.string().min(1),
    release: z.string().min(1),
    released_at: isoDate,
    /** What the statement covers, in one sentence. */
    scope: z.string().min(1),
    gov_facing: z.boolean().default(false),
    journeys: z
      .array(
        z
          .object({
            id: z.string().min(1),
            title: z.string().min(1),
            routes: z.array(route).min(1),
            regulated_steps: z.array(route).default([]),
          })
          .strict(),
      )
      .min(1),
    ci: z.array(
      z
        .object({
          route,
          theme: z.enum(["light", "dark", "hc_light", "hc_dark"]),
          axe_violations: z.number().int().min(0),
          htmlcs_errors: z.number().int().min(0),
          rules: z.array(z.string()).default([]),
        })
        .strict(),
    ),
    checklist: z
      .object({
        signed_by: z.string().min(1),
        signed_at: isoDate,
        items: z.array(
          z
            .object({
              id: z.string().regex(/^C\d{2}$/),
              result: z.enum(["pass", "fail", "na"]),
              note: z.string().optional(),
            })
            .strict(),
        ),
      })
      .strict(),
    at_runs: z.array(
      z
        .object({
          journey_id: z.string().min(1),
          /** Screen reader or other AT with its version, such as "NVDA 2026.3". */
          at: z.string().min(1),
          browser: z.string().min(1),
          result: z.enum(["pass", "fail"]),
          evidence_class: z.enum(["MANUAL", "AT-USER"]),
          tested_at: isoDate,
          defects: z.array(z.string().regex(/^fbk_/)).default([]),
        })
        .strict(),
    ),
    defects: z.array(
      z
        .object({
          fbk_id: z.string().regex(/^fbk_/),
          journey_id: z.string().min(1),
          severity: z.enum(DEFECT_SEVERITIES),
          summary: z.string().min(1),
          target_date: isoDate,
          status: z.enum(["open", "closed"]),
        })
        .strict(),
    ),
    reviewer_of_record: z.string().min(1),
    feedback: z
      .object({
        email: z.string().email(),
        form_path: route,
        phone: z.string().optional(),
      })
      .strict(),
    sla: z
      .object({
        ack_hours: z.number().int().min(1),
        workaround_days: z.number().int().min(1),
        fix_days_blocking: z.number().int().min(1),
        fix_days_other: z.number().int().min(1),
      })
      .strict(),
    grievance: z
      .object({
        name: z.string().min(1),
        email: z.string().email(),
        resolution_days: z.number().int().min(1).default(30),
      })
      .strict(),
    /** The only free text: the narrative around known issues (IPB-06-57). */
    known_issues_narrative: z.string().optional(),
  })
  .strict();
export type ReleaseRecord = z.input<typeof ReleaseRecordSchema>;
type Record_ = z.output<typeof ReleaseRecordSchema>;

export type ConformanceStatus = "conforms" | "partially_conforms" | "does_not_conform";
export const STATUS_LABEL: Record<ConformanceStatus, string> = {
  conforms: "Conforms",
  partially_conforms: "Partially conforms",
  does_not_conform: "Does not conform",
};

export interface StatementException {
  kind: "ci" | "untested" | "defect" | "at" | "checklist";
  text: string;
  fbk_id?: string;
  severity?: string;
  target_date?: string;
}

export interface JourneyConformance {
  id: string;
  title: string;
  status: ConformanceStatus;
  exceptions: StatementException[];
}

export interface StatementFinding {
  code: "IPB-A11Y-010";
  journey_id: string;
  fbk_id: string;
  message: string;
}

export interface Statement {
  product: string;
  product_name: string;
  release: string;
  date: string;
  scope: string;
  standards: string[];
  journeys: JourneyConformance[];
  summary: Record<ConformanceStatus, number>;
  assistive_technologies: { at: string; browser: string }[];
  known_issues: StatementException[];
  narrative?: string;
  feedback: Record_["feedback"];
  sla: Record_["sla"];
  grievance: Record_["grievance"];
  reviewer_of_record: string;
  /** Downgrades the generator applied, for the release log. */
  findings: StatementFinding[];
  /** The Claims Register entry this statement backs (IPB-08). */
  claim: {
    kind: "accessibility_statement";
    product: string;
    release: string;
    evidence: { ci_results: number; at_runs: number; checklist_signed_by: string };
  };
}

const worse = (a: ConformanceStatus, b: ConformanceStatus): ConformanceStatus => {
  const rank = { conforms: 0, partially_conforms: 1, does_not_conform: 2 } as const;
  return rank[a] >= rank[b] ? a : b;
};

export function generateStatement(input: ReleaseRecord): Statement {
  const rec = ReleaseRecordSchema.parse(input);

  const expected = releaseChecklist().map((i) => i.id);
  const recorded = new Set(rec.checklist.items.map((i) => i.id));
  const missing = expected.filter((id) => !recorded.has(id));
  if (missing.length)
    throw new Error(`the signed checklist must record every item; missing ${missing.join(", ")}`);
  const checklistFails = rec.checklist.items.filter((i) => i.result === "fail");

  const findings: StatementFinding[] = [];
  const journeys: JourneyConformance[] = rec.journeys.map((j) => {
    let status: ConformanceStatus = "conforms";
    const exceptions: StatementException[] = [];

    for (const r of j.routes)
      for (const theme of THEMES_REQUIRED) {
        const res = rec.ci.find((c) => c.route === r && c.theme === theme);
        if (!res) {
          status = worse(status, "does_not_conform");
          exceptions.push({
            kind: "untested",
            text: `${r} has no automated result in the ${theme} theme.`,
          });
        } else if (res.axe_violations || res.htmlcs_errors) {
          status = worse(status, "does_not_conform");
          const rules = res.rules.length ? ` (${res.rules.join(", ")})` : "";
          exceptions.push({
            kind: "ci",
            text: `${r} in the ${theme} theme failed automated checks${rules}.`,
          });
        }
      }

    const runs = rec.at_runs.filter((a) => a.journey_id === j.id);
    if (!runs.length) {
      status = worse(status, "partially_conforms");
      exceptions.push({
        kind: "at",
        text: "Not yet tested with assistive technology in this release.",
      });
    }
    const latest = new Map<string, (typeof runs)[number]>();
    for (const r of runs) {
      const k = `${r.at}|${r.browser}`;
      const prev = latest.get(k);
      if (!prev || prev.tested_at <= r.tested_at) latest.set(k, r);
    }
    for (const r of latest.values())
      if (r.result === "fail") {
        status = worse(status, "partially_conforms");
        exceptions.push({
          kind: "at",
          text: `Failed with ${r.at} and ${r.browser} on ${r.tested_at}.`,
        });
      }

    for (const d of rec.defects.filter((x) => x.journey_id === j.id && x.status === "open")) {
      if (BLOCKING_SEVERITIES.includes(d.severity) && status === "conforms")
        findings.push({
          code: "IPB-A11Y-010",
          journey_id: j.id,
          fbk_id: d.fbk_id,
          message: `Journey ${j.id} has open defect ${d.fbk_id}; status downgraded to Partially conforms.`,
        });
      status = worse(status, "partially_conforms");
      exceptions.push({
        kind: "defect",
        text: d.summary,
        fbk_id: d.fbk_id,
        severity: d.severity,
        target_date: d.target_date,
      });
    }

    if (checklistFails.length) {
      status = worse(status, "partially_conforms");
      exceptions.push({
        kind: "checklist",
        text: `Manual checks failed this release: ${checklistFails.map((i) => i.id).join(", ")}.`,
      });
    }
    return { id: j.id, title: j.title, status, exceptions };
  });

  const summary = { conforms: 0, partially_conforms: 0, does_not_conform: 0 };
  for (const j of journeys) summary[j.status] += 1;

  const items = new Map(releaseChecklist().map((i) => [i.id, i]));
  const knownIssues: StatementException[] = [
    ...rec.defects
      .filter((d) => d.status === "open")
      .map((d) => ({
        kind: "defect" as const,
        text: d.summary,
        fbk_id: d.fbk_id,
        severity: d.severity,
        target_date: d.target_date,
      })),
    ...checklistFails.map((i) => ({
      kind: "checklist" as const,
      text: `${items.get(i.id)?.text ?? i.id}${i.note ? ` ${i.note}` : ""}`,
    })),
  ];

  const ats = new Map<string, { at: string; browser: string }>();
  for (const r of rec.at_runs) ats.set(`${r.at}|${r.browser}`, { at: r.at, browser: r.browser });

  const map = wcagMapping();
  const standards = [
    "WCAG 2.2 Level AA",
    isUnverified(map.is_17802)
      ? "IS 17802 Parts 1 and 2 (clause references to be confirmed against the published text)"
      : `IS 17802 Parts 1 and 2 (${map.is_17802})`,
    `EN 301 549 ${map.en_301_549}`,
  ];
  if (rec.gov_facing) standards.push("GIGW 3.0");

  const statement: Statement = {
    product: rec.product,
    product_name: rec.product_name,
    release: rec.release,
    date: rec.released_at,
    scope: rec.scope,
    standards,
    journeys,
    summary,
    assistive_technologies: [...ats.values()],
    known_issues: knownIssues,
    feedback: rec.feedback,
    sla: rec.sla,
    grievance: rec.grievance,
    reviewer_of_record: rec.reviewer_of_record,
    findings,
    claim: {
      kind: "accessibility_statement",
      product: rec.product,
      release: rec.release,
      evidence: {
        ci_results: rec.ci.length,
        at_runs: rec.at_runs.length,
        checklist_signed_by: rec.checklist.signed_by,
      },
    },
  };
  if (rec.known_issues_narrative) statement.narrative = rec.known_issues_narrative;
  return statement;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** `YYYY-MM-DD` → `DD MMM YYYY` (IPB-07 date format). */
export const displayDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
};

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/**
 * The statement as an HTML fragment for `/accessibility` (no scripts, no inline styles). Every
 * value is escaped; the conformance table comes only from the computed status.
 */
export function renderStatementHtml(s: Statement): string {
  const h: string[] = [];
  h.push(`<article class="ibx-statement" lang="en">`);
  h.push(`<h1>Accessibility statement for ${esc(s.product_name)}</h1>`);
  h.push(`<p>${esc(s.scope)}</p>`);
  h.push(`<h2>Standards</h2><ul>${s.standards.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`);
  h.push(`<h2>Conformance status</h2>`);
  h.push(
    `<table><caption>Conformance by journey, release ${esc(s.release)}</caption>` +
      `<thead><tr><th scope="col">Journey</th><th scope="col">Status</th><th scope="col">Exceptions</th></tr></thead><tbody>`,
  );
  for (const j of s.journeys) {
    const ex = j.exceptions.length
      ? `<ul>${j.exceptions
          .map(
            (e) =>
              `<li>${esc(e.text)}${e.target_date ? ` Target date: <time datetime="${esc(e.target_date)}">${esc(displayDate(e.target_date))}</time>.` : ""}</li>`,
          )
          .join("")}</ul>`
      : "None";
    h.push(
      `<tr><th scope="row">${esc(j.title)}</th><td>${STATUS_LABEL[j.status]}</td><td>${ex}</td></tr>`,
    );
  }
  h.push(`</tbody></table>`);
  h.push(`<h2>Assistive technologies tested</h2>`);
  h.push(
    s.assistive_technologies.length
      ? `<ul>${s.assistive_technologies.map((a) => `<li>${esc(a.at)} with ${esc(a.browser)}</li>`).join("")}</ul>`
      : `<p>None in this release.</p>`,
  );
  h.push(`<h2>Known issues</h2>`);
  if (s.narrative) h.push(`<p>${esc(s.narrative)}</p>`);
  h.push(
    s.known_issues.length
      ? `<ul>${s.known_issues
          .map(
            (k) =>
              `<li>${esc(k.text)}${k.target_date ? ` We aim to fix this by <time datetime="${esc(k.target_date)}">${esc(displayDate(k.target_date))}</time>.` : ""}</li>`,
          )
          .join("")}</ul>`
      : `<p>No known issues.</p>`,
  );
  h.push(`<h2>Feedback and contact</h2>`);
  h.push(
    `<p>If you find a barrier, tell us through <a href="${esc(s.feedback.form_path)}">the accessibility feedback form</a> or by email to <a href="mailto:${esc(s.feedback.email)}">${esc(s.feedback.email)}</a>${s.feedback.phone ? `, or by text message to ${esc(s.feedback.phone)}` : ""}.</p>`,
  );
  h.push(
    `<p>We acknowledge reports within ${s.sla.ack_hours} hours and offer a workaround within ${s.sla.workaround_days} days. We aim to fix a blocking issue on a regulated step within ${s.sla.fix_days_blocking} days and other issues within ${s.sla.fix_days_other} days.</p>`,
  );
  h.push(`<h2>Escalation</h2>`);
  h.push(
    `<p>If you are not satisfied with our response, write to our Grievance Officer, ${esc(s.grievance.name)}, at <a href="mailto:${esc(s.grievance.email)}">${esc(s.grievance.email)}</a>. We aim to resolve complaints within ${s.grievance.resolution_days} days. Complaints about accessibility can also be raised under the Rights of Persons with Disabilities Act, 2016.</p>`,
  );
  h.push(`<h2>About this statement</h2>`);
  h.push(
    `<p>Generated for release ${esc(s.release)} on <time datetime="${esc(s.date)}">${esc(displayDate(s.date))}</time> from the automated test results, the manual release checklist and the assistive-technology test runs. Reviewer of record: ${esc(s.reviewer_of_record)}.</p>`,
  );
  h.push(`</article>`);
  return h.join("\n");
}
