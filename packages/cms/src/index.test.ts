// Unit tests for the cms core (PL5 plan §5.3–§5.6, session 4). Database scenarios are in
// `__tests__/studio.int.test.ts`.
import { describe, expect, it } from "vitest";
import { IpbError } from "@infrabyx/contracts/errors";
import {
  BODY_SCHEMAS,
  checkSlug,
  dryRun,
  entityLine,
  faqPageLd,
  handlePublicApi,
  htmlToPortableText,
  lintContent,
  llmsTxt,
  missingSlots,
  officersLine,
  organizationLd,
  PACKAGE_NAME,
  parseBlocks,
  parseBody,
  PublicContent,
  redirectProblems,
  robotsTxt,
  safeHref,
  sanitisePortableText,
  seoWarnings,
  SeoFields,
  sitemapFor,
  sitemapIndex,
  slugify,
  stripJpegMetadata,
  stripPngMetadata,
  toHtml,
  transition,
  validateFooter,
  wordList,
  findPhrases,
  type ClaimInfo,
  type FooterInput,
} from "./index.js";

const CLM = "clm_01JB0000000000000000000001";
const MED = "med_01JB0000000000000000000001";

describe("cms", () => {
  it("exports its package name", () => {
    expect(PACKAGE_NAME).toBe("@infrabyx/cms");
  });
});

describe("@IPB-04-AT-20 XSS in blog (adversarial) — the sanitiser", () => {
  const payload =
    '<p>Hello <script>alert(1)</script><img src="x" onerror="alert(2)"> <a href="javascript:alert(3)">click</a></p>' +
    '<svg><script>alert(4)</script></svg><p style="color:red">styled</p><iframe src="https://evil.example"></iframe>';

  it("removes every script, handler, javascript: URL and inline SVG, and reports each removal", () => {
    const r = htmlToPortableText(payload);
    expect(r.removed).toEqual(
      expect.arrayContaining([
        "<script>",
        "onerror on <img> (event attribute)",
        "image not from the media library on <img>",
        "javascript: URL on <a>",
        "<svg> (inline SVG)",
        "style attribute on <p>",
        "<iframe>",
      ]),
    );
    const html = toHtml(r.value);
    expect(html).not.toMatch(/<script|onerror|javascript:|<svg|<iframe|style=/i);
    expect(html).toContain("click");
    expect(html).toContain("styled");
  });

  it("sanitises stored portable text again at render: hostile marks, links and nodes go", () => {
    const hostile = [
      {
        _type: "block",
        style: "h1",
        markDefs: [
          { _key: "a", _type: "link", href: "java\tscript:alert(1)" },
          { _key: "b", _type: "link", href: "data:text/html,<script>" },
          { _key: "c", _type: "link", href: "https://example.org/x" },
        ],
        children: [
          { _type: "span", text: "<img src=x onerror=alert(1)>", marks: ["a", "strong"] },
          { _type: "span", text: "ok", marks: ["b", "c", "onclick"] },
        ],
      },
      { _type: "html", html: "<script>alert(1)</script>" },
      { _type: "image", media_id: "https://evil.example/x.png" },
    ];
    const r = sanitisePortableText(hostile);
    expect(r.removed.length).toBeGreaterThanOrEqual(5);
    const html = toHtml(hostile);
    expect(html).toBe(
      '<p><strong>&lt;img src=x onerror=alert(1)&gt;</strong><a href="https://example.org/x" rel="noopener noreferrer">ok</a></p>',
    );
  });

  it("keeps the allowed structure: headings (h1 demoted), lists, emphasis, safe links, media images", () => {
    const r = htmlToPortableText(
      `<h1>T</h1><ul><li>One</li><li><b>Two</b></li></ul><p><a href="/about">About</a> <a href="mailto:a@example.org">m</a></p><img src="/m/${MED}/960.webp">`,
    );
    expect(toHtml(r.value, { media: () => ({ src: `/m/${MED}/960.webp`, alt: "A chart" }) })).toBe(
      `<h2>T</h2><ul><li>One</li><li><strong>Two</strong></li></ul><p><a href="/about">About</a> <a href="mailto:a@example.org">m</a></p><img src="/m/${MED}/960.webp" alt="A chart">`,
    );
  });

  it("allows only site paths, anchors, https:, mailto: and tel: links", () => {
    for (const ok of [
      "/a",
      "#top",
      "https://example.org",
      "mailto:x@example.org",
      "tel:+911234567890",
    ])
      expect(safeHref(ok)).toBe(ok);
    for (const bad of [
      "javascript:x",
      "JaVaScRiPt:x",
      " javascript:x",
      "data:x",
      "//evil.example",
      "http://example.org",
      "vbscript:x",
      "/\\evil",
    ])
      expect(safeHref(bad)).toBeNull();
  });
});

