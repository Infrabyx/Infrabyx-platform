// Consent texts, the consent and acceptance ledgers and the purge on PostgreSQL (PL5 plan §6.1).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgOutbox } from "@infrabyx/tenancy";
import { platformContext, startPostgres, withTenant, type TestDatabase } from "@infrabyx/testing";
import {
  AcceptanceLedger,
  ConsentPurge,
  ConsentSubjects,
  ConsentTexts,
  handleConsentPost,
  PgConsentLedger,
} from "../index.js";

let db: TestDatabase;
let texts: ConsentTexts;
let ledger: PgConsentLedger;
const dpo = platformContext(["PLT_DPO"], "tnt_platform", "usr_dpo");
const legal = platformContext(["PLT_LEGAL_REVIEWER"], "tnt_platform", "usr_legal");
const CID = "AbCdEfGhIjKlMnOpQrStUv";
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string }) => e.code ?? String(e),
  );

beforeAll(async () => {
  db = await startPostgres();
  texts = new ConsentTexts({ kernel: db.kernel, audit: db.audit });
  ledger = new PgConsentLedger({
    kernel: db.kernel,
    audit: db.audit,
    texts,
    product: "OH",
    outbox: new PgOutbox(),
  });
});
afterAll(async () => {
  await db?.end();
});

describe("consent texts: DPO maker, legal reviewer checker", () => {
  it("seeds template 18 as drafts; the maker cannot approve; an approved text never changes", async () => {
    expect(await texts.seedDefaults(dpo)).toBeGreaterThan(15);
    const draft = (
      await db.admin.query(
        "select id from consent.text where key = 'consent.cookie.banner' and region = 'IN'",
      )
    ).rows[0].id as string;
    expect(await code(texts.approve(dpo, draft))).toBe("IPB-UX-011");
    const approved = await texts.approve(legal, draft);
    expect(approved).toMatchObject({ state: "approved", version: "1.0" });
    await expect(
      db.admin.query("update consent.text set body = 'x' where id = $1", [draft]),
    ).rejects.toThrow(/immutable/);
    for (const key of ["consent.contact_form", "consent.cookie.gpc"]) {
      const id = (await db.admin.query("select id from consent.text where key = $1", [key])).rows[0]
        .id as string;
      await texts.approve(legal, id);
    }
    expect((await texts.current("consent.cookie.banner", { region: "EU" }))?.region).toBe("IN");
  });
});

describe("@IPB-04-AT-82 consent ledger and re-prompt; @IPB-05-AT-10 consent strings", () => {
  it("records each choice with its text, version and region; a change is a second record; the stored text never changes", async () => {
    const first = await handleConsentPost(
      ledger,
      {
        action: "save",
        categories: { analytics: "on" },
        cookies: { ibx_cid: CID },
        headers: {},
        region: "IN",
        bannerTextKey: "consent.cookie.banner",
        bannerTextVersion: "1.0",
        policyVersion: "1.0",
        fromPreferenceCentre: true,
      },
      { ttlDays: 365 },
    );
    expect(first.setCookies[1]).toMatch(
      /^ibx_consent=v1\.1\.0\.010\.cns_\w{26}; Path=\/; Max-Age=31536000; SameSite=Lax; Secure$/,
    );
    await handleConsentPost(
      ledger,
      {
        action: "reject_all",
        cookies: { ibx_cid: CID },
        headers: { "sec-gpc": "1" },
        region: "IN",
        bannerTextKey: "consent.cookie.banner",
        bannerTextVersion: "1.0",
      },
      { ttlDays: 365 },
    );
    const rows = (
      await db.admin.query(
        "select method, analytics, gpc, text_version, text_shown, region, policy_version from consent.record where cid = $1 order by recorded_at",
        [CID],
      )
    ).rows;
    expect(rows).toEqual([
      {
        method: "PREFERENCE_CENTRE",
        analytics: true,
        gpc: false,
        text_version: "1.0",
        text_shown: expect.stringMatching(/^We use cookies/),
        region: "IN",
        policy_version: "1.0",
      },
      {
        method: "CMP_BANNER",
        analytics: false,
        gpc: true,
        text_version: "1.0",
        text_shown: expect.stringMatching(/^We use cookies/),
        region: "IN",
        policy_version: null,
      },
    ]);
    expect((await ledger.getConsent(CID))?.choice).toEqual({
      functional: false,
      analytics: false,
      marketing: false,
    });
    // A new banner version does not change what earlier records say was shown.
    const v2 = await texts.draft(dpo, {
      key: "consent.cookie.banner",
      body: "Updated banner wording.",
    });
    await texts.approve(legal, v2.id);
    expect(
      (await db.admin.query("select distinct text_shown from consent.record where cid = $1", [CID]))
        .rows,
    ).toEqual([{ text_shown: expect.stringMatching(/^We use cookies/) }]);
    await expect(
      db.admin.query("update consent.record set analytics = true where cid = $1", [CID]),
    ).rejects.toThrow(/append-only/);
    expect(
      await code(
        ledger.recordConsent({
          cid: CID,
          method: "FORM",
          textKey: "consent.contact_form",
          textVersion: "9.9",
          region: "IN",
          gpc: false,
        }),
      ),
    ).toBe("IPB-CMS-001");
  });
});

