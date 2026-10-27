// Scheduled tasks and missions on PostgreSQL with every platform migration applied (PL4 plan §8.5,
// §8.6; session 7). The mission planner is a stub (its prompt is graded by `ai-eval-gate`); tool
// handlers are local. No provider is called (O-6).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import { evaluateCel } from "@infrabyx/connectors/rules";
import { KillSwitches, type SettingsReader } from "@infrabyx/ai";
import { platformSeedModule, runSeed } from "@infrabyx/seed";
import { localTenantKeyId, newId } from "@infrabyx/crypto";
import { ApprovalsEngine, FieldCrypto, PgOutbox } from "@infrabyx/tenancy";
import {
  agentContext,
  fakeKms,
  startPostgres,
  withTenant,
  type TestDatabase,
} from "@infrabyx/testing";
import { Autonomy } from "../autonomy.js";
import { MissionError, Missions, type StepRunner } from "../missions.js";
import { ScheduleError, Scheduler, type ScheduleNotify } from "../schedules.js";
import { SkillRegistry } from "../skills.js";
import { TaskRuntime } from "../tasks.js";

let db: TestDatabase;
let runtime: TaskRuntime;
let scheduler: Scheduler;
let missions: Missions;
let planned: string[] = [];
const values = new Map<string, unknown>();
const settings: SettingsReader = {
  async get(_ctx, key) {
    if (values.has(key)) return values.get(key);
    if (key === "ai.enabled") return true;
    if (key.startsWith("ai.kill.")) return false;
    return null;
  },
};
const TENANT = "tnt_demo";
const OWNER = newId("usr");
const owner = withTenant(TENANT, ["ORG_ADMIN"], { principal: { id: OWNER } });
const checker = withTenant(TENANT, ["ORG_CHECKER"], { principal: { id: "usr_checker1" } });
const agent = agentContext(TENANT);
const notices: { class: string; to: string; key: string }[] = [];
const notify: ScheduleNotify = {
  async enqueue(_tx, n) {
    notices.push({ class: n.class, to: n.to[0]!.ref, key: n.idempotencyKey });
  },
};

const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string; name?: string }) => e.code ?? e.name ?? String(e),
  );
const manifest = (key: string, ceiling: string, tools: unknown[], sched = true) => ({
  key,
  product: "OH",
  display_name: { en: key },
  description: `test skill ${key}`,
  inputs: { type: "object" },
  outputs: { type: "object" },
  tools,
  data_class_max: "INTERNAL",
  autonomy_ceiling: ceiling,
  prompt_key: "vidhi.persona",
  eval_set_ref: "evals/vidhi.persona",
  owner_role: "ORG_ADMIN",
  surfaces: ["panel"],
  sched_allowed: sched,
});
const at = (iso: string) => new Date(iso);
const scheduleRow = async (id: string) =>
  (
    await db.admin.query<{
      state: string;
      consecutive_skips: number;
      next_run_at: Date | null;
      paused_code: string | null;
    }>(
      "select state, consecutive_skips, next_run_at, paused_code from vidhi.schedule where id = $1",
      [id],
    )
  ).rows[0]!;
const taskRow = async (id: string) =>
  (
    await db.admin.query<{ state: string; level: string; schedule_id: string | null }>(
      "select state, level, schedule_id from vidhi.task where id = $1",
      [id],
    )
  ).rows[0]!;

