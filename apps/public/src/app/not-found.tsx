// The custom 404 (PL5 plan §9.2): a plain explanation and a search of the site's pages.
import { Button, Field } from "@infrabyx/ui";
import { AppPage } from "../render/page.tsx";

export default function NotFound() {
  return (
    <AppPage title="Page not found" path="/404">
      <p>We could not find that page. It may have moved, or the address may be mistyped.</p>
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
