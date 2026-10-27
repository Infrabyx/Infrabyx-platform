// Vidhi kernel contracts (IPB-03 §03.3.J–K, §03.4.6–§03.4.8; PL4 plan §8): the skill manifest
// schema, autonomy levels, task states and the locked-action categories. The kernel list itself
// (with its matching patterns) is enforced in `@infrabyx/vidhi`; products can only add to it.
import { z } from "zod";

export const AUTONOMY_LEVELS = ["L0", "L1", "L2", "L3", "L4"] as const;
export const AutonomyLevel = z.enum(AUTONOMY_LEVELS);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;
export const autonomyRank = (l: AutonomyLevel): number => AUTONOMY_LEVELS.indexOf(l);
export const minLevel = (...ls: AutonomyLevel[]): AutonomyLevel =>
  ls.reduce((a, b) => (autonomyRank(b) < autonomyRank(a) ? b : a), "L4");

export const VIDHI_PRODUCTS = ["LD", "LDC", "EQ", "FBX", "UDF", "OH", "PLATFORM"] as const;
export type VidhiProduct = (typeof VIDHI_PRODUCTS)[number];

export const VIDHI_SURFACES = [
  "panel",
  "palette",
  "inline",
  "chat",
  "voice",
  "whatsapp",
  "email",
  "mcp",
] as const;

/**
 * IPB-03-71 locked categories, never autonomous at any level in any product, plus the owner's
 * floor (27 Oct 2026): agents never approve, sign, disburse, delete or grant, and never decide
 * credit, pay, hiring or discipline.
 */
export const LOCKED_ACTION_CATEGORIES = [
  "payments",
  "credit_decision",
  "collections",
  "hr",
  "legal_filing",
  "signature",
  "deletion",
  "external_sharing",
  "pricing",
  "approval",
  "access_grant",
] as const;
export type LockedActionCategory = (typeof LOCKED_ACTION_CATEGORIES)[number];

/** Task states (IPB-03-62, §03.4.7). Terminal states never change. */
export const TASK_STATES = [
  "QUEUED",
  "RUNNING",
  "NEEDS_INPUT",
  "NEEDS_APPROVAL",
  "DONE",
  "FAILED",
  "CANCELLED",
] as const;
export type TaskState = (typeof TASK_STATES)[number];
export const TERMINAL_TASK_STATES: readonly TaskState[] = ["DONE", "FAILED", "CANCELLED"];

const JsonSchema = z.record(z.string(), z.unknown());

export const SkillTool = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
    kind: z.enum(["service", "mcp"]),
    write: z.boolean(),
    /**
     * Required on every tool (OWNER-QUESTIONS #37, PL4-D-13): the product states whether the tool
     * is a locked action. `false` never unlocks a tool the kernel list matches by name.
     */
    locked: z.boolean(),
    /** Risk class of the action when it needs approval (IPB-02 §02.4.6.1). */
    risk_class: z.enum(["R0", "R1", "R2", "R3", "R4", "R5"]).optional(),
    /** Role that must approve it (IPB-03-72). */
    required_role: z.string().optional(),
  })
  .strict();
export type SkillTool = z.infer<typeof SkillTool>;

/** `skill.manifest.json` (IPB-03-61, §03.4.6). */
export const SkillManifest = z
  .object({
    key: z.string().regex(/^[a-z]{2,8}\.[a-z0-9_]+$/),
    product: z.enum(VIDHI_PRODUCTS),
    display_name: z.record(z.string(), z.string().min(1)).refine((d) => "en" in d, "needs en"),
    description: z.string().max(500),
    inputs: JsonSchema,
    outputs: JsonSchema,
    tools: z.array(SkillTool),
    data_class_max: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "REGULATED"]),
    autonomy_ceiling: AutonomyLevel,
    locked_actions: z.array(z.string()).default([]),
    prompt_key: z.string().regex(/^[a-z0-9_.-]+$/),
    eval_set_ref: z.string().min(1),
    owner_role: z.string().min(1),
    cost_estimate: z.record(z.string(), z.unknown()).optional(),
    surfaces: z.array(z.enum(VIDHI_SURFACES)).min(1),
    sched_allowed: z.boolean().default(false),
    /** Audience the skill serves; picks the product ceiling (UDF borrower L1, staff L2). */
    audience: z.enum(["staff", "borrower", "customer", "any"]).default("staff"),
  })
  .strict();
export type SkillManifest = z.infer<typeof SkillManifest>;
