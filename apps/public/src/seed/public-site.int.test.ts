// The public-site seed on PostgreSQL (PL5 plan §9.5; owner rule O-5): everything publishes through
// Studio's maker-checker and the claims lint, a second run changes nothing, and no seeded text
// carries a figure, a logo wall, a testimonial or a banned phrase.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { wordList } from "@infrabyx/cms";
import { PgOutbox } from "@infrabyx/tenancy";
import { MemoryStorage, startPostgres, type TestDatabase } from "@infrabyx/testing";
import { groupSeedEnvSchema } from "./env.ts";
import { seedPublicSite } from "./public-site.ts";
import { GROUP_COMPANIES } from "./content.ts";

let db: TestDatabase;
const storage = new MemoryStorage();
const group = groupSeedEnvSchema.parse({});

beforeAll(async () => {
  db = await startPostgres();
});
afterAll(async () => {
  await db?.end();
});

const run = () =>
  seedPublicSite(
    {
      product: "OH",
      services: { kernel: db.kernel, audit: db.audit, outbox: new PgOutbox(), seedAllowed: true },
    },
    { group, storage },
  );

describe("publicSiteSeedModule", () => {
  it("publishes the launch pages, footer, menus, offices, forms and group companies through maker-checker", async () => {
    const r = await run();
    expect(r.skipped).toBe(false);
    expect(r.published).toMatchObject({
      page: 6,
      form: 2,
      office: 3,
      footer: 1,
      nav_menu: 4,
      group_company: GROUP_COMPANIES.length,
    });
    const paths = (
      await db.admin.query<{ published_path: string }>(
        "select published_path from cms.content_item where published_path is not null order by 1",
      )
    ).rows.map((x) => x.published_path);
    expect(paths).toEqual(
      expect.arrayContaining(["/", "/about", "/careers", "/contact", "/group-companies", "/trust"]),
    );
    // Hidden by setting (O-1): drafts only.
    const hidden = await db.admin.query(
      "select status, published_revision_id from cms.content_item where slug in ('investors', 'placeholder-post')",
    );
    expect(hidden.rows.every((x) => x.published_revision_id === null)).toBe(true);
    // Makers never approve their own work.
    const approvals = await db.admin.query<{ maker_id: string; checker_id: string }>(
      "select maker_id, checker_id from cms.approval where checker_id is not null",
    );
    expect(approvals.rows.every((x) => x.maker_id !== x.checker_id)).toBe(true);
    expect(
      (await db.admin.query("select 1 from brand.pack where status = 'published'")).rowCount,
    ).toBe(1);
    expect(
      (await db.admin.query("select 1 from consent.text where state = 'draft'")).rowCount,
    ).toBe(0);
    expect(
      (await db.admin.query("select 1 from trust.mirror_document where mirror_state = 'VISIBLE'"))
        .rowCount,
    ).toBeGreaterThan(0);
  });

  it("is idempotent: a second run changes nothing", async () => {
    const before = (await db.admin.query("select count(*)::int as n from cms.content_item")).rows[0]
      .n as number;
    expect((await run()).skipped).toBe(true);
    const after = (await db.admin.query("select count(*)::int as n from cms.content_item")).rows[0]
      .n as number;
    expect(after).toBe(before);
  });

  it("seeds no stats, logo wall, testimonial or case study, and no banned phrase (O-5)", async () => {
    const bodies = (
      await db.admin.query<{ body: unknown }>("select body from cms.revision")
    ).rows.map((r) => JSON.stringify(r.body));
    const all = bodies.join("\n").toLowerCase();
    for (const t of ["stats", "logo_wall", "testimonial", "case_study"])
      expect(all).not.toContain(`"type":"${t}"`);
    const w = wordList();
    for (const phrase of [...w.banned, ...w.category, ...w.certification, ...w.dark_patterns])
      expect(all, phrase).not.toMatch(
        new RegExp(`\\b${phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\#]/g, "\\$&")}\\b`),
      );
  });
});
