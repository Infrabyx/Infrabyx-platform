// Register definitions against the owner's filed layouts (regulatory templates item (a), part 1;
// R1-D-322): CA-A01's Calendar validates, a swapped pair and a missing required column are refused
// by name, and every one of the 114 register layouts in `template index.json` parses.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  REGISTER_RETENTION_FLOOR_YEARS,
  RegisterDefinition,
  RegisterError,
  assertLayout,
  assertRow,
  definitionFromIndex,
  registerSheet,
  rowProblems,
  type RegisterDefinition as Def,
  type SheetLayout,
} from "./registers.js";

interface IndexRecord {
  code: string;
  title: string;
  integration: string;
  sheets: SheetLayout[] | null;
}
const INDEX = JSON.parse(
  readFileSync(
    new URL("../../../docs/regulatory-templates/template index.json", import.meta.url),
    "utf8",
  ),
) as IndexRecord[];
const REGISTERS = INDEX.filter((r) => r.integration.startsWith("Module with list view"));
const record = (code: string) => INDEX.find((r) => r.code === code)!;
const refusal = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    if (e instanceof RegisterError) return { reason: e.reason, problems: e.problems };
    throw e;
  }
  return null;
};

/** CA-A01 as a product would define it: typed, with "Compliance" and "Due date (FY)" required. */
function calendar(): Def {
  const d = definitionFromIndex(
    record("CA-A01") as { code: string; title: string; sheets: SheetLayout[] },
    {
      version: "1.0.0",
    },
  );
  const s = d.sheets[0]!;
  for (const c of s.columns) {
    if (c.key === "compliance") c.required = true;
    if (c.key === "due_date_fy") c.required = true;
    if (c.key === "done_on") c.type = "date";
    if (c.key === "status")
      Object.assign(c, { type: "enum", enum: ["Open", "Done", "Not applicable"] });
  }
  return RegisterDefinition.parse(d);
}

describe("register definitions (item (a), part 1)", () => {
  it("there are 114 register templates with 320 sheets in the filed index", () => {
    expect(REGISTERS.length).toBe(114);
    expect(REGISTERS.reduce((n, r) => n + (r.sheets?.length ?? 0), 0)).toBe(320);
  });

  it("every one of the 114 register layouts parses as a definition and passes its own layout", () => {
    for (const r of REGISTERS) {
      const d = definitionFromIndex(r as { code: string; title: string; sheets: SheetLayout[] });
      expect(d.retention.years).toBe(REGISTER_RETENTION_FLOOR_YEARS);
      expect(() => assertLayout(d, r.sheets!)).not.toThrow();
    }
  });

  it("CA-A01's Calendar validates; its keys come from the filed labels", () => {
    const d = calendar();
    expect(d.sheets[0]!.columns.map((c) => c.key)).toEqual([
      "frequency",
      "compliance",
      "timeline",
      "reference",
      "due_date_fy",
      "done_on",
      "status",
    ]);
    expect(() => assertLayout(d, record("CA-A01").sheets!)).not.toThrow();
  });

  it("a sheet with two columns swapped is refused, naming both", () => {
    const cols = [...record("CA-A01").sheets![0]!.cols];
    [cols[1], cols[3]] = [cols[3]!, cols[1]!];
    const r = refusal(() => assertLayout(calendar(), [{ name: "Calendar", cols }]));
    expect(r).toEqual({
      reason: "layout_mismatch",
      problems: [
        { reason: "column_order", sheet: "Calendar", columns: ["Compliance", "Reference"] },
      ],
    });
  });

  it("a missing required column is refused, and so is an extra one or a renamed sheet", () => {
    const cols = record("CA-A01").sheets![0]!.cols.filter((c) => c !== "Compliance");
    expect(refusal(() => assertLayout(calendar(), [{ name: "Calendar", cols }]))?.problems).toEqual(
      [{ reason: "column_missing", sheet: "Calendar", columns: ["Compliance"], required: true }],
    );
    const extra = [...record("CA-A01").sheets![0]!.cols, "Remarks"];
    expect(
      refusal(() => assertLayout(calendar(), [{ name: "Calendar", cols: extra }]))?.problems,
    ).toEqual([{ reason: "column_unknown", sheet: "Calendar", columns: ["Remarks"] }]);
    expect(
      refusal(() =>
        assertLayout(calendar(), [
          { name: "Calendar 2026", cols: record("CA-A01").sheets![0]!.cols },
        ]),
      )?.problems.map((p) => p.reason),
    ).toEqual(["sheet_missing", "sheet_unknown"]);
  });

  it("a repeated filed label (OUT-A01) keeps unique keys and its layout", () => {
    const r = record("OUT-A01");
    const d = definitionFromIndex(r as { code: string; title: string; sheets: SheetLayout[] });
    const s = d.sheets.find((x) => x.name === "Provider Concentration")!;
    expect(s.columns.filter((c) => c.label === "Service provider").map((c) => c.key)).toEqual([
      "service_provider",
      "service_provider_2",
    ]);
    expect(() => assertLayout(d, r.sheets!)).not.toThrow();
  });

  it("rows are checked against their columns: required, type, enum and unknown keys", () => {
    const s = registerSheet(calendar(), "Calendar");
    expect(
      rowProblems(s, { compliance: "AOC-4", due_date_fy: "Within 30 days of the AGM" }),
    ).toEqual([]);
    expect(
      rowProblems(s, { due_date_fy: "x", done_on: "2026-02-30", status: "Closed", pan: "SYNTH" }),
    ).toEqual([
      { reason: "required", column: "compliance" },
      { reason: "type", column: "done_on" },
      { reason: "enum", column: "status" },
      { reason: "unknown_key", column: "pan" },
    ]);
    expect(() => assertRow(s, { compliance: "MGT-7" })).toThrow(RegisterError);
  });

  it("refuses a definition below the eight-year floor, a SECRET column, or an enum without values", () => {
    const d = calendar();
    expect(RegisterDefinition.safeParse({ ...d, retention: { years: 7 } }).success).toBe(false);
    const secret = structuredClone(d);
    secret.sheets[0]!.columns[0]!.dataClass = "SECRET" as never;
    expect(RegisterDefinition.safeParse(secret).success).toBe(false);
    const noValues = structuredClone(d);
    delete noValues.sheets[0]!.columns[6]!.enum;
    expect(RegisterDefinition.safeParse(noValues).success).toBe(false);
    const gap = structuredClone(d);
    gap.sheets[0]!.columns[0]!.order = 9;
    expect(RegisterDefinition.safeParse(gap).success).toBe(false);
  });
});
