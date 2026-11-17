// Wave 15 (LawDocsComply PR-LDC-57; R1-D-146, R1-D-175): dated, cited and locked rule parameters.
// A platform parameter schedule is published through `rules.ruleset.publish` (R4), and a rule
// set's dated parameter takes the entry in force at the decision's instant, compared by calendar
// day in Asia/Kolkata. PostgreSQL 18 with every platform migration applied.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { ParameterScheduleBody, RuleSetBody } from "@infrabyx/contracts/ports";
import { localTenantKeyId } from "@infrabyx/crypto";
import { ApprovalsEngine, FieldCrypto, PgOutbox } from "@infrabyx/tenancy";
import {
  fakeKms,
  platformContext,
  startPostgres,
  withTenant,
  type TestDatabase,
} from "@infrabyx/testing";
import {
  PUBLISH_ACTION,
  RulesService,
  SCHEDULE_ZONE,
  type RuleParameterSettings,
} from "../service.js";

let db: TestDatabase;
let approvals: ApprovalsEngine;
let svc: RulesService;
/** Today's calendar day in Asia/Kolkata, by the database clock (YYYY-MM-DD). */
let today: string;

const staff = platformContext(["PLT_SUPER_ADMIN"], "tnt_platform", "usr_staff");
const officer = platformContext(["PLT_SECURITY_OFFICER"], "tnt_platform", "usr_officer");
const maker = withTenant("tnt_a", ["ORG_ADMIN"], { principal: { id: "usr_a_maker" } });
const checker = withTenant("tnt_a", ["ORG_CHECKER"], { principal: { id: "usr_a_checker" } });
const tenantB = withTenant("tnt_b", ["ORG_ADMIN"], { principal: { id: "usr_b" } });

const KEY = "stat.test.audit_threshold";

/** A settings fake that counts reads, so a locked parameter is shown never to read one. */
const reads: string[] = [];
const values = new Map<string, unknown>();
const settings: RuleParameterSettings = {
  async explain(ctx, key) {
    reads.push(key);
    if (![KEY, "ldc.rules.min_turnover"].includes(key)) throw new Error(`IPB-UX-007 ${key}`);
    return { value: values.get(`${ctx.tenantId}:${key}`) ?? null };
  },
};

/** The day `n` days from today (Asia/Kolkata). */
const day = (n: number): string =>
  new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** 00:00 in Asia/Kolkata on that day, as an instant. */
const istMidnight = (d: string): Date => new Date(`${d}T00:00:00+05:30`);

const cite = (section: string) => ({
  instrumentRef: "Test Act 2013, s. 139 notification",
  section,
  url: "https://example.org/notification",
});

const schedule = (over: Partial<ParameterScheduleBody> = {}): ParameterScheduleBody => ({
  format: "ipb.parameter_schedule.v1",
  type: "integer",
  entries: [
    { value: 1_000, effectiveFrom: day(-30), citation: cite("r. 3(1)") },
    { value: 2_000, effectiveFrom: day(-10), citation: cite("r. 3(2)") },
    { value: 3_000, effectiveFrom: day(10), citation: cite("r. 3(3)") },
  ],
  ...over,
});

const ruleSet = (over: Partial<RuleSetBody> = {}, scheduleKey = KEY): RuleSetBody => ({
  format: "ipb.decision_table.v1",
  hit_policy: "first",
  inputs: [{ name: "turnover", type: "integer", dataClass: "INTERNAL" }],
  outputs: [{ name: "audit", type: "boolean", dataClass: "INTERNAL", statutory: false }],
  parameters: [{ name: "threshold", type: "integer", schedule: scheduleKey, min: 0 }],
  rows: [
    { id: "audit", when: "turnover >= threshold", then: { audit: true }, verify: false },
    { id: "exempt", when: "true", then: { audit: false }, verify: false },
  ],
  ...over,
});

async function approveAndExecute(c: KernelContext, approvalId: string): Promise<void> {
  await approvals.decide(c, approvalId, "approve");
  await db.admin.query(
    "update tenancy.approval_request set delay_until = now() - interval '1 minute' where id = $1",
    [approvalId],
  );
  await approvals.execute(c, approvalId);
}

