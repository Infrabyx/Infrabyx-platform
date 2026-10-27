// The locked list, product ceilings, manifests, disclosure and the advice detector (PL4 plan §8).
import { describe, expect, it } from "vitest";
import { LOCKED_ACTION_CATEGORIES } from "@infrabyx/contracts/vidhi";
import { productCeiling } from "./ceilings.js";
import { coveredCategories, KERNEL_LOCKED_LIST, lockedCategory, toolWords } from "./locked.js";
import { aiLabel, asksForAdvice, assistantName, labelDate, modelFamily } from "./persona.js";
import { lintManifest } from "./manifest-lint.js";
import { SkillRegistry } from "./skills.js";

const manifest = (over: Record<string, unknown> = {}) => ({
  key: "oh.vendor_payment_prepare",
  product: "OH",
  display_name: { en: "Prepare vendor payment" },
  description: "Gathers invoices and prepares a payment for approval.",
  inputs: { type: "object" },
  outputs: { type: "object" },
  tools: [
    { name: "vendors.lookup", kind: "service", write: false, locked: false },
    { name: "payments.release", kind: "service", write: true, locked: false },
    { name: "drafts.save_note", kind: "service", write: true, locked: false },
  ],
  data_class_max: "CONFIDENTIAL",
  autonomy_ceiling: "L4",
  prompt_key: "vidhi.persona",
  eval_set_ref: "evals/vidhi.persona",
  owner_role: "ORG_ADMIN",
  surfaces: ["panel"],
  ...over,
});

describe("kernel locked list (IPB-03-71)", () => {
  it("covers every IPB-03-71 category and cannot be changed at run time", () => {
    expect(coveredCategories()).toEqual([...LOCKED_ACTION_CATEGORIES].sort());
    expect(Object.isFrozen(KERNEL_LOCKED_LIST)).toBe(true);
    expect(Object.isFrozen(KERNEL_LOCKED_LIST[0])).toBe(true);
    expect(() => (KERNEL_LOCKED_LIST as unknown as unknown[]).push({})).toThrow();
    expect(() => {
      (KERNEL_LOCKED_LIST[0]!.words as string[]).push("x");
    }).toThrow();
  });

  it("matches by the words of a tool name", () => {
    expect(toolWords("payments.release_batch")).toEqual(
      expect.arrayContaining(["payments", "release_batch", "release", "batch"]),
    );
    const cat = (t: string, p?: "UDF" | "LD") => lockedCategory(t, p)?.category ?? null;
    expect(cat("payments.release")).toBe("payments");
    expect(cat("loans.sanction")).toBe("credit_decision");
    expect(cat("hr.payroll_update")).toBe("hr");
    expect(cat("docs.esign_initiate")).toBe("signature");
    expect(cat("records.purge")).toBe("deletion");
    expect(cat("users.assign_role")).toBe("access_grant");
    expect(cat("requests.approve")).toBe("approval");
    expect(cat("notes.summarise")).toBeNull();
    // Product additions only add.
    expect(cat("comms.send_reminder", "UDF")).toBe("collections");
    expect(cat("comms.send_reminder", "LD")).toBeNull();
  });

  it("fuzz: every locked word survives prefixes, suffixes and casing", () => {
    for (const rule of KERNEL_LOCKED_LIST)
      for (const w of rule.words)
        for (const name of [`x.${w}`, `x.${w}_now`, `svc.do_${w}`, `X.${w.toUpperCase()}`])
          expect(lockedCategory(name)).not.toBeNull();
  });
});

describe("product ceilings (IPB-03 §03.4.11; O-4)", () => {
  it("Udofin is L1 for borrowers and L2 for staff; no product reaches L4", () => {
    expect(productCeiling("UDF", "borrower", "udf.product_explainer")).toBe("L1");
    expect(productCeiling("UDF", "staff", "udf.application_helper")).toBe("L2");
    expect(productCeiling("EQ", "staff", "eq.scheduling_proposals")).toBe("L3");
    expect(productCeiling("EQ", "staff", "eq.case_summary")).toBe("L2");
    expect(productCeiling("FBX", "staff", "fbx.application_data_check")).toBe("L3");
    expect(productCeiling("FBX", "staff", "fbx.kfs_explainer")).toBe("L2");
    expect(productCeiling("PLATFORM", "any", "platform.x")).toBe("L2");
    for (const p of ["LD", "LDC", "EQ", "FBX", "UDF", "OH", "PLATFORM"] as const)
      expect(productCeiling(p, "staff", "x.draft_summary_triage_narrative")).not.toBe("L4");
  });
});

