// RULES service on PostgreSQL 18 with every platform migration applied (PL3 plan §4, PL3-D-18).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HumanQueue, InboxItemInput, KernelContext } from "@infrabyx/contracts/kernel";
import type { RuleSetBody } from "@infrabyx/contracts/ports";
import { localTenantKeyId } from "@infrabyx/crypto";
import { ApprovalsEngine, FieldCrypto, OutboxRelay, PgOutbox } from "@infrabyx/tenancy";
import {
  agentContext,
  fakeKms,
  platformContext,
  startPostgres,
  withTenant,
  type TestDatabase,
} from "@infrabyx/testing";
import { RulesService } from "../service.js";

let db: TestDatabase;
let approvals: ApprovalsEngine;
let svc: RulesService;
const raised: InboxItemInput[] = [];
const humanQueue: HumanQueue = {
  async raise(tx, item) {
    raised.push(item);
    await tx.query("select 1");
    return { id: `ibx_${raised.length}` };
  },
};

const maker = withTenant("tnt_a", ["ORG_ADMIN"], { principal: { id: "usr_maker" } });
const checker = withTenant("tnt_a", ["ORG_CHECKER"], { principal: { id: "usr_checker" } });
const tenantB = withTenant("tnt_b", ["ORG_ADMIN"], { principal: { id: "usr_b" } });

/** The deterministic next-best-action table of @IPB-07-AT-11. */
const nba = (over: Partial<RuleSetBody> = {}): RuleSetBody => ({
  format: "ipb.decision_table.v1",
  hit_policy: "first",
  inputs: [
    { name: "stage", type: "string", dataClass: "INTERNAL" },
    { name: "docsComplete", type: "boolean", dataClass: "INTERNAL" },
    { name: "bureauScore", type: "integer", dataClass: "CONFIDENTIAL" },
  ],
  outputs: [
    { name: "action", type: "string", dataClass: "INTERNAL", statutory: false },
    { name: "reason", type: "string", dataClass: "INTERNAL", statutory: false },
    { name: "rateCap", type: "number", dataClass: "INTERNAL", statutory: true },
  ],
  rows: [
    {
      id: "fbx.los.nba.sanction_ready",
      when: 'stage == "underwriting" && docsComplete && bureauScore >= 700',
      then: { action: "prepare_sanction", reason: "documents complete and score at or above 700" },
      help_key: "hlp.fbx.nba.sanction_ready",
      verify: false,
    },
    {
      id: "fbx.los.nba.rate_cap",
      when: 'stage == "pricing"',
      then: { action: "apply_cap", rateCap: 24.5 },
      citation: "draft circular, unverified",
      verify: true,
    },
    {
      id: "fbx.los.nba.collect_docs",
      when: "!docsComplete",
      then: { action: "collect_documents", reason: "documents missing" },
      verify: false,
    },
  ],
  ...over,
});

async function published(
  ctx: KernelContext,
  key: string,
  body: RuleSetBody,
  checkerCtx: KernelContext,
) {
  const { ruleSetId } = await svc.createRuleSet(ctx, {
    key,
    ownerModule: "los",
    dataClass: "CONFIDENTIAL",
  });
  const { version } = await svc.saveDraft(ctx, ruleSetId, body);
  const { approvalId } = await svc.publish(ctx, ruleSetId, version);
  await approvals.decide(checkerCtx, approvalId, "approve");
  await db.admin.query(
    "update tenancy.approval_request set delay_until = now() - interval '1 minute' where id = $1",
    [approvalId],
  );
  await approvals.execute(checkerCtx, approvalId);
  return { ruleSetId, version, approvalId };
}

beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'FBX', 'A'), ('tnt_b', 'FBX', 'B'), ('tnt_platform', 'FBX', 'Platform') on conflict do nothing",
  );
  const fieldCrypto = new FieldCrypto({ kms: fakeKms(), keyIdFor: localTenantKeyId });
  const outbox = new PgOutbox();
  approvals = new ApprovalsEngine({
    kernel: db.kernel,
    audit: db.audit,
    outbox,
    product: "FBX",
    fieldCrypto,
  });
  svc = new RulesService({
    kernel: db.kernel,
    audit: db.audit,
    approvals,
    product: "FBX",
    outbox,
    fieldCrypto,
    humanQueue,
    evalTimeoutMs: 2000,
  });
});
afterAll(async () => db?.end());

