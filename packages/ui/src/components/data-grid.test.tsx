// The accessible data grid and column mapper (PR-LDC-32; R1-D-159): the server-rendered
// markup (roles, ARIA attributes, the row window over 10,000 rows) and the keyboard model, edits,
// validators, selection and every mapping without dragging, through the same reducers the client
// views call. Browser checks (axe, HTML_CodeSniffer, focus) run against the gallery in the a11y gate.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  assignMapping,
  checkCell,
  ColumnMapper,
  DataGrid,
  DataGridView,
  gridKey,
  gridWindow,
  initialGridState,
  mapperKey,
  messages,
  unmappedRequired,
  type ColumnMapping,
  type GridColumn,
  type GridContext,
  type GridEffect,
  type GridRow,
  type GridState,
  type MapperContext,
  type MapperState,
} from "../index.js";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const t = messages("en-IN");
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

const COLUMNS: GridColumn[] = [
  { key: "ref", header: "Reference", type: "text", readOnly: true, rowHeader: true },
  { key: "title", header: "Title", type: "text", required: true, maxLength: 20 },
  {
    key: "amount",
    header: "Amount",
    type: "number",
    min: 0,
    validate: (v) => (typeof v === "number" && v % 1 !== 0 ? "Amount must be whole." : undefined),
  },
  { key: "due", header: "Due", type: "date", min: "2026-01-01" },
  {
    key: "status",
    header: "Status",
    type: "enum",
    options: [
      { value: "open", label: "Open" },
      { value: "closed", label: "Closed" },
    ],
  },
  { key: "done", header: "Done", type: "boolean" },
];

const rows = (n: number): GridRow[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    ref: `REF-${i + 1}`,
    title: `Item ${i + 1}`,
    amount: i * 10,
    due: "2026-03-31",
    status: "open",
    done: false,
  }));

const ctxOf = (n = 30, selection: GridContext["selection"] = "multiple"): GridContext => ({
  columns: COLUMNS,
  rows: rows(n),
  selection,
  pageSize: 10,
  rowHeight: 44,
  t,
});

