// Entitled reveal of a CONFIDENTIAL input in `explain` (PR-LDC-59, #130, R1-D-157 (1), R1-D-173)
// on PostgreSQL 18 with every platform migration: the shared contract from `@infrabyx/testing`,
// then the cases that need the real decision log, FieldCrypto and ledger.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuditSink, KernelContext } from "@infrabyx/contracts/kernel";
import type { RevealRequest, RuleSetBody } from "@infrabyx/contracts/ports";
import { REVEAL_GRANT_TTL_MS } from "@infrabyx/contracts/ports";
import { localTenantKeyId } from "@infrabyx/crypto";
import { ApprovalsEngine, FieldCrypto, PgOutbox } from "@infrabyx/tenancy";
import {
  defineRulesRevealContract,
  fakeKms,
  startPostgres,
  withTenant,
  type RulesRevealFixture,
  type TestDatabase,
} from "@infrabyx/testing";
import { REVEAL_ACTION, RulesService, type RulesServiceOptions } from "../service.js";

let db: TestDatabase;
let fieldCrypto: FieldCrypto;
let svc: RulesService;
const asked: RevealRequest[] = [];

const maker = withTenant("tnt_ra", ["ORG_ADMIN"], { principal: { id: "usr_ra_maker" } });
const checker = withTenant("tnt_ra", ["ORG_CHECKER"], { principal: { id: "usr_ra_checker" } });
const reader = withTenant("tnt_ra", ["ORG_MEMBER"], { principal: { id: "usr_ra_reader" } });
const outsider = withTenant("tnt_ra", ["ORG_MEMBER"], { principal: { id: "usr_ra_outsider" } });
const otherTenant = withTenant("tnt_rb", ["ORG_ADMIN"], { principal: { id: "usr_ra_reader" } });

/** A classification table with one input of each revealable and non-revealable class. */
const body: RuleSetBody = {
  format: "ipb.decision_table.v1",
  hit_policy: "first",
  inputs: [
    { name: "itemType", type: "string", dataClass: "INTERNAL" },
    { name: "counterpartyScore", type: "integer", dataClass: "CONFIDENTIAL" },
    { name: "idNumberValid", type: "boolean", dataClass: "REGULATED" },
  ],
  outputs: [{ name: "band", type: "string", dataClass: "INTERNAL", statutory: false }],
  rows: [
    {
      id: "demo.classify.sensitive",
      when: 'itemType == "board_paper" && counterpartyScore >= 60 && idNumberValid',
      then: { band: "sensitive" },
      verify: false,
    },
    { id: "demo.classify.default", when: "true", then: { band: "standard" }, verify: false },
  ],
};
const VALUES = { itemType: "board_paper", counterpartyScore: 73519, idNumberValid: true };

/** The product's own rule: only the reader (as a user or a service) may see a value. */
const revealRule = {
  id: "demo.board.reveal",
  async allows(ctx: KernelContext, req: RevealRequest) {
    asked.push(req);
    return ["usr_ra_reader", "svc_ra_reader"].includes(ctx.principal.id);
  },
};

function service(
  over: { [K in keyof RulesServiceOptions]?: RulesServiceOptions[K] | undefined } = {},
): RulesService {
  // Each service registers its publish action, so each has its own approvals engine.
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
    ...over,
  } as RulesServiceOptions);
}

let ruleSetId = "";
let decisionId = "";
let otherDecisionId = "";

beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_ra', 'LDC', 'A'), ('tnt_rb', 'LDC', 'B') on conflict do nothing",
  );
  fieldCrypto = new FieldCrypto({ kms: fakeKms(), keyIdFor: localTenantKeyId });
  const approvals = new ApprovalsEngine({
    kernel: db.kernel,
    audit: db.audit,
    outbox: new PgOutbox(),
    product: "LDC",
    fieldCrypto,
  });
  svc = new RulesService({
    kernel: db.kernel,
    audit: db.audit,
    approvals,
    product: "LDC",
    outbox: new PgOutbox(),
    fieldCrypto,
    evalTimeoutMs: 2000,
    revealRule,
  });
  ({ ruleSetId } = await svc.createRuleSet(maker, {
    key: "demo.board.classify",
    ownerModule: "board",
    dataClass: "REGULATED",
  }));
  const { version } = await svc.saveDraft(maker, ruleSetId, body);
  const { approvalId } = await svc.publish(maker, ruleSetId, version);
  await approvals.decide(checker, approvalId, "approve");
  await db.admin.query(
    "update tenancy.approval_request set delay_until = now() - interval '1 minute' where id = $1",
    [approvalId],
  );
  await approvals.execute(checker, approvalId);
  decisionId = (await svc.evaluate(maker, { ruleSetId }, VALUES)).id;
  otherDecisionId = (await svc.evaluate(maker, { ruleSetId }, { ...VALUES, itemType: "memo" })).id;
});
afterAll(async () => db?.end());
afterEach(() => vi.restoreAllMocks());

async function ledgerFor(id: string) {
  const rows = (
    await db.admin.query(
      "select * from audit.ledger where resource_id = $1 or $1 = any(business_ids) order by seq",
      [id],
    )
  ).rows;
  return { actions: rows.map((r) => r.action as string), text: JSON.stringify(rows) };
}

defineRulesRevealContract("RulesService on PostgreSQL", async (): Promise<RulesRevealFixture> => ({
  rules: svc,
  allowed: reader,
  refused: outsider,
  otherTenant,
  decisionId,
  otherDecisionId,
  inputs: { clear: "itemType", confidential: "counterpartyScore", regulated: "idNumberValid" },
  values: {
    clear: VALUES.itemType,
    confidential: VALUES.counterpartyScore,
    regulated: VALUES.idNumberValid,
  },
  ledgerFor,
}));