describe("rule sets: drafts, publish at R4, immutability (PL3 plan §4.4)", () => {
  it("refuses a draft one engine cannot run, and an input above the set's class (IPB-RULE-001)", async () => {
    const { ruleSetId } = await svc.createRuleSet(maker, {
      key: "fbx.los.invalid",
      ownerModule: "los",
      dataClass: "CONFIDENTIAL",
    });
    const internal = await svc.createRuleSet(maker, {
      key: "fbx.los.internal",
      ownerModule: "los",
    });
    const bad = nba({ rows: [{ id: "x", when: "bureauScore + 1 > 2", then: {}, verify: false }] });
    await expect(svc.saveDraft(maker, ruleSetId, bad)).rejects.toMatchObject({
      code: "IPB-RULE-001",
      meta: { row: "x", reason: "cel_unsupported" },
    });
    // A matches pattern outside the linear-time subset is refused before it can be submitted
    // for publication (PR-LDC-13; R1-D-71); one inside it is saved.
    const redos = nba({
      rows: [{ id: "y", when: 'stage.matches(r"(a+)+$")', then: {}, verify: false }],
    });
    await expect(svc.saveDraft(maker, ruleSetId, redos)).rejects.toMatchObject({
      code: "IPB-RULE-001",
      meta: { row: "y", reason: "cel_pattern" },
    });
    const linear = nba({
      rows: [
        {
          id: "z",
          when: 'stage.matches(r"^under") && stage.contains("writ")',
          then: {},
          verify: false,
        },
      ],
    });
    await expect(svc.saveDraft(maker, ruleSetId, linear)).resolves.toMatchObject({ version: 1 });
    // The set is INTERNAL, the table has a CONFIDENTIAL input.
    await expect(svc.saveDraft(maker, internal.ruleSetId, nba())).rejects.toMatchObject({
      code: "IPB-RULE-001",
      detail: expect.stringContaining("above the rule set's INTERNAL"),
    });
  });

  it("publishes through an R4 request: checker not maker, 1 h delay, then executes once", async () => {
    const { ruleSetId } = await svc.createRuleSet(maker, {
      key: "fbx.los.nba",
      ownerModule: "los",
      dataClass: "CONFIDENTIAL",
    });
    const { version } = await svc.saveDraft(maker, ruleSetId, nba());
    expect(version).toBe(1);
    const { approvalId } = await svc.publish(maker, ruleSetId, version);
    const req = (
      await db.admin.query("select * from tenancy.approval_request where id = $1", [approvalId])
    ).rows[0];
    expect(req).toMatchObject({ action: "rules.ruleset.publish", risk_class: "R4" });
    expect(req.delay_minutes).toBeGreaterThanOrEqual(60);
    expect(req.summary).toMatch(/first version/);
    await expect(svc.saveDraft(maker, ruleSetId, nba())).rejects.toMatchObject({
      code: "IPB-RULE-003",
    });
    await expect(approvals.decide(maker, approvalId, "approve")).rejects.toMatchObject({
      code: "IPB-SEC-007",
    });
    await approvals.decide(checker, approvalId, "approve");
    await expect(approvals.execute(checker, approvalId)).rejects.toMatchObject({
      code: "IPB-SEC-008",
    });
    await expect(svc.evaluate(maker, { ruleSetId }, {})).rejects.toMatchObject({
      code: "IPB-RULE-002",
    });
    await db.admin.query(
      "update tenancy.approval_request set delay_until = now() - interval '1 minute' where id = $1",
      [approvalId],
    );
    await approvals.execute(checker, approvalId);
    const v = (
      await db.admin.query(
        "select state, published_at from rules.rule_set_version where rule_set_id = $1",
        [ruleSetId],
      )
    ).rows[0];
    expect(v.state).toBe("published");
    const ev = (
      await db.admin.query("select type, envelope from rules.outbox where tenant_id = 'tnt_a'")
    ).rows;
    expect(ev.map((e) => e.type)).toContain("in.fbx.rules.RuleSetPublished.v1");
    expect(ev[0].envelope.data).toMatchObject({
      rule_set_id: ruleSetId,
      version: 1,
      approval_id: approvalId,
    });
    // The relay finds rules.outbox (rules/0003 registers it; PR-LDC-35) and delivers the event once.
    const delivered: string[] = [];
    const relay = new OutboxRelay({
      kernel: db.kernel,
      audit: db.audit,
      schemas: ["rules"],
      deliver: async (_schema, e) => void delivered.push(e.type),
    });
    expect(await relay.registered()).toEqual(["rules"]);
    expect(await relay.once()).toBeGreaterThanOrEqual(1);
    expect(delivered).toContain("in.fbx.rules.RuleSetPublished.v1");
    expect(await relay.once()).toBe(0);
    // Body immutable once it left draft, for every role (trigger).
    await expect(
      db.admin.query(
        "update rules.rule_set_version set body = '{}'::jsonb where rule_set_id = $1",
        [ruleSetId],
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.admin.query("update rules.rule_set_version set state = 'draft' where rule_set_id = $1", [
        ruleSetId,
      ]),
    ).rejects.toThrow(/cannot move/);
  });

  it("a second publish retires the first; a pinned retired version still evaluates", async () => {
    const [{ id: ruleSetId }] = (
      await db.admin.query("select id from rules.rule_set where key = 'fbx.los.nba'")
    ).rows;
    const body = nba();
    body.rows[0] = {
      ...(body.rows[0] as RuleSetBody["rows"][number]),
      when: 'stage == "underwriting" && docsComplete && bureauScore >= 650',
    };
    const { version } = await svc.saveDraft(maker, ruleSetId, body);
    expect(version).toBe(2);
    const sim = await svc.simulate(maker, { ruleSetId, version }, [
      { stage: "underwriting", docsComplete: true, bureauScore: 680 },
      { stage: "underwriting", docsComplete: true, bureauScore: 720 },
    ]);
    expect(sim.changed).toEqual([
      { index: 0, before: "NO_MATCH", after: "MATCHED", rowAfter: "fbx.los.nba.sanction_ready" },
    ]);
    const run = (
      await db.admin.query("select * from rules.simulation_run where id = $1", [sim.runId])
    ).rows[0];
    expect(run).toMatchObject({ input_count: 2, baseline: 1 });
    expect(JSON.stringify(run)).not.toContain("underwriting");
    const { approvalId } = await svc.publish(maker, ruleSetId, version);
    await approvals.decide(checker, approvalId, "approve");
    await db.admin.query(
      "update tenancy.approval_request set delay_until = now() - interval '1 minute' where id = $1",
      [approvalId],
    );
    await approvals.execute(checker, approvalId);
    const states = (
      await db.admin.query(
        "select version, state from rules.rule_set_version where rule_set_id = $1 order by version",
        [ruleSetId],
      )
    ).rows;
    expect(states).toEqual([
      { version: 1, state: "retired" },
      { version: 2, state: "published" },
    ]);
    const input = { stage: "underwriting", docsComplete: true, bureauScore: 680 };
    expect((await svc.evaluate(maker, { ruleSetId }, input)).outcome).toBe("MATCHED");
    expect((await svc.evaluate(maker, { ruleSetId, version: 1 }, input)).outcome).toBe("NO_MATCH");
  });

  it("a rejected request can be reopened as a draft", async () => {
    const { ruleSetId } = await svc.createRuleSet(maker, {
      key: "fbx.los.reopen",
      ownerModule: "los",
      dataClass: "CONFIDENTIAL",
    });
    const { version } = await svc.saveDraft(maker, ruleSetId, nba());
    const { approvalId } = await svc.publish(maker, ruleSetId, version);
    await expect(svc.reopen(maker, ruleSetId, version)).rejects.toMatchObject({
      code: "IPB-RULE-003",
    });
    await approvals.decide(checker, approvalId, "reject");
    await svc.reopen(maker, ruleSetId, version);
    expect((await svc.listRuleSets(maker)).find((s) => s.ruleSetId === ruleSetId)).toMatchObject({
      draftVersion: 1,
      publishedVersion: null,
    });
  });
});

describe("@IPB-07-AT-11 deterministic next best action (backend)", () => {
  it("evaluate and explain return the rule id and its reason; inputs above INTERNAL are sealed", async () => {
    const [{ id: ruleSetId }] = (
      await db.admin.query("select id from rules.rule_set where key = 'fbx.los.nba'")
    ).rows;
    const d = await svc.evaluate(
      maker,
      { ruleSetId },
      { stage: "underwriting", docsComplete: true, bureauScore: 742 },
    );
    expect(d).toMatchObject({
      outcome: "MATCHED",
      ruleIds: ["fbx.los.nba.sanction_ready"],
      outputs: {
        action: "prepare_sanction",
        reason: "documents complete and score at or above 700",
      },
      version: 2,
    });
    expect(d.id).toMatch(/^dcs_/);
    const x = await svc.explain(maker, d.id);
    expect(x).toMatchObject({
      outcome: "MATCHED",
      ruleIds: ["fbx.los.nba.sanction_ready"],
      help_keys: ["hlp.fbx.nba.sanction_ready"],
      source: "rules",
    });
    expect(x.conditions[0]).toContain("bureauScore >= 650");
    expect(x.inputs).toEqual([
      { name: "stage", value: "underwriting" },
      { name: "docsComplete", value: true },
      { name: "bureauScore" },
    ]);
    const row = (await db.admin.query("select * from rules.decision_log where id = $1", [d.id]))
      .rows[0];
    expect(row.inputs).toEqual({ stage: "underwriting", docsComplete: true });
    expect(row.inputs_enc).not.toBeNull();
    expect(Buffer.from(row.inputs_enc).toString("latin1")).not.toContain("742");
  });

  it("an AI source never produces the decision: an agent evaluates, but cannot publish or approve", async () => {
    const [{ id: ruleSetId }] = (
      await db.admin.query("select id from rules.rule_set where key = 'fbx.los.nba'")
    ).rows;
    const agent = agentContext("tnt_a");
    const d = await svc.evaluate(
      agent,
      { ruleSetId },
      { stage: "underwriting", docsComplete: false, bureauScore: 800 },
    );
    expect(d.ruleIds).toEqual(["fbx.los.nba.collect_docs"]);
    expect((await svc.explain(maker, d.id)).source).toBe("rules");
    const { ruleSetId: other } = await svc.createRuleSet(maker, {
      key: "fbx.los.agent",
      ownerModule: "los",
      dataClass: "CONFIDENTIAL",
    });
    const { version } = await svc.saveDraft(maker, other, nba());
    await expect(svc.publish(agent, other, version)).rejects.toMatchObject({ code: "IPB-SEC-004" });
  });
});

describe("UNDETERMINED goes to a human queue; nothing defaults to allow", () => {
  it("an invalid input and a verify row driving a statutory output are UNDETERMINED with an inbox item", async () => {
    const [{ id: ruleSetId }] = (
      await db.admin.query("select id from rules.rule_set where key = 'fbx.los.nba'")
    ).rows;
    raised.length = 0;
    const bad = await svc.evaluate(
      maker,
      { ruleSetId },
      { stage: "underwriting", docsComplete: "yes", bureauScore: 1 },
    );
    expect(bad).toMatchObject({ outcome: "UNDETERMINED", reason: "input_invalid", outputs: {} });
    const verify = await svc.evaluate(
      maker,
      { ruleSetId },
      { stage: "pricing", docsComplete: true, bureauScore: 600 },
    );
    expect(verify).toMatchObject({
      outcome: "UNDETERMINED",
      reason: "verify_row",
      outputs: {},
      ruleIds: ["fbx.los.nba.rate_cap"],
    });
    expect(raised.map((r) => [r.productModule, r.actionHint, r.recordRef])).toEqual([
      ["rules", "review_undetermined", bad.id],
      ["rules", "review_undetermined", verify.id],
    ]);
    expect(raised[0]?.title).not.toContain("yes");
    const rows = (
      await db.admin.query(
        "select inputs, inputs_enc, inbox_item_id from rules.decision_log where id = $1",
        [bad.id],
      )
    ).rows[0];
    expect(rows).toEqual({ inputs: null, inputs_enc: null, inbox_item_id: "ibx_1" });
  });
});

describe("tenancy: RLS, platform rule sets and the ledger (@NN-01 @NN-45)", () => {
  it("another tenant cannot read, evaluate or explain a tenant's rule set", async () => {
    const [{ id: ruleSetId }] = (
      await db.admin.query("select id from rules.rule_set where key = 'fbx.los.nba'")
    ).rows;
    await expect(svc.evaluate(tenantB, { ruleSetId }, {})).rejects.toThrow(/not found/);
    expect(await svc.listRuleSets(tenantB)).toEqual([]);
    const [{ id: dcs }] = (await db.admin.query("select id from rules.decision_log limit 1")).rows;
    await expect(svc.explain(tenantB, dcs)).rejects.toThrow(/not found/);
  });

  it("platform rule sets are written in platform scope only and evaluated by every tenant", async () => {
    const asTenantInPlatform = withTenant("tnt_platform", ["ORG_ADMIN"]);
    await expect(
      svc.createRuleSet(asTenantInPlatform, { key: "plt.kyc.min_age", ownerModule: "kyc" }),
    ).rejects.toThrow();
    const staff = platformContext(["PLT_SUPER_ADMIN"], "tnt_platform", "usr_staff");
    const officer = platformContext(["PLT_SECURITY_OFFICER"], "tnt_platform", "usr_officer");
    const body: RuleSetBody = {
      format: "ipb.decision_table.v1",
      hit_policy: "first",
      inputs: [{ name: "age", type: "integer", dataClass: "INTERNAL" }],
      outputs: [{ name: "eligible", type: "boolean", dataClass: "INTERNAL", statutory: false }],
      rows: [
        { id: "adult", when: "age >= 18", then: { eligible: true }, verify: false },
        { id: "minor", when: "true", then: { eligible: false }, verify: false },
      ],
    };
    const { ruleSetId } = await published(staff, "plt.kyc.min_age", body, officer);
    for (const t of [maker, tenantB]) {
      const d = await svc.evaluate(t, { ruleSetId }, { age: 17 });
      expect(d).toMatchObject({
        outcome: "MATCHED",
        ruleIds: ["minor"],
        outputs: { eligible: false },
      });
      expect((await svc.listRuleSets(t)).map((s) => s.key)).toContain("plt.kyc.min_age");
    }
    // A tenant cannot submit a platform version for publication.
    await expect(svc.saveDraft(maker, ruleSetId, body)).rejects.toThrow();
    const logs = (
      await db.admin.query("select tenant_id from rules.decision_log where rule_set_id = $1", [
        ruleSetId,
      ])
    ).rows;
    expect(logs.map((l) => l.tenant_id).sort()).toEqual(["tnt_a", "tnt_b"]);
  });

  it("@NN-45 every write carries a ledger entry and the ledger holds no input values", async () => {
    const actions = (
      await db.admin.query("select action from audit.ledger where tenant_id = 'tnt_a' order by seq")
    ).rows.map((r) => r.action as string);
    for (const a of [
      "rules.ruleset.create",
      "rules.ruleset.draft",
      "rules.ruleset.submit",
      "rules.ruleset.publish",
      "rules.ruleset.reopen",
      "rules.simulation.run",
      "rules.decision.record",
    ])
      expect(actions, a).toContain(a);
    const decisions = (
      await db.admin.query(
        "select count(*)::int as n from rules.decision_log where tenant_id = 'tnt_a'",
      )
    ).rows[0].n;
    expect(actions.filter((a) => a === "rules.decision.record")).toHaveLength(decisions);
    const ledger = JSON.stringify((await db.admin.query("select * from audit.ledger")).rows);
    // The ledger holds digests only; no input value or rule text reaches it.
    expect(ledger).not.toContain("underwriting");
  });
});

const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string }) => e.code ?? "error",
  );

