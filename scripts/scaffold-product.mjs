#!/usr/bin/env node
// Scaffold a product repository from this platform (PL6 plan §9.1; IPB-14 §14.4 step 6, §14.5 item 5).
//   node scripts/scaffold-product.mjs --product <LD|LDC|EQ|FBX|UDF|OH> --name <display name> --out <dir>
//     [--registry <url>]   # the @infrabyx registry the product installs from (GitHub Packages by default)
// It writes:
// - apps/api, apps/worker and apps/web from apps/reference, apps/public and apps/console from this
//   repository, renamed to the product's scope, with every workspace import of a platform package
//   rewritten to its exact published version (products pin exact versions, IPB-14 step 7);
// - the root toolchain: .nvmrc, package.json (packageManager, engines), pnpm-workspace.yaml (the
//   7-day release age, @infrabyx/* exempt), turbo.json, .npmrc (no credential: pnpm 10 refuses to
//   expand one in a committed .npmrc, ADR-0002), the ESLint config with the IPB rules from
//   @infrabyx/testing, tsconfig.base.json, vitest.shared.mjs, prettier and git ignores, renovate.json;
// - .github: the CI workflow (the IPB-09-07 check names this repository can run so far) and the PR
//   template;
// - CLAUDE.md, docs/STATUS.md, docs/DECISIONS.md (one "provided by @infrabyx/<package>" row per
//   package), docs/platform-requests.md;
// - infra/docker and infra/compose (the local stack and `pnpm dev:up`, resolving the platform's
//   files from node_modules), infra/helm/values.<env>.yaml for the shared chart, and
//   infra/terraform/envs/<product>/<env>/ from the example stack (modules referenced by git at the
//   platform commit the scaffold ran from).
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { parseArgs } from "node:util";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const PRODUCTS = ["LD", "LDC", "EQ", "FBX", "UDF", "OH"];
const GITHUB_PACKAGES = "https://npm.pkg.github.com";
const PLATFORM_GIT = "git::https://github.com/Infrabyx/Infrabyx-platform.git";
/** Never copied from an app: build output, local state, credentials. */
const SKIP = new Set([
  "node_modules",
  "dist",
  ".next",
  ".turbo",
  "coverage",
  ".storage",
  "SEED_CREDENTIALS.md",
]);
const TEXT = /\.(ts|tsx|mts|mjs|cjs|js|json|md|ya?ml|sql|sh|txt|css|example)$|Dockerfile$/;

/** App folder in this repository → folder and package suffix in the product. */
export const APPS = [
  { from: "apps/reference/api", to: "api" },
  { from: "apps/reference/worker", to: "worker" },
  { from: "apps/reference/web", to: "web" },
  { from: "apps/public", to: "public" },
  { from: "apps/console", to: "console" },
];

/** The platform packages and their versions, from this checkout. */
export function platformPackages() {
  const out = {};
  for (const d of readdirSync(join(ROOT, "packages"))) {
    const pj = join(ROOT, "packages", d, "package.json");
    if (!existsSync(pj)) continue;
    const p = JSON.parse(readFileSync(pj, "utf8"));
    if (!p.private) out[p.name] = { version: p.version, dir: d, description: p.description ?? "" };
  }
  return out;
}

/** The rewrites from this repository's names and paths to the product's. */
export function rewrites(scope) {
  const pairs = [];
  for (const a of APPS) {
    const from = JSON.parse(read(`${a.from}/package.json`)).name;
    pairs.push([new RegExp(`${from.replace("/", "\\/")}(?![\\w-])`, "g"), `${scope}/${a.to}`]);
    pairs.push([new RegExp(`${a.from}(?![\\w-])`, "g"), `apps/${a.to}`]);
  }
  pairs.push([/\.\.\/\.\.\/\.\.\/(tsconfig\.base\.json|vitest\.shared\.mjs)/g, "../../$1"]);
  // Dockerfile build arguments name the app folder under apps/.
  pairs.push([/APP: reference\/(api|worker|web)/g, "APP: $1"]);
  return pairs;
}

function rewriteFile(file, pairs) {
  if (!TEXT.test(file)) return;
  let s = readFileSync(file, "utf8");
  const before = s;
  for (const [re, to] of pairs) s = s.replace(re, to);
  if (s !== before) writeFileSync(file, s);
}

function walk(dir, fn) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, fn);
    else fn(p);
  }
}

