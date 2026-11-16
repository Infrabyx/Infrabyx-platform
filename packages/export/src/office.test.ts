// XLSX and DOCX writers over the package ZIP (PR-LDC-28, M59): parts, content types, escaping,
// formula-injection neutralisation, deterministic bytes and limits.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sha256Hex } from "@infrabyx/crypto";
import { neutraliseFormula, toCsv } from "./csv.js";
import { toDocx, type DocxDocument } from "./docx.js";
import { OfficeExportError } from "./ooxml.js";
import { toXlsx, xlsxColumnName, type XlsxSheet } from "./xlsx.js";
import { readZip } from "./zip.js";

const T = new Date("2026-11-04T10:00:00.000Z");
const text = (zip: Buffer, part: string) => {
  const b = readZip(zip).get(part);
  if (!b) throw new Error(`missing part ${part}`);
  return b.toString("utf8");
};
const reason = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    if (e instanceof OfficeExportError) return e.reason;
    throw e;
  }
  throw new Error("expected a refusal");
};

const has = (cmd: string, arg: string) => spawnSync(cmd, [arg], { stdio: "ignore" }).status === 0;
const tools = has("xmllint", "--version") && has("unzip", "-v");
const tmp = mkdtempSync(join(tmpdir(), "ipb-office-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Every part is well-formed XML (xmllint) and the archive tests clean (unzip -t). */
function wellFormed(zip: Buffer, name: string): void {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.zip`);
  writeFileSync(file, zip);
  execFileSync("unzip", ["-tq", file]);
  for (const [p, data] of readZip(zip)) {
    const out = join(dir, "parts", p);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, data);
    execFileSync("xmllint", ["--noout", "--nonet", out]);
  }
}

const SHEETS: XlsxSheet[] = [
  {
    name: "P&L <2026>",
    columns: [
      { header: "Name", type: "string" },
      { header: "Amount", type: "number" },
      { header: "Count", type: "integer" },
      { header: "Active", type: "boolean" },
      { header: "Due", type: "date" },
      { header: "At", type: "datetime" },
    ],
    rows: [
      ["Tom & <Jerry>", 1234.5, 7, true, "2024-01-01", new Date("2024-01-01T12:00:00Z")],
      ['=HYPERLINK("https://x")', -3, 0, false, new Date("2024-01-01T23:59:00Z"), null],
      ["+1", "12.50", 10n, null, null, "2024-01-01T18:00:00+05:30"],
      ["-1", null, null, null, null, null],
      ["@SUM(A1)", null, null, null, null, null],
      ["\tx", null, null, null, null, null],
      ["\rx", null, null, null, null, null],
      ["bad\u0000\u0008\uD800￾chars", null, null, null, null, null],
    ],
  },
  {
    name: "Second",
    columns: [
      { header: "Id", type: "string", key: "id" },
      { header: "-Signed", type: "integer", key: "n" },
    ],
    rows: [{ id: "a1", n: 1 }, { id: "a2" }],
  },
];

describe("toXlsx", () => {
  const zip = toXlsx(SHEETS, { created: T, title: "Report & co", creator: "Infrabyx" });

  it("writes the minimal SpreadsheetML parts with their content types", () => {
    expect([...readZip(zip).keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/core.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
    const ct = text(zip, "[Content_Types].xml");
    expect(ct).toContain(
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    );
    expect(ct).toContain(
      '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
    );
    expect(ct).toContain("spreadsheetml.styles+xml");
    expect(ct).toContain("core-properties+xml");
    expect(text(zip, "_rels/.rels")).toContain('Target="xl/workbook.xml"');
    const wb = text(zip, "xl/workbook.xml");
    expect(wb).toContain('<sheet name="P&amp;L &lt;2026&gt;" sheetId="1" r:id="rId1"/>');
    expect(text(zip, "xl/_rels/workbook.xml.rels")).toContain('Target="styles.xml"');
    const core = text(zip, "docProps/core.xml");
    expect(core).toContain("<dc:title>Report &amp; co</dc:title>");
    expect(core).toContain('<dcterms:created xsi:type="dcterms:W3CDTF">2026-11-04T10:00:00Z');
    const styles = text(zip, "xl/styles.xml");
    expect(styles).toContain('formatCode="yyyy-mm-dd"');
    expect(styles).toContain('formatCode="yyyy-mm-dd hh:mm:ss"');
  });

  it("writes typed cells, inline strings, escaped text and a bold frozen header", () => {
    const s = text(zip, "xl/worksheets/sheet1.xml");
    expect(s).toContain('<dimension ref="A1:F9"/>');
    expect(s).toContain('state="frozen"');
    expect(s).toContain(
      '<c r="A1" s="3" t="inlineStr"><is><t xml:space="preserve">Name</t></is></c>',
    );
    expect(s).toContain('<t xml:space="preserve">Tom &amp; &lt;Jerry&gt;</t>');
    expect(s).toContain('<c r="B2"><v>1234.5</v></c>');
    expect(s).toContain('<c r="C2"><v>7</v></c>');
    expect(s).toContain('<c r="D2" t="b"><v>1</v></c>');
    expect(s).toContain('<c r="E2" s="1"><v>45292</v></c>');
    expect(s).toContain('<c r="F2" s="2"><v>45292.5</v></c>');
    expect(s).toContain('<c r="E3" s="1"><v>45292</v></c>'); // a date is its UTC day
    expect(s).toContain('<c r="B4"><v>12.5</v></c>');
    expect(s).toContain('<c r="C4"><v>10</v></c>');
    expect(s).toContain('<c r="F4" s="2"><v>45292.520833333336</v></c>'); // 12:30 UTC
    expect(s).not.toContain('r="F3"'); // null is no cell
    expect(s).not.toMatch(/<f[ >]/); // never a formula cell
  });

  it("neutralises formula injection as toCsv does (=, +, -, @, tab, CR)", () => {
    const s = text(zip, "xl/worksheets/sheet1.xml");
    expect(s).toContain(`<t xml:space="preserve">'=HYPERLINK("https://x")</t>`);
    for (const v of ["'+1", "'-1", "'@SUM(A1)", "'\tx", "'&#13;x"])
      expect(s).toContain(`<t xml:space="preserve">${v}</t>`);
    // Headers too; a negative number column stays a number.
    const s2 = text(zip, "xl/worksheets/sheet2.xml");
    expect(s2).toContain('<t xml:space="preserve">\'-Signed</t>');
    expect(s).toContain('<c r="B3"><v>-3</v></c>');
    expect(neutraliseFormula("=1")).toBe("'=1");
    expect(neutraliseFormula("a=1")).toBe("a=1");
    expect(neutraliseFormula("")).toBe("");
  });

  it("drops characters XML 1.0 cannot carry", () => {
    const s = text(zip, "xl/worksheets/sheet1.xml");
    expect(s).toContain('<t xml:space="preserve">badchars</t>');
  });

  it("reads object rows by key and writes nothing for a missing value", () => {
    const s = text(zip, "xl/worksheets/sheet2.xml");
    expect(s).toContain(
      '<row r="2"><c r="A2" t="inlineStr"><is><t xml:space="preserve">a1</t></is></c><c r="B2"><v>1</v></c></row>',
    );
    expect(s).toContain(
      '<row r="3"><c r="A3" t="inlineStr"><is><t xml:space="preserve">a2</t></is></c></row>',
    );
  });

  it("gives the same bytes for the same input and time (golden SHA-256)", () => {
    const again = toXlsx(SHEETS, { created: T, title: "Report & co", creator: "Infrabyx" });
    expect(again.equals(zip)).toBe(true);
    expect(sha256Hex(zip)).toBe(XLSX_GOLDEN);
    expect(toXlsx(SHEETS).equals(toXlsx(SHEETS))).toBe(true);
    expect(text(toXlsx(SHEETS), "docProps/core.xml")).toContain("1980-01-01T00:00:00Z");
    expect(toXlsx(SHEETS, { created: new Date("2026-11-05T00:00:00Z") }).equals(zip)).toBe(false);
  });

  it("refuses bad sheet names", () => {
    const one = (name: string) => () =>
      toXlsx([{ name, columns: [{ header: "a", type: "string" }], rows: [] }]);
    for (const n of [
      "",
      "x".repeat(32),
      "a/b",
      "a\\b",
      "[x]",
      "a:b",
      "a*b",
      "a?b",
      "'x",
      "x'",
      "History",
      "a\u0001b",
    ])
      expect(reason(one(n))).toBe("sheet_name_invalid");
    expect(() => one("x".repeat(31))()).not.toThrow();
    const dup = () =>
      toXlsx(
        ["Data", "DATA"].map((name) => ({
          name,
          columns: [{ header: "a", type: "string" as const }],
          rows: [],
        })),
      );
    expect(reason(dup)).toBe("sheet_name_invalid");
    expect(reason(() => toXlsx([]))).toBe("sheets_invalid");
  });

  it("refuses values that do not fit their column", () => {
    const col = (type: XlsxSheet["columns"][number]["type"], v: unknown) => () =>
      toXlsx([{ name: "S", columns: [{ header: "h", type }], rows: [[v]] }]);
    for (const v of [Number.NaN, Infinity, -Infinity, "12abc", "", {}, 2n ** 60n])
      expect(reason(col("number", v))).toBe("cell_invalid");
    expect(reason(col("integer", 1.5))).toBe("cell_invalid");
    expect(reason(col("integer", 2 ** 53))).toBe("cell_invalid");
    expect(reason(col("boolean", "true"))).toBe("cell_invalid");
    for (const v of [
      "2026-02-30",
      "04/11/2026",
      "2026-11-04T10:00:00",
      new Date("x"),
      "1900-02-28",
      5,
    ])
      expect(reason(col("date", v))).toBe("cell_invalid");
    expect(reason(col("datetime", "10000-01-01T00:00:00Z"))).toBe("cell_invalid");
    expect(
      reason(() =>
        toXlsx([{ name: "S", columns: [{ header: "h", type: "money" as never }], rows: [] }]),
      ),
    ).toBe("columns_invalid");
    expect(reason(() => toXlsx([{ name: "S", columns: [], rows: [] }]))).toBe("columns_invalid");
    expect(
      reason(() =>
        toXlsx([{ name: "S", columns: [{ header: "h", type: "string" }], rows: [["a", "b"]] }]),
      ),
    ).toBe("row_invalid");
  });

  it("refuses beyond Excel's grid, the cell limit and the byte cap", () => {
    const cols = Array.from({ length: 16_385 }, (_, i) => ({
      header: `c${i}`,
      type: "string" as const,
    }));
    expect(reason(() => toXlsx([{ name: "S", columns: cols, rows: [] }]))).toBe("too_many_columns");
    expect(() => toXlsx([{ name: "S", columns: cols.slice(0, 16_384), rows: [] }])).not.toThrow();
    expect(xlsxColumnName(16_383)).toBe("XFD");
    expect(xlsxColumnName(26)).toBe("AA");
    const rows = new Array<unknown[]>(1_048_576); // one more than fits under the header
    expect(
      reason(() => toXlsx([{ name: "S", columns: [{ header: "h", type: "string" }], rows }])),
    ).toBe("too_many_rows");
    const long = () =>
      toXlsx([
        { name: "S", columns: [{ header: "h", type: "string" }], rows: [["x".repeat(32_768)]] },
      ]);
    expect(reason(long)).toBe("cell_too_long");
    const big = Array.from({ length: 2_000 }, (_, i) => [`row ${i} ${"y".repeat(100)}`]);
    const capped = () =>
      toXlsx([{ name: "S", columns: [{ header: "h", type: "string" }], rows: big }], {
        maxBytes: 100_000,
      });
    expect(reason(capped)).toBe("too_large");
    expect(reason(() => toXlsx(SHEETS, { maxBytes: 2 * 1024 ** 3 }))).toBe("max_bytes_invalid");
    expect(reason(() => toXlsx(SHEETS, { created: new Date("1970-01-01T00:00:00Z") }))).toBe(
      "created_invalid",
    );
  });

  it.skipIf(!tools)("writes well-formed XML parts in a clean ZIP (xmllint, unzip)", () => {
    wellFormed(zip, "xlsx");
  });
});

