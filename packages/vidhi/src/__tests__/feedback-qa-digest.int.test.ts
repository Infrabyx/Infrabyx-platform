// Feedback, QA sampling and the daily digest on PostgreSQL with every platform migration applied
// (PL4 plan §8.9; session 8). No provider is called.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { KillSwitches, usageSummary, type SettingsReader } from "@infrabyx/ai";
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
import { Digest, dayWindow } from "../digest.js";
import { Feedback } from "../feedback.js";
import { QaSampler, sampleDraw } from "../qa.js";
import type { ScheduleNotify } from "../schedules.js";
import { SkillRegistry } from "../skills.js";
import { TaskRuntime } from "../tasks.js";

let db: TestDatabase;
let runtime: TaskRuntime;
let autonomy: Autonomy;
let feedback: Feedback;
let qa: QaSampler;
let digest: Digest;
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
const agent = agentContext(TENANT);
const owner = withTenant(TENANT, ["ORG_MEMBER"], { principal: { id: "usr_owner8" } });
const lead = withTenant(TENANT, ["OH_SUPPORT_LEAD"], { principal: { id: "usr_lead" } });
const admin = withTenant(TENANT, ["ORG_ADMIN"], { principal: { id: "usr_admin8" } });
const checker = withTenant(TENANT, ["ORG_CHECKER"], { principal: { id: "usr_checker8" } });
const notices: { class: string; to: string }[] = [];
const notify: ScheduleNotify = {
  async enqueue(_tx, n) {
    notices.push({ class: n.class, to: n.to[0]!.ref });
  },
};
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string; reason?: string }) => e.code ?? e.reason ?? String(e),
  );

async function doneTask(skillKey = "oh.reply_draft"): Promise<string> {
  const { taskId } = await runtime.create(agent, { skillKey, ownerId: "usr_owner8" });
  await runtime.start(agent, taskId);
  await runtime.callTool(agent, taskId, { tool: "replies.preview", args: {} });
  await runtime.complete(agent, taskId);
  return taskId;
}

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
  const fieldCrypto = new FieldCrypto({ kms: fakeKms(), keyIdFor: localTenantKeyId });
  const approvals = new ApprovalsEngine({
    kernel: db.kernel,
    audit: db.audit,
    product: "OH",
    fieldCrypto,
  });
  const skills = new SkillRegistry().load([
    {
      key: "oh.reply_draft",
      product: "OH",
      display_name: { en: "Reply draft" },
      description: "Draft replies to tickets.",
      inputs: { type: "object" },
      outputs: { type: "object" },
      tools: [
        { name: "replies.preview", kind: "service", write: false },
        { name: "replies.send", kind: "service", write: true },
      ],
      data_class_max: "INTERNAL",
      autonomy_ceiling: "L3",
      prompt_key: "vidhi.persona",
      eval_set_ref: "evals/vidhi.persona",
      owner_role: "OH_SUPPORT_LEAD",
      surfaces: ["panel"],
    },
  ]);
  const kill = new KillSwitches(settings, { cacheSeconds: 0 });
  autonomy = new Autonomy({
    kernel: db.kernel,
    audit: db.audit,
    product: "OH",
    skills,
    settings,
    approvals,
    outbox: new PgOutbox(),
  });
  runtime = new TaskRuntime({
    kernel: db.kernel,
    audit: db.audit,
    product: "OH",
    skills,
    autonomy,
    approvals,
    kill,
    outbox: new PgOutbox(),
    tools: {
      "replies.preview": async () => ({ ok: true }),
      "replies.send": async () => ({ ok: true }),
    },
  });
  feedback = new Feedback({
    kernel: db.kernel,
    audit: db.audit,
    product: "OH",
    sealer: fieldCrypto,
    skills,
    settings,
    outbox: new PgOutbox(),
  });
  qa = new QaSampler({
    kernel: db.kernel,
    audit: db.audit,
    skills,
    autonomy,
    settings,
    floor: { precision: 0.8, recall: 0.8, minReviews: 4 },
  });
  digest = new Digest({
    kernel: db.kernel,
    audit: db.audit,
    notify,
    usage: (ctx, o) => usageSummary(db.kernel, ctx, o),
  });
});
afterAll(async () => {
  await db?.end();
});
beforeEach(() => {
  values.clear();
  notices.length = 0;
});

