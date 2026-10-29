// Page states (IPB-07-11, IPB-07-12, IPB-07-26; Finbyx PR-FBX-09). Empty states teach: what the
// area is for, the first action, a tutorial, sample data where a demo tenant has it; filtered-empty
// offers to clear the filters. Loading is a skeleton sized like the content, never a full-page
// spinner. An error says what failed, whether anything was saved, the reference and how to retry.
// Permission-denied gives the code, the reason and the screen that fixes it.
import type { ReactNode } from "react";
import { messages, type Messages } from "../i18n/messages.js";

const en = messages("en-IN");

export interface LinkAction {
  label: string;
  href: string;
}

export interface EmptyStateProps {
  /** One sentence on what the area is for (from the `hlp.` entry). */
  purpose: string;
  /** The primary action that creates the first item. */
  action?: LinkAction;
  tutorial?: LinkAction;
  /** "Show sample data", where a demo tenant has it. */
  sampleData?: LinkAction;
  /** Set when filters hid every row: the link that clears them. */
  clearFiltersHref?: string;
  helpKey?: string;
  t?: Messages;
}

export function EmptyState(p: EmptyStateProps) {
  const t = p.t ?? en;
  if (p.clearFiltersHref)
    return (
      <div className="ibx-state ibx-state--empty" role="status">
        <p className="ibx-state__title">{t.t("ui.state.filtered_empty")}</p>
        <p>
          <a href={p.clearFiltersHref}>{t.t("ui.state.clear_filters")}</a>
        </p>
      </div>
    );
  return (
    <div className="ibx-state ibx-state--empty" data-help-key={p.helpKey}>
      <p className="ibx-state__title">{t.t("ui.state.empty")}</p>
      <p>{p.purpose}</p>
      <div className="ibx-state__actions">
        {p.action ? (
          <a className="ibx-button ibx-button--primary" href={p.action.href}>
            {p.action.label}
          </a>
        ) : null}
        {p.tutorial ? <a href={p.tutorial.href}>{p.tutorial.label}</a> : null}
        {p.sampleData ? <a href={p.sampleData.href}>{p.sampleData.label}</a> : null}
      </div>
    </div>
  );
}

/** A layout skeleton: `rows` lines of a table, text or cards (IPB-07-12). */
export function Skeleton({
  shape = "table",
  rows = 5,
  t = en,
}: {
  shape?: "table" | "text" | "cards";
  rows?: number;
  t?: Messages;
}) {
  return (
    <div className={`ibx-skeleton ibx-skeleton--${shape}`} role="status" aria-busy="true">
      <span className="ibx-visually-hidden">{t.t("ui.state.loading")}</span>
      {Array.from({ length: Math.max(1, Math.min(rows, 20)) }, (_, i) => (
        <span className="ibx-skeleton__line" aria-hidden="true" key={i} />
      ))}
    </div>
  );
}

export interface ErrorStateProps {
  /** What failed, in the person's terms ("The loan list could not be loaded"). */
  whatFailed: string;
  /** Whether the person's change was kept. */
  saved: "saved" | "not_saved" | "unknown" | "nothing_to_save";
  correlationId: string;
  /** A link or a form that tries again. */
  retry?: LinkAction | ReactNode;
  code?: string;
  t?: Messages;
}

const SAVED_KEY: Record<ErrorStateProps["saved"], string | null> = {
  saved: "ui.state.error_saved",
  not_saved: "ui.state.error_not_saved",
  unknown: "ui.state.error_unknown",
  nothing_to_save: null,
};

export function ErrorState(p: ErrorStateProps) {
  const t = p.t ?? en;
  const savedKey = SAVED_KEY[p.saved];
  const retry =
    p.retry && typeof p.retry === "object" && "href" in p.retry && "label" in p.retry ? (
      <a className="ibx-button" href={(p.retry as LinkAction).href}>
        {(p.retry as LinkAction).label}
      </a>
    ) : (
      (p.retry as ReactNode)
    );
  return (
    <div className="ibx-state ibx-state--error" role="alert">
      <p className="ibx-state__title">{p.whatFailed}</p>
      {savedKey ? <p>{t.t(savedKey)}</p> : null}
      <p className="ibx-state__ref">
        {t.t("ui.errors.reference", {
          code: p.code ? `${p.code} · ${p.correlationId}` : p.correlationId,
        })}
      </p>
      {retry ? <div className="ibx-state__actions">{retry}</div> : null}
    </div>
  );
}

export function PermissionDenied({
  code,
  reason,
  fix,
  t = en,
}: {
  /** The catalogue code, e.g. IPB-SEC-005. */
  code: string;
  reason: string;
  /** The screen that grants access ("Ask an administrator in Organisation › People"). */
  fix?: LinkAction;
  t?: Messages;
}) {
  return (
    <div className="ibx-state ibx-state--denied" role="alert">
      <p className="ibx-state__title">{t.t("ui.state.denied")}</p>
      <p>{reason}</p>
      {fix ? (
        <p>
          <a href={fix.href}>{fix.label}</a>
        </p>
      ) : null}
      <p className="ibx-state__ref">{t.t("ui.errors.reference", { code })}</p>
    </div>
  );
}

/** What a page shows instead of its content, if anything. */
export type PageState =
  | { kind: "ready" }
  | ({ kind: "empty" } & Omit<EmptyStateProps, "t">)
  | { kind: "loading"; shape?: "table" | "text" | "cards"; rows?: number }
  | ({ kind: "error" } & Omit<ErrorStateProps, "t">)
  | { kind: "denied"; code: string; reason: string; fix?: LinkAction };

/** The state's view, or the children when ready. */
export function StateView({
  state,
  children,
  t = en,
}: {
  state: PageState;
  children?: ReactNode;
  t?: Messages;
}) {
  switch (state.kind) {
    case "ready":
      return <>{children}</>;
    case "empty": {
      const { kind: _k, ...p } = state;
      return <EmptyState {...p} t={t} />;
    }
    case "loading": {
      const { kind: _k, ...p } = state;
      return <Skeleton {...p} t={t} />;
    }
    case "error": {
      const { kind: _k, ...p } = state;
      return <ErrorState {...p} t={t} />;
    }
    case "denied": {
      const { kind: _k, ...p } = state;
      return <PermissionDenied {...p} t={t} />;
    }
  }
}