describe("toXlsx widths, validations, named ranges and protection (PR-LDC-31, M81)", () => {
  const form: XlsxSheet[] = [
    {
      name: "Register",
      columns: [
        { header: "Ref", type: "string", width: 18 },
        {
          header: "Status",
          type: "string",
          width: 14,
          editable: true,
          validation: {
            type: "list",
            namedRange: "Statuses",
            prompt: { title: "Status", message: "Pick one" },
            error: { message: "Not a status" },
          },
        },
        {
          header: "Count",
          type: "integer",
          editable: true,
          validation: { type: "whole", min: 0, max: 99 },
        },
        {
          header: "Due",
          type: "date",
          editable: true,
          validation: { type: "date", min: "2026-01-01" },
        },
        {
          header: "Note",
          type: "string",
          editable: true,
          validation: { type: "textLength", max: 200 },
        },
        { header: "Flag", type: "string", validation: { type: "list", values: ["Yes", "No"] } },
      ],
      rows: [["R-1", "Open", 3, "2026-11-30", "x", "Yes"]],
      validationRows: 50,
      protection: { sort: true },
    },
    {
      name: "Lists",
      columns: [{ header: "Status", type: "string" }],
      rows: [["Open"], ["Closed"]],
    },
  ];
  const zip = toXlsx(form, {
    created: T,
    namedRanges: [{ name: "Statuses", sheet: "Lists", range: "A2:A3" }],
  });
  const sheet = text(zip, "xl/worksheets/sheet1.xml");

  it("writes widths and unlocked editable columns, and locks the rest with no password", () => {
    expect(sheet).toContain('<col min="1" max="1" width="18" customWidth="1"/>');
    expect(sheet).toContain('<col min="2" max="2" width="14" style="4" customWidth="1"/>');
    expect(sheet).toContain('<col min="4" max="4" width="9.140625" style="5"/>');
    expect(sheet).toMatch(/<c r="B2" s="4" t="inlineStr">/);
    expect(sheet).toContain('<c r="C2" s="4"><v>3</v></c>');
    expect(sheet).toMatch(/<c r="D2" s="5">/);
    expect(sheet).toMatch(/<c r="A2" t="inlineStr">/);
    expect(sheet).toContain('<sheetProtection sheet="1" objects="1" scenarios="1"');
    expect(sheet).toContain('sort="0"');
    expect(sheet).toContain('insertRows="1"');
    expect(sheet).not.toMatch(/password|hashValue|saltValue/);
    expect(sheet.indexOf("<sheetProtection")).toBeGreaterThan(sheet.indexOf("</sheetData>"));
    expect(text(zip, "xl/styles.xml")).toContain('<cellXfs count="7">');
    expect(text(zip, "xl/styles.xml")).toContain('<protection locked="0"/>');
  });

  it("writes typed validations over the validated rows, never a caller's formula text", () => {
    expect(sheet).toContain('<dataValidations count="5">');
    expect(sheet).toContain(
      '<dataValidation type="list" allowBlank="1" showInputMessage="1" promptTitle="Status" prompt="Pick one" showErrorMessage="1" error="Not a status" sqref="B2:B51"><formula1>Statuses</formula1></dataValidation>',
    );
    expect(sheet).toContain(
      '<dataValidation type="whole" operator="between" allowBlank="1" showErrorMessage="1" sqref="C2:C51"><formula1>0</formula1><formula2>99</formula2></dataValidation>',
    );
    expect(sheet).toContain('type="date" operator="greaterThanOrEqual"');
    expect(sheet).toContain("<formula1>46023</formula1>");
    expect(sheet).toContain('type="textLength" operator="lessThanOrEqual"');
    expect(sheet).toContain('<formula1>"Yes,No"</formula1>');
    expect(text(zip, "xl/workbook.xml")).toContain(
      `<definedNames><definedName name="Statuses">'Lists'!$A$2:$A$3</definedName></definedNames>`,
    );
  });

  it("keeps the wave 6 bytes when none of it is used", () => {
    expect(text(toXlsx(SHEETS, { created: T }), "xl/styles.xml")).toContain('<cellXfs count="4">');
    const plain = text(toXlsx(SHEETS, { created: T }), "xl/worksheets/sheet1.xml");
    expect(plain).not.toMatch(/<cols>|dataValidation|sheetProtection/);
    // An editable flag without protection changes nothing.
    const s = [
      {
        name: "S",
        columns: [{ header: "h", type: "string" as const, editable: true }],
        rows: [["a"]],
      },
    ];
    expect(
      toXlsx(s, { created: T }).equals(
        toXlsx([{ ...s[0]!, columns: [{ header: "h", type: "string" }] }], { created: T }),
      ),
    ).toBe(true);
  });

  it("refuses bad widths, validations, named ranges and a password", () => {
    const one =
      (col: Record<string, unknown>, extra: Record<string, unknown> = {}, o = {}) =>
      () =>
        toXlsx(
          [
            {
              name: "S",
              columns: [{ header: "h", type: "string", ...col }],
              rows: [],
              ...extra,
            } as XlsxSheet,
          ],
          o,
        );
    expect(reason(one({ width: 0 }))).toBe("columns_invalid");
    expect(reason(one({ width: 256 }))).toBe("columns_invalid");
    expect(reason(one({ validation: { type: "list", values: ["a,b"] } }))).toBe(
      "validation_invalid",
    );
    expect(reason(one({ validation: { type: "list", values: ['say "hi"'] } }))).toBe(
      "validation_invalid",
    );
    expect(reason(one({ validation: { type: "list", values: ["x".repeat(256)] } }))).toBe(
      "validation_invalid",
    );
    expect(reason(one({ validation: { type: "list", values: [] } }))).toBe("validation_invalid");
    expect(reason(one({ validation: { type: "list", namedRange: "Nope" } }))).toBe(
      "validation_invalid",
    );
    expect(reason(one({ validation: { type: "whole", min: 1.5 } }))).toBe("validation_invalid");
    expect(reason(one({ validation: { type: "decimal" } }))).toBe("validation_invalid");
    expect(reason(one({ validation: { type: "decimal", min: 2, max: 1 } }))).toBe(
      "validation_invalid",
    );
    expect(reason(one({ validation: { type: "date", max: "2026-02-30" } }))).toBe(
      "validation_invalid",
    );
    expect(reason(one({ validation: { type: "textLength", max: 40_000 } }))).toBe(
      "validation_invalid",
    );
    expect(reason(one({ validation: { type: "custom", formula: "=HYPERLINK(1)" } }))).toBe(
      "validation_invalid",
    );
    expect(
      reason(one({ validation: { type: "whole", max: 1, prompt: { message: "x".repeat(256) } } })),
    ).toBe("validation_invalid");
    expect(reason(one({}, { validationRows: 0 }))).toBe("validation_invalid");
    expect(reason(one({}, { protection: { password: "secret" } }))).toBe("protection_invalid");
    for (const name of ["A1", "xfd99", "R1C1", "R", "1x", "a b", "has-dash"])
      expect(reason(one({}, {}, { namedRanges: [{ name, sheet: "S", range: "A1" }] }))).toBe(
        "named_range_invalid",
      );
    for (const range of ["A0", "XFE1", "A1:B", "B2:A1", "A1048577", "S!A1", "A1:B2:C3"])
      expect(reason(one({}, {}, { namedRanges: [{ name: "N", sheet: "S", range }] }))).toBe(
        "named_range_invalid",
      );
    expect(reason(one({}, {}, { namedRanges: [{ name: "N", sheet: "Other", range: "A1" }] }))).toBe(
      "named_range_invalid",
    );
    expect(
      reason(
        one(
          {},
          {},
          {
            namedRanges: [
              { name: "N", sheet: "S", range: "A1" },
              { name: "n", sheet: "S", range: "A2" },
            ],
          },
        ),
      ),
    ).toBe("named_range_invalid");
  });

  it("quotes a sheet name with an apostrophe in a named range", () => {
    const z = toXlsx([{ name: "Bob's", columns: [{ header: "h", type: "string" }], rows: [] }], {
      namedRanges: [{ name: "_x.y", sheet: "Bob's", range: "B2:C4" }],
    });
    expect(text(z, "xl/workbook.xml")).toContain("'Bob''s'!$B$2:$C$4");
  });

  it.skipIf(!tools)("writes well-formed XML parts in a clean ZIP (xmllint, unzip)", () => {
    wellFormed(zip, "xlsx-form");
  });
});

