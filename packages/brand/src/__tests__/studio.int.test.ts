// Brand Studio on PostgreSQL with every platform migration applied (PL5 plan §5.2, session 3).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { platformSeedModule, runSeed } from "@infrabyx/seed";
import { PgOutbox } from "@infrabyx/tenancy";
import {
  FakeMedia,
  MemoryStorage,
  platformContext,
  startPostgres,
  withTenant,
  type TestDatabase,
} from "@infrabyx/testing";
import { faviconSet } from "../favicon.js";
import { BrandStudio } from "../studio.js";
import { BrandPackBody, type BrandPackBodyInput } from "../shape.js";

let db: TestDatabase;
let studio: BrandStudio;
const storage = new MemoryStorage();
const verifiedDomains = new Set(["example.test", "partnerbank.example"]);
const hostEvents: string[] = [];
const maker = platformContext(["PLT_SUPER_ADMIN"], "tnt_platform", "usr_maker");
const checker = platformContext(["PLT_SUPER_ADMIN"], "tnt_platform", "usr_checker");
const releaseManager = platformContext(["PLT_RELEASE_MANAGER"], "tnt_platform", "usr_rm");
const legal = platformContext(["PLT_LEGAL_REVIEWER"], "tnt_platform", "usr_legal");
const editor = platformContext(["PLT_CONTENT_EDITOR"], "tnt_platform", "usr_editor");
const POLICY = "pol_01JB0000000000000000000001";
const LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2" onload="x()"><script>x()</script><circle cx="1" cy="1" r="1"/></svg>';

const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string }) => e.code ?? String(e),
  );

const body = (
  logo: BrandPackBodyInput["logo"],
  over: Partial<BrandPackBodyInput> = {},
): BrandPackBodyInput => ({
  app_name: "Example Group",
  legal_entity: {
    name: "Example Private Limited",
    registered_office: "1 Example Road",
    entity_type: "PRIVATE_LIMITED",
  },
  tokens: {
    colour: { primary: "#1D4ED8", accent: "#0F766E" },
    font: { sans: "Inter", mono: "JetBrains Mono" },
  },
  email_identity: { from_name: "Example Group", from_address: "no-reply@example.test" },
  policy_set_id: POLICY,
  logo,
  ...over,
});
const events = async (name: string) =>
  (
    await db.admin.query<{ data: Record<string, unknown> }>(
      `select envelope->'data' as data from brand.outbox where type like $1 order by created_at`,
      [`%.${name}.%`],
    )
  ).rows.map((r) => r.data);

beforeAll(async () => {
  db = await startPostgres();
  await runSeed({
    kernel: db.kernel,
    audit: db.audit,
    env: { APP_ENV: "test", SEED_ENABLED: true },
    product: "OH",
    profile: "demo",
    modules: [platformSeedModule],
    randomSeed: 20261027,
    runDate: new Date("2026-10-01T00:00:00Z"),
  } as never);
  studio = new BrandStudio({
    kernel: db.kernel,
    audit: db.audit,
    product: "OH",
    storage,
    outbox: new PgOutbox(),
    hooks: {
      emailIdentityVerified: async (_ctx, d) => verifiedDomains.has(d),
      policySetPublished: async (_ctx, id) => id === POLICY,
      onHostEvent: (e) => hostEvents.push(e.code),
    },
  });
});
afterAll(async () => {
  await db?.end();
});