async function publishSchedule(key: string, body: ParameterScheduleBody): Promise<number> {
  const { version } = await svc.saveScheduleDraft(staff, key, body);
  const { approvalId } = await svc.publishSchedule(staff, key, version);
  await approveAndExecute(officer, approvalId);
  return version;
}

async function publishRuleSet(key: string, body: RuleSetBody): Promise<string> {
  const { ruleSetId } = await svc.createRuleSet(maker, { key, ownerModule: "cmp" });
  const { version } = await svc.saveDraft(maker, ruleSetId, body);
  const { approvalId } = await svc.publish(maker, ruleSetId, version);
  await approveAndExecute(checker, approvalId);
  return ruleSetId;
}

/**
 * Move a version's cut-over 60 days back, so past instants fall inside its publication window
 * (test data only: the guard trigger refuses this to every application role).
 */
async function backdate(sql: string): Promise<void> {
  await db.admin.query(`begin; set local session_replication_role = replica; ${sql}; commit;`);
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string }) => e.code ?? String(e),
  );

let ruleSetId: string;

beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'LDC', 'A'), ('tnt_b', 'LDC', 'B'), ('tnt_platform', 'LDC', 'Platform') on conflict do nothing",
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
    evalTimeoutMs: 2000,
  });
  today = (
    await db.admin.query<{ d: string }>(
      "select to_char(now() at time zone $1, 'YYYY-MM-DD') as d",
      [SCHEDULE_ZONE],
    )
  ).rows[0]!.d;
  await svc.createSchedule(staff, { key: KEY });
  await publishSchedule(KEY, schedule());
  ruleSetId = await publishRuleSet("ldc.rules.audit_due", ruleSet());
  await backdate(
    `update rules.parameter_schedule_version set effective_from = now() - interval '60 days' where key = '${KEY}' and version = 1;
     update rules.rule_set_version set effective_from = now() - interval '60 days' where rule_set_id = '${ruleSetId}'`,
  );
});
afterAll(async () => db?.end());

