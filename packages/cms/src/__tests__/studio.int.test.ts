// CMS core on PostgreSQL with every platform migration applied (PL5 plan §5.3–§5.6, session 4).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditService } from "@infrabyx/audit";
import { PgOutbox } from "@infrabyx/tenancy";
import {
  FakeMedia,
  MemoryStorage,
  platformContext,
  testPng,
  startPostgres,
  withTenant,
  type TestDatabase,
} from "@infrabyx/testing";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import { CmsPurge } from "../purge.js";
import { handlePublicApi, PublicContent } from "../public.js";
import { CmsScheduler } from "../scheduler.js";
import { CmsStudio } from "../studio.js";
import { MediaLibrary } from "../media.js";

let db: TestDatabase;
let studio: CmsStudio;
let reader: PublicContent;
let scheduler: CmsScheduler;
let media: MediaLibrary;
const storage = new MemoryStorage();
const notices: { itemId: string; authorId: string; reason: string }[] = [];
const revalidated: string[] = [];
const PACK = "brd_01JB0000000000000000000001";
const a = platformContext(["PLT_CONTENT_EDITOR"], "tnt_platform", "usr_editor_a");
const b = platformContext(["PLT_CONTENT_EDITOR"], "tnt_platform", "usr_editor_b");
const legal = platformContext(["PLT_LEGAL_REVIEWER"], "tnt_platform", "usr_legal");
const agent: KernelContext = {
  tenantId: "tnt_platform",
  scope: "platform",
  principal: { id: "agt_vidhi", type: "agent", roles: ["AGT_VIDHI"] },
};

const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string }) => e.code ?? String(e),
  );
const para = (text: string) => [
  { _type: "block", style: "normal", markDefs: [], children: [{ _type: "span", text, marks: [] }] },
];
const article = (text: string) => ({
  template: "article",
  blocks: [{ type: "rich_text", slot: "body", content: para(text) }],
});
const ledger = async (like: string) =>
  (
    await db.admin.query<{
      action: string;
      actor_id: string;
      resource_id: string;
      tenant_id: string;
    }>(
      "select action, actor_id, resource_id, tenant_id from audit.ledger where action like $1 order by occurred_at, seq",
      [like],
    )
  ).rows;

async function publish(id: string, maker = a, checker = b) {
  await studio.submit(maker, id);
  await studio.approve(checker, id);
  return studio.publishNow(checker, id);
}

beforeAll(async () => {
  db = await startPostgres();
  const outbox = new PgOutbox();
  studio = new CmsStudio({
    kernel: db.kernel,
    audit: db.audit,
    product: "OH",
    outbox,
    hooks: {
      notifyAuthor: async (_ctx, n) => void notices.push(n),
      onPublished: (n) => void revalidated.push(...n.routes),
      indexNowEnabled: async () => true,
    },
  });
  reader = new PublicContent({ kernel: db.kernel });
  scheduler = new CmsScheduler({
    kernel: db.kernel,
    audit: db.audit,
    product: "OH",
    outbox,
    indexNowEnabled: async () => true,
  });
  media = new MediaLibrary({ kernel: db.kernel, audit: db.audit, storage });
});
afterAll(async () => {
  await db?.end();
});

describe("@IPB-04-AT-01 revision immutability and audit", () => {
  it("a save creates r2; r1 is byte-identical; the ledger records r1→r2 and the chain verifies", async () => {
    const created = await studio.createItem(a, {
      type: "page",
      packId: PACK,
      slug: "story",
      title: "Story",
      body: article("First"),
    });
    await publish(created.item.id);
    const r1 = (
      await db.admin.query("select row_to_json(r)::text as j from cms.revision r where id = $1", [
        created.revision.id,
      ])
    ).rows[0].j;
    const saved = await studio.saveDraft(a, created.item.id, {
      title: "Story",
      slug: "story",
      body: article("Second"),
    });
    expect(saved.revision.seq).toBe(2);
    expect(
      (
        await db.admin.query("select row_to_json(r)::text as j from cms.revision r where id = $1", [
          created.revision.id,
        ])
      ).rows[0].j,
    ).toBe(r1);
    await expect(
      db.admin.query("update cms.revision set body = '{}' where id = $1", [created.revision.id]),
    ).rejects.toThrow(/immutable/);
    const save = await db.admin.query<{ actor_id: string }>(
      "select actor_id from audit.ledger where action = 'cms.content.save' and resource_id = $1",
      [created.item.id],
    );
    expect(save.rows).toEqual([{ actor_id: "usr_editor_a" }]);
    const svc = new AuditService({ kernel: db.kernel, sink: db.audit, product: "OH" });
    expect((await svc.verify(platformContext(["PLT_AUDITOR_RO"]))).ok).toBe(true);
    // The published revision keeps serving while r2 is a draft.
    const served = await reader.resolve(PACK, "en-IN", "/story");
    expect(served.kind === "content" && served.content.revisionId).toBe(created.revision.id);
  });
});

