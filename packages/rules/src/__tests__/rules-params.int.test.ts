// Wave 5 (R1-plan M55; R1-D-86, R1-D-88): rule parameters from settings, as-of evaluation,
// product checker roles for publish, and compiling ahead of traffic. PostgreSQL 18 with every
// platform migration applied.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { RuleSetBody } from "@infrabyx/contracts/ports";
import { localTenantKeyId } from "@infrabyx/crypto";
import {
  ApprovalsEngine,
  DEFAULT_PLATFORM_CHECKERS,
  FieldCrypto,
  PgOutbox,
} from "@infrabyx/tenancy";
import {
  fakeKms,
  platformContext,
  startPostgres,
  withTenant,
  type TestDatabase,
} from "@infrabyx/testing";
import { PUBLISH_ACTION, RulesService, type RuleParameterSettings } from "../service.js";

let db: TestDatabase;
let approvals: ApprovalsEngine;
let svc: RulesService;

const maker = withTenant("tnt_p", ["ORG_ADMIN"], { principal: { id: "usr_p_maker" } });
const cco = withTenant("tnt_p", ["TEN_CCO"], { principal: { id: "usr_p_cco" } });
const other = withTenant("tnt_p", ["TEN_ANALYST"], { principal: { id: "usr_p_analyst" } });

/** A settings fake: registered keys only, values per tenant. */
const REGISTERED = new Set(["ldc.rules.min_score", "ldc.rules.segment"]);
const values = new Map<string, unknown>();
const settings: RuleParameterSettings = {
  async explain(ctx, key) {
    if (!REGISTERED.has(key)) throw new Error(`IPB-UX-007 ${key}`);
    return { value: values.get(`${ctx.tenantId}:${key}`) ?? null };
  },
};

const body = (over: Partial<RuleSetBody> = {}): RuleSetBody => ({
  format: "ipb.decision_table.v1",
  hit_policy: "first",
  inputs: [{ name: "bureauScore", type: "integer", dataClass: "INTERNAL" }],
  outputs: [{ name: "band", type: "string", dataClass: "INTERNAL", statutory: false }],
  parameters: [
    {
      name: "minScore",
      type: "integer",
      setting: "ldc.rules.min_score",
      default: 700,
      min: 300,
      max: 900,
    },
  ],
  rows: [
    { id: "pass", when: "bureauScore >= minScore", then: { band: "pass" }, verify: false },
    { id: "refer", when: "true", then: { band: "refer" }, verify: false },
  ],
  ...over,
});

async function approveAndExecute(checker: KernelContext, approvalId: string): Promise<void> {
  await approvals.decide(checker, approvalId, "approve");
  await db.admin.query(
    "update tenancy.approval_request set delay_until = now() - interval '1 minute' where id = $1",
    [approvalId],
  );
  await approvals.execute(checker, approvalId);
}

async function publishVersion(ruleSetId: string, b: RuleSetBody): Promise<number> {
  const { version } = await svc.saveDraft(maker, ruleSetId, b);
  const { approvalId } = await svc.publish(maker, ruleSetId, version);
  await approveAndExecute(cco, approvalId);
  return version;
}

async function dbNow(): Promise<Date> {
  return (await db.admin.query<{ now: Date }>("select clock_timestamp() as now")).rows[0]!.now;
}

beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_p', 'LDC', 'P'), ('tnt_platform', 'LDC', 'Platform') on conflict do nothing",
  );
  const fieldCrypto = new FieldCrypto({ kms: fakeKms(), keyIdFor: localTenantKeyId });
  const outbox = new PgOutbox();
  approvals = new ApprovalsEngine({
    kernel: db.kernel,
    audit: db.audit,
    outbox,
    product: "LDC",
    fieldCrypto,
  });
  svc = new RulesService({
    kernel: db.kernel,
    audit: db.audit,
    approvals,
    product: "LDC",
    outbox,
    fieldCrypto,
    settings,
    publishCheckerRoles: ["TEN_CCO", "TEN_ADMIN"],
    evalTimeoutMs: 2000,
  });
});
afterAll(async () => db?.end());

