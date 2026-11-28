// Checklists on PostgreSQL with every platform migration applied (regulatory templates item (d);
// R1-D-326). The definition is AA-A01 (FIP and FIU onboarding checklist): its seven filed checks,
// read from the filed .docx; synthetic answers and evidence only.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import { readZip } from "@infrabyx/export";
import { sha256Hex } from "@infrabyx/crypto";
import { PgOutbox } from "@infrabyx/tenancy";
import {
  MemoryStorage,
  agentContext,
  startPostgres,
  withTenant,
  type TestDatabase,
} from "@infrabyx/testing";
import { ChecklistDefinition, ChecklistService } from "../checklist.js";
import { createWorkflow } from "../setup.js";
import type { InboxService } from "../inbox.js";

const FILED =
  "../../../../docs/regulatory-templates/Templates/NBFC Policies/Account Aggregator/Annexures/AA-A01 FIP and FIU Onboarding Checklist.docx";
/** The filed checklist's checks: the rows of its "Sr. | Check | Done (Y/N) | Remarks" table. */
function filedChecks(): string[] {
  const xml = readZip(new Uint8Array(readFileSync(new URL(FILED, import.meta.url))))
    .get("word/document.xml")!
    .toString("utf8");
  const table = [...xml.matchAll(/<w:tbl>([\s\S]*?)<\/w:tbl>/g)]
    .map((m) => m[1]!)
    .find((t) => t.includes("Done (Y/N)"))!;
  return [...table.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].slice(1).map((r) => {
    const cells = [...r[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((c) =>
      [...c[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(""),
    );
    return cells[1]!.replace(/&amp;/g, "&").trim();
  });
}

let db: TestDatabase;
let inbox: InboxService;
let storage: MemoryStorage;
let svc: ChecklistService;
const clock = new Date("2026-11-28T08:00:00Z");
const ctx = (id: string, roles: string[], tenantId = "tnt_a"): KernelContext =>
  withTenant(tenantId, roles, { principal: { id } });
const maker = ctx("usr_ops_head", ["ORG_MAKER"]);
const checker = ctx("usr_ciso", ["ORG_CHECKER"]);
const fresh = () => ({ mfa: true, iat: Math.floor(clock.getTime() / 1000) - 30 });
const refusal = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { reason?: string; code?: string; name?: string }) => e.reason ?? e.code ?? e.name,
  );
let evidence: { storageKey: string; sha256: string };

const AA_A01 = (): ChecklistDefinition =>
  ChecklistDefinition.parse({
    code: "AA-A01",
    title: "FIP and FIU Onboarding Checklist",
    version: "1.0.0",
    items: filedChecks().map((text, i) => ({
      id: `c${i + 1}`,
      text,
      basis: "AA-A01 (filed template)",
      evidenceRequired: i === 0 || i === 1, // regulatory status and technical certification
    })),
    followUpRole: "ORG_ADMIN",
  });

beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'FBX', 'A'), ('tnt_b', 'FBX', 'B') on conflict do nothing",
  );
  ({ inbox } = createWorkflow({
    kernel: db.kernel,
    audit: db.audit,
    product: "FBX",
    outbox: new PgOutbox(),
  }));
  storage = new MemoryStorage();
  const body = new TextEncoder().encode("%PDF-1.4 synthetic certificate\n");
  evidence = {
    storageKey: "tenant/tnt_a/checklist/01JTEST00000000000000000AA.pdf",
    sha256: sha256Hex(body),
  };
  await storage.put(evidence.storageKey, body, {
    bucketClass: "CONFIDENTIAL",
    contentType: "application/pdf",
    sha256: evidence.sha256,
  });
  svc = new ChecklistService({
    kernel: db.kernel,
    audit: db.audit,
    inbox,
    storage,
    now: () => clock,
  }).define(AA_A01());
});
afterAll(async () => db?.end());