describe("@IPB-04-AT-02 state machine and agents as makers only", () => {
  it("submit moves to in_review; the author cannot approve; an agent cannot approve or publish", async () => {
    const own = await studio.createItem(a, {
      type: "page",
      packId: PACK,
      slug: "own",
      title: "Own",
      body: article("x"),
    });
    expect((await studio.submit(a, own.item.id)).status).toBe("in_review");
    expect(await code(studio.approve(a, own.item.id))).toBe("IPB-CMS-004");
    expect(
      await code(studio.schedule(b, own.item.id, { publishAt: new Date(Date.now() + 60_000) })),
    ).toBe("IPB-CMS-003");
    // Agents are makers only (IPB-04 §04.4.3), and IPB-02-11 keeps them out of the platform scope
    // altogether, so in the platform CMS they cannot even save a draft.
    expect(await code(studio.approve(agent, own.item.id))).toBe("IPB-SEC-004");
    expect(await code(studio.publishNow(agent, own.item.id))).toBe("IPB-SEC-004");
    expect(
      await code(
        studio.createItem(agent, {
          type: "page",
          packId: PACK,
          slug: "agent-draft",
          title: "Agent draft",
          body: article("x"),
        }),
      ),
    ).toBe("IPB-SEC-005");
  });
});

describe("@IPB-04-AT-03 maker-checker and the legal gate", () => {
  it("A cannot approve; B cannot approve before legal; legal then B lets the page publish", async () => {
    const { item } = await studio.createItem(a, {
      type: "legal_page",
      packId: PACK,
      slug: "privacy",
      title: "Privacy Notice",
      body: {
        policy_key: "privacy",
        version_label: "1.0",
        effective_at: "2026-11-01T00:00:00+05:30",
        summary_of_changes: "First version",
        body: para("Placeholder"),
      },
    });
    expect((await studio.submit(a, item.id)).status).toBe("legal_review");
    expect(await code(studio.approve(a, item.id))).toBe("IPB-CMS-004");
    expect(await code(studio.approve(b, item.id))).toBe("IPB-CMS-005");
    expect(await code(studio.legalApprove(b, item.id))).toBe("IPB-UX-011");
    expect((await studio.legalApprove(legal, item.id)).status).toBe("in_review");
    expect((await studio.approve(b, item.id)).status).toBe("approved");
    expect((await studio.publishNow(b, item.id)).publishedPath).toBe("/legal/privacy");
  });
});

