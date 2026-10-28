// The Studio console gate (PL5 plan §9.6, §11; IPB-06-54): every Studio route, as the persona
// that may open it, in light and dark themes with zero axe violations and zero HTML_CodeSniffer
// errors, reflow at 320 px, text at 200 %, the skip link first and no request to another origin;
// every screen works without JavaScript; the AUTHZ gate (sign-in, 403, 404); the CSP and
// `noindex`; and a maker-checker publish through the forms. Run by the `a11y` job against the
// seeded database (IPB_TEST_CONSOLE_URL).
import { existsSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import {
  axeScan,
  formatFindings,
  htmlcsScan,
  recordThirdPartyRequests,
  reflowCheck,
  skipLinkFirst,
  textScaleCheck,
  type GateFinding,
} from "@infrabyx/a11y/playwright";

const BASE = process.env["IPB_TEST_CONSOLE_URL"] ?? "http://127.0.0.1:3124";
const COOKIE = "ibx_console_persona";

function findChromium(): string | undefined {
  const env = process.env["IPB_CHROMIUM"];
  if (env && existsSync(env)) return env;
  for (const root of ["/opt/pw-browsers", `${process.env["HOME"] ?? ""}/.cache/ms-playwright`]) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root)
      .filter((x) => /^chromium-\d+$/.test(x))
      .sort()
      .reverse())
      for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome"])
        if (existsSync(`${root}/${d}/${sub}`)) return `${root}/${d}/${sub}`;
  }
  return ["/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
}

/** Each list route and the persona that opens it. */
const LISTS: readonly [string, string][] = [
  ["/studio/approvals", "admin"],
  ["/studio/brand", "admin"],
  ["/studio/pricing", "admin"],
  ["/studio/pages", "editor"],
  ["/studio/menus", "editor"],
  ["/studio/footer", "editor"],
  ["/studio/policies", "legal"],
  ["/studio/redirects", "editor"],
  ["/studio/media", "editor"],
  ["/studio/claims", "editor"],
  ["/studio/resources", "editor"],
  ["/studio/forms", "editor"],
  ["/studio/consent", "dpo"],
  ["/studio/feedback", "a11y"],
  ["/studio/trust", "admin"],
  ["/studio/previews", "editor"],
];

const exe = findChromium();
let browser: Browser;
/** Editor routes found from the lists (the seeded page, brand pack and a policy version). */
let EDITORS: [string, string][] = [];

async function fresh(persona: string | null, o: { dark?: boolean; js?: boolean } = {}) {
  const ctx: BrowserContext = await browser.newContext({
    colorScheme: o.dark ? "dark" : "light",
    javaScriptEnabled: o.js !== false,
    viewport: { width: 1280, height: 900 },
  });
  if (persona)
    await ctx.addCookies([
      { name: COOKIE, value: persona, url: BASE, httpOnly: true, sameSite: "Strict" },
    ]);
  return ctx;
}

async function firstLink(persona: string, list: string, pattern: RegExp): Promise<string> {
  const r = await fetch(`${BASE}${list}`, { headers: { cookie: `${COOKIE}=${persona}` } });
  const m = pattern.exec(await r.text());
  if (!m) throw new Error(`no editor link on ${list}`);
  return m[0];
}