describe("the acceptance ledger (IPB-05-05)", () => {
  it("asks a user to accept a re-consent version and blocks actions after a refusal with IPB-POL-010", async () => {
    const acc = new AcceptanceLedger({
      kernel: db.kernel,
      audit: db.audit,
      product: "OH",
      outbox: new PgOutbox(),
    });
    const user = withTenant("tnt_demo", ["ORG_MEMBER"], { principal: { id: "usr_member" } });
    const terms = {
      key: "terms",
      version: "2.0",
      textSha256: "a".repeat(64),
      kind: "terms" as const,
      reconsentRequired: true,
    };
    expect(await acc.pending(user, [terms])).toEqual([
      { key: "terms", version: "2.0", action: "accept" },
    ]);
    await acc.record(user, {
      key: "terms",
      version: "2.0",
      textSha256: terms.textSha256,
      kind: "refused",
    });
    expect(await code(acc.assertNotRefused(user, ["terms"]))).toBe("IPB-POL-010");
    await acc.record(user, {
      key: "terms",
      version: "2.0",
      textSha256: terms.textSha256,
      kind: "accepted",
    });
    expect(await acc.pending(user, [terms])).toEqual([]);
    expect(await code(acc.assertNotRefused(user, ["terms"]))).toBeNull();
  });
});

describe("the consent purge (OWNER-QUESTIONS #48)", () => {
  it("deletes only records replaced more than 3 years ago, ledgered; everything else is refused", async () => {
    const old = "OldOldOldOldOldOldOld1";
    const rec = (choice: "accept_all" | "reject_all") =>
      handleConsentPost(
        ledger,
        {
          action: choice,
          cookies: { ibx_cid: old },
          headers: {},
          region: "IN",
          bannerTextKey: "consent.cookie.banner",
          bannerTextVersion: "1.0",
        },
        { ttlDays: 365 },
      );
    await rec("accept_all");
    await rec("reject_all");
    await rec("accept_all");
    const ids = (
      await db.admin.query<{ id: string }>(
        "select id from consent.record where cid = $1 order by recorded_at",
        [old],
      )
    ).rows.map((r) => r.id);
    // The first record was replaced 3.5 years ago (due); the second 2 years ago and its cookie expired
    // 2.5 years ago (not due); the third is current.
    await db.admin.query("alter table consent.record disable trigger record_append_only");
    await db.admin.query(
      "update consent.record set recorded_at = now() - interval '5 years' where id = $1",
      [ids[0]],
    );
    await db.admin.query(
      "update consent.record set recorded_at = now() - interval '3 years 6 months' where id = $1",
      [ids[1]],
    );
    await db.admin.query(
      "update consent.record set recorded_at = now() - interval '2 years' where id = $1",
      [ids[2]],
    );
    await db.admin.query("alter table consent.record enable trigger record_append_only");
    const r = await new ConsentPurge({ kernel: db.kernel, audit: db.audit }).sweep();
    expect(r.deleted).toBe(1);
    expect(
      (
        await db.admin.query("select id from consent.record where cid = $1 order by recorded_at", [
          old,
        ])
      ).rows.map((x) => x.id),
    ).toEqual([ids[1], ids[2]]);
    const led = (
      await db.admin.query(
        "select actor_id from audit.ledger where action = 'consent.record.purge'",
      )
    ).rows;
    expect(led).toEqual([{ actor_id: "svc_consent_sweep" }]);
  });
});

