// Every Studio form posts to `/studio-actions/<section>/<action>`; this map names the handler of
// each (from `@infrabyx/ui/studio`, over the package services). Unknown pairs are 404.
import type { KernelContext } from "@infrabyx/contracts/kernel";
import { BLOCK_EDITOR } from "@infrabyx/cms";
import {
  blockHandlers,
  brandHandlers,
  claimHandlers,
  consentTextHandlers,
  contentHandlers,
  mediaHandlers,
  policyHandlers,
  redirectHandlers,
  resourceHandlers,
  type StudioResult,
  type StudioSection,
} from "@infrabyx/ui/studio";
import type { Console } from "./console.ts";

export const STUDIO_BASE = "/studio";

export type Handler = (ctx: KernelContext, fd: FormData) => Promise<StudioResult>;

/** The URL a screen's form posts to. */
export const actionUrl = (section: StudioSection, action: string) =>
  `/studio-actions/${section}/${action}`;

export function actionMap(c: Console): Partial<Record<StudioSection, Record<string, Handler>>> {
  const content = (section: StudioSection) =>
    contentHandlers(c.cms, { base: STUDIO_BASE, section });
  const r = resourceHandlers(c.resources);
  return {
    pages: { ...content("pages"), ...blockHandlers(c.cms, BLOCK_EDITOR) },
    menus: content("menus"),
    footer: content("footer"),
    pricing: content("pricing"),
    forms: content("forms"),
    resources: { ...content("resources"), withdraw: r.withdraw },
    previews: { preview: content("pages").preview },
    brand: brandHandlers(c.brand, { base: STUDIO_BASE }),
    redirects: redirectHandlers(c.cms),
    media: mediaHandlers(c.media),
    claims: claimHandlers(c.cms),
    policies: policyHandlers(c.policies, { base: STUDIO_BASE }),
    consent: consentTextHandlers(c.texts),
  };
}