function copyApp(src, dst) {
  cpSync(join(ROOT, src), dst, {
    recursive: true,
    filter: (p) => {
      const base = p.split("/").pop();
      return (
        !SKIP.has(base) &&
        !base.endsWith(".tsbuildinfo") &&
        base !== "next-env.d.ts" &&
        base !== ".env.local"
      );
    },
  });
}

/** Rewrite one app's package.json: the product's names, exact platform versions. */
function rewritePackageJson(file, scope, pkgs, apps) {
  const p = JSON.parse(readFileSync(file, "utf8"));
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    for (const [name, range] of Object.entries(p[field] ?? {})) {
      if (pkgs[name] && String(range).startsWith("workspace:")) p[field][name] = pkgs[name].version;
      const app = apps.get(name);
      if (app) {
        delete p[field][name];
        p[field][`${scope}/${app}`] = "workspace:*";
      }
    }
  }
  writeFileSync(file, `${JSON.stringify(p, null, 2)}\n`);
}

const rootPackage = (slug, name, pkgs, product) => {
  const platform = JSON.parse(read("package.json"));
  const dev = platform.devDependencies;
  const pick = (...names) =>
    Object.fromEntries(names.filter((n) => dev[n]).map((n) => [n, dev[n]]));
  return {
    name: slug,
    version: "0.0.0",
    private: true,
    description: `${name}: built on the Infrabyx platform packages (@infrabyx/*)`,
    type: "module",
    // Read by the platform bins that run before the product's configuration (infrabyx-seed's
    // refusal report, PR-FBX-04 note).
    infrabyx: { product },
    engines: platform.engines,
    packageManager: platform.packageManager,
    scripts: {
      build: "turbo run build",
      lint: "turbo run lint",
      typecheck: "turbo run typecheck",
      test: "turbo run test",
      "test:int": "turbo run test:int",
      "format:check": "prettier --check .",
      "dev:up": "node scripts/dev-up.mjs up",
      "dev:down": "node scripts/dev-up.mjs down",
    },
    devDependencies: {
      ...pick(
        "@eslint/js",
        "@types/node",
        "eslint",
        "globals",
        "prettier",
        "turbo",
        "typescript",
        "typescript-eslint",
        "vite",
        "vitest",
        "yaml",
      ),
      // The IPB lint rules and the files `pnpm dev:up` runs (migrations, seeds, the realm bootstrap).
      ...Object.fromEntries(
        [
          "@infrabyx/testing",
          "@infrabyx/config",
          "@infrabyx/connectors",
          "@infrabyx/crypto",
          "@infrabyx/seed",
          "@infrabyx/tenancy",
        ]
          .filter((n) => pkgs[n])
          .map((n) => [n, pkgs[n].version]),
      ),
    },
  };
};

const workspaceYaml = () =>
  read("pnpm-workspace.yaml").replace(/^packages:\n(?: {2}- .+\n)+/m, 'packages:\n  - "apps/*"\n');

const npmrc = (registry) =>
  [
    `@infrabyx:registry=${registry}`,
    "engine-strict=true",
    "auto-install-peers=true",
    "node-linker=isolated",
    "# Registry credentials are not set here: pnpm 10 refuses to expand ${...} in a committed",
    "# project .npmrc (ADR-0002 of the platform). CI writes the token from NPM_READ_TOKEN through",
    "# actions/setup-node (registry-url + NODE_AUTH_TOKEN); developers run",
    '#   pnpm config set "//npm.pkg.github.com/:_authToken" <token>',
    "",
  ].join("\n");

const turboJson = () => {
  const t = JSON.parse(read("turbo.json"));
  t.tasks.lint.inputs = ["src/**", "package.json", "$TURBO_ROOT$/eslint.config.mjs"];
  return `${JSON.stringify(t, null, 2)}\n`;
};

const eslintConfig = () =>
  read("eslint.config.mjs")
    .replace(
      "// ESLint flat config — infrabyx-platform",
      "// ESLint flat config: the platform's IPB rules from @infrabyx/testing/eslint (PL1-D-02)",
    )
    .replace(
      'import ipb from "./packages/testing/eslint/index.mjs";',
      'import ipb from "@infrabyx/testing/eslint";',
    )
    .replace(
      '      "**/*.generated.ts",\n',
      '      "**/*.generated.ts",\n      "**/.next/**",\n      "**/next-env.d.ts",\n',
    )
    .replace(/ {6}"packages\/testing\/eslint\/\*\*",\n/g, "");