describe.skipIf(!exe)(`Studio console gate at ${BASE}`, () => {
  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: exe! });
    EDITORS = [
      [
        await firstLink("editor", "/studio/pages", /\/studio\/pages\/[a-z]{2,4}_[0-9A-Z]{26}/),
        "editor",
      ],
      [await firstLink("admin", "/studio/brand", /\/studio\/brand\/brd_[0-9A-Z]{26}/), "admin"],
      [
        await firstLink("legal", "/studio/policies", /\/studio\/policies\/[a-z]{2,4}_[0-9A-Z]{26}/),
        "legal",
      ],
      [
        await firstLink("editor", "/studio/footer", /\/studio\/footer\/[a-z]{2,4}_[0-9A-Z]{26}/),
        "editor",
      ],
    ];
  });
  afterAll(async () => {
    await browser?.close();
  });

  for (const theme of ["light", "dark"] as const)
    it(`@IPB-06-AT-01 every Studio route passes axe, HTML_CodeSniffer, reflow, text scale and the skip link (${theme})`, async () => {
      const findings: GateFinding[] = [];
      for (const [route, persona] of [...LISTS, ...EDITORS]) {
        const ctx = await fresh(persona, { dark: theme === "dark" });
        const page = await ctx.newPage();
        const rec = recordThirdPartyRequests(page, { origin: BASE });
        await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
        const o = { route, theme };
        findings.push(...(await axeScan(page, o)));
        findings.push(...(await htmlcsScan(page, o)));
        findings.push(...(await skipLinkFirst(page, o)));
        findings.push(...(await textScaleCheck(page, o)));
        findings.push(...(await reflowCheck(page, o)));
        findings.push(...rec.findings(o));
        rec.stop();
        await ctx.close();
      }
      expect(formatFindings(findings)).toBe("");
    });

  it("every Studio screen renders its heading and forms without JavaScript", async () => {
    for (const [route, persona] of [...LISTS, ...EDITORS]) {
      const ctx = await fresh(persona, { js: false });
      const page = await ctx.newPage();
      const r = await page.goto(`${BASE}${route}`);
      expect(r?.status(), route).toBe(200);
      expect((await page.locator("main h1").first().textContent())?.trim(), route).toBeTruthy();
      expect(
        await page.locator('nav[aria-label="Studio sections"] a[aria-current="page"]').count(),
        route,
      ).toBe(1);
      await ctx.close();
    }
  });

  it("the gate: sign-in first, 403 for a section the role does not open, 404 for an unknown one", async () => {
    const anon = await fetch(`${BASE}/studio/pages`, { redirect: "manual" });
    expect(anon.status).toBe(303);
    expect(anon.headers.get("location")).toMatch(/\/sign-in$/);
    const denied = await fetch(`${BASE}/studio/consent`, {
      headers: { cookie: `${COOKIE}=editor` },
      redirect: "manual",
    });
    expect(denied.status).toBe(403);
    expect(await denied.text()).toContain("You cannot open this section");
    const missing = await fetch(`${BASE}/studio/nothing-here`, {
      headers: { cookie: `${COOKIE}=admin` },
    });
    expect(missing.status).toBe(404);
    const menu = await (
      await fetch(`${BASE}/studio/pages`, { headers: { cookie: `${COOKIE}=editor` } })
    ).text();
    expect(menu).not.toContain('href="/studio/consent"');
    expect(menu).not.toContain('href="/studio/feedback"');
    const forged = await fetch(`${BASE}/studio-actions/pages/workflow`, {
      method: "POST",
      headers: {
        cookie: `${COOKIE}=editor`,
        origin: "https://evil.example",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "itemId=x&op=submit",
      redirect: "manual",
    });
    expect(forged.status).toBe(403);
  });

  it("serves the nonce CSP, noindex and no-store on every page", async () => {
    const r = await fetch(`${BASE}/studio/approvals`, { headers: { cookie: `${COOKIE}=admin` } });
    expect(r.headers.get("content-security-policy")).toMatch(
      /script-src 'nonce-[A-Za-z0-9_-]+' 'strict-dynamic'/,
    );
    expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(r.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(r.headers.get("cache-control")).toContain("no-store");
  });

  it("@IPB-04-AT-03 a page goes from draft to published through the forms, with a second person approving", async () => {
    const editor = await fresh("editor", { js: false });
    const page = await editor.newPage();
    await page.goto(`${BASE}/studio/pages`);
    await page.fill("#f-title", "Gate test page");
    await page.fill("#f-slug", `gate-test-${Date.now()}`);
    await page.fill(
      "#f-body",
      JSON.stringify({
        template: "article",
        blocks: [
          {
            type: "rich_text",
            slot: "body",
            content: [
              {
                _type: "block",
                style: "normal",
                markDefs: [],
                children: [{ _type: "span", text: "Hello", marks: [] }],
              },
            ],
          },
        ],
      }),
    );
    await page.click("text=Create draft");
    expect(await page.locator(".ibx-notice__title").first().textContent()).toBe("Draft created");
    const url = page.url().split("?")[0]!;
    await page.click("text=Submit for review");
    expect(await page.locator(".ibx-notice__title").first().textContent()).toBe(
      "Submitted for review",
    );
    expect(await page.locator('button:has-text("Approve")').count()).toBe(1);
    await page.click('button:has-text("Approve")');
    expect(await page.locator(".ibx-notice__title").first().textContent()).toContain("IPB-CMS-004");
    await editor.close();

    const checker = await fresh("checker", { js: false });
    const p2 = await checker.newPage();
    await p2.goto(url);
    await p2.click('button:has-text("Approve")');
    await p2.click("text=Publish now");
    expect(await p2.locator(".ibx-notice__title").first().textContent()).toBe("Published");
    expect(await p2.locator(".ibx-badge").first().textContent()).toBe("published");
    await checker.close();
  });

  it("PR-038 a page's blocks are added, edited, moved and removed through the block editor without JavaScript", async () => {
    const editor = await fresh("editor", { js: false });
    const page = await editor.newPage();
    const notice = async () => page.locator(".ibx-notice__title").first().textContent();
    await page.goto(`${BASE}/studio/pages`);
    await page.fill("#f-title", "Block editor page");
    await page.fill("#f-slug", `block-editor-${Date.now()}`);
    await page.fill("#f-body", JSON.stringify({ template: "article", blocks: [] }));
    await page.click("text=Create draft");
    expect(await notice()).toBe("Draft created");

    await page.selectOption("#f-block-type", "rich_text");
    await page.click('button:has-text("Add block")');
    expect(await notice()).toBe("Block added");
    await page.fill("#b-0-content", "## Why\n\nIt **works**.");
    await page.click('button:has-text("Save block 1")');
    expect(await notice()).toBe("Block saved");

    await page.selectOption("#f-block-type", "steps");
    await page.click('button:has-text("Add block")');
    expect(await notice()).toBe("Block added");
    await page.fill("#b-1-items-0-title", "Plan");
    await page.fill("#b-1-items-2-title", "Review");
    await page.fill("#b-1-items-2-text", "Someone else checks it.");
    await page.check("#b-1-items-1-remove");
    await page.click('button:has-text("Save block 2")');
    expect(await notice()).toBe("Block saved");
    expect(await page.inputValue("#b-1-items-1-title")).toBe("Review");

    // A service check comes back on the field it is about.
    await page.fill("#b-1-items-0-title", "");
    await page.fill("#b-1-items-0-text", "");
    await page.click('button:has-text("Save block 2")');
    expect(await notice()).toContain("IPB-CMS-001");
    expect(await page.locator("#b-1-items .ibx-field__error").count()).toBe(1);

    await page.click('button:has-text("Move block 2 up")');
    expect(await notice()).toBe("Block moved");
    await page.click('button:has-text("Remove block 2")');
    expect(await notice()).toBe("Block removed");
    const body = JSON.parse(await page.inputValue("#f-body")) as {
      blocks: { type: string; items: { title: string }[] }[];
    };
    expect(body.blocks.map((b) => b.type)).toEqual(["steps"]);
    expect(body.blocks[0]!.items.map((i) => i.title)).toEqual(["Plan", "Review"]);
    await editor.close();
  });
});
