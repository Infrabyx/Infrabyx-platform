// Writes the inputs of the site's gate checks for its published packs (the `a11y` CI job):
//   node scripts/gate-inputs.ts <dir>
// - <dir>/footer.json for `infrabyx-cms validate-footer` (IPB-04-71, `@IPB-04-AT-73`);
// - <dir>/routes.json for `infrabyx-a11y journeys-lint --routes` (IPB-06-58).
// Reads the site's environment (APP_ENV, DB_URL …) like the running site.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { footerInputs } from "../src/server/footer-input.ts";
import { servedRoutes } from "../src/server/routes.ts";
import { getSite, publishedPacks } from "../src/server/site.ts";

const [dir] = process.argv.slice(2);
if (!dir) {
  console.error("usage: node scripts/gate-inputs.ts <dir>");
  process.exit(2);
}
await mkdir(dir, { recursive: true });
const site = await getSite();
const footers = await footerInputs(site);
const packs = await publishedPacks(site);
const entries = (await Promise.all(packs.map((p) => site.content.siteEntries(p.id)))).flat();
const routes = servedRoutes(entries);
await writeFile(join(dir, "footer.json"), JSON.stringify(footers, null, 2) + "\n");
await writeFile(join(dir, "routes.json"), JSON.stringify(routes, null, 2) + "\n");
console.log(`gate-inputs: ${footers.length} pack(s), ${routes.length} route(s) → ${dir}`);
process.exit(0);