describe("@IPB-04-AT-04 scheduling, the sitemap and IndexNow", () => {
  it("publishes at the minute, lists the item in the sitemap with lastmod and logs the IndexNow push", async () => {
    const { item } = await studio.createItem(a, {
      type: "page",
      packId: PACK,
      slug: "launch",
      title: "Launch",
      body: article("Launch"),
    });
    await studio.submit(a, item.id);
    await studio.approve(b, item.id);
    const at = new Date(Date.now() + 120_000);
    expect((await studio.schedule(b, item.id, { publishAt: at })).status).toBe("scheduled");
    expect((await scheduler.tick(new Date(at.getTime() - 1000))).published).not.toContain(item.id);
    const run = await scheduler.tick(new Date(at.getTime() + 30_000));
    expect(run.published).toContain(item.id);
    const entries = await reader.siteEntries(PACK);
    expect(entries.find((e) => e.path === "/launch")?.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const pushes = await db.admin.query<{ resource_id: string }>(
      "select resource_id from audit.ledger where action = 'cms.indexnow.push'",
    );
    expect(pushes.rows.map((r) => r.resource_id)).toContain(PACK);
  });
});

describe("@IPB-04-AT-05 preview URL", () => {
  it("renders the draft revision with no-index headers within 24 h and 410 IPB-CMS-006 afterwards", async () => {
    const { item, revision } = await studio.createItem(a, {
      type: "page",
      packId: PACK,
      slug: "preview-me",
      title: "Preview me",
      body: article("Draft"),
    });
    const p = await studio.createPreview(a, item.id);
    const ok = await reader.preview(p.token);
    expect(ok).toMatchObject({
      revisionId: revision.id,
      banner: "Preview — not published",
      headers: { "X-Robots-Tag": "noindex", "Cache-Control": "no-store" },
    });
    expect(await code(reader.preview(p.token, new Date(Date.now() + 25 * 3_600_000)))).toBe(
      "IPB-CMS-006",
    );
    expect(await code(reader.preview("not-a-token"))).toBe("IPB-CMS-006");
    await studio.revokePreview(a, item.id);
    expect(await code(reader.preview(p.token))).toBe("IPB-CMS-006");
    const stored = await db.admin.query(
      "select token_sha256 from cms.preview_token where content_item_id = $1",
      [item.id],
    );
    expect(JSON.stringify(stored.rows)).not.toContain(p.token);
  });
});

describe("@IPB-04-AT-06 Claims Register lint at submit", () => {
  it("refuses a figure without a claim (ledgered as ClaimsLintFailed), then passes with an E1 claim", async () => {
    const stats = (ref?: string) => ({
      template: "blank",
      blocks: [
        {
          type: "stats",
          items: [{ value: "10,000+", label: "customers", ...(ref ? { claims_ref: ref } : {}) }],
        },
      ],
    });
    const { item } = await studio.createItem(a, {
      type: "page",
      packId: PACK,
      slug: "numbers",
      title: "Numbers",
      body: stats(),
    });
    expect(await code(studio.submit(a, item.id))).toBe("IPB-CMS-010");
    expect((await ledger("cms.claims_lint.failed")).map((r) => r.resource_id)).toContain(item.id);
    const failed = await db.admin.query(
      "select 1 from cms.outbox where type like '%.ClaimsLintFailed.%'",
    );
    expect(failed.rowCount).toBeGreaterThan(0);
    const { id: claimId } = await studio.proposeClaim(a, {
      text: "Customers served",
      value: "10,000",
      asOf: "2026-09-30",
      reviewDue: "2027-09-30",
    });
    expect(await code(studio.assignClaim(a, claimId, { evidenceClass: "E1" }))).toBe("IPB-UX-011");
    await studio.saveDraft(a, item.id, { title: "Numbers", slug: "numbers", body: stats(claimId) });
    expect(await code(studio.submit(a, item.id))).toBe("IPB-CMS-010");
    await studio.assignClaim(legal, claimId, { evidenceClass: "E1" });
    expect((await studio.submit(a, item.id)).status).toBe("in_review");
  });
});

describe("@IPB-04-AT-08 redirects and slug changes", () => {
  it("refuses B→A after A→B, imports nothing on a dry run, and answers 301 after a slug change", async () => {
    const r1 = await studio.addRedirect(a, PACK, { from: "/old-a", to: "/old-b", status: 301 });
    expect(
      await code(studio.addRedirect(a, PACK, { from: "/old-b", to: "/old-a", status: 301 })),
    ).toBe("IPB-CMS-009");
    expect(await code(studio.reviewRedirect(a, r1.id, "checker"))).toBe("IPB-CMS-004");
    expect((await studio.reviewRedirect(b, r1.id, "checker")).active).toBe(false);
    expect((await studio.reviewRedirect(legal, r1.id, "legal")).active).toBe(true);
    const csv = [
      "from_path,to_path,status",
      ...Array.from({ length: 500 }, (_, i) => `/legacy-${i},/new-${i},301`),
    ].join("\n");
    const before = (await db.admin.query("select count(*)::int as n from cms.redirect")).rows[0].n;
    const dry = await studio.importRedirects(a, PACK, csv);
    expect(dry.accepted).toHaveLength(500);
    expect((await db.admin.query("select count(*)::int as n from cms.redirect")).rows[0].n).toBe(
      before,
    );

    const { item } = await studio.createItem(a, {
      type: "page",
      packId: PACK,
      slug: "products",
      title: "Products",
      body: article("P"),
    });
    await publish(item.id);
    await studio.saveDraft(a, item.id, {
      title: "Products",
      slug: "our-products",
      body: article("P"),
    });
    await publish(item.id);
    expect(await reader.resolve(PACK, "en-IN", "/products")).toMatchObject({
      kind: "redirect",
      status: 301,
      to: "/our-products",
    });
    expect((await reader.resolve(PACK, "en-IN", "/our-products")).kind).toBe("content");
  });
});

describe("@IPB-04-AT-09 @IPB-06-AT-03 media alt text and photo consent", () => {
  it("refuses an image without alt text (IPB-CMS-007) and a team photo without consent (IPB-CMS-014)", async () => {
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0,
      0,
    ]);
    const img = await media.upload(a, { mime: "image/png", bytes: png });
    const { item } = await studio.createItem(a, {
      type: "page",
      packId: PACK,
      slug: "with-image",
      title: "With image",
      body: { template: "blank", blocks: [{ type: "media", media_id: img.id }] },
    });
    expect(await code(studio.submit(a, item.id))).toBe("IPB-CMS-007");
    await media.describe(a, img.id, { altText: "The office entrance" });
    expect((await studio.submit(a, item.id)).status).toBe("in_review");
    const person = await studio.createItem(a, {
      type: "team_member",
      packId: PACK,
      title: "Person",
      body: {
        name: "A Person",
        role: "Engineer",
        group: "team",
        photo_media_id: img.id,
        photo_consent: false,
      },
    });
    expect(await code(studio.submit(a, person.item.id))).toBe("IPB-CMS-014");
    expect(await code(media.softDelete(a, img.id))).toBe("IPB-CMS-003");
  });
});