const ciWorkflow = (product) => {
  const platform = read(".github/workflows/ci.yml");
  const pin = (action) =>
    new RegExp(`uses: (${action.replace("/", "\\/")}@[a-f0-9]{40} # v[\\d.]+)`).exec(platform)?.[1];
  return `# ${product}: CI on every PR (IPB-09-07). The required checks grow with the product; the
# lint check carries the IPB rules (vendor-import, schema-boundary, no-process-env, no-direct-crypto).
name: ci
on:
  pull_request:
  push:
    branches: [main]
concurrency:
  group: ci-\${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read
  packages: read
jobs:
  verify:
    runs-on: ubuntu-24.04
    steps:
      - uses: ${pin("actions/checkout")}
      - uses: ${pin("pnpm/action-setup")}
      - uses: ${pin("actions/setup-node")}
        with:
          node-version-file: .nvmrc
          cache: pnpm
          registry-url: ${GITHUB_PACKAGES}
          scope: "@infrabyx"
      - name: Install
        run: pnpm install --frozen-lockfile
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_READ_TOKEN }}
      - name: lint
        run: pnpm lint && pnpm format:check
      - name: typecheck
        run: pnpm typecheck
      - name: unit
        run: pnpm test
      - name: build
        run: pnpm build
`;
};

const claudeMd = (product, name, scope) => `# CLAUDE.md — ${name} (${product})

## What this repository is

${name}, built on the Infrabyx platform: tenancy, audit, config, rules, workflow, notify, connectors, AI and Vidhi, CMS, brand, consent, help, trust, feedback, export, UI, accessibility and seed come from the \`@infrabyx/*\` packages on GitHub Packages, pinned to exact versions. This repository holds the product's own modules, skills, pages, content and settings.

## Rules

- Never fork or patch a platform package. When a package lacks something, write it in \`docs/platform-requests.md\` with the IPB ID and build the smallest product-local shim behind the same port.
- Record each capability the platform provides in \`docs/DECISIONS.md\` as "provided by @infrabyx/<package>".
- Node.js and pnpm versions follow the platform (\`.nvmrc\`, \`packageManager\`); new third-party versions wait 7 days (\`pnpm-workspace.yaml\`).
- Every external capability sits behind a port of \`@infrabyx/connectors\`; vendor SDKs are never imported here.
- Settings are registered before code reads them; every mutation writes the audit ledger in the same transaction (\`kernel.mutate\`).
- Seeds never run in prod, dr or pre-prod; \`SEED_CREDENTIALS.md\` is never committed.

## Layout

\`apps/api\` (${scope}/api, NestJS 11) · \`apps/worker\` · \`apps/web\` (Next.js 16, the browser's origin) · \`apps/public\` (the public site) · \`apps/console\` (Studio) · \`infra/{compose,docker,helm,terraform}\` · \`docs/{STATUS.md,DECISIONS.md,platform-requests.md}\`.
`;

const statusMd = (product, name, date) => `# STATUS — ${name}

| Item | Value |
| --- | --- |
| Product | ${product} |
| Scaffolded | ${date} from the Infrabyx platform (\`scripts/scaffold-product.mjs\`) |
| Current phase | Phase 0: scaffold, toolchain, CI and environments |
| Next | Replace the \`hello\` example module with the product's first module |
`;

const decisionsMd = (pkgs, date) => {
  const rows = Object.entries(pkgs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([n, p]) =>
        `| ${date} | PLAT-${p.dir} | ${p.description.replace(/\|/g, "\\|") || n} — provided by ${n} ${p.version} | The platform builds it once for every product (IPB-14 step 6) | IPB-14 §14.4 |`,
    );
  return [
    "# DECISIONS",
    "",
    "| Date | ID | Decision | Reason | Spec section affected |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
};

const requestsMd = () => `# Platform requests

Changes this product needs from \`@infrabyx/*\`, for the platform's owner: the IPB ID, what is missing, the product-local shim built meanwhile, and the port it sits behind.

| Date | IPB ID | Request | Shim | Status |
| --- | --- | --- | --- | --- |
`;

/** The product's copy of `pnpm dev:up`: the platform's files come from node_modules. */
const devUp = (pairs, product) =>
  pairs
    .reduce((t, [re, to]) => t.replace(re, to), read("scripts/dev-up.mjs"))
    .replace(/^const PRODUCT = "[A-Z]+";/m, `const PRODUCT = "${product}";`)
    .replace(/"packages\/([a-z-]+)\/dist\//g, '"node_modules/@infrabyx/$1/dist/')
    .replace(/"\.\.\/\.\.\/packages\/([a-z-]+)\/dist\//g, '"../../node_modules/@infrabyx/$1/dist/')
    .replace(
      /"packages\/connectors\/policy\/cerbos"/g,
      '"node_modules/@infrabyx/connectors/policy/cerbos"',
    );

/**
 * Fails, before anything is written, when this platform checkout has no installed prettier: the
 * scaffold used to stop at the format step and leave a half-written product (PR-UDF-006). Only a
 * node_modules at or above the checkout counts, never NODE_PATH.
 */
export function assertPrettierInstalled(root = ROOT) {
  for (let dir = root; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "node_modules", "prettier", "package.json"))) return;
    if (dirname(dir) === dir) break;
  }
  throw new Error(
    `prettier is not installed in the platform checkout ${root}: run \`pnpm install --frozen-lockfile\` there first (nothing was written)`,
  );
}

