// The workspace switcher (Finbyx PR-FBX-09; IPB-07-05). Which workspaces exist, and who is
// assigned to which, are the product's; this is the control and the rule that a remembered choice
// counts only while it is still assigned. A native disclosure of links: no script, and each link
// is a route of the product's that records the choice (a preference, not a credential).
import { messages, type Messages } from "../i18n/messages.js";

const en = messages("en-IN");

export interface Workspace {
  key: string;
  label: string;
  /** The product route that switches to it. */
  href: string;
}

/** The workspace in use: the remembered one while still assigned, else the first, else none. */
export function resolveWorkspace<W extends { key: string }>(
  assigned: readonly W[],
  remembered?: string | null,
): W | null {
  return assigned.find((w) => w.key === remembered) ?? assigned[0] ?? null;
}

export function WorkspaceSwitcher({
  assigned,
  current,
  homeHref = "/",
  t = en,
}: {
  assigned: readonly Workspace[];
  current: Workspace | null;
  homeHref?: string;
  t?: Messages;
}) {
  if (!current)
    return (
      <p className="ibx-workspace ibx-workspace--none">
        {t.t("ui.workspace.none")} <a href={homeHref}>{t.t("ui.workspace.home")}</a>
      </p>
    );
  if (assigned.length < 2)
    return (
      <p className="ibx-workspace">
        <span className="ibx-visually-hidden">{t.t("ui.workspace.label")}: </span>
        {current.label}
      </p>
    );
  return (
    <details className="ibx-workspace ibx-disclosure">
      <summary className="ibx-workspace__summary">
        <span className="ibx-visually-hidden">{t.t("ui.workspace.label")}: </span>
        {current.label}
      </summary>
      <nav aria-label={t.t("ui.workspace.label")}>
        <ul className="ibx-workspace__list">
          {assigned.map((w) => (
            <li key={w.key}>
              <a href={w.href} aria-current={w.key === current.key ? "true" : undefined}>
                {w.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </details>
  );
}
