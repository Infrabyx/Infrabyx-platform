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
