// Refused reveals as security audit events and the purpose code (owner answer #132 (4), (5);
// R1-D-187; `audit/0012`): every refusal is kept in `audit.security_event` (who, when, which
// decision and input, the reason and the purpose code; never the value or the purpose text),
// outside the business ledger; the threshold-th refusal of one principal within the window raises
// one `RevealRefusalsRepeated`; a product cannot turn reveals on without the record and the alert.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { RevealRequest, RuleSetBody } from "@infrabyx/contracts/ports";
import { PgSecurityEvents } from "@infrabyx/audit";
import { localBlindIndexRoot, localTenantKeyId } from "@infrabyx/crypto";
import { ApprovalsEngine, FieldCrypto, PgOutbox, RateLimiter } from "@infrabyx/tenancy";
import { fakeKms, startPostgres, withTenant, type TestDatabase } from "@infrabyx/testing";
import {
  REVEAL_REFUSALS_REPEATED_ACTION,
  RulesService,
  type RulesServiceOptions,
} from "../service.js";

let db: TestDatabase;
let fieldCrypto: FieldCrypto;
const T = "tnt_rs";
const maker = withTenant(T, ["ORG_ADMIN"], { principal: { id: "usr_rs_maker" } });
const checker = withTenant(T, ["ORG_CHECKER"], { principal: { id: "usr_rs_checker" } });
const reader = withTenant(T, ["ORG_MEMBER"], { principal: { id: "usr_rs_reader" } });
const user = (id: string) => withTenant(T, ["ORG_MEMBER"], { principal: { id } });

const body: RuleSetBody = {
  format: "ipb.decision_table.v1",
  hit_policy: "first",
  inputs: [
    { name: "itemType", type: "string", dataClass: "INTERNAL" },
    { name: "counterpartyScore", type: "integer", dataClass: "CONFIDENTIAL" },
  ],
  outputs: [{ name: "band", type: "string", dataClass: "INTERNAL", statutory: false }],
  rows: [{ id: "demo.rs.default", when: "true", then: { band: "standard" }, verify: false }],
};
const SECRET_SCORE = 86421;
const PURPOSE = "quarterly review of counterparty bands";

const revealRule = {
  id: "demo.rs.reveal",
  allows: async (ctx: KernelContext) => ctx.principal.id === "usr_rs_reader",
};

function service(
  over: { [K in keyof RulesServiceOptions]?: RulesServiceOptions[K] | undefined } = {},
): RulesService {
  const approvals = new ApprovalsEngine({
    kernel: db.kernel,
    audit: db.audit,
    outbox: new PgOutbox(),
    product: "LDC",
    fieldCrypto,
  });
  return new RulesService({
    kernel: db.kernel,
    audit: db.audit,
    approvals,
    product: "LDC",
    outbox: new PgOutbox(),
    fieldCrypto,
    evalTimeoutMs: 2000,
    revealRule,
    securityEvents: new PgSecurityEvents({ pool: db.pool }),
    refusalCounter: new RateLimiter({ pool: db.pool, product: "ldc", root: localBlindIndexRoot() }),
    ...over,
  } as RulesServiceOptions);
}

let svc: RulesService;
let decisionId = "";
beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    `insert into tenancy.tenant (id, product, name) values ('${T}', 'LDC', 'S'), ('tnt_rt', 'LDC', 'T')
     on conflict do nothing`,
  );
  fieldCrypto = new FieldCrypto({ kms: fakeKms(), keyIdFor: localTenantKeyId });
  const approvals = new ApprovalsEngine({
    kernel: db.kernel,
    audit: db.audit,
    outbox: new PgOutbox(),
    product: "LDC",
    fieldCrypto,
  });
  svc = service({ approvals });
  const { ruleSetId } = await svc.createRuleSet(maker, {
    key: "demo.rs.classify",
    ownerModule: "board",
    dataClass: "CONFIDENTIAL",
  });
  const { version } = await svc.saveDraft(maker, ruleSetId, body);
  const { approvalId } = await svc.publish(maker, ruleSetId, version);
  await approvals.decide(checker, approvalId, "approve");
  await db.admin.query(
    "update tenancy.approval_request set delay_until = now() - interval '1 minute' where id = $1",
    [approvalId],
  );
  await approvals.execute(checker, approvalId);
  decisionId = (
    await svc.evaluate(maker, { ruleSetId }, { itemType: "memo", counterpartyScore: SECRET_SCORE })
  ).id;
});
afterAll(async () => db?.end());

