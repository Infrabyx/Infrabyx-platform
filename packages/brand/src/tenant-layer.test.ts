// Tenant brand layer (PR-LDC-26; M57): the merge and every guard refusal, without a database.
import { describe, expect, it } from "vitest";
import { IpbError } from "@infrabyx/contracts/errors";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import { storageKey } from "@infrabyx/contracts/ports";
import { sha256Hex, ulid } from "@infrabyx/crypto";
import type { ApprovalsEngine } from "@infrabyx/tenancy";
import { MemoryStorage, withTenant } from "@infrabyx/testing";
import { normaliseHost, resolveHost } from "./hosts.js";
import { BrandPackBody, type BrandPackBodyInput, type MediaRef } from "./shape.js";
import { TenantBrandLayers, TENANT_LAYER_ACTION } from "./tenant-layer.js";
import {
  applyTenantLayer,
  COLOUR_TOKENS,
  layerColours,
  layerFields,
  plainTextProblem,
  TENANT_LOGIN_MESSAGE_MAX,
  TenantLayerBody,
  type TenantLayerBodyInput,
} from "./tenant-shape.js";

const packBody = (over: Partial<BrandPackBodyInput> = {}) =>
  BrandPackBody.parse({
    app_name: "Example Compliance",
    terminology_override: { vidhi: "Astra", matter: "Engagement" },
    legal_entity: {
      name: "Example Private Limited",
      registered_office: "1 Example Road",
      entity_type: "PRIVATE_LIMITED",
    },
    tokens: {
      colour: { primary: "#1D4ED8", accent: "#0F766E" },
      font: { sans: "Inter", mono: "JetBrains Mono" },
    },
    email_identity: {
      from_name: "Example Compliance",
      from_address: "no-reply@example.test",
      reply_to: "support@example.test",
      dkim_selector: "s1",
    },
    policy_set_id: "pol_01JB0000000000000000000001",
    ...over,
  });

const code = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof IpbError ? e.code : (e as Error).name),
  );

const ctx = withTenant("tnt_a", ["ORG_ADMIN"], { principal: { id: "usr_a" } });
const storage = new MemoryStorage();
const approvals = {
  registered: [] as string[],
  register(a: string) {
    this.registered.push(a);
    return this;
  },
};
const layers = new TenantBrandLayers({
  kernel: {} as never,
  audit: {} as never,
  approvals: approvals as unknown as ApprovalsEngine,
  storage,
  brandProduct: "LDC",
  hooks: { emailIdentityVerified: async (_c, d) => d === "tenant-a.example" },
});
const pack = { product: "LDC", body: packBody() };

