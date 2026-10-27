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

  it("reads .tsx and e2e test files, three-digit ATs, and skips build output", async () => {
    const tags = await collectTags(repo);
    expect(tags.get("IPB-04-AT-83")?.files).toContain("packages/consent/src/cmp.test.tsx");
    expect(tags.get("IPB-04-AT-101")?.files).toContain(
      "packages/cms/src/__tests__/studio.int.test.ts",
    );
    expect(tags.get("IPB-04-AT-74")?.files).toContain("apps/public/src/__tests__/site.e2e.test.ts");
    expect([...tags.values()].some((u) => u.files.some((f) => f.includes(".next/")))).toBe(false);
    expect(await specAts(join(repo, "docs/ipb"))).toContain("IPB-04-AT-101");
  });
});
