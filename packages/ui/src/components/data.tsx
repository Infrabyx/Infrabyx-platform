// Tables and charts (IPB-06-24, 06-25, SC 1.3.1, 1.4.1, 1.4.10; IPB-13-17). A table has a caption,
// column headers with scope, an optional row header and `aria-sort`; it reflows at 320 px through a
// labelled scroll region. A chart is an SVG image with a text summary and a "View as table" toggle
// (a native disclosure, no script), with direct labels so colour is never the only carrier.
import { messages, type Messages } from "../i18n/messages.js";

const en = messages("en-IN");

export interface Column {
  key: string;
  header: string;
  /** The column that names each row (`<th scope="row">`). */
  rowHeader?: boolean;
  sort?: "ascending" | "descending";
  numeric?: boolean;
}

export function DataTable({
  caption,
  columns,
  rows,
  id,
}: {
  caption: string;
  columns: readonly Column[];
  rows: readonly Readonly<Record<string, string | number>>[];
  id?: string;
}) {
  return (
    <div className="ibx-table-wrap" role="region" aria-label={caption} tabIndex={0} id={id}>
      <table className="ibx-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                aria-sort={c.sort}
                className={c.numeric ? "ibx-num" : undefined}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) =>
                c.rowHeader ? (
                  <th key={c.key} scope="row">
                    {r[c.key]}
                  </th>
                ) : (
                  <td key={c.key} className={c.numeric ? "ibx-num" : undefined}>
                    {r[c.key]}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A horizontal bar chart with direct labels, a summary and the data table (IPB-06 §06.4.7). */
export function BarChart({
  id,
  title,
  summary,
  data,
  unit = "",
  t = en,
}: {
  id: string;
  title: string;
  summary: string;
  data: readonly { label: string; value: number }[];
  unit?: string;
  t?: Messages;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const rowH = 28;
  const width = 480;
  const labelW = 160;
  return (
    <figure className="ibx-chart">
      <figcaption className="ibx-chart__title">{title}</figcaption>
      <svg
        role="img"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-summary`}
        viewBox={`0 0 ${width} ${data.length * rowH + 8}`}
        className="ibx-chart__svg"
      >
        <title id={`${id}-title`}>{title}</title>
        {data.map((d, i) => {
          const w = Math.round(((width - labelW - 60) * d.value) / max);
          const y = i * rowH + 4;
          return (
            <g key={d.label}>
              <text x={0} y={y + 18} className="ibx-chart__label">
                {d.label}
              </text>
              <rect x={labelW} y={y + 4} width={w} height={rowH - 10} className="ibx-chart__bar" />
              <text x={labelW + w + 6} y={y + 18} className="ibx-chart__value">
                {d.value}
                {unit}
              </text>
            </g>
          );
        })}
      </svg>
      <p id={`${id}-summary`} className="ibx-chart__summary">
        {summary}
      </p>
      <details className="ibx-chart__table">
        <summary>{t.t("ui.chart.view_table")}</summary>
        <DataTable
          caption={title}
          columns={[
            { key: "label", header: "Item", rowHeader: true },
            { key: "value", header: unit ? `Value (${unit})` : "Value", numeric: true },
          ]}
          rows={data.map((d) => ({ label: d.label, value: d.value }))}
        />
      </details>
    </figure>
  );
}