describe("evaluation at the decision's instant (PR-LDC-57)", () => {
  it("takes the entry in force today and cites it in the decision and in explain (IPB-07-16)", async () => {
    const d = await svc.evaluate(maker, { ruleSetId }, { turnover: 1_500 });
    expect(d).toMatchObject({
      outcome: "MATCHED",
      ruleIds: ["exempt"],
      parameters: { threshold: 2_000 },
    });
    const ex = await svc.explain(maker, d.id);
    expect(ex.parameters).toEqual([
      {
        name: "threshold",
        value: 2_000,
        source: "schedule",
        schedule: { key: KEY, version: 1, effectiveFrom: day(-10), citation: cite("r. 3(2)") },
      },
    ]);
    const log = await db.admin.query<{ parameters: unknown }>(
      "select parameters from rules.decision_log where id = $1",
      [d.id],
    );
    expect(log.rows[0]?.parameters).toMatchObject({
      threshold: { source: "schedule", schedule: { key: KEY, version: 1 } },
    });
  });

  it("takes each entry on its side of a cut-over, by the calendar day in Asia/Kolkata", async () => {
    const at = async (asOf: Date) =>
      (await svc.evaluate(maker, { ruleSetId, asOf }, { turnover: 1_500 })).parameters;
    expect(await at(new Date(istMidnight(day(-20)).getTime() + 12 * 3_600_000))).toEqual({
      threshold: 1_000,
    });
    // 23:59:59.999 IST on the day before the entry, then 00:00 IST on its first day.
    expect(await at(new Date(istMidnight(day(-10)).getTime() - 1))).toEqual({ threshold: 1_000 });
    expect(await at(istMidnight(day(-10)))).toEqual({ threshold: 2_000 });
    // The same instant is already the next day in UTC terms only after 05:30 IST, so a UTC
    // reading would differ: 18:30 UTC on the day before is 00:00 IST.
    expect(istMidnight(day(-10)).toISOString()).toBe(`${day(-11)}T18:30:00.000Z`);
  });

  it("never reads a setting for a dated parameter: it is locked", async () => {
    values.set(`tnt_a:${KEY}`, 1);
    reads.length = 0;
    const d = await svc.evaluate(maker, { ruleSetId }, { turnover: 1_500 });
    expect(d.parameters).toEqual({ threshold: 2_000 });
    expect(reads).toEqual([]);
    values.delete(`tnt_a:${KEY}`);
  });

  it("is UNDETERMINED with parameter_not_in_force when no entry is in force, and ledgers it", async () => {
    const key = "stat.test.future_only";
    await svc.createSchedule(staff, { key });
    await publishSchedule(key, schedule({ entries: [schedule().entries[2]!] }));
    const id = await publishRuleSet("ldc.rules.not_yet", ruleSet({}, key));
    const d = await svc.evaluate(maker, { ruleSetId: id }, { turnover: 9_999 });
    expect(d).toMatchObject({
      outcome: "UNDETERMINED",
      reason: "parameter_not_in_force",
      ruleIds: [],
    });
    expect(d.parameters).toBeUndefined();
    // Ledgered in the same transaction (the ledger keeps digests; the log keeps the reason).
    const ledger = await db.admin.query<{ n: number }>(
      "select count(*)::int as n from audit.ledger where action = 'rules.decision.record' and resource_id = $1",
      [d.id],
    );
    expect(ledger.rows[0]?.n).toBe(1);
    const log = await db.admin.query<{ reason: string; parameters: unknown }>(
      "select reason, parameters from rules.decision_log where id = $1",
      [d.id],
    );
    expect(log.rows[0]).toEqual({ reason: "parameter_not_in_force", parameters: null });
    // A projection rule set gives the same outcome, and records nothing.
    const { ruleSetId: proj } = await svc.createRuleSet(maker, {
      key: "ldc.rules.not_yet_projection",
      ownerModule: "cmp",
      purpose: "projection",
    });
    const { version } = await svc.saveDraft(maker, proj, ruleSet({}, key));
    const { approvalId } = await svc.publish(maker, proj, version);
    await approveAndExecute(checker, approvalId);
    const p = await svc.project(maker, { ruleSetId: proj }, [{ turnover: 1 }]);
    expect(p.results).toEqual([
      { outcome: "UNDETERMINED", outputs: {}, reason: "parameter_not_in_force" },
    ]);
  });

  it("replays an old decision with the value known then after a correcting version", async () => {
    const between = new Date(istMidnight(day(-5)).getTime() + 6 * 3_600_000);
    const before = await svc.evaluate(maker, { ruleSetId, asOf: between }, { turnover: 2_200 });
    expect(before.parameters).toEqual({ threshold: 2_000 });

    const corrected = schedule({
      entries: [
        schedule().entries[0]!,
        { value: 2_500, effectiveFrom: day(-10), citation: cite("r. 3(2) as corrected") },
        schedule().entries[2]!,
      ],
      reason: "Corrected value of rule 3(2) after the corrigendum",
    });
    expect(await publishSchedule(KEY, corrected)).toBe(2);

    const replay = await svc.evaluate(maker, { ruleSetId, asOf: between }, { turnover: 2_200 });
    expect(replay).toMatchObject({ parameters: { threshold: 2_000 }, ruleIds: before.ruleIds });
    expect((await svc.explain(maker, replay.id)).parameters?.[0]?.schedule?.version).toBe(1);

    const now = await svc.evaluate(maker, { ruleSetId }, { turnover: 2_200 });
    expect(now).toMatchObject({ parameters: { threshold: 2_500 }, ruleIds: ["exempt"] });
    const ex = await svc.explain(maker, now.id);
    expect(ex.parameters?.[0]?.schedule).toMatchObject({
      version: 2,
      effectiveFrom: day(-10),
      citation: { section: "r. 3(2) as corrected" },
    });
    const v1 = await svc.getSchedule(maker, KEY, 1);
    expect(v1).toMatchObject({ state: "retired", version: 1 });
    expect(v1.effectiveTo).not.toBeNull();
    expect((await svc.getSchedule(tenantB, KEY)).version).toBe(2);
  });

  it("refuses a future asOf", async () => {
    await expect(
      svc.evaluate(maker, { ruleSetId, asOf: new Date(Date.now() + 86_400_000) }, { turnover: 1 }),
    ).rejects.toMatchObject({ code: "IPB-RULE-001" });
  });
});

