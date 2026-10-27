import { describe, expect, it } from "vitest";
import { releaseChecklist } from "./checklist.js";
import { generateStatement, renderStatementHtml, type ReleaseRecord } from "./statement.js";

const allPass = () => releaseChecklist().map((i) => ({ id: i.id, result: "pass" as const }));

function record(over: Partial<ReleaseRecord> = {}): ReleaseRecord {
  const routes = ["/hearing/join", "/hearing/room"];
  return {
    product: "EQ",
    product_name: "Example Product",
    release: "1.4.0",
    released_at: "2026-10-27",
    scope: "This statement covers the hearing journeys of the example product.",
    journeys: [
      { id: "eq.party.join_hearing", title: "Join a hearing", routes },
      { id: "eq.party.read_award", title: "Read an award", routes: ["/award"] },
    ],
    ci: [...routes, "/award"].flatMap((route) =>
      (["light", "dark"] as const).map((theme) => ({
        route,
        theme,
        axe_violations: 0,
        htmlcs_errors: 0,
      })),
    ),
    checklist: {
      signed_by: "Accessibility Lead (example)",
      signed_at: "2026-10-26",
      items: allPass(),
    },
    at_runs: [
      {
        journey_id: "eq.party.join_hearing",
        at: "NVDA 2026.3",
        browser: "Firefox 145",
        result: "pass",
        evidence_class: "MANUAL",
        tested_at: "2026-10-25",
      },
      {
        journey_id: "eq.party.read_award",
        at: "VoiceOver (macOS 26)",
        browser: "Safari 26",
        result: "pass",
        evidence_class: "AT-USER",
        tested_at: "2026-10-25",
      },
    ],
    defects: [],
    reviewer_of_record: "Office of the Company Secretary",
    feedback: { email: "accessibility@example.test", form_path: "/accessibility#report" },
    sla: { ack_hours: 24, workaround_days: 5, fix_days_blocking: 30, fix_days_other: 90 },
    grievance: { name: "Grievance Officer", email: "grievance@example.test" },
    ...over,
  };
}

describe("@IPB-06-AT-19 the accessibility statement is generated, not written", () => {
  it("downgrades a journey with an open P1 defect to Partially conforms, listing it with its target date", () => {
    const s = generateStatement(
      record({
        defects: [
          {
            fbk_id: "fbk_01JB0000000000000000000001",
            journey_id: "eq.party.join_hearing",
            severity: "P1",
            summary: "The mute button has no accessible name in the hearing room.",
            target_date: "2026-11-15",
            status: "open",
          },
        ],
      }),
    );
    const j = s.journeys.find((x) => x.id === "eq.party.join_hearing")!;
    expect(j.status).toBe("partially_conforms");
    expect(j.exceptions).toContainEqual(
      expect.objectContaining({
        fbk_id: "fbk_01JB0000000000000000000001",
        target_date: "2026-11-15",
      }),
    );
    expect(s.findings).toEqual([
      {
        code: "IPB-A11Y-010",
        journey_id: "eq.party.join_hearing",
        fbk_id: "fbk_01JB0000000000000000000001",
        message:
          "Journey eq.party.join_hearing has open defect fbk_01JB0000000000000000000001; status downgraded to Partially conforms.",
      },
    ]);
    expect(s.journeys.find((x) => x.id === "eq.party.read_award")!.status).toBe("conforms");
    expect(s.claim).toMatchObject({
      kind: "accessibility_statement",
      product: "EQ",
      release: "1.4.0",
    });

    const html = renderStatementHtml(s);
    expect(html).toContain("<td>Partially conforms</td>");
    expect(html).toContain('<time datetime="2026-11-15">15 Nov 2026</time>');
  });

  it("refuses a status typed into the release record", () => {
    const r = record();
    const tampered = { ...r, journeys: [{ ...r.journeys[0]!, status: "conforms" }] };
    expect(() => generateStatement(tampered as unknown as ReleaseRecord)).toThrow(/status/);
  });

  it("is Conforms only with clean CI in light and dark, an AT run, no open defect and a clean checklist", () => {
    expect(generateStatement(record()).summary).toEqual({
      conforms: 2,
      partially_conforms: 0,
      does_not_conform: 0,
    });

    const r = record();
    const noDark = generateStatement({
      ...r,
      ci: r.ci.filter((c) => !(c.route === "/award" && c.theme === "dark")),
    });
    expect(noDark.journeys[1]!.status).toBe("does_not_conform");

    const failing = generateStatement({
      ...r,
      ci: r.ci.map((c) =>
        c.route === "/award" ? { ...c, axe_violations: 1, rules: ["button-name"] } : c,
      ),
    });
    expect(failing.journeys[1]!.exceptions[0]!.text).toContain("button-name");

    const noAt = generateStatement({ ...r, at_runs: r.at_runs.slice(0, 1) });
    expect(noAt.journeys[1]!.status).toBe("partially_conforms");

    const failedCheck = generateStatement({
      ...r,
      checklist: {
        ...r.checklist,
        items: allPass().map((i) => (i.id === "C13" ? { ...i, result: "fail" as const } : i)),
      },
    });
    expect(failedCheck.summary.partially_conforms).toBe(2);
    expect(failedCheck.known_issues[0]!.text).toMatch(/link's purpose/);

    // A later passing run with the same AT and browser replaces an earlier failure.
    const rerun = generateStatement({
      ...r,
      at_runs: [
        ...r.at_runs,
        { ...r.at_runs[1]!, result: "fail" as const, tested_at: "2026-10-20" },
      ],
    });
    expect(rerun.journeys[1]!.status).toBe("conforms");
  });

  it("needs every checklist item signed, and escapes every value it renders", () => {
    const r = record();
    expect(() =>
      generateStatement({ ...r, checklist: { ...r.checklist, items: allPass().slice(1) } }),
    ).toThrow(/missing C01/);
    const html = renderStatementHtml(
      generateStatement({ ...r, product_name: "<script>x</script>" }),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("WCAG 2.2 Level AA");
    expect(html).toContain("EN 301 549 V3.2.1");
    expect(html).not.toContain("GIGW");
    expect(renderStatementHtml(generateStatement({ ...r, gov_facing: true }))).toContain(
      "GIGW 3.0",
    );
  });
});