describe("slugs (IPB-04-20)", () => {
  it("refuses reserved slugs and non-kebab slugs with a suggestion, and warns on words not in the title", () => {
    expect(checkSlug("api")).toMatchObject({
      ok: false,
      error: "reserved",
      suggestion: "api-page",
    });
    expect(checkSlug("About Us")).toMatchObject({
      ok: false,
      error: "format",
      suggestion: "about-us",
    });
    expect(checkSlug("about-us", "About us").warnings).toEqual([]);
    expect(checkSlug("about-ux", "About us").warnings).toEqual([
      'slug word "ux" is not in the title',
    ]);
    expect(slugify("Café & Résumé — 2026")).toBe("cafe-and-resume-2026");
  });
});

describe("@IPB-04-AT-02 the named state machine", () => {
  it("allows only listed transitions; anything else is IPB-CMS-003", () => {
    expect(transition("draft", "submit")).toBe("in_review");
    expect(transition("legal_review", "legal_approve")).toBe("in_review");
    expect(transition("scheduled", "edit")).toBe("draft");
    expect(transition("scheduled", "unschedule")).toBe("approved");
    const e = (() => {
      try {
        transition("draft", "publish_now");
      } catch (x) {
        return x as IpbError;
      }
    })();
    expect(e?.code).toBe("IPB-CMS-003");
    expect(e?.meta).toMatchObject({ reason: "transition" });
  });
});

describe("@IPB-04-AT-94 SSRF via embed (adversarial)", () => {
  it("refuses metadata, private and look-alike addresses on save, so nothing is ever fetched", () => {
    const urls = [
      "http://169.254.169.254/latest/meta-data",
      "http://10.0.0.5/admin",
      "https://intranet.internal/watch?v=abc",
      "https://www.youtube.com.evil.example/watch?v=abc",
      "https://www.youtube.com:8443/watch?v=abc",
      "https://user@www.youtube.com/watch?v=abc",
      "http://www.youtube.com/watch?v=abc",
    ];
    const r = parseBlocks(
      urls.map((url) => ({ type: "embed", provider: "youtube", url, title: "Video" })),
    );
    expect(r.issues.map((i) => i.path)).toEqual(urls.map((_, i) => `blocks[${i}].url`));
    expect(
      parseBlocks([
        {
          type: "embed",
          provider: "youtube",
          url: "https://www.youtube.com/watch?v=abc123",
          title: "V",
        },
        { type: "embed", provider: "vimeo", url: "https://vimeo.com/123456", title: "V" },
      ]).issues,
    ).toEqual([]);
  });
});

