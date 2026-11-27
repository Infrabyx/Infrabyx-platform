// The owner's regulatory templates and models are specifications (R1-D-297): every file matches its
// folder's SHA256SUMS, and every file is listed, so nothing is added, changed or dropped unnoticed.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
// `sha256Hex` from @infrabyx/crypto, as `bom.mjs` (no direct crypto in repository tooling, IPB-12-05).
const { sha256Hex } = await import(join(ROOT, "packages/crypto/dist/index.js"));

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe.each(["docs/regulatory-templates", "docs/regulatory-models"])("%s", (folder) => {
  const dir = join(ROOT, folder);
  const sums = new Map(
    readFileSync(join(dir, "SHA256SUMS"), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => {
        const m = /^([0-9a-f]{64}) [ *](?:\.\/)?(.+)$/.exec(l);
        if (!m) throw new Error(`bad SHA256SUMS line: ${l}`);
        return [m[2], m[1]];
      }),
  );

  it("lists every file, and only files that exist", () => {
    const onDisk = files(dir)
      .map((p) => relative(dir, p).split("\\").join("/"))
      .filter((p) => p !== "SHA256SUMS")
      .sort();
    expect(onDisk).toEqual([...sums.keys()].sort());
  });

  it("every file matches its SHA-256", () => {
    const bad = [...sums].filter(([p, h]) => sha256Hex(readFileSync(join(dir, p))) !== h);
    expect(bad.map(([p]) => p)).toEqual([]);
  });
});
