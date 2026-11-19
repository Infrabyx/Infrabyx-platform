// The approvals a signed-in checker may check, paged (Udofin PR-UDF-047, R1-D-200): only pending,
// unexpired requests in the tenant that `decide`'s own rule would let this principal decide now;
// never the payload, its digest or class, or the diff; keyset pages on (created_at, id).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEntryInput, AuditSink, KernelContext, Tx } from "@infrabyx/contracts/kernel";
import { LocalKms, localTenantKeyId, newId } from "@infrabyx/crypto";
import { ApprovalsEngine, type TenantApprovalPolicy } from "./approvals/index.js";
import { FieldCrypto } from "./field-crypto.js";
import { PgKernel } from "./kernel.js";
import { freshDb, type TestDb } from "./__tests__/pg.js";

class RecordingAudit implements AuditSink {
  async record(tx: Tx, _e: AuditEntryInput): Promise<{ id: string }> {
    tx.markAudited();
    return { id: "led_x" };
  }
}

let db: TestDb;
let kernel: PgKernel;
let engine: ApprovalsEngine;
const policy: Record<string, TenantApprovalPolicy> = {};
let tenants = 0;

const user = (id: string, roles: string[], tenantId: string): KernelContext => ({
  tenantId,
  principal: { id, type: "user", roles },
});
const errName = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: Error & { code?: string }) => e.code ?? e.name,
  );

/** A tenant of its own for each test, so no test sees another's requests. */
async function tenant(): Promise<string> {
  const id = `tnt_chk${++tenants}`;
  await db.admin.query("insert into tenancy.tenant (id, product, name) values ($1, 'UDF', $1)", [
    id,
  ]);
  return id;
}

const MAKER = newId("usr");
const raise = (
  tenantId: string,
  input: Partial<Parameters<ApprovalsEngine["request"]>[1]> = {},
  maker = MAKER,
) =>
  kernel
    .mutate(
      user(maker, ["ORG_MAKER"], tenantId),
      (tx) =>
        engine.request(tx, {
          action: "udf.kyc.override",
          riskClass: "R2",
          payload: { applicant: "app-1" },
          summary: "override",
          ...input,
        }),
      { action: "udf.request" },
    )
    .then((r) => r.id);

const ids = async (ctx: KernelContext, limit?: number) =>
  (await engine.listCheckable(ctx, limit === undefined ? {} : { limit })).items.map((i) => i.id);

/** Every page, following nextCursor. */
async function allPages(ctx: KernelContext, limit: number): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 50; i++) {
    const page = await engine.listCheckable(ctx, { limit, ...(cursor ? { cursor } : {}) });
    out.push(...page.items.map((x) => x.id));
    if (!page.nextCursor) return out;
    cursor = page.nextCursor;
  }
  throw new Error("paging did not end");
}

beforeAll(async () => {
  db = await freshDb();
  kernel = new PgKernel({ pool: db.pool });
  engine = new ApprovalsEngine({
    kernel,
    audit: new RecordingAudit(),
    product: "UDF",
    fieldCrypto: new FieldCrypto({ kms: new LocalKms(), keyIdFor: localTenantKeyId }),
    tenantPolicy: async (_ctx, action) => policy[action] ?? {},
  });
  engine.register("udf.kyc.override", { checkerRoles: ["ORG_CHECKER", "ORG_ADMIN"] });
  engine.register("udf.loan.release", {
    checkerRoles: ["ORG_CHECKER", "ORG_ADMIN"],
    amountOf: (p) => Number(p.amountMinor),
  });
});
afterAll(async () => db?.end());