describe("Brand Studio publish, maker-checker and rollback", () => {
  let packId: string;
  let logo: Awaited<ReturnType<BrandStudio["uploadLogo"]>>["ref"];
  let b1: string;
  let b2: string;

  it("@IPB-04-AT-21 stores only the sanitised SVG and reports the removals", async () => {
    packId = (
      await studio.createPack(maker, { product: "GRP", label: "Group default", isDefault: true })
    ).id;
    const up = await studio.uploadLogo(maker, packId, LOGO);
    logo = up.ref;
    expect(up.removed).toEqual(["onload on <svg> (event attribute)", "<script>"]);
    const stored = new TextDecoder().decode(storage.objects.get(logo.key)!.body);
    expect(stored).not.toContain("script");
    expect(stored).not.toContain("onload");
    expect(
      [...storage.objects.values()].filter((o) =>
        new TextDecoder().decode(o.body).includes("onload"),
      ),
    ).toEqual([]);
  });

  it("@IPB-04-AT-23 refuses a low-contrast token change with IPB-BRD-003 and records the rejection", async () => {
    const low = body(
      { svg: logo },
      {
        tokens: {
          colour: { primary: "#1D4ED8", accent: "#0F766E", on_surface: "#808080" },
          font: { sans: "Inter", mono: "Mono" },
        },
      },
    );
    expect(await code(studio.saveDraft(maker, packId, { body: low, hosts: [] }))).toBe(
      "IPB-BRD-003",
    );
    expect((await events("ContrastGuardFailed"))[0]).toMatchObject({
      brd_id: packId,
      pairs: [expect.objectContaining({ pair: "on_surface/surface" })],
    });
  });

  it("refuses edits outside a platform context", async () => {
    expect(
      await code(
        studio.createPack(withTenant("tnt_demo", ["ORG_OWNER"]), { product: "GRP", label: "x" }),
      ),
    ).toBe("IPB-UX-011");
  });

  it("publishes only after a different checker approves, with legal review for legal-class fields", async () => {
    const r1 = await studio.saveDraft(maker, packId, {
      body: body({ svg: logo }),
      hosts: [{ host: "www.example.test", role: "PUBLIC", verified: true }],
    });
    b1 = r1.id;
    expect(r1.svgSanitised).toBe(true);
    const sub = await studio.submit(maker, b1);
    expect(sub).toMatchObject({ status: "pending_approval", legalReviewRequired: true });
    expect(await code(studio.approve(maker, b1))).toBe("IPB-SEC-007");
    expect(await code(studio.approve(editor, b1))).toBe("IPB-UX-011");
    expect(await code(studio.approve(checker, b1))).toBe("IPB-UX-011"); // legal review first
    expect(await code(studio.legalReview(maker, b1))).toBe("IPB-UX-011");
    await studio.legalReview(legal, b1);
    const pub = await studio.approve(checker, b1);
    expect(pub).toMatchObject({
      status: "published",
      checkerId: "usr_checker",
      legalReviewerId: "usr_legal",
    });
    expect((await events("BrandPackPublished"))[0]).toMatchObject({
      brd_id: packId,
      revision_id: b1,
      action: "PUBLISHED",
      hosts: ["www.example.test"],
    });

    // A change that touches no legal-class field needs only the checker.
    const r2 = await studio.saveDraft(maker, packId, {
      body: body({ svg: logo }, { app_name: "Example Group Companies" }),
      hosts: [{ host: "www.example.test", role: "PUBLIC", verified: true }],
    });
    b2 = r2.id;
    expect((await studio.submit(maker, b2)).legalReviewRequired).toBe(false);
    await studio.approve(releaseManager, b2);
    expect((await studio.published(maker, packId))?.body.app_name).toBe("Example Group Companies");
    expect((await studio.get(maker, b1)).status).toBe("superseded");
  });

  it("@IPB-04-AT-28 rolls back to b1 through a new revision b3 under maker-checker", async () => {
    const b3 = await studio.requestRollback(maker, packId, b1);
    expect(b3).toMatchObject({ status: "pending_approval", rollbackOf: b1 });
    expect(await code(studio.approve(maker, b3.id))).toBe("IPB-SEC-007");
    await studio.approve(checker, b3.id);
    const served = await studio.published(maker, packId);
    expect(served).toMatchObject({ id: b3.id, rollbackOf: b1 });
    expect(served?.body.app_name).toBe("Example Group");
    expect((await events("BrandPackRolledBack"))[0]).toMatchObject({
      revision_id: b3.id,
      action: "ROLLED_BACK",
      rollback_of: b1,
    });
  });

  it("@IPB-04-AT-26 refuses submit with an unverified email domain, and IPB-BRD-006 without a published policy set", async () => {
    const other = (
      await studio.createPack(maker, { product: "UDF", label: "Partner", isDefault: false })
    ).id;
    const unverified = await studio.saveDraft(maker, other, {
      body: body(
        { svg: logo },
        { email_identity: { from_name: "P", from_address: "no-reply@unverified.example" } },
      ),
      hosts: [{ host: "app.partnerbank.example", role: "APP", verified: true }],
    });
    expect(await code(studio.submit(maker, unverified.id))).toBe("IPB-BRD-005");
    const noPolicy = await studio.saveDraft(maker, other, {
      body: body({ svg: logo }, { policy_set_id: "pol_01JB0000000000000000000009" }),
      hosts: [{ host: "app.partnerbank.example", role: "APP", verified: true }],
    });
    expect(await code(studio.submit(maker, noPolicy.id))).toBe("IPB-BRD-006");
  });

  it("refuses a host already mapped to another pack with IPB-BRD-002, at save and in the database", async () => {
    const other = (
      await studio.createPack(maker, { product: "FBX", label: "Other", isDefault: false })
    ).id;
    expect(
      await code(
        studio.saveDraft(maker, other, {
          body: body({ svg: logo }),
          hosts: [{ host: "www.example.test", role: "PUBLIC", verified: true }],
        }),
      ),
    ).toBe("IPB-BRD-002");
    await expect(
      db.admin.query(
        "insert into brand.host (host, pack_id, role) values ('www.example.test', $1, 'PUBLIC')",
        [other],
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("@IPB-04-AT-27 resolves published hosts only and serves the default pack with noindex otherwise", async () => {
    expect(await studio.resolve(maker, "GRP", { host: "www.example.test" })).toMatchObject({
      packId,
      noindex: false,
    });
    const spoof = await studio.resolve(maker, "GRP", {
      host: "evil.example",
      forwardedHost: "www.example.test",
    });
    expect(spoof).toMatchObject({ packId, noindex: true });
    expect(hostEvents).toEqual(["forwarded_host_mismatch", "IPB-BRD-007"]);
  });

  it("keeps revisions immutable and reviewers distinct from the maker in the database", async () => {
    await expect(
      db.admin.query("update brand.pack_revision set body = '{}' where id = $1", [b1]),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.admin.query("update brand.pack_revision set status = 'draft' where id = $1", [b2]),
    ).rejects.toThrow(/cannot move/);
    const draft = await studio.saveDraft(maker, packId, { body: body({ svg: logo }), hosts: [] });
    await expect(
      db.admin.query("update brand.pack_revision set checker_id = 'usr_maker' where id = $1", [
        draft.id,
      ]),
    ).rejects.toThrow(/revision_checker_not_maker/);
    const ledger = await db.admin.query<{ action: string }>(
      "select action from audit.ledger where action like 'brand.%' order by seq",
    );
    expect(ledger.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        "brand.pack.create",
        "brand.logo.upload",
        "brand.contrast.rejected",
        "brand.revision.save",
        "brand.revision.submit",
        "brand.revision.legal_review",
        "brand.pack.publish",
        "brand.pack.rollback.request",
        "brand.pack.rollback",
      ]),
    );
  });
});

describe("PNG favicons from the sanitised logo through the MEDIA port (OWNER-QUESTIONS #53)", () => {
  it("rasterises every favicon size from the sanitised SVG, and none when re-encoding is off", async () => {
    let on = true;
    const media = new FakeMedia();
    const s = new BrandStudio({
      kernel: db.kernel,
      audit: db.audit,
      product: "OH",
      storage,
      hooks: {
        emailIdentityVerified: async () => true,
        policySetPublished: async () => true,
      },
      media,
      reencodeEnabled: async () => on,
    });
    const packId = (await s.createPack(maker, { product: "OH", label: "Favicons" })).id;
    const up = await s.uploadLogo(maker, packId, LOGO);
    expect(Object.keys(up.png).sort()).toEqual(["180", "192", "32", "512", "64"]);
    for (const ref of Object.values(up.png))
      expect(storage.objects.get(ref.key)!.meta.contentType).toBe("image/png");
    const set = faviconSet(
      BrandPackBody.parse(body({ svg: up.ref, png: up.png })),
      "<svg/>",
      "#1D4ED8",
    );
    expect(set.missing).toEqual([]);
    expect(set.files.map((f) => f.path)).toContain("/apple-touch-icon.png");
    on = false;
    expect((await s.uploadLogo(maker, packId, LOGO)).png).toEqual({});
    expect(media.calls).toEqual(["rasterise 32,64,180,192,512"]);
  });
});

describe("Studio readers (PL5 session 8: the Brand list and the approvals queue)", () => {
  it("lists packs default first, a pack's revisions newest first, and the revisions waiting for approval", async () => {
    const packId = (await studio.createPack(maker, { product: "LD", label: "Readers" })).id;
    const up = await studio.uploadLogo(maker, packId, LOGO);
    const first = await studio.saveDraft(maker, packId, {
      body: body({ svg: up.ref }),
      hosts: [{ host: "readers.example.test", role: "PUBLIC", verified: true }],
    });
    await studio.submit(maker, first.id);
    const ld = await studio.packs(maker, { product: "LD" });
    expect(ld.map((k) => k.label)).toContain("Readers");
    expect(ld.every((k) => k.product === "LD")).toBe(true);
    const all = await studio.packs(maker);
    const grp = all.filter((k) => k.product === "GRP");
    expect(grp[0]!.isDefault).toBe(true);
    expect((await studio.revisions(maker, packId)).map((r) => r.id)).toEqual([first.id]);
    expect((await studio.pending(checker)).map((r) => r.id)).toContain(first.id);
    await studio.legalReview(legal, first.id);
    await studio.approve(checker, first.id);
    expect((await studio.pending(checker)).map((r) => r.id)).not.toContain(first.id);
  });
});
