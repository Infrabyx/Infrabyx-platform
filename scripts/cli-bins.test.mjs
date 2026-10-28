// PR-UDF-005: every `infrabyx-*` CLI really runs when a product starts it. pnpm and npm start a bin
// through a symlinked path in node_modules while Node resolves the module to its real path, so an
// entry guard comparing the two skipped `main` and exited 0 with no output: a CI step built on it
// passed without running. Each bin runs here the three ways a product starts one: `pnpm exec`
// (a project linking the packages, whose bin shims go through `node_modules/@infrabyx/<pkg>`),
// `node node_modules/@infrabyx/<pkg>/<bin>` (the chart's migration job), and npm's `.bin` symlink.
// It must print its usage, or the report of the bins that run without arguments. Needs `pnpm build`.
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

/** What a bin prints when run with no arguments; the default is its usage line. */
const RAN = {
  "infrabyx-notify-lint": /notify-lint: \d+ finding/,
  "infrabyx-at-report": /\| Tag \| Status \|/,
};
const ran = (bin, r) => {
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return (RAN[bin] ?? new RegExp(`usage:\\s+${bin}\\b`)).test(out)
    ? "ran"
    : `did not run (exit ${r.status}, ${out.trim().slice(0, 160) || "no output"})`;
};

const packages = readdirSync(join(ROOT, "packages"))
  .map((d) => join(ROOT, "packages", d))
  .flatMap((dir) => {
    try {
      return [{ dir, pkg: JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) }];
    } catch {
      return [];
    }
  })
  .filter(({ pkg }) => pkg.bin && pkg.private !== true);
const bins = packages.flatMap(({ pkg }) =>
  Object.entries(pkg.bin).map(([bin, path]) => [bin, pkg.name, path]),
);

describe("PR-UDF-005 every platform CLI runs as a product starts it", () => {
  let app;
  const run = (cmd, args) => spawnSync(cmd, args, { cwd: app, encoding: "utf8", timeout: 60_000 });

  beforeAll(() => {
    app = mkdtempSync(join(tmpdir(), "ipb-cli-bins-"));
    const dependencies = Object.fromEntries(
      packages.map(({ dir, pkg }) => [pkg.name, `link:${dir}`]),
    );
    writeFileSync(
      join(app, "package.json"),
      JSON.stringify({ name: "cli-bins", private: true, dependencies }),
    );
    // link: dependencies only, so nothing is fetched; CI=true would otherwise demand a lockfile.
    // (With --ignore-scripts pnpm writes shims to the real path, which hides the fault.)
    execFileSync("pnpm", ["install", "--offline", "--no-frozen-lockfile"], {
      cwd: app,
      stdio: "pipe",
    });
    mkdirSync(join(app, "npm-bin"));
    for (const [bin, name, path] of bins)
      symlinkSync(join("..", "node_modules", name, path), join(app, "npm-bin", bin));
  }, 120_000);
  afterAll(() => {
    if (app) rmSync(app, { recursive: true, force: true });
  });

  it("finds every bin, and pnpm's shims start them through the node_modules symlink", () => {
    expect(bins.length).toBeGreaterThanOrEqual(14);
    expect(bins.map(([b]) => b)).toEqual(
      expect.arrayContaining(["infrabyx-env", "infrabyx-migrate", "infrabyx-seed"]),
    );
    for (const [bin, name, path] of bins)
      expect(readFileSync(join(app, "node_modules", ".bin", bin), "utf8"), bin).toContain(
        `"$basedir/../${name}/${path.replace(/^\.\//, "")}"`,
      );
  });

  it("tells a bin that exited without running", () => {
    expect(ran("infrabyx-env", { status: 0, stdout: "", stderr: "" })).toBe(
      "did not run (exit 0, no output)",
    );
  });

  it.each(bins)("%s (%s) runs through pnpm exec", (bin) => {
    expect(ran(bin, run("pnpm", ["exec", bin]))).toBe("ran");
  });

  it.each(bins)("%s (%s) runs as node node_modules/<package>/<bin>", (bin, name, path) => {
    expect(ran(bin, run(process.execPath, [join("node_modules", name, path)]))).toBe("ran");
  });

  it.each(bins)("%s (%s) runs through an npm .bin symlink", (bin) => {
    expect(ran(bin, run(join(app, "npm-bin", bin), []))).toBe("ran");
  });
});
