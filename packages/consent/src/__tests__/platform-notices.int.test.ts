// Platform purpose notices, `latestByPrincipal` and #95's purge sweep on PostgreSQL (LawDocsComply
// PR-LDC-14; OWNER-QUESTIONS #95; R1-plan M41; R1-D-72).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import {
  defineContractSuite,
  platformContext,
  startPostgres,
  withTenant,
  type TestDatabase,
} from "@infrabyx/testing";
import {
  ConsentPurge,
  ConsentSubjects,
  ConsentTexts,
  PgConsentLedger,
  PurposeConsents,
  type PurposeNotice,
} from "../index.js";

let db: TestDatabase;
let svc: PurposeConsents;
let ledger: PgConsentLedger;
let subjects: ConsentSubjects;
const dpo = platformContext(["PLT_DPO"], "tnt_platform", "usr_dpo");
const legal = platformContext(["PLT_LEGAL_REVIEWER"], "tnt_platform", "usr_legal");
const dpoAndLegal = platformContext(["PLT_DPO", "PLT_LEGAL_REVIEWER"], "tnt_platform", "usr_dpo");
const admin = (t: string) => withTenant(t, ["ORG_ADMIN"], { principal: { id: `usr_${t}_admin` } });
const checker = (t: string) =>
  withTenant(t, ["ORG_CHECKER"], { principal: { id: `usr_${t}_chk` } });
const TERMS = "ldc.account.terms";
const MARKETING = "ldc.account.marketing";
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string; message?: string }) => e.code ?? String(e.message ?? e),
  );
const ROLLBACK = Symbol("rollback");
/** Run one statement in a kernel transaction and roll it back: its row count or its error. */
const attempt = (ctx: KernelContext, sql: string, params: unknown[]) =>
  db.kernel
    .mutate(ctx, async (tx) => {
      const r = await tx.query(sql, params);
      throw Object.assign(new Error("rollback"), { [ROLLBACK]: r.rowCount });
    })
    .then(
      () => "committed",
      (e: Record<symbol | string, unknown>) =>
        ROLLBACK in e ? (e[ROLLBACK] as number) : `${String(e.code)} ${String(e.message)}`,
    );

beforeAll(async () => {
  db = await startPostgres();
  svc = new PurposeConsents({
    kernel: db.kernel,
    audit: db.audit,
    product: "LDC",
    purposes: [
      { code: TERMS, description: "Account terms", tier: "platform" },
      { code: MARKETING, description: "Account updates" },
    ],
  });
  const texts = new ConsentTexts({ kernel: db.kernel, audit: db.audit });
  await texts.seedDefaults(dpo);
  const t = (
    await db.admin.query<{ id: string }>(
      "select id from consent.text where key = 'consent.contact_form'",
    )
  ).rows[0]!.id;
  await texts.approve(legal, t);
  ledger = new PgConsentLedger({ kernel: db.kernel, audit: db.audit, texts, product: "LDC" });
  subjects = new ConsentSubjects({ kernel: db.kernel, audit: db.audit });
});
afterAll(async () => {
  await db?.end();
});

// The port's contract cases on pg_local (the fake runs them in @infrabyx/testing).
defineContractSuite(
  "CONSENT",
  () =>
    Object.assign(ledger, {
      contractText: { textKey: "consent.contact_form", textVersion: "1.0" },
    }),
  [],
  { leg: "hermetic" },
);

let platformV1: PurposeNotice;

