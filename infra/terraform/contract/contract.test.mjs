// Output parity across clouds (@IPB-01-AT-14, IPB-01-34; PL6 plan §7.3): every cloud's platform
// module declares exactly the outputs of outputs.schema.json, and every object output carries each
// of its keys. The values and their types are asserted by each cloud's `tofu test`.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// The source of truth for compartments (PR-LDC-60): read from the package itself, so the contract
// cannot drift from what the STORAGE adapter accepts.
import {
  BUCKET_CLASSES,
  COMPARTMENT_CLASSES,
  STORAGE_COMPARTMENTS,
  compartmentAllowed,
} from "../../../packages/contracts/src/ports/storage.ts";

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

  it("lists the compartments and the classes they may be used in, as @infrabyx/contracts does", () => {
    expect(contract.compartments).toEqual([...STORAGE_COMPARTMENTS]);
    expect([...contract.compartment_classes].sort()).toEqual([...COMPARTMENT_CLASSES].sort());
    for (const cls of BUCKET_CLASSES)
      for (const cmp of STORAGE_COMPARTMENTS)
        expect(compartmentAllowed(cls, cmp), `${cls}.${cmp}`).toBe(
          contract.compartment_classes.includes(cls),
        );
    expect(contract.compartment_classes.every((c) => contract.locked_classes.includes(c))).toBe(
      true,
    );
  });

  // The modules list the classes as REGULATED, CONFIDENTIAL.
  const classesInVar = [...contract.compartment_classes].sort().reverse();
  const hcl = (list) => `[${list.map((x) => JSON.stringify(x)).join(", ")}]`;
  for (const cloud of CLOUDS) {
    const dir = join(ROOT, "modules", cloud);
    it(`${cloud}: storage_compartments is accepted by platform, object_storage and kms with the contract's values`, () => {
      for (const mod of ["platform", "object_storage"]) {
        const vars = readFileSync(join(dir, mod, "variables.tf"), "utf8");
        const block = vars.slice(vars.indexOf('variable "storage_compartments"'));
        expect(block, `${cloud}/${mod}`).toMatch(/^\s+default = \[\]$/m);
        expect(block).toContain(`contains(${hcl(classesInVar)}, p.class)`);
        expect(block).toContain(`contains(${hcl(contract.compartments)}, p.compartment)`);
      }
      // The kms module takes the locations as "<CLASS>.<COMPARTMENT>" strings.
      const pattern = `^(${classesInVar.join("|")})\\\\.(${contract.compartments.join("|")})$`;
      expect(readFileSync(join(dir, "kms", "variables.tf"), "utf8")).toContain(pattern);
    });

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
