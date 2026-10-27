// The feedback widget, server-rendered (IPB-04-94, 04-98; IPB-06-61; `@IPB-04-AT-90`; PL5 plan §7.1).
// The trigger is a plain link to `/feedback`, so it works by keyboard and without JavaScript; the
// controller (`FEEDBACK_CONTROLLER_JS`) opens the same form in a modal dialog instead. Fields are
// labelled, errors are linked to them and listed in an error summary, and nothing here sets a
// cookie. The accessibility report form has no CAPTCHA puzzle (IPB-06-40, 06-61).
import { Button, CheckboxField, ErrorSummary, Field } from "@infrabyx/ui";
import { FEEDBACK_HONEYPOT, type FeedbackType } from "./payload.js";
import type { FeedbackView } from "./service.js";

type Csrf = { name: string; value: string } | undefined;
type Errors = readonly { fieldId: string; message: string }[];

const Hidden = ({ csrf }: { csrf: Csrf }) =>
  csrf ? <input type="hidden" name={csrf.name} value={csrf.value} /> : null;

/** Off-screen and out of the tab order; a person never fills it, a bot often does. */
const Honeypot = () => (
  <div className="ibx-fb__hp" aria-hidden="true">
    <label htmlFor="ibx-fb-hp">Leave this empty</label>
    <input id="ibx-fb-hp" name={FEEDBACK_HONEYPOT} type="text" tabIndex={-1} autoComplete="off" />
  </div>
);

/** Footer "Report a problem" and, when `fb.widget.floating` is on, the floating button. */
export function FeedbackTrigger(p: { href?: string; floating?: boolean }) {
  const href = p.href ?? "/feedback";
  return (
    <>
      <a className="ibx-fb-trigger" href={href} data-fb-open="">
        Report a problem
      </a>
      {p.floating ? (
        <a className="ibx-fb-float ibx-button ibx-button--secondary" href={href} data-fb-open="">
          Feedback
        </a>
      ) : null}
    </>
  );
}

const TYPE_LABEL: Record<Exclude<FeedbackType, "accessibility" | "help_content">, string> = {
  bug: "Something is not working",
  idea: "An idea or suggestion",
  praise: "Something you liked",
  nps: "How likely are you to recommend us?",
};

export interface FeedbackFormProps {
  action?: string;
  csrf?: Csrf;
  /** The route pattern of the page the person came from (never the URL). */
  route?: string;
  /** Offer the score question (`FeedbackService.npsDue`). */
  npsDue?: boolean;
  errors?: Errors;
  values?: { type?: string; summary?: string };
}

/** The feedback form: the `/feedback` page and the body of the dialog. */
export function FeedbackForm(p: FeedbackFormProps) {
  const errors = p.errors ?? [];
  const err = (id: string) => errors.find((e) => e.fieldId === id)?.message;
  const types = (["bug", "idea", "praise", ...(p.npsDue ? ["nps"] : [])] as const).map(
    (t) => t as keyof typeof TYPE_LABEL,
  );
  const checked = p.values?.type ?? "bug";
  return (
    <form className="ibx-fb" method="post" action={p.action ?? "/api/feedback"} noValidate>
      {errors.length ? <ErrorSummary errors={errors} /> : null}
      <Hidden csrf={p.csrf} />
      {p.route ? <input type="hidden" name="route" value={p.route} /> : null}
      <fieldset className="ibx-fb__types">
        <legend>What would you like to tell us?</legend>
        {types.map((t) => (
          <div className="ibx-check" key={t}>
            <input
              className="ibx-check__input"
              type="radio"
              id={`ibx-fb-type-${t}`}
              name="type"
              value={t}
              defaultChecked={t === checked}
            />
            <label className="ibx-check__label" htmlFor={`ibx-fb-type-${t}`}>
              {TYPE_LABEL[t]}
            </label>
          </div>
        ))}
      </fieldset>
      {p.npsDue ? (
        <fieldset className="ibx-fb__nps">
          <legend>
            If you chose the score question: 0 is not at all likely, 10 is very likely
          </legend>
          {Array.from({ length: 11 }, (_, n) => (
            <span className="ibx-fb__score" key={n}>
              <input type="radio" id={`ibx-fb-nps-${n}`} name="nps_score" value={String(n)} />
              <label htmlFor={`ibx-fb-nps-${n}`}>{n}</label>
            </span>
          ))}
        </fieldset>
      ) : null}
      <Field
        id="ibx-fb-summary"
        name="summary"
        label="Your feedback"
        helpKey="hlp.feedback.summary"
        hint="Please do not include personal details such as phone, account, PAN or Aadhaar numbers."
        multiline
        required
        maxLength={2000}
        {...(p.values?.summary ? { defaultValue: p.values.summary } : {})}
        {...(err("ibx-fb-summary") ? { error: err("ibx-fb-summary")! } : {})}
      />
      <CheckboxField
        id="ibx-fb-contact"
        name="contact_ok"
        label="You may contact me about this feedback"
        helpKey="hlp.feedback.contact_ok"
      />
      <Honeypot />
      <Button type="submit" variant="primary">
        Send feedback
      </Button>
    </form>
  );
}