describe("toCsv formula neutralisation", () => {
  it("is off by default (archive datasets keep exact values) and on when asked", () => {
    const rows = [{ a: "=1+1", b: "ok" }];
    expect(toCsv(["a", "b"], rows).toString("utf8")).toBe("﻿a,b\r\n=1+1,ok\r\n");
    expect(toCsv(["a", "b"], rows, { neutraliseFormulas: true }).toString("utf8")).toBe(
      "﻿a,b\r\n'=1+1,ok\r\n",
    );
  });
});

const DOC: DocxDocument = {
  title: "Compliance <report> & notes",
  blocks: [
    { type: "heading", level: 1, text: "Summary & scope" },
    { type: "heading", level: 6, text: "Small" },
    {
      type: "paragraph",
      runs: [
        "Plain <text> & ",
        { text: "bold", bold: true },
        { text: "italic", italic: true },
        { text: "under", underline: true },
        { text: "a link", href: "https://example.com/a?b=1&c=2" },
        { text: "same link", href: "https://example.com/a?b=1&c=2", bold: true },
        "line one\nline two\ttabbed\u0000\uDC00",
      ],
    },
    { type: "bulletList", items: [["one"], { runs: ["two"], items: [["two a"], ["two b"]] }] },
    { type: "numberedList", items: [["first"], ["second"]] },
    { type: "numberedList", items: [["again one"]] },
    {
      type: "table",
      header: ["Name", "Value"],
      rows: [
        ["a & b", "<1>"],
        ["c", "d"],
      ],
    },
    { type: "table", header: ["Only"], rows: [] },
    { type: "pageBreak" },
    { type: "paragraph", runs: ["{ MERGEFIELD x } stays text"] },
  ],
};

