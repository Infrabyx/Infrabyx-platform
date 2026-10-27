import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";

let dir: string;
let output: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "a11y-cli-"));
  output = "";
  vi.spyOn(process.stdout, "write").mockImplementation((s) => {
    output += String(s);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((s) => {
    output += String(s);
    return true;
  });
});
afterEach(() => vi.restoreAllMocks());

describe("infrabyx-a11y", () => {
  it("journeys-lint exits 1 on IPB-A11Y-009 and on an uncovered route", () => {
    const f = join(dir, "journeys.yaml");
    writeFileSync(
      f,
      "product: GRP\njourneys:\n  - { id: grp.visitor.contact, persona: visitor, title: Contact us, routes: [/contact], voice: true, at_scripts: [contact.nvda.md] }\n",
    );
    expect(main(["journeys-lint", f])).toBe(1);
    expect(output).toContain("IPB-A11Y-009");
    writeFileSync(join(dir, "routes.txt"), "/contact\n/about # new page\n");
    writeFileSync(
      f,
      "product: GRP\njourneys:\n  - { id: grp.visitor.contact, persona: visitor, title: Contact us, routes: [/contact], at_scripts: [contact.nvda.md] }\n",
    );
    output = "";
    expect(main(["journeys-lint", f, "--routes", join(dir, "routes.txt")])).toBe(1);
    expect(output).toContain("route /about is in no journey");
  });

  it("overlay-scan exits 0 on clean output and 1 on a signature", () => {
    writeFileSync(join(dir, "a.js"), "console.log(1)");
    expect(main(["overlay-scan", dir])).toBe(0);
    writeFileSync(
      join(dir, "b.html"),
      `<script src="https://${["equalweb", "com"].join(".")}/x.js"></script>`,
    );
    expect(main(["overlay-scan", dir])).toBe(1);
    expect(output).toContain("IPB-A11Y-003");
  });

  it("lighthouse evaluates result files; usage errors exit 2", () => {
    const f = join(dir, "lhr.json");
    writeFileSync(
      f,
      JSON.stringify({
        finalUrl: "http://x/",
        categories: { accessibility: { score: 0.97, auditRefs: [] } },
        audits: {},
      }),
    );
    expect(main(["lighthouse", f])).toBe(0);
    expect(main(["lighthouse", f, "--min", "99"])).toBe(1);
    expect(main(["nope"])).toBe(2);
    expect(main(["overlay-scan", "--bogus", "x"])).toBe(1);
  });

  it("statement writes the HTML page", () => {
    const rec = JSON.parse(
      readFileSync(new URL("./__fixtures__/release-record.json", import.meta.url), "utf8"),
    );
    const f = join(dir, "rec.json");
    writeFileSync(f, JSON.stringify(rec));
    expect(main(["statement", f, "--out", join(dir, "a.html")])).toBe(0);
    expect(readFileSync(join(dir, "a.html"), "utf8")).toContain("<h1>Accessibility statement for");
  });
});
