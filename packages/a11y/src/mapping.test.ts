import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { releaseChecklist } from "./checklist.js";
import { wcagMapping } from "./mapping.js";

const ipb06 = readFileSync(
  new URL("../../../docs/ipb/IPB-06_Accessibility_and_Inclusive_Design.md", import.meta.url),
  "utf8",
);

describe("WCAG 2.2 mapping (IPB-06-03)", () => {
  it("has an entry for every success criterion in IPB-06 §06.3.2, with the same level", () => {
    const rows = [...ipb06.matchAll(/^\| (\d\.\d+\.\d+) \| (A|AA) \| ([^|]+) \|/gm)].map((m) => ({
      sc: m[1]!,
      level: m[2]!,
    }));
    expect(rows).toHaveLength(55);
    const m = new Map(wcagMapping().criteria.map((c) => [c.sc, c]));
    for (const r of rows) expect(m.get(r.sc)?.level, r.sc).toBe(r.level);
    expect(m.size).toBe(55);
  });

  it("maps EN 301 549 clause 9 and leaves unverified clauses marked", () => {
    for (const c of wcagMapping().criteria) {
      expect(c.en_301_549 === "[VERIFY]" || c.en_301_549 === `9.${c.sc}`, c.sc).toBe(true);
      expect(c.is_17802).toBe("[VERIFY]");
    }
    const unverified = wcagMapping()
      .criteria.filter((c) => c.en_301_549 === "[VERIFY]")
      .map((c) => c.sc);
    expect(unverified).toEqual(["2.4.11", "2.5.7", "2.5.8", "3.2.6", "3.3.7", "3.3.8"]);
    expect(wcagMapping().criteria.find((c) => c.sc === "4.1.1")).toBeUndefined();
  });
});

describe("release checklist (IPB-06-55)", () => {
  it("has 40 numbered items covering the manual criteria IPB-06-55 names", () => {
    const items = releaseChecklist();
    expect(items.map((i) => i.id)).toEqual(
      Array.from({ length: 40 }, (_, i) => `C${String(i + 1).padStart(2, "0")}`),
    );
    const refs = items.map((i) => i.refs).join(" ");
    for (const sc of [
      "1.3.3",
      "2.4.4",
      "2.4.6",
      "3.2.1",
      "3.2.2",
      "3.2.3",
      "3.2.4",
      "3.3.3",
      "1.2.2",
    ])
      expect(refs, sc).toContain(sc);
  });

  it("covers every criterion the mapping tests only manually", () => {
    const refs = releaseChecklist()
      .map((i) => i.refs)
      .join(" ");
    for (const c of wcagMapping().criteria.filter((x) => x.methods.join() === "MANUAL"))
      expect(refs, c.sc).toContain(c.sc);
  });
});
