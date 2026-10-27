import { describe, expect, it } from "vitest";
import { contrastRatio } from "@infrabyx/ui/tokens";
import { IpbError } from "@infrabyx/contracts/errors";
import { contrastGuard, contrastMessage } from "./contrast.js";
import { faviconSet, webManifest } from "./favicon.js";
import { normaliseHost, resolveHost } from "./hosts.js";
import {
  BrandPackBody,
  changedLegalFields,
  emailDomain,
  type BrandPackBodyInput,
} from "./shape.js";
import { sanitiseSvg } from "./svg.js";
import { assistantName, brandedTitle, emailSubject, term } from "./terminology.js";

export const sampleBody = (over: Partial<BrandPackBodyInput> = {}): BrandPackBodyInput => ({
  app_name: "Example Group",
  legal_entity: {
    name: "Example Private Limited",
    registered_office: "1 Example Road, Example City 400001",
    entity_type: "PRIVATE_LIMITED",
  },
  tokens: {
    colour: { primary: "#1D4ED8", accent: "#0F766E" },
    font: { sans: "Inter", mono: "JetBrains Mono" },
  },
  email_identity: { from_name: "Example Group", from_address: "no-reply@example.test" },
  ...over,
});

const code = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof IpbError ? e.code : String(e);
  }
};