beforeAll(async () => {
  db = await startPostgres();
  await runSeed({
    kernel: db.kernel,
    audit: db.audit,
    env: { APP_ENV: "test", SEED_ENABLED: true },
    product: "OH",
    profile: "demo",
    modules: [platformSeedModule],
    randomSeed: 20261027,
    runDate: new Date("2026-10-01T00:00:00Z"),
  } as never);
  // The schedule owner: an active member holding ORG_ADMIN.
  await db.admin.query("insert into tenancy.user (id, idp_subject) values ($1, $2)", [
    OWNER,
    `kc|${OWNER}`,
  ]);
  await db.admin.query(
    "insert into tenancy.membership (tenant_id, user_id, roles) values ($1, $2, $3)",
    [TENANT, OWNER, ["ORG_ADMIN"]],
  );
  const approvals = new ApprovalsEngine({
    kernel: db.kernel,
    audit: db.audit,
    product: "OH",
    fieldCrypto: new FieldCrypto({ kms: fakeKms(), keyIdFor: localTenantKeyId }),
  });
  const skills = new SkillRegistry().load([
    manifest("oh.ticket_digest", "L3", [
      { name: "tickets.list", kind: "service", write: false, locked: false },
    ]),
    manifest(
      "oh.ticket_triage",
      "L3",
      [{ name: "tickets.set_priority", kind: "service", write: true, locked: false }],
      false,
    ),
    manifest(
      "oh.reply_draft",
      "L2",
      [{ name: "replies.preview", kind: "service", write: false, locked: false }],
      false,
    ),
  ]);
  expect(skills.issues).toEqual([]);
  const kill = new KillSwitches(settings, { cacheSeconds: 0 });
  const outbox = new PgOutbox();
  const autonomy = new Autonomy({
    kernel: db.kernel,
    audit: db.audit,
    product: "OH",
    skills,
    settings,
    approvals,
    outbox,
  });
  runtime = new TaskRuntime({
    kernel: db.kernel,
    audit: db.audit,
    product: "OH",
    skills,
    autonomy,
    approvals,
    kill,
    outbox,
    tools: {
      "tickets.list": async () => ({ n: 3 }),
      "tickets.set_priority": async () => ({ ok: true }),
      "replies.preview": async () => ({ ok: true }),
    },
  });
  scheduler = new Scheduler({
    kernel: db.kernel,
    audit: db.audit,
    product: "OH",
    skills,
    autonomy,
    runtime,
    settings,
    kill,
    notify,
    outbox,
    cel: { evaluateCel: async (expr, input) => evaluateCel(expr, input) },
  });
  missions = new Missions({
    kernel: db.kernel,
    audit: db.audit,
    product: "OH",
    skills,
    runtime,
    gateway: {
      structured: async () =>
        ({
          runId: newId("run"),
          data: { steps: planned.map((k) => ({ skill_key: k })) },
          usage: { inputTokens: 40, outputTokens: 10, cachedTokens: 0 },
          cost: null,
          blocked: false,
        }) as never,
    },
  });
});
afterAll(async () => {
  await db?.end();
});
beforeEach(() => {
  values.clear();
  notices.length = 0;
});

const DAILY_9AM = "DTSTART;TZID=Asia/Kolkata:20261102T090000\nRRULE:FREQ=DAILY";