describe("schedule drafts are refused when wrong (IPB-RULE-001)", () => {
  const key = "stat.test.refusals";
  beforeAll(async () => {
    await svc.createSchedule(staff, { key });
  });
  // Built lazily: the days depend on the database clock, read in beforeAll.
  const entry = () => schedule().entries[0]!;

  it.each<[string, () => ParameterScheduleBody]>([
    [
      "unsorted entries",
      () => schedule({ entries: [schedule().entries[1]!, schedule().entries[0]!] }),
    ],
    ["overlapping entries", () => schedule({ entries: [entry(), { ...entry(), value: 5 }] })],
    ["no entries", () => schedule({ entries: [] })],
    [
      "a missing citation",
      () => schedule({ entries: [{ value: 1, effectiveFrom: day(1) } as never] }),
    ],
    [
      "an over-long instrument reference",
      () =>
        schedule({
          entries: [
            { ...entry(), citation: { ...entry().citation, instrumentRef: "x".repeat(129) } },
          ],
        }),
    ],
    [
      "an over-long section",
      () =>
        schedule({
          entries: [{ ...entry(), citation: { ...entry().citation, section: "s".repeat(65) } }],
        }),
    ],
    [
      "a control character in the citation",
      () =>
        schedule({
          entries: [{ ...entry(), citation: { ...entry().citation, section: "r.\u00073" } }],
        }),
    ],
    [
      "a non-https url",
      () =>
        schedule({
          entries: [{ ...entry(), citation: { ...entry().citation, url: "http://example.org/n" } }],
        }),
    ],
    ["a value of another type", () => schedule({ entries: [{ ...entry(), value: "1000" }] })],
    ["an invalid date", () => schedule({ entries: [{ ...entry(), effectiveFrom: "2026-02-30" }] })],
    [
      "too many entries",
      () =>
        schedule({
          entries: Array.from({ length: 501 }, (_, i) => ({
            ...entry(),
            effectiveFrom: new Date(Date.UTC(2000, 0, 1 + i)).toISOString().slice(0, 10),
          })),
        }),
    ],
  ])("refuses %s", async (_name, body) => {
    expect(await code(svc.saveScheduleDraft(staff, key, body()))).toBe("IPB-RULE-001");
  });

  it("refuses a later version without a reason, or one that changes the type", async () => {
    await publishSchedule(key, schedule());
    expect(await code(svc.saveScheduleDraft(staff, key, schedule()))).toBe("IPB-RULE-001");
    expect(
      await code(
        svc.saveScheduleDraft(
          staff,
          key,
          schedule({
            type: "number",
            entries: [{ ...entry(), value: 1.5 }],
            reason: "Changed to a number",
          }),
        ),
      ),
    ).toBe("IPB-RULE-001");
    expect(
      (await svc.saveScheduleDraft(staff, key, schedule({ reason: "Re-issued notification" })))
        .version,
    ).toBe(2);
  });

  it("refuses a bad key, a duplicate schedule and an unknown one", async () => {
    expect(await code(svc.createSchedule(staff, { key: "NoDots" }))).toBe("IPB-RULE-001");
    expect(await code(svc.createSchedule(staff, { key }))).toBe("IPB-RULE-003");
    expect(await code(svc.saveScheduleDraft(staff, "stat.test.nope", schedule()))).toMatch(
      /not found/i,
    );
  });
});

