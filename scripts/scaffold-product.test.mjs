// The product scaffold (PL6 plan §9.1; IPB-14 §14.4 step 6). The `scaffold` CI job installs,
// lints, typechecks, tests and builds the result from a local registry; this test checks what the
// script writes, without an install.
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  APPS,
  assertPrettierInstalled,
  platformCommit,
  platformPackages,
  PRODUCT_DEFAULTS,
  productEnvExample,
  scaffold,
} from "./scaffold-product.mjs";

const out = join(mkdtempSync(join(tmpdir(), "scaffold-")), "product");
const read = (p) => readFileSync(join(out, p), "utf8");
const json = (p) => JSON.parse(read(p));
const pkgs = platformPackages();

beforeAll(async () => {
  await scaffold({ product: "UDF", name: "Udofin", out, now: new Date("2026-10-28T00:00:00Z") });
}, 120_000);

describe("scaffold-product", () => {
  it("writes the five apps under the product's scope, every platform package pinned exactly", () => {
    for (const a of APPS) {
      const p = json(`apps/${a.to}/package.json`);
      expect(p.name).toBe(`@udf/${a.to}`);
      for (const deps of [p.dependencies ?? {}, p.devDependencies ?? {}])
        for (const [name, range] of Object.entries(deps)) {
          if (name.startsWith("@infrabyx/")) expect(range, name).toBe(pkgs[name].version);
          else if (String(range).startsWith("workspace:")) expect(name).toMatch(/^@udf\//);
        }
    }
    expect(json("apps/worker/package.json").dependencies["@udf/api"]).toBe("workspace:*");
    expect(read("apps/worker/src/main.ts")).toContain('import "@udf/api/worker-main"');
    expect(read("apps/api/tsconfig.json")).toContain('"extends": "../../tsconfig.base.json"');
    expect(read("apps/api/src/env.ts")).toContain('ProductCode.default("UDF")');
  });

  it("writes the toolchain: Node, pnpm, the 7-day age with @infrabyx/* exempt, and no credential", () => {
    expect(read(".nvmrc")).toBe(readFileSync(new URL("../.nvmrc", import.meta.url), "utf8"));
    const root = json("package.json");
    expect(root.packageManager).toMatch(/^pnpm@10\./);
    expect(root.engines.node).toBe("24.22.1");
    expect(root.infrabyx).toEqual({ product: "UDF" });
    expect(root.devDependencies["@infrabyx/testing"]).toBe(pkgs["@infrabyx/testing"].version);
    const ws = read("pnpm-workspace.yaml");
    expect(ws).toContain('  - "apps/*"');
    expect(ws).not.toContain("packages/*");
    expect(ws).toContain("minimumReleaseAge: 10080");
    expect(ws).toContain('  - "@infrabyx/*"');
    const npmrc = read(".npmrc");
    expect(npmrc).toContain("@infrabyx:registry=https://npm.pkg.github.com");
    expect(npmrc).not.toMatch(/_authToken=|\$\{NODE_AUTH_TOKEN\}\s*$/m);
    expect(read("eslint.config.mjs")).toContain('import ipb from "@infrabyx/testing/eslint"');
  });

  it("writes CI, the PR template, CLAUDE.md and the docs with a provided-by row per package", () => {
    const ci = read(".github/workflows/ci.yml");
    for (const step of ["name: lint", "name: typecheck", "name: unit", "name: build"])
      expect(ci).toContain(step);
    expect(ci).toMatch(/uses: actions\/checkout@[a-f0-9]{40}/);
    expect(existsSync(join(out, ".github/PULL_REQUEST_TEMPLATE.md"))).toBe(true);
    expect(read("CLAUDE.md")).toContain("Never fork or patch a platform package");
    const decisions = read("docs/DECISIONS.md");
    for (const name of Object.keys(pkgs))
      expect(decisions).toContain(`provided by ${name} ${pkgs[name].version}`);
    expect(read("docs/platform-requests.md")).toContain(
      "| Date | IPB ID | Request | Shim | Status |",
    );
    expect(read("docs/STATUS.md")).toContain("2026-10-28");
  });

  it("writes the local stack, the chart values and the OpenTofu stacks for the product", () => {
    const devUp = read("scripts/dev-up.mjs");
    expect(devUp).toContain('const PRODUCT = "UDF";');
    expect(devUp).not.toContain('APP_PRODUCT: "OH"');
    expect(devUp).toContain("node_modules/@infrabyx/tenancy/dist/migrate/cli.js");
    expect(devUp).not.toMatch(/"packages\/|apps\/reference\/api/);
    expect(read("infra/compose/docker-compose.yml")).toContain("APP: api");
    expect(existsSync(join(out, "infra/helm/api/values.prod.yaml"))).toBe(true);
    for (const env of ["dev", "staging", "prod"])
      expect(read(`infra/terraform/envs/udf/${env}/main.tf`)).toContain(
        `git::https://github.com/Infrabyx/Infrabyx-platform.git//infra/terraform/modules/aws/platform?ref=${platformCommit()}"`,
      );
    expect(platformCommit()).toMatch(/^[0-9a-f]{40}$/);
  });

  // PR-UDF-006: each slip the Udofin scaffold hit; the `scaffold` job checks them on a real install.
  it("replaces the reference app's default product everywhere it is copied, tests included", () => {
    const env = read("apps/api/src/env.ts");
    expect(env).toContain('ProductCode.default("UDF")');
    expect(env).toMatch(/APP_PRODUCT: envVar\([^)]*\), \{[^}]*example: "UDF"/);
    expect(read("apps/api/src/env.test.ts")).toContain('expect(v.APP_PRODUCT).toBe("UDF")');
    expect(read("apps/web/src/app/assets/web.css/route.ts")).toContain('themeCss("UDF")');
    // The group's console and site list every brand product (LD among them); checked below.
    for (const [file] of PRODUCT_DEFAULTS.filter(([f]) => !/^apps\/(console|public)\//.test(f)))
      expect(read(file), file).not.toMatch(/\("LD"\)|"LD",/);
  });

  // PR-FBX-06: under pnpm's isolated linker the api resolves only what it declares, so a platform
  // package missing here had its migrations skipped; the reference test also hard-coded LD.
  it("declares every platform package with migrations in the api, and its tests use the product", async () => {
    const { PLATFORM_MIGRATION_PACKAGES } =
      await import("../packages/tenancy/dist/migrate/index.js");
    const deps = json("apps/api/package.json").dependencies;
    for (const name of PLATFORM_MIGRATION_PACKAGES)
      expect(deps[name], name).toBe(pkgs[name].version);
    const int = read("apps/api/src/__tests__/api.int.test.ts");
    expect(int).toContain("requirePlatform: true");
    expect(int).not.toMatch(/'LD'|"LD"|in\.ld\./);
  });

  // PR-FBX-03: the console and the public site are copied from the group's (OH, GRP).
  it("gives the console and the public site the product's code, theme and brand pack", () => {
    expect(read("apps/console/src/app/assets/console.css/route.ts")).toContain('themeCss("UDF")');
    expect(read("apps/console/src/server/console.ts")).toContain('const product = "UDF";');
    const site = read("apps/public/src/server/site.ts");
    expect(site).toContain('product: "UDF";');
    expect(site).toContain('const product = "UDF" as const;');
    expect(read("apps/public/src/server/env.ts")).toMatch(
      /APP_BRAND_PRODUCT: envVar\([^)]*\)\.default\("UDF"\), \{[^}]*example: "UDF"/,
    );
    // The public seed makes the pack the site serves: APP_BRAND_PRODUCT, defaulted above (PR-FBX-08).
    expect(read("apps/public/src/seed/public-site.ts")).toContain("APP_BRAND_PRODUCT");
    expect(read("apps/public/.env.example")).toMatch(/^APP_BRAND_PRODUCT=UDF {26}# Brand product/m);
  });

  it("writes the .env.example files for the product, as infrabyx-env example --product does", () => {
    const examples = APPS.flatMap((a) =>
      readdirSync(join(out, "apps", a.to))
        .filter((f) => f.endsWith(".env.example"))
        .map((f) => `apps/${a.to}/${f}`),
    );
    expect(examples.length).toBeGreaterThanOrEqual(5);
    for (const f of examples) {
      expect(read(f), f).not.toContain("<PRODUCT>");
      expect(read(f), f).toContain("# Infrabyx UDF — environment template");
    }
    const line = read("apps/api/.env.example")
      .split("\n")
      .find((l) => l.startsWith("APP_PRODUCT="));
    expect(line).toMatch(/^APP_PRODUCT=UDF {32}# The product this instance/);
    expect(productEnvExample("APP_PRODUCT=LD     # x\n", "LDC")).toBe(
      `${"APP_PRODUCT=LDC".padEnd(46)} # x\n`,
    );
  });

  it("refuses to start, writing nothing, when prettier is not installed in the platform checkout", async () => {
    const bare = mkdtempSync(join(tmpdir(), "scaffold-bare-"));
    writeFileSync(join(bare, "package.json"), "{}");
    expect(() => assertPrettierInstalled(bare)).toThrow(
      /prettier is not installed in the platform checkout .*pnpm install --frozen-lockfile.*nothing was written/,
    );
    expect(() => assertPrettierInstalled()).not.toThrow();
  });

  it("refuses an unknown product or a folder that is not empty", async () => {
    await expect(
      scaffold({ product: "XX", name: "x", out: join(tmpdir(), "nope") }),
    ).rejects.toThrow(/--product/);
    await expect(scaffold({ product: "UDF", name: "x", out })).rejects.toThrow(/not empty/);
  });
});