describe("@IPB-03-AT-03 scheduled runs re-check the owner's permissions", () => {
  it("runs once per occurrence; a demoted owner's runs are skipped, then the schedule pauses", async () => {
    const { scheduleId, nextRunAt } = await scheduler.create(owner, {
      skillKey: "oh.ticket_digest",
      recurrence: DAILY_9AM,
      now: at("2026-11-01T00:00:00Z"),
    });
    expect(nextRunAt?.toISOString()).toBe("2026-11-02T03:30:00.000Z");

    // Due: the poller finds it across tenants and starts a task for the owner.
    const [first] = await scheduler.tick(at("2026-11-02T03:31:00Z"));
    expect(first).toMatchObject({ outcome: "started" });
    const task = await taskRow((first as { taskId: string }).taskId);
    expect(task).toMatchObject({ state: "RUNNING", schedule_id: scheduleId });
    expect(["L0", "L1", "L2"]).toContain(task.level); // IPB-03-67: never above L2 here
    expect((await scheduleRow(scheduleId)).next_run_at?.toISOString()).toBe(
      "2026-11-03T03:30:00.000Z",
    );
    // Nothing more is due at the same time, and the same occurrence never runs twice.
    expect(await scheduler.tick(at("2026-11-02T03:31:00Z"))).toEqual([]);
    expect(await scheduler.runOccurrence(TENANT, scheduleId, "2026-11-02T03:30:00.000Z")).toEqual({
      outcome: "duplicate",
    });
    // The poller's cross-tenant read is in the tenant's ledger.
    const reads = await db.admin.query(
      "select 1 from audit.ledger where tenant_id = $1 and action = 'platform.service_read' and resource_id = 'vidhi.schedule'",
      [TENANT],
    );
    expect(reads.rowCount).toBeGreaterThanOrEqual(1);

    // The owner loses ORG_ADMIN before the next run.
    await db.admin.query(
      "update tenancy.membership set roles = '{ORG_MEMBER}' where tenant_id = $1 and user_id = $2",
      [TENANT, OWNER],
    );
    const skipped = await scheduler.tick(at("2026-11-03T03:31:00Z"));
    expect(skipped).toEqual([
      { outcome: "skipped", code: "IPB-VID-020", reason: "owner_role_removed" },
    ]);
    expect(notices).toEqual([
      expect.objectContaining({ class: "vidhi.schedule.skipped", to: OWNER }),
    ]);
    expect(await scheduleRow(scheduleId)).toMatchObject({ state: "ACTIVE", consecutive_skips: 1 });
    const ev = await db.admin.query<{ data: Record<string, unknown> }>(
      "select envelope->'data' as data from vidhi.outbox where type like '%.ScheduleRunSkipped.%'",
    );
    expect(ev.rows.at(-1)?.data).toMatchObject({
      schedule_id: scheduleId,
      code: "IPB-VID-020",
      reason: "owner_role_removed",
      consecutive_skips: 1,
    });

    await scheduler.tick(at("2026-11-04T03:31:00Z"));
    const third = await scheduler.tick(at("2026-11-05T03:31:00Z"));
    expect(third).toEqual([
      { outcome: "skipped", code: "IPB-VID-021", reason: "owner_role_removed" },
    ]);
    expect(await scheduleRow(scheduleId)).toMatchObject({
      state: "PAUSED",
      consecutive_skips: 3,
      paused_code: "IPB-VID-021",
    });
    expect(notices.map((n) => n.class)).toEqual([
      "vidhi.schedule.skipped",
      "vidhi.schedule.skipped",
      "vidhi.schedule.skipped",
      "vidhi.schedule.paused",
    ]);
    // Paused: nothing runs.
    expect(await scheduler.tick(at("2026-11-06T03:31:00Z"))).toEqual([]);
    const runs = await db.admin.query<{ outcome: string }>(
      "select outcome from vidhi.schedule_run where schedule_id = $1 order by id",
      [scheduleId],
    );
    expect(runs.rows.map((r) => r.outcome)).toEqual(["started", "skipped", "skipped", "skipped"]);

    // The role comes back and the owner resumes: the next run goes ahead.
    await db.admin.query(
      "update tenancy.membership set roles = '{ORG_ADMIN}' where tenant_id = $1 and user_id = $2",
      [TENANT, OWNER],
    );
    await scheduler.resume(owner, scheduleId, at("2026-11-06T04:00:00Z"));
    const [again] = await scheduler.tick(at("2026-11-07T03:31:00Z"));
    expect(again).toMatchObject({ outcome: "started" });
  });

  it("a kill switch and a turned-off scheduling setting skip the run", async () => {
    const { scheduleId } = await scheduler.create(owner, {
      skillKey: "oh.ticket_digest",
      recurrence: "DTSTART;TZID=Asia/Kolkata:20261110T090000\nRRULE:FREQ=WEEKLY",
      now: at("2026-11-01T00:00:00Z"),
    });
    values.set("ai.kill.feature.oh_ticket_digest", true);
    expect(await scheduler.runOccurrence(TENANT, scheduleId, "k1")).toMatchObject({
      outcome: "skipped",
      reason: "kill_switch",
    });
    values.clear();
    values.set("vidhi.sched.enabled", false);
    expect(await scheduler.runOccurrence(TENANT, scheduleId, "k2")).toMatchObject({
      outcome: "skipped",
      reason: "scheduling_disabled",
    });
  });

  it("event triggers run when the CEL condition is true, once per event", async () => {
    const { scheduleId } = await scheduler.create(owner, {
      skillKey: "oh.ticket_digest",
      event: { type: "in.oh.tickets.TicketCreated.v1", condition: 'data.priority == "high"' },
    });
    const type = "in.oh.tickets.TicketCreated.v1";
    expect(await scheduler.onEvent(TENANT, { id: "e1", type, data: { priority: "low" } })).toEqual(
      [],
    );
    const [hit] = await scheduler.onEvent(TENANT, { id: "e2", type, data: { priority: "high" } });
    expect(hit).toMatchObject({ outcome: "started" });
    expect(await scheduler.onEvent(TENANT, { id: "e2", type, data: { priority: "high" } })).toEqual(
      [{ outcome: "duplicate" }],
    );
    expect(await scheduleRow(scheduleId)).toMatchObject({ state: "ACTIVE" });
  });

  it("refuses agents, unschedulable skills, unsupported rules and bad conditions at save", async () => {
    expect(
      await code(scheduler.create(agent, { skillKey: "oh.ticket_digest", recurrence: DAILY_9AM })),
    ).toBe("IPB-VID-012");
    expect(
      await code(scheduler.create(owner, { skillKey: "oh.ticket_triage", recurrence: DAILY_9AM })),
    ).toBe("ScheduleError");
    const e = await scheduler
      .create(owner, {
        skillKey: "oh.ticket_digest",
        recurrence: "DTSTART;TZID=Asia/Kolkata:20261102T090000\nRRULE:FREQ=HOURLY",
      })
      .catch((x: Error) => x);
    expect(e).toBeInstanceOf(ScheduleError);
    expect((e as Error).message).toMatch(/FREQ=HOURLY is not supported/);
    expect(
      await code(
        scheduler.create(owner, {
          skillKey: "oh.ticket_digest",
          event: { type: "in.oh.tickets.TicketCreated.v1", condition: "data.priority ==" },
        }),
      ),
    ).toBe("ScheduleError");
  });
});