describe("rule sets naming a schedule are refused when it does not fit (IPB-RULE-001)", () => {
  it("refuses an unknown schedule, an unpublished one, another type and out-of-bounds entries", async () => {
    const { ruleSetId: id } = await svc.createRuleSet(maker, {
      key: "ldc.rules.refused",
      ownerModule: "cmp",
    });
    const refuse = (b: RuleSetBody) =>
      svc.saveDraft(maker, id, b).then(
        () => null,
        (e: { code?: string; meta?: Record<string, unknown> }) => ({ code: e.code, meta: e.meta }),
      );
    expect(await refuse(ruleSet({}, "stat.test.unknown"))).toMatchObject({
      code: "IPB-RULE-001",
      meta: { parameter: "threshold", schedule: "stat.test.unknown" },
    });
    await svc.createSchedule(staff, { key: "stat.test.draft_only" });
    await svc.saveScheduleDraft(staff, "stat.test.draft_only", schedule());
    expect(await refuse(ruleSet({}, "stat.test.draft_only"))).toMatchObject({
      code: "IPB-RULE-001",
    });
    expect(
      await refuse(
        ruleSet({
          parameters: [{ name: "threshold", type: "number", schedule: KEY }],
        }),
      ),
    ).toMatchObject({ code: "IPB-RULE-001", meta: { schedule: KEY } });
    expect(
      await refuse(
        ruleSet({
          parameters: [{ name: "threshold", type: "integer", schedule: KEY, max: 2_400 }],
        }),
      ),
    ).toMatchObject({ code: "IPB-RULE-001", meta: { schedule: KEY, version: 2 } });
    // A parameter is either dated or setting-backed, never both.
    expect(
      await refuse(
        ruleSet({
          parameters: [
            {
              name: "threshold",
              type: "integer",
              schedule: KEY,
              setting: KEY,
              default: 1,
            } as never,
          ],
        }),
      ),
    ).toMatchObject({ code: "IPB-RULE-001" });
  });

  it("mixes a dated and a setting-backed parameter in one rule set", async () => {
    values.set("tnt_a:ldc.rules.min_turnover", 100);
    const id = await publishRuleSet(
      "ldc.rules.mixed",
      ruleSet({
        parameters: [
          { name: "threshold", type: "integer", schedule: KEY, min: 0 },
          {
            name: "floor",
            type: "integer",
            setting: "ldc.rules.min_turnover",
            default: 0,
            min: 0,
          },
        ],
        rows: [
          { id: "small", when: "turnover < floor", then: { audit: false }, verify: false },
          { id: "audit", when: "turnover >= threshold", then: { audit: true }, verify: false },
          { id: "exempt", when: "true", then: { audit: false }, verify: false },
        ],
      }),
    );
    const d = await svc.evaluate(maker, { ruleSetId: id }, { turnover: 50 });
    expect(d).toMatchObject({ ruleIds: ["small"], parameters: { threshold: 2_500, floor: 100 } });
    expect((await svc.explain(maker, d.id)).parameters?.map((p) => p.source)).toEqual([
      "schedule",
      "setting",
    ]);
    values.delete("tnt_a:ldc.rules.min_turnover");
  });
});