describe("@IPB-04-AT-03 platform purpose notices: PLT_DPO drafts, a different PLT_LEGAL_REVIEWER approves (PR-LDC-14)", () => {
  it("drafts in the platform context only; maker never checker; tenants see only the approved version", async () => {
    const body = { purpose: TERMS, language: "en-IN", body: "The account terms you agree to." };
    expect(await code(svc.draftNotice(legal, body))).toBe("IPB-UX-011");
    expect(await code(svc.draftNotice(admin("tnt_a"), body))).toBe("IPB-SEC-005");
    expect(await code(svc.draftNotice(platformContext(["PLT_DPO"], "tnt_a"), body))).toBe(
      "IPB-SEC-005",
    );
    // A tenant purpose stays the tenant's: no platform drafting of it.
    expect(await code(svc.draftNotice(dpo, { ...body, purpose: MARKETING }))).toBe("IPB-SEC-005");

    const d = await svc.draftNotice(dpo, body);
    expect(d).toMatchObject({ version: 1, state: "draft", tier: "platform", makerId: "usr_dpo" });
    expect(await svc.currentNotice(admin("tnt_a"), TERMS, "en-IN")).toBeNull();
    const seen = await db.kernel.read(
      admin("tnt_a"),
      async (tx) =>
        (await tx.query("select 1 from consent.purpose_notice where id = $1", [d.id])).rowCount,
    );
    expect(seen).toBe(0);

    expect(await code(svc.approveNotice(dpoAndLegal, d.id))).toBe("IPB-SEC-006");
    expect(await code(svc.approveNotice(dpo, d.id))).toBe("IPB-UX-011");
    expect(await code(svc.approveNotice(checker("tnt_a"), d.id))).toBe("IPB-WEB-002");
    platformV1 = await svc.approveNotice(legal, d.id);
    expect(platformV1).toMatchObject({
      state: "approved",
      checkerId: "usr_legal",
      tier: "platform",
    });

    for (const t of ["tnt_a", "tnt_b"])
      expect(await svc.currentNotice(admin(t), TERMS, "en-IN")).toMatchObject({
        id: d.id,
        tier: "platform",
        sha256: platformV1.sha256,
      });
    expect(await code(svc.retireNotice(checker("tnt_a"), d.id))).toBe("IPB-WEB-002");
    const ledgerRows = await db.admin.query<{
      tenant_id: string;
      action: string;
      actor_id: string;
    }>("select tenant_id, action, actor_id from audit.ledger where resource_id = $1 order by seq", [
      d.id,
    ]);
    expect(ledgerRows.rows).toEqual([
      { tenant_id: "tnt_platform", action: "consent.purpose_notice.draft", actor_id: "usr_dpo" },
      {
        tenant_id: "tnt_platform",
        action: "consent.purpose_notice.approve",
        actor_id: "usr_legal",
      },
    ]);
  });

  it("PostgreSQL refuses every tenant-scope write to a platform notice, whatever the tenant", async () => {
    const insert = `insert into consent.purpose_notice (id, tenant_id, purpose, version, language, body, sha256, maker_id)
                    values ('cpn_01JA0000000000000000000000', 'tnt_platform', $1, 99, 'en-IN', 'x', repeat('0', 64), 'usr_x')`;
    for (const t of ["tnt_a", "tnt_platform"])
      expect(String(await attempt(admin(t), insert, [TERMS]))).toMatch(/row-level security/);
    for (const t of ["tnt_a", "tnt_platform"]) {
      expect(
        await attempt(
          admin(t),
          "update consent.purpose_notice set state = 'retired', retired_at = now() where id = $1",
          [platformV1.id],
        ),
      ).toBe(0);
      expect(
        String(
          await attempt(admin(t), "delete from consent.purpose_notice where id = $1", [
            platformV1.id,
          ]),
        ),
      ).toMatch(/^0$|append-only/);
    }
    expect(
      (
        await db.admin.query("select state from consent.purpose_notice where id = $1", [
          platformV1.id,
        ])
      ).rows,
    ).toEqual([{ state: "approved" }]);
  });
});