describe("R1-D-200 ApprovalsEngine.listCheckable (PR-UDF-047)", () => {
  it("lists a checker's requests with no payload field, never the maker's own or a non-checker's", async () => {
    const t = await tenant();
    const id = await raise(t, {
      payload: { applicant: "app-2", note: "sealed" },
      payloadDataClass: "CONFIDENTIAL",
      diff: { before: { status: "HELD" }, after: { status: "NOT_COMPLETE" } },
    });
    const checker = user(newId("usr"), ["ORG_CHECKER"], t);
    const page = await engine.listCheckable(checker);
    expect(page.nextCursor).toBeNull();
    expect(page.items).toHaveLength(1);
    const item = page.items[0]!;
    expect(Object.keys(item).sort()).toEqual([
      "action",
      "approvals",
      "createdAt",
      "currentLevel",
      "expiresAt",
      "id",
      "makerId",
      "requiredCheckers",
      "riskClass",
      "summary",
    ]);
    expect(item).toMatchObject({
      id,
      action: "udf.kyc.override",
      summary: "override",
      riskClass: "R2",
      makerId: MAKER,
      currentLevel: null,
      requiredCheckers: 1,
      approvals: 0,
    });
    expect(item.createdAt).toBeInstanceOf(Date);
    expect(item.expiresAt.getTime()).toBeGreaterThan(item.createdAt.getTime());
    expect(JSON.stringify(page)).not.toMatch(/sealed|payload|digest|NOT_COMPLETE|HELD/);

    // The maker never checks, whatever roles they hold; a role outside the action's checkers sees nothing.
    expect(await ids(user(MAKER, ["ORG_CHECKER", "ORG_ADMIN"], t))).toEqual([]);
    expect(await ids(user(newId("usr"), ["ORG_MAKER", "ORG_VIEWER"], t))).toEqual([]);
    // ORG_OWNER is a default checker but not one of this action's.
    expect(await ids(user(newId("usr"), ["ORG_OWNER"], t))).toEqual([]);
  });

  it("applies the tenant's narrowing of the checker roles (mc.checker_roles)", async () => {
    const t = await tenant();
    const id = await raise(t, { action: "udf.loan.release", payload: { amountMinor: 10 } });
    const checker = user(newId("usr"), ["ORG_CHECKER"], t);
    const admin = user(newId("usr"), ["ORG_ADMIN"], t);
    expect(await ids(checker)).toEqual([id]);
    policy["udf.loan.release"] = { checkerRoles: ["ORG_ADMIN"] };
    try {
      expect(await ids(checker)).toEqual([]);
      expect(await ids(admin)).toEqual([id]);
      // The list and decide agree: the narrowed-out checker is refused, the admin may decide.
      expect(await errName(engine.decide(checker, id, "approve"))).toBe("IPB-UX-011");
    } finally {
      delete policy["udf.loan.release"];
    }
  });

  it("shows a levelled request only to the open level's roles", async () => {
    const t = await tenant();
    const id = await raise(t, {
      action: "udf.kyc.override",
      levels: [{ checkerRoles: ["ORG_CHECKER"] }, { checkerRoles: ["ORG_ADMIN"] }],
    });
    const l1 = user(newId("usr"), ["ORG_CHECKER"], t);
    const l1b = user(newId("usr"), ["ORG_CHECKER"], t);
    const l2 = user(newId("usr"), ["ORG_ADMIN"], t);
    expect((await engine.listCheckable(l1)).items).toMatchObject([
      { id, currentLevel: 1, requiredCheckers: 2, approvals: 0 },
    ]);
    expect(await ids(l2)).toEqual([]);
    await engine.decide(l1, id, "approve");
    // Level 2 is open: only its role sees it; level 1's other checkers and its decider do not.
    expect((await engine.listCheckable(l2)).items).toMatchObject([
      { id, currentLevel: 2, requiredCheckers: 2, approvals: 1 },
    ]);
    expect(await ids(l1b)).toEqual([]);
    expect(await ids(l1)).toEqual([]);
    expect(await errName(engine.decide(l1b, id, "approve"))).toBe("IPB-UX-011");
  });

  it("drops a request this checker has decided, and every request no longer pending", async () => {
    const t = await tenant();
    policy["udf.loan.release"] = { dualCheckerAbove: 100 };
    try {
      const dual = await raise(t, { action: "udf.loan.release", payload: { amountMinor: 500 } });
      const single = await raise(t, { payload: { applicant: "app-3" } });
      const c1 = user(newId("usr"), ["ORG_CHECKER"], t);
      const c2 = user(newId("usr"), ["ORG_CHECKER"], t);
      expect(await ids(c1)).toEqual([dual, single]);
      await engine.decide(c1, dual, "approve");
      expect(await ids(c1)).toEqual([single]);
      expect((await engine.listCheckable(c2)).items[0]).toMatchObject({
        id: dual,
        requiredCheckers: 2,
        approvals: 1,
      });
      await engine.decide(c2, single, "reject");
      expect(await ids(c1)).toEqual([]);
      expect(await ids(c2)).toEqual([dual]);
      await engine.cancel(user(MAKER, ["ORG_MAKER"], t), dual);
      expect(await ids(c2)).toEqual([]);
    } finally {
      delete policy["udf.loan.release"];
    }
  });

  it("leaves out expired requests, whether or not the expiry timer has run", async () => {
    const t = await tenant();
    const due = await raise(t, { payload: { applicant: "app-4" } });
    const timed = await raise(t, { payload: { applicant: "app-5" } });
    const live = await raise(t, { payload: { applicant: "app-6" } });
    await db.admin.query(
      "update tenancy.approval_request set expires_at = now() - interval '1 minute' where id = any($1)",
      [[due, timed]],
    );
    await engine.expire(user("usr_timer", [], t), timed);
    const checker = user(newId("usr"), ["ORG_CHECKER"], t);
    expect(await ids(checker)).toEqual([live]);
    expect(await errName(engine.decide(checker, due, "approve"))).toBe("IPB-UX-012");
  });

  it("never lists another tenant's requests", async () => {
    const a = await tenant();
    const b = await tenant();
    const inA = await raise(a);
    const inB = await raise(b);
    const checker = newId("usr");
    expect(await ids(user(checker, ["ORG_CHECKER"], a))).toEqual([inA]);
    expect(await ids(user(checker, ["ORG_CHECKER"], b))).toEqual([inB]);
    // A cursor is only a position: in another tenant it still lists that tenant's rows alone.
    const first = await engine.listCheckable(user(checker, ["ORG_CHECKER"], a), { limit: 1 });
    expect(first.nextCursor).toBeNull();
    await raise(a);
    const paged = await engine.listCheckable(user(checker, ["ORG_CHECKER"], a), { limit: 1 });
    const other = await engine.listCheckable(user(checker, ["ORG_CHECKER"], b), {
      cursor: paged.nextCursor!,
    });
    expect(other.items.map((i) => i.id)).toEqual([inB]);
  });

  it("gives an agent an empty list, even with a checker role", async () => {
    const t = await tenant();
    await raise(t);
    const agent: KernelContext = {
      tenantId: t,
      principal: { id: "agt_vidhi", type: "agent", roles: ["AGT_VIDHI", "ORG_CHECKER"] },
    };
    expect(await engine.listCheckable(agent)).toEqual({ items: [], nextCursor: null });
  });

  it("pages by (created_at, id), stable across inserts and microsecond ties", async () => {
    const t = await tenant();
    const first: string[] = [];
    for (let i = 0; i < 5; i++) first.push(await raise(t, { payload: { n: i } }));
    // Two requests in the same microsecond, and two a microsecond apart within one millisecond.
    await db.admin.query(
      `update tenancy.approval_request set created_at = v.at::timestamptz
         from (values ($1, '2026-01-01 00:00:00.000001+00'), ($2, '2026-01-01 00:00:00.000001+00'),
                      ($3, '2026-01-01 00:00:00.000002+00'), ($4, '2026-01-01 00:00:00.000003+00'),
                      ($5, '2026-01-01 00:00:00.000004+00')) as v(id, at)
        where approval_request.id = v.id`,
      first,
    );
    const ordered = [...first.slice(0, 2)].sort().concat(first.slice(2));
    const checker = user(newId("usr"), ["ORG_CHECKER"], t);
    expect(await allPages(checker, 1)).toEqual(ordered);
    expect(await allPages(checker, 2)).toEqual(ordered);

    // A page, then inserts, then the rest: nothing is skipped or repeated; new requests come last.
    const p1 = await engine.listCheckable(checker, { limit: 2 });
    expect(p1.items.map((i) => i.id)).toEqual(ordered.slice(0, 2));
    const later = [await raise(t, { payload: { n: 9 } }), await raise(t, { payload: { n: 10 } })];
    const rest: string[] = [];
    let cursor = p1.nextCursor;
    while (cursor) {
      const p = await engine.listCheckable(checker, { limit: 2, cursor });
      rest.push(...p.items.map((i) => i.id));
      cursor = p.nextCursor;
    }
    expect([...p1.items.map((i) => i.id), ...rest]).toEqual([...ordered, ...later]);

    // Rows the checker cannot check do not end a page early.
    for (let i = 0; i < 4; i++)
      await raise(t, { action: "udf.loan.release", payload: { amountMinor: i } });
    const owner = user(newId("usr"), ["ORG_OWNER", "ORG_CHECKER"], t);
    policy["udf.loan.release"] = { checkerRoles: ["ORG_ADMIN"] };
    try {
      expect(await allPages(owner, 3)).toEqual([...ordered, ...later]);
    } finally {
      delete policy["udf.loan.release"];
    }
  });

  it("refuses a bad cursor or limit before any read, and defaults to 25 a page", async () => {
    const t = await tenant();
    for (let i = 0; i < 27; i++) await raise(t, { payload: { n: i } });
    const checker = user(newId("usr"), ["ORG_CHECKER"], t);
    const def = await engine.listCheckable(checker);
    expect(def.items).toHaveLength(25);
    expect(def.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect((await engine.listCheckable(checker, { limit: 100 })).items).toHaveLength(27);
    expect((await engine.listCheckable(checker, { limit: 1 })).items).toHaveLength(1);
    for (const limit of [0, 101, -1, 1.5, Number.NaN])
      expect(await errName(engine.listCheckable(checker, { limit }))).toBe("RangeError");

    const good = def.nextCursor!;
    const text = Buffer.from(good, "base64url").toString("utf8");
    const enc = (s: string) => Buffer.from(s, "utf8").toString("base64url");
    const bad = [
      "",
      "not a cursor!",
      `${good}=`,
      enc("x"),
      enc(text.replace("|apr_", "|usr_")),
      enc(text.replace(/^\d{4}-\d{2}-\d{2}/, "2026-02-30")),
      enc(text.replace(/T\d{2}/, "T24")),
      enc(text.replace(/\.\d{6}Z/, ".000Z")),
      enc(`${text}|extra`),
      enc(text.replace(/^\d{4}/, "0000")),
      "A".repeat(200),
    ];
    for (const cursor of bad)
      expect(await errName(engine.listCheckable(checker, { cursor }))).toBe("RangeError");
    // An agent is refused a bad cursor too: input is checked first.
    const agent: KernelContext = {
      tenantId: t,
      principal: { id: "agt_vidhi", type: "agent", roles: ["AGT_VIDHI"] },
    };
    expect(await errName(engine.listCheckable(agent, { cursor: "bad!" }))).toBe("RangeError");
    // The good cursor continues where the first page ended.
    expect((await engine.listCheckable(checker, { cursor: good })).items).toHaveLength(2);
  });
});