describe("blocks and templates (IPB-04-13)", () => {
  it("validates blocks against their schemas, with field paths", () => {
    const r = parseBlocks([
      { type: "hero", heading: "H" },
      { type: "hero", heading: "Again" },
      { type: "nope" },
      { type: "cta", heading: "Go", button: { label: "Go", href: "javascript:alert(1)" } },
      { type: "embed", provider: "evil", url: "https://evil.example", title: "x" },
      { type: "mermaid", source: "graph TD", caption: "c", fallback_text: "f" },
      {
        type: "tabs",
        tabs: [
          { label: "a", blocks: [{ type: "tabs", tabs: [] }] },
          { label: "b", blocks: [{ type: "steps", items: [] }] },
        ],
      },
    ]);
    expect(r.issues.map((i) => i.path)).toEqual(
      expect.arrayContaining([
        "blocks",
        "blocks[2].type",
        "blocks[3].button.href",
        "blocks[4].provider",
        "blocks[5]",
        "blocks[6].tabs[0]",
        "blocks[6].tabs[1].blocks[0].items",
      ]),
    );
  });

  it("lists required template slots that are empty", () => {
    expect(missingSlots("people", [])).toEqual(["team"]);
    expect(missingSlots("home", [{ type: "hero", slot: "hero" }])).toEqual([
      "what",
      "audience",
      "how",
      "trust",
      "cta",
      "faq",
    ]);
    expect(missingSlots("nope", [])).toEqual(["template:nope"]);
  });

  it("parses typed bodies and sanitises every portable-text field in them", () => {
    const p = parseBody("faq", {
      question: "Q?",
      answer: [
        {
          _type: "block",
          style: "normal",
          markDefs: [{ _key: "x", _type: "link", href: "javascript:1" }],
          children: [{ _type: "span", text: "A", marks: ["x"] }],
        },
      ],
    });
    expect(p.issues).toEqual([]);
    expect(p.removed).toEqual(["javascript: URL on a link (x)"]);
    expect(p.body.answer).toEqual([
      {
        _type: "block",
        style: "normal",
        markDefs: [],
        children: [{ _type: "span", text: "A", marks: [] }],
      },
    ]);
    expect(
      BODY_SCHEMAS.nav_menu.safeParse({
        location: "header",
        items: Array.from({ length: 8 }, (_, i) => ({ label: `L${i}`, href: "/x" })),
      }).success,
    ).toBe(false);
  });
});

