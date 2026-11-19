// The no-Aadhaar sweep and its CLI (PR-UDF-042, R1-D-195). Every number is made at run time from a
// fixed stem and its Verhoeff check digit; nothing that reads as a real Aadhaar number is committed.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { verhoeffValid } from "@infrabyx/contracts/aadhaar";
import { main } from "./cli.js";
import { scanPathsForAadhaar, scanTextForAadhaar } from "./index.js";

const withCheck = (stem: string): string => {
  for (let d = 0; d < 10; d++) if (verhoeffValid(`${stem}${d}`)) return `${stem}${d}`;
  throw new RangeError("no check digit");
};
const UID = withCheck("23456789012");
const VID = withCheck("912345678901234");
const spaced = (n: string) => n.replace(/(\d{4})(?=\d)/g, "$1 ");

describe("PR-UDF-042 scanTextForAadhaar", () => {
  it("gives the line and column of each find, masked", () => {
    const text = `first line\n  uid ${spaced(UID)}\r\nvid=${VID};\n`;
    expect(scanTextForAadhaar(text)).toEqual([
      { line: 2, column: 7, kind: "AADHAAR", masked: `XXXX XXXX ${UID.slice(-4)}` },
      { line: 3, column: 5, kind: "VID", masked: `XXXX XXXX XXXX ${VID.slice(-4)}` },
    ]);
  });

  it("joins letters by default (hashes, base64), and reads them as boundaries when asked", () => {
    const hash = `sha256:ab${UID}cd`;
    expect(scanTextForAadhaar(hash)).toEqual([]);
    expect(scanTextForAadhaar(hash, { letters: "boundary" })).toHaveLength(1);
  });

  it("blanks a UUID before the rule runs", () => {
    const uuid = `0190aaaa-bbbb-7ccc-8ddd-${UID}`;
    expect(scanTextForAadhaar(`"id":"${uuid}"`)).toEqual([]);
    expect(scanTextForAadhaar(`"id":"x-${UID}"`)).toHaveLength(1);
  });
});

describe("PR-UDF-042 infrabyx-aadhaar-scan", () => {
  let root: string;
  let out: string;
  let err: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "ipb-aadhaar-scan-"));
    const w = (p: string, body: string | Buffer) => {
      mkdirSync(join(root, p, ".."), { recursive: true });
      writeFileSync(join(root, p), body);
    };
    w("clean/a.json", JSON.stringify({ id: "x", amount: 1234567890123, at: "2026-11-19" }));
    w("clean/b.txt", `masked XXXX XXXX ${UID.slice(-4)} and ${UID}7 (a longer run)\n`);
    w("dirty/notes.md", `# notes\n\nline three ${spaced(UID)}\nand ${VID}\n`);
    w("dirty/node_modules/x/index.js", `"${UID}"`);
    w("dirty/.git/objects/x", `${UID}`);
    w("dirty/dist/x.js", `"${UID}"`);
    w("dirty/blob.bin", Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(UID)]));
    w("dirty/big.txt", `${"a".repeat(600)} ${UID}`);
    symlinkSync(join(root, "dirty/notes.md"), join(root, "dirty/link.md"));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const run = async (...args: string[]) => {
    out = "";
    err = "";
    vi.spyOn(process.stdout, "write").mockImplementation((s) => ((out += String(s)), true));
    vi.spyOn(process.stderr, "write").mockImplementation((s) => ((err += String(s)), true));
    return main(args);
  };
  afterEach(() => vi.restoreAllMocks());

  it("exits 0 with nothing found", async () => {
    expect(await run(join(root, "clean"))).toBe(0);
    expect(out).toBe("");
    expect(err).toMatch(/2 file\(s\), 0 skipped, 0 find\(s\)/);
  });

  it("exits 1 and prints file:line: kind and the masked number for each find", async () => {
    expect(await run("--max-bytes", "500", join(root, "dirty"))).toBe(1);
    const file = join(root, "dirty/notes.md");
    expect(out).toBe(
      `${file}:3: AADHAAR XXXX XXXX ${UID.slice(-4)}\n${file}:4: VID XXXX XXXX XXXX ${VID.slice(-4)}\n`,
    );
    // Never a number: not the whole of one, nor any of it beyond the last four digits.
    for (const n of [UID, VID]) expect(`${out}${err}`).not.toContain(n.slice(0, 8));
    expect(err).toContain(`skipped (binary): ${join(root, "dirty/blob.bin")}`);
    expect(err).toContain(`skipped (too_large): ${join(root, "dirty/big.txt")}`);
    expect(err).toContain(`skipped (symlink): ${join(root, "dirty/link.md")}`);
    expect(err).not.toMatch(/\/node_modules\/|\/\.git\/|\/dist\//);
    expect(err).toMatch(/1 file\(s\), 3 skipped, 2 find\(s\)/);
  });

  it("reads a file given directly, and a skipped directory name when it is the path given", async () => {
    expect(await run(join(root, "dirty/notes.md"))).toBe(1);
    expect(await run(join(root, "dirty/node_modules"))).toBe(1);
    expect(out).toContain(`index.js:1: AADHAAR XXXX XXXX ${UID.slice(-4)}`);
  });

  it("exits 2 on a usage error", async () => {
    expect(await run()).toBe(2);
    expect(err).toMatch(/usage:\s+infrabyx-aadhaar-scan\b/);
    expect(await run("--nope", root)).toBe(2);
    expect(await run("--letters", "some", root)).toBe(2);
    expect(await run("--max-bytes", "0", root)).toBe(2);
    expect(await run(join(root, "missing"))).toBe(2);
    expect(err).toContain("no such file or directory");
  });

  it("--letters boundary reads a letter as a boundary", async () => {
    const dir = join(root, "letters");
    mkdirSync(dir);
    writeFileSync(join(dir, "h.txt"), `h=ab${UID}cd\n`);
    expect(await run(dir)).toBe(0);
    expect(await run("--letters", "boundary", dir)).toBe(1);
  });

  it("scanPathsForAadhaar walks in a stable order", async () => {
    const a = await scanPathsForAadhaar([join(root, "dirty")], { maxBytes: 500 });
    const b = await scanPathsForAadhaar([join(root, "dirty")], { maxBytes: 500 });
    expect(a).toEqual(b);
    expect(a.finds.map((f) => f.kind)).toEqual(["AADHAAR", "VID"]);
  });
});
