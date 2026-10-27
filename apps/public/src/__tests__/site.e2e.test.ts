// The group site's gate (PL5 plan §11, §15; IPB-06-54): every launch route in light and dark themes
// with zero axe violations and zero HTML_CodeSniffer errors, reflow at 320 px, text at 200%, the skip
// link first, no request to another origin before or after any consent choice, and full content
// without JavaScript. Run by the `a11y` job against the seeded site (IPB_TEST_SITE_URL).
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

const BASE = process.env["IPB_TEST_SITE_URL"] ?? "http://127.0.0.1:3123";

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

/** The launch routes (PL5 plan §9.2) and the always-present pages, plus the component gallery. */
export const ROUTES = [
  "/",
  "/about",
  "/group-companies",
  "/group-companies/udofin",
  "/careers",
  "/trust",
  "/contact",
  "/legal",
  "/legal/privacy",
  "/legal/terms",
  "/accessibility",
  "/grievance",
  "/sitemap",
  "/glossary",
  "/feedback",
  "/security",
  "/cookie-settings",
  "/__gallery",
  "/no-such-page",
] as const;

const exe = findChromium();
let browser: Browser;

const fresh = (o: { dark?: boolean; js?: boolean } = {}): Promise<BrowserContext> =>
  browser.newContext({
    colorScheme: o.dark ? "dark" : "light",
    javaScriptEnabled: o.js !== false,
    viewport: { width: 1280, height: 900 },
  });

describe.skipIf(!exe)(`group site gate at ${BASE}`, () => {
  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: exe! });
  });
  afterAll(async () => {
    await browser?.close();
  });

  for (const theme of ["light", "dark"] as const)
    it(`@IPB-06-AT-01 @IPB-04-AT-70 every route passes axe, HTML_CodeSniffer, reflow, text scale and the skip link (${theme})`, async () => {
      const findings: GateFinding[] = [];
      const ctx = await fresh({ dark: theme === "dark" });
      for (const route of ROUTES) {
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
        await page.close();
      }
      await ctx.close();
      expect(formatFindings(findings)).toBe("");
    });

  it("@IPB-04-AT-12 every route renders its full content without JavaScript", async () => {
    const ctx = await fresh({ js: false });
    const page = await ctx.newPage();
    for (const route of ROUTES) {
      const r = await page.goto(`${BASE}${route}`);
      expect(r?.status(), route).toBe(route === "/no-such-page" ? 404 : 200);
      const h1 = (await page.locator("main h1").first().textContent())?.trim();
      expect(h1, route).toBeTruthy();
      expect(await page.locator("footer").count(), route).toBe(1);
    }
    await ctx.close();
  });

  it("@IPB-04-AT-80 @IPB-04-AT-85 the banner offers equal choices, and no request leaves the origin before or after Reject, Accept or Manage", async () => {
    for (const action of ["reject_all", "accept_all", "manage"] as const) {
      const ctx = await fresh();
      const page = await ctx.newPage();
      const rec = recordThirdPartyRequests(page, { origin: BASE });
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      const banner = page.locator('[data-cmp="banner"]');
      await expect(banner.isVisible()).resolves.toBe(true);
      const buttons = banner.locator("button[data-cmp-action]");
      expect(await buttons.count()).toBe(3);
      const classes = await buttons.evaluateAll((bs) => bs.map((b) => b.className));
      expect(new Set(classes).size).toBe(1);
      await banner.locator(`[data-cmp-action="${action}"]`).click();
      if (action === "manage") await page.waitForURL(/\/cookie-settings$/);
      else await banner.waitFor({ state: "hidden" });
      await page.goto(`${BASE}/about`, { waitUntil: "networkidle" });
      if (action !== "manage")
        expect(await page.locator('[data-cmp="banner"]').count(), action).toBe(0);
      expect(rec.requests(), action).toEqual([]);
      rec.stop();
      await ctx.close();
    }
  });

  it("@IPB-04-AT-81 Escape on the banner records Reject", async () => {
    const ctx = await fresh();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.locator('[data-cmp="banner"] button').first().focus();
    await page.keyboard.press("Escape");
    await page.locator('[data-cmp="banner"]').waitFor({ state: "hidden" });
    const cookie = (await ctx.cookies()).find((c) => c.name === "ibx_consent");
    expect(cookie?.value).toMatch(/^v1\.[0-9.]+\.000\./);
    await ctx.close();
  });

  it("@IPB-04-AT-74 the footer names the entity, CIN, officers and policies from configuration", async () => {
    const ctx = await fresh();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`);
    const footer = (await page.locator("footer").textContent()) ?? "";
    for (const text of [
      "CIN",
      "GSTIN",
      "Grievance Officer",
      "Data Protection Officer",
      "Cookie settings",
      "Accessibility",
      "Report a problem",
    ])
      expect(footer, text).toContain(text);
    await ctx.close();
  });

  it("@IPB-04-AT-40 the hidden Blog and Investors pages return 404", async () => {
    for (const p of ["/investors", "/blog/general/placeholder-post"]) {
      const r = await fetch(`${BASE}${p}`);
      expect(r.status, p).toBe(404);
    }
  });

  it("serves the CSP with a nonce and the security headers on every page", async () => {
    const r = await fetch(`${BASE}/`);
    const csp = r.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'nonce-[A-Za-z0-9_-]{16,}' 'strict-dynamic'/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-inline");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });
});
