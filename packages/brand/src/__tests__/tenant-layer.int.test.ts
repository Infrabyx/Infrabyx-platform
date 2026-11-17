// The tenant brand layer on PostgreSQL with every platform migration applied and RLS forced
// (LawDocsComply PR-LDC-26; M57): tenant isolation, maker-checker through the approvals engine,
// the guards at the proposal and again when applied, host uniqueness and per-host resolution.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import { ApprovalsEngine, PgOutbox } from "@infrabyx/tenancy";
import {
  MemoryStorage,
  platformContext,
  startPostgres,
  withTenant,
  type TestDatabase,
} from "@infrabyx/testing";
import { contrastGuard } from "../contrast.js";
import { BrandStudio } from "../studio.js";
import type { BrandPackBodyInput, MediaRef } from "../shape.js";
import { TenantBrandLayers, TENANT_LAYER_ACTION } from "../tenant-layer.js";

let db: TestDatabase;
let studio: BrandStudio;
let approvals: ApprovalsEngine;
let layers: TenantBrandLayers;
let packId: string;
let packLogo: MediaRef;
const storage = new MemoryStorage();
const verifiedEmail = new Set(["example.test", "tenant-a.example", "tenant-b.example"]);
const POLICY = "pol_01JB0000000000000000000001";
const LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2" onload="x()"><script>x()</script><circle cx="1" cy="1" r="1"/></svg>';

const pltMaker = platformContext(["PLT_SUPER_ADMIN"], "tnt_platform", "usr_plt_maker");
const pltChecker = platformContext(["PLT_SUPER_ADMIN"], "tnt_platform", "usr_plt_checker");
const pltLegal = platformContext(["PLT_LEGAL_REVIEWER"], "tnt_platform", "usr_plt_legal");
const siteCtx: KernelContext = {
  tenantId: "tnt_platform",
  principal: { id: "svc_site_app", type: "service", roles: [] },
};
const makerA = withTenant("tnt_a", ["ORG_ADMIN"], { principal: { id: "usr_a_admin" } });
const checkerA = withTenant("tnt_a", ["ORG_CHECKER"], { principal: { id: "usr_a_checker" } });
const memberA = withTenant("tnt_a", ["ORG_MEMBER"], { principal: { id: "usr_a_member" } });
const makerB = withTenant("tnt_b", ["ORG_OWNER"], { principal: { id: "usr_b_owner" } });
const checkerB = withTenant("tnt_b", ["ORG_CHECKER"], { principal: { id: "usr_b_checker" } });
const makerC = withTenant("tnt_c", ["ORG_ADMIN"], { principal: { id: "usr_c_admin" } });
const checkerC = withTenant("tnt_c", ["ORG_OWNER"], { principal: { id: "usr_c_owner" } });

const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string; name?: string }) => e.code ?? e.name ?? String(e),
  );

const packBody = (over: Partial<BrandPackBodyInput> = {}): BrandPackBodyInput => ({
  app_name: "Example Compliance",
  terminology_override: { vidhi: "Astra" },
  legal_entity: {
    name: "Example Private Limited",
    registered_office: "1 Example Road",
    entity_type: "PRIVATE_LIMITED",
  },
  tokens: {
    colour: { primary: "#1D4ED8", accent: "#0F766E" },
    font: { sans: "Inter", mono: "JetBrains Mono" },
  },
  email_identity: { from_name: "Example Compliance", from_address: "no-reply@example.test" },
  policy_set_id: POLICY,
  logo: { svg: packLogo },
  ...over,
});

const ledger = async (tenant: string, like: string) =>
  (
    await db.admin.query<{ action: string; actor_id: string; seq: string }>(
      "select action, actor_id, seq from audit.ledger where tenant_id = $1 and action like $2 order by seq",
      [tenant, like],
    )
  ).rows;

const approve = (ctx: KernelContext, id: string) => approvals.decide(ctx, id, "approve");

beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    `insert into tenancy.tenant (id, product, name) values
       ('tnt_a', 'LDC', 'A'), ('tnt_b', 'LDC', 'B'), ('tnt_c', 'LDC', 'C'), ('tnt_platform', 'PLATFORM', 'Platform')
     on conflict do nothing`,
  );
  approvals = new ApprovalsEngine({
    kernel: db.kernel,
    audit: db.audit,
    outbox: new PgOutbox(),
    product: "LDC",
  });
  studio = new BrandStudio({
    kernel: db.kernel,
    audit: db.audit,
    product: "LDC",
    storage,
    hooks: {
      emailIdentityVerified: async (_ctx, d) => verifiedEmail.has(d),
      policySetPublished: async (_ctx, id) => id === POLICY,
    },
  });
  layers = new TenantBrandLayers({
    kernel: db.kernel,
    audit: db.audit,
    approvals,
    storage,
    brandProduct: "LDC",
    hooks: {
      emailIdentityVerified: async (_ctx, d) => verifiedEmail.has(d),
      domainVerified: async () => true,
    },
  });
  // The product's default pack, published by platform staff under its own maker-checker.
  packId = (
    await studio.createPack(pltMaker, { product: "LDC", label: "LDC default", isDefault: true })
  ).id;
  packLogo = (await studio.uploadLogo(pltMaker, packId, LOGO)).ref;
  const rev = await studio.saveDraft(pltMaker, packId, {
    body: packBody(),
    hosts: [{ host: "app.ldc.example", role: "APP", verified: true }],
  });
  await studio.submit(pltMaker, rev.id);
  await studio.legalReview(pltLegal, rev.id);
  await studio.approve(pltChecker, rev.id);
});
afterAll(async () => {
  await db?.end();
});