/** Press keys in order, collecting the effects. */
function press(
  ctx: GridContext,
  keys: (string | [string, { ctrl?: boolean }])[],
  from: GridState = initialGridState(),
) {
  let state = from;
  const effects: GridEffect[] = [];
  for (const k of keys) {
    const [key, mods] = typeof k === "string" ? [k, {}] : k;
    const r = gridKey(state, key, mods, ctx);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
}

/** Type into the editor (what the view's onChange does). */
const typed = (s: GridState, draft: string | boolean): GridState =>
  s.editing ? { ...s, editing: { draft } } : s;

describe("PR-LDC-32: DataGrid markup (WAI-ARIA grid pattern)", () => {
  it("PR-LDC-32: renders grid, rowgroup, row, columnheader, rowheader and gridcell roles with one tab stop", () => {
    const out = html(
      <DataGrid id="g" label="Obligations" columns={COLUMNS} rows={rows(3)} selection="multiple" />,
    );
    expect(out).toContain('role="grid"');
    expect(out).toContain('aria-labelledby="g-label"');
    expect(out).toContain('aria-describedby="g-hint"');
    expect(out).toContain('aria-multiselectable="true"');
    expect(out).toContain('aria-colcount="6"');
    expect(count(out, /role="rowgroup"/g)).toBe(2);
    expect(count(out, /role="columnheader"/g)).toBe(6);
    expect(count(out, /role="rowheader"/g)).toBe(3);
    expect(count(out, /role="gridcell"/g)).toBe(15);
    // Roving tabindex: exactly one cell is in the tab order, the first data cell.
    expect(count(out, /tabindex="0"/g)).toBe(1);
    expect(out).toMatch(/data-cell="0:0" tabindex="0"/);
    // Read-only column cells say so; editable ones do not.
    expect(count(out, /aria-readonly="true"/g)).toBe(3);
    // Row selection state is on every row of a selectable grid.
    expect(count(out, /aria-selected="false"/g)).toBe(3);
    // No inline styles (CSP without unsafe-inline).
    expect(out).not.toMatch(/style="/);
    // Typed display: Indian grouping, DD MMM YYYY, option labels, Yes/No.
    expect(out).toContain("31 Mar 2026");
    expect(out).toContain(">Open<");
    expect(out).toContain(">No<");
    expect(out).toContain("Press Space to select a row.");
  });

  it("PR-LDC-32: a grid without selection carries no aria-selected and is not multiselectable", () => {
    const out = html(<DataGrid id="g" label="L" columns={COLUMNS} rows={rows(2)} />);
    expect(out).not.toContain("aria-selected");
    expect(out).not.toContain("aria-multiselectable");
  });

  it("PR-LDC-32: marks selected rows and the active cell from state", () => {
    const state: GridState = { ...initialGridState(["r1"]), row: 1, col: 2 };
    const out = html(
      <DataGridView
        id="g"
        label="L"
        columns={COLUMNS}
        rows={rows(3)}
        selection="single"
        state={state}
      />,
    );
    expect(out).toMatch(/aria-rowindex="3" aria-selected="true"/);
    expect(out).toMatch(/data-cell="1:2" tabindex="0"/);
    expect(count(out, /tabindex="0"/g)).toBe(1);
  });

  it("PR-LDC-32: an editor in a refused edit is invalid and described by the visible message", () => {
    const state: GridState = {
      ...initialGridState(),
      row: 0,
      col: 2,
      editing: { draft: "abc", error: "Enter Amount as a number, like 1250 or 12.5." },
    };
    const out = html(
      <DataGridView id="g" label="L" columns={COLUMNS} rows={rows(2)} state={state} />,
    );
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('aria-describedby="g-error"');
    expect(out).toContain('id="g-error"');
    expect(out).toContain('aria-label="Amount, row REF-1"');
    // The editor is the tab stop; the cell around it is not focusable (one target, SC 2.5.8).
    expect(out).not.toMatch(/data-cell="0:2" tabindex/);
    expect(count(out, /tabindex="0"/g)).toBe(0);
    expect(out).toContain('inputMode="decimal"');
    // The polite live region is always present for announcements.
    expect(out).toContain('role="status" aria-live="polite"');
  });

  it("PR-LDC-32: editors follow the column type (date input, option list, checkbox)", () => {
    const at = (col: number, draft: string | boolean) =>
      html(
        <DataGridView
          id="g"
          label="L"
          columns={COLUMNS}
          rows={rows(1)}
          state={{ ...initialGridState(), col, editing: { draft } }}
        />,
      );
    expect(at(3, "2026-03-31")).toContain('type="date"');
    const select = at(4, "open");
    expect(select).toContain("<select");
    expect(select).toContain('<option value="closed">Closed</option>');
    expect(at(5, true)).toMatch(/type="checkbox"[^>]*checked/);
  });

  it("PR-LDC-32: takes its labels from the catalogue (Hindi by locale)", () => {
    const out = html(<DataGrid id="g" label="L" columns={COLUMNS} rows={rows(1)} locale="hi-IN" />);
    expect(out).toContain("तीर कुंजियों");
    expect(out).toContain(">नहीं<");
  });
});

describe("PR-LDC-32: windowed rows", () => {
  it("PR-LDC-32: renders only a window of 10,000 rows, with the full aria-rowcount", () => {
    const out = html(
      <DataGrid id="g" label="L" columns={COLUMNS} rows={rows(10_000)} viewportRows={10} />,
    );
    expect(out).toContain('aria-rowcount="10001"');
    // Header row + 10 visible + 5 overscan below (none above at the top).
    expect(count(out, /role="row"/g)).toBe(16);
    expect(out).toContain('aria-rowindex="1"');
    expect(out).toContain('aria-rowindex="2"');
    expect(out).toContain('aria-rowindex="16"');
    expect(out).not.toContain('aria-rowindex="17"');
  });

  it("PR-LDC-32: deep in the list the window and aria-rowindex follow the scroll position", () => {
    const state: GridState = { ...initialGridState(), row: 5000, scrollTop: 5000 * 44 };
    const out = html(
      <DataGridView id="g" label="L" columns={COLUMNS} rows={rows(10_000)} state={state} />,
    );
    expect(out).toContain('aria-rowcount="10001"');
    expect(count(out, /role="row"/g)).toBe(1 + 5 + 10 + 5);
    // Data row 4995 (0-based) is aria-rowindex 4997; the active row 5000 is 5002.
    expect(out).toContain('aria-rowindex="4997"');
    expect(out).toContain('aria-rowindex="5016"');
    expect(out).not.toContain('aria-rowindex="5017"');
    expect(out).toMatch(/data-cell="5000:0" tabindex="0"/);
    expect(
      gridWindow({
        rowCount: 10_000,
        scrollTop: 5000 * 44,
        rowHeight: 44,
        viewportRows: 10,
        overscan: 5,
      }),
    ).toEqual({
      start: 4995,
      end: 5015,
      padTop: 4995 * 44,
      padBottom: (10_000 - 5015) * 44,
    });
  });

  it("PR-LDC-32: when the active row is scrolled out, the header keeps the single tab stop", () => {
    const state: GridState = { ...initialGridState(), row: 0, col: 1, scrollTop: 9000 * 44 };
    const out = html(
      <DataGridView id="g" label="L" columns={COLUMNS} rows={rows(10_000)} state={state} />,
    );
    expect(count(out, /tabindex="0"/g)).toBe(1);
    expect(out).toMatch(/data-cell="-1:1" tabindex="0"/);
  });
});

describe("PR-LDC-32: keyboard navigation", () => {
  const ctx = ctxOf(30);

  it("PR-LDC-32: arrows move one cell and stop at the edges; ArrowUp from the first row reaches the header", () => {
    expect(press(ctx, ["ArrowRight", "ArrowRight", "ArrowDown"]).state).toMatchObject({
      row: 1,
      col: 2,
    });
    expect(press(ctx, ["ArrowLeft"]).state).toMatchObject({ row: 0, col: 0 });
    expect(press(ctx, ["ArrowUp"]).state).toMatchObject({ row: -1, col: 0 });
    expect(press(ctx, ["ArrowUp", "ArrowUp"]).state).toMatchObject({ row: -1 });
    const right = press(ctx, Array(10).fill("ArrowRight")).state;
    expect(right.col).toBe(COLUMNS.length - 1);
    expect(press(ctx, Array(40).fill("ArrowDown")).state.row).toBe(29);
  });

  it("PR-LDC-32: Home/End go along the row; Ctrl+Home/Ctrl+End to the first and last cell", () => {
    const mid = press(ctx, ["ArrowDown", "ArrowDown", "ArrowRight", "ArrowRight"]).state;
    expect(gridKey(mid, "Home", {}, ctx).state).toMatchObject({ row: 2, col: 0 });
    expect(gridKey(mid, "End", {}, ctx).state).toMatchObject({ row: 2, col: 5 });
    expect(gridKey(mid, "Home", { ctrl: true }, ctx).state).toMatchObject({ row: -1, col: 0 });
    const last = gridKey(mid, "End", { ctrl: true }, ctx).state;
    expect(last).toMatchObject({ row: 29, col: 5 });
    // The last row is scrolled into view (rows 20–29 of 44 px).
    expect(last.scrollTop).toBe(20 * 44);
  });

  it("PR-LDC-32: PageDown and PageUp move a page of rows and keep the row in view", () => {
    const down = press(ctx, ["PageDown"]).state;
    expect(down.row).toBe(10);
    expect(down.scrollTop).toBe(1 * 44);
    expect(press(ctx, ["PageDown", "PageDown", "PageDown"]).state.row).toBe(29);
    const up = press(ctx, ["PageDown", "PageDown", "PageUp"]).state;
    expect(up.row).toBe(10);
    expect(press(ctx, ["PageUp"]).state.row).toBe(-1);
  });

  it("PR-LDC-32: every handled key is marked so the view prevents the default, others pass through", () => {
    const s = initialGridState();
    for (const k of [
      "ArrowDown",
      "ArrowUp",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
      "PageUp",
      "PageDown",
      " ",
    ])
      expect(gridKey(s, k, {}, ctx).handled).toBe(true);
    expect(gridKey(s, "Tab", {}, ctx).handled).toBe(false);
    expect(gridKey(s, "x", {}, ctx).handled).toBe(false);
  });
});

describe("PR-LDC-32: editing", () => {
  const ctx = ctxOf(5);
  const at = (row: number, col: number): GridState => ({ ...initialGridState(), row, col });

  it("PR-LDC-32: Enter or F2 opens the editor with the stored value; read-only cells refuse and say so", () => {
    expect(gridKey(at(0, 1), "Enter", {}, ctx).state.editing).toEqual({ draft: "Item 1" });
    expect(gridKey(at(0, 2), "F2", {}, ctx).state.editing).toEqual({ draft: "0" });
    expect(gridKey(at(0, 5), "Enter", {}, ctx).state.editing).toEqual({ draft: false });
    const ro = gridKey(at(0, 0), "Enter", {}, ctx);
    expect(ro.state.editing).toBeNull();
    expect(ro.effects).toEqual([
      { type: "announce", message: "Reference cannot be changed here." },
    ]);
    // The header row has nothing to edit.
    expect(gridKey(at(-1, 1), "Enter", {}, ctx).handled).toBe(false);
  });

  it("PR-LDC-32: Enter commits a valid value through onCellChange and announces it", () => {
    const open = gridKey(at(2, 1), "Enter", {}, ctx).state;
    const r = gridKey(typed(open, "Renamed"), "Enter", {}, ctx);
    expect(r.state.editing).toBeNull();
    expect(r.effects).toEqual([
      { type: "change", rowId: "r2", columnKey: "title", value: "Renamed" },
      { type: "announce", message: "Title saved." },
    ]);
  });

  it("PR-LDC-32: Escape cancels: nothing changes and the arrows work again", () => {
    const open = gridKey(at(1, 1), "F2", {}, ctx).state;
    // While editing, arrows belong to the editor.
    expect(gridKey(typed(open, "x"), "ArrowRight", {}, ctx).handled).toBe(false);
    const r = gridKey(typed(open, "x"), "Escape", {}, ctx);
    expect(r.state.editing).toBeNull();
    expect(r.effects.some((e) => e.type === "change")).toBe(false);
    expect(r.effects).toContainEqual({ type: "announce", message: "Edit cancelled." });
    expect(gridKey(r.state, "ArrowRight", {}, ctx).state.col).toBe(2);
  });

  it("PR-LDC-32: a refused value is not committed; the message stays and is announced", () => {
    const cases: [number, string | boolean, string][] = [
      [1, "", "Enter a value for Title."],
      [1, "x".repeat(21), "Title must be 20 characters or fewer."],
      [2, "12abc", "Enter Amount as a number, like 1250 or 12.5."],
      [2, "-1", "Amount must be 0 or more."],
      [2, "2.5", "Amount must be whole."], // the column's own validator
      [3, "2026-02-30", "Enter Due as a real date, like 2026-03-31."],
      [3, "31/03/2026", "Enter Due as a real date, like 2026-03-31."],
      [3, "2025-12-31", "Due must be on or after 2026-01-01."],
      [4, "pending", "Choose one of the listed options for Status."],
    ];
    for (const [col, draft, message] of cases) {
      const open = gridKey(at(0, col), "Enter", {}, ctx).state;
      const r = gridKey(typed(open, draft), "Enter", {}, ctx);
      expect(r.state.editing, `${col} ${String(draft)}`).toEqual({ draft, error: message });
      expect(r.effects).toEqual([{ type: "announce", message }]);
    }
  });

  it("PR-LDC-32: values are typed before onCellChange: numbers, ISO dates, options, booleans, empty", () => {
    const commit = (col: number, draft: string | boolean) => {
      const open = gridKey(at(1, col), "Enter", {}, ctx).state;
      return gridKey(typed(open, draft), "Enter", {}, ctx).effects.find((e) => e.type === "change");
    };
    expect(commit(2, "1,250")).toMatchObject({ value: 1250 });
    expect(commit(3, "2026-12-31")).toMatchObject({ value: "2026-12-31" });
    expect(commit(4, "closed")).toMatchObject({ value: "closed" });
    expect(commit(5, true)).toMatchObject({ value: true });
    expect(commit(2, " ")).toMatchObject({ value: null });
    // An unchanged value commits without a change.
    expect(commit(2, "10")).toBeUndefined();
  });

  it("PR-LDC-32: checkCell gives a server the same verdict as the grid", () => {
    const row = rows(1)[0]!;
    expect(checkCell(COLUMNS[2]!, "40", row, t)).toEqual({ ok: true, value: 40 });
    expect(checkCell(COLUMNS[2]!, "4.5", row, t)).toEqual({
      ok: false,
      error: "Amount must be whole.",
    });
  });
});

describe("PR-LDC-32: selection", () => {
  it("PR-LDC-32: Space toggles the row in a multi-select grid and Ctrl+A selects all", () => {
    const ctx = ctxOf(4, "multiple");
    const r = press(ctx, [" ", "ArrowDown", "ArrowDown", " "]);
    expect(r.state.selected).toEqual(["r0", "r2"]);
    expect(r.effects).toContainEqual({ type: "select", ids: ["r0", "r2"] });
    expect(r.effects).toContainEqual({ type: "announce", message: "Row REF-3 selected." });
    const off = gridKey(r.state, " ", {}, ctx);
    expect(off.state.selected).toEqual(["r0"]);
    expect(off.effects).toContainEqual({ type: "announce", message: "Row REF-3 not selected." });
    const all = gridKey(r.state, "a", { ctrl: true }, ctx);
    expect(all.state.selected).toEqual(["r0", "r1", "r2", "r3"]);
    expect(gridKey(all.state, "a", { ctrl: true }, ctx).state.selected).toEqual([]);
  });

  it("PR-LDC-32: single selection keeps one row; no selection ignores Space", () => {
    expect(press(ctxOf(4, "single"), [" ", "ArrowDown", " "]).state.selected).toEqual(["r1"]);
    const none = gridKey(initialGridState(), " ", {}, ctxOf(4, "none"));
    expect(none.handled).toBe(false);
    expect(gridKey(initialGridState(), "a", { ctrl: true }, ctxOf(4, "single")).handled).toBe(
      false,
    );
  });
});

describe("PR-LDC-32: column mapping without dragging (WCAG 2.2 SC 2.5.7)", () => {
  const sources = [
    { key: "c0", label: "Party name", sample: "Example Ltd" },
    { key: "c1", label: "Due on" },
    { key: "c2", label: "Value" },
  ];
  const targets = [
    { key: "party", label: "Party", required: true },
    { key: "due", label: "Due date", required: true },
    { key: "amount", label: "Amount" },
  ];
  const ctxFor = (mapping: ColumnMapping): MapperContext => ({ sources, targets, mapping, t });
  const empty: ColumnMapping = { party: null, due: null, amount: null };

  it("PR-LDC-32: renders a labelled select per field with every source, posting under the name", () => {
    const out = html(
      <ColumnMapper
        id="m"
        label="Map the file's columns"
        sources={sources}
        targets={targets}
        defaultMapping={{ party: "c0" }}
        name="map"
      />,
    );
    expect(out).toContain('role="group" aria-labelledby="m-label"');
    expect(count(out, /<select/g)).toBe(3);
    for (const x of targets) {
      expect(out).toContain(`for="m-field-${x.key}"`);
      expect(out).toContain(`name="map.${x.key}"`);
    }
    // Every source is an option of every field, so any field can take any source by select alone.
    expect(count(out, /<option value="c0"/g)).toBe(3);
    expect(count(out, /<option value="c2"/g)).toBe(3);
    expect(out).toContain('<option value="c0" selected="">Party name</option>');
    // Sources are buttons: draggable, and operable by keyboard with the instructions linked.
    expect(
      count(
        out,
        /<button type="button"[^>]*draggable="true"[^>]*aria-pressed="false"[^>]*aria-describedby="m-hint"/g,
      ),
    ).toBe(3);
    expect(out).toContain("Mapped to Party");
    expect(out).toContain('role="status" aria-live="polite"');
    expect(out).not.toMatch(/style="/);
  });

  it("PR-LDC-32: every source-to-field mapping is reachable with the keyboard alone", () => {
    for (const s of sources)
      for (let ti = 0; ti < targets.length; ti++) {
        let state: MapperState = { grabbed: null, candidate: 0 };
        let mapping = empty;
        const announced: string[] = [];
        const keys = [" ", ...Array(ti).fill("ArrowDown"), "Enter"];
        for (const key of keys) {
          const r = mapperKey(state, key, s.key, ctxFor(mapping));
          expect(r.handled).toBe(true);
          state = r.state;
          for (const e of r.effects)
            if (e.type === "mapping") mapping = e.mapping;
            else announced.push(e.message);
        }
        expect(mapping[targets[ti]!.key]).toBe(s.key);
        expect(state.grabbed).toBeNull();
        expect(announced[0]).toContain(`Picked up ${s.label}.`);
        expect(announced.at(-1)).toBe(`${s.label} mapped to ${targets[ti]!.label}.`);
      }
  });

  it("PR-LDC-32: every mapping is reachable by select alone (assignMapping), and a source feeds one field", () => {
    for (const s of sources)
      for (const x of targets) expect(assignMapping(empty, x.key, s.key)[x.key]).toBe(s.key);
    const moved = assignMapping({ ...empty, party: "c0" }, "due", "c0");
    expect(moved).toEqual({ party: null, due: "c0", amount: null });
    expect(assignMapping(moved, "due", null)).toEqual(empty);
    expect(unmappedRequired(moved, targets).map((x) => x.key)).toEqual(["party"]);
  });

  it("PR-LDC-32: arrows wrap, Home/End jump, Escape cancels without changing the mapping", () => {
    const ctx = ctxFor({ ...empty, due: "c1" });
    // Picking up a mapped source starts on its current field.
    let r = mapperKey({ grabbed: null, candidate: 0 }, "Enter", "c1", ctx);
    expect(r.state).toEqual({ grabbed: "c1", candidate: 1 });
    r = mapperKey(r.state, "ArrowUp", "c1", ctx);
    r = mapperKey(r.state, "ArrowUp", "c1", ctx);
    expect(r.state.candidate).toBe(2);
    expect(r.effects).toEqual([{ type: "announce", message: "Amount, field 3 of 3." }]);
    expect(mapperKey(r.state, "Home", "c1", ctx).state.candidate).toBe(0);
    expect(mapperKey(r.state, "End", "c1", ctx).state.candidate).toBe(2);
    const esc = mapperKey(r.state, "Escape", "c1", ctx);
    expect(esc.state.grabbed).toBeNull();
    expect(esc.effects).toEqual([
      { type: "announce", message: "Cancelled. Due on was not moved." },
    ]);
    // Keys that are not the mapper's pass through (Tab leaves the list).
    expect(mapperKey({ grabbed: null, candidate: 0 }, "Tab", "c1", ctx).handled).toBe(false);
  });
});
