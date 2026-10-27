// The footer validator's input for every published pack the site serves (IPB-04-71,
// `@IPB-04-AT-73`; PL5 plan §5.6). It reads the same published content, brand pack and policy set
// the shell renders, so `infrabyx-cms validate-footer` checks what visitors see.
import { footerInputFrom, type FooterInput } from "@infrabyx/cms";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import { listed, publishedPacks, type Site } from "./site.ts";

const ctx = {
  tenantId: PLATFORM_TENANT_ID,
  principal: { id: "svc_site_public", type: "service" as const, roles: [] },
};

/** Utilities the shell always renders (`render/shell.tsx`). */
const SHELL = {
  languageSwitch: true,
  cookieSettings: true,
  accessibility: true,
  sitemap: true,
  reportProblem: true,
} as const;

export async function footerInputs(site: Site, now = new Date()): Promise<FooterInput[]> {
  const packs = await publishedPacks(site);
  const out: FooterInput[] = [];
  for (const p of packs) {
    const rev = await site.brand.published(ctx, p.id);
    if (!rev) continue;
    const [published, officers, policies] = await Promise.all([
      Promise.all(
        (["footer", "nav_menu", "office"] as const).map((t) => listed(site, p.id, t)),
      ).then((l) => l.flat()),
      site.policies.officers(p.id),
      site.policies.index(p.id, site.env.APP_BASE_URL),
    ]);
    const le = rev.body.legal_entity;
    const keys = policies.policies.map((x) => x.key);
    out.push(
      footerInputFrom(
        published.map((x) => ({ type: x.type, body: x.body as Record<string, unknown> })),
        {
          pack: p.label,
          brand: { logo: Boolean(rev.body.logo?.svg), groupUrl: "/about" },
          legalEntity: {
            name: le.name,
            cin: le.cin,
            gstin: le.gstin,
            registeredOffice: le.registered_office,
          },
          officers: { grievance: officers.grievance, dpo: officers.dpo },
          // The shell links every effective policy in the "Policies" column.
          legal: { adopted: keys, linked: keys },
          shell: SHELL,
        },
        now,
      ),
    );
  }
  return out;
}
