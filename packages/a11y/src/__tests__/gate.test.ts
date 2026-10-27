// Browser checks against a real Chromium. The `a11y` CI job provides one; elsewhere the suite runs
// when a Chromium is found (IPB_CHROMIUM, the Playwright cache or a system Chrome) and is skipped
// with that reason otherwise.
import { existsSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { IpbError } from "@infrabyx/contracts/errors";
import {
  assertGate,
  axeScan,
  focusVisibleCheck,
  htmlcsScan,
  recordThirdPartyRequests,
  reflowCheck,
  skipLinkFirst,
  textScaleCheck,
  textSpacingCheck,
} from "../playwright/index.js";

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
  return ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(
    existsSync,
  );
}

const exe = findChromium();
const CSP =
  "default-src 'self'; script-src 'self' 'nonce-t3st'; style-src 'self'; img-src 'self' data:";
const STYLE = `
  body { margin: 0; font: 16px/1.5 sans-serif; }
  .skip { position: absolute; left: -9999px; }
  .skip:focus { left: 0; }
  a:focus-visible, button:focus-visible, input:focus-visible { outline: 2px solid #1d4ed8; outline-offset: 2px; }
  button { min-width: 44px; min-height: 44px; }
`;
const page = (body: string, extra = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Privacy · Settings · Example</title>` +
  `<link rel="stylesheet" href="/s.css"></head><body>` +
  `<a class="skip" href="#main">Skip to main content</a><header><nav aria-label="Main"><a href="/">Home</a></nav></header>` +
  `<main id="main" tabindex="-1"><h1>Privacy</h1>${body}</main>${extra}</body></html>`;

let browser: Browser;
let p: Page;

describe.skipIf(!exe)(
  `browser gate helpers (${exe ?? "no Chromium found; set IPB_CHROMIUM"})`,
  () => {
    beforeAll(async () => {
      browser = await chromium.launch({ executablePath: exe! });
    });
    afterAll(async () => {
      await browser?.close();
    });

    async function open(html: string, css = STYLE): Promise<Page> {
      p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await p.route("http://site.test/**", (r) => {
        const url = new URL(r.request().url());
        if (url.pathname === "/s.css") return r.fulfill({ contentType: "text/css", body: css });
        return r.fulfill({
          contentType: "text/html",
          headers: { "content-security-policy": CSP },
          body: html,
        });
      });
      await p.route("https://third.example/**", (r) =>
        r.fulfill({ contentType: "text/javascript", body: "" }),
      );
      await p.goto("http://site.test/settings/privacy");
      return p;
    }

    describe("@IPB-06-AT-01 automated accessibility gate", () => {
      it("a button with no accessible name fails with IPB-A11Y-004 naming button-name and the route", async () => {
        const pg = await open(page(`<button></button>`));
        const f = await axeScan(pg, { theme: "light" });
        expect(f.map((x) => x.rule)).toContain("button-name");
        expect(f[0]).toMatchObject({
          code: "IPB-A11Y-004",
          route: "/settings/privacy",
          theme: "light",
        });
        let err: unknown;
        try {
          assertGate(f.filter((x) => x.rule === "button-name"));
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(IpbError);
        expect((err as IpbError).code).toBe("IPB-A11Y-004");
        expect((err as Error).message).toContain("button-name on /settings/privacy");
        await pg.close();
      });

      it("a clean page passes axe and HTML_CodeSniffer under a nonce CSP", async () => {
        const pg = await open(
          page(`<p>Choose what we may store.</p><button type="button">Save</button>`),
        );
        expect(await axeScan(pg)).toEqual([]);
        expect(await htmlcsScan(pg)).toEqual([]);
        await pg.close();
      });
    });

    it("HTML_CodeSniffer reports an unlabelled input as an error", async () => {
      const pg = await open(page(`<form><input type="text"></form>`));
      const f = await htmlcsScan(pg);
      expect(f.some((x) => x.rule.includes("4_1_2") && x.check === "htmlcs")).toBe(true);
      await pg.close();
    });

    it("checks the skip link, reflow, text scale, text spacing and focus visibility", async () => {
      const good = await open(page(`<p>Text</p><button type="button">Save</button>`));
      expect(await skipLinkFirst(good)).toEqual([]);
      expect(await reflowCheck(good)).toEqual([]);
      expect(await textScaleCheck(good)).toEqual([]);
      expect(await textSpacingCheck(good)).toEqual([]);
      expect(await focusVisibleCheck(good)).toEqual([]);
      await good.close();

      const bad = await open(
        `<!doctype html><html lang="en"><head><title>x</title><link rel="stylesheet" href="/s.css"></head><body>` +
          `<main><button type="button" class="b">Save</button><div class="wide">wide</div>` +
          `<div class="box">This sentence is long enough to be clipped</div></main></body></html>`,
        "body{margin:0} .wide{width:600px} .b{outline:none} .b:focus{outline:none} .box{width:200px;height:24px;overflow:hidden;font-size:16px;line-height:24px}",
      );
      expect((await skipLinkFirst(bad))[0]!.rule).toBe("skip-link-first");
      expect((await reflowCheck(bad))[0]!.detail).toMatch(/600 px wide/);
      expect((await textScaleCheck(bad))[0]!.targets).toContain("div.box");
      expect((await focusVisibleCheck(bad)).map((x) => x.rule)).toContain("focus-visible");
      await bad.close();
    });

    it("records requests outside the site's origin", async () => {
      p = await browser.newPage();
      const rec = recordThirdPartyRequests(p, { origin: "http://site.test" });
      await p.route("http://site.test/**", (r) =>
        r.fulfill({
          contentType: "text/html",
          body: page(`<p>x</p>`, `<script src="https://third.example/t.js"></script>`),
        }),
      );
      await p.route("https://third.example/**", (r) =>
        r.fulfill({ contentType: "text/javascript", body: "" }),
      );
      await p.goto("http://site.test/");
      expect(rec.requests()).toEqual(["https://third.example/t.js"]);
      expect(rec.findings({ route: "/" })[0]).toMatchObject({
        rule: "third-party-request",
        targets: ["https://third.example"],
      });
      rec.stop();
      await p.close();
    });
  },
);
