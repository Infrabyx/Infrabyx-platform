import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";
import { HelpEntrySchema, wordCount, type HelpEntryInput } from "./entry.js";
import { collectKeys, keysInText, lintHelp, lintRemovals } from "./lint.js";
import { HelpRegistry, loadRegistry, parseRegistryFile, publicGlossary } from "./registry.js";
import { lintTours, mayAutoStart, tourActions, tourState, TourSchema } from "./tours.js";

const entry = (over: Partial<HelpEntryInput> = {}) =>
  HelpEntrySchema.parse({
    key: "hlp.ldc.compliance_calendar",
    term: "Compliance calendar",
    plain:
      "The list of filings and actions your organisation must complete, each with a due date, owner and status.",
    effective_date: "2026-10-25",
    status: "published",
    ...over,
  });

const lawCitation = {
  instrument: "Companies Act 2013",
  provision: "s.92 (annual return)",
  summary: "The annual return must be filed with the Registrar within the statutory period.",
  effective_date: "2014-04-01",
  tag: "LAW" as const,
};

describe("@IPB-07-AT-02 a missing help key fails CI", () => {
  it("fails with IPB-HLP-001 naming the file and key when the registry has no entry", () => {
    const uses = keysInText(
      `<Field label="GST state code" helpKey="hlp.fbx.gst_state_code" />`,
      "src/gst.tsx",
    );
    const f = lintHelp([entry()], uses);
    expect(f).toEqual([
      {
        severity: "error",
        code: "IPB-HLP-001",
        key: "hlp.fbx.gst_state_code",
        where: "src/gst.tsx:1",
        message: "help key hlp.fbx.gst_state_code is not in the registry",
      },
    ]);
  });

  it("accepts a draft entry only off the production branch, and shared keys always", () => {
    const draft = entry({ key: "hlp.fbx.gst_state_code", status: "draft" });
    const uses = keysInText(
      `helpKey="hlp.fbx.gst_state_code"\nhelpKey: "hlp.shared.org_id"`,
      "a.tsx",
    );
    expect(lintHelp([draft], uses, { allowDraft: true })).toEqual([]);
    expect(lintHelp([draft], uses).map((x) => x.code)).toEqual(["IPB-HLP-001"]);
  });

  it("collects keys from components, catalogues and the settings tree, and rejects keys of another form", () => {
    const uses = keysInText(
      [
        `<Field helpKey="hlp.web.cin" />`,
        `    helpKey: "hlp.int.port_not_configured",`,
        `      help: hlp.trust.passkeys_required,`,
        `    help_key: ntf.security.login_alert`,
        `<Field helpKey={"hlp.web.work_email"} />`,
      ].join("\n"),
      "x",
    );
    expect(uses.map((u) => u.key)).toEqual([
      "hlp.web.cin",
      "hlp.int.port_not_configured",
      "hlp.trust.passkeys_required",
      "ntf.security.login_alert",
      "hlp.web.work_email",
    ]);
    const f = lintHelp([], [uses[3]!]);
    expect(f[0]!.message).toBe("ntf.security.login_alert is not a help key (hlp.<module>.<term>)");
  });

  it("walks directories and skips tests, dist and node_modules", () => {
    const dir = mkdtempSync(join(tmpdir(), "hlp-"));
    mkdirSync(join(dir, "src"));
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "src", "a.tsx"), `helpKey="hlp.web.cin"`);
    writeFileSync(join(dir, "src", "a.test.tsx"), `helpKey="hlp.web.nope"`);
    writeFileSync(join(dir, "dist", "a.js"), `helpKey="hlp.web.nope"`);
    expect(collectKeys([dir]).map((u) => u.key)).toEqual(["hlp.web.cin"]);
  });
});

describe("@IPB-07-AT-15 a legal citation requires a reviewer of record", () => {
  it("fails with IPB-HLP-003 until a PLT_LEGAL_REVIEWER reviews, then the footer shows initials and date", () => {
    const unreviewed = entry({
      key: "hlp.ldc.annual_return",
      term: "Annual return",
      status: "in_review",
      regulatory_reference: [lawCitation],
    });
    expect(lintHelp([unreviewed], []).map((x) => x.code)).toEqual(["IPB-HLP-003"]);
    const byEditor = entry({
      ...unreviewed,
      reviewer_of_record: {
        role: "PLT_CONTENT_EDITOR",
        user_id: "usr_1",
        reviewed_at: "2026-10-20",
      },
    });
    expect(lintHelp([byEditor], []).map((x) => x.code)).toEqual(["IPB-HLP-003"]);
    const reviewed = entry({
      ...unreviewed,
      status: "published",
      reviewer_of_record: {
        role: "PLT_LEGAL_REVIEWER",
        user_id: "usr_2",
        reviewed_at: "2026-10-20",
        initials: "AK",
      },
    });
    expect(lintHelp([reviewed], [])).toEqual([]);
    const r = new HelpRegistry([reviewed]).resolve("hlp.ldc.annual_return")!;
    expect(r).toMatchObject({ reviewerInitials: "AK", effectiveDate: "2026-10-25" });
    expect(r.regulatoryReference).toMatchObject({
      instrument: "Companies Act 2013",
      provision: "s.92 (annual return)",
    });
  });
});

