// `toOds` and `toOdt` (regulatory templates plan §7, item (b); R1-D-313): contract cases on
// synthetic data in the filed layouts. CA-A01's `Calendar` sheet (template index) written as ODS
// reads back cell for cell; PD-A02's filed text (a Deposit Receipt) written as ODT reads back;
// every `toXlsx` feature an ODS cannot carry is refused by name; the same input gives the same
// bytes; `mimetype` is the first entry, stored. Where LibreOffice is installed (`soffice`), each
// file is also opened by it and converted, and the conversion read back (the LibreOffice legs).
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@infrabyx/crypto";
import {
  readXlsx,
  readZip,
  toOds,
  toOdt,
  xlsxFormula,
  type DocxBlock,
  type XlsxSheet,
} from "./index.js";

const TEMPLATES = fileURLToPath(new URL("../../../docs/regulatory-templates/", import.meta.url));
function filed(rel: string): Buffer {
  const bytes = readFileSync(`${TEMPLATES}${rel}`);
  const line = readFileSync(`${TEMPLATES}SHA256SUMS`, "utf8")
    .split("\n")
    .find((l) => l.endsWith(`  ./${rel}`));
  expect(line?.slice(0, 64), rel).toBe(sha256Hex(new Uint8Array(bytes)));
  return bytes;
}
interface IndexRecord {
  code: string;
  path: string;
  sheets: Array<{ name: string; cols: string[] }>;
}
const INDEX = JSON.parse(filed("template index.json").toString("utf8")) as IndexRecord[];
const record = (code: string) => INDEX.find((r) => r.code === code)!;

const soffice = spawnSync("soffice", ["--version"], { encoding: "utf8" }).status === 0;
function convert(bytes: Buffer, ext: string, to: string): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "ipb-odf-"));
  writeFileSync(join(dir, `in.${ext}`), bytes);
  execFileSync(
    "soffice",
    ["--headless", "--convert-to", to, "--outdir", join(dir, "out"), join(dir, `in.${ext}`)],
    {
      stdio: "ignore",
      timeout: 120_000,
    },
  );
  return readFileSync(join(dir, "out", `in.${to.split(":")[0]}`));
}

const un = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
/** The text of an ODF text element, with its white-space elements decoded. */
function odfTextOf(xml: string): string {
  return un(
    xml
      .replace(/<text:s text:c="(\d+)"\/>/g, (_, n: string) => " ".repeat(Number(n)))
      .replace(/<text:s\/>/g, " ")
      .replace(/<text:tab\/>/g, "\t")
      .replace(/<text:line-break\/>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}
/** Each table's rows of [value type, value] read from an ODS content.xml. */
function readOds(ods: Buffer): Map<string, Array<Array<[string, string] | null>>> {
  const content = readZip(ods).get("content.xml")!.toString("utf8");
  const out = new Map<string, Array<Array<[string, string] | null>>>();
  for (const t of content.matchAll(
    /<table:table table:name="([^"]*)"[^>]*>([\s\S]*?)<\/table:table>/g,
  )) {
    const rows: Array<Array<[string, string] | null>> = [];
    for (const r of t[2]!.matchAll(/<table:table-row>([\s\S]*?)<\/table:table-row>/g)) {
      const cells: Array<[string, string] | null> = [];
      for (const c of r[1]!.matchAll(
        /<table:table-cell([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-cell>)/g,
      )) {
        const attrs = c[1] ?? "";
        const type = /office:value-type="([^"]+)"/.exec(attrs)?.[1];
        if (!type) {
          cells.push(null);
          continue;
        }
        const v =
          /office:(?:value|date-value|boolean-value)="([^"]*)"/.exec(attrs)?.[1] ??
          odfTextOf(/<text:p>([\s\S]*?)<\/text:p>/.exec(c[2] ?? "")?.[1] ?? "");
        cells.push([type, un(v)]);
      }
      rows.push(cells);
    }
    out.set(un(t[1]!), rows);
  }
  return out;
}

