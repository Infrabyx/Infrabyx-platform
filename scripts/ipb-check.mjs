// IPB structural checks (grows with the IPB-09 required checks).
// Runs in CI as `pnpm ipb:check`. Exit code 1 on any failure.
import { readFileSync, existsSync, readdirSync } from "node:fs";

const NODE_PIN = "24.22.1";
let failures = 0;
const fail = (m) => {
  console.error("IPB-CHECK FAIL:", m);
  failures++;
};
const read = (p) => readFileSync(p, "utf8");
const json = (p) => JSON.parse(read(p));

// ---- pin-check (IPB-01-01 / IPB-D-01): the five locations must agree -----------------
if (read(".nvmrc").trim() !== NODE_PIN) fail(`.nvmrc must be ${NODE_PIN} (IPB-D-01)`);
const root = json("package.json");
if (root.engines?.node !== NODE_PIN)
  fail(`package.json engines.node must be exactly "${NODE_PIN}"`);
// pnpm major per ADR-0002 / IPB-DEV-02 (IPB-01-05 names pnpm 9; deviation recorded in docs/DECISIONS.md).
const PNPM_MAJOR = "10";
if (root.engines?.pnpm !== PNPM_MAJOR)
  fail(`package.json engines.pnpm must be "${PNPM_MAJOR}" (ADR-0002, IPB-DEV-02)`);
if (!new RegExp(`^pnpm@${PNPM_MAJOR}\\.\\d+\\.\\d+$`).test(root.packageManager ?? ""))
  fail(`package.json packageManager must pin an exact pnpm@${PNPM_MAJOR}.x.y (ADR-0002)`);
const ci = read(".github/workflows/ci.yml");
if (!ci.includes(`node: ["${NODE_PIN}"]`) && !ci.includes(`node: ['${NODE_PIN}']`)) {
  fail(`ci.yml must have a single-entry matrix node: ["${NODE_PIN}"] (IPB-01-01)`);
}
if (!ci.includes("node-version-file: .nvmrc"))
  fail("ci.yml setup-node must use node-version-file: .nvmrc");
