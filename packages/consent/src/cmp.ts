// The consent management platform, server side (IPB-04 §04.3.9; `@IPB-04-AT-80`…`-86`; owner rule
// O-2; PL5 plan §6.2–§6.3). Pure logic: regions and wording, the banner state with GPC and
// re-prompt, the choice for each action, the first-party cookies, the cookie registry shared with
// the Cookie Policy, the locked sensitive routes, and script gating where the server never renders
// an active third-party tag. `handleConsentPost` records a choice through the CONSENT port.
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  ConsentChoice,
  ConsentPort,
  ConsentRegion,
  GatedScript,
  PortHealth,
  TagManagerPort,
  AnalyticsPort,
} from "@infrabyx/contracts/ports";
import { randomBytes } from "@infrabyx/crypto";

export const CONSENT_CATEGORIES = ["necessary", "functional", "analytics", "marketing"] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];
export const CID_COOKIE = "ibx_cid";
export const CHOICE_COOKIE = "ibx_consent";

/** First-party cookies (IPB-04-76): one registry for the preference centre and the Cookie Policy table. */
export const COOKIE_REGISTRY: readonly {
  name: string;
  category: ConsentCategory;
  purpose: string;
  duration: string;
  provider: string;
}[] = [
  {
    name: CID_COOKIE,
    category: "necessary",
    purpose: "An anonymous id that links your cookie choices to their consent record.",
    duration: "12 months",
    provider: "First party",
  },
  {
    name: CHOICE_COOKIE,
    category: "necessary",
    purpose: "Remembers your cookie choices and the banner version you saw.",
    duration: "12 months",
    provider: "First party",
  },
  {
    name: "ibx_lang",
    category: "functional",
    purpose: "Remembers the language you chose.",
    duration: "12 months",
    provider: "First party",
  },
];
/** Third-party vendors by category; none at launch (no tag manager, no analytics; OWN-09). */
export const VENDORS: readonly {
  name: string;
  category: Exclude<ConsentCategory, "necessary">;
  purpose: string;
  policyUrl: string;
}[] = [];

const EU_EEA_UK = new Set(
  "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB CH".split(
    " ",
  ),
);

/** The wording region (IPB-04-81): the pack default, or the edge country when geo detection is on. */
export function regionFor(o: {
  packDefault?: ConsentRegion;
  geoDetect: boolean;
  country?: string | null;
  subdivision?: string | null;
}): ConsentRegion {
  if (!o.geoDetect || !o.country) return o.packDefault ?? "IN";
  const c = o.country.toUpperCase();
  if (c === "IN") return "IN";
  if (EU_EEA_UK.has(c)) return "EU";
  if (c === "US" && (o.subdivision ?? "").toUpperCase().replace(/^US-/, "") === "CA")
    return "US-CA";
  return "OTHER";
}

export interface StoredChoice {
  choice: ConsentChoice;
  textVersion: string;
  receiptId: string;
}

/** `ibx_consent` = `v1.<banner text version>.<f><a><m>.<receipt>`; anything else is ignored. */
export const encodeChoice = (s: StoredChoice) =>
  `v1.${s.textVersion}.${[s.choice.functional, s.choice.analytics, s.choice.marketing].map((b) => (b ? 1 : 0)).join("")}.${s.receiptId}`;

export function decodeChoice(raw: string | undefined | null): StoredChoice | null {
  const m = /^v1\.(\d+\.\d+)\.([01])([01])([01])\.(cns_[0-7][0-9A-HJKMNP-TV-Z]{25})$/.exec(
    raw ?? "",
  );
  if (!m) return null;
  return {
    textVersion: m[1]!,
    choice: { functional: m[2] === "1", analytics: m[3] === "1", marketing: m[4] === "1" },
    receiptId: m[5]!,
  };
}

export const newCid = () => Buffer.from(randomBytes(16)).toString("base64url");

export const REJECT_ALL: ConsentChoice = { functional: false, analytics: false, marketing: false };
export const ACCEPT_ALL: ConsentChoice = { functional: true, analytics: true, marketing: true };

