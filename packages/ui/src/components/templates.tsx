// Page templates (Finbyx PR-FBX-09; IPB-07-11 to -15, IPB-07-24): list, detail, wizard, approval
// queue and dashboard frames, each with one `h1`, at most one primary action (IPB-UX-002) and its
// `PageState`. A denied page shows no title actions; an empty list keeps its title and action. The
// product supplies the content, copy and data; the frames supply structure, landmarks and states.
import type { ReactNode } from "react";
import { IpbError } from "@infrabyx/contracts/errors";
import { messages, type Messages } from "../i18n/messages.js";
import { AiLabel } from "./status.js";
import { StateView, type LinkAction, type PageState } from "./states.js";

const en = messages("en-IN");
const READY: PageState = { kind: "ready" };

interface FrameProps {
  title: string;
  description?: string;
  /** The page's one primary action. */
  primaryAction?: LinkAction;
  /** Secondary actions (links or forms). */
  actions?: ReactNode;
  state?: PageState;
  t?: Messages;
}

function Frame({
  title,
  description,
  primaryAction,
  actions,
  state = READY,
  t = en,
  children,
  className,
  lead,
}: FrameProps & { children?: ReactNode; className: string; lead?: ReactNode }) {
  const denied = state.kind === "denied";
  return (
    <div className={`ibx-page ${className}`}>
      <div className="ibx-page__head">
        <h1>{title}</h1>
        {description ? <p className="ibx-page__description">{description}</p> : null}
        {!denied && (primaryAction || actions) ? (
          <div className="ibx-page__actions">
            {primaryAction ? (
              <a className="ibx-button ibx-button--primary" href={primaryAction.href}>
                {primaryAction.label}
              </a>
            ) : null}
            {actions}
          </div>
        ) : null}
      </div>
      {denied ? null : lead}
      <StateView state={state} t={t}>
        {children}
      </StateView>
    </div>
  );
}

/**
 * A list: filters, saved views and the column chooser in `toolbar` (kept while loading or empty,
 * so filters can be cleared), then the table.
 */
export function ListPage(p: FrameProps & { toolbar?: ReactNode; children?: ReactNode }) {
  const { toolbar, children, ...frame } = p;
  const lead = toolbar ? (
    <section
      className="ibx-page__toolbar"
      id="filters"
      aria-label={(p.t ?? en).t("ui.page.filters")}
    >
      {toolbar}
    </section>
  ) : null;
  return (
    <Frame {...frame} className="ibx-page--list" lead={lead}>
      <div id="table">{children}</div>
    </Frame>
  );
}

/** A record: its key facts as a description list, then its sections. */
export function DetailPage(
  p: FrameProps & {
    facts?: readonly { label: string; value: ReactNode }[];
    children?: ReactNode;
  },
) {
  const { facts, children, ...frame } = p;
  return (
    <Frame {...frame} className="ibx-page--detail">
      {facts?.length ? (
        <dl className="ibx-facts">
          {facts.map((f) => (
            <div className="ibx-facts__row" key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {children}
    </Frame>
  );
}

/** A wizard: the steps with the current one marked, then the current step's form. */
export function WizardPage(
  p: FrameProps & { steps: readonly string[]; current: number; children?: ReactNode },
) {
  const { steps, current, children, ...frame } = p;
  const t = p.t ?? en;
  if (current < 0 || current >= steps.length) throw new RangeError("current step out of range");
  return (
    <Frame {...frame} className="ibx-page--wizard">
      <nav aria-label={t.t("ui.page.steps")}>
        <ol className="ibx-steps">
          {steps.map((s, i) => (
            <li
              key={s}
              className={i < current ? "ibx-steps__done" : undefined}
              aria-current={i === current ? "step" : undefined}
            >
              {s}
            </li>
          ))}
        </ol>
      </nav>
      <h2>
        {t.t("ui.page.step_of", { n: current + 1, total: steps.length, step: steps[current]! })}
      </h2>
      {children}
    </Frame>
  );
}

export interface ApprovalItem {
  id: string;
  summary: string;
  /** Who asked (never the viewer: the inbox hides a maker's own items, IPB-07-15). */
  maker: string;
  submitted: string;
  /** The review screen with the diff. */
  href: string;
  due?: string;
}

/** An approval queue: what awaits the viewer, each linking to its review with the diff. */
export function ApprovalQueuePage(p: FrameProps & { items: readonly ApprovalItem[] }) {
  const { items, ...frame } = p;
  const t = p.t ?? en;
  return (
    <Frame {...frame} className="ibx-page--approvals">
      <div className="ibx-table-wrap" role="region" aria-label={p.title} tabIndex={0} id="table">
        <table className="ibx-table">
          <caption className="ibx-visually-hidden">{p.title}</caption>
          <thead>
            <tr>
              <th scope="col">{t.t("ui.approvals.request")}</th>
              <th scope="col">{t.t("ui.approvals.maker")}</th>
              <th scope="col">{t.t("ui.approvals.submitted")}</th>
              <th scope="col">{t.t("ui.approvals.due")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <th scope="row">
                  <a href={i.href}>{i.summary}</a>
                </th>
                <td>{i.maker}</td>
                <td>{i.submitted}</td>
                <td>{i.due ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Frame>
  );
}

export type EvidenceClass = "LEDGER" | "COMPUTED" | "EXTERNAL" | "AI";

export interface DashboardWidget {
  id: string;
  title: string;
  body: ReactNode;
  /** Every figure carries its evidence class and a drill-through (IPB-07-24, IPB-UX-009). */
  evidence: { class: EvidenceClass; href: string };
  state?: PageState;
}

/** A dashboard: widgets in a grid, each with its evidence badge and its own state. */
export function DashboardPage(p: FrameProps & { widgets: readonly DashboardWidget[] }) {
  const { widgets, ...frame } = p;
  const t = p.t ?? en;
  for (const w of widgets)
    if (!w.evidence?.class || !w.evidence.href)
      throw new IpbError("IPB-UX-009", { detail: `widget ${w.id} has no evidence class` });
  return (
    <Frame {...frame} className="ibx-page--dashboard">
      <div className="ibx-widgets">
        {widgets.map((w) => (
          <section className="ibx-widget" key={w.id} aria-labelledby={`w-${w.id}`}>
            <h2 className="ibx-widget__title" id={`w-${w.id}`}>
              {w.title}
            </h2>
            <StateView state={w.state ?? READY} t={t}>
              {w.body}
            </StateView>
            <p className="ibx-widget__evidence">
              {w.evidence.class === "AI" ? <AiLabel t={t} /> : null}{" "}
              <a href={w.evidence.href}>
                {t.t("ui.evidence.source", {
                  class: t.t(`ui.evidence.${w.evidence.class.toLowerCase()}`),
                })}
              </a>
            </p>
          </section>
        ))}
      </div>
    </Frame>
  );
}