describe("@IPB-04-AT-09 raster re-encoding through the MEDIA port (OWNER-QUESTIONS #53)", () => {
  it("stores AVIF, WebP and a PNG fallback at the fixed widths, serves them as picture sources, and purges them with the media", async () => {
    let on = true;
    const port = new FakeMedia();
    const lib = new MediaLibrary({
      kernel: db.kernel,
      audit: db.audit,
      storage,
      media: port,
      settings: { get: async (_c, k) => (k === "cms.media.reencode_enabled" ? on : undefined) },
    });
    const up = await lib.upload(a, {
      mime: "image/png",
      bytes: testPng(1400, 700),
      altText: "A gradient",
    });
    expect(up.renditions.map((r) => `${r.format}@${r.width}`).sort()).toEqual(
      ["avif", "webp", "png"].flatMap((f) => [320, 640, 960, 1280].map((w) => `${f}@${w}`)).sort(),
    );
    for (const r of up.renditions) expect(storage.objects.has(r.key)).toBe(true);
    const src = await lib.sources(a, up.id);
    expect(src.sources.map((x) => x.mime)).toEqual(["image/avif", "image/webp"]);
    expect(src.sources[0]!.srcset.map((x) => x.width)).toEqual([320, 640, 960, 1280]);
    expect(src.fallback?.mime).toBe("image/png");
    expect([src.alt, src.width, src.height]).toEqual(["A gradient", 1280, 640]);

    on = false;
    const plain = await lib.upload(a, { mime: "image/png", bytes: testPng(300, 200) });
    expect(plain.renditions).toEqual([]);
    expect((await lib.sources(a, plain.id)).fallback).toBeNull();
    expect(port.calls).toEqual(["reencode 1400x700"]);

    await lib.softDelete(a, up.id);
    await db.admin.query(
      "update cms.media set deleted_at = now() - interval '91 days' where id = $1",
      [up.id],
    );
    expect(
      (await new CmsPurge({ kernel: db.kernel, audit: db.audit, storage }).sweep()).media,
    ).toContain(up.id);
    for (const r of up.renditions)
      await expect(storage.get(r.key)).rejects.toMatchObject({ code: "IPB-STOR-001" });
  });
});

