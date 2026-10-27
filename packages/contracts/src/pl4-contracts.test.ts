import { describe, expect, it } from "vitest";
import { ERROR_CATALOGUE } from "./error-catalogue.js";
import { RunCompletedData } from "./events/pl4-events.js";
import { AiProvenance, bandOf, LLM_ADAPTER_KEYS } from "./ports/ai.js";
import { PORT_CATALOGUE } from "./ports/catalogue.js";
import { AGENT_FORBIDDEN_VERBS } from "./roles.js";
import {
  LOCKED_ACTION_CATEGORIES,
  minLevel,
  SkillManifest,
  TERMINAL_TASK_STATES,
} from "./vidhi.js";

const manifest = {
  key: "udf.product_explainer",
  product: "UDF",
  display_name: { en: "Product explainer", hi: "उत्पाद व्याख्या" },
  description: "Explains a loan product from its KFS.",
  inputs: { type: "object" },
  outputs: { type: "object" },
  tools: [{ name: "udf.kfs.read", kind: "service", write: false, locked: false }],
  data_class_max: "CONFIDENTIAL",
  autonomy_ceiling: "L1",
  prompt_key: "udf.product_explainer",
  eval_set_ref: "evals/udf.product_explainer",
  owner_role: "ORG_ADMIN",
  surfaces: ["panel", "chat"],
  audience: "borrower",
};

describe("PL4 contracts (PL4 plan §11)", () => {
  it("maps data classes to routing bands (IPB-03 §03.4.5)", () => {
    expect(bandOf("PUBLIC")).toBe("open");
    expect(bandOf("INTERNAL")).toBe("open");
    expect(bandOf("CONFIDENTIAL")).toBe("in_zero");
    expect(bandOf("REGULATED")).toBe("in_zero");
    expect(bandOf("SECRET")).toBe("self");
  });

  it("lists the nine IPB-03-03 adapter keys", () => {
    expect(LLM_ADAPTER_KEYS).toHaveLength(9);
    expect(LLM_ADAPTER_KEYS).toContain("bedrock_claude_in");
    expect(LLM_ADAPTER_KEYS).toContain("gemini_vertex_asia_south1");
  });

  it("validates a skill manifest and refuses an unknown field (IPB-03-61, IPB-VID-001)", () => {
    expect(SkillManifest.parse(manifest).sched_allowed).toBe(false);
    expect(SkillManifest.safeParse({ ...manifest, extra: 1 }).success).toBe(false);
    expect(SkillManifest.safeParse({ ...manifest, autonomy_ceiling: "L5" }).success).toBe(false);
    expect(SkillManifest.safeParse({ ...manifest, data_class_max: "SECRET" }).success).toBe(false);
  });

  it("covers the IPB-03-71 categories and the owner's agent floor", () => {
    for (const c of [
      "payments",
      "credit_decision",
      "hr",
      "signature",
      "deletion",
      "approval",
      "access_grant",
    ])
      expect(LOCKED_ACTION_CATEGORIES).toContain(c);
    expect(AGENT_FORBIDDEN_VERBS).toEqual(["approve", "sign", "disburse", "delete", "grant"]);
    expect(TERMINAL_TASK_STATES).toEqual(["DONE", "FAILED", "CANCELLED"]);
    expect(minLevel("L4", "L2", "L3")).toBe("L2");
  });

  it("registers every IPB-03 §03.6.3 code, with IPB-AI-001 in its IPB-03 meaning", () => {
    for (const c of [
      "IPB-AI-001",
      "IPB-AI-010",
      "IPB-AI-011",
      "IPB-AI-012",
      "IPB-AI-013",
      "IPB-AI-020",
      "IPB-AI-021",
      "IPB-AI-022",
      "IPB-AI-023",
      "IPB-AI-030",
      "IPB-AI-031",
      "IPB-AI-040",
      "IPB-AI-041",
      "IPB-AI-042",
      "IPB-AI-050",
      "IPB-AI-060",
      "IPB-VID-001",
      "IPB-VID-010",
      "IPB-VID-011",
      "IPB-VID-012",
      "IPB-VID-020",
      "IPB-VID-021",
      "IPB-VID-022",
      "IPB-VID-030",
      "IPB-VID-040",
      "IPB-VID-041",
      "IPB-VID-050",
      "IPB-VID-060",
      "IPB-VID-070",
      "IPB-AI-032",
    ])
      expect(ERROR_CATALOGUE).toHaveProperty(c);
    expect(ERROR_CATALOGUE["IPB-AI-001"].status).toBe(503);
  });

  it("marks the five AI port interfaces as defined", () => {
    for (const p of ["LLM", "EMBEDDING", "IMAGE_GEN", "SPEECH", "RERANK"] as const)
      expect(PORT_CATALOGUE[p].interfaceDefined).toBe(true);
  });

  it("keeps content out of event payloads and checks the provenance sidecar", () => {
    expect(
      RunCompletedData.safeParse({
        run_id: "run_01J9Z8Q4V7X2K3M5N6P7Q8R9S0",
        tenant_id: "tnt_demo",
        feature_key: "ld.summarise",
        model_id: "bedrock_claude_in/m",
        data_class: "CONFIDENTIAL",
        usage: { input_tokens: 1, output_tokens: 1, cached_tokens: 0 },
        cost_minor_units: null,
        currency: null,
        guard_flags: [],
        duration_ms: 5,
        prompt: "leak",
      }).success,
    ).toBe(false);
    expect(
      AiProvenance.safeParse({
        generated_by: "vidhi",
        model_id: "bedrock_claude_in/m",
        prompt_ref: "ld.summarise@1.0.0",
        prompt_hash: "a".repeat(64),
        run_id: "run_01J9Z8Q4V7X2K3M5N6P7Q8R9S0",
        created_at: "2026-10-27T10:00:00+05:30",
        c2pa_manifest_ref: null,
      }).success,
    ).toBe(true);
  });
});