/**
 * The reference app's default product, LD, in the files the scaffold copies: each becomes the
 * product's code, and a missing pattern fails the scaffold so a change to the reference app cannot
 * silently leave LD behind (PR-UDF-006).
 */
export const PRODUCT_DEFAULTS = [
  ["apps/api/src/env.ts", /ProductCode\.default\("LD"\)/g, (p) => `ProductCode.default("${p}")`],
  [
    "apps/api/src/env.ts",
    /(APP_PRODUCT: envVar\([^)]*\), \{[^}]*?example: )"LD"/g,
    (p) => `$1"${p}"`,
  ],
  [
    "apps/api/src/env.test.ts",
    /expect\(v\.APP_PRODUCT\)\.toBe\("LD"\)/g,
    (p) => `expect(v.APP_PRODUCT).toBe("${p}")`,
  ],
  ["apps/web/src/app/assets/web.css/route.ts", /themeCss\("LD"\)/g, (p) => `themeCss("${p}")`],
];

/**
 * The generated `.env.example` files name the product, as `infrabyx-env example --product <code>`
 * writes them, instead of `<PRODUCT>`; APP_PRODUCT's example line is rebuilt with the generator's
 * padding (PR-UDF-006).
 */
export function productEnvExample(text, product) {
  return text
    .replace(/^# Infrabyx <PRODUCT> — /m, `# Infrabyx ${product} — `)
    .replace(
      /^APP_PRODUCT=LD +(# .*)$/m,
      (_m, rest) => `${`APP_PRODUCT=${product}`.padEnd(46)} ${rest}`,
    );
}

/** Format every file the scaffold wrote, so the product's `format:check` starts green. */
async function formatTree(out) {
  const prettier = await import("prettier");
  const files = [];
  walk(out, (f) => {
    if (/\.(md|json|ya?ml|mjs|js|ts|tsx|css)$/.test(f) && !f.endsWith(".tf")) files.push(f);
  });
  for (const f of files) {
    const options = (await prettier.resolveConfig(f)) ?? {};
    const info = await prettier.getFileInfo(f);
    if (info.ignored || !info.inferredParser) continue;
    const src = readFileSync(f, "utf8");
    const formatted = await prettier.format(src, { ...options, filepath: f });
    if (formatted !== src) writeFileSync(f, formatted);
  }
}

/** The commit the modules are referenced at: a fixed ref, never a moving branch (IPB-01-38). */
export function platformCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

export async function scaffold({
  product,
  name,
  out,
  registry = GITHUB_PACKAGES,
  platformRef = platformCommit(),
  now = new Date(),
}) {
  if (!PRODUCTS.includes(product))
    throw new Error(`--product must be one of ${PRODUCTS.join(", ")}`);
  if (existsSync(out) && readdirSync(out).length) throw new Error(`${out} is not empty`);
  assertPrettierInstalled();
  const slug = product.toLowerCase();
  const scope = `@${slug}`;
  const pkgs = platformPackages();
  const date = now.toISOString().slice(0, 10);
  const pairs = rewrites(scope);
  const apps = new Map(APPS.map((a) => [JSON.parse(read(`${a.from}/package.json`)).name, a.to]));
  const write = (p, s) => {
    mkdirSync(dirname(join(out, p)), { recursive: true });
    writeFileSync(join(out, p), s);
  };

  for (const a of APPS) {
    const dst = join(out, "apps", a.to);
    copyApp(a.from, dst);
    walk(dst, (f) => rewriteFile(f, pairs));
    rewritePackageJson(join(dst, "package.json"), scope, pkgs, apps);
  }
  // The product code replaces the reference app's default product.
  for (const [file, re, to] of PRODUCT_DEFAULTS) {
    const f = join(out, file);
    const src = readFileSync(f, "utf8");
    if (!re.test(src))
      throw new Error(`scaffold: ${file} no longer matches ${re}; update PRODUCT_DEFAULTS`);
    re.lastIndex = 0;
    writeFileSync(f, src.replace(re, to(product)));
  }
  for (const a of APPS)
    for (const f of readdirSync(join(out, "apps", a.to)).filter((x) =>
      x.endsWith(".env.example"),
    )) {
      const file = join(out, "apps", a.to, f);
      writeFileSync(file, productEnvExample(readFileSync(file, "utf8"), product));
    }

  write(".nvmrc", read(".nvmrc"));
  write("package.json", `${JSON.stringify(rootPackage(slug, name, pkgs, product), null, 2)}\n`);
  write("pnpm-workspace.yaml", workspaceYaml());
  write("turbo.json", turboJson());
  write(".npmrc", npmrc(registry));
  write("eslint.config.mjs", eslintConfig());
  write("tsconfig.base.json", read("tsconfig.base.json"));
  write("vitest.shared.mjs", read("vitest.shared.mjs"));
  write(".gitignore", read(".gitignore"));
  write(".prettierrc", read(".prettierrc"));
  write(
    ".prettierignore",
    "pnpm-lock.yaml\nnode_modules/\ndist/\n.turbo/\ncoverage/\n.next/\n**/next-env.d.ts\n",
  );
  write("renovate.json", read("renovate.json"));
  write(".github/workflows/ci.yml", ciWorkflow(product));
  write(".github/PULL_REQUEST_TEMPLATE.md", read(".github/PULL_REQUEST_TEMPLATE.md"));
  write("CLAUDE.md", claudeMd(product, name, scope));
  write("docs/STATUS.md", statusMd(product, name, date));
  write("docs/DECISIONS.md", decisionsMd(pkgs, date));
  write("docs/platform-requests.md", requestsMd());
  write("scripts/dev-up.mjs", devUp(pairs, product));

  for (const dir of ["infra/compose", "infra/docker"]) {
    cpSync(join(ROOT, dir), join(out, dir), {
      recursive: true,
      filter: (p) => !p.endsWith(".test.mjs"),
    });
    walk(join(out, dir), (f) => rewriteFile(f, pairs));
  }
  for (const f of readdirSync(join(ROOT, "infra/helm/infrabyx-app/ci"))) {
    const env = /-(prod|staging|dev|preview)-values\.yaml$/.exec(f)?.[1];
    const kind = f.split("-")[0];
    if (!env) continue;
    let s = read(`infra/helm/infrabyx-app/ci/${f}`).replace(
      /infrabyx\/(api|worker|web|public|console)/g,
      `${slug}/$1`,
    );
    s = `# ${product} ${kind} in ${env}: values for the platform's shared chart (infra/helm/infrabyx-app of\n# Infrabyx-platform). Replace the example registry, digests, hosts and role ARNs.\n${s}`;
    write(`infra/helm/${kind}/values.${env}.yaml`, s);
  }
  const tf = read("infra/terraform/envs/example/preview/main.tf").replace(
    /source(\s*)=\s*"\.\.\/\.\.\/\.\.\/modules\/([a-z0-9/-]+)"/g,
    `source$1= "${PLATFORM_GIT}//infra/terraform/modules/$2?ref=${platformRef}"`,
  );
  for (const env of ["dev", "staging", "prod"])
    write(`infra/terraform/envs/${slug}/${env}/main.tf`, tf);
  await formatTree(out);

  return { scope, apps: APPS.map((a) => `apps/${a.to}`), packages: Object.keys(pkgs).length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      product: { type: "string" },
      name: { type: "string" },
      out: { type: "string" },
      registry: { type: "string" },
    },
  });
  if (!values.product || !values.name || !values.out) {
    console.error(
      "usage: node scripts/scaffold-product.mjs --product <code> --name <name> --out <dir> [--registry <url>]",
    );
    process.exit(2);
  }
  const r = await scaffold({
    ...values,
    ...(values.registry ? { registry: values.registry } : {}),
  });
  console.log(
    `scaffolded ${values.name} (${r.scope}) into ${relative(process.cwd(), values.out) || values.out}: ${r.apps.join(", ")}; ${r.packages} platform packages pinned`,
  );
}
