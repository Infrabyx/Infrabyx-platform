// A product's own durable timer kinds (Udofin PR-UDF-035; Finbyx PR-FBX-13 (1); R1-D-49;
// workflow/0003): registered with a handler, written in the caller's transaction, fired by the
// poller in the timer's tenant, and refused when malformed or not registered.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPostgres, withTenant, type TestDatabase } from "@infrabyx/testing";
import { WorkflowTimers, type DueTimer } from "../timers.js";

let db: TestDatabase;
let timers: WorkflowTimers;
const fired: DueTimer[] = [];
const ctx = withTenant("tnt_a", ["ORG_USER"], { principal: { id: "usr_a" } });

beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'UDF', 'A') on conflict do nothing",
  );
  timers = new WorkflowTimers({ kernel: db.kernel, audit: db.audit }).on(
    "udf.journey.abandon",
    async (_c, t) => {
      fired.push(t);
      return "done";
    },
  );
});
afterAll(async () => db?.end());

const schedule = (kind: string, ref: string, at = new Date(Date.now() - 1000)) =>
  db.kernel.mutate(ctx, async (tx) => {
    await timers.schedule(tx, kind as "udf.journey.abandon", ref, at);
    await db.audit.record(tx, {
      action: "udf.journey.touch",
      resourceType: "journey",
      resourceId: ref,
    });
  });

describe("product timer kinds (PR-UDF-035)", () => {
  it("fires a registered product kind in its tenant", async () => {
    await schedule("udf.journey.abandon", "jrn_01M5XQT0PRXMKBEGFFSHNHTA61");
    expect(await timers.tick()).toBe(1);
    expect(fired).toEqual([
      expect.objectContaining({
        tenantId: "tnt_a",
        kind: "udf.journey.abandon",
        ref: "jrn_01M5XQT0PRXMKBEGFFSHNHTA61",
      }),
    ]);
    const row = await db.admin.query("select state from workflow.timer where ref = $1", [
      "jrn_01M5XQT0PRXMKBEGFFSHNHTA61",
    ]);
    expect(row.rows[0]).toEqual({ state: "fired" });
  });

  it("refuses an unregistered or malformed kind, and a bad reference", async () => {
    await expect(schedule("udf.journey.expire", "jrn_2")).rejects.toThrow(/register a handler/);
    await expect(schedule("udofin.journey.abandon", "jrn_2")).rejects.toThrow(/<product>/);
    await expect(schedule("udf.journey.abandon", "jrn 2")).rejects.toThrow(/reference/);
    expect(() => timers.on("Udf.x.y" as "udf.x.y", async () => "done")).toThrow(/<product>/);
    // The database refuses a malformed row too.
    await expect(
      db.admin.query(
        "insert into workflow.timer (tenant_id, kind, ref, fire_at) values ('tnt_a', 'udf.journey.abandon', 'a.b', now())",
      ),
    ).rejects.toThrow(/timer_ref_check/);
    await expect(
      db.admin.query(
        "insert into workflow.timer (tenant_id, kind, ref, fire_at) values ('tnt_a', 'approval.remind', 'jrn_1', now())",
      ),
    ).rejects.toThrow(/timer_ref_check/);
  });
});
