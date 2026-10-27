// Display name and terminology (IPB-04-27, `@IPB-04-AT-25`). `app_name` is the product's display
// name in titles, the manifest, email subject prefixes, PDF headers and the login page;
// `terminology_override` relabels terms for display only. Kernel identifiers, event names, scopes
// and audit records never change.
import type { BrandPackBody } from "./shape.js";

/** The kernel name shown when no override is set (IPB-D-03). */
export const DEFAULT_ASSISTANT_NAME = "Vidhi";

export function term(body: BrandPackBody, key: string, fallback: string): string {
  return body.terminology_override[key] ?? fallback;
}

export const assistantName = (body: BrandPackBody) => term(body, "vidhi", DEFAULT_ASSISTANT_NAME);

/** `<Page> · <Module> · <app_name>` (IPB-06 SC 2.4.2 with the pack's display name). */
export function brandedTitle(body: BrandPackBody, page: string, module?: string): string {
  return [page, module, body.app_name]
    .filter((p): p is string => Boolean(p && p.trim()))
    .join(" · ");
}

/** `[app_name] Subject` for every email the pack sends. */
export const emailSubject = (body: BrandPackBody, subject: string) =>
  `[${body.app_name}] ${subject}`;
