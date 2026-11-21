// PDF/A-2b of `toPdf`, checked by veraPDF (PR-FBX-52, R1-D-248; IPB-06-26). The contract
// Finbyx's statutory statements need (master prompt Part 7C AC3.1 step 6): the same statement
// renders to the same bytes twice, in this process and in another one, and the file passes the
// veraPDF PDF/A-2b profile; titled documents with `pdfua` also pass the PDF/UA-1 profile. veraPDF
// runs from the pinned image (TEST_IMAGES.verapdf) with no network, no capabilities, a read-only
// root and the PDFs mounted read-only, its JVM with the CVE-2026-114938 flag (R1-D-192).
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { TEST_IMAGES, withJvmMitigation } from "@infrabyx/testing";
import { toPdf, type PdfDocument, type PdfOptions } from "../pdf.js";

const T = new Date("2026-11-04T00:00:00Z");
const OPTS: PdfOptions = { created: T, creator: "Infrabyx", pdfa: "2b", lang: "en-IN" };
const UA: PdfOptions = { ...OPTS, pdfua: true };

/** A statement shaped like a statutory one: every block type, links, a table over several pages. */
const STATEMENT: PdfDocument = {
  title: "Statement of account",
  blocks: [
    { type: "heading", level: 1, text: "Statement of account" },
    {
      type: "paragraph",
      runs: [
        "Period 1 April 2026 to 30 September 2026. Amounts in ",
        { text: "rupees (₹)", bold: true },
        "; see ",
        { text: "the schedule of charges", href: "https://example.com/charges" },
        " and ",
        { text: "the grievance policy", italic: true, href: "https://example.com/grievance" },
        ".",
      ],
    },
    { type: "heading", level: 2, text: "Summary" },
    {
      type: "bulletList",
      items: [
        ["Opening balance ₹1,25,000.00"],
        { runs: ["Charges"], items: [["Processing fee ₹500.00"], ["Late fee ₹0.00"]] },
        [{ text: "Closing balance ₹98,250.00", bold: true, underline: true }],
      ],
    },
    { type: "heading", level: 2, text: "Transactions" },
    {
      type: "table",
      header: ["Date", "Particulars", "Debit", "Credit", "Balance"],
      rows: Array.from({ length: 120 }, (_, i) => [
        `2026-${String(4 + Math.floor(i / 20)).padStart(2, "0")}-${String(1 + (i % 20)).padStart(2, "0")}`,
        i % 3 === 0 ? "EMI → principal and interest" : "Interest accrued",
        i % 3 === 0 ? "" : "₹812.40",
        i % 3 === 0 ? "₹4,200.00" : "",
        `₹${(125000 - i * 224).toLocaleString("en-IN")}.00`,
      ]),
    },
    { type: "pageBreak" },
    { type: "heading", level: 2, text: "Notes" },
    {
      type: "numberedList",
      items: [["Interest is charged at the agreed rate."], ["Report errors within 30 days."]],
    },
    { type: "paragraph", runs: [] },
  ],
};

const work = mkdtempSync(join(tmpdir(), "ipb-pdfa-int-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));
let runs = 0;

/** veraPDF on the files, one profile; the text report, one line per file (and failed rules). */
function verapdf(flavour: "2b" | "ua1", files: Record<string, Buffer>) {
  const dir = join(work, `run${++runs}`);
  mkdirSync(dir, { recursive: true });
  // The image runs as its own user (uid 100): the files must be readable by others.
  chmodSync(dir, 0o755);
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(dir, name), bytes);
    chmodSync(join(dir, name), 0o644);
  }
  const env = Object.entries(withJvmMitigation("verapdf")).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  const r = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      "none",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--read-only",
      "--tmpfs",
      "/tmp",
      ...env,
      "-v",
      `${dir}:/data:ro`,
      TEST_IMAGES.verapdf.image,
      "--flavour",
      flavour,
      "--format",
      "text",
      "-v",
      ...Object.keys(files).map((f) => `/data/${f}`),
    ],
    { encoding: "utf8", timeout: 300_000 },
  );
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const expectPass = (flavour: "2b" | "ua1", files: Record<string, Buffer>) => {
  const r = verapdf(flavour, files);
  for (const name of Object.keys(files)) expect(r.out).toContain(`PASS /data/${name} ${flavour}`);
  expect(r.out, r.out).not.toContain("FAIL");
  expect(r.status, r.out).toBe(0);
};

describe("toPdf PDF/A-2b: byte-identical renders that veraPDF accepts (PR-FBX-52)", () => {
  it("renders the same statement to the same bytes twice, and in another process", () => {
    const first = toPdf(STATEMENT, UA);
    const second = toPdf(STATEMENT, UA);
    expect(second.equals(first)).toBe(true);
    // The built package in a fresh Node process (test:int runs after the build).
    const dist = new URL("../../dist/index.js", import.meta.url).href;
    const script =
      `import { toPdf } from ${JSON.stringify(dist)};` +
      "const [doc, o] = JSON.parse(process.argv[1]); o.created = new Date(o.created);" +
      'process.stdout.write(toPdf(doc, o).toString("base64"));';
    const out = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script, JSON.stringify([STATEMENT, UA])],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    expect(Buffer.from(out, "base64").equals(first)).toBe(true);
  });

  it("passes veraPDF's PDF/A-2b profile: the statement, a document without title or links, an empty one", () => {
    expectPass("2b", {
      "statement.pdf": toPdf(STATEMENT, OPTS),
      "statement-ua.pdf": toPdf(STATEMENT, UA),
      "plain-text.pdf": toPdf(
        { blocks: [{ type: "paragraph", runs: ["Arrows ← ↑ → ↓ and ₹ only, no title."] }] },
        { pdfa: "2b" },
      ),
      "empty.pdf": toPdf({ blocks: [] }, { pdfa: "2b" }),
    });
  });

  it("passes veraPDF's PDF/UA-1 profile with pdfua (IPB-06-26)", () => {
    expectPass("ua1", { "statement-ua.pdf": toPdf(STATEMENT, UA) });
  });

  it("and veraPDF does reject the plain PDF 1.7 output (no metadata, no output intent)", () => {
    const r = verapdf("2b", { "plain.pdf": toPdf(STATEMENT, { created: T }) });
    expect(r.out, r.out).toContain("FAIL /data/plain.pdf 2b");
    expect(r.out).toContain("6.6.2.1-1");
    expect(r.status).not.toBe(0);
  });
});
