// Feedback items, the OH hand-off and status loop, the accessibility SLA sweep and the purge on
// PostgreSQL (PL5 plan §7.1).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgOutbox } from "@infrabyx/tenancy";
import { FakeOhDesk, startPostgres, withTenant, type TestDatabase } from "@infrabyx/testing";
import { FeedbackService, FeedbackSweep } from "../index.js";

let db: TestDatabase;
let desk: FakeOhDesk;
let service: FeedbackService;
let clock = new Date();
const TENANT = "tnt_01JB000000000000000000FB01";
const OTHER = "tnt_01JB000000000000000000FB02";
const user = withTenant(TENANT, ["ORG_MEMBER"], {
  principal: { id: "usr_01JB0000000000000000000FB1" },
});
const visitor = (cid: string, firstSession = false) => ({
  tenantId: "tnt_platform",
  cid,
  firstSession,
  clientKey: `ip:${cid}`,
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/131.0",
});
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string }) => e.code ?? String(e),
  );
const count = async (sql: string, params: unknown[] = []) =>
  Number((await db.admin.query(`select count(*)::int as n from ${sql}`, params)).rows[0].n);

beforeAll(async () => {
  db = await startPostgres();
  desk = new FakeOhDesk();
  service = new FeedbackService({
    kernel: db.kernel,
    audit: db.audit,
    product: "OH",
    support: desk,
    backlog: desk,
    outbox: new PgOutbox(),
    appVersion: "rel_01JB0000000000000000000001",
    now: () => clock,
  });
});
afterAll(async () => {
  await db?.end();
});

describe("@IPB-04-AT-91 payload minimisation (adversarial)", () => {
  it("rejects page HTML and a full URL with a query string and stores nothing", async () => {
    const before = await count("feedback.item");
    expect(
      await code(
        service.submit(
          { type: "bug", summary: "Broken", page_html: "<main>secret</main>" },
          visitor("AbCdEfGhIjKlMnOpQr01"),
        ),
      ),
    ).toBe("IPB-FB-001");
    expect(
      await code(
        service.submit(
          { type: "bug", summary: "Broken", route: "https://site.example/loans?id=7" },
          visitor("AbCdEfGhIjKlMnOpQr01"),
        ),
      ),
    ).toBe("IPB-FB-001");
    expect(await count("feedback.item")).toBe(before);
  });

  it("stores the route pattern, version and trace id, and no query string", async () => {
    const r = await service.submit(
      {
        type: "idea",
        summary: "A dark theme please",
        route: "/loans/lon_01JB0000000000000000000099/kfs",
        trace_id: "0af7651916cd43dd8448eb211c80319c",
        viewport: "md",
        locale: "en-IN",
      },
      visitor("AbCdEfGhIjKlMnOpQr02"),
    );
    const row = (await db.admin.query("select * from feedback.item where id = $1", [r.id])).rows[0];
    expect(row).toMatchObject({
      route_pattern: "/loans/:id/kfs",
      app_version: "rel_01JB0000000000000000000001",
      trace_id: "0af7651916cd43dd8448eb211c80319c",
      os_family: "Windows",
      browser_family: "Firefox",
      category: "IDEA",
      user_id: null,
    });
    expect(JSON.stringify(row)).not.toContain("?");
    expect(row.view_key_sha256).not.toBe(r.viewKey);
    // Handed to BACKLOG at once; the fixture desk got the scanned summary, never more.
    expect(r.ohRef).toMatch(/^OH-/);
    expect(desk.tickets.at(-1)).toMatchObject({ feedbackId: r.id, routePattern: "/loans/:id/kfs" });
  });
});

describe("rate limit, anti-spam and the NPS rules", () => {
  it("refuses the honeypot and more than the hourly limit", async () => {
    expect(
      await code(
        service.submit(
          { type: "bug", summary: "x", website_url: "http://spam" },
          visitor("AbCdEfGhIjKlMnOpQr03"),
        ),
      ),
    ).toBe("IPB-FB-002");
    for (let i = 0; i < 10; i++)
      await service.submit(
        { type: "praise", summary: `Nice ${i}` },
        visitor("AbCdEfGhIjKlMnOpQr04"),
      );
    expect(
      await code(
        service.submit({ type: "praise", summary: "Nice 11" }, visitor("AbCdEfGhIjKlMnOpQr04")),
      ),
    ).toBe("IPB-FB-002");
  });

  it("never asks the score in a first session and at most once per interval", async () => {
    const cid = "AbCdEfGhIjKlMnOpQr05";
    expect(await service.npsDue(visitor(cid, true))).toBe(false);
    expect(
      await code(service.submit({ type: "nps", summary: "ok", nps_score: 9 }, visitor(cid, true))),
    ).toBe("IPB-FB-002");
    expect(await service.npsDue(visitor(cid))).toBe(true);
    await service.submit({ type: "nps", summary: "ok", nps_score: 9 }, visitor(cid));
    expect(await service.npsDue(visitor(cid))).toBe(false);
  });
});

