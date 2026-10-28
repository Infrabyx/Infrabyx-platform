// The product scaffold (PL6 plan §9.1; IPB-14 §14.4 step 6). The `scaffold` CI job installs,
// lints, typechecks, tests and builds the result from a local registry; this test checks what the
// script writes, without an install.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { APPS, platformPackages, scaffold } from "./scaffold-product.mjs";

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
    expect(devUp).toContain("node_modules/@infrabyx/tenancy/dist/migrate/cli.js");
    expect(devUp).not.toMatch(/"packages\/|apps\/reference\/api/);
    expect(read("infra/compose/docker-compose.yml")).toContain("APP: api");
    expect(existsSync(join(out, "infra/helm/api/values.prod.yaml"))).toBe(true);
    for (const env of ["dev", "staging", "prod"])
      expect(read(`infra/terraform/envs/udf/${env}/main.tf`)).toContain(
        "git::https://github.com/Infrabyx/Infrabyx-platform.git//infra/terraform/modules/aws/platform",
      );
  });

  it("refuses an unknown product or a folder that is not empty", async () => {
    await expect(
      scaffold({ product: "XX", name: "x", out: join(tmpdir(), "nope") }),
    ).rejects.toThrow(/--product/);
    await expect(scaffold({ product: "UDF", name: "x", out })).rejects.toThrow(/not empty/);
  });
});
