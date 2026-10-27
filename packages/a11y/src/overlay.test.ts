import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { overlaySignatures, scanPaths, scanText } from "./overlay.js";

// Built from parts, like the scanner, so this file never holds a full signature.
const vendor = ["acsbapp", "com"].join(".");
const widget = ["cdn", "userway", "org"].join(".");

describe("@IPB-06-AT-12 no accessibility overlays", () => {
  it("fails on a known overlay vendor domain in page config with IPB-A11Y-003", () => {
    const config = JSON.stringify(
      { scripts: [{ src: `https://${vendor}/apps/app/dist/js/app.js` }] },
      null,
      2,
    );
    const f = scanText(config, "page-config.json");
    expect(f).toEqual([
      { code: "IPB-A11Y-003", source: "page-config.json", line: 4, signature: vendor },
    ]);
  });

  it("scans build output, matches subdomains, and skips node_modules", () => {
    const dir = mkdtempSync(join(tmpdir(), "overlay-"));
    mkdirSync(join(dir, "static", "chunks"), { recursive: true });
    mkdirSync(join(dir, "node_modules", "x"), { recursive: true });
    writeFileSync(join(dir, "static", "chunks", "app.js"), `load("https://${widget}/widget.js")`);
    writeFileSync(join(dir, "node_modules", "x", "i.js"), `"https://${vendor}/"`);
    writeFileSync(join(dir, "clean.html"), "<p>no overlays here</p>");
    const f = scanPaths([dir]);
    expect(f).toHaveLength(1);
    expect(f[0]!.signature).toBe(["userway", "org"].join("."));
  });

  it("does not match a longer host that merely contains a signature", () => {
    expect(scanText(`https://not${vendor}.example/`, "x")).toEqual([]);
    expect(scanText(`https://${vendor}x.example/`, "x")).toEqual([]);
  });

  it("takes extra signatures, and this package's sources hold none of its own", () => {
    expect(scanText("https://overlay.example/x.js", "x", ["overlay.example"])).toHaveLength(1);
    expect(overlaySignatures().length).toBeGreaterThan(10);
    expect(scanPaths([fileURLToPath(new URL(".", import.meta.url))])).toEqual([]);
  });
});
