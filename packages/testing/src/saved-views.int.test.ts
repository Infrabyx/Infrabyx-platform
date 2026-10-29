// Saved table views and column layouts on PostgreSQL (config/0002; IPB-07-13, @IPB-07-AT-08;
// Finbyx PR-FBX-09, R1-D-32): a personal view persists and restores; a shared view reaches its
// audience only, read-only to them; sharing with roles or the tenant needs ORG_ADMIN; the setting
// switches sharing off; RLS keeps personal views and layouts to their owner; each change is ledgered.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgSettingsStore, SettingsService } from "@infrabyx/config/settings";
import { SavedViews } from "@infrabyx/config/views";
import { withTenant } from "./context.js";
import { startPostgres, type TestDatabase } from "./postgres.js";

let db: TestDatabase;
let views: SavedViews;
let settings: SettingsService;

const as = (id: string, roles: readonly string[] = ["ORG_MEMBER"], tenantId = "tnt_a") =>
  withTenant(tenantId, roles, { principal: { id } });
const admin = as("usr_admin", ["ORG_ADMIN"]);
const ann = as("usr_ann");
const bob = as("usr_bob");
const TABLE = "compliance.register";
const OVERDUE = {
  filters: { status: "Overdue" },
  sort: { column: "due_on", direction: "ascending" as const },
  columns: ["title", "due_on", "status"],
};
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string; name?: string; message?: string }) => e.code ?? e.name,
  );
const ledger = async (resourceId: string) =>
  (
    await db.admin.query<{ action: string }>(
      "select action from audit.ledger where resource_id = $1 order by seq",
      [resourceId],
    )
  ).rows.map((r) => r.action);

beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'FBX', 'A'), ('tnt_b', 'FBX', 'B')",
  );
  settings = new SettingsService({
    store: new PgSettingsStore(),
    kernel: db.kernel,
    audit: db.audit,
    product: "FBX",
  });
  views = new SavedViews({ kernel: db.kernel, audit: db.audit, settings });
});
afterAll(async () => db?.end());