const CREATED = new Date(Date.UTC(2026, 10, 28, 6, 0, 0));
const ca = record("CA-A01").sheets.find((s) => s.name === "Calendar")!;
// Synthetic rows in CA-A01's layout: formula triggers, Indic text, tabs, line breaks, space runs.
const calendarRows = [
  ["Annual", "AOC-4 filing", "Within 30 days of the AGM", "s. 137", "2026-10-29", "", "Open"],
  ["Quarterly", '=HYPERLINK("https://x.invalid")', "+1 day", "-r. 12", "@sum", "", "Done"],
  [
    "Event",
    "बोर्ड बैठक  (two spaces)",
    "Line one\nLine two",
    "tab\there",
    "  leading",
    "trailing  ",
    "நிலுவை",
  ],
];
const calendar: XlsxSheet = {
  name: ca.name,
  columns: ca.cols.map((h, i) => ({ header: h, type: "string" as const, width: 10 + i })),
  rows: calendarRows,
};
const typed: XlsxSheet = {
  name: "Typed",
  columns: [
    { header: "Amount", type: "number" },
    { header: "Count", type: "integer" },
    { header: "Met", type: "boolean" },
    { header: "Due", type: "date" },
    { header: "At", type: "datetime" },
    { header: "Note", type: "string", key: "note" },
  ],
  rows: [
    [1234.5, 3, true, "2026-03-31", "2026-11-28T05:30:00+05:30", "ok"],
    {
      Amount: "-0.25",
      Count: 0,
      Met: false,
      Due: new Date(Date.UTC(2027, 0, 1)),
      At: null,
      note: undefined,
    },
  ],
};

