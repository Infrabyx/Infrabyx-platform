// RULES service on PostgreSQL 18 with every platform migration applied (PL3 plan §4, PL3-D-18).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HumanQueue, InboxItemInput, KernelContext } from "@infrabyx/contracts/kernel";
import type { RuleSetBody } from "@infrabyx/contracts/ports";
import { localTenantKeyId } from "@infrabyx/crypto";
import { ApprovalsEngine, FieldCrypto, PgOutbox } from "@infrabyx/tenancy";
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
