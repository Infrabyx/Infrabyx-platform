// The gate journey of PL6 plan §8.2 (IPB-14 §14.5 item 2) on the Compose stack, in Chromium: a
// seeded tenant owner signs in through Keycloak (OIDC code flow with PKCE through the IDENTITY port,
// via the web app's origin), enrols the second factor their role requires, is refused until they
// sign in with it (@IPB-02-AT-02), then reads a CMS page, asks the assistant for a summary that
// waits for a checker, downloads the signed tenant export and opens the Trust Centre. Every page
// passes axe with no third-party request. Run by the `reference` job (IPB_TEST_WEB_URL).
// RFC 6238 TOTP is HMAC-SHA-1, which @infrabyx/crypto rightly does not offer; the test only plays
// the person's authenticator app against the local Keycloak (as the connectors' login driver does).
// eslint-disable-next-line ipb/no-direct-crypto
import { createHmac } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { sha256, toHex } from "@infrabyx/crypto";
import {
  axeScan,
  formatFindings,
  recordThirdPartyRequests,
  type GateFinding,
} from "@infrabyx/a11y/playwright";

const BASE = process.env["IPB_TEST_WEB_URL"] ?? "http://localhost:53127";
const CREDENTIALS = process.env["IPB_TEST_CREDENTIALS"] ?? "../../../SEED_CREDENTIALS.md";

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

