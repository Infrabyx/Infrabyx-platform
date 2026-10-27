// The 404 and 410 page the proxy rewrites to (with that status), so it is fully server-rendered
// inside the shell; Next's own `notFound()` boundary needs JavaScript to show its content.
import type { Metadata } from "next";
import { Button, Field } from "@infrabyx/ui";
import { AppPage } from "../../render/page.tsx";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function NotFoundPage({ searchParams }: Props) {
  const gone = (await searchParams).gone === "1";
  return (
    <AppPage title={gone ? "This page has been removed" : "Page not found"} path="/404">
      <p>
        {gone
          ? "The page you asked for was removed and will not come back."
          : "We could not find that page. It may have moved, or the address may be mistyped."}
      </p>
      <form method="get" action="/sitemap" role="search" aria-label="Search the site">
        <Field id="q" label="Search for a page" helpKey="hlp.web.site_search" type="search" />
        <Button type="submit">Search</Button>
      </form>
      <p>
        Or <a href="/">go to the home page</a>.
      </p>
    </AppPage>
  );
}
