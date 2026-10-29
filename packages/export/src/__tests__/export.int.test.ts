// @infrabyx/export on PostgreSQL 18 with every platform migration applied (PL3 plan §7, §12).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import { LocalKms, SecretKey, sha256Hex, verifyDetachedJws } from "@infrabyx/crypto";
import { ApprovalsEngine, PgOutbox } from "@infrabyx/tenancy";
import { platformSeedModule, runSeed } from "@infrabyx/seed";
import { MemoryStorage, startPostgres, withTenant, type TestDatabase } from "@infrabyx/testing";
import { REF_EXPORT_MAP } from "../maps.js";
import { ARCHIVE_AVAILABLE_DAYS, ExportService, kmsArchiveSigner } from "../service.js";
import { readZip } from "../zip.js";

const kms = new LocalKms();
const KEY = "local:sign:export";
let db: TestDatabase;
let svc: ExportService;
const storage = new MemoryStorage();
const events: Array<Record<string, unknown>> = [];
const enqueued: string[] = [];
let approvals: ApprovalsEngine;
const tmp = mkdtempSync(join(tmpdir(), "ipb-export-int-"));

const ctx = (id: string, roles: string[], tenantId = "tnt_demo"): KernelContext =>
  withTenant(tenantId, roles, { principal: { id, type: "user" } });
const owner = ctx("usr_01M5XQT0PRXMKBEGFFSHNHTA61", ["ORG_OWNER"]);
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string }) => e.code ?? String(e),
  );

beforeAll(async () => {
  db = await startPostgres();
  await runSeed({
    kernel: db.kernel,
    audit: db.audit,
    env: { APP_ENV: "test", SEED_ENABLED: true },
    product: "LD",
    profile: "demo",
    modules: [platformSeedModule],
    randomSeed: 20261025,
    runDate: new Date("2026-10-01T00:00:00Z"),
  } as never);
  // One ledger entry made in a branch: the chain hashes its branch (audit/0004), so the exported
  // trail must carry it and the offline verifier must hash it (REF-EXPORT-1.3, R1-D-26).
  await db.kernel.mutate(
    { ...owner, branchId: "br_north", branchIds: ["br_north"] },
    async (tx) => {
      await db.audit.record(tx, {
        action: "test.branch.entry",
        resourceType: "test",
        resourceId: "t1",
      });
    },
  );
  approvals = new ApprovalsEngine({ kernel: db.kernel, audit: db.audit, product: "REF" });
  svc = new ExportService({
    approvals,
    enqueue: async (_tenantId, jobId) => {
      enqueued.push(jobId);
    },
    kernel: db.kernel,
    audit: db.audit,
    storage,
    product: "REF",
    release: "0.1.0",
    map: REF_EXPORT_MAP,
    signer: await kmsArchiveSigner(kms, KEY),
    pseudonymKey: new SecretKey("test:pseudonym", "hmac-sha-256", new Uint8Array(32).fill(7)),
    outbox: new PgOutbox(),
    ecosystemEvent: async (_tx, event, data) => {
      events.push({ event, data });
      return null;
    },
  });
});

afterAll(async () => {
  await db?.end();
  rmSync(tmp, { recursive: true, force: true });
});

