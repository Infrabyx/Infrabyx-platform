// The purpose-consent purge per tenant, dry run first (Finbyx PR-FBX-37; OWNER-QUESTIONS #95's
// guards; consent/0005; R1-D-97): a dry run lists exactly what a live run would delete and deletes
// nothing; a live run follows a fresh dry run of the same tenant, deletes no record outside its
// report, and ledgers each record it deletes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { platformContext, startPostgres, withTenant, type TestDatabase } from "@infrabyx/testing";
import {
  ConsentPurge,
  ConsentSubjects,
  PURPOSE_RECORD_PURGE_ACTION,
  PurposeConsents,
} from "../index.js";

let db: TestDatabase;
let svc: PurposeConsents;
let subjects: ConsentSubjects;
let purge: ConsentPurge;
const T = "tnt_runs";
const O = "tnt_runs_other";
const MARKETING = "fbx.updates";
const admin = (t: string) => withTenant(t, ["ORG_ADMIN"], { principal: { id: `usr_${t}_admin` } });
const checker = (t: string) =>
  withTenant(t, ["ORG_CHECKER"], { principal: { id: `usr_${t}_chk` } });
const notices = new Map<string, string>();
const exists = async (id: string) =>
  Boolean(
    (await db.admin.query("select 1 from consent.purpose_record where id = $1", [id])).rowCount,
  );
const age = async (ids: string[], interval: string) => {
  await db.admin.query(
    "alter table consent.purpose_record disable trigger purpose_record_append_only",
  );
  await db.admin.query(
    "update consent.purpose_record set recorded_at = now() - $2::interval where id = any($1::text[])",
    [ids, interval],
  );
  await db.admin.query(
    "alter table consent.purpose_record enable trigger purpose_record_append_only",
  );
};
/** A person whose relationship ended 9 years ago, with a grant and a withdrawal both old enough. */
async function due(t: string, person: string): Promise<string[]> {
  const g = await svc.grant(admin(t), {
    subjectRef: person,
    purpose: MARKETING,
    noticeId: notices.get(t)!,
    method: "ASSISTED",
  });
  const w = await svc.withdraw(admin(t), {
    subjectRef: person,
    purpose: MARKETING,
    method: "ASSISTED",
  });
  await age([g.receiptId], "10 years");
  await age([w.receiptId], "9 years");
  await subjects.endRelationship(admin(t), person, new Date(Date.now() - 9 * 366 * 86_400_000));
  return [g.receiptId, w.receiptId];
}

beforeAll(async () => {
  db = await startPostgres();
  svc = new PurposeConsents({
    kernel: db.kernel,
    audit: db.audit,
    product: "FBX",
    purposes: [{ code: MARKETING, description: "Account updates" }],
  });
  subjects = new ConsentSubjects({ kernel: db.kernel, audit: db.audit });
  purge = new ConsentPurge({ kernel: db.kernel, audit: db.audit });
  for (const t of [T, O]) {
    const d = await svc.draftNotice(admin(t), {
      purpose: MARKETING,
      language: "en-IN",
      body: "Updates.",
    });
    notices.set(t, (await svc.approveNotice(checker(t), d.id)).id);
  }
});
afterAll(async () => {
  await db?.end();
});

describe("PR-FBX-37: the purpose-consent purge per tenant, dry run first", () => {
  it("dry-runs exactly what would go, deletes nothing, and ledgers the report's digest", async () => {
    const a = await due(T, "per_a");
    const b = await due(T, "per_b");
    const o = await due(O, "per_o");
    expect(await purge.tenantsWithPurposesDue()).toEqual(expect.arrayContaining([T, O]));
    const report = await purge.dryRunPurposes(T);
    expect(report.records.map((r) => r.id).sort()).toEqual([...a, ...b].sort());
    expect(report.byPurpose).toEqual({ [MARKETING]: 4 });
    expect(report.reportSha256).toMatch(/^[0-9a-f]{64}$/);
    for (const id of [...a, ...b, ...o]) expect(await exists(id)).toBe(true);
    const run = await db.admin.query(
      "select tenant_id, kind, records, report_sha256 from consent.purpose_purge_run where id = $1",
      [report.runId],
    );
    expect(run.rows).toEqual([
      { tenant_id: T, kind: "dry_run", records: 4, report_sha256: report.reportSha256 },
    ]);
    const led = await db.admin.query<{ after_digest: string }>(
      "select after_digest from audit.ledger where action = 'consent.purpose.purge.dry_run' and resource_id = $1",
      [report.runId],
    );
    expect(led.rowCount).toBe(1);
  });

  it("deletes in a live run only what the dry run listed, each record ledgered; other tenants untouched", async () => {
    const report = await purge.dryRunPurposes(T);
    const listed = report.records.map((r) => r.id);
    // Due after the dry run: not in its report, so the live run leaves it.
    const late = await due(T, "per_late");
    const r = await purge.purgePurposesFor(T, { dryRunId: report.runId, batch: 3 });
    expect(r.records).toBe(listed.length);
    for (const id of listed) expect(await exists(id)).toBe(false);
    for (const id of late) expect(await exists(id)).toBe(true);
    const per = await db.admin.query<{ resource_id: string; tenant_id: string }>(
      "select resource_id, tenant_id from audit.ledger where action = $1 order by resource_id",
      [PURPOSE_RECORD_PURGE_ACTION],
    );
    expect(per.rows.map((x) => x.resource_id)).toEqual([...listed].sort());
    expect(new Set(per.rows.map((x) => x.tenant_id))).toEqual(new Set([T]));
    const live = await db.admin.query<{ records: number }>(
      "select records from consent.purpose_purge_run where kind = 'live' and dry_run_id = $1",
      [report.runId],
    );
    expect(live.rows.reduce((n, x) => n + x.records, 0)).toBe(listed.length);
    // Tenant O still has its due records: no dry run there, no live run.
    expect(
      (await db.admin.query("select 1 from consent.purpose_record where tenant_id = $1", [O]))
        .rowCount,
    ).toBeGreaterThan(0);
  });

  it("refuses a live run without a fresh dry run of the same tenant", async () => {
    const report = await purge.dryRunPurposes(T);
    await expect(purge.purgePurposesFor(O, { dryRunId: report.runId })).rejects.toThrow(
      /no dry run/,
    );
    await expect(
      purge.purgePurposesFor(T, { dryRunId: "cpr_00000000000000000000000000" }),
    ).rejects.toThrow(/no dry run/);
    await db.admin.query(
      "update consent.purpose_purge_run set ran_at = now() - interval '73 hours' where id = $1",
      [report.runId],
    );
    await expect(purge.purgePurposesFor(T, { dryRunId: report.runId })).rejects.toThrow(
      /older than 72 hours/,
    );
    // The run table is insert-only for the application.
    await expect(
      db.kernel.mutate(
        platformContext(["PLT_DPO"], T),
        async (tx) => {
          await db.audit.record(tx, { action: "x.y.z", resourceType: "x", resourceId: "x" });
          await tx.query("update consent.purpose_purge_run set records = 0");
        },
        { action: "x.y.z" },
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
