// Work Inbox snooze, ordering and the by-record list (LawDocsComply PR-LDC-46, R1-D-206; workflow/0005)
// on PostgreSQL 18 with every platform migration applied: per person, back at its time with no timer,
// never past due or over an escalation, the inbox's own visibility rule, ledgered, tenant-isolated.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { InboxItemInput, KernelContext } from "@infrabyx/contracts/kernel";
import { startPostgres, withTenant, type TestDatabase } from "@infrabyx/testing";
import { InboxService, INBOX_SNOOZE_MAX_DAYS } from "../inbox.js";

let db: TestDatabase;
let inbox: InboxService;

const HOUR = 3_600_000;
const ctx = (id: string, roles: string[], tenantId = "tnt_a"): KernelContext =>
  withTenant(tenantId, roles, { principal: { id } });
const alice = ctx("usr_alice", ["ORG_MEMBER"]);
const bob = ctx("usr_bob", ["ORG_MEMBER"]);
const carol = ctx("usr_carol", ["ORG_VIEWER"]);
const maker = ctx("usr_maker", ["ORG_MEMBER"]);
const raiser = ctx("usr_raiser", ["ORG_ADMIN"]);
const later = (hours: number) => new Date(Date.now() + hours * HOUR);
const why = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: Error) => e.name,
  );

let n = 0;
async function raise(
  over: Partial<InboxItemInput> = {},
  c: KernelContext = raiser,
): Promise<string> {
  n += 1;
  const { id } = await db.kernel.mutate(c, (tx) =>
    inbox.raise(tx, {
      type: "task",
      productModule: "compliance",
      recordRef: `obl_${n}`,
      title: `Task ${n}`,
      assignee: { kind: "user", id: "usr_alice" },
      deepLink: "/x",
      helpKey: "hlp.compliance.item",
      ...over,
    }),
  );
  return id;
}
const ids = async (c: KernelContext, f: Parameters<InboxService["list"]>[1] = {}) =>
  (await inbox.list(c, { productModule: "compliance", ...f })).map((i) => i.id);
const ledger = async (action: string, id: string) =>
  (
    await db.admin.query<{ n: number }>(
      "select count(*)::int as n from audit.ledger where action = $1 and resource_id = $2",
      [action, id],
    )
  ).rows[0]!.n;
/** Move a snooze's end into the past, as time passing would; no timer or poller runs. */
const elapse = (id: string) =>
  db.admin.query(
    "update workflow.inbox_snooze set snoozed_until = now() - interval '1 second' where item_id = $1",
    [id],
  );

beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'LDC', 'A'), ('tnt_b', 'LDC', 'B') on conflict do nothing",
  );
  inbox = new InboxService({ kernel: db.kernel, audit: db.audit, product: "LDC" });
});
afterAll(async () => db?.end());