for (const wf of readdirSync(".github/workflows")) {
  const y = read(`.github/workflows/${wf}`);
  for (const line of y.split("\n")) {
    const m = line.match(/uses:\s*([\w.-]+\/[\w.-]+)@(\S+)/);
    if (m && !/^[0-9a-f]{40}$/.test(m[2]))
      fail(
        `${wf}: action ${m[1]} must be pinned to a 40-char commit SHA (IPB-01 §01.4.1.1, IPB-02 supply chain)`,
      );
  }
}
const renovate = json("renovate.json");
const nodeRule = (renovate.packageRules ?? []).find(
  (r) =>
    (r.matchPackageNames ?? []).includes("node") &&
    typeof r.allowedVersions === "string" &&
    r.allowedVersions.includes("24"),
);
if (!nodeRule) fail("renovate.json must contain the IPB-01 §01.4.1.2 node 24.x pin rule");
for (const dir of ["apps", "infra/docker"]) {
  if (!existsSync(dir)) continue;
  const walk = (d) =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${d}/${e.name}`) : e.name === "Dockerfile" ? [`${d}/${e.name}`] : [],
    );
  for (const df of walk(dir)) {
    for (const line of read(df).split("\n")) {
      if (
        /^\s*FROM\s+node/i.test(line) &&
        !line.includes(`node:${NODE_PIN}-bookworm-slim@sha256:`)
      ) {
        fail(`${df}: FROM must be node:${NODE_PIN}-bookworm-slim@sha256:<digest> (IPB-01-01)`);
      }
    }
  }
}

// ---- .npmrc (IPB-01 §01.4.1.1) -----------------------------------------------------------
const npmrc = read(".npmrc");
for (const k of ["engine-strict=true", "auto-install-peers=true", "node-linker=isolated"]) {
  if (!npmrc.includes(k)) fail(`.npmrc must contain ${k}`);
}
if (/^[^#]*_authToken/m.test(npmrc))
  fail(".npmrc must not contain registry credentials (pnpm 10 ignores ${...} there; PL1-D-01)");

// ---- repository documents (CLAUDE.md session rules) --------------------------------------
for (const d of [
  "docs/ipb/00_README.md",
  "docs/ecosystem/infrabyx-integration-spec-v1.2.md",
  "docs/STATUS.md",
  "docs/DECISIONS.md",
  "docs/phases/README.md",
  "CLAUDE.md",
  ".github/CODEOWNERS",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".changeset/config.json",
  "renovate.json",
  "eslint.config.mjs",
  "infra/policy/eslint/index.mjs",
  "infra/policy/github/rulesets.json",
  "infra/docker/BASE_IMAGES.md",
  "docs/platform-requests.md",
  "docs/adr/ADR-0000-template.md",
  "commitlint.config.mjs",
  ".gitleaks.toml",
]) {
  if (!existsSync(d)) fail(`${d} missing`);
}
// Rulesets policy file (IPB-09 §09.4.1.4) must parse and target main.
try {
  const rs = json("infra/policy/github/rulesets.json");
  if (!(rs.rulesets ?? []).some((r) => r.name === "main"))
    fail("rulesets.json must define a ruleset named main");
} catch (e) {
  fail(`infra/policy/github/rulesets.json is not valid JSON: ${e.message}`);
}
// BASE_IMAGES.md must carry the digest for the pinned Node tag.
if (
  !new RegExp(`${NODE_PIN.replace(/\./g, "\\.")}-bookworm-slim`).test(
    read("infra/docker/BASE_IMAGES.md"),
  ) ||
  !/sha256:[0-9a-f]{64}/.test(read("infra/docker/BASE_IMAGES.md"))
) {
  fail(
    `infra/docker/BASE_IMAGES.md must record node:${NODE_PIN}-bookworm-slim with a sha256 digest`,
  );
}
// Dependabot is not used: Renovate is the single updater (PL0 plan R8).
if (existsSync(".github/dependabot.yml"))
  fail(".github/dependabot.yml must not exist (Renovate is the single updater)");
if (existsSync("SEED_CREDENTIALS.md")) fail("SEED_CREDENTIALS.md must never be committed (IPB-11)");
if (!read(".gitignore").includes("SEED_CREDENTIALS.md"))
  fail(".gitignore must ignore SEED_CREDENTIALS.md");

// ---- packages (IPB-14 §14.2 scaffold contract) -------------------------------------------
for (const p of readdirSync("packages")) {
  const base = `packages/${p}`;
  if (!existsSync(`${base}/package.json`)) {
    fail(`${base}: package.json missing`);
    continue;
  }
  const pj = json(`${base}/package.json`);
  if (pj.name !== `@infrabyx/${p}`) fail(`${p}: name must be @infrabyx/${p}`);
  if (pj.publishConfig?.registry !== "https://npm.pkg.github.com")
    fail(`${p}: publishConfig.registry must be GitHub Packages`);
  if (pj.engines?.node !== NODE_PIN) fail(`${p}: engines.node must be ${NODE_PIN}`);
  if (pj.private !== false) fail(`${p}: private must be false (publishable)`);
  if (pj.type !== "module") fail(`${p}: type must be "module" (ESM)`);
  for (const s of ["build", "test", "lint", "typecheck"])
    if (!pj.scripts?.[s]) fail(`${p}: missing script ${s}`);
  for (const f of ["README.md", "src/index.ts", "tsconfig.json", "tsconfig.build.json"]) {
    if (!existsSync(`${base}/${f}`)) fail(`${p}: ${f} missing`);
  }
  if (!readdirSync(`${base}/src`, { recursive: true }).some((f) => String(f).endsWith(".test.ts")))
    fail(`${p}: no test file in src/`);
  if (!/IPB-\d\d/.test(read(`${base}/README.md`)))
    fail(`${p}: README must name the IPB file that specifies it`);
  // Vendor SDKs are dependencies of packages/connectors only (IPB-01 §01.4.2).
  if (p !== "connectors") {
    for (const dep of Object.keys({ ...pj.dependencies, ...pj.peerDependencies })) {
      if (
        /^(@aws-sdk\/|@azure\/|@google-cloud\/|@anthropic-ai\/|openai$|razorpay$|stripe$|@supabase\/|twilio$)/.test(
          dep,
        )
      ) {
        fail(
          `${p}: vendor SDK dependency ${dep} is only allowed in packages/connectors (IPB-01-14)`,
        );
      }
    }
  }
}

if (failures) {
  console.error(`IPB-CHECK: ${failures} failure(s)`);
  process.exit(1);
}
console.log("IPB-CHECK OK");
