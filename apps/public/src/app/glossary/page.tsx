// The public glossary (IPB-07-41…50, `@IPB-07-AT-17`): the published public entries the site uses
// (the `web` and `consent` modules of the help registry), grouped by first letter.
import type { Metadata } from "next";
import { publicGlossary } from "@infrabyx/hlp";
import { AppPage } from "../../render/page.tsx";
import { requestContext } from "../../server/request.ts";

export const metadata: Metadata = { title: "Glossary" };

const SITE_MODULES = new Set(["web", "consent"]);

export default async function Glossary() {
  const ctx = await requestContext();
  const groups = publicGlossary(
    ctx.site.help
      .entries()
      .filter((e) => SITE_MODULES.has(e.key.split(".")[1]!) && !e.key.startsWith("hlp.web.field.")),
    "en-IN",
  );
  return (
    <AppPage title="Glossary" path="/glossary">
      {groups.map((g) => (
        <section key={g.letter} aria-labelledby={`letter-${g.letter}`}>
          <h2 id={`letter-${g.letter}`}>{g.letter}</h2>
          <dl className="ibx-glossary">
            {g.items.map((t) => (
              <div key={t.key} id={t.key.replace(/\./g, "-")}>
                <dt>{t.term}</dt>
                <dd>{t.plain}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </AppPage>
  );
}
