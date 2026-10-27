// The HTML sitemap (IPB-06 SC 2.4.5): every published route, and the site's own pages.
import type { Metadata } from "next";
import { AppPage } from "../../render/page.tsx";
import { requestContext } from "../../server/request.ts";
import { STATIC_ROUTES } from "../../server/routes.ts";

export const metadata: Metadata = { title: "Sitemap" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function Sitemap({ searchParams }: Props) {
  const ctx = await requestContext();
  const raw = (await searchParams).q;
  const q = typeof raw === "string" ? raw.trim().toLowerCase().slice(0, 100) : "";
  const hit = (title: string) => !q || title.toLowerCase().includes(q);
  const entries = await ctx.site.content.siteEntries(ctx.packId);
  const idx = await ctx.site.policies.index(ctx.packId, ctx.site.env.APP_BASE_URL);
  const pages = entries.filter(
    (e) =>
      (e.type === "page" || e.type === "group_company" || e.type === "job") &&
      hit(e.title ?? e.path),
  );
  return (
    <AppPage title="Sitemap" path="/sitemap">
      {q ? <p role="status">Pages matching “{q}”.</p> : null}
      <h2>Pages</h2>
      <ul>
        {pages.map((e) => (
          <li key={e.path}>
            <a href={e.path}>{e.title ?? e.path}</a>
          </li>
        ))}
        {STATIC_ROUTES.filter((r) => r.inSitemap && hit(r.title)).map((r) => (
          <li key={r.path}>
            <a href={r.path}>{r.title}</a>
          </li>
        ))}
      </ul>
      <h2>Policies</h2>
      <ul>
        {idx.policies
          .filter((p) => hit(p.title))
          .map((p) => (
            <li key={p.key}>
              <a href={new URL(p.url).pathname}>{p.title}</a>
            </li>
          ))}
      </ul>
    </AppPage>
  );
}
