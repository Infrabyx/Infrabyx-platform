// `registerExport` (regulatory templates item (a), part 1; R1-D-322): a synthetic 1,000-row
// register on CA-A01's filed Calendar layout, in xlsx, csv, pdf and ods, read back through the
// readers: the bounded XLSX reader, a CSV parse, pdftotext and LibreOffice (where installed).
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RegisterDefinition,
  RegisterError,
  definitionFromIndex,
  type SheetLayout,
} from "@infrabyx/contracts/registers";
import { pdfNeedsShaping } from "./pdf-route.js";
import { registerExport, registerPdfDocument } from "./register.js";
import { readXlsx } from "./xlsx-read.js";

const INDEX = JSON.parse(
  readFileSync(
    new URL("../../../docs/regulatory-templates/template index.json", import.meta.url),
    "utf8",
  ),
) as Array<{ code: string; title: string; sheets: SheetLayout[] }>;
const ca = INDEX.find((r) => r.code === "CA-A01")!;
const def = (() => {
  const d = definitionFromIndex(ca, { version: "1.0.0" });
  for (const c of d.sheets[0]!.columns) {
    if (c.key === "compliance") c.required = true;
    if (c.key === "done_on") c.type = "date";
    if (c.key === "status") Object.assign(c, { type: "enum", enum: ["Open", "Done"] });
  }
  return RegisterDefinition.parse(d);
})();
const LABELS = ca.sheets[0]!.cols;
const FREQ = ["Annual", "Quarterly", "Half-yearly", "Event-driven"];
const rows = Array.from({ length: 1000 }, (_, i) => ({
  frequency: FREQ[i % 4],
  compliance: `Synthetic filing ${i + 1} — रिटर्न`,
  timeline: `Within ${(i % 60) + 1} days`,
  reference: `Sec. ${(i % 470) + 1}`,
  due_date_fy: `FY 2026-27, item ${i + 1}`,
  ...(i % 3 === 0 ? { done_on: `2026-${String((i % 12) + 1).padStart(2, "0")}-15` } : {}),
  status: i % 3 === 0 ? "Done" : "Open",
}));
/** A row as the readers give it back: text cells in the filed order. */
const asText = (r: (typeof rows)[number]) => [
  r.frequency,
  r.compliance,
  r.timeline,
  r.reference,
  r.due_date_fy,
  r.done_on ?? "",
  r.status,
];
const created = new Date("2026-11-28T00:00:00Z");
const serialToIso = (v: unknown) =>
  typeof v === "number"
    ? new Date(Math.round((v - 25569) * 86_400_000)).toISOString().slice(0, 10)
    : (v ?? "");

function parseCsv(s: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q && c === '"' && s[i + 1] === '"') {
      f += '"';
      i++;
    } else if (q && c === '"') {
      q = false;
    } else if (q) {
      f += c;
    } else if (c === '"') {
      q = true;
    } else if (c === ",") {
      row.push(f);
      f = "";
    } else if (c === "\r" && s[i + 1] === "\n") {
      row.push(f);
      out.push(row);
      row = [];
      f = "";
      i++;
    } else {
      f += c;
    }
  }
  return out;
}
const has = (bin: string, arg: string) => spawnSync(bin, [arg], { encoding: "utf8" }).status === 0;
const soffice = has("soffice", "--version");
const pdftotext = has("pdftotext", "-v");
function convertOds(bytes: Buffer): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "ipb-reg-"));
  writeFileSync(join(dir, "in.ods"), bytes);
  execFileSync(
    "soffice",
    ["--headless", "--convert-to", "xlsx", "--outdir", join(dir, "out"), join(dir, "in.ods")],
    {
      stdio: "ignore",
      timeout: 180_000,
    },
  );
  return readFileSync(join(dir, "out", "in.xlsx"));
}