/** The feedback form in a dialog, opened by the controller from any trigger. */
export function FeedbackDialog(p: FeedbackFormProps) {
  return (
    <dialog className="ibx-fb-dialog" id="ibx-fb-dialog" aria-labelledby="ibx-fb-dialog-title">
      <h2 id="ibx-fb-dialog-title">Send feedback</h2>
      <FeedbackForm {...p} />
      <Button data-fb-close="">Close</Button>
    </dialog>
  );
}

/** "Report an accessibility problem" on `/accessibility` and in the help menu (IPB-06-61). */
export function AccessibilityReportForm(p: {
  action?: string;
  csrf?: Csrf;
  route?: string;
  errors?: Errors;
}) {
  const errors = p.errors ?? [];
  const err = (id: string) => errors.find((e) => e.fieldId === id)?.message;
  const e = (id: string) => (err(id) ? { error: err(id)! } : {});
  return (
    <form className="ibx-fb" method="post" action={p.action ?? "/api/feedback"} noValidate>
      {errors.length ? <ErrorSummary errors={errors} /> : null}
      <Hidden csrf={p.csrf} />
      <input type="hidden" name="type" value="accessibility" />
      <Field
        id="ibx-a11y-route"
        name="route"
        label="Page or screen"
        helpKey="hlp.feedback.a11y_route"
        hint="For example /account/settings. Leave out anything after a question mark."
        {...(p.route ? { defaultValue: p.route } : {})}
        {...e("ibx-a11y-route")}
      />
      <Field
        id="ibx-a11y-at"
        name="assistive_tech"
        label="Assistive technology you use, if any"
        helpKey="hlp.feedback.a11y_at"
        hint="For example NVDA with Firefox, TalkBack, or keyboard only."
        maxLength={120}
        {...e("ibx-a11y-at")}
      />
      <Field
        id="ibx-a11y-summary"
        name="summary"
        label="What happened"
        helpKey="hlp.feedback.a11y_summary"
        multiline
        required
        maxLength={2000}
        {...e("ibx-a11y-summary")}
      />
      <Field
        id="ibx-a11y-expected"
        name="expected"
        label="What you expected"
        helpKey="hlp.feedback.a11y_expected"
        multiline
        maxLength={1000}
        {...e("ibx-a11y-expected")}
      />
      <CheckboxField
        id="ibx-a11y-blocking"
        name="blocking"
        label="This stops me from finishing a task"
        helpKey="hlp.feedback.a11y_blocking"
      />
      <CheckboxField
        id="ibx-a11y-contact"
        name="contact_ok"
        label="You may contact me about this report"
        helpKey="hlp.feedback.contact_ok"
      />
      <Honeypot />
      <Button type="submit" variant="primary">
        Send report
      </Button>
    </form>
  );
}

const STATUS_LABEL: Record<FeedbackView["status"], string> = {
  received: "Received",
  triaged: "Triaged",
  planned: "Planned",
  shipped: "Shipped",
  declined: "Declined",
  duplicate: "Duplicate",
};

/** The reference and status the submitter sees (`@IPB-04-AT-92`). */
export function FeedbackStatusView({ view }: { view: FeedbackView }) {
  return (
    <section className="ibx-fb-status" aria-labelledby="ibx-fb-status-title">
      <h2 id="ibx-fb-status-title">Feedback {view.id}</h2>
      <p>
        Status: <strong data-fb-status={view.status}>{STATUS_LABEL[view.status]}</strong>
      </p>
      <ol className="ibx-fb-status__history">
        {view.history.map((h) => (
          <li key={`${h.status}-${h.at}`}>
            <time dateTime={h.at}>{h.at.slice(0, 10)}</time> {STATUS_LABEL[h.status]}
            {h.note ? `: ${h.note}` : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

export const FEEDBACK_CSS = String.raw`
.ibx-fb__hp { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
.ibx-fb__types, .ibx-fb__nps { border: 0; padding: 0; margin: 0 0 var(--space-4); }
.ibx-fb__score { display: inline-flex; align-items: center; gap: var(--space-1); margin-inline-end: var(--space-3); }
.ibx-fb-float { position: fixed; inset: auto var(--space-4) var(--space-4) auto; z-index: 40; }
.ibx-fb-dialog { max-width: 40rem; width: calc(100% - 2 * var(--space-4)); border: 2px solid var(--color-border-strong); background: var(--color-surface); color: var(--color-text); }
.ibx-fb-dialog::backdrop { background: rgb(0 0 0 / 0.5); }
`;

/**
 * The widget controller, served first-party under the CSP nonce (`/feedback.js`). Without it the
 * triggers navigate to `/feedback`. With it a trigger opens the dialog (focus moves into it, Escape
 * and Close return focus to the trigger). It sets no cookie and stores nothing.
 */
export const FEEDBACK_CONTROLLER_JS = String.raw`(() => {
  "use strict";
  const dialog = document.getElementById("ibx-fb-dialog");
  if (!dialog || typeof dialog.showModal !== "function") return;
  let opener = null;
  for (const a of document.querySelectorAll("[data-fb-open]")) {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      opener = a;
      dialog.showModal();
      const first = dialog.querySelector("input:not([type=hidden]):not([tabindex='-1']), textarea");
      if (first) first.focus();
    });
  }
  dialog.addEventListener("close", () => { if (opener) opener.focus(); });
  const close = dialog.querySelector("[data-fb-close]");
  if (close) close.addEventListener("click", () => dialog.close());
})();
`;