describe("@IPB-04-AT-82 consent recorded against a platform notice; @IPB-02-AT-03 latestByPrincipal stays in the caller's tenant", () => {
  it("grants cite the platform notice in any tenant; the read gives the latest per purpose, one tenant only", async () => {
    // A tenant's own notice for its own purpose, beside the platform one.
    const tn = await svc.draftNotice(admin("tnt_a"), {
      purpose: MARKETING,
      language: "en-IN",
      body: "Account updates by email.",
    });
    const tApproved = await svc.approveNotice(checker("tnt_a"), tn.id);
    expect(tApproved.tier).toBe("tenant");
    // A platform purpose cannot cite a tenant notice, nor the reverse.
    expect(
      await code(
        svc.grant(admin("tnt_a"), {
          subjectRef: "per_1",
          purpose: TERMS,
          noticeId: tn.id,
          method: "SELF_SERVICE",
        }),
      ),
    ).toBe("IPB-WEB-002");
    expect(
      await code(
        svc.grant(admin("tnt_a"), {
          subjectRef: "per_1",
          purpose: MARKETING,
          noticeId: platformV1.id,
          method: "SELF_SERVICE",
        }),
      ),
    ).toBe("IPB-WEB-002");

    const g = await svc.grant(admin("tnt_a"), {
      subjectRef: "per_1",
      purpose: TERMS,
      noticeId: platformV1.id,
      method: "SELF_SERVICE",
    });
    expect(g).toMatchObject({
      granted: true,
      noticeId: platformV1.id,
      noticeSha256: platformV1.sha256,
    });
    await svc.grant(admin("tnt_a"), {
      subjectRef: "per_1",
      purpose: MARKETING,
      noticeId: tn.id,
      method: "SELF_SERVICE",
    });
    const w = await svc.withdraw(admin("tnt_a"), {
      subjectRef: "per_1",
      purpose: MARKETING,
      method: "SELF_SERVICE",
    });
    const lead = await ledger.recordConsent(
      {
        principalRef: "per_1",
        method: "FORM",
        purposes: ["LEAD_CONTACT"],
        textKey: "consent.contact_form",
        textVersion: "1.0",
        region: "IN",
        gpc: false,
      },
      { tenantId: "tnt_a" },
    );
    // The same person in another tenant.
    const b = await svc.grant(admin("tnt_b"), {
      subjectRef: "per_1",
      purpose: TERMS,
      noticeId: platformV1.id,
      method: "ASSISTED",
    });

    const a = await ledger.latestByPrincipal("per_1", { tenantId: "tnt_a" });
    expect(a).toEqual([
      expect.objectContaining({
        purpose: "LEAD_CONTACT",
        granted: true,
        receiptId: lead.receiptId,
        shown: "consent.contact_form@1.0",
        platformNotice: false,
      }),
      expect.objectContaining({
        purpose: MARKETING,
        granted: false,
        receiptId: w.receiptId,
        shown: null,
      }),
      expect.objectContaining({
        purpose: TERMS,
        granted: true,
        receiptId: g.receiptId,
        shown: `${platformV1.id}@1`,
        noticeSha256: platformV1.sha256,
        platformNotice: true,
      }),
    ]);
    expect(await ledger.latestByPrincipal("per_1", { tenantId: "tnt_b" })).toEqual([
      expect.objectContaining({ purpose: TERMS, receiptId: b.receiptId, platformNotice: true }),
    ]);
    expect(await ledger.latestByPrincipal("per_1", { tenantId: "tnt_c" })).toEqual([]);
  });
});

