// PR-FBX-06: a platform package with migrations that cannot be resolved is named, or refused, never
// skipped in silence.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLATFORM_MIGRATION_PACKAGES, platformSources } from "./index.js";

/** A project folder whose node_modules holds the given packages. */
function project(...names: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "ipb-sources-"));
  writeFileSync(join(dir, "package.json"), "{}");
  for (const n of names) {
    mkdirSync(join(dir, "node_modules", n, "migrations"), { recursive: true });
    writeFileSync(join(dir, "node_modules", n, "package.json"), JSON.stringify({ name: n }));
  }
  return dir;
}

describe("platformSources (PR-FBX-06)", () => {
  const names = ["@fake/one", "@fake/two"];

  it("skips a package it cannot resolve and names it", () => {
    const dir = project("@fake/one");
    const skipped: string[][] = [];
    const s = platformSources(dir, names, { onSkipped: (n) => skipped.push(n) });
    expect(s).toEqual([{ name: "@fake/one", dir: join(dir, "node_modules/@fake/one/migrations") }]);
    expect(skipped).toEqual([["@fake/two"]]);
  });

  it("refuses with IPB-MOD-001 naming every missing package when asked to", () => {
    expect(() => platformSources(project(), names, { missing: "error" })).toThrow(
      /IPB-MOD-001.*not installed: @fake\/one, @fake\/two/,
    );
  });

  it("resolves each package from the first directory that has it", () => {
    const a = project("@fake/one");
    const b = project("@fake/one", "@fake/two");
    const s = platformSources([a, b], names, { missing: "error" });
    expect(s.map((x) => x.dir)).toEqual([
      join(a, "node_modules/@fake/one/migrations"),
      join(b, "node_modules/@fake/two/migrations"),
    ]);
  });

  it("finds every platform package in this repository, without calling onSkipped", () => {
    let called = false;
    const s = platformSources(project(), PLATFORM_MIGRATION_PACKAGES, {
      missing: "error",
      onSkipped: () => (called = true),
    });
    expect(s.map((x) => x.name)).toEqual([...PLATFORM_MIGRATION_PACKAGES]);
    expect(called).toBe(false);
  });
});