describe("toOds (CA-A01's Calendar layout, synthetic rows)", () => {
  const ods = toOds([calendar, typed], { title: "CA-A01 (synthetic)", created: CREATED });

  it("is an ODF package: mimetype first and stored, the manifest names every part", () => {
    expect(ods.readUInt32LE(0)).toBe(0x04034b50);
    expect(ods.readUInt16LE(8)).toBe(0); // stored
    const nameLen = ods.readUInt16LE(26);
    expect(ods.subarray(30, 30 + nameLen).toString()).toBe("mimetype");
    expect(ods.readUInt16LE(28)).toBe(0); // no extra field
    expect(ods.subarray(30 + nameLen, 30 + nameLen + 46).toString()).toBe(
      "application/vnd.oasis.opendocument.spreadsheet",
    );
    const z = readZip(ods);
    const manifest = z.get("META-INF/manifest.xml")!.toString();
    for (const p of ["content.xml", "meta.xml", "settings.xml", "styles.xml"]) {
      expect(z.has(p), p).toBe(true);
      expect(manifest).toContain(`manifest:full-path="${p}"`);
    }
    expect(z.get("meta.xml")!.toString()).toContain("<dc:title>CA-A01 (synthetic)</dc:title>");
  });

  it("reads back cell for cell: the header, text kept exactly, formula triggers neutralised", () => {
    const t = readOds(ods).get("Calendar")!;
    expect(t[0]!.map((c) => c![1])).toEqual(ca.cols);
    expect(t[1]!.map((c) => c?.[1] ?? "")).toEqual(calendarRows[0]);
    // Each formula trigger is written as text starting with an apostrophe, as toCsv and toXlsx do.
    expect(t[2]![1]![1]).toBe(`'=HYPERLINK("https://x.invalid")`);
    expect(t[2]!.slice(2, 5).map((c) => c![1])).toEqual(["'+1 day", "'-r. 12", "'@sum"]);
    expect(t[3]!.map((c) => c![1])).toEqual(calendarRows[2]);
    expect(t.flat().every((c) => c === null || c[0] === "string")).toBe(true);
  });

  it("writes typed cells: floats, booleans, dates and date-times in UTC; empty cells empty", () => {
    const t = readOds(ods).get("Typed")!;
    expect(t[1]).toEqual([
      ["float", "1234.5"],
      ["float", "3"],
      ["boolean", "true"],
      ["date", "2026-03-31"],
      ["date", "2026-11-28T00:00:00"],
      ["string", "ok"],
    ]);
    expect(t[2]).toEqual([
      ["float", "-0.25"],
      ["float", "0"],
      ["boolean", "false"],
      ["date", "2027-01-01"],
      null,
      null,
    ]);
  });

  it("freezes the header row of every sheet and gives the same bytes for the same input", () => {
    const settings = readZip(ods).get("settings.xml")!.toString();
    for (const n of ["Calendar", "Typed"]) expect(settings).toContain(`config:name="${n}"`);
    expect(settings).toContain('config:name="VerticalSplitPosition" config:type="int">1<');
    expect(
      toOds([calendar, typed], { title: "CA-A01 (synthetic)", created: CREATED }).equals(ods),
    ).toBe(true);
    expect(
      toOds([calendar, typed], { created: new Date(Date.UTC(2026, 10, 29)) }).equals(ods),
    ).toBe(false);
  });

  it("refuses, by name, every toXlsx feature an ODS does not carry", () => {
    const base = { name: "S", columns: [{ header: "A", type: "string" as const }], rows: [["x"]] };
    const refused = (s: XlsxSheet, what: RegExp, o: object = {}) =>
      expect(() => toOds([s], o)).toThrow(
        expect.objectContaining({
          reason: "ods_unsupported",
          message: expect.stringMatching(what),
        }),
      );
    refused({ ...base, protection: {} }, /protection/);
    refused({ ...base, freezeColumns: 1 }, /frozen columns/);
    refused({ ...base, autoFilter: true }, /AutoFilter/);
    refused({ ...base, headerFill: "FFFF00" }, /header fill/);
    refused({ ...base, rowLayout: [{ outlineLevel: 1 }] }, /row outline/);
    refused({ ...base, page: { orientation: "landscape" } }, /page set-up/);
    refused({ ...base, validationRows: 5 }, /validations/);
    refused(
      {
        ...base,
        conditionalFormats: [{ column: "A", when: { op: "blank" }, style: { bold: true } }],
      },
      /conditional formats/,
    );
    refused(
      {
        ...base,
        columns: [{ header: "A", type: "string", validation: { type: "list", values: ["a"] } }],
      } as XlsxSheet,
      /data validation/,
    );
    refused({ ...base, columns: [{ header: "A", type: "string", fill: "FFFF00" }] }, /column fill/);
    refused(
      {
        ...base,
        columns: [{ header: "A", type: "number" }],
        rows: [[xlsxFormula("1+1", { result: 2 })]],
      },
      /formula cell/,
    );
    refused(base, /named ranges/, { namedRanges: [] });
  });

  it("refuses a bad cell, a bad sheet name and an output over the cap", () => {
    const one = (type: XlsxSheet["columns"][number]["type"], v: unknown) =>
      toOds([{ name: "S", columns: [{ header: "A", type }], rows: [[v]] }]);
    expect(() => one("number", "12abc")).toThrow(
      expect.objectContaining({ reason: "cell_invalid" }),
    );
    expect(() => one("integer", 1.5)).toThrow(expect.objectContaining({ reason: "cell_invalid" }));
    expect(() => one("boolean", "yes")).toThrow(
      expect.objectContaining({ reason: "cell_invalid" }),
    );
    expect(() => one("date", "2026-02-30")).toThrow(
      expect.objectContaining({ reason: "cell_invalid" }),
    );
    expect(() => one("date", "1899-01-01")).toThrow(
      expect.objectContaining({ reason: "cell_invalid" }),
    );
    expect(() => toOds([{ ...calendar, name: "a/b" }])).toThrow(
      expect.objectContaining({ reason: "sheet_name_invalid" }),
    );
    expect(() => toOds([calendar, { ...typed, name: "calendar" }])).toThrow(
      expect.objectContaining({ reason: "sheet_name_invalid" }),
    );
    expect(() => toOds([calendar], { maxBytes: 2_000 })).toThrow(
      expect.objectContaining({ reason: "too_large" }),
    );
  });

  it.skipIf(!soffice)("LibreOffice Calc opens it: converted to XLSX, every cell reads back", () => {
    const sheets = readXlsx(new Uint8Array(convert(ods, "ods", "xlsx")));
    const cal = sheets.find((s) => s.name === "Calendar")!;
    expect(cal.rows[0]).toEqual(ca.cols);
    expect(cal.rows.slice(1).map((r) => ca.cols.map((_, i) => r[i] ?? ""))).toEqual([
      calendarRows[0],
      ["Quarterly", `'=HYPERLINK("https://x.invalid")`, "'+1 day", "'-r. 12", "'@sum", "", "Done"],
      calendarRows[2],
    ]);
    const ty = sheets.find((s) => s.name === "Typed")!;
    expect(ty.rows[1]!.slice(0, 3)).toEqual([1234.5, 3, true]);
    expect(String(ty.rows[1]![3]).slice(0, 10)).toBe("2026-03-31");
  });
});

// PD-A02 (Deposit Receipt): the filed document's own paragraphs as text blocks, with the block kinds
// the model has around them.
function filedParagraphs(rel: string): string[] {
  const xml = readZip(new Uint8Array(filed(`Templates/${rel}`)))
    .get("word/document.xml")!
    .toString("utf8");
  return [...xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)]
    .map((p) =>
      un([...p[1]!.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join("")),
    )
    .filter((t) => t.trim() !== "");
}

