// Internal events of the AI gateway and Vidhi (IPB-03 §03.6.1; PL4 plan §11). Payloads carry ids,
// classes, counts, costs and flags; never a prompt, a completion, tool arguments or retrieved text.
import { z } from "zod";

/** `module` and `name` per IPB-03 §03.6.1; register with `internalEvent({ event: AI_EVENTS.X })`. */
export const AI_EVENTS = {
  RunCompleted: { module: "ai", name: "RunCompleted" },
  RunMetered: { module: "ai", name: "RunMetered" },
  RouteFailedClosed: { module: "ai", name: "RouteFailedClosed" },
  GuardrailTriggered: { module: "ai", name: "GuardrailTriggered" },
  ModelStateChanged: { module: "ai", name: "ModelStateChanged" },
  KillSwitchChanged: { module: "ai", name: "KillSwitchChanged" },
  CostCapReached: { module: "ai", name: "CostCapReached" },
} as const;

export const VIDHI_EVENTS = {
  TaskStateChanged: { module: "vidhi", name: "TaskStateChanged" },
  ApprovalRequested: { module: "vidhi", name: "ApprovalRequested" },
  ActionExecuted: { module: "vidhi", name: "ActionExecuted" },
  LockedActionAttempted: { module: "vidhi", name: "LockedActionAttempted" },
  AutonomyChanged: { module: "vidhi", name: "AutonomyChanged" },
  ScheduleRunSkipped: { module: "vidhi", name: "ScheduleRunSkipped" },
  NotebookOutputCreated: { module: "vidhi", name: "NotebookOutputCreated" },
  FeedbackReceived: { module: "vidhi", name: "FeedbackReceived" },
} as const;

const DataClassName = z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "REGULATED", "SECRET"]);
const Usage = z
  .object({
    input_tokens: z.number().int(),
    output_tokens: z.number().int(),
    cached_tokens: z.number().int(),
  })
  .strict();

export const RunCompletedData = z
  .object({
    run_id: z.string().regex(/^run_/),
    tenant_id: z.string(),
    feature_key: z.string(),
    model_id: z.string(),
    data_class: DataClassName,
    usage: Usage,
    cost_minor_units: z.number().int().nullable(),
    currency: z.string().length(3).nullable(),
    guard_flags: z.array(z.string()),
    duration_ms: z.number().int().nonnegative(),
  })
  .strict();

export const RunMeteredData = z
  .object({
    run_id: z.string().regex(/^run_/),
    tenant_id: z.string(),
    feature_key: z.string(),
    cost_minor_units: z.number().int().nullable(),
    currency: z.string().length(3).nullable(),
    tokens: Usage,
  })
  .strict();

export const RouteFailedClosedData = z
  .object({
    tenant_id: z.string(),
    feature_key: z.string(),
    data_class: DataClassName,
    candidates_considered: z.array(z.object({ model_id: z.string(), reason: z.string() }).strict()),
  })
  .strict();

export const GuardrailTriggeredData = z
  .object({
    run_id: z.string().regex(/^run_/),
    kind: z.enum(["injection", "leak", "reserved_advice", "tool_disallowed", "schema", "citation"]),
    action: z.enum(["redact", "refuse", "halt", "neutralise"]),
  })
  .strict();

export const ModelStateChangedData = z
  .object({
    model_id: z.string(),
    from: z.string(),
    to: z.string(),
    actor: z.string(),
    reason: z.string().nullable(),
  })
  .strict();

export const AiKillSwitchChangedData = z
  .object({
    scope: z.enum(["platform", "tenant"]),
    key: z.string(),
    value: z.boolean(),
    actor: z.string(),
  })
  .strict();

export const CostCapReachedData = z
  .object({
    tenant_id: z.string(),
    scope: z.string(),
    cap: z.number(),
    used: z.number(),
    level: z.enum(["warning", "blocked"]),
  })
  .strict();

const Level = z.enum(["L0", "L1", "L2", "L3", "L4"]);

/** `in.<p>.vidhi.TaskStateChanged.v1` (IPB-03 §03.6.1). */
export const TaskStateChangedData = z
  .object({
    task_id: z.string().regex(/^tsk_/),
    tenant_id: z.string(),
    skill_key: z.string(),
    from: z.string(),
    to: z.string(),
  })
  .strict();

/** `in.<p>.vidhi.ApprovalRequested.v1`: a task waits for a human. No tool arguments. */
export const VidhiApprovalRequestedData = z
  .object({
    task_id: z.string().regex(/^tsk_/),
    approval_id: z.string(),
    tool: z.string(),
    required_role: z.string(),
    risk_class: z.enum(["R2", "R3", "R4", "R5"]),
    locked_category: z.string().nullable(),
  })
  .strict();

/** `in.<p>.vidhi.ActionExecuted.v1`. */
export const ActionExecutedData = z
  .object({
    task_id: z.string().regex(/^tsk_/),
    tool: z.string(),
    level: Level,
    approval_id: z.string().nullable(),
  })
  .strict();

/** `in.<p>.vidhi.LockedActionAttempted.v1`: an agent tried a locked action without approval. */
export const LockedActionAttemptedData = z
  .object({
    task_id: z.string().regex(/^tsk_/),
    tenant_id: z.string(),
    skill_key: z.string(),
    tool: z.string(),
    category: z.string(),
    agent_id: z.string(),
  })
  .strict();

/** `in.<p>.vidhi.AutonomyChanged.v1`. */
export const AutonomyChangedData = z
  .object({
    tenant_id: z.string(),
    skill_key: z.string(),
    from: Level,
    to: Level,
    reason: z.enum([
      "promotion",
      "demotion_locked",
      "demotion_guardrail",
      "demotion_rate",
      "grant_revoked",
    ]),
  })
  .strict();