describe("@IPB-04-AT-10 pages and menus without code", () => {
  it("creates a product page, links it from the header menu, then retires it to a redirect", async () => {
    const page = await studio.createItem(a, {
      type: "page",
      packId: PACK,
      slug: "widget",
      title: "Widget",
      body: {
        template: "product",
        blocks: [
          { type: "hero", slot: "hero", heading: "Widget" },
          {
            type: "feature_grid",
            slot: "features",
            items: [{ title: "Fast", text: "It is quick." }],
          },
          {
            type: "cta",
            slot: "cta",
            heading: "Talk to us",
            button: { label: "Contact", href: "/contact" },
          },
        ],
      },
    });
    const missing = await studio.createItem(a, {
      type: "page",
      packId: PACK,
      slug: "half",
      title: "Half",
      body: { template: "product", blocks: [] },
    });
    expect(await code(studio.submit(a, missing.item.id))).toBe("IPB-CMS-003");
    await publish(page.item.id);
    const menu = await studio.createItem(a, {
      type: "nav_menu",
      packId: PACK,
      title: "Header",
      body: { location: "header", items: [{ label: "Widget", target_item_id: page.item.id }] },
    });
    await publish(menu.item.id);
    expect((await reader.list(PACK, { type: "nav_menu" }))[0]?.body).toMatchObject({
      items: [{ label: "Widget" }],
    });
    // /products itself redirects to /our-products (AT-08 above), so a retire to it would chain.
    expect(
      await code(studio.unpublish(b, page.item.id, { behaviour: "redirect", to: "/products" })),
    ).toBe("IPB-CMS-009");
    await studio.unpublish(b, page.item.id, { behaviour: "redirect", to: "/our-products" });
    expect(await reader.resolve(PACK, "en-IN", "/widget")).toMatchObject({
      kind: "redirect",
      status: 301,
      to: "/our-products",
    });
  });
});

describe("@IPB-04-AT-11 locale fallback and machine translation", () => {
  it("serves en-IN with lang en-IN for a hi-IN request, and refuses a machine-translated draft", async () => {
    const en = await studio.createItem(a, {
      type: "page",
      packId: PACK,
      slug: "about-us",
      title: "About",
      body: article("About us"),
    });
    await publish(en.item.id);
    const r = await reader.resolve(PACK, "hi-IN", "/about-us");
    expect(r).toMatchObject({
      kind: "content",
      content: { lang: "en-IN", fallback: true, availableLocales: ["en-IN"] },
    });
    const hi = await studio.createItem(a, {
      type: "page",
      packId: PACK,
      locale: "hi-IN",
      translationGroupId: en.item.translationGroupId,
      slug: "about-us",
      title: "हमारे बारे में",
      body: article("हमारे बारे में"),
      source: "machine_translation",
    });
    expect(await code(studio.submit(a, hi.item.id))).toBe("IPB-CMS-011");
    await studio.saveDraft(a, hi.item.id, {
      title: "हमारे बारे में",
      slug: "about-us",
      body: article("मानव समीक्षा के बाद"),
      machineTranslated: false,
    });
    expect((await studio.submit(a, hi.item.id)).status).toBe("in_review");
  });
});

describe("@IPB-04-AT-13 stale content", () => {
  it("lists a page unreviewed for 366 days and emits ContentStale", async () => {
    const { item } = await studio.createItem(a, {
      type: "page",
      packId: PACK,
      slug: "old-page",
      title: "Old page",
      body: article("Old"),
    });
    await publish(item.id);
    await db.admin.query(
      "update cms.content_item set last_reviewed_at = now() - interval '366 days' where id = $1",
      [item.id],
    );
    expect((await studio.staleQueue(a)).map((i) => i.id)).toContain(item.id);
    expect(await studio.emitStale(a)).toBeGreaterThanOrEqual(1);
    expect(
      (await db.admin.query("select 1 from cms.outbox where type like '%.ContentStale.%'"))
        .rowCount,
    ).toBeGreaterThan(0);
    await studio.markReviewed(a, item.id);
    expect((await studio.staleQueue(a)).map((i) => i.id)).not.toContain(item.id);
  });
});

describe("@IPB-04-AT-14 public API read-only", () => {
  it("an anonymous POST changes no row", async () => {
    const before = (await db.admin.query("select count(*)::int as n from cms.content_item")).rows[0]
      .n;
    const r = await handlePublicApi(reader, {
      method: "POST",
      url: "/api/public/v1/content",
      headers: {},
    });
    expect(r.status).toBe(405);
    expect(
      (await db.admin.query("select count(*)::int as n from cms.content_item")).rows[0].n,
    ).toBe(before);
    const get = await handlePublicApi(reader, {
      method: "GET",
      url: `/api/public/v1/route?pack=${PACK}&path=/story`,
      headers: {},
    });
    expect(JSON.parse(get.body)).toMatchObject({ kind: "content", content: { path: "/story" } });
  });
});