describe("@IPB-04-AT-06 Claims Register lint and the word list (IPB-04-07, O-5)", () => {
  const claim = (over: Partial<ClaimInfo>): ClaimInfo => ({
    id: CLM,
    evidenceClass: "E1",
    kind: "figure",
    status: "active",
    asOf: "2026-09-30",
    evidenceDocId: null,
    permissionDocId: null,
    ...over,
  });
  const lint = (
    blocks: unknown[],
    claims: ClaimInfo[] = [],
    extra: { title?: string; claimsRefs?: string[] } = {},
  ) => {
    const p = parseBlocks(blocks);
    return lintContent({
      type: "page",
      title: extra.title ?? "A page",
      seo: {},
      body: { template: "blank", blocks: p.blocks },
      blocks: p.blocks,
      claimsRefs: extra.claimsRefs ?? [],
      claims: new Map(claims.map((c) => [c.id, c])),
      media: new Map(),
    });
  };

  it("refuses a stats figure without a claim, or with an E0 or proposed claim", () => {
    const stats = (ref?: string) => [
      {
        type: "stats",
        items: [{ value: "10,000+", label: "customers", ...(ref ? { claims_ref: ref } : {}) }],
      },
    ];
    expect(lint(stats()).findings.map((f) => f.code)).toEqual(["IPB-CMS-010"]);
    expect(lint(stats(CLM), [claim({ evidenceClass: "E0" })]).findings.map((f) => f.code)).toEqual([
      "IPB-CMS-010",
    ]);
    expect(lint(stats(CLM), [claim({ status: "proposed" })]).findings.map((f) => f.code)).toEqual([
      "IPB-CMS-010",
    ]);
    expect(lint(stats(CLM), [claim({})]).findings).toEqual([]);
  });

  it("refuses logos without permission evidence and testimonials until their gate exists", () => {
    const r = lint(
      [
        { type: "logo_wall", logos: [{ media_id: MED, org: "Org", claims_ref: CLM }] },
        { type: "testimonial", testimonial_ids: ["tst_01JB0000000000000000000001"] },
      ],
      [claim({ kind: "permission" })],
    );
    expect(r.findings.map((f) => f.code)).toEqual(
      expect.arrayContaining(["IPB-CMS-014", "IPB-CMS-014", "IPB-CMS-007"]),
    );
  });

  it("flags the owner's banned phrases, category claims and certification claims, but not negations", () => {
    const text = (t: string) => [
      {
        type: "rich_text",
        content: [
          {
            _type: "block",
            style: "normal",
            markDefs: [],
            children: [{ _type: "span", text: t, marks: [] }],
          },
        ],
      },
    ];
    const codes = (t: string, refs: string[] = [], claims: ClaimInfo[] = []) =>
      lint(text(t), claims, { claimsRefs: refs }).findings.map((f) => f.code);
    expect(codes("We are RBI approved and 100% secure.")).toEqual(["IPB-CMS-012", "IPB-CMS-012"]);
    expect(codes("The platform does not guarantee outcomes.")).toEqual([]);
    expect(codes("We guarantee results.")).toEqual(["IPB-CMS-012"]);
    expect(codes("India's first legal platform.")).toEqual(["IPB-CMS-012"]);
    expect(
      codes(
        "India's first legal platform.",
        [CLM],
        [claim({ kind: "category", evidenceClass: "E2" })],
      ),
    ).toEqual([]);
    expect(codes("In the first step, sign in.")).toEqual([]);
    expect(codes("We are ISO 27001 certified.")).toEqual(["IPB-TRUST-006", "IPB-TRUST-006"]);
    expect(
      codes(
        "We are ISO 27001 certified.",
        [CLM],
        [
          claim({
            kind: "certification",
            evidenceClass: "E3",
            evidenceDocId: "vad_01JB0000000000000000000001",
          }),
        ],
      ),
    ).toEqual([]);
  });

  it("flags dark patterns in hero and CTA copy only", () => {
    const r = lint([
      { type: "cta", heading: "Hurry, last chance", button: { label: "Buy", href: "/buy" } },
    ]);
    expect(r.findings.map((f) => f.code)).toEqual(["IPB-CMS-015", "IPB-CMS-015"]);
  });

  it("lets a product add phrases but never remove them", () => {
    const w = wordList({ banned: ["pre-approved"] });
    expect(w.banned).toContain("pre-approved");
    expect(w.banned).toContain("unhackable");
    expect(findPhrases("No. 1 in India", w.category)).toEqual(["No. 1"]);
  });
});

describe("@IPB-04-AT-08 redirects: loops, chains and the CSV dry run", () => {
  it("refuses B→A when A→B exists, and chains longer than one hop", () => {
    const existing = [{ from: "/a", to: "/b", status: 301 as const }];
    expect(redirectProblems(existing, { from: "/b", to: "/a", status: 301 })[0]).toMatch(
      /^loop: \/b → \/a → \/b/,
    );
    expect(redirectProblems(existing, { from: "/b", to: "/c", status: 301 })[0]).toMatch(
      /^chain longer than one hop: \/a → \/b → \/c/,
    );
    expect(redirectProblems(existing, { from: "/z", to: "/a", status: 301 })[0]).toMatch(/^chain/);
    expect(redirectProblems(existing, { from: "/gone", to: null, status: 410 })).toEqual([]);
  });

  it("dry-runs a 500-row legacy CSV and reports conflicts, loops and chains without committing", () => {
    const rows = Array.from({ length: 497 }, (_, i) => `/old-${i},/new-${i},301`);
    rows.push("/a,/x,301", "/b,/a,301", "/new-1,/old-1,301");
    const report = dryRun(
      [{ from: "/a", to: "/b", status: 301 }],
      ["from_path,to_path,status", ...rows].join("\n"),
    );
    expect(report.accepted).toHaveLength(497);
    expect(report.conflicts.map((c) => c.line)).toEqual([499]);
    expect(report.loops.map((c) => c.line)).toEqual([500, 501]);
  });
});

