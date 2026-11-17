"use client";
// An accessible data grid and a column mapper (PR-LDC-32; R1-D-159; WCAG 2.2 SC
// 2.1.1, 2.5.7, 4.1.2). The grid follows the WAI-ARIA grid pattern: one tab stop (roving
// tabindex), arrow, Home/End, Ctrl+Home/End and PageUp/PageDown navigation, Enter or F2 to edit,
// Enter to commit and Escape to cancel, Space to select a row. Only a window of rows is in the DOM;
// `aria-rowcount` and `aria-rowindex` give the full size. The mapper maps file columns to fields by
// drag and drop, and everything dragging does can be done with a select list per field or with the
// keyboard (pick up, arrows, drop). No inline styles: sizes are set through the CSSOM after render,
// so the CSP needs no `unsafe-inline`. The logic is in `data-grid-core.ts`.
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { messages, type Messages } from "../i18n/messages.js";
import {
  assignMapping,
  cancelGrab,
  checkCell,
  commitEdit,
  dropSource,
  formatCell,
  grabSource,
  gridKey,
  gridWindow,
  initialGridState,
  mapperKey,
  rowLabel,
  startEdit,
  type ColumnMapping,
  type GridColumn,
  type GridContext,
  type GridDraft,
  type GridEffect,
  type GridKeyResult,
  type GridRow,
  type GridSelection,
  type GridState,
  type GridValue,
  type MapperContext,
  type MapperKeyResult,
  type MapperState,
  type MapSource,
  type MapTarget,
} from "./data-grid-core.js";

/** Row heights by density (IPB-07-13); the grid measures the real height after render. */
const ROW_HEIGHT = { compact: 36, comfortable: 44 } as const;

export interface DataGridProps {
  id: string;
  /** The grid's name, shown above it. */
  label: string;
  columns: readonly GridColumn[];
  rows: readonly GridRow[];
  /** Row selection with Space (default none). */
  selection?: GridSelection;
  defaultSelected?: readonly string[];
  /** Called with valid values only; refused edits never reach it. */
  onCellChange?: (rowId: string, columnKey: string, value: GridValue) => void;
  onSelectionChange?: (ids: readonly string[]) => void;
  density?: "compact" | "comfortable";
  /** Data rows in view (default 10); PageUp and PageDown move this many. */
  viewportRows?: number;
  /** Rows rendered beyond the view on each side (default 5). */
  overscan?: number;
  /** The catalogue locale when `t` is not given (a server component can pass this, not `t`). */
  locale?: string;
  t?: Messages;
}

export interface DataGridViewProps extends DataGridProps {
  state: GridState;
  rowHeight?: number;
  /** The live region's text. */
  announcement?: { message: string; n: number };
  on?: {
    keyDown(e: KeyboardEvent<HTMLElement>): void;
    scroll(top: number): void;
    focusCell(row: number, col: number): void;
    edit(row: number, col: number): void;
    draft(value: GridDraft): void;
    editorBlur(): void;
  };
  refs?: {
    viewport: RefObject<HTMLDivElement | null>;
    body: RefObject<HTMLDivElement | null>;
    header: RefObject<HTMLDivElement | null>;
  };
}

const translator = (p: { t?: Messages | undefined; locale?: string | undefined }) =>
  p.t ?? messages(p.locale ?? "en-IN");

/**
 * The grid for a given state, without behaviour: what `DataGrid` renders, and what a server
 * renders before the script runs (the first window of rows, nothing editable).
 */
