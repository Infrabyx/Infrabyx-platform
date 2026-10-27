// The Vidhi kernel on PostgreSQL with every platform migration applied (PL4 plan §8, session 6).
// Model calls go to FakeLlm; tool handlers are local counters. No provider is called (O-6).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import {
  KillSwitches,
  LlmGateway,
  loadPromptFiles,
  ModelRegistry,
  PromptRegistry,
  syncPrompts,
  type SettingsReader,
} from "@infrabyx/ai";
import { platformSeedModule, runSeed } from "@infrabyx/seed";
import { localTenantKeyId } from "@infrabyx/crypto";
import { ApprovalsEngine, FieldCrypto, PgOutbox } from "@infrabyx/tenancy";
import {
  agentContext,
  FakeLlm,
  fakeKms,
  platformContext,
  startPostgres,
  withTenant,
  type TestDatabase,
} from "@infrabyx/testing";
import { Autonomy } from "../autonomy.js";
import { disclosure, Vidhi } from "../persona.js";
import { SkillRegistry } from "../skills.js";
import { TaskRuntime } from "../tasks.js";

let db: TestDatabase;
let approvals: ApprovalsEngine;
let runtime: TaskRuntime;
let autonomy: Autonomy;
let vidhi: Vidhi;
const values = new Map<string, unknown>();
const settings: SettingsReader = {
  async get(_ctx, key) {
    if (values.has(key)) return values.get(key);
    if (key === "ai.enabled") return true;
    if (key === "ai.cost.tenant_daily_token_cap") return 5_000_000;
    if (key.startsWith("ai.kill.")) return false;
    return null;
  },
};
const TENANT = "tnt_demo";
const agent = agentContext(TENANT);
const owner = withTenant(TENANT, ["ORG_OWNER"], { principal: { id: "usr_owner" } });
const owner2 = withTenant(TENANT, ["ORG_OWNER"], { principal: { id: "usr_owner2" } });
const checker1 = withTenant(TENANT, ["ORG_CHECKER"], { principal: { id: "usr_checker1" } });
const checker2 = withTenant(TENANT, ["ORG_CHECKER"], { principal: { id: "usr_checker2" } });
const member = withTenant(TENANT, ["ORG_MEMBER"], { principal: { id: "usr_member" } });
const released: string[] = [];
const llm = new FakeLlm({
  adapterKey: "bedrock_claude_in",
  aiResidency: "IN",
  region: "ap-south-1",
});

const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string }) => e.code ?? String(e),
  );
const skillManifest = (key: string, ceiling: string, tools: unknown[]) => ({
  key,
  product: "OH",
  display_name: { en: key },
  description: "test skill",
  inputs: { type: "object" },
  outputs: { type: "object" },
  tools,
  data_class_max: "CONFIDENTIAL",
  autonomy_ceiling: ceiling,
  prompt_key: "vidhi.persona",
  eval_set_ref: "evals/vidhi.persona",
  owner_role: "ORG_ADMIN",
  surfaces: ["panel"],
});
const events = async (name: string) =>
  (
    await db.admin.query<{ data: Record<string, unknown> }>(
      `select envelope->'data' as data from vidhi.outbox where type like $1 order by created_at`,
      [`%.${name}.%`],
    )
  ).rows.map((r) => r.data);
const taskState = async (id: string) =>
  (await db.admin.query<{ state: string }>("select state from vidhi.task where id = $1", [id]))
    .rows[0]?.state;
const level = async (skill: string) =>
  (
    await db.admin.query<{ operating_level: string }>(
      "select operating_level from vidhi.skill_state where tenant_id = $1 and skill_key = $2",
      [TENANT, skill],
    )
  ).rows[0]?.operating_level;

