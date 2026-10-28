#!/usr/bin/env node
// pnpm bom (IPB-01-40, @IPB-01-AT-18; PL6 plan §9.2): the reference deployment's bill of materials as
// CycloneDX 1.6 JSON, from pnpm-lock.yaml and the workspace packages, the Node.js and pnpm pins, the
// base images of infra/docker, the Compose images (PostgreSQL, Redis, Keycloak, Temporal…) and the
// Helm chart. Validated offline against the vendored CycloneDX schema before it is written. The
// release job signs it with cosign keyless and attests every published package with it (owner
// answer #67(1), PL6-D-16); the Terraform state inputs wait for a deployed environment. The BOM
// says both in its metadata.
//   node scripts/bom.mjs --release <id> [--out <file>]   # default docs/bom/<id>.cdx.json
//   node scripts/bom.mjs --validate <file>
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parseArgs } from "node:util";
import { createRequire } from "node:module";
import { parse as parseYaml } from "yaml";

const ROOT = new URL("..", import.meta.url).pathname;
const require = createRequire(import.meta.url);
const read = (p) => readFileSync(join(ROOT, p), "utf8");

/** A CycloneDX npm purl: `@scope/name` is `%40scope/name`. */
export const npmPurl = (name, version) =>
  `pkg:npm/${name.startsWith("@") ? `%40${name.slice(1)}` : name}@${version}`;

/** `sha512-<base64>` (or sha1) from the lockfile as a CycloneDX hash. */
function hashOf(integrity) {
  const m = /^(sha512|sha1)-(.+)$/.exec(integrity ?? "");
  if (!m) return null;
  return {
    alg: m[1] === "sha512" ? "SHA-512" : "SHA-1",
    content: Buffer.from(m[2], "base64").toString("hex"),
  };
}

/** `name@version` keys of the lockfile's `packages:` section. */
function lockPackages(lock) {
  const out = [];
  for (const [key, v] of Object.entries(lock.packages ?? {})) {
    const at = key.lastIndexOf("@");
    if (at <= 0) continue;
    const name = key.slice(0, at);
    const version = key.slice(at + 1);
    if (!/^\d/.test(version)) continue;
    out.push({ name, version, hash: hashOf(v?.resolution?.integrity) });
  }
  return out;
}

function workspacePackages() {
  const out = [];
  for (const base of ["packages", "apps", "apps/reference"]) {
    const dir = join(ROOT, base);
    if (!existsSync(dir)) continue;
    for (const d of readdirSync(dir)) {
      const pj = join(dir, d, "package.json");
      if (!existsSync(pj)) continue;
      const p = JSON.parse(readFileSync(pj, "utf8"));
      out.push({
        name: p.name,
        version: p.version,
        private: p.private === true,
        path: `${base}/${d}`,
      });
    }
  }
  return out;
}

/** `repo[:tag][@sha256:digest]` → a container component (images built here are skipped). */
function imageComponent(ref, where) {
  const m = /^([a-z0-9./_-]+?)(?::([A-Za-z0-9._-]+))?(?:@sha256:([a-f0-9]{64}))?$/.exec(ref);
  if (!m) throw new Error(`cannot read image reference ${ref} in ${where}`);
  const [, repo, tag, digest] = m;
  if (repo.startsWith("infrabyx/") && !digest) return null; // built from this repository
  const name = repo.includes("/") ? repo : `library/${repo}`;
  const qualifiers = [`repository_url=docker.io/${name}`, ...(tag ? [`tag=${tag}`] : [])].join("&");
  return {
    type: "container",
    "bom-ref": `image:${ref}`,
    name: repo,
    ...(tag ? { version: tag } : {}),
    ...(digest ? { hashes: [{ alg: "SHA-256", content: digest }] } : {}),
    purl: `pkg:docker/${name}${digest ? `@sha256:${digest}` : tag ? `@${tag}` : ""}?${qualifiers}`,
    properties: [{ name: "infrabyx:source", value: where }],
  };
}

/** Versions of the images pinned by digest only, from the test image table (`@infrabyx/testing`). */
async function knownVersions() {
  try {
    const { TEST_IMAGES } = await import(join(ROOT, "packages/testing/dist/containers.js"));
    return new Map(
      Object.values(TEST_IMAGES)
        .map((i) => [/@sha256:([a-f0-9]{64})$/.exec(i.image)?.[1], i.version])
        .filter(([d]) => d),
    );
  } catch {
    return new Map();
  }
}

