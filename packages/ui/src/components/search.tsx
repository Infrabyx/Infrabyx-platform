// The command palette and global search page (IPB-07-17, IPB-07-19; Finbyx PR-FBX-09). Server-
// rendered: the query goes as a form POST (never in a URL, so never in history or access logs).
// A refused query is not written back into the field or the page; the refusal shows its code and
// "Search by name or reference instead". The product opens it with Ctrl+K through its
// `ShortcutRegistry`, focusing `#palette-query`. Results are grouped, each a heading and a list.
import { messages, type Messages } from "../i18n/messages.js";
import type { SearchHit, SearchResult } from "../search/index.js";

const en = messages("en-IN");

export function CommandPalette({
  action,
  result,
  query,
  recent = [],
  csrfToken,
  t = en,
}: {
  /** The route the form posts to. */
  action: string;
  /** The last search's result, if any. */
  result?: SearchResult;
  /** The query to show again, only when it was searched (never a refused one). */
  query?: string;
  /** Recently opened items (records and pages, not queries). */
  recent?: readonly SearchHit[];
  csrfToken?: string;
  t?: Messages;
}) {
  const refused = result?.status === "refused" ? result : undefined;
  const shown = result?.status === "ok" ? (query ?? "") : "";
  return (
    <div className="ibx-palette">
      <form className="ibx-palette__form" method="post" action={action} role="search">
        {csrfToken ? <input type="hidden" name="csrf" value={csrfToken} /> : null}
        <label className="ibx-field__label" htmlFor="palette-query">
          {t.t("ui.search.label")}
        </label>
        <p className="ibx-field__hint" id="palette-hint">
          {t.t("ui.search.hint")}
        </p>
        <div className="ibx-palette__row">
          <input
            className="ibx-field__input"
            id="palette-query"
            name="q"
            type="search"
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            defaultValue={shown}
            aria-describedby={refused ? "palette-hint palette-refusal" : "palette-hint"}
            aria-invalid={refused ? true : undefined}
          />
          <button className="ibx-button ibx-button--primary" type="submit">
            {t.t("ui.search.submit")}
          </button>
        </div>
      </form>
      {refused ? (
        <p className="ibx-field__error" id="palette-refusal" role="alert">
          {t.t(refused.messageKey, { min: 3 })}
          {refused.code === "IPB-UX-003" ? (
            <span className="ibx-palette__code">
              {" "}
              {t.t("ui.errors.reference", { code: refused.code })}
            </span>
          ) : null}
        </p>
      ) : null}
      {result?.status === "ok" ? <SearchResults result={result} t={t} /> : null}
      {!result && recent.length ? (
        <section className="ibx-palette__group" aria-labelledby="palette-recent">
          <h2 className="ibx-palette__heading" id="palette-recent">
            {t.t("ui.search.recent")}
          </h2>
          <HitList hits={recent} />
        </section>
      ) : null}
    </div>
  );
}

export function SearchResults({
  result,
  t = en,
}: {
  result: Extract<SearchResult, { status: "ok" }>;
  t?: Messages;
}) {
  const count = result.groups.reduce((n, g) => n + g.hits.length, 0);
  return (
    <div className="ibx-palette__results">
      <p className="ibx-live" role="status" aria-live="polite">
        {t.t(count === 1 ? "ui.search.count_one" : "ui.search.count", { count })}
      </p>
      {result.failed.length ? <p className="ibx-field__hint">{t.t("ui.search.partial")}</p> : null}
      {result.groups.map((g) => (
        <section className="ibx-palette__group" key={g.id} aria-labelledby={`palette-g-${g.id}`}>
          <h2 className="ibx-palette__heading" id={`palette-g-${g.id}`}>
            {g.label}
          </h2>
          <HitList hits={g.hits} />
        </section>
      ))}
    </div>
  );
}

function HitList({ hits }: { hits: readonly SearchHit[] }) {
  return (
    <ul className="ibx-palette__list">
      {hits.map((h) => (
        <li key={h.href}>
          <a className="ibx-palette__hit" href={h.href}>
            <span className="ibx-palette__label">{h.label}</span>
            {h.detail ? <span className="ibx-palette__detail">{h.detail}</span> : null}
          </a>
        </li>
      ))}
    </ul>
  );
}