describe("projection rule sets (PR-LDC-49)", () => {
  it("project returns outcomes only, records nothing, and never runs a decision-grade set", async () => {
    const { ruleSetId } = await svc.createRuleSet(maker, {
      key: "fbx.los.nba_forecast",
      ownerModule: "los",
      dataClass: "CONFIDENTIAL",
      purpose: "projection",
    });
    const { version } = await svc.saveDraft(maker, ruleSetId, nba());
    const { approvalId } = await svc.publish(maker, ruleSetId, version);
    await approvals.decide(checker, approvalId, "approve");
    await db.admin.query(
      "update tenancy.approval_request set delay_until = now() - interval '1 minute' where id = $1",
      [approvalId],
    );
    await approvals.execute(checker, approvalId);
    const count = async () =>
      Number(
        (
          await db.admin.query<{ n: string }>(
            "select (select count(*) from rules.decision_log where rule_set_id = $1) + (select count(*) from audit.ledger where action = 'rules.decision.record') as n",
            [ruleSetId],
          )
        ).rows[0]!.n,
      );
    const before = await count();
    const raisedBefore = raised.length;
    const p = await svc.project(maker, { ruleSetId }, [
      { stage: "underwriting", docsComplete: true, bureauScore: 742 },
      { stage: "underwriting", docsComplete: false, bureauScore: 700 },
      { stage: 1 },
    ]);
    expect(p).toMatchObject({ ruleSetId, version });
    expect(p.results.map((r) => r.outcome)).toEqual(["MATCHED", "MATCHED", "UNDETERMINED"]);
    expect(p.results[0]!.outputs).toMatchObject({ action: "prepare_sanction" });
    expect(JSON.stringify(p)).not.toMatch(/dcs_/);
    expect(await count()).toBe(before);
    expect(raised.length).toBe(raisedBefore);
    // A projection set is never a decision, and a decision set is never projected.
    expect(await code(svc.evaluate(maker, { ruleSetId }, { stage: "x" }))).toBe("IPB-RULE-003");
    const [{ id: decisionSet }] = (
      await db.admin.query("select id from rules.rule_set where key = 'fbx.los.nba'")
    ).rows;
    expect(await code(svc.project(maker, { ruleSetId: decisionSet }, [{}]))).toBe("IPB-RULE-003");
    expect(await code(svc.project(maker, { ruleSetId }, []))).toBe("IPB-RULE-001");
    expect(await code(svc.project(tenantB, { ruleSetId }, [{}]))).not.toBeNull();
  });
});