describe("registerExport: CA-A01, 1,000 synthetic rows, four formats", () => {
  it("xlsx: the filed labels in order, every row back through the bounded reader", () => {
    const x = registerExport(def, { Calendar: rows }, "xlsx", { created });
    const [sheet] = readXlsx(new Uint8Array(x), { maxRows: 2000 });
    expect(sheet!.name).toBe("Calendar");
    expect(sheet!.rows[0]).toEqual(LABELS);
    expect(sheet!.rows.length).toBe(1001);
    expect(
      sheet!.rows
        .slice(1)
        .map((r) => LABELS.map((_, i) => (i === 5 ? serialToIso(r[i]) : (r[i] ?? "")))),
    ).toEqual(rows.map(asText));
    // Deterministic: the same input gives the same bytes.
    expect(registerExport(def, { Calendar: rows }, "xlsx", { created }).equals(x)).toBe(true);
  });

  it("csv: the labels as the header, every row back, formulas neutralised", () => {
    const c = registerExport(def, { Calendar: rows }, "csv").toString("utf8");
    expect(c.startsWith("﻿")).toBe(true);
    const table = parseCsv(c.slice(1));
    expect(table[0]).toEqual(LABELS);
    expect(table.slice(1)).toEqual(rows.map(asText));
    const evil = registerExport(
      def,
      { Calendar: [{ compliance: '=HYPERLINK("https://x.invalid")' }] },
      "csv",
    );
    expect(parseCsv(evil.toString("utf8").slice(1))[1]![1]).toBe(
      `'=HYPERLINK("https://x.invalid")`,
    );
  });

  it("pdf: Indic text is refused in-process and goes through DOCGEN (registerPdfDocument, R1-D-96)", () => {
    expect(() => registerExport(def, { Calendar: rows.slice(0, 2) }, "pdf")).toThrow(/shaping/);
    const doc = registerPdfDocument(def, { Calendar: rows.slice(0, 2) });
    expect(pdfNeedsShaping(doc)).toBe(true);
    expect(doc.blocks[1]).toMatchObject({ type: "table", header: LABELS });
  });

  it.skipIf(!pdftotext)("pdf: a tagged table whose text reads back", () => {
    const latin = rows
      .slice(0, 40)
      .map((r) => ({ ...r, compliance: r.compliance.replace(" — रिटर्न", "") }));
    const p = registerExport(def, { Calendar: latin }, "pdf", { created });
    expect(p.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const dir = mkdtempSync(join(tmpdir(), "ipb-reg-pdf-"));
    writeFileSync(join(dir, "r.pdf"), p);
    const txt = execFileSync("pdftotext", [join(dir, "r.pdf"), "-"], { encoding: "utf8" }).replace(
      /\s+/g,
      " ",
    );
    expect(txt).toContain("CA-A01 Companies Act Compliance Calendar");
    for (const l of ["Frequency", "Compliance", "Due date (FY)"]) expect(txt).toContain(l);
    expect(txt).toContain("Synthetic filing 40");
  });

  it.skipIf(!soffice)(
    "ods: LibreOffice opens it and every row reads back",
    { timeout: 240_000 },
    () => {
      const o = registerExport(def, { Calendar: rows }, "ods", { created });
      const [sheet] = readXlsx(new Uint8Array(convertOds(o)), { maxRows: 2000 });
      expect(sheet!.rows[0]).toEqual(LABELS);
      expect(
        sheet!.rows
          .slice(1)
          .map((r) => LABELS.map((_, i) => (i === 5 ? serialToIso(r[i]) : (r[i] ?? "")))),
      ).toEqual(rows.map(asText));
    },
  );

  it("refuses a row its definition refuses, naming the sheet, row and column, before writing", () => {
    try {
      registerExport(
        def,
        { Calendar: [rows[0]!, { ...rows[1]!, status: "Closed", compliance: "" }] },
        "xlsx",
      );
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(RegisterError);
      expect((e as RegisterError).problems).toEqual([
        { reason: "required", column: "Calendar[1].compliance" },
        { reason: "enum", column: "Calendar[1].status" },
      ]);
    }
    expect(() => registerExport(def, { Unknown: [] }, "xlsx")).toThrow(RegisterError);
  });
});