describe("checklists (item (d)): AA-A01, the FIP and FIU onboarding checklist", () => {
  it("AA-A01's seven filed checks are the definition", () => {
    const d = AA_A01();
    expect(d.items.length).toBe(7);
    expect(d.items[0]!.text).toMatch(/^Regulatory status verified/);
  });

  it("sign-off is refused while an item is open; maker then a different checker, each with a step-up", async () => {
    const run = await svc.start(maker, "AA-A01", { subjectRef: "fip_synthetic_01" });
    expect(run.items.every((i) => i.state === "open")).toBe(true);
    expect(await refusal(svc.signOff(maker, run.id, fresh()))).toBe("items_open");
    await svc.mark(maker, run.id, "c1", { state: "met", evidence: [evidence] });
    await svc.mark(maker, run.id, "c2", { state: "met", evidence: [evidence] });
    for (const id of ["c3", "c4", "c5", "c6"]) await svc.mark(maker, run.id, id, { state: "met" });
    await svc.mark(maker, run.id, "c7", {
      state: "not_applicable",
      reason: "Synthetic: not an FIU",
    });

    // No step-up, or a stale one, is refused with the RFC 9470 step-up marker.
    expect(await refusal(svc.signOff(maker, run.id, { mfa: false, iat: fresh().iat }))).toBe(
      "IPB-SEC-001",
    );
    expect(await refusal(svc.signOff(maker, run.id, { mfa: true, iat: fresh().iat - 3600 }))).toBe(
      "IPB-SEC-001",
    );
    expect((await svc.signOff(maker, run.id, fresh())).state).toBe("maker_signed");
    // The checker cannot be the maker, and an agent never signs.
    expect(await refusal(svc.signOff(maker, run.id, fresh()))).toBe("IPB-SEC-007");
    expect(await refusal(svc.signOff(agentContext("tnt_a"), run.id, fresh()))).toBe("IPB-SEC-004");
    const done = await svc.signOff(checker, run.id, fresh());
    expect(done).toMatchObject({
      state: "signed_off",
      makerSignedBy: "usr_ops_head",
      checkerSignedBy: "usr_ciso",
    });
    // A signed run does not change.
    expect(await refusal(svc.mark(maker, run.id, "c3", { state: "not_met", reason: "late" }))).toBe(
      "run_signed",
    );
    // The database holds four eyes as well.
    await expect(
      db.admin.query(
        "update workflow.checklist_run set checker_signed_by = maker_signed_by where id = $1",
        [run.id],
      ),
    ).rejects.toThrow(/checklist_run_four_eyes/);
  });

  it("not_met and not_applicable need a reason; evidence-required items need verified evidence", async () => {
    const run = await svc.start(maker, "AA-A01");
    expect(await refusal(svc.mark(maker, run.id, "c3", { state: "not_met" }))).toBe(
      "reason_required",
    );
    expect(
      await refusal(svc.mark(maker, run.id, "c3", { state: "not_applicable", reason: "  " })),
    ).toBe("reason_required");
    expect(await refusal(svc.mark(maker, run.id, "c1", { state: "met" }))).toBe(
      "evidence_required",
    );
    expect(
      await refusal(
        svc.mark(maker, run.id, "c1", {
          state: "met",
          evidence: [{ ...evidence, sha256: "0".repeat(64) }],
        }),
      ),
    ).toBe("evidence_unverified");
    expect(await refusal(svc.mark(maker, run.id, "c99", { state: "met" }))).toBe("item_unknown");
  });

  it("a not_met item raises exactly one follow-up in the Work Inbox", async () => {
    const run = await svc.start(maker, "AA-A01");
    const a = await svc.mark(maker, run.id, "c4", {
      state: "not_met",
      reason: "Synthetic: no escalation matrix",
    });
    const ref = a.items.find((i) => i.itemId === "c4")!.actionRef;
    expect(ref).toMatch(/^ibx_/);
    await svc.mark(maker, run.id, "c4", { state: "not_met", reason: "Synthetic: still missing" });
    const items = await inbox.list(ctx("usr_admin", ["ORG_ADMIN"]), { recordRef: run.id });
    expect(
      items.filter((i) => i.recordRef === run.id && i.helpKey === "hlp.checklist.item_not_met")
        .length,
    ).toBe(1);
  });

  it("row-level security keeps a run to its tenant", async () => {
    const run = await svc.start(maker, "AA-A01");
    expect(await refusal(svc.get(ctx("usr_x", ["ORG_ADMIN"], "tnt_b"), run.id))).toBe(
      "NotFoundError",
    );
  });
});