describe("@IPB-07-AT-17 the public glossary excludes internal entries", () => {
  it("lists public entries at /glossary/<module>/<term> and leaves internal ones out", () => {
    const g = publicGlossary([
      entry(),
      entry({ key: "hlp.oh.product_scope", term: "Product scope", visibility: "internal" }),
      entry({ key: "hlp.ldc.draft_term", term: "Draft term", status: "draft" }),
    ]);
    expect(g).toEqual([
      {
        letter: "C",
        items: [
          expect.objectContaining({
            key: "hlp.ldc.compliance_calendar",
            href: "/glossary/ldc/compliance_calendar",
          }),
        ],
      },
    ]);
  });

  it("uses the locale variant, falling back to Hindi then English with a pending badge", () => {
    const e = entry({
      locales: {
        hi: { term: "अनुपालन कैलेंडर", plain: "आपके संगठन को पूरे करने वाले कार्यों की सूची।" },
      },
    });
    const reg = new HelpRegistry([e]);
    expect(reg.resolve(e.key, "hi-IN")).toMatchObject({
      term: "अनुपालन कैलेंडर",
      translationPending: false,
    });
    expect(reg.resolve(e.key, "ta-IN")).toMatchObject({ locale: "hi", translationPending: true });
    expect(reg.resolve(e.key, "en-IN")).toMatchObject({
      term: "Compliance calendar",
      translationPending: false,
    });
    expect(publicGlossary([e], "hi-IN")[0]!.letter).toBe("अ");
  });
});

describe("entry rules (IPB-07 §07.4.3)", () => {
  it("fails a plain definition over 40 words in any locale with IPB-HLP-002", () => {
    const long = Array.from({ length: 41 }, (_, i) => `word${i}`).join(" ");
    expect(wordCount(long)).toBe(41);
    expect(wordCount("A — dash, counts; only words.")).toBe(5);
    expect(lintHelp([entry({ plain: long })], []).map((x) => x.code)).toEqual(["IPB-HLP-002"]);
    expect(
      lintHelp([entry({ locales: { hi: { term: "x", plain: long } } })], [])[0]!.message,
    ).toContain("(hi)");
  });

  it("fails a referenced key deprecated without superseded_by, and a removed key still in use (IPB-HLP-004)", () => {
    const uses = keysInText(`helpKey="hlp.ldc.compliance_calendar"`, "a.tsx");
    expect(lintHelp([entry({ status: "deprecated" })], uses).map((x) => x.code)).toEqual([
      "IPB-HLP-004",
    ]);
    const next = entry({ key: "hlp.ldc.filing_calendar", term: "Filing calendar" });
    const ok = lintHelp([entry({ status: "deprecated", superseded_by: next.key }), next], uses);
    expect(ok.map((x) => x.severity)).toEqual(["warning"]);
    expect(lintRemovals(["hlp.ldc.compliance_calendar"], [next], uses)[0]!.code).toBe(
      "IPB-HLP-004",
    );
  });

  it("loads registry files by module, reporting schema errors, wrong modules and duplicates", () => {
    const dir = mkdtempSync(join(tmpdir(), "reg-"));
    writeFileSync(
      join(dir, "ldc.yaml"),
      `module: ldc\nentries:\n  - { key: hlp.ldc.a, term: A, plain: An a., effective_date: 2026-10-25, status: published }\n  - { key: hlp.fbx.b, term: B, plain: A b., effective_date: 2026-10-25, status: published }\n  - { key: hlp.ldc.c, term: C, effective_date: 2026-10-25, status: published }\n`,
    );
    writeFileSync(
      join(dir, "more.yaml"),
      `module: ldc\nentries:\n  - { key: hlp.ldc.a, term: A, plain: Again., effective_date: 2026-10-25, status: draft }\n`,
    );
    const r = loadRegistry([dir]);
    expect(r.entries.map((e) => e.key)).toEqual(["hlp.ldc.a"]);
    expect(r.issues.map((i) => i.key)).toEqual(["hlp.fbx.b", "hlp.ldc.c", "hlp.ldc.a"]);
    expect(parseRegistryFile("nope: 1", "x").issues).toHaveLength(1);
  });
});

