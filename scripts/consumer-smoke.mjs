// Consumer smoke test (PL3-D-02). Packs every publishable package with `pnpm pack`, installs the
// tarballs with plain npm in a clean directory outside the workspace, and imports every JavaScript
// export with plain Node, the way a product consumes the release. It catches what the workspace
// cannot: CommonJS named-import mismatches, missing files in `files`, exports pointing at nothing.
//
//   node scripts/consumer-smoke.mjs [--keep]
//
// Rules: directory exports (keys ending in "/") are skipped; wildcard exports are expanded against
// the installed files; JSON targets are imported with { type: "json" }; any other non-JavaScript
// target (YAML, SQL) is listed and skipped. Any error fails the run (exit 1).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const keep = process.argv.includes("--keep");
const work = mkdtempSync(join(tmpdir(), "ipb-consumer-smoke-"));
const tarballs = join(work, "tarballs");
const app = join(work, "app");

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

const publishable = readdirSync(join(root, "packages"))
  .map((dir) => join(root, "packages", dir))
  .filter((dir) => {
    try {
      return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).private !== true;
    } catch {
      return false;
    }
  })
  .map((dir) => ({ dir, pkg: JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) }));

// 1. Pack (pnpm rewrites workspace:* to the exact versions being released).
run("mkdir", ["-p", tarballs, app]);
const files = {};
for (const { dir, pkg } of publishable) {
  const out = run("pnpm", ["pack", "--pack-destination", tarballs], dir).trim().split("\n");
  files[pkg.name] = out[out.length - 1].trim();
}

// 2. Install in a clean directory with plain npm. Overrides pin every @infrabyx dependency to its
// tarball, so nothing is fetched from GitHub Packages; third-party dependencies come from npmjs.
// Peer dependencies (optional ones included: `tenancy/drizzle` needs drizzle-orm) are installed
// at the declared range, as a product using that export would.
const deps = Object.fromEntries(Object.entries(files).map(([n, f]) => [n, `file:${f}`]));
const peers = Object.fromEntries(
  publishable.flatMap(({ pkg }) => Object.entries(pkg.peerDependencies ?? {})),
);
writeFileSync(
  join(app, "package.json"),
  JSON.stringify(
    {
      name: "consumer-smoke",
      private: true,
      type: "module",
      dependencies: { ...peers, ...deps },
      overrides: deps,
    },
    null,
    2,
  ),
);
writeFileSync(join(app, ".npmrc"), "registry=https://registry.npmjs.org/\n");
run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts=false"], app);

// 3. Enumerate exports.
const listFiles = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
const targetOf = (value) => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object")
    return value.import ?? value.node ?? value.default ?? null;
  return null;
};
const specifiers = [];
const skipped = [];
for (const { pkg } of publishable) {
  const installed = join(app, "node_modules", pkg.name);
  const exportsMap = pkg.exports ?? { ".": pkg.main ?? "./index.js" };
  for (const [key, value] of Object.entries(exportsMap)) {
    if (key.endsWith("/")) {
      skipped.push(`${pkg.name} ${key} (directory export)`);
      continue;
    }
    const target = targetOf(value);
    if (!target) {
      skipped.push(`${pkg.name} ${key} (no import target)`);
      continue;
    }
    const subpaths = [];
    if (key.includes("*")) {
      const [tPre, tPost] = target.split("*");
      const [kPre, kPost] = key.split("*");
      for (const f of listFiles(installed)) {
        const rel = `./${relative(installed, f)}`;
        if (
          rel.startsWith(tPre) &&
          rel.endsWith(tPost) &&
          rel.length >= tPre.length + tPost.length
        ) {
          const star = rel.slice(tPre.length, rel.length - tPost.length);
          subpaths.push({ key: `${kPre}${star}${kPost}`, target: rel });
        }
      }
      if (subpaths.length === 0) skipped.push(`${pkg.name} ${key} (wildcard matches no file)`);
    } else {
      subpaths.push({ key, target });
    }
    for (const s of subpaths) {
      const spec = s.key === "." ? pkg.name : `${pkg.name}/${s.key.slice(2)}`;
      if (/\.(m?js|cjs)$/.test(s.target) || !/\.[a-z0-9]+$/i.test(s.target))
        specifiers.push({ spec, json: false });
      else if (s.target.endsWith(".json")) specifiers.push({ spec, json: true });
      else skipped.push(`${spec} (non-JavaScript: ${s.target})`);
    }
  }
}

// 4. Import each export in its own plain Node process, so one failure cannot mask another and a
// module's import-time side effects stay isolated.
const failures = [];
for (const { spec, json } of specifiers) {
  const code = json
    ? `await import(${JSON.stringify(spec)}, { with: { type: "json" } });`
    : `await import(${JSON.stringify(spec)});`;
  try {
    execFileSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: app,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "production" },
      timeout: 60_000,
    });
    console.log(`ok    ${spec}`);
  } catch (err) {
    const msg = `${err.stderr ?? ""}${err.stdout ?? ""}`.trim().split("\n").slice(0, 8).join("\n");
    failures.push({ spec, msg });
    console.log(`FAIL  ${spec}\n      ${msg.replaceAll("\n", "\n      ")}`);
  }
}

for (const s of skipped) console.log(`skip  ${s}`);
console.log(
  `\nconsumer-smoke: node ${process.version}, ${publishable.length} packages, ` +
    `${specifiers.length} exports imported, ${failures.length} failed, ${skipped.length} skipped`,
);
if (!keep) rmSync(work, { recursive: true, force: true });
else console.log(`kept ${work}`);
process.exit(failures.length === 0 ? 0 : 1);
