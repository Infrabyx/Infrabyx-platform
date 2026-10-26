
// IPB structural checks (grows with IPB-09 required checks)
import { readFileSync, existsSync, readdirSync } from "node:fs";
const fail = (m) => { console.error("IPB-CHECK FAIL:", m); process.exitCode = 1; };
if (readFileSync(".nvmrc", "utf8").trim() !== "24.22.1") fail(".nvmrc must be 24.22.1 (IPB-D-01)");
for (const d of ["docs/ipb/00_README.md", "docs/ecosystem/infrabyx-integration-spec-v1.2.md", "docs/STATUS.md", "docs/DECISIONS.md", "CLAUDE.md"]) if (!existsSync(d)) fail(`${d} missing`);
for (const p of readdirSync("packages")) {
  const pj = JSON.parse(readFileSync(`packages/${p}/package.json`, "utf8"));
  if (!pj.name.startsWith("@infrabyx/")) fail(`${p}: name must be @infrabyx/*`);
  if (pj.publishConfig?.registry !== "https://npm.pkg.github.com") fail(`${p}: publishConfig.registry must be GitHub Packages`);
  if (pj.engines?.node !== "24.22.1") fail(`${p}: engines.node must be 24.22.1`);
}
if (!process.exitCode) console.log("IPB-CHECK OK");
