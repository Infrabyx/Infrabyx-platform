// The data grid's logic without React (PR-LDC-32; R1-D-159): typed cell parsing and validation,
// the WAI-ARIA grid keyboard model as a pure reducer, the row window, and the column mapping with
// its keyboard move. `DataGrid` and `ColumnMapper` (`data-grid.tsx`) are thin views over these, and
// a server can run `checkCell` on a posted value with the same rules the grid used. No "use client":
// these are plain functions that server code may call.
import { formatDate } from "../i18n/format.js";
import type { Messages } from "../i18n/messages.js";

export type GridValue = string | number | boolean | null;

/** A row: its stable `id` and a value per column key. */
export type GridRow = Readonly<Record<string, GridValue>> & { readonly id: string };

/** A validator: a message when the value is refused, `undefined` when it is accepted. */
export type GridValidator = (value: GridValue, row: GridRow) => string | undefined;

interface GridColumnBase {
  key: string;
  header: string;
  /** Not editable: `aria-readonly` on its cells, and Enter or F2 does nothing. */
  readOnly?: boolean;
  /** An empty value is refused. */
  required?: boolean;
  /** Runs after the type's own checks, with the typed value. */
  validate?: GridValidator;
  /** The column that names each row (`role="rowheader"`). */
  rowHeader?: boolean;
}

export type GridColumn = GridColumnBase &
  (
    | { type: "text"; maxLength?: number }
    | { type: "number"; min?: number; max?: number }
    /** ISO `yyyy-mm-dd`; `min` and `max` are ISO dates too. */
    | { type: "date"; min?: string; max?: string }
    | { type: "enum"; options: readonly { value: string; label: string }[] }
    | { type: "boolean" }
  );

/** What an editor holds while a cell is edited: text, or a tick for a boolean column. */
export type GridDraft = string | boolean;

export type CellCheck = { ok: true; value: GridValue } | { ok: false; error: string };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NUMBER = /^-?(\d+(\.\d*)?|\.\d+)$/;

function isIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** The draft an editor starts with for a stored value. */
export function draftOf(column: GridColumn, value: GridValue): GridDraft {
  if (column.type === "boolean") return value === true;
  return value === null || value === undefined ? "" : String(value);
}

/**
 * Parse a draft into the column's type and check it: the type's own rules (a number, a real ISO
 * date, one of the options, the bounds, required), then the column's validator. A refusal carries
 * the message the grid shows and announces; only an accepted value reaches `onCellChange`.
 */
export function checkCell(
  column: GridColumn,
  draft: GridDraft,
  row: GridRow,
  t: Messages,
): CellCheck {
  const name = { column: column.header };
  const fail = (key: string, vars: Record<string, string | number> = {}): CellCheck => ({
    ok: false,
    error: t.t(key, { ...name, ...vars }),
  });
  let value: GridValue;
  if (column.type === "boolean") {
    value = typeof draft === "boolean" ? draft : draft.trim().toLowerCase() === "true";
  } else {
    const raw = typeof draft === "boolean" ? String(draft) : draft;
    const s = column.type === "text" ? raw : raw.trim();
    if (s.trim() === "") {
      if (column.required) return fail("ui.grid.err.required");
      value = null;
    } else if (column.type === "text") {
      if (column.maxLength !== undefined && s.length > column.maxLength)
        return fail("ui.grid.err.too_long", { max: column.maxLength });
      value = s;
    } else if (column.type === "number") {
      const plain = s.replace(/,/g, "");
      if (!NUMBER.test(plain) || !Number.isFinite(Number(plain))) return fail("ui.grid.err.number");
      const n = Number(plain);
      if (column.min !== undefined && n < column.min)
        return fail("ui.grid.err.min", { min: column.min });
      if (column.max !== undefined && n > column.max)
        return fail("ui.grid.err.max", { max: column.max });
      value = n;
    } else if (column.type === "date") {
      if (!isIsoDate(s)) return fail("ui.grid.err.date");
      if (column.min !== undefined && s < column.min)
        return fail("ui.grid.err.date_min", { min: column.min });
      if (column.max !== undefined && s > column.max)
        return fail("ui.grid.err.date_max", { max: column.max });
      value = s;
    } else {
      if (!column.options.some((o) => o.value === s)) return fail("ui.grid.err.option");
      value = s;
    }
  }
  const custom = column.validate?.(value, row);
  return custom ? { ok: false, error: custom } : { ok: true, value };
}