export interface BannerState {
  /** Show the banner: no valid choice yet, or the banner text version changed (re-prompt). */
  show: boolean;
  region: ConsentRegion;
  /** The choice in force: the stored one, or the default (all off; GPC keeps analytics and marketing off). */
  choice: ConsentChoice;
  /** `Sec-GPC: 1` was received and honoured (IPB-04-77). */
  gpc: boolean;
  /** CCPA/CPRA "Do Not Sell or Share" control (IPB-04-81). */
  doNotSell: boolean;
  /** On authenticated app routes marketing is never asked (IPB-04-82). */
  categories: readonly ConsentCategory[];
}

export function bannerState(o: {
  cookie: string | null | undefined;
  gpcHeader: string | null | undefined;
  region: ConsentRegion;
  bannerTextVersion: string;
  reprompt: boolean;
  authenticated?: boolean;
}): BannerState {
  const stored = decodeChoice(o.cookie);
  const gpc = o.gpcHeader?.trim() === "1";
  const stale = stored && o.reprompt && stored.textVersion !== o.bannerTextVersion;
  const base = stored?.choice ?? REJECT_ALL;
  const choice = gpc && !stored ? { ...base, analytics: false, marketing: false } : base;
  const categories = o.authenticated
    ? (["necessary", "functional", "analytics"] as const)
    : CONSENT_CATEGORIES;
  return {
    show: !stored || Boolean(stale),
    region: o.region,
    choice: o.authenticated ? { ...choice, marketing: false } : choice,
    gpc,
    doNotSell: o.region === "US-CA",
    categories,
  };
}

export type CmpAction = "accept_all" | "reject_all" | "close" | "save";

/** The choice for an action. Closing or Escape is Reject for every non-necessary category (IPB-04-75). */
export function decide(
  action: CmpAction,
  saved?: Partial<ConsentChoice>,
  o: { authenticated?: boolean } = {},
): ConsentChoice {
  const c =
    action === "accept_all"
      ? ACCEPT_ALL
      : action === "save"
        ? {
            functional: saved?.functional === true,
            analytics: saved?.analytics === true,
            marketing: saved?.marketing === true,
          }
        : REJECT_ALL;
  return o.authenticated ? { ...c, marketing: false } : c;
}

export interface CookieOptions {
  ttlDays: number;
  secure?: boolean;
}

/** First-party, `Secure`, `SameSite=Lax`, readable by the controller (not HttpOnly), 12 months by default. */
export function consentCookies(cid: string, stored: StoredChoice, o: CookieOptions): string[] {
  const attrs = `Path=/; Max-Age=${o.ttlDays * 86_400}; SameSite=Lax${o.secure === false ? "" : "; Secure"}`;
  return [`${CID_COOKIE}=${cid}; ${attrs}`, `${CHOICE_COOKIE}=${encodeChoice(stored)}; ${attrs}`];
}

export interface ConsentPostRequest {
  action: CmpAction | "manage";
  categories?: Partial<Record<"functional" | "analytics" | "marketing", string | boolean>>;
  cookies: Readonly<Record<string, string | undefined>>;
  headers: Readonly<Record<string, string | undefined>>;
  region: ConsentRegion;
  brandPackId?: string;
  bannerTextKey: string;
  bannerTextVersion: string;
  policyVersion?: string;
  authenticated?: boolean;
  fromPreferenceCentre?: boolean;
  uaClass?: string;
}

export interface ConsentPostResult {
  status: 200 | 303;
  setCookies: string[];
  location?: string;
  receiptId?: string;
  choice?: ConsentChoice;
}

/**
 * The consent endpoint (`POST /api/consent`, also the no-JavaScript form target). Every choice is
 * a new ledger record (IPB-04-78); `manage` sends the browser to the preference centre. When the
 * ledger is unreachable the choice is not recorded and nothing non-necessary runs (`IPB-WEB-001`).
 */