const req = (over: Partial<RevealRequest> = {}): RevealRequest => ({
  decisionId,
  input: "counterpartyScore",
  purpose: PURPOSE,
  purposeCode: "internal_audit",
  ...over,
});
const events = async (actor: string) =>
  (
    await db.admin.query(
      "select * from audit.security_event where tenant_id = $1 and actor_id = $2 order by occurred_at, id",
      [T, actor],
    )
  ).rows;
const alerts = async (principal: string) =>
  (
    await db.admin.query(
      `select envelope from rules.outbox where tenant_id = $1
          and type like '%.security.RevealRefusalsRepeated.v1'
          and envelope->'data'->>'principal_id' = $2`,
      [T, principal],
    )
  ).rows;

describe("the purpose code (#132 (4))", () => {
  it("is recorded as a business id beside the purpose digest; the rule is told the code", async () => {
    const grant = await svc.entitleReveal(reader, req({ purposeCode: "dispute" }));
    await svc.explain(reader, decisionId, { reveal: grant });
    const row = (
      await db.admin.query(
        "select business_ids from audit.ledger where $1 = any(business_ids) order by seq desc limit 1",
        [grant.id],
      )
    ).rows[0];
    expect(row.business_ids).toContain("purpose:dispute");
  });

  it("follows the product's own list when it gives one", async () => {
    const own = service({
      revealRule: { ...revealRule, purposeCodes: ["board_review", "dispute"] },
    });
    await expect(
      own.entitleReveal(reader, req({ purposeCode: "board_review" })),
    ).resolves.toMatchObject({ decisionId });
    await expect(
      own.entitleReveal(reader, req({ purposeCode: "internal_audit" })),
    ).rejects.toMatchObject({ meta: { reason: "purpose_code_invalid" } });
    expect(() => service({ revealRule: { ...revealRule, purposeCodes: [] } })).toThrow(/empty/);
    expect(() => service({ revealRule: { ...revealRule, purposeCodes: ["Bad Code"] } })).toThrow(
      /purposeCodes/,
    );
  });
});