describe("export jobs and downloads (PL3 plan §7.3)", () => {
  it("ORG_OWNER exports the tenant (R0); the archive is signed, reconciled and ledgered", async () => {
    const job = await svc.request(owner, { scope: { type: "FULL_TENANT" } });
    expect(job.state).toBe("requested");
    const done = await svc.run("tnt_demo", job.id);
    expect(done).toMatchObject({ state: "completed", mapVersion: "REF-EXPORT-1.3" });
    const arc = (
      await db.admin.query<{
        id: string;
        storage_key: string;
        sha256: string;
        manifest_jws: string;
        manifest_hash: string;
      }>("select * from export.archive where job_id = $1", [job.id])
    ).rows[0]!;
    const zip = (await storage.get(arc.storage_key)).body;
    expect(sha256Hex(zip)).toBe(arc.sha256);
    const files = readZip(zip);
    const manifestPath = [...files.keys()].find((p) => p.endsWith("00 Start Here/manifest.json"))!;
    const manifest = files.get(manifestPath)!;
    expect(sha256Hex(manifest)).toBe(arc.manifest_hash);
    expect(verifyDetachedJws(arc.manifest_jws, manifest, await kms.getPublicKey(KEY)).ok).toBe(
      true,
    );
    const m = JSON.parse(manifest.toString("utf8"));
    expect(m.control_totals.tenant).toBe(1);
    expect(m.control_totals.membership).toBeGreaterThan(0);
    expect(m.control_totals.audit_event).toBeGreaterThan(0);
    expect(m.requester).toMatch(/^sha256:/);
    expect(events.map((e) => e.event)).toEqual(["ExportRequested", "ExportCompleted"]);
    const ledger = await db.admin.query<{ action: string }>(
      "select action from audit.ledger where tenant_id = 'tnt_demo' and action like 'export.%' order by seq",
    );
    expect(ledger.rows.map((r) => r.action)).toEqual([
      "export.job.request",
      "export.job.start",
      "export.archive.create",
    ]);
  });

  it("the archive passes its own offline verifier, with a real audit chain", async () => {
    const arc = (
      await db.admin.query<{ storage_key: string }>(
        "select storage_key from export.archive order by created_at limit 1",
      )
    ).rows[0]!;
    const dir = mkdtempSync(join(tmp, "v-"));
    let root = "";
    for (const [p, b] of readZip((await storage.get(arc.storage_key)).body)) {
      root = p.split("/")[0]!;
      mkdirSync(join(dir, dirname(p)), { recursive: true });
      writeFileSync(join(dir, p), b);
    }
    const out = execFileSync(
      process.execPath,
      [join(dir, root, "00 Start Here", "verify", "verify.mjs")],
      { encoding: "utf8" },
    );
    expect(out).toMatch(/^OK: \d+ files, signature, control totals and \d+ audit events verified/);
    // The branch entry is exported with its branch, and the verifier above re-hashed it.
    const trailDir = join(dir, root, "02 Audit Trail");
    const entries = readdirSync(trailDir).flatMap((f) =>
      readFileSync(join(trailDir, f), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { action: string; branch_id: string | null }),
    );
    expect(entries.find((e) => e.action === "test.branch.entry")?.branch_id).toBe("br_north");
  });

  it("@IPB-09-37 every download ledgers the archive SHA-256, and the hash never changes", async () => {
    const arc = (
      await db.admin.query<{ id: string; sha256: string }>(
        "select id, sha256 from export.archive order by created_at limit 1",
      )
    ).rows[0]!;
    const a = await svc.download(owner, arc.id);
    const b = await svc.download(owner, arc.id);
    expect(a.sha256).toBe(arc.sha256);
    expect(b.sha256).toBe(a.sha256);
    expect(a.url).toMatch(/^memory:\/\/tenant\/tnt_demo\/export\//);
    const rows = await db.admin.query<{ resource_id: string }>(
      "select resource_id from audit.ledger where action = 'export.archive.download'",
    );
    expect(rows.rows.map((r) => r.resource_id)).toEqual([
      `${arc.id}:${arc.sha256}`,
      `${arc.id}:${arc.sha256}`,
    ]);
  });

  it("refuses other roles, restricted folders and new destinations; rate-limits per principal", async () => {
    const member = ctx("usr_01M5XQT0PRXMKBEGFFSHNHTA62", ["ORG_MEMBER"]);
    expect(await code(svc.request(member, { scope: { type: "FULL_TENANT" } }))).toBe("IPB-EXP-005");
    expect(
      await code(svc.request(owner, { scope: { type: "FULL_TENANT" }, restricted: ["HR"] })),
    ).toBe("IPB-EXP-001");
    expect(
      await code(svc.request(owner, { scope: { type: "FULL_TENANT" }, destination: "s3" })),
    ).toBe("IPB-EXP-002");
    expect(await code(svc.request(owner, { scope: { type: "EXIT" } }))).toBe("IPB-EXP-002");
    const busy = ctx("usr_01M5XQT0PRXMKBEGFFSHNHTA63", ["ORG_OWNER"]);
    for (let i = 0; i < 5; i++)
      await svc.request(busy, { scope: { type: "DATASET", ref: "tenant" } });
    expect(await code(svc.request(busy, { scope: { type: "DATASET", ref: "tenant" } }))).toBe(
      "IPB-SEC-019",
    );
  });

  it("a DATASET export holds only the datasets asked for; an AUDIT_PACK only the audit trail", async () => {
    const d = await svc.run(
      "tnt_demo",
      (
        await svc.request(ctx("usr_01M5XQT0PRXMKBEGFFSHNHTA64", ["ORG_OWNER"]), {
          scope: { type: "DATASET", ref: "membership" },
        })
      ).id,
    );
    const key = (
      await db.admin.query<{ storage_key: string }>(
        "select storage_key from export.archive where id = $1",
        [d.archiveId],
      )
    ).rows[0]!.storage_key;
    const paths = [...readZip((await storage.get(key)).body).keys()].map((p) =>
      p.slice(p.indexOf("/") + 1),
    );
    expect(paths.filter((p) => p.startsWith("01 Data/"))).toEqual([
      "01 Data/membership.csv",
      "01 Data/membership.jsonl",
    ]);
    expect(paths.some((p) => p.startsWith("02 Audit Trail/"))).toBe(false);
  });

  it("another tenant cannot see or download the archive", async () => {
    const arc = (await db.admin.query<{ id: string }>("select id from export.archive limit 1"))
      .rows[0]!;
    const other = ctx("usr_01M5XQT0PRXMKBEGFFSHNHTA65", ["ORG_OWNER"], "tnt_sandbox");
    expect(await code(svc.download(other, arc.id))).toMatch(/NotFound|not found|IPB-/i);
  });

  it("@PL3-EXPORT-ADMIN an ORG_ADMIN export runs only after an ORG_OWNER approves it (OWNER-QUESTIONS #24)", async () => {
    const admin = ctx("usr_01M5XQT0PRXMKBEGFFSHNHTA66", ["ORG_ADMIN"]);
    const otherAdmin = ctx("usr_01M5XQT0PRXMKBEGFFSHNHTA67", ["ORG_ADMIN"]);
    expect(await code(svc.request(admin, { scope: { type: "FULL_TENANT" } }))).toBe("IPB-EXP-005");
    const { approvalId } = await svc.submit(admin, { scope: { type: "DATASET", ref: "tenant" } });
    expect(
      (await db.admin.query("select 1 from export.export_job where approval_id = $1", [approvalId]))
        .rowCount,
    ).toBe(0);
    // Only an ORG_OWNER checks it; another ORG_ADMIN may not.
    expect(await code(approvals.decide(otherAdmin, approvalId, "approve"))).not.toBeNull();
    await approvals.decide(owner, approvalId, "approve");
    const job = (
      await db.admin.query<{ id: string; requester_id: string; requester_role: string }>(
        "select id, requester_id, requester_role from export.export_job where approval_id = $1",
        [approvalId],
      )
    ).rows[0]!;
    expect(job).toMatchObject({ requester_id: admin.principal.id, requester_role: "ORG_ADMIN" });
    // The sweep enqueues approved jobs that have not started (after a grace minute).
    await db.admin.query(
      "update export.export_job set created_at = now() - interval '2 minutes' where id = $1",
      [job.id],
    );
    enqueued.length = 0;
    expect((await svc.sweep()).enqueued).toBeGreaterThanOrEqual(1);
    expect(enqueued).toContain(job.id);
    const done = await svc.run("tnt_demo", job.id);
    expect(done).toMatchObject({ state: "completed", approvalId });
    const arc = (
      await db.admin.query<{ id: string; storage_key: string }>(
        "select id, storage_key from export.archive where job_id = $1",
        [job.id],
      )
    ).rows[0]!;
    const files = readZip((await storage.get(arc.storage_key)).body);
    const manifest = JSON.parse(
      files
        .get([...files.keys()].find((p) => p.endsWith("00 Start Here/manifest.json"))!)!
        .toString("utf8"),
    );
    expect(manifest.approvers).toHaveLength(1);
    expect(manifest.approvers[0]).toMatch(/^sha256:/);
    // The requesting ORG_ADMIN downloads it; another ORG_ADMIN may not, nor may they download an
    // ORG_OWNER's own export; ORG_MEMBER never submits.
    expect((await svc.download(admin, arc.id)).url).toMatch(/^memory:/);
    expect(await code(svc.download(otherAdmin, arc.id))).toBe("IPB-EXP-005");
    const ownArc = (
      await db.admin.query<{ id: string }>(
        "select a.id from export.archive a join export.export_job j on j.id = a.job_id where j.approval_id is null limit 1",
      )
    ).rows[0]!;
    expect(await code(svc.download(admin, ownArc.id))).toBe("IPB-EXP-005");
    const member = ctx("usr_01M5XQT0PRXMKBEGFFSHNHTA62", ["ORG_MEMBER"]);
    expect(await code(svc.submit(member, { scope: { type: "FULL_TENANT" } }))).toBe("IPB-EXP-005");
  });

  it("@PL3-EXPORT-EXPIRY an archive is downloadable for 30 days, then deleted and the deletion ledgered", async () => {
    const arc = (
      await db.admin.query<{ id: string; sha256: string; storage_key: string; days: number }>(
        `select id, sha256, storage_key,
                round(extract(epoch from expires_at - created_at) / 86400)::int as days
           from export.archive order by created_at limit 1`,
      )
    ).rows[0]!;
    expect(arc.days).toBe(ARCHIVE_AVAILABLE_DAYS);
    expect((await svc.sweep()).deleted).toBe(0);
    await db.admin.query(
      "update export.archive set expires_at = now() - interval '1 second' where id = $1",
      [arc.id],
    );
    // Past its time it is refused at once, even before the sweep runs.
    expect(await code(svc.download(owner, arc.id))).toBe("IPB-EXP-006");
    const r = await svc.sweep();
    expect(r.deleted).toBe(1);
    expect(await code(storage.get(arc.storage_key))).not.toBeNull();
    const del = await db.admin.query<{ reason: string }>(
      "select reason from export.archive_deletion where archive_id = $1",
      [arc.id],
    );
    expect(del.rows).toEqual([{ reason: "expired" }]);
    const ledger = await db.admin.query<{ resource_id: string }>(
      "select resource_id from audit.ledger where action = 'export.archive.delete'",
    );
    expect(ledger.rows.map((x) => x.resource_id)).toEqual([`${arc.id}:${arc.sha256}`]);
    // The sweep's cross-tenant reads are ledgered in the tenant they touched.
    const reads = await db.admin.query<{ n: number }>(
      `select count(*)::int as n from audit.ledger
        where tenant_id = 'tnt_demo' and action = 'platform.service_read'
          and resource_id in ('export.export_job', 'export.archive')`,
    );
    expect(reads.rows[0]!.n).toBeGreaterThan(0);
    // A second sweep finds nothing; downloads stay refused.
    expect((await svc.sweep()).deleted).toBe(0);
    expect(await code(svc.download(owner, arc.id))).toBe("IPB-EXP-006");
  });
});