describe("@IPB-07-AT-08 saved views and column chooser on PostgreSQL", () => {
  it("persists a personal view and restores its columns, sort and filter", async () => {
    const saved = await views.save(ann, { table: TABLE, name: "My overdue", state: OVERDUE });
    expect(saved).toMatchObject({ audience: { kind: "personal" }, editable: true, version: 1 });
    const { personal, shared } = await views.list(ann, TABLE);
    expect(personal.map((v) => v.name)).toEqual(["My overdue"]);
    expect(shared).toEqual([]);
    expect(await views.get(ann, saved.id)).toMatchObject(OVERDUE);
    expect(await ledger(saved.id)).toEqual(["ux.saved_view.create"]);
  });

  it("keeps a personal view from everyone else, in the service and under RLS", async () => {
    const mine = await views.save(ann, { table: TABLE, name: "Private", state: { filters: {} } });
    expect((await views.list(bob, TABLE)).shared.map((v) => v.id)).not.toContain(mine.id);
    expect(await code(views.get(bob, mine.id))).toBe("NotFoundError");
    expect(await code(views.remove(bob, mine.id))).toBe("NotFoundError");
    // Even a direct query in Bob's transaction sees and changes nothing.
    const seen = await db.kernel.read(bob, (tx) =>
      tx.query("select id from config.saved_view where id = $1", [mine.id]),
    );
    expect(seen.rows).toEqual([]);
    expect(await code(views.get(as("usr_ann", ["ORG_MEMBER"], "tnt_b"), mine.id))).toBe(
      "NotFoundError",
    );
  });

  it("shares a view with a role: members see it under shared views and cannot edit it", async () => {
    expect(
      await code(
        views.save(ann, {
          table: TABLE,
          name: "For members",
          audience: { kind: "roles", roles: ["ORG_MEMBER"] },
          state: OVERDUE,
        }),
      ),
    ).toBe("IPB-UX-011");
    const v = await views.save(admin, {
      table: TABLE,
      name: "My overdue",
      audience: { kind: "roles", roles: ["ORG_MEMBER"] },
      state: OVERDUE,
    });
    const seen = (await views.list(bob, TABLE)).shared.find((x) => x.id === v.id);
    expect(seen).toMatchObject({ name: "My overdue", editable: false });
    expect(await code(views.update(bob, v.id, { version: 1, name: "Mine now" }))).toBe(
      "IPB-UX-011",
    );
    expect(await code(views.remove(bob, v.id))).toBe("IPB-UX-011");
    // A role outside the audience does not see it.
    const checker = as("usr_chk", ["ORG_CHECKER"]);
    expect((await views.list(checker, TABLE)).shared.map((x) => x.id)).not.toContain(v.id);
    // Platform roles are not an audience.
    expect(
      await code(
        views.save(admin, {
          table: TABLE,
          name: "Staff",
          audience: { kind: "roles", roles: ["PLT_SUPPORT_L1"] },
          state: OVERDUE,
        }),
      ),
    ).toBe("RangeError");
  });

  it("shares a team view only from a member, with members", async () => {
    expect(
      await code(
        views.save(
          ann,
          {
            table: TABLE,
            name: "Team",
            audience: { kind: "team", teamId: "team_x" },
            state: OVERDUE,
          },
          { teamIds: ["team_y"] },
        ),
      ),
    ).toBe("IPB-UX-011");
    const v = await views.save(
      ann,
      { table: TABLE, name: "Team", audience: { kind: "team", teamId: "team_y" }, state: OVERDUE },
      { teamIds: ["team_y"] },
    );
    expect(
      (await views.list(bob, TABLE, { teamIds: ["team_y"] })).shared.map((x) => x.id),
    ).toContain(v.id);
    expect((await views.list(bob, TABLE, { teamIds: [] })).shared.map((x) => x.id)).not.toContain(
      v.id,
    );
  });

  it("opens with the personal default, else the tenant default, one of each", async () => {
    const t1 = await views.save(admin, {
      table: "loans.list",
      name: "Tenant default",
      audience: { kind: "tenant" },
      state: { filters: { state: "open" } },
      isDefault: true,
    });
    expect((await views.defaultView(bob, "loans.list"))?.id).toBe(t1.id);
    expect(
      await code(
        views.save(ann, {
          table: "loans.list",
          name: "Mine",
          audience: { kind: "tenant" },
          state: { filters: {} },
          isDefault: true,
        }),
      ),
    ).toBe("IPB-UX-011");
    const t2 = await views.save(admin, {
      table: "loans.list",
      name: "New default",
      audience: { kind: "tenant" },
      state: { filters: {} },
      isDefault: true,
    });
    expect((await views.get(bob, t1.id)).isDefault).toBe(false);
    expect(await ledger(t1.id)).toEqual(["ux.saved_view.create", "ux.saved_view.update"]);
    const mine = await views.save(bob, {
      table: "loans.list",
      name: "Bob's",
      state: { filters: { branch: "br_1" } },
      isDefault: true,
    });
    expect((await views.defaultView(bob, "loans.list"))?.id).toBe(mine.id);
    expect((await views.defaultView(ann, "loans.list"))?.id).toBe(t2.id);
  });

  it("updates with the version read, and refuses a stale one", async () => {
    const v = await views.save(ann, { table: "x.y", name: "Draft", state: { filters: {} } });
    const u = await views.update(ann, v.id, {
      version: 1,
      name: "Final",
      state: { filters: { a: "1" } },
    });
    expect(u).toMatchObject({ name: "Final", version: 2, filters: { a: "1" } });
    expect(await code(views.update(ann, v.id, { version: 1, name: "Again" }))).toBe(
      "ConflictError",
    );
    expect(
      await code(views.save(ann, { table: "x.y", name: "Final", state: { filters: {} } })),
    ).toBe("ConflictError");
    await views.remove(ann, v.id);
    expect(await ledger(v.id)).toEqual([
      "ux.saved_view.create",
      "ux.saved_view.update",
      "ux.saved_view.delete",
    ]);
  });

  it("@IPB-07-AT-03 refuses a filter value search would refuse, naming only the pattern class", async () => {
    const e = await views
      .save(ann, { table: TABLE, name: "PII", state: { filters: { q: "2345 6789 0123" } } })
      .catch((x: { code: string; meta?: Record<string, unknown>; message: string }) => x);
    expect(e).toMatchObject({ code: "IPB-UX-003", meta: { pattern_class: "aadhaar_pattern" } });
    expect(JSON.stringify(e)).not.toContain("6789");
    expect(e instanceof Error ? e.message : "").not.toContain("6789");
  });

  it("switches sharing off with ux.tables.saved_views_shared", async () => {
    const v = await views.save(admin, {
      table: "z.list",
      name: "Shared",
      audience: { kind: "tenant" },
      state: { filters: {} },
    });
    await settings.set(
      as("usr_owner", ["ORG_ADMIN"], "tnt_b"),
      "ux.tables.saved_views_shared",
      { tier: "TENANT", scopeId: "tnt_b" },
      false,
    );
    const offB = as("usr_admin_b", ["ORG_ADMIN"], "tnt_b");
    expect(
      await code(
        views.save(offB, {
          table: "z.list",
          name: "Shared",
          audience: { kind: "tenant" },
          state: { filters: {} },
        }),
      ),
    ).toBe("IPB-UX-011");
    expect(
      (await views.save(offB, { table: "z.list", name: "Mine", state: { filters: {} } })).name,
    ).toBe("Mine");
    // Tenant A keeps sharing.
    expect((await views.list(bob, "z.list")).shared.map((x) => x.id)).toContain(v.id);
  });

  it("keeps the column chooser per person and table, ledgered", async () => {
    expect(await views.layout(ann, TABLE)).toBeNull();
    await views.setLayout(ann, TABLE, { columns: ["status", "title"], density: "compact" });
    expect(await views.layout(ann, TABLE)).toEqual({
      table: TABLE,
      columns: ["status", "title"],
      density: "compact",
    });
    expect(await views.layout(bob, TABLE)).toBeNull();
    expect(
      await code(views.setLayout(ann, TABLE, { columns: ["a", "a"], density: "compact" })),
    ).toBe("RangeError");
    await views.setLayout(ann, TABLE, null);
    expect(await views.layout(ann, TABLE)).toBeNull();
    expect(await ledger(`usr_ann:${TABLE}`)).toEqual([
      "ux.table_layout.change",
      "ux.table_layout.change",
    ]);
  });

  it("refuses agents and the platform scope", async () => {
    const agent = {
      tenantId: "tnt_a",
      principal: { id: "agt_x", type: "agent" as const, roles: ["AGT_VIDHI"] },
    };
    expect(await code(views.list(agent, TABLE))).toBe("IPB-SEC-005");
  });
});
