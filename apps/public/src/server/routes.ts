// The site's own routes (outside the CMS), for the HTML sitemap, `sitemap.xml`, the journey lint
// and the accessibility gate's route list.
export const STATIC_ROUTES = [
  { path: "/legal", title: "Policies", inSitemap: true },
  { path: "/accessibility", title: "Accessibility", inSitemap: true },
  { path: "/grievance", title: "Grievances", inSitemap: true },
  { path: "/glossary", title: "Glossary", inSitemap: true },
  { path: "/feedback", title: "Feedback", inSitemap: true },
  { path: "/security", title: "Report a security issue", inSitemap: true },
  { path: "/cookie-settings", title: "Cookie settings", inSitemap: true },
  { path: "/sitemap", title: "Sitemap", inSitemap: false },
] as const;

/** Routes the app serves for every pack whatever the content (`legal/[slug]`, the gallery …). */
export const APP_ROUTE_PATTERNS = [
  "/legal/*",
  "/feedback/*",
  "/__gallery",
  "/__not-found",
] as const;

/** Where each listed content type lives (its detail pages, `[[...path]]/page.tsx`). */
export const CONTENT_ROUTE_PATTERNS: Readonly<Record<string, string>> = {
  group_company: "/group-companies/*",
  job: "/careers/*",
};

/**
 * Every route a pack's content and the app serve, as the journey registry names them: CMS pages by
 * path, detail pages by their pattern (for `infrabyx-a11y journeys-lint --routes`).
 */
export function servedRoutes(entries: readonly { path: string; type: string }[]): string[] {
  const out = new Set<string>([...STATIC_ROUTES.map((r) => r.path), ...APP_ROUTE_PATTERNS]);
  for (const e of entries) out.add(CONTENT_ROUTE_PATTERNS[e.type] ?? e.path);
  return [...out].sort();
}