describe("product checker roles for rules.ruleset.publish (#109, R1-D-86)", () => {
  it("refuses platform, agent, service and operations roles when the service is built", () => {
    for (const role of ["PLT_SUPPORT", "AGT_VIDHI", "SVC_RULES", "OPS_DESK", "lower_case"])
      expect(
        () =>
          new RulesService({
            kernel: db.kernel,
            audit: db.audit,
            approvals: new ApprovalsEngine({ kernel: db.kernel, audit: db.audit, product: "LDC" }),
            product: "LDC",
            publishCheckerRoles: [role],
          }),
      ).toThrow(/not a tenant or product role/);
  });

  it("lets a listed product role check a publish, not another role, and never the maker", async () => {
    const { ruleSetId } = await svc.createRuleSet(maker, {
      key: "ldc.rules.checkers",
      ownerModule: "cmp",
    });
    const { version } = await svc.saveDraft(maker, ruleSetId, body());
    const { approvalId } = await svc.publish(maker, ruleSetId, version);
    await expect(approvals.decide(other, approvalId, "approve")).rejects.toMatchObject({
      code: "IPB-UX-011",
    });
    await expect(approvals.decide(maker, approvalId, "approve")).rejects.toMatchObject({
      code: "IPB-SEC-007",
    });
    await approveAndExecute(cco, approvalId);
    const v = await db.admin.query(
      "select state from rules.rule_set_version where rule_set_id = $1 and version = $2",
      [ruleSetId, version],
    );
    expect(v.rows[0]?.state).toBe("published");
    const ledger = await db.admin.query(
      "select count(*)::int as n from audit.ledger where action = 'rules.ruleset.publish' and resource_id = $1",
      [`${ruleSetId}@${version}`],
    );
    expect(ledger.rows[0]?.n).toBe(1);
  });

  it("keeps the platform's checkers in a platform context", async () => {
    const roles = await approvals.checkerRolesFor(platformContext(), PUBLISH_ACTION);
    expect(roles).toEqual(DEFAULT_PLATFORM_CHECKERS);
    const tenant = await approvals.checkerRolesFor(maker, PUBLISH_ACTION);
    expect(tenant).toEqual(
      expect.arrayContaining(["ORG_CHECKER", "ORG_ADMIN", "ORG_OWNER", "TEN_CCO", "TEN_ADMIN"]),
    );
    expect(tenant.some((r) => r.startsWith("PLT_"))).toBe(false);
  });
});

describe("rule parameters from settings (PR-LDC-21 (a), R1-D-88)", () => {
  it("refuses a draft whose parameter names an unregistered setting", async () => {
    const { ruleSetId } = await svc.createRuleSet(maker, {
      key: "ldc.rules.unregistered",
      ownerModule: "cmp",
    });
    const bad = body({
      parameters: [{ name: "minScore", type: "integer", setting: "ldc.rules.nope", default: 700 }],
    });
    await expect(svc.saveDraft(maker, ruleSetId, bad)).rejects.toMatchObject({
      code: "IPB-RULE-001",
      meta: { parameter: "minScore", setting: "ldc.rules.nope" },
    });
  });

  it("uses the tenant's value, else the default, records both and explains them", async () => {
    const { ruleSetId } = await svc.createRuleSet(maker, {
      key: "ldc.rules.params",
      ownerModule: "cmp",
    });
    await publishVersion(ruleSetId, body());

    values.delete("tnt_p:ldc.rules.min_score");
    const byDefault = await svc.evaluate(maker, { ruleSetId }, { bureauScore: 680 });
    expect(byDefault).toMatchObject({
      outcome: "MATCHED",
      ruleIds: ["refer"],
      parameters: { minScore: 700 },
    });

    values.set("tnt_p:ldc.rules.min_score", 650);
    const bySetting = await svc.evaluate(maker, { ruleSetId }, { bureauScore: 680 });
    expect(bySetting).toMatchObject({
      outcome: "MATCHED",
      ruleIds: ["pass"],
      parameters: { minScore: 650 },
    });

    // A caller cannot set a parameter through its input: it is not an input.
    const forced = await svc.evaluate(maker, { ruleSetId }, { bureauScore: 680, minScore: 999 });
    expect(forced).toMatchObject({ outcome: "UNDETERMINED", reason: "input_invalid" });

    const ex = await svc.explain(maker, bySetting.id);
    expect(ex.parameters).toEqual([{ name: "minScore", value: 650, source: "setting" }]);
    const exDefault = await svc.explain(maker, byDefault.id);
    expect(exDefault.parameters).toEqual([{ name: "minScore", value: 700, source: "default" }]);
  });

  it("makes a decision UNDETERMINED when the tenant's value is out of bounds", async () => {
    const { ruleSetId } = await svc.createRuleSet(maker, {
      key: "ldc.rules.bounds",
      ownerModule: "cmp",
    });
    await publishVersion(ruleSetId, body());
    values.set("tnt_p:ldc.rules.min_score", 1000);
    const d = await svc.evaluate(maker, { ruleSetId }, { bureauScore: 999 });
    expect(d).toMatchObject({ outcome: "UNDETERMINED", reason: "parameter_invalid", ruleIds: [] });
    values.set("tnt_p:ldc.rules.min_score", "high");
    const e = await svc.evaluate(maker, { ruleSetId }, { bureauScore: 999 });
    expect(e.reason).toBe("parameter_invalid");
    values.delete("tnt_p:ldc.rules.min_score");
  });

  it("refuses parameters when the service has no settings option", async () => {
    const bare = new RulesService({
      kernel: db.kernel,
      audit: db.audit,
      approvals: new ApprovalsEngine({ kernel: db.kernel, audit: db.audit, product: "LDC" }),
      product: "LDC",
    });
    const { ruleSetId } = await bare.createRuleSet(maker, {
      key: "ldc.rules.bare",
      ownerModule: "cmp",
    });
    await expect(bare.saveDraft(maker, ruleSetId, body())).rejects.toMatchObject({
      code: "IPB-RULE-001",
    });
  });
});

