// Output parity across clouds (@IPB-01-AT-14, IPB-01-34; PL6 plan §7.3): every cloud's platform
// module declares exactly the outputs of outputs.schema.json, and every object output carries each
// of its keys. The values and their types are asserted by each cloud's `tofu test`.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const contract = JSON.parse(readFileSync(join(import.meta.dirname, "outputs.schema.json"), "utf8"));
const CLOUDS = ["aws", "azure", "gcp"];

/** Output name => the text of its block. */
function outputs(file) {
  const text = readFileSync(file, "utf8");
  const out = {};
  const re = /^output "([a-z_]+)" \{/gm;
  const starts = [...text.matchAll(re)];
  starts.forEach((m, i) => {
    out[m[1]] = text.slice(m.index, starts[i + 1]?.index ?? text.length);
  });
  return out;
}

describe("@IPB-01-AT-14 output contract", () => {
  it("lists the bucket classes and the locked ones", () => {
    expect(contract.locked_classes.every((c) => contract.bucket_classes.includes(c))).toBe(true);
    expect(contract.bucket_classes).toEqual([
      "AUDIT",
      "REGULATED",
      "CONFIDENTIAL",
      "GENERAL",
      "PUBLIC_ASSETS",
    ]);
  });

  for (const cloud of CLOUDS) {
    const file = join(ROOT, "modules", cloud, "platform", "outputs.tf");
    it.skipIf(!existsSync(file))(`${cloud}: the platform module returns every contract key`, () => {
      const got = outputs(file);
      expect(Object.keys(got).sort()).toEqual(Object.keys(contract.outputs).sort());
      for (const [name, shape] of Object.entries(contract.outputs)) {
        if (typeof shape === "string") continue;
        for (const key of Object.keys(shape))
          expect(got[name], `${cloud} ${name}.${key}`).toMatch(new RegExp(`^\\s+${key}\\s+=`, "m"));
      }
    });
  }
});