describe("publication: platform scope, R4 maker-checker, immutability and the ledger", () => {
  const key = "stat.test.publication";

  it("refuses every write outside a platform context, and lets every tenant read", async () => {
    const tenantInPlatform = withTenant("tnt_platform", ["PLT_SUPER_ADMIN"]);
    for (const c of [maker, tenantInPlatform]) {
      expect(await code(svc.createSchedule(c, { key: "stat.test.tenant" }))).toBe("IPB-UX-011");
      expect(await code(svc.saveScheduleDraft(c, KEY, schedule()))).toBe("IPB-UX-011");
      expect(await code(svc.publishSchedule(c, KEY, 2))).toBe("IPB-UX-011");
      expect(await code(svc.reopenSchedule(c, KEY, 2))).toBe("IPB-UX-011");
    }
    // Row-level security refuses the same write made directly in a tenant context.
    await expect(
      db.kernel.mutate(maker, (tx) =>
        tx.query(
          "insert into rules.parameter_schedule (key, tenant_id, created_by) values ('stat.test.direct', 'tnt_platform', 'usr_a_maker')",
        ),
      ),
    ).rejects.toThrow();
    for (const t of [maker, tenantB])
      expect((await svc.listSchedules(t)).map((s) => s.key)).toContain(KEY);
    expect((await svc.listSchedules(maker)).find((s) => s.key === KEY)).toMatchObject({
      publishedVersion: 2,
      scheduledVersion: null,
    });
  });

  it("needs a platform checker other than the maker, after the R4 delay", async () => {
    await svc.createSchedule(staff, { key });
    const { version } = await svc.saveScheduleDraft(staff, key, schedule());
    const { approvalId } = await svc.publishSchedule(staff, key, version);
    const request = await approvals.get(staff, approvalId);
    expect(request).toMatchObject({ action: PUBLISH_ACTION, riskClass: "R4" });
    expect(request.summary).toBe(
      `Publish parameter schedule ${key} v${version} (3 entries, first version)`,
    );
    expect(await code(approvals.decide(staff, approvalId, "approve"))).toBe("IPB-SEC-007");
    expect(await code(approvals.decide(checker, approvalId, "approve"))).not.toBeNull();
    await approvals.decide(officer, approvalId, "approve");
    expect(await code(approvals.execute(officer, approvalId))).toBe("IPB-SEC-008");
    await db.admin.query(
      "update tenancy.approval_request set delay_until = now() - interval '1 minute' where id = $1",
      [approvalId],
    );
    await approvals.execute(officer, approvalId);
    expect((await svc.getSchedule(staff, key)).state).toBe("published");
  });

  it("reopens a rejected version, and schedules a future cut-over", async () => {
    const { version } = await svc.saveScheduleDraft(
      staff,
      key,
      schedule({ reason: "Second notification" }),
    );
    const first = await svc.publishSchedule(staff, key, version);
    expect(await code(svc.saveScheduleDraft(staff, key, schedule({ reason: "x y z" })))).toBe(
      "IPB-RULE-003",
    );
    await approvals.decide(officer, first.approvalId, "reject");
    await svc.reopenSchedule(staff, key, version);
    const at = new Date(Date.now() + 3 * 86_400_000);
    const { approvalId } = await svc.publishSchedule(staff, key, version, { effectiveFrom: at });
    await approveAndExecute(officer, approvalId);
    const list = (await svc.listSchedules(staff)).find((s) => s.key === key);
    expect(list).toMatchObject({ publishedVersion: 1, scheduledVersion: 2 });
    expect(Date.parse(list!.scheduledFrom!)).toBe(at.getTime());
    // One scheduled cut-over at a time.
    const v3 = await svc.saveScheduleDraft(staff, key, schedule({ reason: "Third version" }));
    expect(await code(svc.publishSchedule(staff, key, v3.version))).toBe("IPB-RULE-003");
    expect(
      await code(
        svc.publishSchedule(staff, key, v3.version, {
          effectiveFrom: new Date(Date.now() - 86_400_000),
        }),
      ),
    ).toBe("IPB-RULE-001");
  });

  it("refuses an approved request of an unknown kind", async () => {
    const { id } = await db.kernel.mutate(staff, (tx) =>
      approvals.request(tx, {
        action: PUBLISH_ACTION,
        riskClass: "R4",
        payload: { kind: "other", key },
        summary: "An unknown kind",
      }),
    );
    await approvals.decide(officer, id, "approve");
    await db.admin.query(
      "update tenancy.approval_request set delay_until = now() - interval '1 minute' where id = $1",
      [id],
    );
    expect(await code(approvals.execute(officer, id))).toBe("IPB-RULE-003");
  });

  it("keeps a published version immutable, even to a direct update", async () => {
    for (const sql of [
      `update rules.parameter_schedule_version set body = jsonb_set(body, '{type}', '"string"') where key = '${KEY}' and version = 2`,
      `update rules.parameter_schedule_version set effective_from = now() where key = '${KEY}' and version = 2`,
      `update rules.parameter_schedule_version set effective_to = now() where key = '${KEY}' and version = 1`,
      `update rules.parameter_schedule_version set state = 'draft' where key = '${KEY}' and version = 2`,
    ])
      await expect(db.admin.query(sql)).rejects.toThrow(/immutable|keeps|cannot move/);
  });

  it("ledgers every schedule write in tnt_platform", async () => {
    const actions = (
      await db.admin.query<{ action: string }>(
        "select action from audit.ledger where tenant_id = 'tnt_platform' and action like 'rules.schedule.%'",
      )
    ).rows.map((r) => r.action);
    for (const a of [
      "rules.schedule.create",
      "rules.schedule.draft",
      "rules.schedule.submit",
      "rules.schedule.publish",
      "rules.schedule.reopen",
    ])
      expect(actions, a).toContain(a);
  });
});