/** The text a cell shows for its value (Indian grouping for numbers, DD MMM YYYY for dates). */
export function formatCell(column: GridColumn, value: GridValue, t: Messages): string {
  if (column.type === "boolean") return t.t(value === true ? "ui.grid.yes" : "ui.grid.no");
  if (value === null || value === undefined || value === "") return "";
  if (column.type === "enum")
    return column.options.find((o) => o.value === value)?.label ?? String(value);
  if (column.type === "number" && typeof value === "number") {
    try {
      return new Intl.NumberFormat(t.locale).format(value);
    } catch {
      return new Intl.NumberFormat("en-IN").format(value);
    }
  }
  if (column.type === "date" && typeof value === "string" && isIsoDate(value))
    return formatDate(`${value}T00:00:00+05:30`);
  return String(value);
}

// ---- The row window ------------------------------------------------------------------------------

export interface GridWindow {
  /** The first data row rendered (0-based). */
  start: number;
  /** One past the last data row rendered. */
  end: number;
  /** Space for the rows above and below the window, in px. */
  padTop: number;
  padBottom: number;
}

/**
 * The rows to render: those in view at `scrollTop` (data rows of `rowHeight` px, `viewportRows`
 * of them visible) plus `overscan` rows each side. Rows outside stay out of the DOM; the grid's
 * `aria-rowcount` and each row's `aria-rowindex` keep the full size known.
 */
export function gridWindow(o: {
  rowCount: number;
  scrollTop: number;
  rowHeight: number;
  viewportRows: number;
  overscan: number;
}): GridWindow {
  const h = Math.max(1, o.rowHeight);
  const first = Math.max(0, Math.floor(Math.max(0, o.scrollTop) / h));
  const start = Math.min(o.rowCount, Math.max(0, first - o.overscan));
  const end = Math.min(o.rowCount, first + o.viewportRows + o.overscan);
  return {
    start,
    end: Math.max(start, end),
    padTop: start * h,
    padBottom: (o.rowCount - Math.max(start, end)) * h,
  };
}

/** The scroll position that brings data row `row` into view (unchanged when it already is). */
export function scrollToRow(
  scrollTop: number,
  row: number,
  rowHeight: number,
  viewportRows: number,
): number {
  if (row < 0) return scrollTop;
  const top = row * rowHeight;
  if (top < scrollTop) return top;
  const bottom = (row + 1) * rowHeight;
  const visible = viewportRows * rowHeight;
  return bottom > scrollTop + visible ? bottom - visible : scrollTop;
}

// ---- The keyboard model --------------------------------------------------------------------------

export type GridSelection = "none" | "single" | "multiple";

export interface GridState {
  /** The active cell: `row` -1 is the header row, 0… the data rows. */
  row: number;
  col: number;
  editing: null | { draft: GridDraft; error?: string };
  selected: readonly string[];
  scrollTop: number;
}

export interface GridContext {
  columns: readonly GridColumn[];
  rows: readonly GridRow[];
  selection: GridSelection;
  /** Rows moved by PageUp and PageDown (the visible rows). */
  pageSize: number;
  rowHeight: number;
  t: Messages;
}

export type GridEffect =
  | { type: "change"; rowId: string; columnKey: string; value: GridValue }
  | { type: "select"; ids: readonly string[] }
  | { type: "announce"; message: string };

