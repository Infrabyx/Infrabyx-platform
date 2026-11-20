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
const PHONE = withCheck("91987654321");
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

  it("PR-UDF-063: blanks a standalone UUID only; digits glued to one are still read", () => {
    const uuid = `0190aaaa-bbbb-7ccc-8ddd-${UID}`;
    // Standalone: start or end of text, quotes, spaces, commas, a slash, a hyphen before a letter.
    for (const t of [
      uuid,
      ` ${uuid} `,
      `/${uuid}/`,
      `[${uuid},${uuid}]`,
      `${uuid}-v2`,
      `a-${uuid}`,
    ])
      expect(scanTextForAadhaar(t), t).toEqual([]);
    for (const letters of ["join", "boundary"] as const)
      expect(scanTextForAadhaar(`id ${uuid}.`, { letters })).toEqual([]);
    // A UUID-shaped run whose last group is the first twelve of a VID: the VID is found.
    const glued = `0190aaaa-bbbb-7ccc-8ddd-${VID.slice(0, 12)} ${VID.slice(12)}`;
    expect(scanTextForAadhaar(glued).map((f) => f.kind)).toEqual(["VID"]);
    // Digits glued to the front through a separator: read as the rule groups them.
    const front = `${UID.slice(0, 4)} ${UID.slice(4)}-bbbb-7ccc-8ddd-0190aaaa0000`;
    expect(scanTextForAadhaar(front, { letters: "boundary" }).map((f) => f.kind)).toEqual([
      "AADHAAR",
    ]);
    // A short number after a space is not a group: the UUID is still standalone.
    expect(scanTextForAadhaar(`${uuid} 7 days`)).toEqual([]);
    expect(scanTextForAadhaar(`12 ${uuid}`)).toEqual([]);
    // Four digits after a space are a group the rule may join: the UUID is read as it stands.
    expect(scanTextForAadhaar(`${uuid} ${UID.slice(0, 4)}`)).toHaveLength(1);
    // Glued to a letter or digit run: not a UUID, so the rule reads it as it stands.
    expect(scanTextForAadhaar(`${uuid}7`)).toEqual([]); // 13 digits: never a find
    expect(scanTextForAadhaar(`9${uuid}`, { letters: "boundary" })).toHaveLength(1);
    expect(scanTextForAadhaar(`x${uuid}`, { letters: "boundary" })).toHaveLength(1);
    expect(scanTextForAadhaar(`${uuid}x`, { letters: "boundary" })).toHaveLength(1);
    // The blanking keeps offsets: a number after a blanked UUID is at its own column.
    expect(scanTextForAadhaar(`${uuid}, ${UID}`)).toEqual([
      { line: 1, column: uuid.length + 3, kind: "AADHAAR", masked: `XXXX XXXX ${UID.slice(-4)}` },
    ]);
  });

  it("PR-UDF-063: look-alikes are finds by default; allow lets the chosen ones through", () => {
    const text = `tel +${PHONE}\namount 0.${UID}\n`;
    expect(scanTextForAadhaar(text).map((f) => f.line)).toEqual([1, 2]);
    expect(scanTextForAadhaar(text, { allow: ["e164_in"] }).map((f) => f.line)).toEqual([2]);
    expect(scanTextForAadhaar(text, { allow: ["decimal"] }).map((f) => f.line)).toEqual([1]);
    expect(scanTextForAadhaar(text, { allow: ["e164_in", "decimal"] })).toEqual([]);
    expect(scanTextForAadhaar(`${PHONE}`, { allow: ["e164_in"] })).toHaveLength(1);
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

  it("PR-UDF-063: exits 2 (fail closed) when no file is read", async () => {
    const empty = join(root, "empty");
    mkdirSync(join(empty, "sub"), { recursive: true });
    expect(await run(empty)).toBe(2);
    expect(err).toMatch(/0 file\(s\), 0 skipped, 0 find\(s\)/);
    expect(err).toContain("no file read, so nothing is proven");
    // Every file skipped (binary, too large, a symbolic link): nothing read either.
    const skipped = join(root, "all-skipped");
    mkdirSync(skipped);
    writeFileSync(join(skipped, "blob.bin"), Buffer.from([0, 1, 2]));
    writeFileSync(join(skipped, "big.txt"), "a".repeat(600));
    symlinkSync(join(root, "clean/a.json"), join(skipped, "link.json"));
    expect(await run("--max-bytes", "500", skipped)).toBe(2);
    expect(err).toMatch(/0 file\(s\), 3 skipped, 0 find\(s\)/);
    // Only skipped directories under the path given (node_modules, .git, dist).
    const only = join(root, "only-skipped-dirs");
    mkdirSync(join(only, "node_modules"), { recursive: true });
    writeFileSync(join(only, "node_modules", "x.js"), "x");
    expect(await run(only)).toBe(2);
    // A find still exits 1 whatever else happened.
    expect(await run(skipped, join(root, "dirty/notes.md"))).toBe(1);
  });

  it("PR-UDF-063: --allow lets the chosen look-alikes through; the default flags them", async () => {
    const dir = join(root, "look-alikes");
    mkdirSync(dir);
    writeFileSync(join(dir, "contacts.csv"), `name,phone,share\na,+${PHONE},0.${UID}\n`);
    expect(await run(dir)).toBe(1);
    expect(out.trim().split("\n")).toHaveLength(2);
    expect(await run("--allow", "e164_in", dir)).toBe(1);
    expect(out.trim().split("\n")).toHaveLength(1);
    expect(await run("--allow", "e164_in,decimal", dir)).toBe(0);
    expect(err).toContain("look-alikes let through: e164_in, decimal");
    expect(await run("--allow", "e164_in", "--allow", "decimal", dir)).toBe(0);
    expect(await run("--allow", "e164", dir)).toBe(2);
    expect(err).toContain("unknown look-alike: e164");
    expect(await run("--allow", "", dir)).toBe(2);
  });

  it("PR-UDF-063: --help names the options and every exit status", async () => {
    expect(await run("--help")).toBe(0);
    expect(out).toMatch(/usage:\s+infrabyx-aadhaar-scan\b/);
    for (const s of [
      "--allow",
      "e164_in",
      "decimal",
      "Exit status: 0",
      "1 a find",
      "2 nothing proven",
    ])
      expect(out).toContain(s);
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

describe("UUIDs in messages (R1-D-247)", () => {
  it("never reads a UUID's all-digit middle groups as a number", () => {
    // The CI failure on #345: the envelope id of a lender event, whose groups 2 to 4 are digits.
    const id = "01a1f98a-9694-7092-9478-0624acc5521e";
    expect(scanTextForAadhaar(JSON.stringify({ event: { id } }), { letters: "join" })).toEqual([]);
  });
});