describe("tenant brand layer: maker-checker, guards, isolation and resolution", () => {
  let v1: number;
  let logo: MediaRef;

  it("stores only the sanitised SVG under the tenant's own key", async () => {
    const up = await layers.uploadSvg(makerA, LOGO);
    logo = up.ref;
    expect(logo.key.startsWith("tenant/tnt_a/brand/")).toBe(true);
    expect(up.removed).toEqual(["onload on <svg> (event attribute)", "<script>"]);
    expect(new TextDecoder().decode(storage.objects.get(logo.key)!.body)).not.toMatch(
      /script|onload/,
    );
    expect(await code(layers.uploadSvg(memberA, LOGO))).toBe("IPB-UX-011");
  });

  it("refuses a layer that fails a guard, and leaves nothing pending", async () => {
    expect(await code(layers.propose(makerA, { colour: { on_surface: "#9CA3AF" } }))).toBe(
      "IPB-BRD-003",
    );
    expect(
      await code(
        layers.propose(makerA, {
          email_identity: { from_name: "A", from_address: "notices@unverified.example" },
        }),
      ),
    ).toBe("IPB-BRD-005");
    const otherTenantLogo = (await layers.uploadSvg(makerB, LOGO)).ref;
    expect(await code(layers.propose(makerA, { logo: { svg: otherTenantLogo } }))).toBe(
      "IPB-STOR-001",
    );
    expect(await code(layers.propose(makerA, { login_message: "<b>hi</b>" }))).toBe("ZodError");
    expect(await layers.history(makerA)).toEqual([]);
  });

  it("applies only after a different tenant checker approves, ledgered in the same transaction", async () => {
    const p = await layers.propose(makerA, {
      colour: { primary: "#0B5394" },
      logo: { svg: logo },
      email_identity: { from_name: "Tenant A Legal", from_address: "notices@tenant-a.example" },
      domain: "brand.tenant-a.example",
      login_message: "Sign in with your firm account.",
    });
    v1 = p.version;
    expect(v1).toBe(1);
    expect(await layers.current(makerA)).toBeNull();
    expect((await approvals.get(makerA, p.approvalId)).action).toBe(TENANT_LAYER_ACTION);
    expect((await approvals.get(makerA, p.approvalId)).riskClass).toBe("R3");
    // The maker never checks; a role outside the checkers never checks.
    expect(await code(approve(makerA, p.approvalId))).toBe("IPB-SEC-007");
    expect(await code(approve(memberA, p.approvalId))).toBe("IPB-UX-011");
    // Another change cannot be raised while this one waits.
    expect(await code(layers.propose(makerA, { login_message: "x" }))).toBe("ConflictError");
    const decided = await approve(checkerA, p.approvalId);
    expect(decided.state).toBe("executed");
    expect(await layers.current(makerA)).toMatchObject({
      version: 1,
      status: "active",
      domain: "brand.tenant-a.example",
      approvalId: p.approvalId,
      packId,
    });
    const rows = await ledger("tnt_a", "%");
    const approveAt = rows.findIndex((r) => r.action === "approvals.request.approve");
    expect(rows[approveAt + 1]).toMatchObject({
      action: "brand.tenant_layer.apply",
      actor_id: "usr_a_checker",
    });
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(["brand.tenant_layer.upload", "brand.tenant_layer.propose"]),
    );
  });

  it("isolates tenants under forced RLS", async () => {
    expect(await layers.current(makerB)).toBeNull();
    expect(await layers.history(makerB)).toEqual([]);
    const seen = await db.kernel.read(makerB, async (tx) => ({
      versions: (await tx.query("select * from brand.tenant_layer_version")).rows.length,
      hosts: (await tx.query("select * from brand.tenant_host")).rows.length,
    }));
    expect(seen).toEqual({ versions: 0, hosts: 0 });
    await expect(
      db.kernel.mutate(
        makerB,
        async (tx) => {
          await tx.query(
            `insert into brand.tenant_layer_version (tenant_id, version, pack_id, body, digest, maker_id)
             values ('tnt_a', 99, $1, '{}', $2, 'usr_b_owner')`,
            [packId, "0".repeat(64)],
          );
        },
        { action: "brand.tenant_layer.propose" },
      ),
    ).rejects.toThrow(/row-level security/);
    // A platform context reads the host index, never the layers themselves.
    const plt = await db.kernel.read(pltMaker, async (tx) => ({
      versions: (await tx.query("select * from brand.tenant_layer_version")).rows.length,
      hosts: (await tx.query("select host from brand.tenant_host")).rows.map((r) => r.host),
    }));
    expect(plt).toEqual({ versions: 0, hosts: ["brand.tenant-a.example"] });
    const rls = await db.admin.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select relname, relrowsecurity, relforcerowsecurity from pg_class
        where relname in ('tenant_layer_version', 'tenant_host') order by relname`,
    );
    expect(rls.rows.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
  });

  it("resolves the tenant's domain to the pack with the layer applied, and leaves pack hosts alone", async () => {
    const { resolution, brand } = await layers.resolveHost(siteCtx, {
      host: "Brand.Tenant-A.example:443",
    });
    expect(resolution).toMatchObject({ packId, tenantId: "tnt_a", noindex: false });
    expect(brand).toMatchObject({
      packId,
      tenantId: "tnt_a",
      layerVersion: 1,
      loginMessage: "Sign in with your firm account.",
      domain: "brand.tenant-a.example",
      events: [],
    });
    expect(brand!.body.tokens.colour.primary).toBe("#0B5394");
    expect(brand!.body.logo?.svg).toEqual(logo);
    expect(brand!.body.email_identity?.from_address).toBe("notices@tenant-a.example");
    expect(brand!.body.legal_entity.name).toBe("Example Private Limited");
    expect(brand!.body.terminology_override).toEqual({ vidhi: "Astra" });
    expect(brand!.contrast.passed).toBe(true);
    const icons = await layers.favicons(brand!);
    expect(icons.files.find((f) => f.path === "/icon.svg")?.body).toBe(
      new TextDecoder().decode(storage.objects.get(logo.key)!.body),
    );
    // The studio's own resolver names the tenant too; a pack host has no tenant.
    expect(await studio.resolve(siteCtx, "LDC", { host: "brand.tenant-a.example" })).toMatchObject({
      packId,
      tenantId: "tnt_a",
    });
    const pack = await layers.resolveHost(siteCtx, { host: "app.ldc.example" });
    expect(pack.brand).toBeNull();
    expect(pack.resolution.tenantId).toBeUndefined();
    // X-Forwarded-Host never selects a tenant.
    const spoof = await layers.resolveHost(siteCtx, {
      host: "evil.example",
      forwardedHost: "brand.tenant-a.example",
    });
    expect(spoof).toMatchObject({ brand: null, resolution: { noindex: true } });
    // A tenant context resolves its own layer.
    expect((await layers.resolveForTenant(makerA)).layerVersion).toBe(1);
    expect((await layers.resolveForTenant(makerB)).layerVersion).toBeNull();
  });

  it("refuses a host that is a pack host or another tenant's domain, at the proposal, the pack save and in the database", async () => {
    expect(await code(layers.propose(makerB, { domain: "brand.tenant-a.example" }))).toBe(
      "IPB-BRD-002",
    );
    expect(await code(layers.propose(makerB, { domain: "app.ldc.example" }))).toBe("IPB-BRD-002");
    expect(
      await code(
        studio.saveDraft(pltMaker, packId, {
          body: packBody(),
          hosts: [{ host: "brand.tenant-a.example", role: "APP", verified: true }],
        }),
      ),
    ).toBe("IPB-BRD-002");
    await expect(
      db.admin.query(
        "insert into brand.host (host, pack_id, role) values ('brand.tenant-a.example', $1, 'APP')",
        [packId],
      ),
    ).rejects.toThrow(/tenant domain/);
    await expect(
      db.admin.query(
        "insert into brand.tenant_host (host, tenant_id, version, pack_id) values ('app.ldc.example', 'tnt_a', 1, $1)",
        [packId],
      ),
    ).rejects.toThrow(/mapped to a brand pack/);
  });

  it("refuses at approval a domain another tenant took meanwhile, and keeps the request pending", async () => {
    const b = await layers.propose(makerB, { domain: "shared.example" });
    const c = await layers.propose(makerC, { domain: "shared.example" });
    expect((await approve(checkerB, b.approvalId)).state).toBe("executed");
    expect(await code(approve(checkerC, c.approvalId))).toBe("IPB-BRD-002");
    expect((await approvals.get(makerC, c.approvalId)).state).toBe("pending");
    expect(await layers.current(makerC)).toBeNull();
    expect(await ledger("tnt_c", "brand.tenant_layer.apply")).toEqual([]);
    // Once rejected, the stale proposal is withdrawn by the next one.
    await approvals.decide(checkerC, c.approvalId, "reject", "domain taken");
    const c2 = await layers.propose(makerC, { domain: "brand.tenant-c.example" });
    expect((await approve(checkerC, c2.approvalId)).state).toBe("executed");
    expect((await layers.history(makerC)).map((v) => [v.version, v.status])).toEqual([
      [2, "active"],
      [1, "withdrawn"],
    ]);
  });

  it("runs the guards again when the change is applied", async () => {
    const p = await layers.propose(makerB, {
      email_identity: { from_name: "Tenant B", from_address: "notices@tenant-b.example" },
    });
    verifiedEmail.delete("tenant-b.example");
    expect(await code(approve(checkerB, p.approvalId))).toBe("IPB-BRD-005");
    expect((await approvals.get(makerB, p.approvalId)).state).toBe("pending");
    verifiedEmail.add("tenant-b.example");
    expect((await approve(checkerB, p.approvalId)).state).toBe("executed");
    // The new version has no domain, so tenant B's domain is released.
    const hosts = await db.kernel.read(makerB, async (tx) =>
      (await tx.query("select host from brand.tenant_host")).rows.map((r) => r.host),
    );
    expect(hosts).toEqual([]);
  });

  it("reverts to an earlier version through a new version under maker-checker", async () => {
    const v2 = await layers.propose(makerA, { login_message: "Planned maintenance tonight." });
    await approve(checkerA, v2.approvalId);
    expect((await layers.current(makerA))?.body).toEqual({
      login_message: "Planned maintenance tonight.",
    });
    expect(await code(layers.revert(makerA, v2.version))).toBe("IPB-UX-011");
    const v3 = await layers.revert(makerA, v1);
    expect(await code(approve(makerA, v3.approvalId))).toBe("IPB-SEC-007");
    await approve(checkerA, v3.approvalId);
    const cur = await layers.current(makerA);
    expect(cur).toMatchObject({ version: 3, revertOf: 1, domain: "brand.tenant-a.example" });
    expect(cur?.body).toEqual((await layers.history(makerA)).find((v) => v.version === 1)?.body);
    expect((await layers.history(makerA)).map((v) => v.status)).toEqual([
      "active",
      "superseded",
      "superseded",
    ]);
    expect((await ledger("tnt_a", "brand.tenant_layer.revert")).length).toBe(1);
  });

  it("keeps versions immutable and the status moving forward in the database", async () => {
    await expect(
      db.admin.query(
        "update brand.tenant_layer_version set body = '{}' where tenant_id = 'tnt_a' and version = 1",
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.admin.query(
        "update brand.tenant_layer_version set status = 'active' where tenant_id = 'tnt_a' and version = 1",
      ),
    ).rejects.toThrow(/cannot move/);
    await expect(
      db.admin.query(
        "update brand.tenant_layer_version set approval_id = 'apr_x' where tenant_id = 'tnt_a' and version = 1",
      ),
    ).rejects.toThrow(/approval already recorded/);
  });

  it("serves the pack's colours when a pack change makes the layer's colours fail the guard", async () => {
    // Text colour #6B7280 passes on white and fails on #E5E7EB.
    expect(
      contrastGuard("LDC", {
        primary: "#1D4ED8",
        accent: "#0F766E",
        surface: "#FFFFFF",
        on_surface: "#6B7280",
      }).passed,
    ).toBe(true);
    expect(
      contrastGuard("LDC", {
        primary: "#1D4ED8",
        accent: "#0F766E",
        surface: "#E5E7EB",
        on_surface: "#6B7280",
      }).passed,
    ).toBe(false);
    const p = await layers.propose(makerC, { colour: { on_surface: "#6B7280" } });
    await approve(checkerC, p.approvalId);
    expect((await layers.resolveForTenant(makerC)).events).toEqual([]);
    const rev = await studio.saveDraft(pltMaker, packId, {
      body: packBody({
        tokens: {
          colour: { primary: "#1D4ED8", accent: "#0F766E", surface: "#E5E7EB" },
          font: { sans: "Inter", mono: "JetBrains Mono" },
        },
      }),
      hosts: [{ host: "app.ldc.example", role: "APP", verified: true }],
    });
    await studio.submit(pltMaker, rev.id);
    await studio.approve(pltChecker, rev.id);
    const served = await layers.resolveForTenant(makerC);
    expect(served.events.map((e) => e.code)).toEqual(["tenant_colours_dropped"]);
    expect(served.body.tokens.colour.on_surface).toBe("#111827");
    expect(served.contrast.passed).toBe(true);
  });

  it("serves a subdomain under the pack's app host once approved; another tenant cannot take it (PR-LDC-43)", async () => {
    const p = await layers.propose(makerB, {
      domain: "shared.example",
      subdomain: "firm-b",
      letterhead_text: { header: "Tenant B Legal", footer: "Registered office: Pune" },
    });
    expect((await approve(checkerB, p.approvalId)).state).toBe("executed");
    const { resolution, brand } = await layers.resolveHost(siteCtx, {
      host: "firm-b.app.ldc.example",
    });
    expect(resolution).toMatchObject({ packId, tenantId: "tnt_b" });
    expect(brand).toMatchObject({
      subdomain: "firm-b",
      domain: "shared.example",
      letterheadText: { header: "Tenant B Legal", footer: "Registered office: Pune" },
      cover: null,
    });
    const rows = await ledger("tnt_b", "brand.tenant_layer.apply");
    expect(rows.at(-1)).toBeDefined();
    // Tenant C cannot claim B's label or its domain; the reserved labels never pass the shape.
    const c = await layers.current(makerC);
    expect(c?.status).toBe("active");
    expect(await code(layers.propose(makerC, { subdomain: "firm-b" }))).toBe("IPB-BRD-002");
    expect(await code(layers.propose(makerC, { subdomain: "admin" }))).toBe("ZodError");
  });
});