describe("@IPB-04-AT-07 SEO fields and structured data", () => {
  it("warns on long titles and descriptions", () => {
    const seo = SeoFields.parse({ description: "x".repeat(170) });
    expect(seoWarnings(seo, "t".repeat(61))).toEqual([
      "title is 61 characters; keep it to 60",
      "description is 170 characters; keep it to 160",
    ]);
  });

  it("Organization JSON-LD carries the legal name, CIN as an identifier and the grievance contact", () => {
    const ld = organizationLd({
      base: "https://group.example.org",
      brandName: "Example Group",
      legalEntity: {
        name: "Example Group Private Limited",
        cin: "U00000DL2026PTC000000",
        registered_office: "1 Example Road, New Delhi",
      },
      sameAs: ["https://www.linkedin.com/company/example"],
      grievance: { name: "Grievance Officer", email: "grievance@example.org" },
    });
    expect(ld).toMatchObject({
      legalName: "Example Group Private Limited",
      identifier: [{ propertyID: "CIN", value: "U00000DL2026PTC000000" }],
      contactPoint: [{ contactType: "grievance officer", email: "grievance@example.org" }],
    });
    expect(faqPageLd([{ question: "q", answer: "a", eligible: false }])).toBeNull();
  });

  it("generates the sitemap index, per-type sitemaps, robots.txt and llms.txt from published entries", () => {
    const entries = [
      {
        path: "/about",
        type: "page",
        locale: "en-IN",
        title: "About",
        summary: "Who we are",
        lastmod: "2026-10-27T00:00:00.000Z",
        alternates: { "en-IN": "/about" },
      },
      {
        path: "/careers/engineer",
        type: "job",
        locale: "en-IN",
        title: "Engineer",
        summary: "A role",
        lastmod: "2026-10-26T00:00:00.000Z",
      },
      {
        path: "/hidden",
        type: "page",
        locale: "en-IN",
        title: "Hidden",
        summary: "x",
        lastmod: "2026-10-25T00:00:00.000Z",
        noindex: true,
      },
    ];
    expect(sitemapIndex("https://g.example.org", entries)).toContain(
      "<loc>https://g.example.org/sitemap-job.xml</loc>",
    );
    const pages = sitemapFor("https://g.example.org", entries, "page");
    expect(pages).toContain(
      "<loc>https://g.example.org/about</loc><lastmod>2026-10-27T00:00:00.000Z</lastmod>",
    );
    expect(pages).not.toContain("/hidden");
    expect(robotsTxt({ base: "https://g.example.org" })).toContain(
      "Sitemap: https://g.example.org/sitemap.xml",
    );
    expect(robotsTxt({ base: "https://g.example.org", noindex: true })).toBe(
      "User-agent: *\nDisallow: /\n",
    );
    expect(
      llmsTxt({ siteName: "Example Group", base: "https://g.example.org", summary: "S", entries }),
    ).toContain("- [About](https://g.example.org/about): Who we are");
  });
});

