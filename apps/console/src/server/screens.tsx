// Which screen each Studio route renders (PL5 plan §9.6). Lists live at `/studio/<section>`,
// editors at `/studio/<section>/<id>`; each screen gets the package service, the session's
// context and its form actions.
import {
  BLOCK_EDITOR,
  MANDATORY_POLICY_KEYS,
  SELLING_POLICY_KEYS,
  policyTemplate,
} from "@infrabyx/cms";
import {
  ApprovalsScreen,
  BrandEditScreen,
  BrandListScreen,
  ClaimsScreen,
  CONTENT_SECTION_TYPES,
  ConsentTextsScreen,
  ContentEditScreen,
  ContentListScreen,
  FeedbackScreen,
  MediaScreen,
  PoliciesScreen,
  PolicyEditScreen,
  PreviewsScreen,
  PricingScreen,
  RedirectsScreen,
  ResourceVersionsPanel,
  STUDIO_SECTIONS,
  TrustDocumentsScreen,
  type FieldError,
  type Flash,
  type StudioSection,
} from "@infrabyx/ui/studio";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import { actionUrl, STUDIO_BASE } from "./actions.ts";
import type { Console } from "./console.ts";

export interface RouteState {
  ctx: KernelContext;
  sections: readonly StudioSection[];
  flash: Flash | null;
  errors: FieldError[];
  reveal?: string | undefined;
  query: Readonly<Record<string, string | undefined>>;
}

const TITLES = Object.fromEntries(STUDIO_SECTIONS.map((s) => [s.key, s.label])) as Record<
  StudioSection,
  string
>;
export const isSection = (v: string): v is StudioSection => v in TITLES;
const CONTENT_SECTIONS = ["pages", "menus", "footer", "resources", "forms"] as const;
type ContentSection = (typeof CONTENT_SECTIONS)[number];
const isContent = (s: StudioSection): s is ContentSection =>
  (CONTENT_SECTIONS as readonly string[]).includes(s);

const BRAND_PRODUCTS = ["GRP", "OH", "LD", "LDC", "EQ", "FBX", "UDF"] as const;

/** The packs to choose from and the one the list shows (`?pack=`, else the first default). */
async function packs(c: Console, s: RouteState) {
  const all = await c.brand.packs(s.ctx);
  const options = all.map((k) => ({ id: k.id, label: `${k.label} (${k.product})` }));
  const chosen =
    all.find((k) => k.id === s.query["pack"]) ?? all.find((k) => k.isDefault) ?? all[0];
  return { options, packId: chosen?.id ?? "" };
}

const templates = () =>
  [...MANDATORY_POLICY_KEYS, ...SELLING_POLICY_KEYS].map((key) => ({
    key,
    title: policyTemplate(key).title,
  }));

export async function listScreen(c: Console, section: StudioSection, s: RouteState) {
  const common = {
    ctx: s.ctx,
    base: STUDIO_BASE,
    flash: s.flash,
    errors: s.errors,
    sections: s.sections,
  };
  const a = (name: string) => actionUrl(section, name);
  switch (section) {
    case "approvals": {
      const { options } = await packs(c, s);
      return ApprovalsScreen({
        ...common,
        cms: c.cms,
        brand: c.brand,
        packs: options,
        policies: c.policies,
        texts: c.texts,
      });
    }
    case "brand":
      return BrandListScreen({
        ...common,
        brand: c.brand,
        products: BRAND_PRODUCTS,
        actions: { create: a("create") },
      });
    case "pricing": {
      const p = await packs(c, s);
      return PricingScreen({
        ...common,
        cms: c.cms,
        packs: p.options,
        packId: p.packId,
        catalogue: (id) => c.pricing.catalogue(id),
      });
    }
    case "policies": {
      const p = await packs(c, s);
      return PoliciesScreen({
        ...common,
        policies: c.policies,
        packs: p.options,
        packId: p.packId,
        templates: templates(),
        actions: { createSet: a("createSet"), params: a("params"), draft: a("draft") },
      });
    }
    case "redirects": {
      const p = await packs(c, s);
      return RedirectsScreen({
        ...common,
        cms: c.cms,
        packs: p.options,
        packId: p.packId,
        actions: { add: a("add"), review: a("review"), import: a("import") },
      });
    }
    case "media":
      return MediaScreen({
        ...common,
        media: c.media,
        missingAlt: s.query["missingAlt"] === "1",
        actions: { upload: a("upload"), describe: a("describe"), remove: a("remove") },
      });
    case "claims":
      return ClaimsScreen({
        ...common,
        cms: c.cms,
        actions: { propose: a("propose"), assign: a("assign"), withdraw: a("withdraw") },
      });
    case "consent":
      return ConsentTextsScreen({
        ...common,
        texts: c.texts,
        actions: { draft: a("draft"), approve: a("approve") },
      });
    case "feedback":
      return FeedbackScreen({
        ...common,
        feedback: c.feedback,
        type: s.query["type"],
        open: s.query["open"] === "1",
      });
    case "trust":
      return TrustDocumentsScreen({ ...common, trust: c.mirror });
    case "previews": {
      const { options } = await packs(c, s);
      return PreviewsScreen({
        ...common,
        cms: c.cms,
        packs: options,
        reveal: s.reveal,
        actions: { preview: a("preview") },
      });
    }
    default: {
      const p = await packs(c, s);
      return ContentListScreen({
        ...common,
        cms: c.cms,
        section,
        title: TITLES[section],
        packs: p.options,
        packId: p.packId,
        types: CONTENT_SECTION_TYPES[section as ContentSection],
        actions: { create: a("create") },
      });
    }
  }
}

/** The editor of one item, or null when the section has no editors (a 404). */
export async function editScreen(c: Console, section: StudioSection, id: string, s: RouteState) {
  const common = {
    ctx: s.ctx,
    base: STUDIO_BASE,
    flash: s.flash,
    errors: s.errors,
    sections: s.sections,
  };
  const a = (name: string) => actionUrl(section, name);
  if (section === "brand")
    return BrandEditScreen({
      ...common,
      brand: c.brand,
      packId: id,
      actions: { save: a("save"), logo: a("logo"), workflow: a("workflow") },
    });
  if (section === "policies")
    return PolicyEditScreen({
      ...common,
      policies: c.policies,
      id,
      actions: { edit: a("edit"), workflow: a("workflow") },
    });
  if (!isContent(section) && section !== "pricing") return null;
  const item = await c.cms.get(s.ctx, id);
  return ContentEditScreen({
    ...common,
    cms: c.cms,
    section,
    itemId: id,
    transitions: c.transitions,
    reveal: s.reveal,
    actions: { save: a("save"), workflow: a("workflow"), preview: a("preview") },
    // Pages, landing pages and sections are edited block by block (PR-038).
    ...(section === "pages" ? { blocks: { options: BLOCK_EDITOR, action: a("blocks") } } : {}),
    ...(section === "resources"
      ? {
          extra: await ResourceVersionsPanel({
            resources: c.resources,
            packId: item.packId,
            itemId: id,
            actions: { withdraw: a("withdraw") },
          }),
        }
      : {}),
  });
}