describe("skill manifests (IPB-03-61)", () => {
  it("an invalid manifest is disabled with IPB-VID-001; the others load", () => {
    const issues: string[] = [];
    const r = new SkillRegistry().load(
      [
        manifest(),
        manifest({ key: "oh.broken", autonomy_ceiling: "L9" }),
        manifest({ key: "ld.wrong_prefix" }),
      ],
      { onInvalid: (i) => issues.push(`${i.key}:${i.code}`) },
    );
    expect(r.keys()).toEqual(["oh.vendor_payment_prepare"]);
    expect(issues).toEqual(["oh.broken:IPB-VID-001", "ld.wrong_prefix:IPB-VID-001"]);
  });

  it("a locked tool's ceiling is L2 whatever the skill declares; a read is not locked", () => {
    const s = new SkillRegistry().load([manifest()]).get("oh.vendor_payment_prepare")!;
    expect(s.tools.get("payments.release")).toMatchObject({
      ceiling: "L2",
      locked: { category: "payments" },
    });
    expect(s.tools.get("vendors.lookup")).toMatchObject({ ceiling: "L4", locked: null });
    const reads = new SkillRegistry()
      .load([
        manifest({
          tools: [{ name: "payments.list", kind: "service", write: false, locked: false }],
        }),
      ])
      .get("oh.vendor_payment_prepare")!;
    expect(reads.tools.get("payments.list")!.locked).toBeNull();
  });

  it("references are checked when the registry can see them", () => {
    const r = new SkillRegistry().load([manifest()], { promptExists: () => false });
    expect(r.keys()).toEqual([]);
    expect(r.issues[0]!.reason).toMatch(/not in the registry/);
  });
});

describe("disclosure (IPB-03-53, 03-58)", () => {
  it("labels with the display name, or Vidhi AI", () => {
    const date = new Date("2026-10-27T05:00:00Z");
    expect(assistantName("Astra")).toBe("Astra, an AI assistant");
    expect(assistantName(null)).toBe("Vidhi, an AI assistant");
    expect(labelDate(date)).toBe("27 Oct 2026");
    expect(aiLabel({ date, modelFamily: "Claude (AWS Bedrock, Mumbai)" })).toBe(
      "Drafted by Vidhi AI on 27 Oct 2026 using Claude (AWS Bedrock, Mumbai); reviewed by: not yet reviewed",
    );
    expect(aiLabel({ displayName: "Astra", date, modelFamily: "Gemini", reviewer: "A. Rao" })).toBe(
      "Drafted by Astra, an AI assistant, on 27 Oct 2026 using Gemini; reviewed by: A. Rao",
    );
    expect(modelFamily("bedrock_claude_in/x")).toMatch(/Claude/);
  });

  it("recognises questions that ask for advice on the user's own matter", () => {
    expect(asksForAdvice("Should I sign this agreement?")).toBe(true);
    expect(asksForAdvice("Kya mujhe yeh loan lena chahiye?")).toBe(true);
    expect(asksForAdvice("What is the interest rate?")).toBe(false);
  });
});

describe("manifest lint: every tool declares locked (OWNER-QUESTIONS #37)", () => {
  it("fails a tool without locked, notes a false that the kernel list overrides", () => {
    const missing = manifest({
      tools: [{ name: "drafts.save_note", kind: "service", write: true }],
    });
    const f = lintManifest(missing, "skill.manifest.json");
    expect(f.filter((x) => x.severity === "error").map((x) => x.message)).toEqual(
      expect.arrayContaining([expect.stringMatching(/drafts\.save_note must declare locked/)]),
    );
    expect(new SkillRegistry().load([missing]).keys()).toEqual([]);
    const notes = lintManifest(manifest(), "skill.manifest.json");
    expect(notes.filter((x) => x.severity === "error")).toEqual([]);
    expect(notes).toEqual([
      expect.objectContaining({
        severity: "note",
        message: expect.stringMatching(/payments\.release .* locks it \(payments\)/),
      }),
    ]);
  });

  it("locked: false never unlocks a tool the kernel list matches; locked: true always locks", () => {
    const s = new SkillRegistry()
      .load([
        manifest({
          tools: [
            { name: "payments.release", kind: "service", write: true, locked: false },
            { name: "drafts.save_note", kind: "service", write: true, locked: true },
          ],
        }),
      ])
      .get("oh.vendor_payment_prepare")!;
    expect(s.tools.get("payments.release")!.locked).toMatchObject({ category: "payments" });
    expect(s.tools.get("drafts.save_note")).toMatchObject({ ceiling: "L2" });
    expect(s.tools.get("drafts.save_note")!.locked).not.toBeNull();
  });
});