async function waitingTask(
  skill = "oh.vendor_payment_prepare",
): Promise<{ taskId: string; approvalId: string }> {
  const { taskId } = await runtime.create(agent, { skillKey: skill, ownerId: "usr_owner" });
  await runtime.start(agent, taskId);
  const r = await runtime.callTool(agent, taskId, {
    tool: "payments.release",
    args: { invoice: "inv_1", amount_minor: 125_000 },
    idempotencyKey: `pay-${taskId}`,
  });
  expect(r.state).toBe("NEEDS_APPROVAL");
  return { taskId, approvalId: r.approvalId! };
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
  approvals = new ApprovalsEngine({
    kernel: db.kernel,
    audit: db.audit,
    product: "OH",
    // Tool arguments travel in the approval payload, sealed at the skill's data class.
    fieldCrypto: new FieldCrypto({ kms: fakeKms(), keyIdFor: localTenantKeyId }),
  });
  const skills = new SkillRegistry().load([
    skillManifest("oh.vendor_payment_prepare", "L4", [
      { name: "vendors.lookup", kind: "service", write: false, locked: false },
      { name: "payments.release", kind: "service", write: true, locked: false },
    ]),
    skillManifest("oh.ticket_triage", "L3", [
      { name: "tickets.set_priority", kind: "service", write: true, locked: false },
    ]),
  ]);
  expect(skills.issues).toEqual([]);
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
      "vendors.lookup": async () => ({ vendor: "ven_1" }),
      "payments.release": async (_ctx, args) => {
        released.push(String(args.invoice));
        return { released: true };
      },
      "tickets.set_priority": async () => ({ ok: true }),
    },
  });

  // The persona prompt from @infrabyx/vidhi's own prompt set, activated as `prompts sync` does.
  const staff = platformContext(["PLT_SUPER_ADMIN"], "tnt_platform", "usr_staff");
  const officer = platformContext(["PLT_SECURITY_OFFICER"], "tnt_platform", "usr_officer");
  await syncPrompts({
    kernel: db.kernel,
    audit: db.audit,
    actorId: "usr_release",
    env: "test",
    prompts: loadPromptFiles(new URL("../../persona", import.meta.url).pathname),
    evalsDir: new URL("../../evals", import.meta.url).pathname,
  });
  const registry = new ModelRegistry({
    kernel: db.kernel,
    audit: db.audit,
    product: "UDF",
    outbox: new PgOutbox(),
    approvals,
    cacheSeconds: 0,
  });
  const m = await registry.addCandidate(staff, {
    adapterKey: "bedrock_claude_in",
    providerModelName: "anthropic.claude-test",
    capabilities: ["chat"],
    residency: "IN",
    retentionPolicy: "ZERO",
    notes: "[VERIFY] test fixture",
  });
  await registry.transition(staff, m.modelId, "EVALUATING", { reason: "eval" });
  await registry.recordEvidence(staff, m.modelId, {
    retentionEvidenceUrl: "https://example.org/retention",
    trainingOptOut: true,
    trainingEvidenceUrl: "https://example.org/training",
    evalScores: { x: 1 },
  });
  for (const step of [
    () => registry.requestPromotion(staff, m.modelId),
    () => registry.requestDefault(staff, m.modelId, "chat", "in_zero"),
  ]) {
    const { approvalId } = await step();
    await approvals.decide(officer, approvalId, "approve");
    await db.admin.query(
      "update tenancy.approval_request set delay_until = now() - interval '1 minute' where id = $1",
      [approvalId],
    );
    await approvals.execute(officer, approvalId);
  }
  vidhi = new Vidhi({
    gateway: new LlmGateway({
      kernel: db.kernel,
      audit: db.audit,
      product: "UDF",
      settings,
      registry,
      prompts: new PromptRegistry({ kernel: db.kernel, audit: db.audit }),
      adapters: [llm],
      outbox: new PgOutbox(),
      kill,
    }),
    settings,
    product: "UDF",
    handoffContacts: () => [
      { role: "grievance_officer", label: "Grievance redressal officer", link: "/help/grievance" },
    ],
  });
});
afterAll(async () => {
  await db?.end();
});
beforeEach(() => {
  values.clear();
  released.length = 0;
});