function images() {
  const refs = new Map();
  for (const dir of readdirSync(join(ROOT, "infra/docker"))) {
    const f = join("infra/docker", dir, "Dockerfile");
    if (!existsSync(join(ROOT, f))) continue;
    for (const m of read(f).matchAll(/^FROM\s+(\S+)/gm))
      if (/[:@]/.test(m[1]) && !refs.has(m[1])) refs.set(m[1], f);
  }
  for (const m of read("infra/compose/docker-compose.yml").matchAll(/^\s+image:\s+(\S+)/gm))
    if (!refs.has(m[1])) refs.set(m[1], "infra/compose/docker-compose.yml");
  return [...refs].map(([ref, where]) => imageComponent(ref, where)).filter(Boolean);
}

/** A deterministic RFC 4122 (version 5 layout) UUID from a hex digest. */
function uuidFrom(hex) {
  const h = hex.slice(0, 32).split("");
  h[12] = "5";
  h[16] = "89ab"[parseInt(h[16], 16) & 3];
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** Build the BOM. `sha256Hex` comes from @infrabyx/crypto (no direct crypto in repo tooling). */
export async function buildBom({ release, now = new Date() }) {
  const { sha256Hex } = await import(join(ROOT, "packages/crypto/dist/index.js"));
  const node = read(".nvmrc").trim().replace(/^v/, "");
  const rootPkg = JSON.parse(read("package.json"));
  const pnpm = /^pnpm@([^+]+)/.exec(rootPkg.packageManager ?? "")?.[1];
  const chart = parseYaml(read("infra/helm/infrabyx-app/Chart.yaml"));
  const lock = parseYaml(read("pnpm-lock.yaml"));
  const versions = await knownVersions();
  const imgs = images().map((c) => {
    const d = c.hashes?.[0]?.content;
    const v = !c.version && d ? versions.get(d) : undefined;
    return v ? { ...c, version: String(v).replace(/[^A-Za-z0-9.,_ -]/g, "") } : c;
  });
  const pg = imgs.map((c) => /-pg(\d+)$/.exec(c.version ?? "")?.[1]).find((v) => v !== undefined);
  const pgvector = imgs.find((c) => c.name === "pgvector/pgvector")?.version?.split("-pg")[0];

  const components = [
    {
      type: "platform",
      "bom-ref": `runtime:node@${node}`,
      name: "node",
      version: node,
      purl: `pkg:generic/node@${node}`,
      description: "Node.js runtime (IPB-D-01; .nvmrc, engines, the base images)",
    },
    ...(pnpm
      ? [
          {
            type: "application",
            "bom-ref": npmPurl("pnpm", pnpm),
            name: "pnpm",
            version: pnpm,
            purl: npmPurl("pnpm", pnpm),
            description: "Package manager (ADR-0002, IPB-DEV-02)",
          },
        ]
      : []),
    ...(pg
      ? [
          {
            type: "application",
            "bom-ref": `database:postgresql@${pg}`,
            name: "postgresql",
            version: pg,
            purl: `pkg:generic/postgresql@${pg}`,
            description: "Database engine (IPB-D-02); the Compose image ships it with pgvector",
          },
        ]
      : []),
    ...(pgvector
      ? [
          {
            type: "library",
            "bom-ref": `extension:pgvector@${pgvector}`,
            name: "pgvector",
            version: pgvector,
            purl: `pkg:generic/pgvector@${pgvector}`,
          },
        ]
      : []),
    {
      type: "application",
      "bom-ref": `helm:${chart.name}@${chart.version}`,
      name: chart.name,
      version: String(chart.version),
      description: chart.description,
      properties: [{ name: "infrabyx:artefact", value: "helm-chart (infra/helm/infrabyx-app)" }],
    },
    ...imgs,
    ...workspacePackages().map((p) => ({
      type: p.private ? "application" : "library",
      "bom-ref": npmPurl(p.name, p.version),
      group: p.name.startsWith("@") ? p.name.split("/")[0] : undefined,
      name: p.name.startsWith("@") ? p.name.split("/")[1] : p.name,
      version: p.version,
      purl: npmPurl(p.name, p.version),
      properties: [{ name: "infrabyx:workspace", value: p.path }],
    })),
    ...lockPackages(lock).map((p) => ({
      type: "library",
      "bom-ref": npmPurl(p.name, p.version),
      ...(p.name.startsWith("@") ? { group: p.name.split("/")[0] } : {}),
      name: p.name.startsWith("@") ? p.name.split("/")[1] : p.name,
      version: p.version,
      purl: npmPurl(p.name, p.version),
      ...(p.hash ? { hashes: [p.hash] } : {}),
    })),
  ].map((c) => Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)));
  // One component per bom-ref (a workspace package also in the lockfile is listed once).
  const seen = new Set();
  const unique = components.filter((c) => !seen.has(c["bom-ref"]) && seen.add(c["bom-ref"]));
  const digest = sha256Hex(JSON.stringify({ release, refs: unique.map((c) => c["bom-ref"]) }));
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${uuidFrom(digest)}`,
    version: 1,
    metadata: {
      timestamp: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
      tools: { components: [{ type: "application", name: "infrabyx-bom", version: "1" }] },
      component: {
        type: "application",
        "bom-ref": `release:${release}`,
        name: "infrabyx-platform",
        version: release,
        description: "The Infrabyx platform reference deployment (IPB-01 §01.4.12)",
      },
      properties: [
        {
          name: "infrabyx:signature",
          value:
            "cosign keyless, detached: <file>.sigstore.json, signed by .github/workflows/release.yml@refs/heads/main (PL6-D-16)",
        },
        {
          name: "infrabyx:terraform-state",
          value: "none: no deployed environment yet (no hosted environment, owner answer #67(2))",
        },
      ],
    },
    components: unique,
  };
}

let validator;
/** Validate against the vendored CycloneDX 1.6 schema; returns the error messages (empty when valid). */
export function validateBom(bom) {
  if (!validator) {
    const Ajv = require("ajv").default;
    const addFormats = require("ajv-formats").default;
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    // The schema's internationalised formats, which ajv-formats does not define, checked loosely.
    ajv.addFormat("iri-reference", /^\S+$/);
    ajv.addFormat("idn-email", /^[^\s@]+@[^\s@]+$/);
    for (const f of ["spdx.schema.json", "jsf-0.82.schema.json"])
      ajv.addSchema(JSON.parse(readFileSync(join(ROOT, "scripts/bom/schema", f), "utf8")));
    validator = ajv.compile(
      JSON.parse(readFileSync(join(ROOT, "scripts/bom/schema/bom-1.6.schema.json"), "utf8")),
    );
  }
  return validator(bom) ? [] : validator.errors.map((e) => `${e.instancePath || "/"} ${e.message}`);
}

async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      release: { type: "string" },
      out: { type: "string" },
      validate: { type: "string" },
      now: { type: "string" },
    },
  });
  if (values.validate) {
    const errors = validateBom(JSON.parse(readFileSync(values.validate, "utf8")));
    if (errors.length) {
      console.error(`bom: ${values.validate} is not valid CycloneDX 1.6:\n${errors.join("\n")}`);
      return 1;
    }
    console.log(`${values.validate} is valid CycloneDX 1.6`);
    return 0;
  }
  if (!values.release || !/^[A-Za-z0-9._-]+$/.test(values.release)) {
    console.error("usage: node scripts/bom.mjs --release <id> [--out <file>]");
    return 2;
  }
  const bom = await buildBom({
    release: values.release,
    ...(values.now ? { now: new Date(values.now) } : {}),
  });
  const errors = validateBom(bom);
  if (errors.length) {
    console.error(
      `bom: the generated BOM is not valid CycloneDX 1.6:\n${errors.slice(0, 20).join("\n")}`,
    );
    return 1;
  }
  const out = values.out ?? join(ROOT, "docs/bom", `${values.release}.cdx.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(bom, null, 2)}\n`);
  console.log(
    `wrote ${relative(ROOT, out) || out} (${bom.components.length} components, CycloneDX 1.6)`,
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`)
  process.exitCode = await main(process.argv.slice(2));
export { main };