describe("@IPB-04-AT-92 feedback status loop", () => {
  it("creates an OH ticket, shows the reference, and shows shipped when OH ships it", async () => {
    const r = await service.submit(
      { type: "bug", summary: "The save button does nothing", route: "/settings/profile" },
      { ctx: user, firstSession: false, clientKey: "s1" },
    );
    const ticket = desk.tickets.find((t) => t.feedbackId === r.id);
    expect(ticket).toMatchObject({ kind: "bug", category: "BUG" });
    expect((await service.mine(user)).find((v) => v.id === r.id)?.status).toBe("received");

    const event = {
      eventId: "evt_ship_1",
      tenantId: TENANT,
      data: {
        fbk_id: r.id,
        status: "SHIPPED",
        changed_at: new Date().toISOString(),
        public_note: "Fixed",
      },
    };
    expect(await service.onStatusChanged(event)).toBe(true);
    expect(await service.onStatusChanged(event)).toBe(false);
    const mine = (await service.mine(user)).find((v) => v.id === r.id)!;
    expect(mine.status).toBe("shipped");
    expect(mine.history.map((h) => h.status)).toEqual(["received", "shipped"]);
    expect(
      await count(
        "feedback.outbox where envelope->>'type' = 'in.oh.fb.FeedbackStatusChanged.v1' and envelope->'data'->>'fbk_id' = $1",
        [r.id],
      ),
    ).toBe(1);
    // The polled status from the port lands the same way.
    desk.statuses.set(ticket!.ref, "SHIPPED");
    expect(await service.refreshStatus(TENANT, r.id)).toBe("shipped");
  });

  it("shows the status through the link only with the right key, and never across tenants", async () => {
    const r = await service.submit(
      { type: "idea", summary: "Export to CSV" },
      visitor("AbCdEfGhIjKlMnOpQr06"),
    );
    expect((await service.viewByLink("tnt_platform", r.id, r.viewKey)).status).toBe("received");
    expect(await code(service.viewByLink("tnt_platform", r.id, "wrong"))).toMatch(/not found/);
    expect(await code(service.viewByLink(OTHER, r.id, r.viewKey))).toMatch(/not found/);
    const other = withTenant(OTHER, ["ORG_MEMBER"], {
      principal: { id: "usr_01JB0000000000000000000FB1" },
    });
    expect(await service.mine(other)).toEqual([]);
  });

  it("keeps a submission when OH is down and hands it off from the sweep later", async () => {
    const down = new FeedbackService({
      kernel: db.kernel,
      audit: db.audit,
      product: "OH",
      support: {
        ...desk,
        descriptor: desk.descriptor,
        health: desk.health,
        createTicket: async () => {
          throw new Error("OH unreachable");
        },
        getStatus: desk.getStatus.bind(desk),
      },
      backlog: desk,
      now: () => clock,
    });
    const r = await down.submit(
      { type: "bug", summary: "Slow page" },
      visitor("AbCdEfGhIjKlMnOpQr07"),
    );
    expect(r.ohRef).toBeNull();
    expect(
      (await db.admin.query("select hand_off_attempts from feedback.item where id = $1", [r.id]))
        .rows[0].hand_off_attempts,
    ).toBe(1);
    const sweep = new FeedbackSweep({
      kernel: db.kernel,
      audit: db.audit,
      product: "OH",
      service,
      now: () => new Date(Date.now() + 120_000),
    });
    const t = await sweep.tick();
    expect(t.handedOff).toBeGreaterThanOrEqual(1);
    expect(
      (await db.admin.query("select oh_ref from feedback.item where id = $1", [r.id])).rows[0]
        .oh_ref,
    ).toMatch(/^OH-/);
  });
});