describe("toDocx", () => {
  const zip = toDocx(DOC, { created: T, creator: "Infrabyx" });

  it("writes the minimal WordprocessingML parts with their content types", () => {
    expect([...readZip(zip).keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/core.xml",
      "word/_rels/document.xml.rels",
      "word/document.xml",
      "word/numbering.xml",
      "word/styles.xml",
    ]);
    const ct = text(zip, "[Content_Types].xml");
    expect(ct).toContain(
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    );
    expect(ct).toContain("wordprocessingml.styles+xml");
    expect(ct).toContain("wordprocessingml.numbering+xml");
    expect(text(zip, "_rels/.rels")).toContain('Target="word/document.xml"');
    const core = text(zip, "docProps/core.xml");
    expect(core).toContain("<dc:title>Compliance &lt;report&gt; &amp; notes</dc:title>");
    expect(core).toContain("<dc:creator>Infrabyx</dc:creator>");
    expect(core).toContain("2026-11-04T10:00:00Z");
    const styles = text(zip, "word/styles.xml");
    for (let i = 1; i <= 6; i++) expect(styles).toContain(`w:styleId="Heading${i}"`);
    expect(styles).toContain('w:styleId="ListParagraph"');
    expect(styles).toContain('w:styleId="Hyperlink"');
  });

  it("renders the blocks with escaped text", () => {
    const d = text(zip, "word/document.xml");
    expect(d).toContain(
      '<w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">Summary &amp; scope</w:t>',
    );
    expect(d).toContain('<w:pStyle w:val="Heading6"/>');
    expect(d).toContain('<w:t xml:space="preserve">Plain &lt;text&gt; &amp; </w:t>');
    expect(d).toContain('<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">bold</w:t></w:r>');
    expect(d).toContain("<w:rPr><w:i/></w:rPr>");
    expect(d).toContain('<w:rPr><w:u w:val="single"/></w:rPr>');
    expect(d).toContain(
      '<w:t xml:space="preserve">line one</w:t><w:br/><w:t xml:space="preserve">line two</w:t><w:tab/><w:t xml:space="preserve">tabbed</w:t>',
    );
    expect(d).toContain('<w:br w:type="page"/>');
    expect(d).toContain("<w:tblHeader/>");
    expect(d).toContain('<w:t xml:space="preserve">a &amp; b</w:t>');
    expect(d).toContain('<w:t xml:space="preserve">&lt;1&gt;</w:t>');
    expect(d).toContain("</w:tbl><w:p/><w:tbl>"); // adjacent tables are kept apart
    // No fields, macros or images: braces are text.
    expect(d).not.toMatch(/fldSimple|instrText|fldChar|w:drawing|w:pict|w:object/);
    expect(d).toContain("{ MERGEFIELD x } stays text");
  });

  it("writes https hyperlinks as external relationships, one per URL", () => {
    const d = text(zip, "word/document.xml");
    expect(d.match(/<w:hyperlink r:id="rId3"/g)).toHaveLength(2);
    expect(d).toContain('<w:rStyle w:val="Hyperlink"/><w:b/>');
    const rels = text(zip, "word/_rels/document.xml.rels");
    expect(rels).toContain(
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/a?b=1&amp;c=2" TargetMode="External"/>',
    );
    expect(rels.match(/TargetMode="External"/g)).toHaveLength(1);
  });

  it("numbers lists with one nested level and restarts each numbered list", () => {
    const d = text(zip, "word/document.xml");
    expect(d).toContain('<w:ilvl w:val="1"/><w:numId w:val="1"/>');
    expect(d).toContain(
      '<w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">first',
    );
    expect(d).toContain(
      '<w:numId w:val="3"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">again one',
    );
    const n = text(zip, "word/numbering.xml");
    expect(n).toContain('<w:numFmt w:val="bullet"/>');
    expect(n).toContain('<w:numFmt w:val="decimal"/>');
    expect(n).toContain(
      '<w:num w:numId="3"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/>',
    );
  });

  it("drops characters XML 1.0 cannot carry", () => {
    const d = text(zip, "word/document.xml");
    expect(d.includes("\u0000") || d.includes("\uFFFD")).toBe(false);
    expect(d).toContain('<w:t xml:space="preserve">tabbed</w:t></w:r>');
  });

  it("gives the same bytes for the same input and time (golden SHA-256)", () => {
    expect(toDocx(DOC, { created: T, creator: "Infrabyx" }).equals(zip)).toBe(true);
    expect(sha256Hex(zip)).toBe(DOCX_GOLDEN);
    expect(toDocx({ blocks: [] }).equals(toDocx({ blocks: [] }))).toBe(true);
  });

  it("refuses links that are not https, bad blocks and sizes over the caps", () => {
    const link = (href: string) => () =>
      toDocx({ blocks: [{ type: "paragraph", runs: [{ text: "x", href }] }] });
    for (const h of [
      "http://example.com",
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "//example.com",
      "https://user:pw@example.com/",
      "not a url",
    ])
      expect(reason(link(h))).toBe("link_invalid");
    const one = (b: unknown) => () => toDocx({ blocks: [b as never] });
    expect(reason(one({ type: "heading", level: 7, text: "x" }))).toBe("block_invalid");
    expect(reason(one({ type: "heading", level: 0, text: "x" }))).toBe("block_invalid");
    expect(reason(one({ type: "image", src: "https://x" }))).toBe("block_invalid");
    expect(reason(one({ type: "table", header: ["a", "b"], rows: [["only one"]] }))).toBe(
      "block_invalid",
    );
    expect(reason(one({ type: "table", header: Array(64).fill("c"), rows: [] }))).toBe(
      "block_invalid",
    );
    expect(reason(one({ type: "bulletList", items: [] }))).toBe("block_invalid");
    expect(reason(one({ type: "paragraph", runs: [{ text: 5 }] }))).toBe("block_invalid");
    expect(reason(() => toDocx({ blocks: new Array(100_001) }))).toBe("too_many_blocks");
    const rows = Array.from({ length: 2_000 }, (_, i) => [`row ${i} ${"z".repeat(100)}`]);
    expect(
      reason(() =>
        toDocx({ blocks: [{ type: "table", header: ["h"], rows }] }, { maxBytes: 100_000 }),
      ),
    ).toBe("too_large");
    const paras = Array.from({ length: 2_000 }, () => ({
      type: "paragraph" as const,
      runs: ["w".repeat(100)],
    }));
    expect(reason(() => toDocx({ blocks: paras }, { maxBytes: 100_000 }))).toBe("too_large");
  });

  it.skipIf(!tools)("writes well-formed XML parts in a clean ZIP (xmllint, unzip)", () => {
    wellFormed(zip, "docx");
  });
});

const XLSX_GOLDEN = "f33332ee731425d4196088dc054df5174450ab2463b19643c8d485084c9d0530";
const DOCX_GOLDEN = "274497ee7ae8fd4d683c2f4a9519edb04827141967e57135f1aa7136943150d4";