describe("feedback (IPB-03-84)", () => {
  it("stores thumbs and corrections; a reference correction joins the tenant's eval set for the skill owner", async () => {
    const runA = newId("run");
    const runB = newId("run");
    await feedback.record(owner, { runId: runA, rating: "up", skillKey: "oh.reply_draft" });
    const { feedbackId } = await feedback.record(owner, {
      runId: runB,
      rating: "down",
      reason: "incomplete",
      correction: "Dear customer, your refund was sent on 2 November.",
      useAsReference: true,
      skillKey: "oh.reply_draft",
    });
    expect(
      await code(feedback.record(owner, { runId: runB, rating: "up", skillKey: "oh.reply_draft" })),
    ).toBe("duplicate");
    expect(await code(feedback.record(agent, { runId: newId("run"), rating: "up" }))).toBe(
      "IPB-VID-012",
    );
    const set = await feedback.referenceSet(lead, "oh.reply_draft");
    expect(set).toEqual([
      expect.objectContaining({
        feedbackId,
        runId: runB,
        expected: "Dear customer, your refund was sent on 2 November.",
      }),
    ]);
    expect(await code(feedback.referenceSet(owner, "oh.reply_draft"))).toBe("forbidden");
    const raw = await db.admin.query<{ t: string }>(
      "select encode(correction_enc, 'escape') as t from vidhi.feedback where id = $1",
      [feedbackId],
    );
    expect(raw.rows[0]!.t).not.toContain("refund");
    const ev = await db.admin.query<{ data: Record<string, unknown> }>(
      "select envelope->'data' as data from vidhi.outbox where type like '%.FeedbackReceived.%' order by created_at",
    );
    expect(ev.rows.at(-1)?.data).toMatchObject({
      feedback_id: feedbackId,
      rating: "down",
      has_correction: true,
      use_as_reference: true,
    });
    values.set("vidhi.feedback.enabled", false);
    expect(await code(feedback.record(owner, { runId: newId("run"), rating: "up" }))).toBe(
      "disabled",
    );
  });
});