describe("@IPB-06-AT-20 accessibility feedback SLA", () => {
  it("raises AccessibilityIssueSlaBreached once per missed timer on a P1 regulated-step issue", async () => {
    clock = new Date("2026-10-26T09:00:00Z");
    const r = await service.submit(
      {
        type: "accessibility",
        route: "/sign/esg_01JB0000000000000000000001",
        assistive_tech: "Keyboard only",
        summary: "The e-sign button cannot be reached by keyboard",
        expected: "Tab reaches the button",
        blocking: "on",
      },
      { ctx: user, firstSession: false, clientKey: "s2" },
    );
    const row = (await db.admin.query("select * from feedback.item where id = $1", [r.id])).rows[0];
    expect(row.ack_due_at.toISOString()).toBe("2026-10-27T09:00:00.000Z");
    expect(row.fix_due_at.toISOString()).toBe("2027-01-24T09:00:00.000Z");
    expect(desk.tickets.find((t) => t.feedbackId === r.id)?.kind).toBe("accessibility");

    // Triaged as P1 on a regulated step: acknowledged, 30-day fix, interim path next business day.
    await service.triageAccessibility(TENANT, r.id, { priority: "P1", regulatedStep: true });
    const triaged = (await db.admin.query("select * from feedback.item where id = $1", [r.id]))
      .rows[0];
    expect(triaged.fix_due_at.toISOString()).toBe("2026-11-25T09:00:00.000Z");
    expect(triaged.interim_due_at.toISOString()).toBe("2026-10-27T09:00:00.000Z");

    const sweepAt = (d: string) =>
      new FeedbackSweep({
        kernel: db.kernel,
        audit: db.audit,
        product: "OH",
        service,
        outbox: new PgOutbox(),
        now: () => new Date(d),
      });
    expect((await sweepAt("2026-10-26T20:00:00Z").tick()).breaches).toBe(0);
    expect((await sweepAt("2026-10-28T09:00:00Z").tick()).breaches).toBe(1);
    expect((await sweepAt("2026-10-28T10:00:00Z").tick()).breaches).toBe(0);
    expect((await sweepAt("2026-11-30T00:00:00Z").tick()).breaches).toBe(2);
    const events = await db.admin.query(
      `select envelope->'data'->>'timer' as timer from feedback.outbox
        where envelope->>'type' = 'in.oh.a11y.AccessibilityIssueSlaBreached.v1' and envelope->'data'->>'fbk_id' = $1
        order by 1`,
      [r.id],
    );
    expect(events.rows.map((x) => x.timer)).toEqual(["fix", "interim", "workaround"]);
    await expect(
      db.admin.query("update feedback.item set sla_breaches = '{}' where id = $1", [r.id]),
    ).rejects.toThrow(/append-only/);
    clock = new Date();
  });
});

describe("OWNER-QUESTIONS #48: items are deleted 3 years after closure", () => {
  it("purges only items closed more than 3 years ago, with their history", async () => {
    const old = await service.submit(
      { type: "idea", summary: "Old idea" },
      visitor("AbCdEfGhIjKlMnOpQr08"),
    );
    const recent = await service.submit(
      { type: "idea", summary: "New idea" },
      visitor("AbCdEfGhIjKlMnOpQr09"),
    );
    const open = await service.submit(
      { type: "idea", summary: "Open idea" },
      visitor("AbCdEfGhIjKlMnOpQr10"),
    );
    for (const [id, at] of [
      [old.id, "now() - interval '3 years 1 day'"],
      [recent.id, "now() - interval '2 years'"],
    ])
      await db.admin.query(
        `update feedback.item set status = 'DECLINED', closed_at = ${at} where id = $1`,
        [id],
      );
    // Nobody deletes an item early, including the app role through the kernel.
    const early = await db.kernel.mutate(
      { tenantId: "tnt_platform", principal: { id: "svc_feedback", type: "service", roles: [] } },
      async (tx) => {
        const n = (
          await tx.query("delete from feedback.item where id = any($1)", [[recent.id, open.id]])
        ).rowCount;
        await db.audit.record(tx, {
          action: "test.delete",
          resourceType: "feedback_item",
          resourceId: "x",
        });
        return n;
      },
    );
    expect(early).toBe(0);
    const sweep = new FeedbackSweep({ kernel: db.kernel, audit: db.audit, product: "OH", service });
    expect((await sweep.purge()).deleted).toBe(1);
    expect(await count("feedback.item where id = $1", [old.id])).toBe(0);
    expect(await count("feedback.status_change where item_id = $1", [old.id])).toBe(0);
    expect(await count("feedback.item where id = any($1)", [[recent.id, open.id]])).toBe(2);
    expect(await count("audit.ledger where action = 'feedback.item.purge'")).toBe(1);
    await expect(
      db.admin.query("delete from feedback.status_change where item_id = $1", [recent.id]),
    ).rejects.toThrow(/append-only/);
  });
});
