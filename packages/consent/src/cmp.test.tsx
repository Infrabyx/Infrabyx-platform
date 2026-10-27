// The CMP, server side (IPB-04 §04.3.9; PL5 plan §6.2–§6.3).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  bannerState,
  CMP_CONTROLLER_JS,
  CookieBanner,
  decide,
  decodeChoice,
  encodeChoice,
  gatedScripts,
  isSensitiveRoute,
  NoneTagManager,
  PACKAGE_NAME,
  PreferenceCentre,
  regionFor,
  renderGatedScripts,
  type CmpTexts,
} from "./index.js";
import type { TagManagerPort } from "@infrabyx/contracts/ports";

const texts: CmpTexts = {
  banner: "We use cookies.",
  gpc: "Your browser sent a privacy signal.",
  categories: { necessary: "N", functional: "F", analytics: "A", marketing: "M" },
};
const RECEIPT = "cns_01JB0000000000000000000001";
const state = (o: Partial<Parameters<typeof bannerState>[0]> = {}) =>
  bannerState({
    cookie: null,
    gpcHeader: null,
    region: "IN",
    bannerTextVersion: "1.0",
    reprompt: true,
    ...o,
  });

describe("consent", () => {
  it("exports its package name", () => expect(PACKAGE_NAME).toBe("@infrabyx/consent"));
});

describe("@IPB-04-AT-80 CMP equal prominence", () => {
  it("renders Accept all, Reject all and Manage as the same control with the same classes, in one form", () => {
    const html = renderToStaticMarkup(<CookieBanner state={state()} texts={texts} />);
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((b) => ({
      cls: /class="([^"]+)"/.exec(b[0])?.[1],
      value: /value="(\w+)"/.exec(b[0])?.[1],
      type: /type="(\w+)"/.exec(b[0])?.[1],
    }));
    expect(buttons.map((b) => b.value)).toEqual(["accept_all", "reject_all", "manage"]);
    expect(new Set(buttons.map((b) => `${b.cls}|${b.type}`)).size).toBe(1);
    expect(html).toContain('role="region"');
    expect(html).toMatch(/<form(?=[^>]*method="post")(?=[^>]*action="\/api\/consent")[^>]*>/);
  });

  it("closing or Escape records Reject for every non-necessary category", () => {
    expect(decide("close")).toEqual({ functional: false, analytics: false, marketing: false });
    expect(decide("reject_all")).toEqual({ functional: false, analytics: false, marketing: false });
    expect(decide("accept_all")).toEqual({ functional: true, analytics: true, marketing: true });
    expect(CMP_CONTROLLER_JS).toContain('e.key !== "Escape"');
  });

  it("the preference centre reopens with the current choices and offers Reject all as easily as Accept all", () => {
    const stored = encodeChoice({
      choice: { functional: true, analytics: false, marketing: false },
      textVersion: "1.0",
      receiptId: RECEIPT,
    });
    const html = renderToStaticMarkup(
      <PreferenceCentre state={state({ cookie: stored })} texts={texts} />,
    );
    expect(html).toMatch(/id="ibx-cmp-functional"[^>]*checked/);
    expect(html).not.toMatch(/id="ibx-cmp-analytics"[^>]*checked/);
    expect(html).toContain('value="reject_all"');
    expect(html).toContain("ibx_cid");
  });
});

describe("@IPB-04-AT-81 GPC", () => {
  it("defaults analytics and marketing to rejected and says a privacy signal was honoured", () => {
    const s = state({ gpcHeader: "1" });
    expect(s).toMatchObject({
      show: true,
      gpc: true,
      choice: { analytics: false, marketing: false },
    });
    expect(renderToStaticMarkup(<CookieBanner state={s} texts={texts} />)).toContain(
      "Your browser sent a privacy signal.",
    );
  });
});

