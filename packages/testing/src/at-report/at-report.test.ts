import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectTags, renderReport, specAts } from "./index.js";

const repo = join(import.meta.dirname, "../../../..");

describe("ipb:at-report", () => {
  it("finds the PL1 acceptance-test tags and the spec's ATs", async () => {
    const tags = await collectTags(join(repo, "packages"));
    for (const t of ["IPB-02-AT-15", "IPB-11-AT-01", "IPB-07-AT-05", "NN-01", "NN-45"])
      expect(tags.has(t)).toBe(true);
    const spec = await specAts(join(repo, "docs/ipb"));
    expect(spec).toContain("IPB-02-AT-15");
    expect(
      renderReport(
        tags,
        spec.filter((a) => a.startsWith("IPB-02")),
      ),
    ).toContain("| IPB-02-AT-15 | found |");
  });
});
