// PR-FBX-48 (R1-D-181): every fake moved to @infrabyx/fakes is the same object through
// @infrabyx/testing, so a product's tests and its fixture environment share one implementation.
import * as fakes from "@infrabyx/fakes";
import { describe, expect, it } from "vitest";
import * as testing from "./index.js";

describe("@infrabyx/testing re-exports @infrabyx/fakes (PR-FBX-48)", () => {
  it("re-exports every fake unchanged", () => {
    const missing: string[] = [];
    const different: string[] = [];
    for (const [name, value] of Object.entries(fakes)) {
      if (name === "PACKAGE_NAME") continue;
      if (!(name in testing)) missing.push(name);
      else if ((testing as Record<string, unknown>)[name] !== value) different.push(name);
    }
    expect(missing).toEqual([]);
    expect(different).toEqual([]);
  });

  it("does not list vitest, Testcontainers or pg among the fakes' runtime dependencies", async () => {
    const { readFile } = await import("node:fs/promises");
    const pj = JSON.parse(
      await readFile(new URL("../../fakes/package.json", import.meta.url), "utf8"),
    ) as { dependencies: Record<string, string> };
    expect(Object.keys(pj.dependencies)).not.toContain("vitest");
    expect(Object.keys(pj.dependencies).some((d) => /testcontainers|^pg$/.test(d))).toBe(false);
  });
});