const keyOf = (tenant: string, ext: string) => storageKey(tenant, "brand", ulid(), ext);
async function put(
  key: string,
  text: string,
  contentType: string,
  tags: Record<string, string> = {},
): Promise<MediaRef> {
  const bytes = new TextEncoder().encode(text);
  await storage.put(key, bytes, { contentType, bucketClass: "PUBLIC_ASSETS", tags });
  return { key, sha256: sha256Hex(bytes), content_type: contentType };
}
const svgRef = (tenant: string, name: string, sanitised = true) =>
  put(
    keyOf(tenant, "svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" id="${name}"/>`,
    "image/svg+xml",
    sanitised ? { ipb_svg_sanitised: "1" } : {},
  );
const check = (input: TenantLayerBodyInput, c: KernelContext = ctx) => layers.check(c, pack, input);

describe("the tenant layer shape and merge", () => {
  it("registers the R3 change action on the approvals engine", () => {
    expect(approvals.registered).toEqual([TENANT_LAYER_ACTION]);
  });

  it("allows exactly the colour tokens a pack defines", () => {
    expect([...COLOUR_TOKENS].sort()).toEqual(
      Object.keys(BrandPackBody.shape.tokens.shape.colour.shape).sort(),
    );
    expect(TenantLayerBody.safeParse({ colour: { brand_glow: "#000000" } }).success).toBe(false);
    expect(TenantLayerBody.safeParse({ colour: { primary: "red" } }).success).toBe(false);
  });

  it("refuses every field outside the layer: legal entity, terminology, policy set, app name", () => {
    for (const f of ["legal_entity", "terminology_override", "policy_set_id", "app_name", "tokens"])
      expect(TenantLayerBody.safeParse({ [f]: {} }).success, f).toBe(false);
  });

  it("applies colours, logo and email identity and keeps the legal entity and terminology", () => {
    const logo: MediaRef = {
      key: keyOf("tnt_a", "svg"),
      sha256: "a".repeat(64),
      content_type: "image/svg+xml",
    };
    const layer = TenantLayerBody.parse({
      colour: { primary: "#0B5394" },
      logo: { svg: logo },
      email_identity: { from_name: "Tenant A Legal", from_address: "notices@tenant-a.example" },
      login_message: "Welcome to Tenant A.",
    });
    const pb = packBody();
    const merged = applyTenantLayer(pb, layer);
    expect(merged.tokens.colour).toEqual({ ...pb.tokens.colour, primary: "#0B5394" });
    expect(merged.logo?.svg).toEqual(logo);
    expect(merged.email_identity).toEqual({
      from_name: "Tenant A Legal",
      from_address: "notices@tenant-a.example",
    });
    expect(merged.legal_entity).toEqual(pb.legal_entity);
    expect(merged.terminology_override).toEqual(pb.terminology_override);
    expect(merged.policy_set_id).toBe(pb.policy_set_id);
    expect(merged.app_name).toBe(pb.app_name);
    expect(applyTenantLayer(pb, layer, { colours: false }).tokens.colour).toEqual(pb.tokens.colour);
    expect(applyTenantLayer(pb, null)).toBe(pb);
    expect(layerColours(pb.tokens.colour, TenantLayerBody.parse({}))).toEqual(pb.tokens.colour);
    expect(layerFields(layer)).toEqual(["colour", "logo", "email_identity", "login_message"]);
  });

  it("keeps the login message and sender name to plain text", () => {
    expect(plainTextProblem("Hello\nworld", { multiline: true })).toBeNull();
    expect(plainTextProblem("Hello\nworld", { multiline: false })).toMatch(/single line/);
    expect(plainTextProblem("<b>hi</b>", { multiline: true })).toMatch(/markup/);
    expect(plainTextProblem("&lt;script&gt;", { multiline: true })).toMatch(/markup/);
    expect(plainTextProblem("a\u202Eb", { multiline: true })).toMatch(/bidirectional/);
    expect(plainTextProblem("a\u0007b", { multiline: true })).toMatch(/control/);
    const ok = TenantLayerBody.safeParse({ login_message: "x".repeat(TENANT_LOGIN_MESSAGE_MAX) });
    expect(ok.success).toBe(true);
    for (const login_message of [
      "x".repeat(TENANT_LOGIN_MESSAGE_MAX + 1),
      "<script>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
      "   ",
      "line\r\nbreak",
    ])
      expect(TenantLayerBody.safeParse({ login_message }).success, login_message).toBe(false);
    for (const from_name of [
      "Bank\r\nBcc: victim@example.test",
      'Security Team "<security@bank.example>"',
      "help@bank.example",
      "x".repeat(81),
    ])
      expect(
        TenantLayerBody.safeParse({
          email_identity: { from_name, from_address: "a@tenant-a.example" },
        }).success,
        from_name,
      ).toBe(false);
  });

  it("takes a domain as a lower-case host and resolves it only by the Host header", () => {
    for (const domain of [
      "Tenant.Example",
      "tenant",
      "https://tenant.example",
      "tenant.example:443",
    ])
      expect(TenantLayerBody.safeParse({ domain }).success, domain).toBe(false);
    expect(normaliseHost("Brand.Tenant-A.example:443")).toBe("brand.tenant-a.example");
    const map = [{ host: "brand.tenant-a.example", packId: "brd_x", tenantId: "tnt_a" }];
    expect(resolveHost(map, "brd_def", { host: "brand.tenant-a.example" })).toMatchObject({
      packId: "brd_x",
      tenantId: "tnt_a",
      noindex: false,
    });
    const spoof = resolveHost(map, "brd_def", {
      host: "evil.example",
      forwardedHost: "brand.tenant-a.example",
    });
    expect(spoof.tenantId).toBeUndefined();
    expect(spoof.events.map((e) => e.code)).toEqual(["forwarded_host_mismatch", "IPB-BRD-007"]);
  });
});

describe("every guard a pack publish uses, on the tenant layer", () => {
  it("passes a layer whose values all pass", async () => {
    const logo = await svgRef("tnt_a", "logo");
    const favicon = await svgRef("tnt_a", "favicon");
    const letterhead = await put(keyOf("tnt_a", "pdf"), "%PDF-1.7", "application/pdf");
    const layer = await check({
      colour: { primary: "#0B5394" },
      logo: { svg: logo },
      favicon,
      letterhead,
      email_identity: { from_name: "Tenant A", from_address: "notices@tenant-a.example" },
      domain: "brand.tenant-a.example",
      login_message: "Sign in with your firm account.",
    });
    expect(layerFields(layer)).toHaveLength(7);
  });

  it("refuses a colour set that fails the contrast guard with IPB-BRD-003, naming the pair", async () => {
    await expect(check({ colour: { on_surface: "#9CA3AF" } })).rejects.toMatchObject({
      code: "IPB-BRD-003",
      meta: { pairs: [expect.objectContaining({ pair: "on_surface/surface" })] },
    });
    // The guard runs on the resulting set: a surface change alone can fail the pack's text colour.
    expect(await code(check({ colour: { surface: "#6B7280" } }))).toBe("IPB-BRD-003");
    expect(await code(check({ colour: { primary: "#FDE68A" } }))).toBe("IPB-BRD-003");
  });

  it("refuses an SVG that did not go through the sanitiser with IPB-BRD-001", async () => {
    const raw = await svgRef("tnt_a", "raw", false);
    expect(await code(check({ logo: { svg: raw } }))).toBe("IPB-BRD-001");
    expect(await code(check({ favicon: raw }))).toBe("IPB-BRD-001");
    expect(await code(check({ letterhead: raw }))).toBe("IPB-BRD-001");
    const png = await put(keyOf("tnt_a", "png"), "png", "image/png");
    expect(await code(check({ favicon: png }))).toBe("IPB-BRD-001");
  });

  it("refuses another tenant's asset, a missing one and a changed one with IPB-STOR-001", async () => {
    const other = await svgRef("tnt_b", "logo");
    expect(await code(check({ logo: { svg: other } }))).toBe("IPB-STOR-001");
    const platform = await put(keyOf("tnt_platform", "svg"), "<svg/>", "image/svg+xml", {
      ipb_svg_sanitised: "1",
    });
    expect(await code(check({ favicon: platform }))).toBe("IPB-STOR-001");
    const mine = await svgRef("tnt_a", "logo2");
    expect(await code(check({ favicon: { ...mine, sha256: "0".repeat(64) } }))).toBe(
      "IPB-STOR-001",
    );
    expect(await code(check({ favicon: { ...mine, key: keyOf("tnt_a", "svg") } }))).toBe(
      "IPB-STOR-001",
    );
  });

  it("refuses a letterhead of a type outside PDF, PNG, JPEG and SVG with IPB-SEC-010", async () => {
    const html = await put(keyOf("tnt_a", "html"), "<p>x</p>", "text/html");
    expect(await code(check({ letterhead: html }))).toBe("IPB-SEC-010");
    const lying = await put(keyOf("tnt_a", "pdf"), "<p>x</p>", "text/html");
    expect(await code(check({ letterhead: { ...lying, content_type: "application/pdf" } }))).toBe(
      "IPB-SEC-010",
    );
  });

  it("refuses an email identity whose domain is not verified with IPB-BRD-005", async () => {
    expect(
      await code(
        check({ email_identity: { from_name: "A", from_address: "a@unverified.example" } }),
      ),
    ).toBe("IPB-BRD-005");
    // The domain is the address's, whatever its case.
    await check({ email_identity: { from_name: "A", from_address: "a@Tenant-A.example" } });
  });

  it("refuses a proposal outside a tenant, by a role other than ORG_ADMIN or ORG_OWNER, or by an agent", async () => {
    const p = (c: KernelContext) => code(layers.propose(c, {}));
    expect(await p(withTenant("tnt_a", ["ORG_MEMBER"]))).toBe("IPB-UX-011");
    expect(await p(withTenant("tnt_a", ["ORG_CHECKER"]))).toBe("IPB-UX-011");
    expect(await p(withTenant("tnt_platform", ["ORG_OWNER"]))).toBe("IPB-UX-011");
    expect(
      await p(
        withTenant("tnt_a", ["ORG_ADMIN"], { principal: { id: "agt_vidhi", type: "agent" } }),
      ),
    ).toBe("IPB-SEC-004");
  });
});
