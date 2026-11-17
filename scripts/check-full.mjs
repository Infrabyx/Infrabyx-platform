// `pnpm check:full` (OWNER-SPEED-01, R1-D-164): every gate CI's required jobs run that can run on a
// developer machine or a session container, in one command, before any push. It runs
//   - every step of the `verify` job of .github/workflows/ci.yml, in its order of definition;
//   - the `integration` job: migrate and rls-lint, the golden archive, the `test:int` suite of every
//     workspace package that has one, and the AT report;
//   - the `port-contract` workflow's full (weekly) matrix: the contract legs of every port in
//     scripts/port-matrix.mjs with an adapter folder, MinIO started for STORAGE as in CI;
//   - the `consumer-smoke` job;
//   - with --with-a11y / --with-scaffold / --with-compose / --with-images, heavier CI jobs.
// Steps run concurrently in a bounded pool (os.availableParallelism(), weighted by how many cores a
// step keeps busy); a step starts only when the steps it needs have passed. Every integration
// suite gets its own PostgreSQL container (the CI image, pgvector on PostgreSQL 18) and its own
// database `ipb_<suite>_<random>`, dropped at the end, so no suite shares a server's cluster-wide
// roles or migration lock with another. Every contract leg starts its own containers through
// `startService` (Testcontainers maps random host ports and names). Every step has its own TMPDIR
// and Vitest cache directory, a log file, and a pass/fail line with its time; a summary table
// closes the run and the exit status is non-zero if any step failed. Nothing is skipped silently:
// a step that cannot run here fails with the reason.
//
//   pnpm check:full [--jobs N] [--sequential] [--base origin/main] [--logs DIR]
//                   [--no-changeset] [--export-unchanged] [--pr-body FILE]
//                   [--with-a11y] [--with-scaffold] [--with-compose] [--with-images] [--with-heavy]
//                   [--list]
//
// --no-changeset and --export-unchanged mirror the PR labels of the same name (CI skips
// changeset-required, or passes --unchanged-label to the export-map gate); use them only when the PR
// carries the label. --sequential runs one step at a time (the old way; for timing comparisons).
import { spawn, execFileSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { availableParallelism, homedir, tmpdir } from "node:os";
import { join } from "node:path";
// Names only (containers, databases): uniqueness, not secrecy, so no crypto call-site (IPB-12-05).
const randomHex = (n) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
import { parse as parseYaml } from "yaml";
import { PORTS, portDir } from "./port-matrix.mjs";

export const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const CACHE = join(homedir(), ".cache", "ipb-check-full");

// ---------------------------------------------------------------------------------------------
// Arguments

export function parseArgs(argv) {
  const o = {
    jobs: availableParallelism(),
    base: "origin/main",
    logs: undefined,
    noChangeset: false,
    exportUnchanged: false,
    prBody: undefined,
    a11y: false,
    scaffold: false,
    compose: false,
    images: false,
    list: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--") continue;
    else if (a === "--jobs") {
      o.jobs = Number(val());
      if (!Number.isInteger(o.jobs) || o.jobs < 1) throw new Error("--jobs needs a whole number");
    } else if (a === "--sequential") o.jobs = 1;
    else if (a === "--base") o.base = val();
    else if (a === "--logs") o.logs = val();
    else if (a === "--no-changeset") o.noChangeset = true;
    else if (a === "--export-unchanged") o.exportUnchanged = true;
    else if (a === "--pr-body") o.prBody = val();
    else if (a === "--with-a11y") o.a11y = true;
    else if (a === "--with-scaffold") o.scaffold = true;
    else if (a === "--with-compose") o.compose = true;
    else if (a === "--with-images") o.images = true;
    else if (a === "--with-heavy") o.a11y = o.scaffold = o.compose = o.images = true;
    else if (a === "--list") o.list = true;
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

// ---------------------------------------------------------------------------------------------
// What CI runs (read from the workflow files, so the plan follows them)

export function readCi() {
  return parseYaml(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8"));
}

/** Names of the `verify` steps that run a command (setup actions excluded), in order. */
export function ciVerifyStepNames(ci = readCi()) {
  return ci.jobs.verify.steps.filter((s) => s.run).map((s) => s.name);
}

/** `verify` steps with no local equivalent, and why. */
export const VERIFY_NOT_LOCAL = {
  "pr-checklist (IPB-09-03/04)":
    "reads the PR description; runs here only with --pr-body FILE (CI always runs it)",
};

/** Pinned images of packages/testing/src/containers.ts, by name. */
export function testImages() {
  const src = readFileSync(join(ROOT, "packages/testing/src/containers.ts"), "utf8");
  const out = {};
  for (const m of src.matchAll(/^ {2}([a-z0-9]+): \{\s*image:\s*"([^"]+)"/gms)) out[m[1]] = m[2];
  return out;
}

/** Workspace packages (name, dir, scripts), sorted by dir. */
export function workspacePackages() {
  const dirs = [];
  for (const parent of ["packages", "apps", "apps/reference"]) {
    for (const d of readdirSync(join(ROOT, parent), { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const pj = join(ROOT, parent, d.name, "package.json");
      if (existsSync(pj)) dirs.push(`${parent}/${d.name}`);
    }
  }
  return dirs.sort().map((dir) => {
    const pkg = JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8"));
    return { name: pkg.name, dir, scripts: pkg.scripts ?? {} };
  });
}

/** Ports the weekly port-contract matrix runs (`port-matrix.mjs --all`). */
export function contractPorts() {
  return PORTS.filter((p) => existsSync(join(ROOT, "packages/connectors/src", portDir(p))));
}

// ---------------------------------------------------------------------------------------------
// The plan

const slug = (s) => s.replace(/^@infrabyx\//, "").replace(/[^a-zA-Z0-9]+/g, "-");

/**
 * Each step: id, name, group, cmd (bash), deps (ids that must pass first), weight (cores it keeps
 * busy; the pool never runs more than `jobs` in total), est (seconds, until a timing is recorded),
 * lock (steps sharing a lock never overlap), resource ("pg" | "minio"), soft (failure is a warning).
 */
export function plan(o, ci = readCi()) {
  const node = String(ci.jobs.verify.strategy.matrix.node[0]);
  const scan = ci.jobs.verify.steps.find((s) => s.name?.startsWith("secret-scan"));
  const base = o.base;
  // verify steps carry CI's own step names (a test keeps every one of them covered, in order).
  const names = ciVerifyStepNames(ci);
  const ciName = (prefix) => {
    const n = names.find((x) => x === prefix || x.startsWith(`${prefix} `));
    if (!n) throw new Error(`ci.yml verify has no step "${prefix}"`);
    return n;
  };
  const steps = [];
  const add = (s) => steps.push({ deps: ["install"], weight: 1, est: 10, group: "verify", ...s });
  const afterBuild = ["build"];

  // Preparation: install, then pull every pinned test image while the build runs.
  steps.push({
    id: "install",
    name: ciName("Install"),
    group: "verify",
    cmd: "pnpm install --frozen-lockfile",
    deps: [],
    weight: 1,
    est: 10,
  });
  const images = Object.values(testImages());
  add({
    id: "images",
    name: "pull the pinned test images (packages/testing containers.ts)",
    group: "prepare",
    soft: true,
    weight: 0,
    est: 60,
    cmd: [
      "missing=0",
      `for img in ${images.map((i) => `'${i}'`).join(" ")}; do`,
      '  if docker image inspect "$img" >/dev/null 2>&1; then echo "present $img"; continue; fi',
      "  ok=0",
      '  for t in 1 2 3; do if docker pull -q "$img"; then ok=1; break; fi; sleep $((t * 5)); done',
      '  if [ "$ok" = 1 ]; then echo "pulled $img"; else echo "UNAVAILABLE $img"; missing=1; fi',
      "done",
      'exit "$missing"',
    ].join("\n"),
  });

  // verify, in ci.yml order.
  add({
    id: "pin-check",
    name: ciName("pin-check"),
    est: 1,
    cmd: `test "$(cat .nvmrc)" = "${node}"\nnode -v | grep -qx "v${node}"`,
  });
  add({
    id: "secret-scan",
    name: ciName("secret-scan"),
    est: 15,
    cmd: [
      `V="${scan.env.GITLEAKS_VERSION}"; SHA="${scan.env.GITLEAKS_SHA256}"`,
      `D="${CACHE}/gitleaks-$V"; mkdir -p "$D"`,
      'if [ ! -x "$D/gitleaks" ]; then',
      '  curl -sSL -o "$D/gitleaks.tgz" "https://github.com/gitleaks/gitleaks/releases/download/v${V}/gitleaks_${V}_linux_x64.tar.gz"',
      '  echo "${SHA}  $D/gitleaks.tgz" | sha256sum -c -',
      '  tar -xzf "$D/gitleaks.tgz" -C "$D" gitleaks',
      "fi",
      `"$D/gitleaks" git --redact --no-banner --exit-code 1 --log-opts="${base}..HEAD" .`,
    ].join("\n"),
  });
  add({
    id: "spec-readonly",
    name: ciName("spec-readonly"),
    est: 1,
    cmd: [
      `changed="$(git diff --name-only "${base}...HEAD" -- docs/ipb docs/ecosystem; git status --porcelain -- docs/ipb docs/ecosystem)"`,
      'if [ -n "$changed" ]; then echo "Spec of record modified (write a request to docs/platform-requests.md instead):"; echo "$changed"; exit 1; fi',
    ].join("\n"),
  });
  add({
    id: "commitlint",
    name: ciName("commitlint"),
    est: 5,
    cmd: `pnpm commitlint --from "${base}" --to HEAD --verbose`,
  });
  // Lint and typecheck read the built declarations of workspace dependencies: after `build`, so
  // they never read a declaration file while it is written.
  add({
    id: "lint",
    name: ciName("lint (ESLint"),
    deps: afterBuild,
    weight: 2,
    est: 120,
    cmd: "pnpm lint",
  });
  add({ id: "format", name: ciName("lint (Prettier)"), est: 30, cmd: "pnpm format:check" });
  // `--only`: the build step has built every package; CI's typecheck and unit find those builds
  // in Turborepo's cache of the same job, which is what --only leaves out.
  add({
    id: "typecheck",
    name: ciName("typecheck"),
    deps: afterBuild,
    weight: 2,
    est: 120,
    cmd: "pnpm run typecheck --only",
  });
  // One lane stays free for the light steps that need no build (format, licence, the git checks).
  add({
    id: "build",
    name: ciName("build"),
    weight: Math.max(1, o.jobs - 1),
    est: 240,
    cmd: "pnpm build",
  });
  add({
    id: "unit",
    name: ciName("unit"),
    deps: afterBuild,
    weight: 2,
    est: 240,
    cmd: "pnpm run test --only",
  });
  // The two root Vitest runs have no config of their own and share the root Vitest cache: never at once.
  add({
    id: "test-policy",
    name: ciName("policy-rules"),
    deps: afterBuild,
    lock: "root-vitest",
    est: 20,
    cmd: "pnpm test:policy",
  });
  add({ id: "licence", name: ciName("licence"), est: 5, cmd: "pnpm licence:check" });
  add({
    id: "ipb-check",
    name: ciName("ipb-check"),
    deps: afterBuild,
    est: 5,
    cmd: "pnpm ipb:check",
  });
  add({
    id: "scripts-test",
    name: ciName("scripts-test"),
    deps: afterBuild,
    lock: "root-vitest",
    est: 60,
    cmd: "pnpm scripts:test",
  });
  for (const [id, script] of [
    ["migration-lint", "migration:lint"],
    ["registry-check", "registry:check"],
    ["routing-check", "routing:check"],
    ["notify-lint", "notify:lint"],
    ["hlp-lint", "hlp:lint"],
    ["journeys-lint", "journeys:lint"],
    ["ai-prompt-lint", "ai:prompt-lint"],
    ["ai-eval-gate", "ai:eval-gate"],
  ])
    add({ id, name: ciName(id), deps: afterBuild, est: 10, cmd: `pnpm ${script}` });
  add({
    id: "export-map-gate",
    name: ciName("export-map-gate"),
    deps: afterBuild,
    est: 10,
    cmd: `node packages/export/dist/cli.js map-gate --base "${base}"${o.exportUnchanged ? " --unchanged-label" : ""}`,
  });
  add({
    id: "dev-keys-check",
    name: ciName("dev-keys-check"),
    deps: afterBuild,
    est: 5,
    cmd: "pnpm dev-keys:check",
  });
  add({
    id: "env-example-check",
    name: ciName("env-example-check"),
    deps: afterBuild,
    est: 10,
    cmd: "pnpm env:example:check",
  });
  add({
    id: "changeset-required",
    name: ciName("changeset-required"),
    est: 5,
    cmd: o.noChangeset
      ? 'echo "not run: --no-changeset (the PR carries the no-changeset label)"'
      : `pnpm changeset status --since="${base}"`,
  });
  if (o.prBody)
    add({
      id: "pr-checklist",
      name: ciName("pr-checklist"),
      est: 2,
      cmd: `PR_BODY="$(cat '${o.prBody}')" HEAD_REF="$(git branch --show-current)" pnpm pr:checklist`,
    });

  // integration job: one PostgreSQL container and database per suite.
  add({
    id: "int-migrate-rls",
    name: "integration: migrate and rls-lint (IPB-02-12)",
    group: "integration",
    deps: afterBuild,
    resource: "pg",
    est: 30,
    cmd: [
      'node packages/tenancy/dist/migrate/cli.js --db "$IPB_TEST_PG_URL"',
      'node packages/tenancy/dist/rls-lint/cli.js --db "$IPB_TEST_PG_URL"',
    ].join("\n"),
  });
  add({
    id: "int-golden",
    name: "integration: golden-archive-diff (IPB-09-35, @IPB-09-AT-15)",
    group: "integration",
    deps: afterBuild,
    resource: "pg",
    est: 60,
    cmd: "pnpm --filter @infrabyx/export test:golden",
  });
  for (const p of workspacePackages().filter((x) => x.scripts["test:int"]))
    add({
      id: `int-${slug(p.name)}`,
      name: `integration: ${p.name} test:int`,
      group: "integration",
      deps: afterBuild,
      resource: "pg",
      est: 60,
      cmd: `pnpm --filter ${p.name} test:int`,
    });
  add({
    id: "at-report",
    name: "integration: at-report (acceptance-test coverage; report only)",
    group: "integration",
    deps: afterBuild,
    est: 5,
    cmd: "pnpm at:report",
  });

  // port-contract workflow, every port.
  const heavy = new Set(["IDENTITY", "AV", "DOCGEN", "KMS", "WORKFLOW", "FEATURE_FLAG"]);
  for (const port of contractPorts())
    add({
      id: `contract-${portDir(port)}`,
      name: `contract (${port})`,
      group: "contract",
      deps: afterBuild,
      weight: heavy.has(port) ? 2 : 1,
      resource: port === "STORAGE" ? "minio" : undefined,
      // IDENTITY builds and starts Keycloak twice (and Zitadel): the longest leg by far.
      est: port === "IDENTITY" ? 240 : heavy.has(port) ? 30 : 10,
      cmd: `pnpm --filter @infrabyx/connectors test:contract -- --port ${port}`,
    });

  add({
    id: "consumer-smoke",
    name: "consumer-smoke (pack, clean install, import every export)",
    group: "jobs",
    deps: afterBuild,
    est: 90,
    cmd: "node scripts/consumer-smoke.mjs",
  });

  for (const s of heavySteps(o, ci)) steps.push(s);
  // --sequential: every step alone, one after another (weight 1 each).
  return steps.map((s) => ({ ...s, weight: o.jobs === 1 ? 1 : Math.min(s.weight, o.jobs) }));
}

/** CI jobs too heavy for every run, each behind its own flag (one step per job, in job order). */
function heavySteps(o, ci) {
  const out = [];
  const job = (id, name, cmd, extra = {}) =>
    out.push({
      id,
      name,
      group: "heavy",
      deps: ["build"],
      weight: 2,
      est: 600,
      cmd: ["set -euo pipefail", ...cmd].join("\n"),
      ...extra,
    });
  if (o.images) {
    const e = ci.jobs.containers.env;
    job(
      "job-containers",
      "containers: hadolint, trivy config, build images, trivy image, hardening",
      [
        `export HADOLINT_IMAGE='${e.HADOLINT_IMAGE}' TRIVY_IMAGE='${e.TRIVY_IMAGE}'`,
        `APPS='${e.APPS}'; NODE_APPS='${e.NODE_APPS}'`,
        'TAG="check-$(git rev-parse --short=12 HEAD)"',
        // Behind a TLS-inspecting proxy (a session container), IPB_BUILD_CA names its CA bundle: it
        // is passed as the Dockerfiles' optional `ca` build secret and to Trivy. Unset (CI), the
        // commands are exactly CI's.
        'CA_SECRET=(); CA_MOUNT=(); if [ -n "${IPB_BUILD_CA:-}" ]; then CA_SECRET=(--secret "id=ca,src=$IPB_BUILD_CA"); CA_MOUNT=(-v "$IPB_BUILD_CA:/etc/ssl/certs/ca-certificates.crt:ro"); fi',
        'for f in $(git ls-files "*Dockerfile"); do echo "== $f"; docker run --rm -i "$HADOLINT_IMAGE" hadolint - < "$f"; done',
        'for dir in infra/docker infra/keycloak; do docker run --rm "${CA_MOUNT[@]}" -v "$PWD:/src:ro" -v "$TMPDIR/trivy:/root/.cache/trivy" "$TRIVY_IMAGE" config --exit-code 1 --severity HIGH,CRITICAL "/src/$dir"; done',
        'for app in $APPS; do docker build "${CA_SECRET[@]}" -f infra/docker/next/Dockerfile --build-arg APP="$app" -t "infrabyx/${app//\\//-}:$TAG" .; done',
        'for app in $NODE_APPS; do docker build "${CA_SECRET[@]}" -f infra/docker/node/Dockerfile --build-arg APP="$app" -t "infrabyx/${app//\\//-}:$TAG" .; done',
        'docker build "${CA_SECRET[@]}" -t "infrabyx/keycloak-customer:$TAG" infra/keycloak/customer-otp',
        'for app in ${APPS//\\//-} ${NODE_APPS//\\//-} keycloak-customer; do docker run --rm "${CA_MOUNT[@]}" -v /var/run/docker.sock:/var/run/docker.sock -v "$PWD/infra/docker:/cfg:ro" -v "$TMPDIR/trivy:/root/.cache/trivy" "$TRIVY_IMAGE" image --exit-code 1 --severity HIGH,CRITICAL --ignorefile /cfg/trivyignore.yaml --scanners vuln,secret "infrabyx/$app:$TAG"; done',
        'IPB_IMAGES="$(for app in ${APPS//\\//-} ${NODE_APPS//\\//-}; do printf "infrabyx/%s:%s " "$app" "$TAG"; done)" pnpm images:test',
      ],
    );
  }
  if (o.compose) {
    // compose and reference share the stack (fixed host ports 53123-53127 and 55432): one step.
    const checks = ci.jobs.compose.steps.find((s) => s.name?.startsWith("the seeded site")).run;
    job(
      "job-compose-reference",
      "compose and reference: dev:up, the seeded site, the gate journey, the api's integration suites",
      [
        "pnpm dev:up --profile apps",
        'trap "pnpm dev:down" EXIT',
        checks,
        'IPB_CHROMIUM="${IPB_CHROMIUM:-/usr/bin/google-chrome}" IPB_TEST_WEB_URL=http://localhost:53127 IPB_TEST_CREDENTIALS="$PWD/SEED_CREDENTIALS.md" NEXT_TELEMETRY_DISABLED=1 pnpm --filter @infrabyx/reference-web test:e2e',
        'POSTGRES_PASSWORD="$(grep "^POSTGRES_PASSWORD=" infra/compose/.env.local | cut -d= -f2-)"',
        'IPB_TEST_PG_URL="postgres://postgres:${POSTGRES_PASSWORD}@127.0.0.1:55432/postgres" IPB_TEST_TEMPORAL_URL="http://127.0.0.1:57233" pnpm --filter @infrabyx/reference-api test:int',
      ],
      { lock: "compose-stack", weight: 3, est: 900 },
    );
  }
  if (o.a11y) {
    const e = ci.jobs.a11y.env;
    job(
      "job-a11y",
      "a11y: the group site and Studio console gates (Chromium, axe, HTML_CodeSniffer)",
      [
        `export APP_ENV='${e.APP_ENV}' APP_PRODUCT='${e.APP_PRODUCT}' APP_BASE_URL='${e.APP_BASE_URL}' APP_FIXTURE_ADAPTERS='${e.APP_FIXTURE_ADAPTERS}' NEXT_TELEMETRY_DISABLED=1`,
        'export DB_URL="$IPB_TEST_PG_URL" DB_PASSWORD=postgres STORAGE_DIR="$TMPDIR/site-storage"',
        'export IPB_CHROMIUM="${IPB_CHROMIUM:-/usr/bin/google-chrome}"',
        "SITE_PORT=$(node -e 'const s=require(\"net\").createServer().listen(0,()=>{console.log(s.address().port);s.close()})')",
        "CONSOLE_PORT=$(node -e 'const s=require(\"net\").createServer().listen(0,()=>{console.log(s.address().port);s.close()})')",
        "export IPB_TEST_SITE_URL=http://127.0.0.1:$SITE_PORT",
        'node packages/tenancy/dist/migrate/cli.js --db "$DB_URL"',
        '(cd apps/public && SEED_ENABLED=true SEED_RANDOM_SEED=1 SEED_VAULT_PREFIX=test SEED_CREDENTIALS_PATH="$TMPDIR/seed-credentials.md" node ../../packages/seed/dist/cli.js --profile test --modules src/seed/public-site.ts)',
        '(cd apps/public && node scripts/gate-inputs.ts "$TMPDIR/gate")',
        'node packages/cms/dist/cli.js validate-footer "$TMPDIR/gate/footer.json"',
        'node packages/a11y/dist/cli.js journeys-lint apps/public/journeys/GRP.yaml --routes "$TMPDIR/gate/routes.json" --at-scripts apps/public/at-scripts',
        "node packages/a11y/dist/cli.js overlay-scan apps/public/.next/static apps/public/src apps/console/.next/static apps/console/src",
        '(cd apps/public && PORT=$SITE_PORT nohup pnpm start > "$TMPDIR/site.log" 2>&1 & echo $! > "$TMPDIR/site.pid")',
        'trap \'pkill -P "$(cat "$TMPDIR/site.pid")" 2>/dev/null || true; kill "$(cat "$TMPDIR/site.pid")" 2>/dev/null || true; [ -f "$TMPDIR/console.pid" ] && { pkill -P "$(cat "$TMPDIR/console.pid")" 2>/dev/null; kill "$(cat "$TMPDIR/console.pid")" 2>/dev/null; } || true\' EXIT',
        'for i in $(seq 1 60); do curl -sf -o /dev/null "$IPB_TEST_SITE_URL/robots.txt" && break; sleep 1; [ "$i" = 60 ] && { cat "$TMPDIR/site.log"; exit 1; }; done',
        "pnpm --filter @infrabyx/public-site test:e2e",
        '(cd apps/console && APP_BASE_URL=https://studio.example.org APP_SITE_URL=https://group.example.org PORT=$CONSOLE_PORT nohup pnpm start > "$TMPDIR/console.log" 2>&1 & echo $! > "$TMPDIR/console.pid")',
        'for i in $(seq 1 60); do curl -sf -o /dev/null "http://127.0.0.1:$CONSOLE_PORT/sign-in" && break; sleep 1; [ "$i" = 60 ] && { cat "$TMPDIR/console.log"; exit 1; }; done',
        "IPB_TEST_CONSOLE_URL=http://127.0.0.1:$CONSOLE_PORT pnpm --filter @infrabyx/console test:e2e",
      ],
      { resource: "pg", est: 600 },
    );
  }
  if (o.scaffold) {
    job(
      "job-scaffold",
      "scaffold: a product from the template passes its own CI against a local registry",
      [
        'PACKS="$TMPDIR/packs"; REG_PORT=$(node -e \'const s=require("net").createServer().listen(0,()=>{console.log(s.address().port);s.close()})\')',
        'pnpm -r --filter "./packages/*" exec pnpm pack --pack-destination "$PACKS"',
        'git worktree add --detach "$TMPDIR/bare" HEAD',
        "trap 'git worktree remove --force \"$TMPDIR/bare\" || true; kill $REG_PID 2>/dev/null || true' EXIT",
        'if node "$TMPDIR/bare/scripts/scaffold-product.mjs" --product UDF --name "Udofin" --out "$TMPDIR/bare-product" 2> "$TMPDIR/bare.err"; then echo "the scaffold ran without prettier installed"; exit 1; fi',
        'grep -q "prettier is not installed in the platform checkout" "$TMPDIR/bare.err"',
        'test ! -e "$TMPDIR/bare-product"',
        'node scripts/scaffold/registry.mjs --dir "$PACKS" --port "$REG_PORT" & REG_PID=$!',
        'for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$REG_PORT/@infrabyx%2Ftenancy" >/dev/null && break; sleep 1; done',
        'node scripts/scaffold-product.mjs --product UDF --name "Udofin" --out "$TMPDIR/product" --registry "http://127.0.0.1:$REG_PORT"',
        '(cd "$TMPDIR/product" && pnpm install && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build)',
        `(cd "$TMPDIR/product" && ! grep -rnE 'themeCss\\("(LD|OH|GRP)"\\)|const product = "OH"|product: "OH";|default\\("(LD|GRP)"\\)|product = .GRP.' apps --include="*.ts" --include="*.tsx" --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist)`,
        `(cd "$TMPDIR/product/apps/api" && node --input-type=module -e 'import { platformSources } from "@infrabyx/tenancy/migrate"; const s = platformSources(process.cwd(), undefined, { missing: "error" }); console.log(s.length + " platform migration sources resolve from apps/api");')`,
        '(cd "$TMPDIR/product" && ! grep -rl "<PRODUCT>" --include="*.env.example" --include=".env.example" apps)',
        'env_check() { (cd "$TMPDIR/product/apps/$1" && shift && pnpm exec infrabyx-env example --product UDF --check "$@"); }',
        "env_check api --schema dist/env.js --export apiEnvSchema",
        "env_check web --schema src/server/env.ts --export webEnvSchema",
        "env_check public --schema src/server/env.ts --export siteEnvSchema",
        "env_check public --schema src/seed/env.ts --export groupSeedEnvSchema --out seed.env.example",
        "env_check console --schema src/server/env.ts --export consoleEnvSchema",
      ],
      { est: 600 },
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The pool

/**
 * Run `steps` with at most `jobs` cores' worth of weight at once. A step starts when every step in
 * its `deps` has passed (a failed or blocked dependency blocks it), no running step holds its
 * `lock`, and its weight fits (a step of weight 0, network-bound, always fits). Ready steps start
 * longest-first (est, seconds). When the first ready step does not fit, it is given the time at
 * which the running steps' estimates free enough room for it, and a later step starts ahead of it
 * only if it is expected to end by then or fits in what is left over at that time ("EASY"
 * backfilling): free lanes are used and the waiting step is never starved. A running step past its
 * estimate is expected to end within `overrunMs`. `exec(step)` resolves to { ok: boolean }.
 */
export async function runPool(
  steps,
  { jobs, exec, onStart = () => {}, onEnd = () => {}, overrunMs = 30_000 },
) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  for (const s of steps)
    for (const d of s.deps) if (!byId.has(d)) throw new Error(`${s.id} needs unknown step ${d}`);
  const state = new Map(steps.map((s) => [s.id, "pending"]));
  const results = new Map();
  const locks = new Set();
  let used = 0;
  let wake;
  const running = new Set();
  const active = new Map(); // id -> { w, end } (expected end, ms)
  const order = steps.map((s, i) => ({ s, i }));
  const passed = (s) => s.deps.every((d) => state.get(d) === "pass" || state.get(d) === "warn");
  const blocked = (s) => s.deps.some((d) => ["fail", "blocked"].includes(state.get(d)));
  for (;;) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const { s } of order)
        if (state.get(s.id) === "pending" && blocked(s)) {
          state.set(s.id, "blocked");
          const r = { ok: false, status: "blocked", ms: 0 };
          results.set(s.id, r);
          onEnd(s, r);
          changed = true;
        }
    }
    const ready = order
      .filter(({ s }) => state.get(s.id) === "pending" && passed(s))
      // One at a time: the order of definition (ci.yml's), as a sequential run always did.
      .sort((a, b) => (jobs === 1 ? 0 : b.s.est - a.s.est) || a.i - b.i)
      .map(({ s }) => s);
    const now = Date.now();
    let shadow; // when the first step that does not fit is expected to fit
    let extra = 0; // room left over at that time
    for (const s of ready) {
      if (s.lock && locks.has(s.lock)) continue;
      const w = Math.min(s.weight, jobs);
      if (used + w > jobs) {
        if (shadow === undefined) {
          let free = jobs - used;
          shadow = now;
          const ends = [...active.values()]
            .map((a) => ({ w: a.w, end: a.end > now ? a.end : now + overrunMs }))
            .sort((a, b) => a.end - b.end);
          for (const e of ends) {
            if (free >= w) break;
            free += e.w;
            shadow = e.end;
          }
          extra = free - w;
        }
        continue;
      }
      if (shadow !== undefined && now + s.est * 1000 > shadow) {
        if (w > extra) continue;
        extra -= w;
      }
      used += w;
      active.set(s.id, { w, end: now + s.est * 1000 });
      if (s.lock) locks.add(s.lock);
      state.set(s.id, "running");
      onStart(s);
      const t0 = Date.now();
      const p = Promise.resolve()
        .then(() => exec(s))
        .catch((e) => ({ ok: false, error: e }))
        .then((r) => {
          const status = r.ok ? "pass" : s.soft ? "warn" : "fail";
          const res = { ...r, status, ms: Date.now() - t0 };
          state.set(s.id, status);
          results.set(s.id, res);
          used -= w;
          active.delete(s.id);
          if (s.lock) locks.delete(s.lock);
          running.delete(p);
          onEnd(s, res);
          wake?.();
        });
      running.add(p);
    }
    if (running.size === 0) break;
    await new Promise((r) => (wake = r));
  }
  return steps.map((s) => ({ step: s, ...results.get(s.id) }));
}

// ---------------------------------------------------------------------------------------------
// Running a step

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const until = async (what, fn, seconds) => {
  for (let i = 0; i < seconds * 2; i++) {
    try {
      if (fn()) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${what} not ready after ${seconds} s`);
};

/** A PostgreSQL container of the CI image for one step, with a database of its own. */
async function startPg(run, step, log) {
  const name = `ipb-check-${run.id}-${step.id}`.slice(0, 63);
  sh("docker", [
    "run",
    "-d",
    "--rm",
    "--name",
    name,
    "--label",
    `ipb-check-full=${run.id}`,
    "-e",
    "POSTGRES_PASSWORD=postgres",
    "-p",
    "127.0.0.1::5432",
    run.pgImage,
  ]);
  run.containers.add(name);
  const port = sh("docker", ["port", name, "5432/tcp"]).split("\n")[0].split(":").pop();
  // TCP readiness: the image's first-start server listens on the socket only, the final one on TCP.
  await until(
    "PostgreSQL",
    () => (sh("docker", ["exec", name, "pg_isready", "-U", "postgres", "-h", "127.0.0.1"]), true),
    90,
  );
  const db = `ipb_${step.id.replace(/^int-/, "").replace(/[^a-z0-9]+/g, "_")}_${randomHex(8)}`;
  const psql = (sql) =>
    sh("docker", [
      "exec",
      name,
      "psql",
      "-U",
      "postgres",
      "-h",
      "127.0.0.1",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ]);
  await until("PostgreSQL database", () => (psql(`create database ${db}`), true), 30);
  log.write(
    `[check:full] PostgreSQL ${run.pgImage} as ${name} on 127.0.0.1:${port}, database ${db}\n`,
  );
  return {
    env: { IPB_TEST_PG_URL: `postgres://postgres:postgres@127.0.0.1:${port}/${db}` },
    stop: () => {
      try {
        psql(`drop database if exists ${db} with (force)`);
      } catch (e) {
        log.write(`[check:full] drop database ${db}: ${e.message}\n`);
      }
      try {
        sh("docker", ["rm", "-f", "-v", name]); // -v: the image declares a data VOLUME
      } catch {
        /* already gone */
      }
      run.containers.delete(name);
    },
  };
}

/** MinIO for the STORAGE leg, through CI's own script (scripts/ci/minio-server.sh). */
async function startMinio(run, step, tmp, log) {
  const port = await freePort();
  const ghEnv = join(tmp, "github.env");
  writeFileSync(ghEnv, "");
  await new Promise((resolve, reject) => {
    const p = spawn("bash", ["scripts/ci/minio-server.sh"], {
      cwd: ROOT,
      env: {
        ...process.env,
        RUNNER_TEMP: tmp,
        GITHUB_ENV: ghEnv,
        IPB_MINIO_ADDRESS: `127.0.0.1:${port}`,
      },
      stdio: ["ignore", log, log],
    });
    p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`minio-server.sh exited ${c}`))));
  });
  const url = /IPB_TEST_MINIO_URL=(\S+)/.exec(readFileSync(ghEnv, "utf8"))?.[1];
  if (!url) throw new Error("minio-server.sh wrote no IPB_TEST_MINIO_URL");
  const pid = Number(readFileSync(join(tmp, "minio.pid"), "utf8"));
  run.pids.add(pid);
  return {
    env: { IPB_TEST_MINIO_URL: url },
    stop: () => {
      try {
        process.kill(pid);
      } catch {
        /* already gone */
      }
      run.pids.delete(pid);
    },
  };
}

function makeExec(run) {
  return async (step) => {
    const tmp = join(run.dir, "tmp", step.id);
    mkdirSync(tmp, { recursive: true });
    const logFile = join(run.dir, `${step.id}.log`);
    const log = createWriteStream(logFile);
    await new Promise((r) => log.once("open", r));
    log.write(
      `[check:full] ${step.name}\n[check:full] $ ${step.cmd.split("\n").join("\n[check:full] $ ")}\n`,
    );
    const resources = [];
    try {
      const env = {
        ...process.env,
        TMPDIR: tmp,
        // Read by vitest.shared.mjs and the package configs: no two steps share a Vitest cache.
        IPB_VITEST_CACHE_DIR: join(tmp, "vitest-cache"),
        // As in CI: Turborepo's cache starts empty for the run (the build is real), and is then
        // shared by the run's later turbo steps.
        TURBO_CACHE_DIR: run.turboCache,
        TURBO_TELEMETRY_DISABLED: "1",
        DO_NOT_TRACK: "1",
        LEFTHOOK: "0",
        FORCE_COLOR: "0",
      };
      if (step.resource === "pg") resources.push(await startPg(run, step, log));
      if (step.resource === "minio") resources.push(await startMinio(run, step, tmp, log));
      for (const r of resources) Object.assign(env, r.env);
      const code = await new Promise((resolve) => {
        const p = spawn("bash", ["-eo", "pipefail", "-c", step.cmd], {
          cwd: ROOT,
          env,
          stdio: ["ignore", "pipe", "pipe"],
          detached: true,
        });
        run.children.add(p);
        p.stdout.pipe(log, { end: false });
        p.stderr.pipe(log, { end: false });
        p.on("close", (c, sig) => {
          run.children.delete(p);
          resolve(c ?? (sig ? 128 : 1));
        });
      });
      log.write(`[check:full] exit ${code}\n`);
      return { ok: code === 0, log: logFile };
    } catch (e) {
      log.write(`[check:full] ${e.stack ?? e}\n`);
      return { ok: false, log: logFile, error: e };
    } finally {
      for (const r of resources.reverse()) r.stop();
      await new Promise((r) => log.end(r));
    }
  };
}

// ---------------------------------------------------------------------------------------------
// Report

export const fmt = (ms) => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
};

export function summaryTable(results, wallMs) {
  const w = Math.max(...results.map((r) => r.step.name.length), 4);
  const lines = [
    `${"step".padEnd(w)}  result   time     log`,
    `${"-".repeat(w)}  -------  -------  ---`,
  ];
  for (const r of results)
    lines.push(
      `${r.step.name.padEnd(w)}  ${r.status.toUpperCase().padEnd(7)}  ${fmt(r.ms).padStart(7)}  ${r.log ?? ""}`,
    );
  const count = (s) => results.filter((r) => r.status === s).length;
  lines.push(
    "",
    `${count("pass")} passed, ${count("fail")} failed, ${count("blocked")} blocked, ${count("warn")} warnings; wall time ${fmt(wallMs)}`,
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------

async function main(argv) {
  const o = parseArgs(argv);
  const steps = plan(o);
  if (o.list) {
    for (const s of steps) console.log(`${s.group.padEnd(11)} ${s.id.padEnd(28)} ${s.name}`);
    return 0;
  }
  const id = `${Date.now().toString(36)}${randomHex(4)}`;
  const dir = o.logs ?? mkdtempSync(join(tmpdir(), "ipb-check-full-"));
  mkdirSync(dir, { recursive: true });
  const images = testImages();
  const run = {
    id,
    dir,
    pgImage: images.pgvector,
    turboCache: join(dir, "turbo-cache"),
    containers: new Set(),
    pids: new Set(),
    children: new Set(),
  };
  // Timings of the last run order the ready steps longest-first.
  const timingsFile = join(CACHE, "timings.json");
  let timings = {};
  try {
    timings = JSON.parse(readFileSync(timingsFile, "utf8"));
  } catch {
    /* first run */
  }
  for (const s of steps) if (timings[s.id]) s.est = timings[s.id] / 1000;

  const cleanup = () => {
    for (const p of run.children)
      try {
        process.kill(-p.pid, "SIGTERM");
      } catch {
        /* gone */
      }
    for (const pid of run.pids)
      try {
        process.kill(pid);
      } catch {
        /* gone */
      }
    try {
      const left = sh("docker", ["ps", "-aq", "--filter", `label=ipb-check-full=${id}`]);
      if (left) sh("docker", ["rm", "-f", "-v", ...left.split("\n")]);
    } catch {
      /* no docker */
    }
  };
  for (const sig of ["SIGINT", "SIGTERM"])
    process.on(sig, () => {
      console.log(`\n[check:full] ${sig}: stopping steps and removing containers`);
      cleanup();
      process.exit(130);
    });

  console.log(
    `[check:full] ${steps.length} steps, pool of ${o.jobs} (base ${o.base}); logs in ${dir}`,
  );
  const notLocal = Object.entries(VERIFY_NOT_LOCAL).filter(
    ([n]) => !(o.prBody && n.startsWith("pr-checklist")),
  );
  for (const [n, why] of notLocal) console.log(`[check:full] not run here: ${n}: ${why}`);
  const t0 = Date.now();
  const stamp = () => fmt(Date.now() - t0).padStart(6);
  const results = await runPool(steps, {
    jobs: o.jobs,
    exec: makeExec(run),
    onStart: (s) => console.log(`${stamp()} start  ${s.name}`),
    onEnd: (s, r) =>
      console.log(
        `${stamp()} ${r.status.toUpperCase().padEnd(6)} ${s.name} (${fmt(r.ms)})${r.status === "fail" ? ` log: ${r.log ?? "-"}` : ""}`,
      ),
  });
  const wall = Date.now() - t0;
  cleanup();
  const table = summaryTable(results, wall);
  console.log(`\n${table}`);
  writeFileSync(join(dir, "summary.txt"), `${table}\n`);
  writeFileSync(
    join(dir, "summary.json"),
    JSON.stringify(
      {
        jobs: o.jobs,
        wallMs: wall,
        steps: results.map((r) => ({
          id: r.step.id,
          name: r.step.name,
          status: r.status,
          ms: r.ms,
        })),
      },
      null,
      2,
    ),
  );
  try {
    mkdirSync(CACHE, { recursive: true });
    for (const r of results) if (r.status !== "blocked") timings[r.step.id] = r.ms;
    writeFileSync(timingsFile, JSON.stringify(timings, null, 2));
  } catch {
    /* a convenience only */
  }
  return results.some((r) => r.status === "fail" || r.status === "blocked") ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`)
  main(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e) => {
      console.error(`check:full: ${e.message}`);
      process.exit(2);
    },
  );
