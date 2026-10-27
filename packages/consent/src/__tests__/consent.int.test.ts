// Consent texts, the consent and acceptance ledgers and the purge on PostgreSQL (PL5 plan §6.1).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgOutbox } from "@infrabyx/tenancy";
import { platformContext, startPostgres, withTenant, type TestDatabase } from "@infrabyx/testing";
import {
  AcceptanceLedger,
  ConsentPurge,
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