describe("QA sampling (IPB-03-85)", () => {
  it("samples new skills at 10 % deterministically, once per task", async () => {
    const tasks: string[] = [];
    for (let i = 0; i < 30; i++) tasks.push(await doneTask());
    const results: { sampled: boolean; rate: number }[] = [];
    for (const t of tasks) results.push(await qa.maybeSample(owner, t));
    expect(results.every((r) => r.rate === 0.1)).toBe(true);
    const expected = tasks.filter((t) => sampleDraw(t) < 0.1);
    const sampled = tasks.filter((_, i) => results[i]!.sampled);
    expect(sampled).toEqual(expected);
    // Asking again adds nothing.
    for (const t of tasks) await qa.maybeSample(owner, t);
    const n = await db.admin.query<{ n: string }>(
      "select count(*) as n from vidhi.qa_sample where skill_key = 'oh.reply_draft'",
    );
    expect(Number(n.rows[0]!.n)).toBe(expected.length);
  });

  it("the owner's reviews give precision and recall; below the floor the skill drops one level", async () => {
    await db.admin.query(
      "insert into vidhi.skill_state (tenant_id, skill_key, operating_level, evidence_since) values ($1, 'oh.reply_draft', 'L3', now()) on conflict (tenant_id, skill_key) do update set operating_level = 'L3', evidence_since = now()",
      [TENANT],
    );
    const tasks: string[] = [];
    for (let i = 0; i < 4; i++) {
      const t = await doneTask();
      // Queue it directly (the draw decides sampling; here the review flow is under test).
      await db.admin.query(
        "insert into vidhi.qa_sample (tenant_id, skill_key, task_id, rate) values ($1, 'oh.reply_draft', $2, 0.1) on conflict do nothing",
        [TENANT, t],
      );
      tasks.push(t);
    }
    expect(await code(qa.review(owner, tasks[0]!, "correct"))).toBe("IPB-VID-012");
    expect(await code(qa.review(agent, tasks[0]!, "correct"))).toBe("IPB-VID-012");
    await qa.review(lead, tasks[0]!, "correct");
    await qa.review(lead, tasks[1]!, "correct");
    await qa.review(lead, tasks[2]!, "incorrect");
    const last = await qa.review(lead, tasks[3]!, "missed");
    expect(last.metrics).toMatchObject({ reviewed: 4, correct: 2, incorrect: 1, missed: 1 });
    expect(last.metrics.precision).toBeCloseTo(2 / 3);
    expect(last.demoted).toBe(true);
    const level = await db.admin.query<{ operating_level: string }>(
      "select operating_level from vidhi.skill_state where tenant_id = $1 and skill_key = 'oh.reply_draft'",
      [TENANT],
    );
    expect(level.rows[0]!.operating_level).toBe("L2");
    // The window restarts after the demotion.
    expect((await qa.metrics(lead, "oh.reply_draft")).reviewed).toBe(0);
    expect(await code(qa.review(lead, tasks[3]!, "correct"))).toBe("IPB-VID-022");
  });
});

describe("digest and action log (IPB-03-83)", () => {
  it("counts the day's tasks, actions, approvals, usage and anomalies; sends once per day", async () => {
    // A write at L2 waits for approval.
    const { taskId } = await runtime.create(agent, {
      skillKey: "oh.reply_draft",
      ownerId: "usr_owner8",
    });
    await runtime.start(agent, taskId);
    await runtime.callTool(agent, taskId, { tool: "replies.send", args: {} });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const mine = await digest.send(owner, { recipientId: "usr_owner8", scope: "user", day: today });
    expect(mine.sent).toBe(true);
    expect(mine.summary.tasks.total).toBeGreaterThanOrEqual(30);
    expect(mine.summary.tasks.byState.DONE).toBeGreaterThanOrEqual(30);
    expect(mine.summary.actionsExecuted).toBeGreaterThanOrEqual(30);
    expect(mine.summary.approvalsPending).toBeGreaterThanOrEqual(1);
    expect(mine.summary.usage).toMatchObject({ runs: 0 });
    expect(notices).toEqual([{ class: "vidhi.digest", to: "usr_owner8" }]);
    const again = await digest.send(owner, {
      recipientId: "usr_owner8",
      scope: "user",
      day: today,
    });
    expect(again.sent).toBe(false);
    expect(notices).toHaveLength(1);
    expect(
      await code(digest.build(owner, { recipientId: "usr_admin8", scope: "tenant", day: today })),
    ).toBe("IPB-VID-012");
    const tenant = await digest.build(admin, {
      recipientId: "usr_admin8",
      scope: "tenant",
      day: today,
    });
    expect(tenant.anomalies.demotions).toBeGreaterThanOrEqual(1);
    // The action log: a person sees their own tasks; filters narrow it.
    const { from, to } = dayWindow(today, "Asia/Kolkata");
    const log = await digest.actionLog(owner, { from, to, tool: "replies.send" });
    expect(log).toEqual([
      expect.objectContaining({
        taskId,
        tool: "replies.send",
        outcome: "needs_approval",
        ownerId: "usr_owner8",
      }),
    ]);
    expect(await digest.actionLog(checker, { from, to })).toEqual([]);
    expect((await digest.actionLog(admin, { from, to, limit: 5 })).length).toBe(5);
  });
});