describe("as-of evaluation (PR-LDC-22 (b), R1-D-88)", () => {
  it("evaluates the version in force at a past instant", async () => {
    const { ruleSetId } = await svc.createRuleSet(maker, {
      key: "ldc.rules.asof",
      ownerModule: "cmp",
    });
    const before = await dbNow();
    const v1 = await publishVersion(ruleSetId, body());
    const between = await dbNow();
    const v2 = await publishVersion(
      ruleSetId,
      body({
        rows: [
          { id: "pass2", when: "bureauScore >= minScore", then: { band: "pass" }, verify: false },
          { id: "refer2", when: "true", then: { band: "refer" }, verify: false },
        ],
      }),
    );
    expect([v1, v2]).toEqual([1, 2]);

    const then = await svc.evaluate(maker, { ruleSetId, asOf: between }, { bureauScore: 800 });
    expect(then).toMatchObject({ version: 1, ruleIds: ["pass"], asOf: between.toISOString() });
    const now = await svc.evaluate(maker, { ruleSetId }, { bureauScore: 800 });
    expect(now).toMatchObject({ version: 2, ruleIds: ["pass2"] });
    expect(now.asOf).toBeUndefined();
    expect((await svc.explain(maker, then.id)).asOf).toBe(between.toISOString());

    await expect(
      svc.evaluate(maker, { ruleSetId, asOf: before }, { bureauScore: 800 }),
    ).rejects.toMatchObject({ code: "IPB-RULE-002" });
    await expect(
      svc.evaluate(
        maker,
        { ruleSetId, asOf: new Date(Date.now() + 86_400_000) },
        { bureauScore: 1 },
      ),
    ).rejects.toMatchObject({ code: "IPB-RULE-001" });
    await expect(
      svc.evaluate(maker, { ruleSetId, version: 1, asOf: between }, { bureauScore: 1 }),
    ).rejects.toMatchObject({ code: "IPB-RULE-001" });
    await expect(
      svc.evaluate(maker, { ruleSetId, asOf: "not a date" }, { bureauScore: 1 }),
    ).rejects.toMatchObject({ code: "IPB-RULE-001" });
  });
});

describe("compiling ahead of traffic (PR-LDC-25, R1-D-88)", () => {
  it("prepares every rule set in force for the caller and reports none failed", async () => {
    const r = await svc.prepare(maker);
    expect(r.failed).toEqual([]);
    expect(r.compiled).toBeGreaterThanOrEqual(3);
  });
});
