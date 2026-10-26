// Repo tooling: set a package's exports map, scripts and dependencies (used while building PL1).
// Usage: node scripts/pkg-setup.mjs <pkg> '<json: {subpaths, deps, devDeps, peers, optionalPeers, bin, files}>'
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const [pkg, json] = process.argv.slice(2);
const spec = JSON.parse(json ?? "{}");
const file = `packages/${pkg}/package.json`;
const pj = JSON.parse(readFileSync(file, "utf8"));

const exp = { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } };
for (const [sub, target] of Object.entries(spec.subpaths ?? {})) {
  exp[`./${sub}`] = /\.(mjs|json)$/.test(target)
    ? target
    : { types: `./dist/${target}.d.ts`, default: `./dist/${target}.js` };
}
pj.exports = exp;
pj.scripts = {
  build: "tsc -p tsconfig.build.json",
  test: "vitest run --passWithNoTests",
  "test:int": "INFRABYX_TEST_INT=1 vitest run --passWithNoTests",
  lint: "eslint src",
  typecheck: "tsc -p tsconfig.json",
  ...(spec.scripts ?? {}),
};
if (spec.deps) pj.dependencies = spec.deps;
if (spec.devDeps) pj.devDependencies = spec.devDeps;
if (spec.peers) pj.peerDependencies = spec.peers;
if (spec.optionalPeers) {
  pj.peerDependencies = { ...(pj.peerDependencies ?? {}), ...spec.optionalPeers };
  pj.peerDependenciesMeta = Object.fromEntries(
    Object.keys(spec.optionalPeers).map((k) => [k, { optional: true }]),
  );
}
if (spec.bin) pj.bin = spec.bin;
if (spec.files) pj.files = spec.files;
const order = [
  "name",
  "version",
  "description",
  "license",
  "private",
  "type",
  "main",
  "types",
  "exports",
  "bin",
  "files",
  "scripts",
  "dependencies",
  "peerDependencies",
  "peerDependenciesMeta",
  "devDependencies",
  "publishConfig",
  "repository",
  "engines",
];
const out = {};
for (const k of order) if (k in pj) out[k] = pj[k];
for (const k of Object.keys(pj)) if (!(k in out)) out[k] = pj[k];
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
const vc = `packages/${pkg}/vitest.config.mjs`;
if (!existsSync(vc))
  writeFileSync(
    vc,
    'import { packageConfig } from "../../vitest.shared.mjs";\n\nexport default packageConfig();\n',
  );
console.log(`updated ${file}`);