const tour = (steps: number, route = "/compliance/calendar") =>
  TourSchema.parse({
    id: "ldc.calendar.intro",
    title_key: "hlp.ldc.compliance_calendar",
    steps: Array.from({ length: steps }, (_, i) => ({
      route,
      target: `step-${i}`,
      title_key: "hlp.ldc.compliance_calendar",
      body_key: "hlp.ldc.compliance_calendar",
    })),
  });

describe("@IPB-07-AT-19 tours are short, skippable and never on regulated steps", () => {
  it("fails a tour of 8 steps and a step on the e-sign confirmation screen with IPB-TUT-003", () => {
    expect(lintTours([tour(8)]).findings.map((f) => f.code)).toEqual(["IPB-TUT-003"]);
    const esign = lintTours([tour(2, "/sign/confirm")], { regulatedRoutes: ["/sign/confirm"] });
    expect(esign.findings.map((f) => f.message)).toEqual([
      "step 1 targets the regulated step /sign/confirm",
      "step 2 targets the regulated step /sign/confirm",
    ]);
    expect(lintTours([tour(7)], { maxSteps: 9 }).findings).toEqual([]);
    expect(lintTours([tour(7)]).keys).toHaveLength(15);
  });

  it("resumes from Help at the step where the person skipped", () => {
    const t = tour(5);
    let p = tourActions.start({}, t);
    p = tourActions.next(p, t);
    p = tourActions.next(p, t);
    p = tourActions.skip(p, t);
    expect(tourState(p, t.id)).toEqual({ step: 2, status: "skipped" });
    p = tourActions.resume(p, t);
    expect(tourState(p, t.id)).toEqual({ step: 2, status: "in_progress" });
    for (let i = 0; i < 3; i++) p = tourActions.next(p, t);
    expect(tourState(p, t.id).status).toBe("completed");
  });

  it("never starts by itself on a regulated step, or once seen", () => {
    const t = tour(2, "/sign/confirm");
    expect(
      mayAutoStart(t, {}, "/sign/confirm", { autoStart: true, regulatedRoutes: ["/sign/confirm"] }),
    ).toBe(false);
    const u = tour(2);
    expect(
      mayAutoStart(u, {}, "/compliance/calendar", { autoStart: true, regulatedRoutes: [] }),
    ).toBe(true);
    expect(
      mayAutoStart(u, tourActions.skip({}, u), "/compliance/calendar", {
        autoStart: true,
        regulatedRoutes: [],
      }),
    ).toBe(false);
    expect(
      mayAutoStart(u, {}, "/compliance/calendar", { autoStart: false, regulatedRoutes: [] }),
    ).toBe(false);
  });
});

describe("infrabyx-hlp lint", () => {
  let out = "";
  beforeEach(() => {
    out = "";
    vi.spyOn(process.stdout, "write").mockImplementation((s) => ((out += String(s)), true));
    vi.spyOn(process.stderr, "write").mockImplementation((s) => ((out += String(s)), true));
  });
  afterEach(() => vi.restoreAllMocks());

  it("exits 1 on a missing key and 0 when the registry covers every use", () => {
    const dir = mkdtempSync(join(tmpdir(), "hlpcli-"));
    mkdirSync(join(dir, "registry"));
    mkdirSync(join(dir, "src"));
    writeFileSync(
      join(dir, "registry", "web.yaml"),
      "module: web\nentries:\n  - { key: hlp.web.cin, term: CIN, plain: The company's registration number., effective_date: 2026-10-27, status: draft }\n",
    );
    writeFileSync(
      join(dir, "src", "f.tsx"),
      `<Field helpKey="hlp.web.cin" />\n<Field helpKey="hlp.web.gstin" />`,
    );
    expect(
      main([
        "lint",
        "--registry",
        join(dir, "registry"),
        "--keys",
        join(dir, "src"),
        "--allow-draft",
      ]),
    ).toBe(1);
    expect(out).toContain("IPB-HLP-001: help key hlp.web.gstin is not in the registry");
    writeFileSync(join(dir, "src", "f.tsx"), `<Field helpKey="hlp.web.cin" />`);
    expect(
      main([
        "lint",
        "--registry",
        join(dir, "registry"),
        "--keys",
        join(dir, "src"),
        "--allow-draft",
      ]),
    ).toBe(0);
    expect(main(["lint", "--registry", join(dir, "registry"), "--keys", join(dir, "src")])).toBe(1);
    expect(main(["lint"])).toBe(2);
  });
});
