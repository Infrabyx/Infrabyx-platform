// The site stylesheet: the product tokens in four themes, the component CSS of `ui`, `consent` and
// `feedback`, and the site's layout rules. One file from this origin; no inline styles.
import { CMP_CSS } from "@infrabyx/consent";
import { FEEDBACK_CSS } from "@infrabyx/feedback";
import { COMPONENT_CSS } from "@infrabyx/ui";
import { themeCss } from "@infrabyx/ui/tokens";
import { SITE_CSS } from "../../../render/site-css.ts";
import { text } from "../../../server/files.ts";
import { getSite } from "../../../server/site.ts";

export async function GET() {
  const site = await getSite();
  return text(
    [themeCss(site.brandProduct), COMPONENT_CSS, CMP_CSS, FEEDBACK_CSS, SITE_CSS].join("\n"),
    "text/css",
    3600,
  );
}

/** Rendered per request: the pack depends on the host and the content on the database. */
export const dynamic = "force-dynamic";