describe("@IPB-04-AT-21 SVG logo script (adversarial)", () => {
  it("removes script, event attributes, foreignObject and external use, and reports each removal", () => {
    const evil = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)">
  <script>alert(1)</script>
  <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>
  <use href="https://evil.example/sprite.svg#a"/>
  <use xlink:href="#local"/>
  <a href="https://evil.example"><rect width="1" height="1"/></a>
  <style>@import url(https://evil.example/x.css);</style>
  <path id="local" d="M0 0h10v10z" fill="url(https://evil.example/p)" onclick="x()"/>
  <rect width="5" height="5" fill="#123456"/>
</svg>`;
    const { svg, removed } = sanitiseSvg(evil);
    for (const bad of [
      "<script",
      "onload",
      "foreignObject",
      "evil.example",
      "<a",
      "@import",
      "onclick",
    ])
      expect(svg, bad).not.toContain(bad);
    expect(svg).toContain('xlink:href="#local"');
    expect(svg).toContain('fill="#123456"');
    expect(removed).toEqual(
      expect.arrayContaining([
        "onload on <svg> (event attribute)",
        "<script>",
        "<foreignObject>",
        "href on <use> (external reference)",
        "<a>",
        "<style> with an external reference",
        "fill on <path> (external reference)",
        "onclick on <path> (event attribute)",
      ]),
    );
  });

  it("refuses DOCTYPE, malformed XML, a non-SVG root and oversize files with IPB-BRD-001", () => {
    expect(
      code(() =>
        sanitiseSvg('<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"/>'),
      ),
    ).toBe("IPB-BRD-001");
    expect(code(() => sanitiseSvg("<svg><g></svg>"))).toBe("IPB-BRD-001");
    expect(code(() => sanitiseSvg('<html xmlns="http://www.w3.org/1999/xhtml"/>'))).toBe(
      "IPB-BRD-001",
    );
    expect(
      code(() =>
        sanitiseSvg(
          `<svg xmlns="http://www.w3.org/2000/svg"><desc>${"x".repeat(600_000)}</desc></svg>`,
        ),
      ),
    ).toBe("IPB-BRD-001");
  });

  it("keeps a clean logo as it is", () => {
    const clean =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2" role="img" aria-label="Logo"><title>Logo</title><circle cx="1" cy="1" r="1" fill="#0F766E"/></svg>';
    const r = sanitiseSvg(clean);
    expect(r.removed).toEqual([]);
    expect(r.svg).toContain('<circle cx="1" cy="1" r="1" fill="#0F766E"/>');
  });
});

describe("contrast guard", () => {
  it("@IPB-04-AT-23 body text on the surface at 3.9:1 fails, naming the pair and ratio", () => {
    // #7A7A7A on white is about 4.3:1; #888888 about 3.5:1. #808080 is 3.95:1.
    const g = contrastGuard("GRP", {
      primary: "#1D4ED8",
      accent: "#0F766E",
      surface: "#FFFFFF",
      on_surface: "#808080",
    });
    expect(g.passed).toBe(false);
    expect(g.failures[0]).toMatchObject({ pair: "on_surface/surface", scheme: "light", min: 4.5 });
    expect(g.failures[0]!.ratio).toBeCloseTo(3.94, 2);
    expect(contrastRatio(g.failures[0]!.suggestion!, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });

  it("@IPB-06-AT-11 a low-contrast primary is refused with the ratio and a suggested nearest compliant colour", () => {
    const g = contrastGuard(
      "GRP",
      BrandPackBody.parse(
        sampleBody({
          tokens: {
            colour: { primary: "#F5D28A", accent: "#0F766E" },
            font: { sans: "Inter", mono: "Mono" },
          },
        }),
      ).tokens.colour,
    );
    const f = g.failures.find((x) => x.pair === "primary/surface")!;
    expect(f.ratio).toBeLessThan(3);
    expect(contrastRatio(f.suggestion!, "#FFFFFF")).toBeGreaterThanOrEqual(3);
    expect(contrastMessage(f)).toMatch(
      /^This colour pair \(primary\/surface, light\) has contrast 1\.\d\d:1; at least 3:1 is required\. Try #[0-9A-F]{6}\.$/,
    );
  });

  it("@IPB-07-AT-24 computes a dark on-primary for #FFD54F, renders four previews, and refuses #FFFBEA on white", () => {
    const amber = contrastGuard("UDF", {
      primary: "#FFD54F",
      accent: "#0F766E",
      surface: "#FFFFFF",
      on_surface: "#111827",
    });
    expect(contrastRatio(amber.derived.onPrimary, "#FFD54F")).toBeGreaterThanOrEqual(4.5);
    expect(amber.derived.onPrimary).not.toBe("#FFFFFF");
    expect(Object.keys(amber.previews)).toEqual(["light", "dark", "hc_light", "hc_dark"]);
    // IPB-07-32 also needs primary-on-surface 3:1; the amber is 1.41:1, so it is refused too (PL5-D-04).
    expect(amber.failures.map((f) => f.pair)).toEqual(["primary/surface"]);
    const pale = contrastGuard("UDF", {
      primary: "#FFFBEA",
      accent: "#0F766E",
      surface: "#FFFFFF",
      on_surface: "#111827",
    });
    expect(pale.passed).toBe(false);
    expect(pale.failures[0]!.pair).toBe("primary/surface");
  });

  it("passes a compliant pack, and the minimums can only be raised", () => {
    const ok = { primary: "#1D4ED8", accent: "#0F766E", surface: "#FFFFFF", on_surface: "#111827" };
    expect(contrastGuard("GRP", ok).passed).toBe(true);
    expect(contrastGuard("GRP", ok, { minText: 3, minUi: 2 }).passed).toBe(true);
    expect(contrastGuard("GRP", ok, { minUi: 7 }).passed).toBe(false);
  });
});

describe("@IPB-04-AT-27 host-header brand spoof (adversarial)", () => {
  const map = [{ host: "app.partnerbank.example", packId: "P2" }];
  it("never selects a pack from X-Forwarded-Host; the mismatch is a security event", () => {
    const r = resolveHost(map, "P1", {
      host: "evil.example",
      forwardedHost: "app.partnerbank.example",
    });
    expect(r).toMatchObject({ packId: "P1", noindex: true });
    expect(r.events.map((e) => e.code)).toEqual(["forwarded_host_mismatch", "IPB-BRD-007"]);
  });
  it("serves the default pack with noindex for an unmapped host and logs IPB-BRD-007", () => {
    const r = resolveHost(map, "P1", { host: "unknown.example" });
    expect(r).toMatchObject({ packId: "P1", noindex: true, events: [{ code: "IPB-BRD-007" }] });
  });
  it("selects a mapped host, case- and port-insensitively", () => {
    expect(resolveHost(map, "P1", { host: "App.PartnerBank.example:443" })).toEqual({
      packId: "P2",
      noindex: false,
      events: [],
    });
    expect(normaliseHost("bad host")).toBeNull();
    expect(resolveHost(map, "P1", { host: undefined }).events[0]!.code).toBe("invalid_host");
  });
});

describe("@IPB-04-AT-22 favicon set (file level)", () => {
  it("builds icon.svg and a manifest named after app_name, listing PNGs only when uploaded", () => {
    const body = BrandPackBody.parse(sampleBody());
    const set = faviconSet(body, "<svg/>", "#1D4ED8");
    expect(set.files.map((f) => f.path)).toEqual(["/icon.svg", "/site.webmanifest"]);
    expect(set.missing).toEqual([
      "/apple-touch-icon.png",
      "/icon-192.png",
      "/icon-512.png",
      "/favicon.ico",
    ]);
    const manifest = JSON.parse(set.files[1]!.body!);
    expect(manifest).toMatchObject({
      name: "Example Group",
      theme_color: "#1D4ED8",
      background_color: "#FFFFFF",
    });
    const ref = { key: "k", sha256: "0".repeat(64), content_type: "image/png" };
    const withPng = BrandPackBody.parse(
      sampleBody({ logo: { svg: { ...ref, content_type: "image/svg+xml" }, png: { "512": ref } } }),
    );
    expect(webManifest(withPng, "#000000")["icons"]).toContainEqual(
      expect.objectContaining({ purpose: "maskable" }),
    );
  });
});

describe("@IPB-04-AT-25 application display name and terminology", () => {
  it("uses app_name and the assistant override for display, never for identifiers", () => {
    const body = BrandPackBody.parse(
      sampleBody({ app_name: "PartnerBank Loans", terminology_override: { vidhi: "Sahayak" } }),
    );
    expect(brandedTitle(body, "Sign in")).toBe("Sign in · PartnerBank Loans");
    expect(emailSubject(body, "Your code")).toBe("[PartnerBank Loans] Your code");
    expect(assistantName(body)).toBe("Sahayak");
    expect(term(body, "workspace", "Workspace")).toBe("Workspace");
    expect(assistantName(BrandPackBody.parse(sampleBody()))).toBe("Vidhi");
  });
});

describe("pack body", () => {
  it("accepts only `none` analytics at launch, validates the CIN, and finds legal-class changes", () => {
    expect(
      BrandPackBody.safeParse(
        sampleBody({
          analytics: { tag_manager_adapter: "gtm" as "none", analytics_adapter: "none" },
        }),
      ).success,
    ).toBe(false);
    expect(
      BrandPackBody.safeParse(
        sampleBody({
          legal_entity: { ...sampleBody().legal_entity, cin: "U12345MH2020PTC123456" },
        }),
      ).success,
    ).toBe(true);
    expect(
      BrandPackBody.safeParse(
        sampleBody({ legal_entity: { ...sampleBody().legal_entity, cin: "123" } }),
      ).success,
    ).toBe(false);
    const a = BrandPackBody.parse(sampleBody());
    const b = BrandPackBody.parse(sampleBody({ app_name: "Renamed" }));
    const c = BrandPackBody.parse(
      sampleBody({ legal_entity: { ...sampleBody().legal_entity, name: "Other Private Limited" } }),
    );
    expect(changedLegalFields(a, b)).toEqual([]);
    expect(changedLegalFields(a, c)).toEqual(["legal_entity"]);
    expect(changedLegalFields(null, a)).toEqual(["legal_entity", "email_identity"]);
    expect(emailDomain(a)).toBe("example.test");
  });
});