export interface GridKeyResult {
  state: GridState;
  effects: GridEffect[];
  /** The key was the grid's: the view prevents the browser's default. */
  handled: boolean;
}

export interface KeyMods {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export function initialGridState(selected: readonly string[] = []): GridState {
  return { row: 0, col: 0, editing: null, selected, scrollTop: 0 };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function moveTo(state: GridState, ctx: GridContext, row: number, col: number): GridKeyResult {
  const lastRow = ctx.rows.length - 1;
  const r = clamp(row, -1, lastRow);
  const c = clamp(col, 0, ctx.columns.length - 1);
  return {
    state: {
      ...state,
      row: r,
      col: c,
      scrollTop: scrollToRow(state.scrollTop, r, ctx.rowHeight, ctx.pageSize),
    },
    effects: [],
    handled: true,
  };
}

/** Start editing the active cell (Enter or F2), unless it is a header or read-only. */
export function startEdit(state: GridState, ctx: GridContext): GridKeyResult {
  const column = ctx.columns[state.col];
  const row = ctx.rows[state.row];
  if (!column || !row) return { state, effects: [], handled: false };
  if (column.readOnly)
    return {
      state,
      effects: [
        { type: "announce", message: ctx.t.t("ui.grid.read_only", { column: column.header }) },
      ],
      handled: true,
    };
  return {
    state: { ...state, editing: { draft: draftOf(column, row[column.key] ?? null) } },
    effects: [],
    handled: true,
  };
}

/** Commit the edit (Enter): a refused value stays in the editor with its message; nothing changes. */
export function commitEdit(state: GridState, ctx: GridContext): GridKeyResult {
  const column = ctx.columns[state.col];
  const row = ctx.rows[state.row];
  if (!state.editing || !column || !row) return { state, effects: [], handled: false };
  const checked = checkCell(column, state.editing.draft, row, ctx.t);
  if (!checked.ok)
    return {
      state: { ...state, editing: { draft: state.editing.draft, error: checked.error } },
      effects: [{ type: "announce", message: checked.error }],
      handled: true,
    };
  const effects: GridEffect[] = [];
  if (checked.value !== (row[column.key] ?? null))
    effects.push({ type: "change", rowId: row.id, columnKey: column.key, value: checked.value });
  effects.push({
    type: "announce",
    message: ctx.t.t("ui.grid.saved", { column: column.header }),
  });
  return { state: { ...state, editing: null }, effects, handled: true };
}

/** Cancel the edit (Escape): the stored value stays. */
export function cancelEdit(state: GridState, ctx: GridContext): GridKeyResult {
  if (!state.editing) return { state, effects: [], handled: false };
  return {
    state: { ...state, editing: null },
    effects: [{ type: "announce", message: ctx.t.t("ui.grid.cancelled") }],
    handled: true,
  };
}

/** Toggle the active row's selection (Space); single selection keeps at most one row. */
export function toggleRow(state: GridState, ctx: GridContext): GridKeyResult {
  const row = ctx.rows[state.row];
  if (ctx.selection === "none" || !row) return { state, effects: [], handled: false };
  const on = state.selected.includes(row.id);
  const selected = on
    ? state.selected.filter((id) => id !== row.id)
    : ctx.selection === "single"
      ? [row.id]
      : [...state.selected, row.id];
  const label = rowLabel(ctx, state.row);
  return {
    state: { ...state, selected },
    effects: [
      { type: "select", ids: selected },
      {
        type: "announce",
        message: ctx.t.t(on ? "ui.grid.deselected" : "ui.grid.selected", { row: label }),
      },
    ],
    handled: true,
  };
}

/** How a row is named in announcements: its row-header value, else its position. */
export function rowLabel(ctx: GridContext, row: number): string {
  const header = ctx.columns.find((c) => c.rowHeader);
  const r = ctx.rows[row];
  if (header && r) {
    const text = formatCell(header, r[header.key] ?? null, ctx.t);
    if (text) return text;
  }
  return String(row + 1);
}

/**
 * One key on the grid (the WAI-ARIA grid pattern): arrows move one cell; Home and End go to the
 * row's first and last cell, with Ctrl to the grid's first and last cell; PageUp and PageDown move
 * a page of rows; Enter or F2 edits, then Enter commits and Escape cancels; Space selects the row;
 * Ctrl+A selects every row in a multi-select grid. While a cell is edited, every other key belongs
 * to the editor.
 */
export function gridKey(
  state: GridState,
  key: string,
  mods: KeyMods,
  ctx: GridContext,
): GridKeyResult {
  const none: GridKeyResult = { state, effects: [], handled: false };
  if (state.editing) {
    if (key === "Enter") return commitEdit(state, ctx);
    if (key === "Escape") return cancelEdit(state, ctx);
    return none;
  }
  const { row, col } = state;
  const lastCol = ctx.columns.length - 1;
  const lastRow = ctx.rows.length - 1;
  switch (key) {
    case "ArrowRight":
      return moveTo(state, ctx, row, col + 1);
    case "ArrowLeft":
      return moveTo(state, ctx, row, col - 1);
    case "ArrowDown":
      return moveTo(state, ctx, row + 1, col);
    case "ArrowUp":
      return moveTo(state, ctx, row - 1, col);
    case "Home":
      return mods.ctrl ? moveTo(state, ctx, -1, 0) : moveTo(state, ctx, row, 0);
    case "End":
      return mods.ctrl ? moveTo(state, ctx, lastRow, lastCol) : moveTo(state, ctx, row, lastCol);
    case "PageDown":
      return moveTo(state, ctx, Math.max(0, row) + ctx.pageSize, col);
    case "PageUp":
      return moveTo(state, ctx, row <= 0 ? -1 : Math.max(0, row - ctx.pageSize), col);
    case "Enter":
    case "F2":
      return startEdit(state, ctx);
    case " ":
    case "Spacebar":
      return toggleRow(state, ctx);
    case "a":
    case "A":
      if (mods.ctrl && ctx.selection === "multiple") {
        const all = state.selected.length === ctx.rows.length;
        const selected = all ? [] : ctx.rows.map((r) => r.id);
        return {
          state: { ...state, selected },
          effects: [
            { type: "select", ids: selected },
            {
              type: "announce",
              message: all
                ? ctx.t.t("ui.grid.none_selected")
                : ctx.t.t("ui.grid.all_selected", { count: ctx.rows.length }),
            },
          ],
          handled: true,
        };
      }
      return none;
    default:
      return none;
  }
}

// ---- Column mapping ------------------------------------------------------------------------------

export interface MapSource {
  key: string;
  label: string;
  /** A sample value from the file, shown under the label. */
  sample?: string;
}

export interface MapTarget {
  key: string;
  label: string;
  required?: boolean;
}

/** Target field key → source column key (`null`: not mapped). */
export type ColumnMapping = Readonly<Record<string, string | null>>;

/**
 * Map `source` to `target` (or clear the target with `null`). A source feeds one field at most:
 * mapping it to a new field takes it off the one it was on.
 */
export function assignMapping(
  mapping: ColumnMapping,
  target: string,
  source: string | null,
): ColumnMapping {
  const next: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(mapping))
    next[k] = source !== null && v === source ? null : v;
  next[target] = source;
  return next;
}

/** The required fields with no source yet. */
export function unmappedRequired(
  mapping: ColumnMapping,
  targets: readonly MapTarget[],
): MapTarget[] {
  return targets.filter((t) => t.required && !mapping[t.key]);
}

export interface MapperState {
  /** The source picked up with the keyboard (or a click), if any. */
  grabbed: string | null;
  /** The field the picked-up source would drop on (an index into the targets). */
  candidate: number;
}

export interface MapperContext {
  sources: readonly MapSource[];
  targets: readonly MapTarget[];
  mapping: ColumnMapping;
  t: Messages;
}

export type MapperEffect =
  { type: "mapping"; mapping: ColumnMapping } | { type: "announce"; message: string };

export interface MapperKeyResult {
  state: MapperState;
  effects: MapperEffect[];
  handled: boolean;
}

const labelOf = (list: readonly { key: string; label: string }[], key: string | null) =>
  list.find((x) => x.key === key)?.label ?? "";

/** Pick up `source`: the candidate starts on the field it is mapped to, else the first. */
export function grabSource(
  state: MapperState,
  source: string,
  ctx: MapperContext,
): MapperKeyResult {
  const on = ctx.targets.findIndex((t) => ctx.mapping[t.key] === source);
  const candidate = on >= 0 ? on : 0;
  const target = ctx.targets[candidate];
  return {
    state: { grabbed: source, candidate },
    effects: [
      {
        type: "announce",
        message: `${ctx.t.t("ui.mapper.picked_up", { source: labelOf(ctx.sources, source) })} ${
          target ? overMessage(ctx, candidate) : ""
        }`.trim(),
      },
    ],
    handled: true,
  };
}

function overMessage(ctx: MapperContext, i: number): string {
  const target = ctx.targets[i];
  return target
    ? ctx.t.t("ui.mapper.over", { target: target.label, n: i + 1, total: ctx.targets.length })
    : "";
}

/** Drop the picked-up source on target index `i` (Enter, a click on "Map here", or a drop). */
export function dropSource(state: MapperState, i: number, ctx: MapperContext): MapperKeyResult {
  const target = ctx.targets[i];
  if (!state.grabbed || !target) return { state, effects: [], handled: false };
  const mapping = assignMapping(ctx.mapping, target.key, state.grabbed);
  return {
    state: { grabbed: null, candidate: i },
    effects: [
      { type: "mapping", mapping },
      {
        type: "announce",
        message: ctx.t.t("ui.mapper.mapped", {
          source: labelOf(ctx.sources, state.grabbed),
          target: target.label,
        }),
      },
    ],
    handled: true,
  };
}

/** Put the picked-up source back (Escape, or focus leaving it): the mapping is unchanged. */
export function cancelGrab(state: MapperState, ctx: MapperContext): MapperKeyResult {
  if (!state.grabbed) return { state, effects: [], handled: false };
  return {
    state: { grabbed: null, candidate: state.candidate },
    effects: [
      {
        type: "announce",
        message: ctx.t.t("ui.mapper.cancelled", { source: labelOf(ctx.sources, state.grabbed) }),
      },
    ],
    handled: true,
  };
}

/**
 * One key on a source column (the keyboard alternative to dragging, WCAG 2.2 SC 2.5.7): Space or
 * Enter picks it up; the arrows (and Home, End) choose the field; Enter or Space drops it there;
 * Escape puts it back.
 */
export function mapperKey(
  state: MapperState,
  key: string,
  source: string,
  ctx: MapperContext,
): MapperKeyResult {
  const none: MapperKeyResult = { state, effects: [], handled: false };
  if (state.grabbed !== source) {
    if (key === " " || key === "Spacebar" || key === "Enter") return grabSource(state, source, ctx);
    return none;
  }
  const n = ctx.targets.length;
  if (!n) return key === "Escape" ? cancelGrab(state, ctx) : none;
  const over = (i: number): MapperKeyResult => ({
    state: { ...state, candidate: i },
    effects: [{ type: "announce", message: overMessage(ctx, i) }],
    handled: true,
  });
  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return over((state.candidate + 1) % n);
    case "ArrowUp":
    case "ArrowLeft":
      return over((state.candidate - 1 + n) % n);
    case "Home":
      return over(0);
    case "End":
      return over(n - 1);
    case "Enter":
    case " ":
    case "Spacebar":
      return dropSource(state, state.candidate, ctx);
    case "Escape":
      return cancelGrab(state, ctx);
    default:
      return none;
  }
}