describe("form consents for marketing leads end 24 months after the last interaction (OWNER-QUESTIONS #57)", () => {
  it("purges them 3 years after that end, never with an active relationship or under legal hold", async () => {
    const subjects = new ConsentSubjects({ kernel: db.kernel, audit: db.audit });
    const tenant = withTenant("tnt_platform");
    const lead = async (ref: string, age: string) => {
      const r = await ledger.recordConsent({
        principalRef: ref,
        method: "FORM",
        purposes: ["LEAD_CONTACT"],
        textKey: "consent.contact_form",
        textVersion: "1.0",
        region: "IN",
        gpc: false,
      });
      await db.admin.query("alter table consent.record disable trigger record_append_only");
      await db.admin.query(
        `update consent.record set recorded_at = now() - $2::interval where id = $1`,
        [r.receiptId, age],
      );
      await db.admin.query("alter table consent.record enable trigger record_append_only");
      return r.receiptId;
    };
    const quiet = await lead("form:quiet@example.org", "5 years 1 month");
    const recent = await lead("form:recent@example.org", "5 years 1 month");
    const customer = await lead("form:customer@example.org", "5 years 1 month");
    const held = await lead("form:held@example.org", "5 years 1 month");
    const young = await lead("form:young@example.org", "4 years 11 months");
    await subjects.recordInteraction(
      tenant,
      "form:recent@example.org",
      new Date(Date.now() - 4 * 365 * 86_400_000),
    );
    await subjects.setRelationship(tenant, "form:customer@example.org", true);
    expect(
      await code(
        subjects.legalHold(dpo, {
          tenantId: "tnt_platform",
          subjectRef: "form:held@example.org",
          on: true,
          reason: "Court order 12/2026",
        }),
      ),
    ).toBe("IPB-UX-011");
    await subjects.legalHold(legal, {
      tenantId: "tnt_platform",
      subjectRef: "form:held@example.org",
      on: true,
      reason: "Court order 12/2026",
    });
    await db.admin.query(
      "update consent.subject_status set updated_at = now() - interval '25 months' where subject_ref = $1",
      ["form:held@example.org"],
    );

    const purge = new ConsentPurge({ kernel: db.kernel, audit: db.audit });
    const exists = async (id: string) =>
      Boolean((await db.admin.query("select 1 from consent.record where id = $1", [id])).rowCount);
    await purge.sweep();
    expect(await exists(quiet)).toBe(false);
    for (const id of [recent, customer, held, young]) expect(await exists(id)).toBe(true);
    // A held subject's row is never purged, even when old.
    expect((await subjects.status(tenant, "form:held@example.org"))?.legalHold).toBe(true);

    // The relationship ends now: the consent's 24 months start again from today.
    await subjects.setRelationship(tenant, "form:customer@example.org", false);
    await purge.sweep();
    expect(await exists(customer)).toBe(true);

    await subjects.legalHold(legal, {
      tenantId: "tnt_platform",
      subjectRef: "form:held@example.org",
      on: false,
      reason: "Order discharged",
    });
    await purge.sweep();
    expect(await exists(held)).toBe(false);
    // Its status row goes 24 months after its last change, once no record refers to it.
    await db.admin.query(
      "update consent.subject_status set updated_at = now() - interval '25 months' where subject_ref = $1",
      ["form:held@example.org"],
    );
    expect((await purge.sweep()).subjects).toBe(1);
    expect(await subjects.status(tenant, "form:held@example.org")).toBeNull();
    const actions = (
      await db.admin.query<{ action: string }>(
        "select action from audit.ledger where action like 'consent.%hold%' or action = 'consent.subject.purge' order by seq",
      )
    ).rows.map((r) => r.action);
    expect(actions).toEqual([
      "consent.legal_hold.placed",
      "consent.legal_hold.lifted",
      "consent.subject.purge",
    ]);
  });
});

describe("the Studio list (PL5 session 8b: Consent texts)", () => {
  it("lists every text and version for the DPO and the legal reviewer, and no one else", async () => {
    const all = await texts.list(dpo);
    expect(all.some((t) => t.key === "consent.cookie.banner" && t.state === "approved")).toBe(true);
    expect((await texts.list(legal)).length).toBe(all.length);
    expect(
      await code(texts.list(platformContext(["PLT_CONTENT_EDITOR"], "tnt_platform", "usr_ed"))),
    ).toBe("IPB-UX-011");
  });
});
