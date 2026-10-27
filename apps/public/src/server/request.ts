// Per-request context, computed once per render with React's `cache` (PL5 plan §9.1, §9.4): the
// CSP nonce the proxy set, the brand pack for the host, the consent state from the first-party
// cookie and `Sec-GPC`, and the texts the banner shows.
import { cache } from "react";
import { cookies, headers } from "next/headers";
import type { Revision } from "@infrabyx/brand";
import {
  bannerState,
  CHOICE_COOKIE,
  CID_COOKIE,
  regionFor,
  type BannerState,
  type CmpTexts,
} from "@infrabyx/consent";
import type { ConsentRegion } from "@infrabyx/contracts/ports";
import { getSite, packFor, type Site } from "./site.ts";

export interface RequestContext {
  site: Site;
  nonce: string | undefined;
  host: string | null;
  packId: string;
  pack: Revision;
  noindex: boolean;
  region: ConsentRegion;
  consent: BannerState;
  cmpTexts: CmpTexts;
  bannerTextKey: string;
  bannerTextVersion: string;
  cid: string | undefined;
}

export const requestContext = cache(async (): Promise<RequestContext> => {
  const [h, c, site] = await Promise.all([headers(), cookies(), getSite()]);
  const host = h.get("host");
  const { packId, rev, noindex } = await packFor(site, host);
  const region = regionFor({
    packDefault: (rev.body.consent_config?.region_default as ConsentRegion | undefined) ?? "IN",
    geoDetect: false,
  });
  const text = async (key: string, fallback: string) =>
    (await site.texts.current(key, { region }))?.body ?? fallback;
  const banner = await site.texts.current("consent.cookie.banner", { region });
  const consent = bannerState({
    cookie: c.get(CHOICE_COOKIE)?.value,
    gpcHeader: h.get("sec-gpc"),
    region,
    bannerTextVersion: banner?.version ?? "1.0",
    reprompt: true,
  });
  return {
    site,
    nonce: h.get("x-nonce") ?? undefined,
    host,
    packId,
    pack: rev,
    noindex,
    region,
    consent,
    cmpTexts: {
      banner:
        banner?.body ??
        "We use cookies that are needed for the site to work. With your consent we also use optional cookies.",
      gpc: await text(
        "consent.cookie.gpc",
        "Your browser asked us not to share your data; we have switched optional tracking off.",
      ),
      categories: {
        necessary: await text("consent.cookie.category.necessary", "Needed for the site to work."),
        functional: await text("consent.cookie.category.functional", "Remember your choices."),
        analytics: await text(
          "consent.cookie.category.analytics",
          "Count visits to improve the site.",
        ),
        marketing: await text("consent.cookie.category.marketing", "Measure campaigns."),
      },
    },
    bannerTextKey: "consent.cookie.banner",
    bannerTextVersion: banner?.version ?? "1.0",
    cid: c.get(CID_COOKIE)?.value,
  };
});