describe("@IPB-04-AT-82 re-prompt (server side)", () => {
  it("hides the banner for a stored choice of the current version and re-prompts after a version bump", () => {
    const stored = encodeChoice({
      choice: { functional: false, analytics: true, marketing: false },
      textVersion: "1.0",
      receiptId: RECEIPT,
    });
    expect(decodeChoice(stored)).toMatchObject({ textVersion: "1.0", receiptId: RECEIPT });
    expect(state({ cookie: stored }).show).toBe(false);
    expect(state({ cookie: stored, bannerTextVersion: "1.1" }).show).toBe(true);
    expect(decodeChoice("v1.1.0.111.not-a-receipt")).toBeNull();
  });
});

describe("@IPB-04-AT-84 region wording", () => {
  it("uses GDPR wording for Germany and a Do Not Sell or Share control for California", () => {
    expect(regionFor({ geoDetect: true, country: "DE" })).toBe("EU");
    expect(regionFor({ geoDetect: true, country: "US", subdivision: "CA" })).toBe("US-CA");
    expect(regionFor({ geoDetect: false, country: "DE", packDefault: "IN" })).toBe("IN");
    const html = renderToStaticMarkup(
      <CookieBanner state={state({ region: "US-CA" })} texts={texts} />,
    );
    expect(html).toContain("Do Not Sell or Share My Personal Information");
    expect(
      renderToStaticMarkup(<CookieBanner state={state({ region: "EU" })} texts={texts} />),
    ).toContain('value="reject_all"');
  });
});

describe("@IPB-04-AT-85 no marketing on authenticated routes", () => {
  it("never asks for or grants marketing in an app", () => {
    const s = state({ authenticated: true });
    expect(s.categories).toEqual(["necessary", "functional", "analytics"]);
    expect(decide("accept_all", undefined, { authenticated: true }).marketing).toBe(false);
    expect(renderToStaticMarkup(<PreferenceCentre state={s} texts={texts} />)).not.toContain(
      "ibx-cmp-marketing",
    );
  });
});

describe("@IPB-04-AT-83 / @IPB-04-AT-86 script gating", () => {
  const pixel: TagManagerPort = {
    descriptor: { port: "TAG_MANAGER", adapter: "test", residency: "IN", maxDataClass: "PUBLIC" },
    health: async () => ({ status: "up", latency_ms: 0, checked_at: "" }),
    scripts: () => [
      { category: "marketing", src: "https://pixel.example.net/p.js" },
      { category: "analytics", src: "https://analytics.example.org/a.js" },
    ],
  };
  const all = { functional: true, analytics: true, marketing: true };

  it("never renders an active third-party tag; declarations are inert text/plain", () => {
    const html = renderGatedScripts(
      gatedScripts(pixel, { path: "/about", authenticated: false, consent: all }),
    );
    expect(html).toBe(
      '<script type="text/plain" data-consent="marketing" data-src="https://pixel.example.net/p.js"></script><script type="text/plain" data-consent="analytics" data-src="https://analytics.example.org/a.js"></script>',
    );
    expect(html).not.toMatch(/<script(?![^>]*type="text\/plain")/);
    expect(
      gatedScripts(new NoneTagManager(), { path: "/", authenticated: false, consent: all }),
    ).toEqual([]);
  });

  it("drops a pixel on a sensitive route and logs IPB-WEB-005", () => {
    const blocked: string[] = [];
    const out = gatedScripts(pixel, {
      path: "/contact",
      authenticated: false,
      consent: all,
      onBlocked: (e) => blocked.push(`${e.code} ${e.path}`),
    });
    expect(out.map((s) => s.category)).toEqual(["analytics"]);
    expect(blocked).toEqual(["IPB-WEB-005 /contact"]);
    expect(isSensitiveRoute("/careers/engineer/apply")).toBe(true);
    expect(isSensitiveRoute("/careers")).toBe(false);
    expect(isSensitiveRoute("/partners/apply", ["/partners/*"])).toBe(true);
  });
});