describe("@IPB-07-AT-10 inbox snooze (PR-LDC-46)", () => {
  it("hides the item from the snoozer until its time, then it is back with no timer", async () => {
    const id = await raise();
    expect(await ids(alice)).toContain(id);
    const badge = await inbox.badgeCount(alice);
    const until = later(2);
    expect(await inbox.snooze(alice, id, until)).toEqual({ snoozedUntil: until });
    expect(await ids(alice)).not.toContain(id);
    expect(await inbox.badgeCount(alice)).toBe(badge - 1);
    const only = await inbox.list(alice, { snoozed: "only" });
    expect(only.map((i) => i.id)).toEqual([id]);
    expect(only[0]!.snoozedUntil?.getTime()).toBe(until.getTime());
    expect(await ids(alice, { snoozed: "include" })).toContain(id);
    expect(await db.admin.query("select 1 from workflow.timer where ref = $1", [id])).toMatchObject(
      { rowCount: 0 },
    );
    await elapse(id);
    const back = await inbox.list(alice, { recordRef: (await item(id)).recordRef });
    expect(back.map((i) => i.id)).toEqual([id]);
    expect(back[0]!.snoozedUntil).toBeNull();
    expect(await inbox.badgeCount(alice)).toBe(badge);
    expect(await ledger("inbox.item.snooze", id)).toBe(1);
  });

  it("is per person: another holder of the role still sees a role item", async () => {
    const id = await raise({ assignee: { kind: "role", id: "ORG_MEMBER" } });
    await inbox.snooze(alice, id, later(1));
    expect(await ids(alice)).not.toContain(id);
    expect(await ids(bob)).toContain(id);
    expect((await inbox.list(bob, { snoozed: "only" })).map((i) => i.id)).not.toContain(id);
  });

  it("unsnooze brings it back and a second snooze replaces the time; both ledgered", async () => {
    const id = await raise();
    await inbox.snooze(alice, id, later(1));
    await inbox.snooze(alice, id, later(5));
    const [s] = await inbox.list(alice, { snoozed: "only", recordRef: (await item(id)).recordRef });
    expect(s!.snoozedUntil!.getTime()).toBeGreaterThan(later(4).getTime());
    await inbox.unsnooze(alice, id);
    expect(await ids(alice)).toContain(id);
    await inbox.unsnooze(alice, id); // nothing active: still ledgered
    expect(await ledger("inbox.item.snooze", id)).toBe(2);
    expect(await ledger("inbox.item.unsnooze", id)).toBe(2);
    const rows = await db.admin.query<{ cleared_at: Date | null }>(
      "select cleared_at from workflow.inbox_snooze where item_id = $1",
      [id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.cleared_at).not.toBeNull();
  });

  it("refuses times out of bounds before anything is written", async () => {
    const id = await raise();
    for (const until of [
      new Date(Date.now() - 1000),
      new Date(Date.now() + (INBOX_SNOOZE_MAX_DAYS * 24 + 1) * HOUR),
      new Date(Number.NaN),
      "2030-01-01" as unknown as Date,
    ])
      expect(await why(inbox.snooze(alice, id, until))).toBe("RangeError");
    expect(await ledger("inbox.item.snooze", id)).toBe(0);
    // The table holds the bound too.
    await expect(
      db.admin.query(
        `insert into workflow.inbox_snooze (tenant_id, item_id, principal_id, snoozed_until)
         values ('tnt_a', $1, 'usr_alice', now() + interval '31 days')`,
        [id],
      ),
    ).rejects.toThrow(/inbox_snooze_bounded/);
  });

  it("never hides an item past its due time", async () => {
    const due = later(3);
    const id = await raise({ dueAt: due.toISOString() });
    expect(await why(inbox.snooze(alice, id, later(4)))).toBe("RangeError");
    await inbox.snooze(alice, id, later(2));
    expect(await ids(alice)).not.toContain(id);
    // The item falls due while snoozed (its time moved back): it shows again at once.
    await db.admin.query(
      "update workflow.inbox_item set due_at = now() - interval '1 minute' where id = $1",
      [id],
    );
    expect(await ids(alice)).toContain(id);
    expect(await why(inbox.snooze(alice, id, later(1)))).toBe("ConflictError");
    expect(await ledger("inbox.item.snooze", id)).toBe(1);
  });

  it("never hides an escalation: an escalated item shows again, an escalation is not snoozable", async () => {
    const id = await raise({ assignee: { kind: "role", id: "ORG_MEMBER" } });
    await inbox.snooze(alice, id, later(6));
    expect(await ids(alice)).not.toContain(id);
    expect(await inbox.escalate(alice, id)).toBe("done");
    expect(await ids(alice)).toContain(id);
    expect(await why(inbox.snooze(alice, id, later(1)))).toBe("ConflictError");
    const admin = ctx("usr_admin", ["ORG_ADMIN"]);
    const esc = (await inbox.list(admin, { recordRef: (await item(id)).recordRef })).find(
      (i) => i.id !== id,
    );
    expect(esc?.title).toMatch(/^Escalated/);
    expect(await why(inbox.snooze(admin, esc!.id, later(1)))).toBe("ConflictError");
  });

  it("only someone who sees the item may snooze it (the inbox's own rule)", async () => {
    const mine = await raise();
    const role = await raise({
      assignee: { kind: "role", id: "ORG_MEMBER" },
      excludePrincipal: "usr_maker",
    });
    expect(await why(inbox.snooze(bob, mine, later(1)))).toBe("NotFoundError");
    expect(await why(inbox.snooze(carol, role, later(1)))).toBe("NotFoundError");
    expect(await why(inbox.snooze(maker, role, later(1)))).toBe("NotFoundError");
    expect(await why(inbox.unsnooze(bob, mine))).toBe("NotFoundError");
    expect(await why(inbox.snooze(alice, "ibx_01JZZZZZZZZZZZZZZZZZZZZZZZ", later(1)))).toBe(
      "NotFoundError",
    );
    expect(await inbox.snooze(bob, role, later(1))).toHaveProperty("snoozedUntil");
    await inbox.resolve(alice, mine);
    expect(await why(inbox.snooze(alice, mine, later(1)))).toBe("NotFoundError");
    expect(await ledger("inbox.item.snooze", mine)).toBe(0);
  });

  it("another tenant neither sees nor snoozes the item, nor reads the snooze", async () => {
    const id = await raise();
    await inbox.snooze(alice, id, later(1));
    const other = ctx("usr_alice", ["ORG_MEMBER"], "tnt_b");
    expect(await why(inbox.snooze(other, id, later(1)))).toBe("NotFoundError");
    expect(await why(inbox.unsnooze(other, id))).toBe("NotFoundError");
    expect(await inbox.list(other, { snoozed: "include" })).toEqual([]);
    const seen = await db.kernel.read(other, (tx) =>
      tx.query("select * from workflow.inbox_snooze"),
    );
    expect(seen.rowCount).toBe(0);
    const forced = await db.admin.query<{ f: boolean }>(
      "select relforcerowsecurity as f from pg_class where oid = 'workflow.inbox_snooze'::regclass",
    );
    expect(forced.rows[0]!.f).toBe(true);
  });
});

describe("IPB-07-15 inbox ordering and the by-module and by-record list (PR-LDC-46)", () => {
  it("orders by due time and by severity, ties stable; the default stays newest first", async () => {
    const m = { productModule: "ordering" };
    const five = later(5).toISOString();
    const a = await raise({ ...m, title: "a", severity: "info", dueAt: five });
    const b = await raise({ ...m, title: "b", severity: "critical" });
    const c = await raise({ ...m, title: "c", severity: "warning", dueAt: later(1).toISOString() });
    const d = await raise({
      ...m,
      title: "d",
      severity: "critical",
      dueAt: five,
    });
    const order = async (orderBy?: "newest" | "due" | "severity") =>
      (await inbox.list(alice, { productModule: "ordering", ...(orderBy ? { orderBy } : {}) })).map(
        (i) => i.id,
      );
    expect(await order()).toEqual([d, c, b, a]);
    expect(await order("newest")).toEqual([d, c, b, a]);
    expect(await order("due")).toEqual([c, d, a, b]);
    expect(await order("severity")).toEqual([d, b, c, a]);
    await expect(inbox.list(alice, { orderBy: "oldest" as never })).rejects.toThrow(RangeError);
  });

  it("lists one module, or one record", async () => {
    const x = await raise({ productModule: "registers", recordRef: "reg_1" });
    const y = await raise({ productModule: "registers", recordRef: "reg_2" });
    await raise({ productModule: "notices", recordRef: "reg_1" });
    expect(await ids(alice, { productModule: "registers" })).toEqual([y, x]);
    expect(
      (await inbox.list(alice, { productModule: "registers", recordRef: "reg_1" })).map(
        (i) => i.id,
      ),
    ).toEqual([x]);
    expect(await inbox.list(alice, { recordRef: "reg_1" })).toHaveLength(2);
  });
});

async function item(id: string) {
  const r = await db.admin.query<{ record_ref: string }>(
    "select record_ref from workflow.inbox_item where id = $1",
    [id],
  );
  return { recordRef: r.rows[0]!.record_ref };
}