describe("OWNER-QUESTIONS #95: the purpose-consent purge sweep (R1-D-72)", () => {
  const T = "tnt_sweep";
  const O = "tnt_other";
  const exists = async (table: string, id: string) =>
    Boolean((await db.admin.query(`select 1 from consent.${table} where id = $1`, [id])).rowCount);
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
  const grant = (t: string, subjectRef: string, purpose: string, noticeId: string) =>
    svc.grant(admin(t), { subjectRef, purpose, noticeId, method: "ASSISTED" });
  const withdraw = (t: string, subjectRef: string, purpose: string) =>
    svc.withdraw(admin(t), { subjectRef, purpose, method: "ASSISTED" });

  it("purges only once the relationship ended 8 years ago and any withdrawal is as old; keeps held ones; ledgered; idempotent", async () => {
    const purge = new ConsentPurge({ kernel: db.kernel, audit: db.audit });
    // Platform notices: v2 (cited only by records that become due) and v1 (also cited in another tenant).
    const d2 = await svc.draftNotice(dpo, {
      purpose: TERMS,
      language: "en-IN",
      body: "Terms, version two.",
    });
    const v2 = await svc.approveNotice(legal, d2.id);
    // v3: cited by a due record here and by a live record in another tenant only.
    const d3 = await svc.draftNotice(dpo, {
      purpose: TERMS,
      language: "en-IN",
      body: "Terms, version three.",
    });
    const v3 = await svc.approveNotice(legal, d3.id);
    // A tenant notice cited only by records that become due.
    const tn = await svc.approveNotice(
      checker(T),
      (await svc.draftNotice(admin(T), { purpose: MARKETING, language: "en-IN", body: "Updates." }))
        .id,
    );

    const gW = await grant(T, "per_withdrawn", TERMS, v2.id);
    const wW = await withdraw(T, "per_withdrawn", TERMS);
    const gW2 = await grant(T, "per_withdrawn", MARKETING, tn.id);
    const wW2 = await withdraw(T, "per_withdrawn", MARKETING);
    const gV1 = await grant(T, "per_v1", TERMS, platformV1.id);
    const wV1 = await withdraw(T, "per_v1", TERMS);
    const gV3 = await grant(T, "per_v3", TERMS, v3.id);
    const wV3 = await withdraw(T, "per_v3", TERMS);
    const gO3 = await grant(O, "per_o3", TERMS, v3.id);
    // Withdrawn 9 years ago, relationship still active (reported) or never reported ended: kept.
    const gActiveW = await grant(T, "per_active_w", TERMS, platformV1.id);
    const wActiveW = await withdraw(T, "per_active_w", TERMS);
    const gNeverW = await grant(T, "per_never_w", TERMS, platformV1.id);
    const wNeverW = await withdraw(T, "per_never_w", TERMS);
    // Relationship ended 9 years ago, but withdrawn only 2 years ago: kept.
    const gLateW = await grant(T, "per_late_w", TERMS, platformV1.id);
    const wLateW = await withdraw(T, "per_late_w", TERMS);
    const gEnded = await grant(T, "per_ended", TERMS, platformV1.id);
    const gEndedRecent = await grant(T, "per_ended_recent", TERMS, platformV1.id);
    const gLive = await grant(T, "per_live", TERMS, platformV1.id);
    const gHeld = await grant(T, "per_held", TERMS, platformV1.id);
    const wHeld = await withdraw(T, "per_held", TERMS);
    const gOther = await grant(O, "per_withdrawn", TERMS, platformV1.id);
    const wOther = await withdraw(O, "per_withdrawn", TERMS);
    // Withdrawn 9 years ago in tnt_sweep; in tnt_other the same person withdrew a year ago.
    await age(
      [gW, gW2, gV1, gV3, gHeld, gActiveW, gNeverW].map((x) => x.receiptId),
      "10 years",
    );
    await age(
      [wW, wW2, wV1, wV3, wHeld, wActiveW, wNeverW].map((x) => x.receiptId),
      "9 years",
    );
    await age([gLateW.receiptId], "12 years");
    await age([wLateW.receiptId], "2 years");
    await age([gEnded.receiptId, gEndedRecent.receiptId], "12 years");
    await age([gLive.receiptId], "20 years");
    await age([gOther.receiptId], "10 years");
    await age([wOther.receiptId], "1 year");
    // The relationship ended 9 years ago for these; 7 years ago for per_ended_recent; per_active_w
    // is a current customer; per_never_w, per_live and tnt_other's people have no reported end.
    const nineYearsAgo = new Date(Date.now() - 9 * 366 * 86_400_000);
    for (const s of ["per_withdrawn", "per_v1", "per_v3", "per_held", "per_late_w", "per_ended"])
      await subjects.endRelationship(admin(T), s, nineYearsAgo);
    await subjects.endRelationship(
      admin(T),
      "per_ended_recent",
      new Date(Date.now() - 7 * 365 * 86_400_000),
    );
    await subjects.setRelationship(admin(T), "per_active_w", true);
    expect((await subjects.status(admin(T), "per_ended"))?.relationshipEndedAt).toBeInstanceOf(
      Date,
    );
    await subjects.legalHold(legal, {
      tenantId: T,
      subjectRef: "per_held",
      on: true,
      reason: "Arbitration claim pending",
    });
    // Retired, so no longer offered; past grants keep citing them.
    for (const id of [v2.id, v3.id, platformV1.id]) await svc.retireNotice(legal, id);
    await svc.retireNotice(checker(T), tn.id);

    // Nothing but the sweep may delete, even a due record.
    expect(
      String(
        await attempt(admin(T), "delete from consent.purpose_record where id = $1", [gW.receiptId]),
      ),
    ).toMatch(/append-only/);
    await expect(
      db.admin.query("delete from consent.purpose_record where id = $1", [gW.receiptId]),
    ).rejects.toThrow(/append-only/);

    const first = await purge.sweepPurposes({ batch: 3 });
    expect(first).toEqual({ records: 9, tenantNotices: 1, platformNotices: 1 });
    for (const id of [gW, wW, gW2, wW2, gV1, wV1, gV3, wV3, gEnded].map((x) => x.receiptId))
      expect(await exists("purpose_record", id)).toBe(false);
    for (const x of [
      gActiveW,
      wActiveW,
      gNeverW,
      wNeverW,
      gLateW,
      wLateW,
      gEndedRecent,
      gLive,
      gHeld,
      wHeld,
      gOther,
      wOther,
      gO3,
    ])
      expect(await exists("purpose_record", x.receiptId)).toBe(true);
    // v2 and the tenant notice went with their last records. v1 is still cited here, and v3 only
    // in another tenant (which the platform tenant cannot see; the foreign key does), so both stay.
    expect(await exists("purpose_notice", v2.id)).toBe(false);
    expect(await exists("purpose_notice", tn.id)).toBe(false);
    expect(await exists("purpose_notice", platformV1.id)).toBe(true);
    expect(await exists("purpose_notice", v3.id)).toBe(true);
    const purges = await db.admin.query<{ tenant_id: string; action: string; actor_id: string }>(
      `select tenant_id, action, actor_id from audit.ledger
        where action in ('consent.purpose.purge', 'consent.purpose_notice.purge') order by tenant_id, seq`,
    );
    // Batches of at most 3: three entries for nine records in tnt_sweep; one platform entry.
    expect(purges.rows).toEqual([
      {
        tenant_id: "tnt_platform",
        action: "consent.purpose_notice.purge",
        actor_id: "svc_consent_sweep",
      },
      { tenant_id: T, action: "consent.purpose.purge", actor_id: "svc_consent_sweep" },
      { tenant_id: T, action: "consent.purpose.purge", actor_id: "svc_consent_sweep" },
      { tenant_id: T, action: "consent.purpose.purge", actor_id: "svc_consent_sweep" },
    ]);

    // Re-run: nothing more is due, and no purge entry is written.
    expect(await purge.sweepPurposes()).toEqual({
      records: 0,
      tenantNotices: 0,
      platformNotices: 0,
    });
    expect(
      (
        await db.admin.query(
          "select 1 from audit.ledger where action like 'consent.purpose%.purge'",
        )
      ).rowCount,
    ).toBe(4);

    // Lifting the hold lets the held records go at the next run; the relationship restarting keeps them.
    await subjects.setRelationship(admin(T), "per_ended_recent", true);
    expect((await subjects.status(admin(T), "per_ended_recent"))?.relationshipEndedAt).toBeNull();
    await subjects.legalHold(legal, {
      tenantId: T,
      subjectRef: "per_held",
      on: false,
      reason: "Claim settled",
    });
    expect(await purge.sweepPurposes()).toEqual({
      records: 2,
      tenantNotices: 0,
      platformNotices: 0,
    });
    expect(await exists("purpose_record", gHeld.receiptId)).toBe(false);
    expect(await exists("purpose_record", gEndedRecent.receiptId)).toBe(true);
    // A withdrawal never shortens it: still kept while the relationship is active or not ended.
    for (const x of [gActiveW, wActiveW, gNeverW, wNeverW, gLateW, wLateW])
      expect(await exists("purpose_record", x.receiptId)).toBe(true);
  });

  it("keeps a subject status row while a purpose-consent record of the person remains", async () => {
    await db.admin.query(
      "update consent.subject_status set updated_at = now() - interval '25 months' where tenant_id = $1",
      [T],
    );
    const purge = new ConsentPurge({ kernel: db.kernel, audit: db.audit });
    await purge.sweep();
    // per_ended (no record left) goes under #57's rule; per_ended_recent (a record left) stays.
    expect(await subjects.status(admin(T), "per_ended")).toBeNull();
    expect(await subjects.status(admin(T), "per_ended_recent")).not.toBeNull();
  });
});
