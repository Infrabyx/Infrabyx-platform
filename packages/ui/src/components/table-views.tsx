// Saved views and the column chooser (IPB-07-13, @IPB-07-AT-08; Finbyx PR-FBX-09). The store is
// `@infrabyx/config/views`; these are its controls. Both are plain forms and links, so they work
// without script: the chooser posts the visible columns in order (checkboxes and move buttons),
// and the picker lists the person's views and the shared ones as links that apply them.
import { messages, type Messages } from "../i18n/messages.js";
import type { Column } from "./data.js";

const en = messages("en-IN");

/**
 * The table's columns as the layout says: the first column (or the row header) stays first and
 * visible (IPB-07-13, first column pinned); unknown keys in the layout are ignored; no layout means
 * every column in the table's own order.
 */
export function applyColumns(
  columns: readonly Column[],
  visible?: readonly string[] | null,
): Column[] {
  if (!visible) return [...columns];
  const pinned = columns.find((c) => c.rowHeader) ?? columns[0];
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const rest = visible
    .filter((k) => k !== pinned?.key)
    .map((k) => byKey.get(k))
    .filter((c): c is Column => c !== undefined);
  return pinned ? [pinned, ...rest] : rest;
}

/** Move `key` one place up or down in `order` (the chooser's move buttons post `key:up`). */
export function moveColumn(order: readonly string[], move: string): string[] {
  const [key, dir] = move.split(":");
  const out = [...order];
  const i = out.indexOf(key ?? "");
  const j = dir === "up" ? i - 1 : dir === "down" ? i + 1 : -1;
  if (i < 0 || j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

export function ColumnChooser({
  action,
  columns,
  visible,
  density = "comfortable",
  csrfToken,
  t = en,
}: {
  action: string;
  /** Every column the table can show, in the current order. */
  columns: readonly Column[];
  /** The visible keys, in order (absent: all). */
  visible?: readonly string[] | null;
  density?: "compact" | "comfortable";
  csrfToken?: string;
  t?: Messages;
}) {
  const pinned = columns.find((c) => c.rowHeader) ?? columns[0];
  const shown = new Set(visible ?? columns.map((c) => c.key));
  const order = [
    ...applyColumns(columns, visible).map((c) => c.key),
    ...columns.filter((c) => !shown.has(c.key)).map((c) => c.key),
  ];
  const byKey = new Map(columns.map((c) => [c.key, c]));
  return (
    <details className="ibx-disclosure ibx-chooser">
      <summary>{t.t("ui.table.columns")}</summary>
      <form method="post" action={action}>
        {csrfToken ? <input type="hidden" name="csrf" value={csrfToken} /> : null}
        <fieldset className="ibx-chooser__set">
          <legend>{t.t("ui.table.columns_legend")}</legend>
          <ol className="ibx-chooser__list">
            {order.map((k, i) => {
              const c = byKey.get(k)!;
              const fixed = c.key === pinned?.key;
              return (
                <li className="ibx-chooser__item" key={k}>
                  <input type="hidden" name="order" value={k} />
                  <input
                    className="ibx-check__input"
                    type="checkbox"
                    id={`col-${k}`}
                    name="show"
                    value={k}
                    defaultChecked={fixed || shown.has(k)}
                    disabled={fixed}
                  />
                  <label htmlFor={`col-${k}`}>
                    {c.header}
                    {fixed ? (
                      <span className="ibx-field__req"> ({t.t("ui.table.pinned")})</span>
                    ) : null}
                  </label>
                  {!fixed && i > 1 ? (
                    <button
                      className="ibx-button ibx-button--ghost"
                      type="submit"
                      name="move"
                      value={`${k}:up`}
                    >
                      {t.t("ui.table.move_up", { column: c.header })}
                    </button>
                  ) : null}
                  {!fixed && i < order.length - 1 ? (
                    <button
                      className="ibx-button ibx-button--ghost"
                      type="submit"
                      name="move"
                      value={`${k}:down`}
                    >
                      {t.t("ui.table.move_down", { column: c.header })}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </fieldset>
        <fieldset className="ibx-chooser__set">
          <legend>{t.t("ui.table.density")}</legend>
          {(["comfortable", "compact"] as const).map((d) => (
            <div className="ibx-check" key={d}>
              <input
                className="ibx-check__input"
                type="radio"
                id={`density-${d}`}
                name="density"
                value={d}
                defaultChecked={density === d}
              />
              <label className="ibx-check__label" htmlFor={`density-${d}`}>
                {t.t(`ui.table.density_${d}`)}
              </label>
            </div>
          ))}
        </fieldset>
        <div className="ibx-state__actions">
          <button
            className="ibx-button ibx-button--primary"
            type="submit"
            name="intent"
            value="apply"
          >
            {t.t("ui.table.apply")}
          </button>
          <button className="ibx-button" type="submit" name="intent" value="reset">
            {t.t("ui.table.reset")}
          </button>
        </div>
      </form>
    </details>
  );
}

export interface ViewOption {
  id: string;
  name: string;
  /** The list route with this view applied. */
  href: string;
  isDefault?: boolean;
}

export function SavedViewPicker({
  personal,
  shared,
  currentId,
  saveAction,
  csrfToken,
  headingLevel = 2,
  t = en,
}: {
  personal: readonly ViewOption[];
  shared: readonly ViewOption[];
  currentId?: string;
  /** Where "Save as" posts the name (the list's current filters, sort and columns go with it). */
  saveAction?: string;
  csrfToken?: string;
  /** The level of "My views" and "Shared views" under the page's headings (default 2). */
  headingLevel?: 2 | 3 | 4;
  t?: Messages;
}) {
  const H = `h${headingLevel}` as const;
  const list = (views: readonly ViewOption[], id: string, heading: string) =>
    views.length ? (
      <section aria-labelledby={id}>
        <H className="ibx-views__heading" id={id}>
          {heading}
        </H>
        <ul className="ibx-views__list">
          {views.map((v) => (
            <li key={v.id}>
              <a href={v.href} aria-current={v.id === currentId ? "true" : undefined}>
                {v.name}
              </a>
              {v.isDefault ? (
                <span className="ibx-field__req"> ({t.t("ui.views.default")})</span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    ) : null;
  return (
    <details className="ibx-disclosure ibx-views">
      <summary>{t.t("ui.views.title")}</summary>
      {list(personal, "views-mine", t.t("ui.views.mine"))}
      {list(shared, "views-shared", t.t("ui.views.shared"))}
      {!personal.length && !shared.length ? <p>{t.t("ui.views.none")}</p> : null}
      {saveAction ? (
        <form method="post" action={saveAction} className="ibx-views__save">
          {csrfToken ? <input type="hidden" name="csrf" value={csrfToken} /> : null}
          <label className="ibx-field__label" htmlFor="view-name">
            {t.t("ui.views.save_label")}
          </label>
          <input className="ibx-field__input" id="view-name" name="name" maxLength={80} required />
          <button className="ibx-button" type="submit">
            {t.t("ui.views.save")}
          </button>
        </form>
      ) : null}
    </details>
  );
}
