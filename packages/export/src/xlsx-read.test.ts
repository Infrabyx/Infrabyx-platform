// The bounded XLSX reader (PR-LDC-31 reader; R1-D-154; threat model §3.127): values back from a
// workbook, and every hostile shape refused before or while it is read.
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readXlsx, xlsxRecords } from "./xlsx-read.js";
import { toXlsx } from "./xlsx.js";
import { writeZip } from "./zip.js";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
  return null;
};

const CT = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`;
const WB = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
const book = (sheet: string, extra: Record<string, string> = {}) =>
  writeZip(
    new Map(
      Object.entries({
        "[Content_Types].xml": CT,
        "xl/workbook.xml": WB,
        "xl/_rels/workbook.xml.rels": RELS,
        "xl/worksheets/sheet1.xml": sheet,
        ...extra,
      }).map(([k, v]) => [k, Buffer.from(v)]),
    ),
  );
const sheet = (rows: string) =>
  `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;

describe("readXlsx (PR-LDC-31 reader)", () => {
  it("reads back what toXlsx writes: strings, numbers, booleans and dates", () => {
    const bytes = toXlsx([
      {
        name: "Approvers",
        columns: [
          { header: "Name", type: "string" },
          { header: "Count", type: "integer" },
          { header: "Active", type: "boolean" },
          { header: "Since", type: "date" },
        ],
        rows: [
          ["Asha & Co <legal>", 3, true, "2026-11-13"],
          ["=cmd()", 0, false, "2026-04-01"],
        ],
      },
    ]);
    const [s] = readXlsx(bytes);
    expect(s?.name).toBe("Approvers");
    expect(s?.rows[0]).toEqual(["Name", "Count", "Active", "Since"]);
    expect(s?.rows[1]).toEqual(["Asha & Co <legal>", 3, true, "2026-11-13"]);
    // The writer neutralised the formula; the reader returns text, never a formula.
    expect(typeof s?.rows[2]?.[0]).toBe("string");
    expect(xlsxRecords(s!)[0]).toMatchObject({ Name: "Asha & Co <legal>", Count: 3 });
  });

  it("reads shared strings, rich text, sparse cells and cached formula results", () => {
    const ss = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>plain</t></si><si><r><t>ri</t></r><r><t>ch</t></r><rPh><t>x</t></rPh></si></sst>`;
    const s = readXlsx(
      book(
        sheet(
          `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>` +
            `<row r="3"><c r="B3"><f>SUM(1,2)</f><v>3</v></c><c r="C3" t="e"><v>#DIV/0!</v></c><c r="D3" t="str"><f>A1</f><v>plain</v></c></row>`,
        ),
        { "xl/sharedStrings.xml": ss },
      ),
    );
    expect(s[0]?.rows).toEqual([["plain", null, "rich"], [], [null, 3, null, "plain"]]);
  });

  it("refuses entity declarations, unknown entities and a DOCTYPE (no expansion, no fetch)", () => {
    const lol = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><worksheet><sheetData/></worksheet>`;
    expect(code(() => readXlsx(book(lol)))).toBe("IPB-SEC-012");
    const ext = sheet(`<row r="1"><c r="A1" t="inlineStr"><is><t>&xxe;</t></is></c></row>`);
    expect(code(() => readXlsx(book(ext)))).toBe("IPB-SEC-010");
  });

  it("refuses a decompression bomb by its declared ratio before inflating it", () => {
    const big = sheet(`<row r="1"><c r="A1"><v>1</v></c></row>${" ".repeat(5_000_000)}`);
    expect(code(() => readXlsx(book(big)))).toBe("IPB-SEC-013");
    expect(code(() => readXlsx(book(big), { maxRatio: 100_000, maxPartBytes: 1_000_000 }))).toBe(
      "IPB-SEC-013",
    );
  });

  it("refuses a part that inflates past its declared size", () => {
    const zip = book(sheet(`<row r="1"><c r="A1"><v>1</v></c></row>`));
    // Lower the central directory's uncompressed size of the sheet part.
    const b = Buffer.from(zip);
    let p = b.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    while (p >= 0) {
      const nlen = b.readUInt16LE(p + 28);
      const name = b.subarray(p + 46, p + 46 + nlen).toString();
      if (name === "xl/worksheets/sheet1.xml") b.writeUInt32LE(10, p + 24);
      p = b.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), p + 4);
    }
    expect(code(() => readXlsx(b))).toBe("IPB-SEC-010");
    expect(deflateRawSync(Buffer.from("x")).length).toBeGreaterThan(0);
  });

  it("refuses a macro project, too many rows or columns, a long cell and a non-workbook", () => {
    const ok = sheet(`<row r="1"><c r="A1"><v>1</v></c></row>`);
    expect(code(() => readXlsx(book(ok, { "xl/vbaProject.bin": "x" })))).toBe("IPB-SEC-012");
    expect(
      code(() => readXlsx(book(sheet(`<row r="3"><c r="A3"><v>1</v></c></row>`)), { maxRows: 2 })),
    ).toBe("IPB-SEC-013");
    expect(
      code(() =>
        readXlsx(book(sheet(`<row r="1"><c r="E1"><v>1</v></c></row>`)), { maxColumns: 4 }),
      ),
    ).toBe("IPB-SEC-013");
    const long = sheet(
      `<row r="1"><c r="A1" t="inlineStr"><is><t>${"x".repeat(50)}</t></is></c></row>`,
    );
    expect(code(() => readXlsx(book(long), { maxCellChars: 10 }))).toBe("IPB-SEC-013");
    expect(code(() => readXlsx(Buffer.from("not a zip at all, just text")))).toBe("IPB-SEC-010");
    expect(code(() => readXlsx(book(ok), { maxFileBytes: 100 }))).toBe("IPB-SEC-013");
    const unsafe = writeZip(new Map([["../evil.xml", Buffer.from("x")]]));
    expect(code(() => readXlsx(unsafe))).toBe("IPB-SEC-010");
  });
});