describe("refused reveals as security events (#132 (5), audit/0012)", () => {
  it("records who, which decision and input, the reason and the code; never the value or the text", async () => {
    const who = "usr_rs_outsider";
    const ledgerBefore = (
      await db.admin.query("select count(*)::int as n from audit.ledger where tenant_id = $1", [T])
    ).rows[0].n;
    await expect(svc.entitleReveal(user(who), req())).rejects.toMatchObject({
      meta: { reason: "rule_refused" },
    });
    const rows = await events(who);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: T,
      actor_id: who,
      actor_type: "user",
      kind: "rules.reveal.refused",
      resource_type: "decision",
      resource_id: decisionId,
      detail: {
        reason: "rule_refused",
        input: "counterpartyScore",
        purpose_code: "internal_audit",
        rule_id: "demo.rs.reveal",
      },
    });
    expect(rows[0].id).toMatch(/^sev_/);
    const text = JSON.stringify(rows);
    expect(text).not.toContain(String(SECRET_SCORE));
    expect(text).not.toContain(PURPOSE);
    // Outside the business ledger: the refusal wrote no ledger row.
    const ledgerAfter = (
      await db.admin.query("select count(*)::int as n from audit.ledger where tenant_id = $1", [T])
    ).rows[0].n;
    expect(ledgerAfter).toBe(ledgerBefore);
  });

  it("records refusals of the grant step with the grant's input and code", async () => {
    const grant = await svc.entitleReveal(reader, req({ purposeCode: "complaint" }));
    await svc.explain(reader, decisionId, { reveal: grant });
    await expect(svc.explain(reader, decisionId, { reveal: grant })).rejects.toMatchObject({
      meta: { reason: "grant_used" },
    });
    const last = (await events("usr_rs_reader")).at(-1);
    expect(last.detail).toMatchObject({
      reason: "grant_used",
      input: "counterpartyScore",
      purpose_code: "complaint",
    });
  });

  it("keeps only well-formed names: a malformed input or code is left out, not stored", async () => {
    const who = "usr_rs_prober";
    await expect(
      svc.entitleReveal(user(who), req({ input: "x'; drop table--", purposeCode: "Not A Code" })),
    ).rejects.toMatchObject({ meta: { reason: "purpose_code_invalid" } });
    const [row] = await events(who);
    expect(row.detail).toEqual({ reason: "purpose_code_invalid", rule_id: "demo.rs.reveal" });
  });

  it("raises one RevealRefusalsRepeated at the fifth refusal in the window, ledgered once", async () => {
    const who = "usr_rs_repeat";
    const s = service({ revealRefusalAlert: { threshold: 5, windowMinutes: 15 } });
    for (let i = 1; i <= 7; i++) {
      await expect(s.entitleReveal(user(who), req())).rejects.toMatchObject({
        meta: { reason: "rule_refused" },
      });
      expect(await alerts(who)).toHaveLength(i < 5 ? 0 : 1);
    }
    expect(await events(who)).toHaveLength(7);
    const [{ envelope }] = await alerts(who);
    expect(envelope.data).toMatchObject({
      principal_id: who,
      principal_type: "user",
      refusals: 5,
      window_minutes: 15,
      last_reason: "rule_refused",
    });
    const ledgered = (
      await db.admin.query(
        "select actor_id from audit.ledger where tenant_id = $1 and action = $2 and resource_id = $3",
        [T, REVEAL_REFUSALS_REPEATED_ACTION, who],
      )
    ).rows;
    expect(ledgered).toEqual([{ actor_id: "svc_rules_security" }]);
    // Another principal's count is its own.
    expect(await alerts("usr_rs_outsider")).toHaveLength(0);
  });

  it("raises the alert for refused contexts too (impersonation, platform scope)", async () => {
    const who = "usr_rs_imp";
    const s = service({ revealRefusalAlert: { threshold: 2, windowMinutes: 15 } });
    const imp = { ...user(who), act: { sub: "usr_support", sessionId: "ses_1" } };
    for (let i = 0; i < 2; i++)
      await expect(s.entitleReveal(imp, req())).rejects.toMatchObject({
        meta: { reason: "context_not_allowed" },
      });
    expect(await alerts(who)).toHaveLength(1);
  });

  it("is tenant-scoped, append-only and not writable by the application role", async () => {
    // Another tenant reads none of this tenant's events.
    const other = withTenant("tnt_rt", ["ORG_ADMIN"], { principal: { id: "usr_rt" } });
    const seen = await db.kernel.read(
      other,
      async (tx) =>
        (await tx.query<{ n: number }>("select count(*)::int as n from audit.security_event")).rows,
    );
    expect(seen[0]!.n).toBe(0);
    const mine = await db.kernel.read(
      reader,
      async (tx) =>
        (await tx.query<{ n: number }>("select count(*)::int as n from audit.security_event")).rows,
    );
    expect(mine[0]!.n).toBeGreaterThan(0);
    await expect(
      db.admin.query("update audit.security_event set detail = '{}' where tenant_id = $1", [T]),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.admin.query("delete from audit.security_event where tenant_id = $1", [T]),
    ).rejects.toThrow(/append-only/);
    // app_rw holds no insert, update or delete of its own (only svc_security_event inserts).
    const grants = (
      await db.admin.query(
        `select privilege_type from information_schema.role_table_grants
          where table_schema = 'audit' and table_name = 'security_event' and grantee = 'app_rw'`,
      )
    ).rows.map((r) => r.privilege_type);
    expect(grants).toEqual(["SELECT"]);
  });

  it("a product cannot turn reveals on without the record and the alert", () => {
    expect(() => service({ securityEvents: undefined })).toThrow(/securityEvents/);
    expect(() => service({ refusalCounter: undefined })).toThrow(/refusalCounter/);
    expect(() => service({ outbox: undefined })).toThrow(/outbox/);
    expect(() => service({ revealRefusalAlert: { threshold: 1 } })).toThrow(/threshold/);
    expect(() => service({ revealRefusalAlert: { windowMinutes: 0 } })).toThrow(/windowMinutes/);
    // Without a reveal rule nothing is needed (reveals are off).
    expect(() =>
      service({ revealRule: undefined, securityEvents: undefined, refusalCounter: undefined }),
    ).not.toThrow();
  });
});

describe("PgSecurityEvents", () => {
  it("refuses a detail that could carry a value: nested, long or unprintable", async () => {
    const sink = new PgSecurityEvents({ pool: db.pool });
    const base = {
      kind: "rules.reveal.refused" as const,
      resourceType: "decision",
      resourceId: null,
    };
    for (const detail of [
      { v: { nested: 1 } },
      { v: "x".repeat(129) },
      { v: "line\nbreak" },
      { "Bad Key": "x" },
    ])
      await expect(
        sink.record(reader, { ...base, detail: detail as never }),
      ).rejects.toBeInstanceOf(RangeError);
    await expect(sink.record(reader, { ...base, detail: { reason: "ok" } })).resolves.toMatchObject(
      {
        id: expect.stringMatching(/^sev_/),
      },
    );
  });
});