describe("@IPB-03-AT-04 an agent cannot execute a locked action", () => {
  it("the payment step waits for a human with ORG_CHECKER; the agent cannot approve; the checker can", async () => {
    await db.admin.query(
      "insert into vidhi.skill_state (tenant_id, skill_key, operating_level) values ($1, $2, 'L4') on conflict (tenant_id, skill_key) do update set operating_level = 'L4'",
      [TENANT, "oh.vendor_payment_prepare"],
    );
    const { taskId, approvalId } = await waitingTask();
    expect(await taskState(taskId)).toBe("NEEDS_APPROVAL");
    const req = (await events("ApprovalRequested")).find((e) => e.task_id === taskId)!;
    expect(req).toMatchObject({
      tool: "payments.release",
      required_role: "ORG_CHECKER",
      risk_class: "R3",
      locked_category: "payments",
    });
    expect(await code(runtime.decide(agent, taskId, "approve"))).toBe("IPB-VID-012");
    expect(await code(approvals.decide(agent, approvalId, "approve"))).toBe("IPB-SEC-004");
    expect(await code(runtime.decide(member, taskId, "approve"))).toBe("IPB-VID-012");
    expect(released).toEqual([]);
    await runtime.decide(checker1, taskId, "approve");
    expect(released).toEqual(["inv_1"]);
    expect(await taskState(taskId)).toBe("RUNNING");
    await runtime.complete(agent, taskId);
    expect(await taskState(taskId)).toBe("DONE");
  });

  it("an agent insisting on the locked action fails the task, emits LockedActionAttempted and is demoted to L2", async () => {
    const { taskId } = await runtime.create(agent, {
      skillKey: "oh.vendor_payment_prepare",
      ownerId: "usr_owner",
    });
    await runtime.start(agent, taskId);
    expect(
      await code(
        runtime.callTool(agent, taskId, {
          tool: "payments.release",
          args: { invoice: "x" },
          insist: true,
        }),
      ),
    ).toBe("IPB-VID-011");
    expect(released).toEqual([]);
    expect(await taskState(taskId)).toBe("FAILED");
    expect((await events("LockedActionAttempted")).at(-1)).toMatchObject({
      task_id: taskId,
      tool: "payments.release",
      category: "payments",
    });
    expect(await level("oh.vendor_payment_prepare")).toBe("L2");
  });

  it("a tool outside the manifest halts the task (IPB-AI-040)", async () => {
    const { taskId } = await runtime.create(agent, {
      skillKey: "oh.ticket_triage",
      ownerId: "usr_owner",
    });
    await runtime.start(agent, taskId);
    expect(
      await code(runtime.callTool(agent, taskId, { tool: "mail.send_external", args: {} })),
    ).toBe("IPB-AI-040");
    expect(await taskState(taskId)).toBe("FAILED");
  });
});