describe("a scheduled cut-over (PR-LDC-34)", () => {
  it("publishes with a future effectiveFrom: the old version stays in force until it, the event carries it", async () => {
    const first = await published(maker, "fbx.los.cutover", nba(), checker);
    const body = nba();
    body.rows[0] = {
      ...(body.rows[0] as RuleSetBody["rows"][number]),
      when: 'stage == "underwriting" && docsComplete && bureauScore >= 650',
    };
    const { version } = await svc.saveDraft(maker, first.ruleSetId, body);
    const past = new Date(Date.now() - 60_000);
    await expect(
      svc.publish(maker, first.ruleSetId, version, { effectiveFrom: past }),
    ).rejects.toMatchObject({ code: "IPB-RULE-001" });
    await expect(
      svc.publish(maker, first.ruleSetId, version, {
        effectiveFrom: new Date(Date.now() + 400 * 86_400_000),
      }),
    ).rejects.toMatchObject({ code: "IPB-RULE-001" });
    await expect(
      svc.publish(maker, first.ruleSetId, version, { effectiveFrom: "not a date" }),
    ).rejects.toMatchObject({ code: "IPB-RULE-001" });
    const at = new Date(Date.now() + 6_000);
    const { approvalId } = await svc.publish(maker, first.ruleSetId, version, {
      effectiveFrom: at,
    });
    const req = (
      await db.admin.query("select payload, summary from tenancy.approval_request where id = $1", [
        approvalId,
      ])
    ).rows[0];
    expect(req.payload.effectiveFrom).toBe(at.toISOString());
    expect(req.summary).toContain(`in force from ${at.toISOString()}`);
    await approvals.decide(checker, approvalId, "approve");
    await db.admin.query(
      "update tenancy.approval_request set delay_until = now() - interval '1 minute' where id = $1",
      [approvalId],
    );
    await approvals.execute(checker, approvalId);
    const rows = (
      await db.admin.query(
        `select version, state, effective_from, effective_to from rules.rule_set_version
          where rule_set_id = $1 order by version`,
        [first.ruleSetId],
      )
    ).rows;
    expect(rows.map((r) => [r.version, r.state])).toEqual([
      [1, "retired"],
      [2, "published"],
    ]);
    expect(rows[0].effective_to.toISOString()).toBe(at.toISOString());
    expect(rows[1].effective_from.toISOString()).toBe(at.toISOString());
    const ev = (
      await db.admin.query(
        `select envelope from rules.outbox where tenant_id = 'tnt_a'
          and envelope->'data'->>'rule_set_id' = $1 order by created_at desc limit 1`,
        [first.ruleSetId],
      )
    ).rows[0];
    expect(ev.envelope.data).toMatchObject({ version: 2, effective_from: at.toISOString() });
    // Before the cut-over the first version still decides, and the summary shows both.
    const input = { stage: "underwriting", docsComplete: true, bureauScore: 680 };
    expect((await svc.evaluate(maker, { ruleSetId: first.ruleSetId }, input)).outcome).toBe(
      "NO_MATCH",
    );
    const summary = (await svc.listRuleSets(maker)).find((x) => x.ruleSetId === first.ruleSetId);
    expect(summary).toMatchObject({
      publishedVersion: 1,
      scheduledVersion: 2,
      scheduledFrom: at.toISOString(),
    });
    // One scheduled cut-over at a time.
    const { version: v3 } = await svc.saveDraft(maker, first.ruleSetId, nba());
    await expect(svc.publish(maker, first.ruleSetId, v3)).rejects.toMatchObject({
      code: "IPB-RULE-003",
    });
    // After it, the new version decides; an as-of read before it still gets the first.
    await new Promise((r) => setTimeout(r, Math.max(0, at.getTime() - Date.now()) + 300));
    expect((await svc.evaluate(maker, { ruleSetId: first.ruleSetId }, input)).outcome).toBe(
      "MATCHED",
    );
    const before = new Date(at.getTime() - 1_000);
    expect(
      (await svc.evaluate(maker, { ruleSetId: first.ruleSetId, asOf: before }, input)).outcome,
    ).toBe("NO_MATCH");
    expect(
      (await svc.listRuleSets(maker)).find((x) => x.ruleSetId === first.ruleSetId),
    ).toMatchObject({ publishedVersion: 2, scheduledVersion: null });
  }, 30_000);
});