describe("missions", () => {
  // The triage step writes at L2, so it waits for a human; the reply step only reads.
  const passes = new Map<string, number>();
  const runner: StepRunner = async (ctx: KernelContext, step) => {
    const n = (passes.get(step.taskId) ?? 0) + 1;
    passes.set(step.taskId, n);
    if (step.skillKey === "oh.ticket_triage" && n === 1) {
      await runtime.callTool(ctx, step.taskId, { tool: "tickets.set_priority", args: { p: 1 } });
      return { tokens: 200, toolCalls: 1 };
    }
    if (step.skillKey === "oh.reply_draft")
      await runtime.callTool(ctx, step.taskId, { tool: "replies.preview", args: {} });
    await runtime.complete(ctx, step.taskId);
    return { tokens: 100, toolCalls: 1 };
  };
  const budget = { tokens: 10_000, costMinor: 1_000, wallClockS: 3_600, toolCalls: 10 };

  it("runs the plan as tasks at the mission's level, halting for the approval and resuming after it", async () => {
    planned = ["oh.ticket_triage", "oh.reply_draft", "oh.not_in_scope"];
    const m = await missions.start(agent, {
      goal: "Sort today's tickets and draft replies to the urgent ones.",
      scope: ["oh.ticket_triage", "oh.reply_draft"],
      budget,
      ownerId: OWNER,
      featureKey: "vidhi.mission",
      dataClass: "INTERNAL",
    });
    expect(m.steps.map((s) => s.skill_key)).toEqual(["oh.ticket_triage", "oh.reply_draft"]);
    const waiting = await missions.advance(agent, m.missionId, runner);
    expect(waiting.state).toBe("WAITING");
    const triageTask = waiting.steps[0]!.task_id!;
    expect(await taskRow(triageTask)).toMatchObject({ state: "NEEDS_APPROVAL", level: "L2" });
    // Waiting for the human: advancing again does nothing.
    expect((await missions.advance(agent, m.missionId, runner)).state).toBe("WAITING");
    await runtime.decide(checker, triageTask, "approve");
    const done = await missions.advance(agent, m.missionId, runner);
    expect(done).toMatchObject({ state: "DONE", stepIndex: 2, code: null });
    expect(done.used).toEqual({ tokens: 450, cost_minor: 0, tool_calls: 3 });
    const level = await db.admin.query<{ level: string }>(
      "select level from vidhi.mission where id = $1",
      [m.missionId],
    );
    expect(level.rows[0]!.level).toBe("L2"); // the lowest ceiling of its skills
  });

  it("stops with IPB-VID-070 when the budget runs out, keeping the finished steps", async () => {
    planned = ["oh.reply_draft", "oh.reply_draft", "oh.reply_draft"];
    const m = await missions.start(agent, {
      goal: "Draft three replies.",
      scope: ["oh.reply_draft"],
      budget: { ...budget, toolCalls: 2 },
      ownerId: OWNER,
      featureKey: "vidhi.mission",
      dataClass: "INTERNAL",
    });
    const r = await missions.advance(agent, m.missionId, runner);
    expect(r).toMatchObject({ state: "STOPPED", code: "IPB-VID-070", stepIndex: 2 });
    expect(await taskRow(r.steps[0]!.task_id!)).toMatchObject({ state: "DONE" });
    expect(r.steps[2]!.task_id).toBeNull();
    // A stopped mission stays stopped.
    expect((await missions.advance(agent, m.missionId, runner)).state).toBe("STOPPED");
  });

  it("a rejected step fails the mission; a plan outside the scope is refused", async () => {
    planned = ["oh.ticket_triage"];
    const m = await missions.start(agent, {
      goal: "Sort the tickets.",
      scope: ["oh.ticket_triage"],
      budget,
      ownerId: OWNER,
      featureKey: "vidhi.mission",
      dataClass: "INTERNAL",
    });
    const w = await missions.advance(agent, m.missionId, runner);
    await runtime.decide(checker, w.steps[0]!.task_id!, "reject");
    expect(await missions.advance(agent, m.missionId, runner)).toMatchObject({
      state: "FAILED",
      code: "rejected",
    });
    planned = ["oh.ticket_digest"];
    expect(
      await code(
        missions.start(agent, {
          goal: "x",
          scope: ["oh.reply_draft"],
          budget,
          ownerId: OWNER,
          featureKey: "vidhi.mission",
          dataClass: "INTERNAL",
        }),
      ),
    ).toBe("MissionError");
    expect(MissionError).toBeDefined();
  });

  it("two workers advancing at once: one runs the step, the other leaves it", async () => {
    planned = ["oh.reply_draft"];
    const m = await missions.start(agent, {
      goal: "Draft a reply.",
      scope: ["oh.reply_draft"],
      budget,
      ownerId: OWNER,
      featureKey: "vidhi.mission",
      dataClass: "INTERNAL",
    });
    let calls = 0;
    const counting: StepRunner = async (ctx, step) => {
      calls++;
      return runner(ctx, step);
    };
    await Promise.all([
      missions.advance(agent, m.missionId, counting),
      missions.advance(agent, m.missionId, counting),
    ]);
    expect(calls).toBe(1);
    const tasks = await db.admin.query("select 1 from vidhi.task where mission_id = $1", [
      m.missionId,
    ]);
    expect(tasks.rowCount).toBe(1);
  });
});