describe("@IPB-03-AT-13 task lifecycle edge cases and the demotion target", () => {
  it("an approval after a kill switch is IPB-VID-022 and nothing executes", async () => {
    const { taskId } = await waitingTask();
    values.set("ai.kill.all", true);
    expect(await code(runtime.decide(checker1, taskId, "approve"))).toBe("IPB-VID-022");
    expect(released).toEqual([]);
    expect(await taskState(taskId)).toBe("CANCELLED");
    const ledger = await db.admin.query<{ action: string }>(
      "select action from audit.ledger where resource_id = $1 order by seq",
      [taskId],
    );
    expect(ledger.rows.map((r) => r.action)).toContain("vidhi.task.transition");
  });

  it("the kill-switch sweep cancels every open task", async () => {
    const { taskId } = await waitingTask();
    values.set("ai.kill.feature.oh_vendor_payment_prepare", true);
    expect(await runtime.sweepKilled(owner)).toBeGreaterThanOrEqual(1);
    expect(await taskState(taskId)).toBe("CANCELLED");
  });

  it("two approvers racing: exactly one execution, the other gets IPB-VID-022", async () => {
    const { taskId } = await waitingTask();
    const results = await Promise.all([
      code(runtime.decide(checker1, taskId, "approve")),
      code(runtime.decide(checker2, taskId, "approve")),
    ]);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.filter((r) => r === "IPB-VID-022")).toHaveLength(1);
    expect(released).toHaveLength(1);
  });

  it("a rejection cancels the task; a later decision is IPB-VID-022", async () => {
    const { taskId } = await waitingTask();
    await runtime.decide(checker1, taskId, "reject");
    expect(await taskState(taskId)).toBe("CANCELLED");
    expect(await code(runtime.decide(checker2, taskId, "approve"))).toBe("IPB-VID-022");
    expect(released).toEqual([]);
  });

  it("a locked-action attempt at L4 lands at L2, and promotion within 30 days is refused (IPB-AI-013)", async () => {
    await db.admin.query(
      "update vidhi.skill_state set operating_level = 'L4', demoted_at = null where tenant_id = $1 and skill_key = $2",
      [TENANT, "oh.vendor_payment_prepare"],
    );
    const { taskId } = await runtime.create(agent, {
      skillKey: "oh.vendor_payment_prepare",
      ownerId: "usr_owner",
    });
    await runtime.start(agent, taskId);
    await code(
      runtime.callTool(agent, taskId, { tool: "payments.release", args: {}, insist: true }),
    );
    expect(await taskState(taskId)).toBe("FAILED");
    expect(await level("oh.vendor_payment_prepare")).toBe("L2");
    const e = await autonomy
      .requestPromotion(owner, "oh.vendor_payment_prepare", {
        level: "L3",
        budget: {},
        scope: {},
        killSwitchOwnerId: "usr_owner",
      })
      .catch((x: { code: string; detail?: string; message: string }) => x);
    expect(e).toMatchObject({ code: expect.stringMatching(/IPB-AI-013|IPB-VID-010/) });
    // The triage skill (ceiling L3 in OH) shows the cool-down reason itself.
    await db.admin.query(
      "insert into vidhi.skill_state (tenant_id, skill_key, operating_level, demoted_at) values ($1, 'oh.ticket_triage', 'L2', now() - interval '3 days') on conflict (tenant_id, skill_key) do update set demoted_at = now() - interval '3 days'",
      [TENANT],
    );
    const t = await autonomy
      .requestPromotion(owner, "oh.ticket_triage", {
        level: "L3",
        budget: {},
        scope: {},
        killSwitchOwnerId: "usr_owner",
      })
      .catch((x: Error & { code: string }) => x);
    expect(t).toMatchObject({ code: "IPB-AI-013" });
    expect((t as Error).message).toMatch(/demoted less than 30 days ago/);
  });

  it("with the evidence, ORG_OWNER promotion through an R4 approval raises the operating level", async () => {
    await db.admin.query(
      "update vidhi.skill_state set demoted_at = null, evidence_since = now(), operating_level = 'L2' where tenant_id = $1 and skill_key = 'oh.ticket_triage'",
      [TENANT],
    );
    values.set("vidhi.autonomy.promotion_min_runs", 3);
    for (let i = 0; i < 3; i++) {
      const { taskId } = await runtime.create(agent, {
        skillKey: "oh.ticket_triage",
        ownerId: "usr_owner",
      });
      await runtime.start(agent, taskId);
      const r = await runtime.callTool(agent, taskId, {
        tool: "tickets.set_priority",
        args: { p: 1 },
      });
      await runtime.decide(checker1, taskId, "approve");
      expect(r.state).toBe("NEEDS_APPROVAL");
      await runtime.complete(agent, taskId);
    }
    expect(
      await code(
        autonomy.requestPromotion(member, "oh.ticket_triage", {
          level: "L3",
          budget: {},
          scope: {},
          killSwitchOwnerId: "x",
        }),
      ),
    ).toBe("IPB-VID-012");
    expect(
      await code(
        autonomy.requestPromotion(owner, "oh.ticket_triage", {
          level: "L4",
          budget: {},
          scope: {},
          killSwitchOwnerId: "x",
        }),
      ),
    ).toBe("IPB-VID-010");
    const { approvalId } = await autonomy.requestPromotion(owner, "oh.ticket_triage", {
      level: "L3",
      budget: { actions_per_day: 20 },
      scope: { queues: ["support"] },
      killSwitchOwnerId: "usr_owner",
    });
    await approvals.decide(owner2, approvalId, "approve");
    await db.admin.query(
      "update tenancy.approval_request set delay_until = now() - interval '1 minute' where id = $1",
      [approvalId],
    );
    await approvals.execute(owner2, approvalId);
    expect(await level("oh.ticket_triage")).toBe("L3");
    // At L3 an unlocked write runs at once.
    const { taskId, level: lv } = await runtime.create(agent, {
      skillKey: "oh.ticket_triage",
      ownerId: "usr_owner",
    });
    expect(lv).toBe("L3");
    await runtime.start(agent, taskId);
    expect(
      (await runtime.callTool(agent, taskId, { tool: "tickets.set_priority", args: {} })).state,
    ).toBe("RUNNING");
  });
});

