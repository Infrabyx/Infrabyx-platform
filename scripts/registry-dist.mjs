// Registry checksums for the packages a release just published (PL2-D-67). Reads the changesets
// action's `publishedPackages` from PUBLISHED and prints the registry's dist.shasum and
// dist.integrity per version as a Markdown table. Auth comes from the .npmrc setup-node writes.
//
// It also prints each package's visibility on GitHub Packages (owner answer #137 (2); R1-D-186),
// so the release record says which packages are public and which private, and no product is
// surprised. The visibility is read from the REST API ("Get a package for an organization",
// `GET /orgs/{org}/packages/npm/{name}`, field `visibility`) with GH_TOKEN, then with the
// publishing token (NODE_AUTH_TOKEN, which needs `read:packages`) if the first is refused; when it
// cannot be read the column says why, and the step does not fail (it is evidence, not a gate).
import { execFileSync } from "node:child_process";

const published = JSON.parse(process.env.PUBLISHED ?? "[]");
const owner = process.env.GITHUB_REPOSITORY_OWNER ?? "";
const tokens = [process.env.GH_TOKEN, process.env.NODE_AUTH_TOKEN].filter(Boolean);

/** `public`, `private` or `internal`, or a short reason it could not be read. */
async function visibility(name) {
  if (!owner || tokens.length === 0) return "not read (no token)";
  let last = "not read";
  for (const token of tokens) {
    last = await visibilityWith(name, token);
    if (!last.startsWith("not read")) return last;
  }
  return last;
}

async function visibilityWith(name, token) {
  const short = name.split("/")[1] ?? name;
  try {
    const res = await fetch(
      `https://api.github.com/orgs/${encodeURIComponent(owner)}/packages/npm/${encodeURIComponent(short)}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) return `not read (HTTP ${res.status})`;
    const v = (await res.json()).visibility;
    return typeof v === "string" && /^[a-z]{1,20}$/.test(v) ? v : "not read (no field)";
  } catch {
    return "not read (error)";
  }
}

const rows = [
  "| Package | Version | shasum (SHA-1) | integrity (SHA-512) | Visibility |",
  "|---|---|---|---|---|",
];
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
    `| ${name} | ${version} | \`${dist["dist.shasum"]}\` | \`${dist["dist.integrity"]}\` | ${await visibility(name)} |`,
  );
}
console.log(rows.join("\n"));
