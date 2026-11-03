// Consent to product purposes on PostgreSQL (Finbyx PR-FBX-26; R1-D-38).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgOutbox } from "@infrabyx/tenancy";
import { startPostgres, withTenant, type TestDatabase } from "@infrabyx/testing";
import { PurposeConsents } from "../index.js";

let db: TestDatabase;
let svc: PurposeConsents;
const maker = withTenant("tnt_a", ["ORG_MAKER"], { principal: { id: "usr_maker" } });
const checker = withTenant("tnt_a", ["ORG_CHECKER"], { principal: { id: "usr_checker" } });
const otherTenant = withTenant("tnt_b", ["ORG_CHECKER"], { principal: { id: "usr_b" } });
const staff = withTenant("tnt_a", ["ORG_MEMBER"], { principal: { id: "usr_staff" } });
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string; message?: string }) => e.code ?? String(e.message ?? e),
  );

beforeAll(async () => {
  db = await startPostgres();
  svc = new PurposeConsents({
    kernel: db.kernel,
    audit: db.audit,
    product: "FBX",
    outbox: new PgOutbox(),
    purposes: [
      { code: "fbx.kyc.processing", description: "KYC processing" },
      { code: "fbx.kyc.ckyc_download", description: "CKYC download" },
    ],
  });
});
afterAll(async () => {
  await db?.end();
});

describe("product purposes in the consent ledger (PR-FBX-26)", () => {
  it("refuses purposes outside the product's namespace", () => {
    expect(
      () =>
        new PurposeConsents({
          kernel: db.kernel,
          audit: db.audit,
          product: "FBX",
          purposes: [{ code: "udf.kyc.processing", description: "x" }],
        }),
    ).toThrow(/start with fbx\./);
  });

  it("drafts notices per tenant and language under maker-checker; approved text never changes", async () => {
    const d1 = await svc.draftNotice(maker, {
      purpose: "fbx.kyc.processing",
      language: "en-IN",
      body: "We process your KYC documents to open your loan account.",
    });
    expect(d1).toMatchObject({ version: 1, state: "draft" });
    expect(d1.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(d1.sha256).not.toBe("0".repeat(64));
    expect(await code(svc.approveNotice(staff, d1.id))).toBe("IPB-UX-011");
    const self = withTenant("tnt_a", ["ORG_ADMIN"], { principal: { id: "usr_maker" } });
    expect(await code(svc.approveNotice(self, d1.id))).toBe("IPB-SEC-006");
    expect(await code(svc.approveNotice(otherTenant, d1.id))).toBe("IPB-WEB-002");
    const a1 = await svc.approveNotice(checker, d1.id);
    expect(a1).toMatchObject({ state: "approved", checkerId: "usr_checker" });
    await expect(
      db.admin.query("update consent.purpose_notice set body = 'x' where id = $1", [d1.id]),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.admin.query("delete from consent.purpose_notice where id = $1", [d1.id]),
    ).rejects.toThrow(/append-only/);
    const d2 = await svc.draftNotice(maker, {
      purpose: "fbx.kyc.processing",
      language: "en-IN",
      body: "Version two of the KYC notice.",
    });
    expect(d2.version).toBe(2);
    expect((await svc.currentNotice(maker, "fbx.kyc.processing", "en-IN"))?.version).toBe(1);
    expect(await svc.currentNotice(otherTenant, "fbx.kyc.processing", "en-IN")).toBeNull();
  });

  it("records a grant against the exact notice, a withdrawal as a new row, and reads the state", async () => {
    const n = (await svc.currentNotice(maker, "fbx.kyc.processing", "en-IN"))!;
    expect(await svc.consentState(staff, "cus_1", "fbx.kyc.processing")).toBeNull();
    const draft = await svc.draftNotice(maker, {
      purpose: "fbx.kyc.ckyc_download",
      language: "hi-IN",
      body: "CKYC डाउनलोड की सूचना",
    });
    expect(
      await code(
        svc.grant(staff, {
          subjectRef: "cus_1",
          purpose: "fbx.kyc.ckyc_download",
          noticeId: draft.id,
          method: "ASSISTED",
        }),
      ),
    ).toBe("IPB-WEB-002");
    expect(
      await code(
        svc.grant(staff, {
          subjectRef: "cus_1",
          purpose: "fbx.kyc.ckyc_download",
          noticeId: n.id,
          method: "ASSISTED",
        }),
      ),
    ).toBe("IPB-WEB-002");
    const g = await svc.grant(staff, {
      subjectRef: "cus_1",
      purpose: "fbx.kyc.processing",
      noticeId: n.id,
      method: "ASSISTED",
    });
    expect(g).toMatchObject({
      granted: true,
      noticeVersion: 1,
      language: "en-IN",
      noticeSha256: n.sha256,
    });
    expect(await svc.consentState(staff, "cus_1", "fbx.kyc.processing")).toMatchObject({
      granted: true,
      receiptId: g.receiptId,
    });
    const w = await svc.withdraw(staff, {
      subjectRef: "cus_1",
      purpose: "fbx.kyc.processing",
      method: "SELF_SERVICE",
    });
    expect(await svc.consentState(staff, "cus_1", "fbx.kyc.processing")).toMatchObject({
      granted: false,
      receiptId: w.receiptId,
    });
    expect(await svc.consentState(otherTenant, "cus_1", "fbx.kyc.processing")).toBeNull();
    await expect(
      db.admin.query("update consent.purpose_record set action = 'granted' where id = $1", [
        w.receiptId,
      ]),
    ).rejects.toThrow(/append-only/);
    const ledger = await db.admin.query(
      "select action from audit.ledger where resource_id = any($1::text[]) order by seq",
      [[g.receiptId, w.receiptId]],
    );
    expect(ledger.rows.map((r) => r.action)).toEqual([
      "consent.purpose.grant",
      "consent.purpose.withdraw",
    ]);
    const events = await db.admin.query(
      "select type, envelope from consent.outbox where envelope->'data'->>'receipt_id' = any($1::text[])",
      [[g.receiptId, w.receiptId]],
    );
    expect(events.rows).toHaveLength(2);
    expect(events.rows[0].type).toContain("PurposeConsentChanged");
    expect(JSON.stringify(events.rows)).not.toContain("cus_1");
  });

  it("refuses agents and unknown purposes", async () => {
    const agent = { ...staff, principal: { id: "agt_1", type: "agent" as const, roles: [] } };
    expect(
      await code(
        svc.withdraw(agent, { subjectRef: "cus_1", purpose: "fbx.kyc.processing", method: "API" }),
      ),
    ).toBe("IPB-SEC-004");
    await expect(
      svc.withdraw(staff, { subjectRef: "cus_1", purpose: "fbx.unknown", method: "API" }),
    ).rejects.toThrow(/unknown purpose/);
  });
});