export async function handleConsentPost(
  ledger: ConsentPort,
  req: ConsentPostRequest,
  o: CookieOptions & { preferencePath?: string },
): Promise<ConsentPostResult> {
  if (req.action === "manage")
    return { status: 303, setCookies: [], location: o.preferencePath ?? "/cookie-settings" };
  const on = (v: unknown) => v === true || v === "on" || v === "true" || v === "1";
  const choice = decide(
    req.action,
    {
      functional: on(req.categories?.functional),
      analytics: on(req.categories?.analytics),
      marketing: on(req.categories?.marketing),
    },
    { authenticated: req.authenticated ?? false },
  );
  const cid = /^[A-Za-z0-9_-]{16,64}$/.test(req.cookies[CID_COOKIE] ?? "")
    ? req.cookies[CID_COOKIE]!
    : newCid();
  let receipt;
  try {
    receipt = await ledger.recordConsent({
      cid,
      ...(req.brandPackId ? { brandPackId: req.brandPackId } : {}),
      method: req.fromPreferenceCentre ? "PREFERENCE_CENTRE" : "CMP_BANNER",
      choice,
      textKey: req.bannerTextKey,
      textVersion: req.bannerTextVersion,
      ...(req.policyVersion ? { policyVersion: req.policyVersion } : {}),
      region: req.region,
      gpc: req.headers["sec-gpc"]?.trim() === "1",
      ...(req.uaClass ? { uaClass: req.uaClass } : {}),
    });
  } catch (e) {
    if (e instanceof IpbError) throw e;
    throw new IpbError("IPB-WEB-001", { cause: e });
  }
  const setCookies = consentCookies(
    cid,
    { choice, textVersion: req.bannerTextVersion, receiptId: receipt.receiptId },
    o,
  );
  return { status: 200, setCookies, receiptId: receipt.receiptId, choice };
}

// --- Script gating (IPB-04-79, 04-82, 04-87; `@IPB-04-AT-83`, `-85`, `-86`) -------------------

/** The locked sensitive routes (`mkt.sensitive_routes`); products may add, never remove. */
export const LOCKED_SENSITIVE_ROUTES = [
  "/contact",
  "/careers/*/apply",
  "/grievance",
  "/dpa-request",
  "/resources/*/download",
  "/trust/request",
] as const;

const globRe = (g: string) =>
  new RegExp(
    `^${g
      .split("*")
      .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join("[^/]+")}/?$`,
  );

export function isSensitiveRoute(path: string, additions: readonly string[] = []): boolean {
  return [...LOCKED_SENSITIVE_ROUTES, ...additions].some((g) => globRe(g).test(path));
}

const none = async (): Promise<PortHealth> => ({
  status: "up",
  latency_ms: 0,
  checked_at: new Date().toISOString(),
});

/** The `none` tag manager (OWN-09): nothing to place, ever. */
export class NoneTagManager implements TagManagerPort {
  readonly descriptor = {
    port: "TAG_MANAGER",
    adapter: "none",
    residency: "IN" as const,
    maxDataClass: "PUBLIC" as const,
  };
  health = none;
  scripts(): GatedScript[] {
    return [];
  }
}

/** The `none` analytics adapter (OWN-09): drops every event. */
export class NoneAnalytics implements AnalyticsPort {
  readonly descriptor = {
    port: "ANALYTICS",
    adapter: "none",
    residency: "IN" as const,
    maxDataClass: "PUBLIC" as const,
  };
  health = none;
  async track(): Promise<void> {}
}

export interface GatingContext {
  path: string;
  authenticated: boolean;
  consent: ConsentChoice;
  sensitiveAdditions?: readonly string[];
  /** A security event for a blocked tag (`IPB-WEB-005`). */
  onBlocked?: (e: { code: "IPB-WEB-005"; path: string; category: string; src: string }) => void;
}

/**
 * The scripts a page may declare (never active in the server HTML). Marketing tags never render on
 * sensitive or authenticated routes, and an attempt is reported as `IPB-WEB-005`.
 */
export function gatedScripts(tagManager: TagManagerPort, g: GatingContext): GatedScript[] {
  const sensitive = isSensitiveRoute(g.path, g.sensitiveAdditions ?? []);
  const out: GatedScript[] = [];
  for (const s of tagManager.scripts(g.consent, { pattern: g.path, sensitive })) {
    if (s.category === "marketing" && (sensitive || g.authenticated)) {
      g.onBlocked?.({ code: "IPB-WEB-005", path: g.path, category: s.category, src: s.src });
      continue;
    }
    out.push(s);
  }
  return out;
}

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * Inert script declarations: `type="text/plain"` with the category; the first-party controller
 * activates them after consent. The server never renders an active third-party tag (IPB-04-79).
 */
export const renderGatedScripts = (scripts: readonly GatedScript[]) =>
  scripts
    .map(
      (s) =>
        `<script type="text/plain" data-consent="${attr(s.category)}" data-src="${attr(s.src)}"${s.async ? " data-async" : ""}></script>`,
    )
    .join("");