describe("explain reveal on the real decision log (R1-D-173)", () => {
  const req = (over: Partial<RevealRequest> = {}): RevealRequest => ({
    decisionId,
    input: "counterpartyScore",
    purpose: "  board review of the classification  ",
    ...over,
  });

  it("ledgers who, which decision, which input, the rule and the grant; the purpose under the digest", async () => {
    asked.length = 0;
    const grant = await svc.entitleReveal(reader, req());
    // The rule is told the trimmed purpose.
    expect(asked).toEqual([
      { decisionId, input: "counterpartyScore", purpose: "board review of the classification" },
    ]);
    await svc.explain(reader, decisionId, { reveal: grant });
    const row = (
      await db.admin.query(
        "select * from audit.ledger where action = $1 and $2 = any(business_ids) order by seq desc limit 1",
        [REVEAL_ACTION, grant.id],
      )
    ).rows[0];
    expect(row).toMatchObject({
      tenant_id: "tnt_ra",
      actor_id: "usr_ra_reader",
      actor_type: "user",
      resource_type: "decision",
      resource_id: decisionId,
      business_ids: [decisionId, grant.id, "input:counterpartyScore", "rule:demo.board.reveal"],
    });
    expect(row.after_digest).toMatch(/^[0-9a-f]{64}$/);
    // Nothing else changed: the decision log row is untouched and still sealed.
    const d = (await db.admin.query("select * from rules.decision_log where id = $1", [decisionId]))
      .rows[0];
    expect(d.inputs).toEqual({ itemType: "board_paper" });
    expect(Buffer.from(d.inputs_enc).toString("latin1")).not.toContain("73519");
  });

  it("a grant is refused after 60 seconds", async () => {
    const grant = await svc.entitleReveal(reader, req());
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + REVEAL_GRANT_TTL_MS + 1);
    await expect(svc.explain(reader, decisionId, { reveal: grant })).rejects.toMatchObject({
      code: "IPB-RULE-004",
      meta: { reason: "grant_expired" },
    });
  });

  it("a grant from another service instance is refused", async () => {
    const grant = await service().entitleReveal(reader, req());
    await expect(svc.explain(reader, decisionId, { reveal: grant })).rejects.toMatchObject({
      meta: { reason: "grant_invalid" },
    });
  });

  it("a grant used under impersonation or in a platform context is refused and used up", async () => {
    const g1 = await svc.entitleReveal(reader, req());
    await expect(
      svc.explain({ ...reader, act: { sub: "usr_support", sessionId: "ses_1" } }, decisionId, {
        reveal: g1,
      }),
    ).rejects.toMatchObject({ meta: { reason: "context_not_allowed" } });
    await expect(svc.explain(reader, decisionId, { reveal: g1 })).rejects.toMatchObject({
      meta: { reason: "grant_used" },
    });
    const g2 = await svc.entitleReveal(reader, req());
    await expect(
      svc.explain({ ...reader, scope: "platform" }, decisionId, { reveal: g2 }),
    ).rejects.toMatchObject({ meta: { reason: "context_not_allowed" } });
  });

  it("an external principal is refused; a service principal the rule allows is not", async () => {
    await expect(
      svc.entitleReveal({ ...reader, principal: { ...reader.principal, type: "external" } }, req()),
    ).rejects.toMatchObject({ meta: { reason: "context_not_allowed" } });
    const svcPrincipal = withTenant("tnt_ra", ["ORG_MEMBER"], {
      principal: { id: "svc_ra_reader", type: "service" },
    });
    const grant = await svc.entitleReveal(svcPrincipal, req());
    const x = await svc.explain(svcPrincipal, decisionId, { reveal: grant });
    expect(x.inputs[1]).toEqual({ name: "counterpartyScore", value: 73519, revealed: true });
  });

  it("a ledger failure returns nothing", async () => {
    const failing: AuditSink = {
      async record(tx, e) {
        if (e.action === REVEAL_ACTION) throw new Error("ledger unavailable");
        return db.audit.record(tx, e);
      },
    };
    const s = service({ audit: failing });
    const before = (await ledgerFor(decisionId)).actions.length;
    const grant = await s.entitleReveal(reader, req());
    await expect(s.explain(reader, decisionId, { reveal: grant })).rejects.toThrow(
      "ledger unavailable",
    );
    expect((await ledgerFor(decisionId)).actions).toHaveLength(before);
  });

  it("the product's rule throwing is a refusal; without a rule nothing is revealed", async () => {
    const throwing = service({
      revealRule: {
        id: "demo.board.throws",
        allows: () => Promise.reject(new Error("policy store down")),
      },
    });
    await expect(throwing.entitleReveal(reader, req())).rejects.toMatchObject({
      code: "IPB-RULE-004",
      meta: { reason: "rule_refused" },
    });
    const none = service({ revealRule: undefined });
    await expect(none.entitleReveal(reader, req())).rejects.toMatchObject({
      meta: { reason: "no_reveal_rule" },
    });
    expect(() => service({ revealRule: { id: "Bad Id", allows: async () => true } })).toThrow(
      /revealRule.id/,
    );
  });

  it("a decision whose inputs were not recorded (input_invalid) has nothing to reveal", async () => {
    const bad = await svc.evaluate(maker, { ruleSetId }, { itemType: 7 });
    expect(bad.reason).toBe("input_invalid");
    await expect(svc.entitleReveal(reader, req({ decisionId: bad.id }))).rejects.toMatchObject({
      meta: { reason: "inputs_not_recorded" },
    });
  });
});
