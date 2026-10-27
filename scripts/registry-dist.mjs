// Registry checksums for the packages a release just published (PL2-D-67). Reads the changesets
// action's `publishedPackages` from PUBLISHED and prints the registry's dist.shasum and
// dist.integrity per version as a Markdown table. Auth comes from the .npmrc setup-node writes.
import { execFileSync } from "node:child_process";

const published = JSON.parse(process.env.PUBLISHED ?? "[]");
const rows = ["| Package | Version | shasum (SHA-1) | integrity (SHA-512) |", "|---|---|---|---|"];
for (const { name, version } of published) {
  const out = execFileSync(
    "npm",
    [
      "view",
      `${name}@${version}`,
      "dist.shasum",
      "dist.integrity",
      "--json",
      "--registry",
      "https://npm.pkg.github.com",
    ],
    { encoding: "utf8" },
  );
  const dist = JSON.parse(out);
  rows.push(
    `| ${name} | ${version} | \`${dist["dist.shasum"]}\` | \`${dist["dist.integrity"]}\` |`,
  );
}
console.log(rows.join("\n"));