/** The demo tenant's owner from the credentials file `pnpm dev:up` wrote (never committed). */
function owner(): { email: string; password: string } {
  for (const line of readFileSync(CREDENTIALS, "utf8").split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    // | label | role | email | password | tenant | envs |
    if (cells[2] === "ORG_OWNER" && cells[5]?.includes("demo"))
      return { email: cells[3]!, password: cells[4]! };
  }
  throw new Error(`no demo ORG_OWNER row in ${CREDENTIALS}`);
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s): the test plays the person's authenticator app. */
function totp(secret: Uint8Array, at = Date.now()): { code: string; step: number } {
  const step = Math.floor(at / 30_000);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", secret).update(msg).digest();
  const o = h[h.length - 1]! & 0x0f;
  return { code: String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0"), step };
}

const exe = findChromium();
let browser: Browser;
let ctx: BrowserContext;
let page: Page;
const findings: GateFinding[] = [];

/** Open a page of the web app and scan it (axe; no request to another origin). */
async function visit(path: string, route = path): Promise<void> {
  const rec = recordThirdPartyRequests(page, { origin: BASE });
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  findings.push(...(await axeScan(page, { route })));
  findings.push(...rec.findings({ route }));
  rec.stop();
}

/** Keycloak's login form, then whatever it asks next (enrolment or the code). */
async function keycloakLogin(p: Page, who: { email: string; password: string }) {
  await p.locator("#username").fill(who.email);
  await p.locator("#password").fill(who.password);
  await p.locator("#kc-login").click();
  await p.waitForLoadState("domcontentloaded");
}

describe.skipIf(!exe)("the gate journey (PL6 plan §8.2)", () => {
  const who = existsSync(CREDENTIALS) ? owner() : { email: "", password: "" };
  let secret = new Uint8Array();
  let enrolStep = 0;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: exe!, headless: true });
    ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    page = await ctx.newPage();
  });
  afterAll(async () => {
    await browser?.close();
  });

  it("@IPB-02-31 signs in through Keycloak and enrols the second factor the owner role needs", async () => {
    await visit("/", "/ (signed out)");
    expect(await page.getByRole("heading", { level: 1 }).textContent()).toBe(
      "Reference application",
    );
    await page.getByRole("link", { name: "Sign in" }).first().click();
    await page.waitForURL(/\/realms\/infrabyx-local\//);
    const authorize = new URL(page.url());
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${BASE}/auth/callback`);
    await keycloakLogin(page, who);
    // First sign-in of an MFA role: Keycloak asks for an authenticator (CONFIGURE_TOTP).
    const raw = await page.locator('input[name="totpSecret"]').getAttribute("value");
    expect(raw).toBeTruthy();
    secret = new TextEncoder().encode(raw!);
    const t = totp(secret);
    enrolStep = t.step;
    await page.locator("#totp").fill(t.code);
    if (await page.locator("#userLabel").count()) await page.locator("#userLabel").fill("journey");
    // Keycloak's save button on the authenticator setup page (`#saveTOTPBtn` in its login themes).
    await page.locator('#saveTOTPBtn, form#kc-totp-settings-form [type="submit"]').first().click();
    await page.waitForURL(`${BASE}/`);
  });

  it("@IPB-02-AT-02 the API refuses the enrolment session, which has no second factor yet", async () => {
    await visit("/", "/ (enrolment session)");
    await expect
      .poll(() => page.getByText("Your role needs a second factor").count())
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(`${BASE}/`);
    // A new browser session, so Keycloak asks for the password and the code again.
    await ctx.close();
    ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    page = await ctx.newPage();
  });

  it("signs in again with the authenticator code and the API accepts the owner", async () => {
    await page.goto(`${BASE}/auth/login`);
    await page.waitForURL(/\/realms\/infrabyx-local\//);
    await keycloakLogin(page, who);
    // A code is used once: wait for the next 30-second step after the enrolment code.
    while (Math.floor(Date.now() / 30_000) <= enrolStep)
      await new Promise((r) => setTimeout(r, 1_000));
    await page.locator("#otp").fill(totp(secret).code);
    await page.locator("#kc-login").click();
    await page.waitForURL(`${BASE}/`);
    await visit("/", "/ (signed in)");
    const signedIn = await page.getByTestId("signed-in").textContent();
    expect(signedIn).toContain("tnt_demo");
    expect(signedIn).toContain("ORG_OWNER");
    expect(signedIn).toContain("with a second factor");
  });

  it("sees the welcome page rendered from the CMS", async () => {
    await visit("/pages/welcome");
    expect(await page.getByRole("heading", { level: 1 }).textContent()).toBe("Welcome");
    expect(await page.locator(".ibx-prose").first().textContent()).toContain(
      "reference application",
    );
    expect(await page.title()).toBe("Welcome · Reference");
  });

  it("asks the assistant for a summary, which waits for a human checker (IPB-03)", async () => {
    await visit("/assistant");
    await page.getByRole("button", { name: "Summarise the greetings" }).click();
    await page.waitForURL(/\/assistant\?approval=apr_/);
    await visit(new URL(page.url()).pathname + new URL(page.url()).search, "/assistant (draft)");
    expect((await page.getByTestId("summary").textContent())?.trim().length).toBeGreaterThan(0);
    expect(await page.getByText("Waiting for a checker").count()).toBe(1);
  });

  it("downloads the tenant export, and the archive matches the digest the API signed (C-22)", async () => {
    await visit("/export");
    await page.getByRole("button", { name: "Export this tenant" }).click();
    await page.waitForURL(/\/export\?job=/);
    const jobUrl = page.url();
    for (let i = 0; i < 60; i++) {
      if (await page.getByRole("link", { name: "Download the archive" }).count()) break;
      await new Promise((r) => setTimeout(r, 1_000));
      await page.goto(jobUrl, { waitUntil: "networkidle" });
    }
    await visit(new URL(jobUrl).pathname + new URL(jobUrl).search, "/export (ready)");
    const href = await page
      .getByRole("link", { name: "Download the archive" })
      .getAttribute("href");
    expect(href).toMatch(/^\/export\/download\?archive=/);
    const signed = await page.request.get(`${BASE}${href}`, { maxRedirects: 0 });
    expect(signed.status()).toBe(303);
    const digest = signed.headers()["x-content-sha256"];
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    const archive = await page.request.get(signed.headers()["location"]!);
    expect(archive.status()).toBe(200);
    const body = await archive.body();
    expect(body.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(toHex(sha256(new Uint8Array(body)))).toBe(digest);
  });

  it("opens the Trust Centre and sees the mirrored public documents only", async () => {
    await visit("/trust");
    expect(await page.getByRole("heading", { name: "Sub-processor list" }).count()).toBe(1);
    expect(await page.getByRole("heading", { name: "SOC 2 Type II report" }).count()).toBe(0);
    expect(await page.getByText("can be shared under a non-disclosure agreement").count()).toBe(1);
  });

  it("@IPB-06-AT-01 every page of the journey passed axe with no third-party request", () => {
    expect(formatFindings(findings)).toBe("");
  });

  it("serves the CSP with a nonce and noindex on every page", async () => {
    const r = await page.request.get(`${BASE}/`);
    expect(r.headers()["content-security-policy"]).toMatch(
      /script-src 'nonce-[^']+' 'strict-dynamic'/,
    );
    expect(r.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  });
});