describe("@IPB-04-AT-93 unprivileged publish (adversarial)", () => {
  it("a tenant ORG_ADMIN is refused and the attempt is ledgered; an editor cannot publish a legal page alone", async () => {
    const admin = withTenant("tnt_platform", ["ORG_ADMIN"], {
      principal: { id: "usr_tenant_admin" },
    });
    const { item } = await studio.createItem(a, {
      type: "page",
      packId: PACK,
      slug: "target",
      title: "Target",
      body: article("T"),
    });
    expect(await code(studio.publishNow(admin, item.id))).toBe("IPB-UX-011");
    expect(
      (await ledger("cms.access.denied")).map((r) => [r.actor_id, r.resource_id]),
    ).toContainEqual(["usr_tenant_admin", "cms.content.publish"]);
    const lp = await studio.createItem(a, {
      type: "legal_page",
      packId: PACK,
      slug: "terms",
      title: "Terms",
      body: {
        policy_key: "terms",
        version_label: "1.0",
        effective_at: "2026-11-01T00:00:00+05:30",
        summary_of_changes: "First",
        body: para("T"),
      },
    });
    await studio.submit(a, lp.item.id);
    expect(await code(studio.approve(b, lp.item.id))).toBe("IPB-CMS-005");
    expect(await code(studio.publishNow(b, lp.item.id))).toBe("IPB-CMS-005");
  });
});

describe("@IPB-04-AT-101 edit during the scheduled countdown (concurrency)", () => {
  it("an edit at 09:59 returns the item to draft, the 10:00 run skips and ledgers it, the old revision keeps serving", async () => {
    const { item, revision } = await studio.createItem(a, {
      type: "page",
      packId: PACK,
      slug: "countdown",
      title: "Countdown",
      body: article("v1"),
    });
    await publish(item.id);
    await studio.saveDraft(a, item.id, {
      title: "Countdown",
      slug: "countdown",
      body: article("v2"),
    });
    await studio.submit(a, item.id);
    await studio.approve(b, item.id);
    const at = new Date(Date.now() + 60_000);
    await studio.schedule(b, item.id, { publishAt: at });
    const edited = await studio.saveDraft(a, item.id, {
      title: "Countdown",
      slug: "countdown",
      body: article("v3"),
    });
    expect(edited.item).toMatchObject({ status: "draft", scheduledRevisionId: null });
    const run = await scheduler.tick(new Date(at.getTime() + 1000));
    expect(run.skipped).toContain(item.id);
    expect((await ledger("cms.schedule.skip")).map((r) => r.resource_id)).toContain(item.id);
    const served = await reader.resolve(PACK, "en-IN", "/countdown");
    expect(served.kind === "content" && served.content.revisionId).toBe(revision.id);
  });

  it("a legal reviewer's change request returns the item to draft and notifies the author with the reason", async () => {
    const { item } = await studio.createItem(a, {
      type: "legal_page",
      packId: PACK,
      slug: "cookies",
      title: "Cookie Policy",
      body: {
        policy_key: "cookies",
        version_label: "1.0",
        effective_at: "2026-11-01T00:00:00+05:30",
        summary_of_changes: "First",
        body: para("C"),
      },
    });
    await studio.submit(a, item.id);
    expect(await code(studio.requestChanges(legal, item.id, ""))).toBe("IPB-CMS-003");
    expect(
      (await studio.requestChanges(legal, item.id, "Clause 4 needs the retention period")).status,
    ).toBe("draft");
    expect(notices).toContainEqual({
      itemId: item.id,
      authorId: "usr_editor_a",
      reason: "Clause 4 needs the retention period",
    });
  });
});