describe("@IPB-03-AT-09 reserved advice is routed, not given", () => {
  it("a borrower asking whether to sign gets the KFS terms with citations and a hand-off, no recommendation", async () => {
    llm.script({
      text: "The annual percentage rate is 14.2 % [source:kfs_apr]. You may exit within three days [source:kfs_cool]. You should sign it today.",
    });
    const borrower = withTenant("tnt_udf", ["UDF_BORROWER"], { principal: { id: "usr_borrower" } });
    const r = await vidhi.answer(borrower as KernelContext, {
      featureKey: "udf.plain_language_kfs",
      question: "Should I sign this agreement?",
      dataClass: "REGULATED",
      audience: "borrower",
      dataBlocks: [
        {
          kind: "document",
          sourceId: "kfs_apr",
          locator: "KFS row 3",
          dataClass: "REGULATED",
          text: "The annual percentage rate is 14.2 %.",
        },
        {
          kind: "document",
          sourceId: "kfs_cool",
          locator: "KFS row 9",
          dataClass: "REGULATED",
          text: "You may exit within a three-day cooling-off period.",
        },
      ],
    });
    expect(r.text).toMatch(/14\.2 %/);
    expect(r.text).not.toMatch(/you should sign/i);
    expect(r.citations.map((c) => c.source_id)).toEqual(["kfs_apr", "kfs_cool"]);
    expect(r.handoff).toMatchObject({
      kind: "professional_handoff",
      contacts: [{ role: "professional" }, { role: "grievance_officer" }],
    });
    expect(llm.calls.at(-1)!.system).toMatch(/an AI, not a person/);
  });
});

describe("@IPB-03-AT-11 a display-name override keeps the kernel identity", () => {
  it("the UI says 'Astra, an AI assistant'; runs, ledger and events still say vidhi", async () => {
    values.set("vidhi.brand.display_name", "Astra");
    llm.script({ text: "The APR is 14.2 % [source:kfs_apr]." });
    const borrower = withTenant("tnt_udf", ["UDF_BORROWER"], {
      principal: { id: "usr_borrower2" },
    });
    const r = await vidhi.answer(borrower as KernelContext, {
      featureKey: "udf.product_explainer",
      question: "What is the APR?",
      dataClass: "REGULATED",
      audience: "borrower",
      dataBlocks: [
        {
          kind: "document",
          sourceId: "kfs_apr",
          dataClass: "REGULATED",
          text: "The APR is 14.2 %.",
        },
      ],
    });
    expect(r.assistant).toBe("Astra, an AI assistant");
    expect(await vidhi.label(borrower as KernelContext, r)).toMatch(
      /^Drafted by Astra, an AI assistant, on /,
    );
    expect(llm.calls.at(-1)!.system).toMatch(/You are Astra, an AI assistant/);
    expect(r.provenance.generated_by).toBe("vidhi");
    const out = await db.admin.query<{ envelope: unknown }>(
      "select envelope from ai.outbox where tenant_id = 'tnt_udf'",
    );
    expect(JSON.stringify(out.rows)).not.toMatch(/astra/i);
    const runs = await db.admin.query("select * from ai.run where tenant_id = 'tnt_udf'");
    expect(JSON.stringify(runs.rows)).not.toMatch(/astra/i);
    expect(r.handoff).toBeNull();
  });
});

describe("@IPB-03-AT-06 AI disclosure and provenance (platform side)", () => {
  it("every output carries the visible label with its run id and the ai_provenance sidecar", async () => {
    llm.script({ text: "The notice period is 30 days [source:tpl_notice]." });
    const lawyer = withTenant("tnt_ld", ["ORG_MEMBER"], { principal: { id: "usr_lawyer" } });
    const r = await vidhi.answer(lawyer, {
      featureKey: "ld.draft_from_template",
      question: "Draft the notice clause.",
      dataClass: "CONFIDENTIAL",
      audience: "staff",
      dataBlocks: [
        {
          kind: "document",
          sourceId: "tpl_notice",
          dataClass: "CONFIDENTIAL",
          text: "Either party may end this agreement with 30 days' notice.",
        },
      ],
    });
    const d = await vidhi.disclose(lawyer, r);
    // Docgen (DOCX and PDF placement) is deferred; the label and sidecar it embeds are these.
    expect(d.label).toMatch(
      new RegExp(
        `^Drafted by Vidhi AI on \\d{1,2} [A-Z][a-z]{2} \\d{4} using .+; reviewed by: not yet reviewed \\(run ${r.runId}\\)$`,
      ),
    );
    expect(d.ai_provenance).toMatchObject({
      generated_by: "vidhi",
      model_id: r.modelId,
      prompt_ref: "vidhi.persona@1.0.0",
      run_id: r.runId,
    });
    expect(d.ai_provenance.prompt_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await vidhi.disclose(lawyer, r, "A. Rao")).label).toMatch(/reviewed by: A\. Rao/);
    expect(() => disclosure({ ...r, runId: "run_01HZZZZZZZZZZZZZZZZZZZZZZZ" }, {})).toThrow(
      /another run/,
    );
  });
});