describe("toOdt (PD-A02's filed text, synthetic values)", () => {
  const paras = filedParagraphs(record("PD-A02").path);
  const blocks: DocxBlock[] = [
    { type: "heading", level: 1, text: paras[0]! },
    ...paras.slice(1).map((t): DocxBlock => ({ type: "paragraph", runs: [t] })),
    {
      type: "paragraph",
      runs: [
        "Amount: ",
        { text: "₹1,00,000", bold: true },
        " — ",
        { text: "terms", href: "https://example.invalid/terms", underline: true },
      ],
    },
    {
      type: "bulletList",
      items: [["Tenure 12 months"], { runs: ["Interest"], items: [["8.5 per cent, quarterly"]] }],
    },
    { type: "numberedList", items: [["Sign"], ["Deliver"]] },
    {
      type: "table",
      header: ["Field", "Value"],
      rows: [
        ["Depositor", "Synthetic Person"],
        ["Receipt no.", "PD/2026/0001"],
      ],
    },
    { type: "pageBreak" },
    { type: "heading", level: 2, text: "Tab\tand  spaces\nkept" },
  ];
  const odt = toOdt({ title: "PD-A02 (synthetic)", blocks }, { created: CREATED });
  const content = readZip(odt).get("content.xml")!.toString("utf8");

  it("is an ODF text package with mimetype first and stored, and the same bytes for the same input", () => {
    const nameLen = odt.readUInt16LE(26);
    expect(odt.subarray(30, 30 + nameLen).toString()).toBe("mimetype");
    expect(odt.readUInt16LE(8)).toBe(0);
    expect(odt.subarray(30 + nameLen, 30 + nameLen + 39).toString()).toBe(
      "application/vnd.oasis.opendocument.text",
    );
    expect(toOdt({ title: "PD-A02 (synthetic)", blocks }, { created: CREATED }).equals(odt)).toBe(
      true,
    );
  });

  it("reads back the filed text, the heading levels, the list, the table and the link", () => {
    expect(paras.length).toBeGreaterThan(3);
    const texts = [
      ...content.matchAll(/<text:(?:p|h)\b[^>]*?(?:\/>|>([\s\S]*?)<\/text:(?:p|h)>)/g),
    ].map((m) => odfTextOf(m[1] ?? ""));
    for (const p of paras) expect(texts).toContain(p);
    expect(content).toContain(`<text:h text:style-name="Heading_20_1" text:outline-level="1">`);
    expect(texts).toContain("Tab\tand  spaces\nkept");
    expect(content).toContain('xlink:href="https://example.invalid/terms"');
    expect(content).toMatch(
      /<table:table-header-rows><table:table-row>.*Field.*Value.*<\/table:table-row><\/table:table-header-rows>/,
    );
    expect(content).toContain('<text:list text:style-name="LB">');
    expect(content).toContain('<text:p text:style-name="PB"/>');
    expect(content).not.toMatch(/<script|office:script|draw:object|text:field|<draw:image/);
  });

  it("refuses what toDocx refuses", () => {
    const refuse = (b: unknown, reason: string) =>
      expect(() => toOdt({ blocks: [b as DocxBlock] })).toThrow(
        expect.objectContaining({ reason }),
      );
    refuse({ type: "heading", level: 7, text: "x" }, "block_invalid");
    refuse(
      { type: "paragraph", runs: [{ text: "x", href: "http://example.invalid" }] },
      "link_invalid",
    );
    refuse({ type: "table", header: ["a", "b"], rows: [["only one"]] }, "block_invalid");
    refuse({ type: "video" }, "block_invalid");
    expect(() => toOdt({ blocks }, { maxBytes: 1_000 })).toThrow(
      expect.objectContaining({ reason: "too_large" }),
    );
  });

  it.skipIf(!soffice)(
    "LibreOffice Writer opens it: converted to DOCX, the text is all there",
    () => {
      const docx = convert(odt, "odt", "docx");
      const xml = readZip(new Uint8Array(docx)).get("word/document.xml")!.toString("utf8");
      const text = un(
        [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(""),
      );
      for (const p of [...paras, "Synthetic Person", "PD/2026/0001", "8.5 per cent, quarterly"])
        expect(text).toContain(p);
    },
  );
});
