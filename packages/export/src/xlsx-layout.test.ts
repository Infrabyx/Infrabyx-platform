// toXlsx layout options (LawDocsComply PR-LDC-52, M100, R1-D-207): frozen columns, AutoFilter, row
// outline levels, fills, page set-up, typed conditional formats and typed formula cells, read back
// with the package's own ZIP and XLSX readers (and openpyxl where it is installed).
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sha256Hex } from "@infrabyx/crypto";
import { OfficeExportError } from "./ooxml.js";
import {
  isXlsxFormula,
  toXlsx,
  xlsxFormula,
  XLSX_BLOCKED_FUNCTIONS,
  type XlsxConditionalFormat,
  type XlsxSheet,
} from "./xlsx.js";
import { readXlsx, xlsxRecords } from "./xlsx-read.js";
import { readZip } from "./zip.js";

const T = new Date("2026-11-19T10:00:00.000Z");
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
const tmp = mkdtempSync(join(tmpdir(), "ipb-xlsx-layout-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const has = (cmd: string, args: string[]) => spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const tools = has("xmllint", ["--version"]) && has("unzip", ["-v"]);
const openpyxl = has("python3", ["-I", "-c", "import openpyxl"]);

const FORMATS: XlsxConditionalFormat[] = [
  {
    column: "due",
    when: { op: "lt", value: { today: 0 } },
    style: { fill: "F8CBAD", bold: true },
    wholeRow: true,
  },
  {
    column: "status",
    when: { op: "eq", value: 'Over"due' },
    style: { fontColor: "C00000" },
    stopIfTrue: true,
  },
  { column: "Amount", when: { op: "between", min: 0, max: 100 }, style: { fill: "E2EFDA" } },
  { column: "status", when: { op: "containsText", text: "50%*?" }, style: { bold: true } },
  { column: "done", when: { op: "eq", value: true }, style: { fill: "E2EFDA" } },
  {
    column: "Due",
    when: { op: "notBetween", min: "2026-01-01", max: { today: 30 } },
    style: { bold: true },
  },
  { column: "ref", when: { op: "blank" }, style: { fill: "FFFF00" } },
];

const sheets = (): XlsxSheet[] => [
  {
    name: "Register",
    columns: [
      { header: "Ref", type: "string", key: "ref", width: 12 },
      { header: "Status", type: "string", key: "status", fill: "FFF2CC" },
      { header: "Due", type: "date", key: "due" },
      { header: "Amount", type: "number", key: "amt" },
      { header: "Done", type: "boolean", key: "done" },
      { header: "Total", type: "number", key: "total" },
    ],
    rows: [
      {
        ref: "R-1",
        status: "Open",
        due: "2026-11-30",
        amt: 50,
        done: false,
        total: xlsxFormula("SUM(D2:D5)", { result: 175 }),
      },
      { ref: "=cmd|' /C calc'!A0", status: "Overdue", due: "2026-11-01", amt: 25, done: true },
      { ref: "R-3", status: null, due: "2026-12-15", amt: 60 },
      { ref: "R-4", status: "Closed", due: "2026-10-01", amt: 40, total: xlsxFormula("D5*2") },
    ],
    freezeColumns: 1,
    autoFilter: true,
    headerFill: "BDD7EE",
    rowLayout: [
      { fill: "DDEBF7" },
      { outlineLevel: 1 },
      { outlineLevel: 1 },
      { outlineLevel: 2, fill: "DDEBF7" },
    ],
    page: { orientation: "landscape", fitToWidth: true, repeatHeader: true, printArea: true },
    conditionalFormats: FORMATS,
  },
  {
    name: "Bob's summary",
    columns: [
      { header: "Label", type: "string" },
      { header: "Value", type: "string" },
      { header: "Check", type: "number" },
    ],
    rows: [
      [
        "Total",
        xlsxFormula('"Total: "&TEXT(Register!D2,"0")', { result: "Total: 50" }),
        xlsxFormula('IF(A2="[x]|y",1,0)'),
      ],
      ["Forged", { formula: 'WEBSERVICE("https://x")' }, null],
    ],
    outlineSummary: "above",
    page: { paper: "A3", printArea: "A1:C3" },
  },
];

const zip = toXlsx(sheets(), { created: T });
const s1 = text(zip, "xl/worksheets/sheet1.xml");
const s2 = text(zip, "xl/worksheets/sheet2.xml");
const styles = text(zip, "xl/styles.xml");
const workbook = text(zip, "xl/workbook.xml");
const order = (xml: string, tags: string[]) => tags.map((t) => xml.indexOf(t));

describe("toXlsx layout (PR-LDC-52)", () => {
  it("freezes the header row and the first columns", () => {
    expect(s1).toContain(
      '<pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/>' +
        '<selection pane="topRight" activeCell="B1" sqref="B1"/>' +
        '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
        '<selection pane="bottomRight" activeCell="B2" sqref="B2"/>',
    );
    expect(s2).toContain(
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>',
    );
  });

  it("writes an AutoFilter with Excel's hidden filter name", () => {
    expect(s1).toContain('<autoFilter ref="A1:F5"/>');
    expect(workbook).toContain(
      `<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'Register'!$A$1:$F$5</definedName>`,
    );
    expect(s2).not.toContain("autoFilter");
  });

  it("writes row outline levels and the summary position", () => {
    expect(s1).toContain('<sheetFormatPr defaultRowHeight="15" outlineLevelRow="2"/>');
    expect(s1).toMatch(/<row r="2">/);
    expect(s1).toMatch(/<row r="3" outlineLevel="1">/);
    expect(s1).toMatch(/<row r="5" outlineLevel="2">/);
    expect(s2).toContain('<sheetPr><outlinePr summaryBelow="0"/></sheetPr>');
  });

  it("fills the header, a column and rows, keeping date formats and filling empty cells", () => {
    expect(styles).toContain('<fills count="5">');
    for (const c of ["FFBDD7EE", "FFDDEBF7", "FFFFF2CC"])
      expect(styles).toContain(`<fgColor rgb="${c}"/>`);
    const xfs = [...styles.matchAll(/<xf [^>]*?(?:\/>|>)/g)].map((m) => m[0]).slice(1);
    const xfOf = (cell: string) => {
      const m = new RegExp(`<c r="${cell}" s="(\\d+)"`).exec(s1);
      return m ? xfs[Number(m[1])] : undefined;
    };
    expect(xfOf("A1")).toMatch(/fontId="1" fillId="\d" .*applyFont="1" applyFill="1"/);
    // Row 2 is filled across (the row fill wins over the Status column's fill), dates keep yyyy-mm-dd.
    expect(xfOf("A2")).toBe(xfOf("B2"));
    expect(xfOf("C2")).toMatch(/numFmtId="164" .*applyNumberFormat="1" applyFill="1"/);
    // Row 3 has no row fill: only the Status column is filled, and its empty cells too.
    expect(s1).toMatch(/<c r="A3" t="inlineStr">/);
    expect(xfOf("B3")).toMatch(/applyFill="1"/);
    expect(s1).toMatch(/<c r="B4" s="\d+"\/>/);
    expect(s1).toMatch(/<c r="E5" s="\d+"\/>/);
    expect(s1).not.toMatch(/<c r="E4"/);
  });

  it("writes the page set-up, the repeated header and the print area", () => {
    expect(s1.startsWith(`<?xml`)).toBe(true);
    expect(s1).toContain('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension');
    expect(s1).toContain(
      '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
        '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>',
    );
    expect(s2).toContain('<pageSetup paperSize="8" orientation="portrait"/>');
    expect(workbook).toContain(
      `<definedName name="_xlnm.Print_Area" localSheetId="0">'Register'!$A$1:$F$5</definedName>`,
    );
    expect(workbook).toContain(
      `<definedName name="_xlnm.Print_Titles" localSheetId="0">'Register'!$1:$1</definedName>`,
    );
    expect(workbook).toContain(
      `<definedName name="_xlnm.Print_Area" localSheetId="1">'Bob''s summary'!$A$1:$C$3</definedName>`,
    );
    expect(workbook).not.toContain(`localSheetId="1">'Bob''s summary'!$1:$1`);
  });

  it("builds each conditional format's expression from typed parts", () => {
    const rules = [
      ...s1.matchAll(
        /<conditionalFormatting sqref="([^"]+)"><cfRule ([^>]+)><formula>([^<]+)<\/formula>/g,
      ),
    ].map((m) => [m[1], m[2], m[3]]);
    expect(rules).toEqual([
      ["A2:F5", 'type="expression" dxfId="0" priority="1"', "AND(ISNUMBER($C2),$C2&lt;TODAY())"],
      ["B2:B5", 'type="expression" dxfId="1" priority="2" stopIfTrue="1"', '$B2="Over""due"'],
      [
        "D2:D5",
        'type="expression" dxfId="2" priority="3"',
        "AND(ISNUMBER($D2),$D2&gt;=0,$D2&lt;=100)",
      ],
      ["B2:B5", 'type="expression" dxfId="3" priority="4"', 'ISNUMBER(SEARCH("50%~*~?",$B2))'],
      ["E2:E5", 'type="expression" dxfId="2" priority="5"', "$E2=TRUE"],
      [
        "C2:C5",
        'type="expression" dxfId="3" priority="6"',
        "AND(ISNUMBER($C2),OR($C2&lt;46023,$C2&gt;TODAY()+30))",
      ],
      ["A2:A5", 'type="expression" dxfId="4" priority="7"', "LEN($A2)=0"],
    ]);
    expect(styles).toContain(
      '<dxfs count="5"><dxf><font><b/></font><fill><patternFill patternType="solid"><bgColor rgb="FFF8CBAD"/></patternFill></fill></dxf>' +
        '<dxf><font><color rgb="FFC00000"/></font></dxf>',
    );
    expect(styles.indexOf("<dxfs")).toBeGreaterThan(styles.indexOf("</cellStyles>"));
  });

  it("writes elements in SpreadsheetML's order", () => {
    const at = order(s1, [
      "<sheetPr>",
      "<dimension",
      "<sheetViews>",
      "<sheetFormatPr",
      "<cols>",
      "<sheetData>",
      "</sheetData>",
      "<autoFilter",
      "<conditionalFormatting",
      "<pageMargins",
      "<pageSetup",
    ]);
    expect(at.every((v) => v >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const wb = order(workbook, ["<sheets>", "<definedNames>", "<calcPr", "</workbook>"]);
    expect([...wb].sort((a, b) => a - b)).toEqual(wb);
  });

  it("writes typed formula cells with their cached results, and recalculates on load", () => {
    expect(s1).toMatch(/<c r="F2" s="\d+"><f>SUM\(D2:D5\)<\/f><v>175<\/v><\/c>/);
    expect(s1).toMatch(/<c r="F5" s="\d+"><f>D5\*2<\/f><\/c>/);
    expect(s2).toContain(
      '<c r="B2" t="str"><f>"Total: "&amp;TEXT(Register!D2,"0")</f><v>Total: 50</v></c>',
    );
    expect(s2).toContain('<c r="C2"><f>IF(A2="[x]|y",1,0)</f></c>');
    expect(workbook).toContain('<calcPr fullCalcOnLoad="1"/>');
  });

  it("never makes a formula from data: text stays neutralised, a look-alike object is text", () => {
    expect(s1).toContain(`<t xml:space="preserve">'=cmd|' /C calc'!A0</t>`);
    expect(s2).toMatch(
      /<c r="B3" t="inlineStr"><is><t xml:space="preserve">\{&quot;formula&quot;|<c r="B3" t="inlineStr"><is><t xml:space="preserve">\{"formula"/,
    );
    expect(s2.match(/<f>/g)).toHaveLength(2);
    expect(isXlsxFormula({ formula: "SUM(A1)" })).toBe(false);
    expect(isXlsxFormula(JSON.parse(JSON.stringify(xlsxFormula("SUM(A1)"))))).toBe(false);
    expect(isXlsxFormula(xlsxFormula("SUM(A1)"))).toBe(true);
    expect(Object.isFrozen(xlsxFormula("SUM(A1)"))).toBe(true);
    expect(
      reason(() =>
        toXlsx([
          { name: "S", columns: [{ header: "n", type: "number" }], rows: [[{ formula: "1+1" }]] },
        ]),
      ),
    ).toBe("cell_invalid");
  });

  it("reads back with the package's own reader: values, dates on filled cells, formula results", () => {
    const [reg, sum] = readXlsx(zip);
    const recs = xlsxRecords(reg!);
    expect(recs[0]).toEqual({
      Ref: "R-1",
      Status: "Open",
      Due: "2026-11-30",
      Amount: 50,
      Done: false,
      Total: 175,
    });
    expect(recs[1]!.Ref).toBe("'=cmd|' /C calc'!A0");
    expect(recs[2]).toMatchObject({ Status: null, Due: "2026-12-15", Total: null });
    expect(recs[3]!.Total).toBeNull();
    expect(sum!.rows[1]).toEqual(["Total", "Total: 50", null]);
  });

  it("gives the same bytes for the same layout (golden SHA-256), and none of it changes a plain workbook", () => {
    expect(toXlsx(sheets(), { created: T }).equals(zip)).toBe(true);
    expect(sha256Hex(zip)).toBe(LAYOUT_GOLDEN);
    const plain: XlsxSheet[] = [
      { name: "S", columns: [{ header: "h", type: "string" }], rows: [["a"]] },
    ];
    const same: XlsxSheet[] = [
      {
        ...plain[0]!,
        freezeColumns: 0,
        autoFilter: false,
        rowLayout: [null],
        conditionalFormats: [],
      },
    ];
    expect(toXlsx(same, { created: T }).equals(toXlsx(plain, { created: T }))).toBe(true);
    expect(text(toXlsx(plain), "xl/styles.xml")).not.toMatch(/dxfs|applyFill/);
    expect(text(toXlsx(plain), "xl/workbook.xml")).not.toMatch(/calcPr|definedNames/);
  });

  it("keeps an editable column unlocked when it is filled", () => {
    const z = toXlsx([
      {
        name: "S",
        columns: [{ header: "h", type: "date", editable: true, fill: "FFF2CC" }],
        rows: [["2026-01-02"]],
        protection: {},
      },
    ]);
    const st = text(z, "xl/styles.xml");
    expect(st).toContain('<cellXfs count="8">');
    expect(st).toContain(
      '<xf numFmtId="164" fontId="0" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1" applyProtection="1"><protection locked="0"/></xf>',
    );
    expect(text(z, "xl/worksheets/sheet1.xml")).toContain('<c r="A2" s="7">');
  });
});

describe("toXlsx layout refusals (PR-LDC-52)", () => {
  const base = (over: Partial<XlsxSheet>): XlsxSheet[] => [
    {
      name: "S",
      columns: [
        { header: "a", type: "string" },
        { header: "n", type: "number" },
        { header: "d", type: "date" },
        { header: "b", type: "boolean" },
      ],
      rows: [["x", 1, "2026-01-01", true]],
      ...over,
    },
  ];
  const r = (over: Partial<XlsxSheet>) => reason(() => toXlsx(base(over)));

  it("refuses bad layout options", () => {
    expect(r({ freezeColumns: 5 })).toBe("layout_invalid");
    expect(r({ freezeColumns: -1 })).toBe("layout_invalid");
    expect(r({ freezeColumns: 1.5 })).toBe("layout_invalid");
    expect(r({ autoFilter: "yes" as never })).toBe("layout_invalid");
    expect(r({ headerFill: "red" })).toBe("layout_invalid");
    expect(r({ headerFill: "#FFFFFF" })).toBe("layout_invalid");
    expect(r({ rowLayout: [{ outlineLevel: 8 }] })).toBe("layout_invalid");
    expect(r({ rowLayout: [{ fill: "12345" }] })).toBe("layout_invalid");
    expect(r({ rowLayout: [null, {}] })).toBe("layout_invalid");
    expect(r({ rowLayout: ["x" as never] })).toBe("layout_invalid");
    expect(r({ outlineSummary: "left" as never })).toBe("layout_invalid");
    expect(r({ page: { paper: "B5" as never } })).toBe("layout_invalid");
    expect(r({ page: { orientation: "sideways" as never } })).toBe("layout_invalid");
    expect(r({ page: { fitToWidth: 1 as never } })).toBe("layout_invalid");
    expect(r({ page: { printArea: "A1:ZZZZ9" } })).toBe("layout_invalid");
    expect(r({ page: { printArea: "B2:A1" } })).toBe("layout_invalid");
    expect(
      reason(() =>
        toXlsx([
          { name: "S", columns: [{ header: "h", type: "string", fill: "zzzzzz" }], rows: [] },
        ]),
      ),
    ).toBe("layout_invalid");
  });

  it("refuses conditional formats that are not typed as their column", () => {
    const cf = (c: Partial<XlsxConditionalFormat>) =>
      r({
        conditionalFormats: [
          { column: "n", when: { op: "gt", value: 1 }, style: { bold: true }, ...c },
        ],
      });
    expect(() =>
      toXlsx(
        base({
          conditionalFormats: [
            { column: "n", when: { op: "gt", value: 1 }, style: { bold: true } },
          ],
        }),
      ),
    ).not.toThrow();
    expect(cf({ column: "missing" })).toBe("conditional_format_invalid");
    expect(cf({ style: {} })).toBe("conditional_format_invalid");
    expect(cf({ style: { fill: "nope" } })).toBe("conditional_format_invalid");
    expect(cf({ when: { op: "gt", value: "1" } })).toBe("conditional_format_invalid");
    expect(cf({ when: { op: "gt", value: Number.NaN } })).toBe("conditional_format_invalid");
    expect(cf({ when: { op: "gt", value: { today: 1 } } })).toBe("conditional_format_invalid");
    expect(cf({ column: "d", when: { op: "gt", value: "2026-02-30" } })).toBe(
      "conditional_format_invalid",
    );
    expect(cf({ column: "d", when: { op: "gt", value: { today: 1.5 } } })).toBe(
      "conditional_format_invalid",
    );
    expect(cf({ column: "b", when: { op: "gt", value: true } })).toBe("conditional_format_invalid");
    expect(cf({ column: "b", when: { op: "eq", value: "TRUE" } })).toBe(
      "conditional_format_invalid",
    );
    expect(cf({ column: "a", when: { op: "between", min: "a", max: "b" } })).toBe(
      "conditional_format_invalid",
    );
    expect(cf({ column: "a", when: { op: "eq", value: "x".repeat(256) } })).toBe(
      "conditional_format_invalid",
    );
    expect(cf({ column: "a", when: { op: "containsText", text: "" } })).toBe(
      "conditional_format_invalid",
    );
    expect(cf({ when: { op: "matches" } as never })).toBe("conditional_format_invalid");
    expect(r({ conditionalFormats: {} as never })).toBe("conditional_format_invalid");
  });

  it("builds the expression itself: a caller's formula text in a rule is ignored", () => {
    const z = toXlsx(
      base({
        conditionalFormats: [
          {
            column: "n",
            when: { op: "eq", value: 1, formula: 'WEBSERVICE("x")' } as never,
            style: { bold: true },
          },
        ],
      }),
    );
    const sheet = text(z, "xl/worksheets/sheet1.xml");
    expect(sheet).toContain("<formula>AND(ISNUMBER($B2),$B2=1)</formula>");
    expect(sheet).not.toContain("WEBSERVICE");
  });

  it("refuses formulas that reach outside the workbook, and bad results", () => {
    const f = (formula: string, o?: Parameters<typeof xlsxFormula>[1]) =>
      reason(() => xlsxFormula(formula, o));
    expect(f("")).toBe("formula_invalid");
    expect(f("=SUM(A1)")).toBe("formula_invalid");
    expect(f("A".repeat(8193))).toBe("formula_invalid");
    expect(() => xlsxFormula("A".repeat(8192))).not.toThrow();
    expect(f("SUM(A1)\u0000")).toBe("formula_invalid");
    expect(f("[1]Sheet1!A1")).toBe("formula_invalid");
    expect(f("'[book.xlsx]S'!A1")).toBe("formula_invalid");
    expect(f("cmd|' /C calc'!A0")).toBe("formula_invalid");
    expect(f('"open')).toBe("formula_invalid");
    for (const fn of XLSX_BLOCKED_FUNCTIONS) {
      expect(f(`${fn}("https://x")`), fn).toBe("formula_invalid");
      expect(f(`1+_xlfn.${fn.toLowerCase()} ("x")`), fn).toBe("formula_invalid");
    }
    expect(f("IF(A1,1,0)", { result: Number.POSITIVE_INFINITY })).toBe("formula_invalid");
    expect(f("IF(A1,1,0)", { result: {} as never })).toBe("formula_invalid");
    // Inside a string literal the same characters and names are only text.
    expect(() => xlsxFormula('IF(A1="WEBSERVICE(x) [1] |",1,0)')).not.toThrow();
    // A longer name that ends in a blocked one is another function.
    expect(() => xlsxFormula("XHYPERLINK(A1)+HYPERLINKS(A1)")).not.toThrow();
  });

  it("refuses a cached result that does not fit its column", () => {
    const one =
      (type: XlsxSheet["columns"][number]["type"], result: number | string | boolean) => () =>
        toXlsx([
          { name: "S", columns: [{ header: "h", type }], rows: [[xlsxFormula("A1", { result })]] },
        ]);
    expect(reason(one("number", "x"))).toBe("cell_invalid");
    expect(reason(one("integer", 1.5))).toBe("cell_invalid");
    expect(reason(one("string", 1))).toBe("cell_invalid");
    expect(reason(one("boolean", 1))).toBe("cell_invalid");
    expect(reason(one("date", "soon"))).toBe("cell_invalid");
    expect(text(one("date", "2026-01-02")(), "xl/worksheets/sheet1.xml")).toContain(
      '<c r="A2" s="1"><f>A1</f><v>46024</v></c>',
    );
    expect(text(one("boolean", true)(), "xl/worksheets/sheet1.xml")).toContain(
      '<c r="A2" t="b"><f>A1</f><v>1</v></c>',
    );
  });
});

describe("toXlsx layout in other readers (PR-LDC-52)", () => {
  it.skipIf(!tools)("writes well-formed XML parts in a clean ZIP (xmllint, unzip)", () => {
    const dir = join(tmp, "layout");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "layout.xlsx");
    writeFileSync(file, zip);
    execFileSync("unzip", ["-tq", file]);
    for (const [p, data] of readZip(zip)) {
      const out = join(dir, "parts", p);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, data);
      execFileSync("xmllint", ["--noout", "--nonet", out]);
    }
  });

  it.skipIf(!openpyxl)("opens in openpyxl with the layout asked for", () => {
    const file = join(tmp, "openpyxl.xlsx");
    writeFileSync(file, zip);
    const script = [
      "import json, sys, openpyxl",
      "wb = openpyxl.load_workbook(sys.argv[1])",
      "ws = wb['Register']",
      's2 = wb["Bob\'s summary"]',
      "cf = [(str(r.sqref), [x.formula[0] for x in r.rules]) for r in ws.conditional_formatting]",
      "print(json.dumps({",
      " 'freeze': ws.freeze_panes, 'filter': ws.auto_filter.ref,",
      " 'levels': [ws.row_dimensions[i].outline_level for i in range(2, 6)],",
      " 'fill_a1': ws['A1'].fill.fgColor.rgb, 'fill_b3': ws['B3'].fill.fgColor.rgb, 'fill_a3': ws['A3'].fill.fill_type,",
      " 'date_fmt': ws['C2'].number_format, 'bold_a1': ws['A1'].font.b,",
      " 'orientation': ws.page_setup.orientation, 'paper': ws.page_setup.paperSize,",
      " 'fit': ws.sheet_properties.pageSetUpPr.fitToPage, 'fit_w': ws.page_setup.fitToWidth, 'fit_h': ws.page_setup.fitToHeight,",
      " 'titles': ws.print_title_rows, 'area': ws.print_area, 'area2': s2.print_area,",
      " 'summary_below': s2.sheet_properties.outlinePr.summaryBelow,",
      " 'f2': ws['F2'].value, 'f5': ws['F5'].value, 'b2': s2['B2'].value, 'b3': s2['B3'].value, 'a3': ws['A3'].value,",
      " 'cf': cf}))",
    ].join("\n");
    const out = JSON.parse(
      execFileSync("python3", ["-I", "-c", script, file], { encoding: "utf8" }),
    ) as Record<string, unknown>;
    expect(out).toMatchObject({
      freeze: "B2",
      filter: "A1:F5",
      levels: [0, 1, 1, 2],
      fill_a1: "FFBDD7EE",
      fill_b3: "FFFFF2CC",
      fill_a3: null,
      date_fmt: "yyyy-mm-dd",
      bold_a1: true,
      orientation: "landscape",
      paper: 9,
      fit: true,
      fit_w: 1,
      fit_h: 0,
      titles: "$1:$1",
      summary_below: false,
      f2: "=SUM(D2:D5)",
      f5: "=D5*2",
      b2: '="Total: "&TEXT(Register!D2,"0")',
      // The neutralised text stays text in another reader, never a formula.
      a3: "'=cmd|' /C calc'!A0",
    });
    expect(String(out.area)).toMatch(/\$A\$1:\$F\$5$/);
    expect(String(out.area2)).toMatch(/\$A\$1:\$C\$3$/);
    expect(String(out.b3)).toMatch(/^\{"formula"/);
    expect(out.cf).toContainEqual(["A2:F5", ["AND(ISNUMBER($C2),$C2<TODAY())"]]);
    // openpyxl groups rules by range: seven rules over six ranges.
    expect((out.cf as Array<[string, string[]]>).flatMap(([, f]) => f)).toHaveLength(7);
  });
});

const LAYOUT_GOLDEN = "a78c556044c35944d8d0b1b400611b3a97c763e2e4afdfc0ec2a5048d29d3b7f";