describe("@PL3-RULES-REVIEW UNDETERMINED review (OWNER-QUESTIONS #21)", () => {
  const nbaSet = async () =>
    (await db.admin.query("select id from rules.rule_set where key = 'fbx.los.nba'")).rows[0]
      .id as string;
  const undetermined = (ruleSetId: string) =>
    svc.evaluate(
      maker,
      { ruleSetId },
      { stage: "underwriting", docsComplete: "x", bureauScore: 1 },
    );

  it("goes to ORG_ADMIN only while the tenant has no checker, never to the maker, escalating at 48 h", async () => {
    const ruleSetId = await nbaSet();
    raised.length = 0;
    await undetermined(ruleSetId);
    expect(raised[0]).toMatchObject({
      assignee: { kind: "role", id: "ORG_ADMIN" },
      excludePrincipal: "usr_maker",
      escalateAfterHours: 48,
    });
    await db.admin.query(
      `insert into tenancy.user (id, idp_subject) values ('usr_01M5XQT0PRXMKBEGFFSHNHTA61', 'chk-1')
         on conflict do nothing`,
    );
    await db.admin.query(
      `insert into tenancy.membership (tenant_id, user_id, roles)
         values ('tnt_a', 'usr_01M5XQT0PRXMKBEGFFSHNHTA61', '{ORG_CHECKER}') on conflict do nothing`,
    );
    const d = await undetermined(ruleSetId);
    expect(raised[1]).toMatchObject({
      assignee: { kind: "role", id: "ORG_CHECKER" },
      excludePrincipal: "usr_maker",
    });
    // One ledger entry per decision: the audit trail for statutory outputs.
    const n = await db.admin.query(
      "select count(*)::int as n from audit.ledger where action = 'rules.decision.record' and resource_id = $1",
      [d.id],
    );
    expect(n.rows[0]).toEqual({ n: 1 });
  });
});
