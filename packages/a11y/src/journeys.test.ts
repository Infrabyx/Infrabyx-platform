import { describe, expect, it } from "vitest";
import { lintJourneys, parseJourneyRegistry, routeCovered } from "./journeys.js";

const base = {
  product: "FBX",
  journeys: [
    {
      id: "fbx.borrower.apply",
      persona: "borrower",
      title: "Apply for a loan",
      routes: ["/apply", "/apply/kfs", "/apply/sign"],
      regulated_steps: ["/apply/kfs"],
      at_scripts: ["apply.nvda.md"],
    },
  ],
  out_of_journey: ["/__gallery", "/errors/*"],
};

const errors = (f: ReturnType<typeof lintJourneys>) => f.filter((x) => x.severity === "error");

describe("@IPB-06-AT-07 voice journeys need a text twin", () => {
  it("fails a voice journey without text_twin_journey_id with IPB-A11Y-009", () => {
    const reg = {
      ...base,
      journeys: [
        ...base.journeys,
        {
          id: "fbx.collections.voicebot_reminder",
          persona: "borrower",
          title: "Voice reminder",
          routes: ["/reminders"],
          voice: true,
          at_scripts: ["reminder.talkback.md"],
        },
      ],
    };
    const e = errors(lintJourneys(reg));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({
      code: "IPB-A11Y-009",
      subject: "fbx.collections.voicebot_reminder",
    });
    expect(e[0]!.message).toBe(
      "Journey fbx.collections.voicebot_reminder has voice=true but no text_twin_journey_id.",
    );
  });

  it("accepts a voice journey that is its own text twin, and rejects an unknown twin", () => {
    const own = { ...base.journeys[0]!, voice: true, text_twin_journey_id: "fbx.borrower.apply" };
    expect(errors(lintJourneys({ ...base, journeys: [own] }))).toEqual([]);
    const unknown = { ...own, text_twin_journey_id: "fbx.borrower.missing" };
    expect(errors(lintJourneys({ ...base, journeys: [unknown] }))[0]!.message).toMatch(
      /not a journey/,
    );
  });
});

describe("journey registry lint (IPB-06-58)", () => {
  it("fails a served route in no journey and not out_of_journey", () => {
    const f = lintJourneys(base, {
      routes: ["/apply", "/apply/kfs", "/apply/sign", "/pricing", "/__gallery", "/errors/404"],
    });
    expect(errors(f).map((x) => x.subject)).toEqual(["/pricing"]);
  });

  it("warns on a journey route the app no longer serves", () => {
    const f = lintJourneys(base, { routes: ["/apply", "/apply/kfs"] });
    expect(errors(f)).toEqual([]);
    expect(f.find((x) => x.subject === "/apply/sign")?.severity).toBe("warning");
  });

  it("checks regulated steps, duplicate IDs, AT script files and the schema", () => {
    const j = base.journeys[0]!;
    const bad = {
      ...base,
      journeys: [j, { ...j, regulated_steps: ["/elsewhere"] }],
    };
    const msgs = errors(lintJourneys(bad, { atScriptExists: () => false })).map((x) => x.message);
    expect(msgs).toContain("duplicate journey ID");
    expect(msgs).toContain("regulated step /elsewhere is not one of the journey's routes");
    expect(msgs.filter((m) => m.startsWith("AT script apply.nvda.md not found"))).toHaveLength(2);
    expect(errors(lintJourneys({ ...base, product: "fbx", extra: 1 })).length).toBe(2);
  });

  it("parses the IPB-06 §06.4.3 example and covers wildcard exclusions", () => {
    const reg = parseJourneyRegistry(`
product: UDF
journeys:
  - id: udf.borrower.kyc_and_sign
    persona: borrower
    title: Complete KYC and sign the loan agreement
    routes: [/onboard/kyc, /onboard/kfs, /onboard/sign, /onboard/receipt]
    regulated_steps: [/onboard/kfs, /onboard/sign]
    voice: true
    text_twin_journey_id: udf.borrower.kyc_and_sign
    click_budget: 3
    at_scripts: [talkback.md, voiceover.md]
    isl_tutorial_required: true
    locales_required: all12
`);
    expect(reg.journeys[0]!.click_budget).toBe(3);
    expect(errors(lintJourneys(reg))).toEqual([]);
    expect(routeCovered("/errors/*", "/errors")).toBe(true);
    expect(routeCovered("/errors/*", "/errors/404")).toBe(true);
    expect(routeCovered("/errors/*", "/errorsx")).toBe(false);
  });
});