describe("soft delete, offices and the 90-day purge (OWNER-QUESTIONS #48)", () => {
  it("an office is deleted only by a second person; the purge removes content 90 days after deletion, ledgered", async () => {
    const office = await studio.createItem(a, {
      type: "office",
      packId: PACK,
      title: "Jaipur",
      body: {
        label: "Jaipur",
        lines: ["1 Example Road"],
        city: "Jaipur",
        state: "Rajasthan",
        pin: "302001",
      },
    });
    expect(await studio.softDelete(a, office.item.id, "moved")).toMatchObject({ deleted: false });
    expect(await code(studio.softDelete(a, office.item.id, "moved"))).toBe("IPB-CMS-004");
    expect(await studio.softDelete(b, office.item.id, "moved")).toEqual({ deleted: true });

    const page = await studio.createItem(a, {
      type: "page",
      packId: PACK,
      slug: "to-purge",
      title: "To purge",
      body: article("x"),
    });
    await studio.createPreview(a, page.item.id);
    await studio.softDelete(a, page.item.id, "obsolete");
    const purge = new CmsPurge({ kernel: db.kernel, audit: db.audit, storage });
    expect((await purge.sweep()).items).toEqual([]);
    // Deleting before the period is refused by PostgreSQL itself, for any caller of app_rw.
    await expect(
      db.kernel.mutate(
        platformContext(),
        async (tx) => {
          await tx.query("delete from cms.content_item where id = $1", [page.item.id]);
          const r = await tx.query("select 1 from cms.content_item where id = $1", [page.item.id]);
          if (r.rowCount) throw new Error("not deleted");
        },
        { action: "cms.test" },
      ),
    ).rejects.toThrow(/not deleted/);
    await db.admin.query(
      "update cms.content_item set deleted_at = now() - interval '91 days' where id = any($1)",
      [[page.item.id, office.item.id]],
    );
    const swept = await purge.sweep();
    expect(swept.items.sort()).toEqual([page.item.id, office.item.id].sort());
    expect(
      (
        await db.admin.query("select 1 from cms.revision where content_item_id = $1", [
          page.item.id,
        ])
      ).rowCount,
    ).toBe(0);
    expect(new Set((await ledger("cms.purge.sweep")).map((r) => r.actor_id))).toEqual(
      new Set(["svc_cms_purge"]),
    );
  });

  it("restores within the window", async () => {
    const page = await studio.createItem(a, {
      type: "page",
      packId: PACK,
      slug: "restore-me",
      title: "Restore me",
      body: article("x"),
    });
    await studio.softDelete(a, page.item.id, "oops");
    expect((await studio.restore(a, page.item.id)).deletedAt).toBeNull();
  });
});

describe("Studio readers (PL5 session 8: redirects, claims and the media library)", () => {
  const P2 = "brd_01JB0000000000000000000009";
  it("lists a pack's redirects by state, the Claims Register by status, and the alt-text queue", async () => {
    const r = await studio.addRedirect(a, P2, {
      from: "/reader-old",
      to: "/reader-new",
      status: 301,
    });
    const pending = await studio.redirects(a, P2, { state: "pending" });
    expect(pending.map((x) => [x.id, x.from, x.to, x.status, x.state])).toEqual([
      [r.id, "/reader-old", "/reader-new", 301, "pending"],
    ]);
    expect(await studio.redirects(a, P2, { state: "active" })).toEqual([]);
    expect(await studio.redirects(a, PACK)).not.toContainEqual(
      expect.objectContaining({ id: r.id }),
    );

    const { id: claimId } = await studio.proposeClaim(a, {
      text: "Reader claim",
      asOf: "2026-10-01",
      reviewDue: "2027-10-01",
    });
    const proposed = await studio.claims(a, { status: "proposed" });
    expect(proposed.find((c) => c.id === claimId)).toMatchObject({
      text: "Reader claim",
      evidenceClass: "E0",
      status: "proposed",
    });
    expect((await studio.claims(a, { status: "active" })).map((c) => c.id)).not.toContain(claimId);

    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      ),
      (c) => c.charCodeAt(0),
    );
    const img = await media.upload(a, { mime: "image/png", bytes: png });
    expect((await media.list(a, { missingAlt: true })).map((m) => m.id)).toContain(img.id);
    await media.describe(a, img.id, { altText: "A dot" });
    expect((await media.list(a, { missingAlt: true })).map((m) => m.id)).not.toContain(img.id);
    expect((await media.list(a, { kind: "image" })).find((m) => m.id === img.id)).toMatchObject({
      altText: "A dot",
      mime: "image/png",
    });
  });
});
