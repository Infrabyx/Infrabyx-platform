// The "i" help button and popover (IPB-07-44, §07.4.4; IPB-06 SC 1.4.13, 2.5.8). Built on the native
// `popover` attribute: it opens on click, Enter or Space, closes on Escape or an outside click and
// returns focus, with no script. The button is 24×24 CSS px at least and named "Help: <label>".
import { messages, type Messages } from "../i18n/messages.js";

const en = messages("en-IN");

export interface HelpEntry {
  key: string;
  term: string;
  /** At most 40 words (IPB-HLP-002). */
  plain: string;
  learnMoreHref?: string;
  regulatoryReference?: {
    instrument: string;
    provision: string;
    summary: string;
    effectiveDate: string;
    url?: string;
  };
  reviewerInitials?: string;
  effectiveDate?: string;
}

const popoverId = (key: string) => `help-${key.replace(/[^a-z0-9]+/gi, "-")}`;

export function HelpButton({
  entry,
  label,
  t = en,
}: {
  entry: HelpEntry;
  label: string;
  t?: Messages;
}) {
  const id = popoverId(entry.key);
  return (
    <>
      <button
        type="button"
        className="ibx-help__button"
        popoverTarget={id}
        aria-label={t.t("ui.help.button", { label })}
        data-help-key={entry.key}
      >
        <span aria-hidden="true">i</span>
      </button>
      <div
        className="ibx-help__popover"
        popover="auto"
        id={id}
        role="dialog"
        aria-labelledby={`${id}-term`}
      >
        <h3 className="ibx-help__term" id={`${id}-term`}>
          {entry.term}
        </h3>
        <p>{entry.plain}</p>
        {entry.learnMoreHref ? <a href={entry.learnMoreHref}>{t.t("ui.help.learn_more")}</a> : null}
        {entry.regulatoryReference ? (
          <section className="ibx-help__ref">
            <h4>{t.t("ui.help.regulatory_reference")}</h4>
            <p>
              {entry.regulatoryReference.instrument} · {entry.regulatoryReference.provision}
            </p>
            <p>{entry.regulatoryReference.summary}</p>
            <p>Effective {entry.regulatoryReference.effectiveDate}</p>
            {entry.regulatoryReference.url ? (
              <a href={entry.regulatoryReference.url} rel="noopener" target="_blank">
                Open source<span className="ibx-visually-hidden"> (opens in new tab)</span>
              </a>
            ) : null}
          </section>
        ) : null}
        <p className="ibx-help__footer">
          <code>{entry.key}</code>
          {entry.reviewerInitials ? ` · ${entry.reviewerInitials}` : ""}
          {entry.effectiveDate ? ` · ${entry.effectiveDate}` : ""}
        </p>
      </div>
    </>
  );
}