describe("@IPB-04-AT-73 footer validator", () => {
  const good = (): FooterInput => ({
    pack: "brd_01JB0000000000000000000001",
    brand: { logo: true, description: "One line", groupUrl: "https://group.example.org" },
    menus: { product: 3, resources: 1, company: 1 },
    legal: { adopted: ["privacy", "terms"], linked: ["privacy", "terms"] },
    legalEntity: {
      name: "Example Private Limited",
      cin: "U00000DL2026PTC000000",
      gstin: "07AAAAA0000A1Z5",
      registeredOffice: "1 Example Road",
    },
    officers: {
      grievance: { name: "G", email: "g@example.org" },
      dpo: { name: "D", email: "d@example.org" },
    },
    contact: { phone: "+91 11 0000 0000", email: "hello@example.org" },
    offices: [
      { label: "Delhi", city: "Delhi", isRegisteredOffice: true },
      { label: "Noida", city: "Noida", isRegisteredOffice: false },
      { label: "Jaipur", city: "Jaipur", isRegisteredOffice: false },
    ],
    social: [
      {
        label: "Example on LinkedIn (opens in new tab)",
        url: "https://www.linkedin.com/company/example",
      },
    ],
    utilities: {
      statusUrl: "https://status.example.org",
      languageSwitch: true,
      cookieSettings: true,
      accessibility: true,
      sitemap: true,
      reportProblem: true,
    },
    disclaimer: "Software provider; not a regulated entity.",
    copyrightYear: 2026,
  });

  it("passes a complete footer and builds the entity and officers lines as text", () => {
    expect(validateFooter(good(), new Date("2026-10-27"))).toEqual([]);
    expect(entityLine(good().legalEntity)).toBe(
      "Example Private Limited · CIN U00000DL2026PTC000000 · GSTIN 07AAAAA0000A1Z5",
    );
    expect(officersLine(good().officers)).toBe(
      "Grievance Officer: G, g@example.org · Data Protection Officer: D, d@example.org",
    );
  });

  it("fails naming the pack and the field when the GSTIN is empty, an office is missing or a policy is not linked", () => {
    const f = good();
    f.legalEntity.gstin = "";
    f.offices = f.offices.filter((o) => o.city !== "Jaipur");
    f.legal = { adopted: ["privacy", "terms"], linked: ["privacy"] };
    expect(validateFooter(f, new Date("2026-10-27"))).toEqual([
      { pack: f.pack, field: "legal.terms" },
      { pack: f.pack, field: "legal_entity.gstin" },
      { pack: f.pack, field: "offices.jaipur" },
    ]);
  });
});

describe("media metadata is stripped (IPB-04-11)", () => {
  it("removes APP1 (EXIF) from a JPEG and keeps the image data", () => {
    const jpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe1, 0x00, 0x06, 0x45, 0x78, 0x69, 0x66, 0xff, 0xdb, 0x00, 0x03, 0x01,
      0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9,
    ]);
    const r = stripJpegMetadata(jpeg);
    expect(r.removed).toEqual(["EXIF/XMP (APP1)"]);
    expect([...r.bytes]).toEqual([
      0xff, 0xd8, 0xff, 0xdb, 0x00, 0x03, 0x01, 0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9,
    ]);
  });

  it("removes tEXt and eXIf chunks from a PNG", () => {
    const chunk = (type: string, data: number[]) => [
      0,
      0,
      0,
      data.length,
      ...[...type].map((c) => c.charCodeAt(0)),
      ...data,
      0,
      0,
      0,
      0,
    ];
    const png = Uint8Array.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...chunk("IHDR", [1, 2]),
      ...chunk("tEXt", [65]),
      ...chunk("eXIf", [66]),
      ...chunk("IEND", []),
    ]);
    const r = stripPngMetadata(png);
    expect(r.removed).toEqual(["tEXt chunk", "eXIf chunk"]);
    expect(r.bytes.length).toBe(8 + 14 + 12);
  });
});

describe("@IPB-04-AT-14 the public API is read-only (handler)", () => {
  const reader = {
    resolve: async () => ({ kind: "not_found" }),
    list: async () => [],
    byId: async () => null,
  } as unknown as PublicContent;
  it("answers 405 with Allow for every write method, and supports ETag and 304", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await handlePublicApi(reader, {
        method,
        url: "/api/public/v1/content",
        headers: {},
      });
      expect(r.status).toBe(405);
      expect(r.headers.allow).toBe("GET, HEAD");
    }
    const ok = await handlePublicApi(reader, {
      method: "GET",
      url: "/api/public/v1/content?pack=brd_01JB0000000000000000000001",
      headers: {},
    });
    expect(ok.status).toBe(200);
    const again = await handlePublicApi(reader, {
      method: "GET",
      url: "/api/public/v1/content?pack=brd_01JB0000000000000000000001",
      headers: { "if-none-match": ok.headers.etag },
    });
    expect(again.status).toBe(304);
    const limited = await handlePublicApi(
      reader,
      { method: "GET", url: "/api/public/v1/content?pack=brd_x", headers: {} },
      { allow: () => false },
    );
    expect(limited.status).toBe(429);
  });
});