export function DataGridView(p: DataGridViewProps) {
  const t = translator(p);
  const { state, columns, rows } = p;
  const selection = p.selection ?? "none";
  const rowHeight = p.rowHeight ?? ROW_HEIGHT[p.density ?? "comfortable"];
  const viewportRows = p.viewportRows ?? 10;
  const win = gridWindow({
    rowCount: rows.length,
    scrollTop: state.scrollTop,
    rowHeight,
    viewportRows,
    overscan: p.overscan ?? 5,
  });
  const ctx: GridContext = { columns, rows, selection, pageSize: viewportRows, rowHeight, t };
  // The tab stop: the active cell when it is rendered, else the header cell of its column.
  const tabRow = state.row >= win.start && state.row < win.end ? state.row : -1;
  const ids = { label: `${p.id}-label`, hint: `${p.id}-hint`, error: `${p.id}-error` };
  const error = state.editing?.error;
  // While a cell is edited its editor is the tab stop and the cell itself is not focusable (so the
  // editor is the cell's only target, SC 2.5.8).
  const editingCell = (r: number, c: number) =>
    state.editing !== null && r === state.row && c === state.col;
  const cell = (r: number, c: number) => ({
    "data-cell": `${r}:${c}`,
    tabIndex: editingCell(r, c) ? undefined : r === tabRow && c === state.col ? 0 : -1,
    "aria-colindex": c + 1,
    onFocus: p.on ? () => p.on!.focusCell(r, c) : undefined,
  });
  return (
    <div className={`ibx-grid ibx-grid--${p.density ?? "comfortable"}`} id={p.id}>
      <p className="ibx-grid__caption" id={ids.label}>
        {p.label}
      </p>
      <p className="ibx-field__hint" id={ids.hint}>
        {t.t("ui.grid.hint")}
        {selection !== "none" ? ` ${t.t("ui.grid.hint_select")}` : ""}
      </p>
      <div
        className="ibx-grid__viewport"
        role="grid"
        aria-labelledby={ids.label}
        aria-describedby={ids.hint}
        aria-rowcount={rows.length + 1}
        aria-colcount={columns.length}
        aria-multiselectable={selection === "multiple" ? true : undefined}
        ref={p.refs?.viewport}
        onKeyDown={p.on?.keyDown}
        onScroll={p.on ? (e) => p.on!.scroll(e.currentTarget.scrollTop) : undefined}
      >
        <div className="ibx-grid__head" role="rowgroup" ref={p.refs?.header}>
          <div className="ibx-grid__row" role="row" aria-rowindex={1}>
            {columns.map((c, ci) => (
              <div
                key={c.key}
                className={`ibx-grid__cell ibx-grid__colhead${c.type === "number" ? " ibx-num" : ""}`}
                role="columnheader"
                {...cell(-1, ci)}
              >
                {c.header}
                {c.required ? (
                  <span className="ibx-field__req"> ({t.t("ui.field.required")})</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
        <div className="ibx-grid__body" role="rowgroup" ref={p.refs?.body}>
          {rows.slice(win.start, win.end).map((row, k) => {
            const r = win.start + k;
            const selected = state.selected.includes(row.id);
            return (
              <div
                key={row.id}
                className={`ibx-grid__row${selected ? " ibx-grid__row--selected" : ""}`}
                role="row"
                aria-rowindex={r + 2}
                aria-selected={selection === "none" ? undefined : selected}
              >
                {columns.map((c, ci) => {
                  const editing = editingCell(r, ci);
                  const value = row[c.key] ?? null;
                  const cls = `ibx-grid__cell${c.type === "number" ? " ibx-num" : ""}${
                    c.readOnly ? " ibx-grid__cell--readonly" : ""
                  }${editing ? " ibx-grid__cell--editing" : ""}`;
                  const content = editing ? (
                    <CellEditor
                      column={c}
                      draft={state.editing!.draft}
                      label={t.t("ui.grid.edit_label", {
                        column: c.header,
                        row: rowLabel(ctx, r),
                      })}
                      errorId={error ? ids.error : undefined}
                      t={t}
                      onDraft={p.on?.draft}
                      onBlur={p.on?.editorBlur}
                    />
                  ) : (
                    formatCell(c, value, t)
                  );
                  const props = {
                    className: cls,
                    "aria-readonly": c.readOnly ? true : undefined,
                    onDoubleClick: p.on ? () => p.on!.edit(r, ci) : undefined,
                    ...cell(r, ci),
                  };
                  return c.rowHeader ? (
                    <div key={c.key} role="rowheader" {...props}>
                      {content}
                    </div>
                  ) : (
                    <div key={c.key} role="gridcell" {...props}>
                      {content}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {error ? (
        <p className="ibx-field__error" id={ids.error}>
          {error}
        </p>
      ) : null}
      <div className="ibx-visually-hidden" role="status" aria-live="polite">
        {p.announcement ? <span key={p.announcement.n}>{p.announcement.message}</span> : null}
      </div>
    </div>
  );
}

function CellEditor(p: {
  column: GridColumn;
  draft: GridDraft;
  label: string;
  errorId: string | undefined;
  t: Messages;
  onDraft: ((v: GridDraft) => void) | undefined;
  onBlur: (() => void) | undefined;
}) {
  const common = {
    className: "ibx-grid__editor",
    "aria-label": p.label,
    "aria-invalid": p.errorId ? true : undefined,
    "aria-describedby": p.errorId,
    "data-grid-editor": "",
    onBlur: p.onBlur,
  };
  const c = p.column;
  const text = typeof p.draft === "string" ? p.draft : "";
  const onText = (e: { currentTarget: { value: string } }) => p.onDraft?.(e.currentTarget.value);
  if (c.type === "boolean")
    return (
      <input
        type="checkbox"
        checked={p.draft === true}
        onChange={(e) => p.onDraft?.(e.currentTarget.checked)}
        {...common}
      />
    );
  if (c.type === "enum")
    return (
      <select value={text} onChange={onText} {...common}>
        {!c.required || text === "" ? <option value="">{p.t.t("ui.grid.no_value")}</option> : null}
        {c.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  return (
    <input
      type={c.type === "date" ? "date" : "text"}
      inputMode={c.type === "number" ? "decimal" : undefined}
      value={text}
      onChange={onText}
      {...common}
    />
  );
}

/**
 * The accessible data grid. `rows` is the data; an accepted edit calls `onCellChange` and shows
 * until the next `rows` arrives (so a parent that ignores edits still shows them, and a parent
 * that refuses one corrects it by passing `rows` again).
 */
export function DataGrid(props: DataGridProps) {
  const t = translator(props);
  const { columns, rows } = props;
  const selection = props.selection ?? "none";
  const viewportRows = props.viewportRows ?? 10;
  const [base, setBase] = useState(rows);
  const [edits, setEdits] = useState<Readonly<Record<string, Record<string, GridValue>>>>({});
  if (base !== rows) {
    setBase(rows);
    setEdits({});
  }
  const shown = useMemo(
    () =>
      Object.keys(edits).length
        ? rows.map((r) => (edits[r.id] ? ({ ...r, ...edits[r.id] } as GridRow) : r))
        : rows,
    [rows, edits],
  );
  const [state, setState] = useState<GridState>(() =>
    initialGridState(props.defaultSelected ?? []),
  );
  const stateRef = useRef(state);
  const [rowHeight, setRowHeight] = useState<number>(ROW_HEIGHT[props.density ?? "comfortable"]);
  const [announcement, setAnnouncement] = useState<{ message: string; n: number }>();
  const wantFocus = useRef(false);
  const refs = {
    viewport: useRef<HTMLDivElement>(null),
    body: useRef<HTMLDivElement>(null),
    header: useRef<HTMLDivElement>(null),
  };
  const ctx: GridContext = {
    columns,
    rows: shown,
    selection,
    pageSize: viewportRows,
    rowHeight,
    t,
  };

  const update = (next: GridState) => {
    stateRef.current = next;
    setState(next);
  };
  const apply = (r: GridKeyResult) => {
    update(r.state);
    for (const e of r.effects as GridEffect[]) {
      if (e.type === "change") {
        setEdits((m) => ({ ...m, [e.rowId]: { ...m[e.rowId], [e.columnKey]: e.value } }));
        props.onCellChange?.(e.rowId, e.columnKey, e.value);
      } else if (e.type === "select") props.onSelectionChange?.(e.ids);
      else setAnnouncement((a) => ({ message: e.message, n: (a?.n ?? 0) + 1 }));
    }
  };

  // Sizes through the CSSOM (no inline style attributes): the window's padding, the viewport's
  // height, and the real row height once a row is laid out (text zoom changes it).
  const win = gridWindow({
    rowCount: shown.length,
    scrollTop: state.scrollTop,
    rowHeight,
    viewportRows,
    overscan: props.overscan ?? 5,
  });
  useLayoutEffect(() => {
    const body = refs.body.current;
    const viewport = refs.viewport.current;
    if (!body || !viewport) return;
    const measured = (body.querySelector('[role="row"]') as HTMLElement | null)?.offsetHeight;
    if (measured && Math.abs(measured - rowHeight) > 0.5) {
      setRowHeight(measured);
      return;
    }
    body.style.paddingTop = `${win.padTop}px`;
    body.style.paddingBottom = `${win.padBottom}px`;
    const head = refs.header.current?.offsetHeight ?? rowHeight;
    viewport.style.maxHeight = `${head + viewportRows * rowHeight + 4}px`;
    if (Math.abs(viewport.scrollTop - state.scrollTop) > 1) viewport.scrollTop = state.scrollTop;
    if (wantFocus.current) {
      wantFocus.current = false;
      const target = state.editing
        ? viewport.querySelector<HTMLElement>("[data-grid-editor]")
        : viewport.querySelector<HTMLElement>(`[data-cell="${state.row}:${state.col}"]`);
      target?.focus();
    }
  });

  const on: NonNullable<DataGridViewProps["on"]> = {
    keyDown(e) {
      const r = gridKey(
        stateRef.current,
        e.key,
        { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey },
        ctx,
      );
      if (!r.handled) return;
      e.preventDefault();
      wantFocus.current = true;
      apply(r);
    },
    scroll(top) {
      if (Math.abs(top - stateRef.current.scrollTop) > 1)
        update({ ...stateRef.current, scrollTop: top });
    },
    focusCell(row, col) {
      const s = stateRef.current;
      if (s.editing || (s.row === row && s.col === col)) return;
      update({ ...s, row, col });
    },
    edit(row, col) {
      const s = stateRef.current;
      if (s.editing) return;
      wantFocus.current = true;
      apply(startEdit({ ...s, row, col }, ctx));
    },
    draft(value) {
      const s = stateRef.current;
      if (s.editing) update({ ...s, editing: { draft: value } });
    },
    editorBlur() {
      // Focus left the editor (Tab or a click elsewhere): keep a valid value, drop a refused one
      // and say why, so focus is never held in the cell (SC 2.1.2).
      const s = stateRef.current;
      if (!s.editing) return;
      const r = commitEdit(s, ctx);
      if (!r.state.editing) return apply(r);
      const column = columns[s.col];
      const row = shown[s.row];
      const checked = column && row ? checkCell(column, s.editing.draft, row, t) : null;
      apply({
        state: { ...s, editing: null },
        effects: [
          {
            type: "announce",
            message: t.t("ui.grid.not_saved", {
              error: checked && !checked.ok ? checked.error : "",
            }),
          },
        ],
        handled: true,
      });
    },
  };

  return (
    <DataGridView
      {...props}
      rows={shown}
      state={state}
      rowHeight={rowHeight}
      {...(announcement ? { announcement } : {})}
      on={on}
      refs={refs}
    />
  );
}

// ---- The column mapper ---------------------------------------------------------------------------

export interface ColumnMapperProps {
  id: string;
  /** What is being mapped, shown above the lists. */
  label: string;
  /** The columns found in the file. */
  sources: readonly MapSource[];
  /** The fields they can fill. */
  targets: readonly MapTarget[];
  defaultMapping?: ColumnMapping;
  onMappingChange?: (mapping: ColumnMapping) => void;
  /** With a name, each field's select posts as `<name>.<field key>` (works without script). */
  name?: string;
  locale?: string;
  t?: Messages;
}

/**
 * Map file columns to fields (imports). Drag a column onto a field; or choose the column in the
 * field's select list; or, with the keyboard, press Space on a column to pick it up, the arrows to
 * choose the field, Enter to drop and Escape to cancel; or click a column and then the field's
 * "Map here" button. Each way gives the same mapping, and each change is announced politely.
 */
export function ColumnMapper(props: ColumnMapperProps) {
  const t = translator(props);
  const { id, sources, targets } = props;
  const [mapping, setMapping] = useState<ColumnMapping>(() =>
    Object.fromEntries(targets.map((x) => [x.key, props.defaultMapping?.[x.key] ?? null])),
  );
  const [state, setState] = useState<MapperState>({ grabbed: null, candidate: 0 });
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState<{ message: string; n: number }>();
  const ctx: MapperContext = { sources, targets, mapping, t };
  const apply = (r: MapperKeyResult) => {
    setState(r.state);
    for (const e of r.effects) {
      if (e.type === "mapping") {
        setMapping(e.mapping);
        props.onMappingChange?.(e.mapping);
      } else setAnnouncement((a) => ({ message: e.message, n: (a?.n ?? 0) + 1 }));
    }
  };
  const choose = (target: string, source: string | null) => {
    const next = assignMapping(mapping, target, source);
    setMapping(next);
    props.onMappingChange?.(next);
    const tl = targets.find((x) => x.key === target)?.label ?? target;
    const sl = sources.find((x) => x.key === source)?.label;
    setAnnouncement((a) => ({
      message: sl
        ? t.t("ui.mapper.mapped", { source: sl, target: tl })
        : t.t("ui.mapper.unmapped", { target: tl }),
      n: (a?.n ?? 0) + 1,
    }));
  };
  const ids = {
    label: `${id}-label`,
    hint: `${id}-hint`,
    sources: `${id}-sources`,
    targets: `${id}-targets`,
  };
  const grabbedLabel = sources.find((s) => s.key === state.grabbed)?.label ?? "";

  return (
    <div className="ibx-mapper" role="group" aria-labelledby={ids.label} id={id}>
      <p className="ibx-grid__caption" id={ids.label}>
        {props.label}
      </p>
      <p className="ibx-field__hint" id={ids.hint}>
        {t.t("ui.mapper.hint")}
      </p>
      <div className="ibx-mapper__cols">
        <div className="ibx-mapper__col">
          <p className="ibx-mapper__heading" id={ids.sources}>
            {t.t("ui.mapper.sources")}
          </p>
          <ul className="ibx-mapper__list" aria-labelledby={ids.sources}>
            {sources.map((s) => {
              const on = targets.find((x) => mapping[x.key] === s.key);
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    className={`ibx-button ibx-mapper__source${
                      dragging === s.key ? " ibx-mapper__source--dragging" : ""
                    }`}
                    draggable
                    aria-pressed={state.grabbed === s.key}
                    aria-describedby={ids.hint}
                    data-source={s.key}
                    onKeyDown={(e) => {
                      const r = mapperKey(state, e.key, s.key, ctx);
                      if (!r.handled) return;
                      e.preventDefault();
                      apply(r);
                    }}
                    onClick={(e) => {
                      if (e.detail === 0) return; // a keyboard click: handled on keydown
                      apply(
                        state.grabbed === s.key
                          ? cancelGrab(state, ctx)
                          : grabSource(state, s.key, ctx),
                      );
                    }}
                    onDragStart={(e: DragEvent<HTMLButtonElement>) => {
                      e.dataTransfer.setData("text/plain", s.key);
                      e.dataTransfer.effectAllowed = "move";
                      setDragging(s.key);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                  >
                    <span className="ibx-mapper__name">{s.label}</span>
                    {s.sample ? <span className="ibx-mapper__sample">{s.sample}</span> : null}
                    <span className="ibx-mapper__status">
                      {on
                        ? t.t("ui.mapper.mapped_to", { target: on.label })
                        : t.t("ui.mapper.not_mapped")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="ibx-mapper__col">
          <p className="ibx-mapper__heading" id={ids.targets}>
            {t.t("ui.mapper.targets")}
          </p>
          <ul className="ibx-mapper__list" aria-labelledby={ids.targets}>
            {targets.map((x, i) => {
              const selectId = `${id}-field-${x.key}`;
              const cls = `ibx-mapper__target${
                state.grabbed && state.candidate === i ? " ibx-mapper__target--candidate" : ""
              }${over === i ? " ibx-mapper__target--over" : ""}`;
              return (
                <li
                  key={x.key}
                  className={cls}
                  data-target={x.key}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (over !== i) setOver(i);
                  }}
                  onDragLeave={() => setOver((o) => (o === i ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault();
                    const key = e.dataTransfer.getData("text/plain");
                    setDragging(null);
                    setOver(null);
                    if (sources.some((s) => s.key === key)) {
                      setState({ grabbed: null, candidate: i });
                      choose(x.key, key);
                    }
                  }}
                >
                  <label className="ibx-field__label" htmlFor={selectId}>
                    {x.label}
                    <span className="ibx-field__req">
                      {" "}
                      ({x.required ? t.t("ui.field.required") : t.t("ui.field.optional")})
                    </span>
                  </label>
                  <select
                    className="ibx-field__input"
                    id={selectId}
                    name={props.name ? `${props.name}.${x.key}` : undefined}
                    required={x.required}
                    value={mapping[x.key] ?? ""}
                    onChange={(e) => choose(x.key, e.currentTarget.value || null)}
                  >
                    <option value="">{t.t("ui.mapper.not_mapped")}</option>
                    {sources.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  {state.grabbed ? (
                    <button
                      type="button"
                      className="ibx-button ibx-button--ghost"
                      onClick={() => apply(dropSource(state, i, ctx))}
                    >
                      {t.t("ui.mapper.drop_here", { source: grabbedLabel, target: x.label })}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <MapperLive announcement={announcement} />
    </div>
  );
}

function MapperLive({
  announcement,
}: {
  announcement?: { message: string; n: number } | undefined;
}) {
  let child: ReactNode = null;
  if (announcement) child = <span key={announcement.n}>{announcement.message}</span>;
  return (
    <div className="ibx-visually-hidden" role="status" aria-live="polite">
      {child}
    </div>
  );
}
