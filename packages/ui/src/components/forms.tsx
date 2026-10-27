// Form primitives (IPB-06 SC 1.3.1, 1.3.5, 2.5.3, 3.3.1–3.3.3; IPB-07-26, 07-42). Every field has a
// visible label, a help key (required by the type), `autocomplete` where the purpose is known, and
// an error linked by `aria-describedby`. Consent checkboxes are never pre-ticked (IPB-05 template 18,
// IPB-07-30): the component has no `defaultChecked`.
import type { ReactNode } from "react";
import { messages, type Messages } from "../i18n/messages.js";
import { HelpButton, type HelpEntry } from "./help.js";

const en = messages("en-IN");

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  variant = "secondary",
  type = "button",
  children,
  name,
  value,
  disabled,
  ...data
}: {
  variant?: ButtonVariant;
  type?: "button" | "submit" | "reset";
  children: ReactNode;
  name?: string;
  value?: string;
  disabled?: boolean;
  [dataAttr: `data-${string}`]: string | undefined;
}) {
  return (
    <button
      className={`ibx-button ibx-button--${variant}`}
      type={type}
      name={name}
      value={value}
      disabled={disabled}
      {...data}
    >
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "secondary",
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  children: ReactNode;
}) {
  return (
    <a className={`ibx-button ibx-button--${variant}`} href={href}>
      {children}
    </a>
  );
}

export interface FieldProps {
  id: string;
  name?: string;
  label: string;
  /** Required (IPB-07-42); the help lint checks the key exists. */
  helpKey: string;
  help?: HelpEntry;
  type?:
    "text" | "email" | "tel" | "url" | "number" | "search" | "password" | "date" | "datetime-local";
  autoComplete?: string;
  required?: boolean;
  hint?: string | undefined;
  error?: string | undefined;
  defaultValue?: string | undefined;
  multiline?: boolean;
  maxLength?: number;
  t?: Messages;
}

export function Field(p: FieldProps) {
  const t = p.t ?? en;
  const hintId = p.hint ? `${p.id}-hint` : undefined;
  const errorId = p.error ? `${p.id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const common = {
    id: p.id,
    name: p.name ?? p.id,
    required: p.required,
    "aria-invalid": p.error ? (true as const) : undefined,
    "aria-describedby": describedBy,
    defaultValue: p.defaultValue,
    maxLength: p.maxLength,
    "data-help-key": p.helpKey,
  };
  return (
    <div className={`ibx-field${p.error ? " ibx-field--error" : ""}`}>
      <div className="ibx-field__label-row">
        <label className="ibx-field__label" htmlFor={p.id}>
          {p.label}
          <span className="ibx-field__req">
            {" "}
            ({p.required ? t.t("ui.field.required") : t.t("ui.field.optional")})
          </span>
        </label>
        {p.help ? <HelpButton entry={p.help} label={p.label} t={t} /> : null}
      </div>
      {p.hint ? (
        <p className="ibx-field__hint" id={hintId}>
          {p.hint}
        </p>
      ) : null}
      {p.error ? (
        <p className="ibx-field__error" id={errorId}>
          {p.error}
        </p>
      ) : null}
      {p.multiline ? (
        <textarea className="ibx-field__input" rows={5} {...common} />
      ) : (
        <input
          className="ibx-field__input"
          type={p.type ?? "text"}
          autoComplete={p.autoComplete}
          {...common}
        />
      )}
    </div>
  );
}

/** A native select with a visible label and a help key (no script, SC 3.2.2: no change on select). */
export function SelectField(p: {
  id: string;
  name?: string;
  label: string;
  helpKey: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string | undefined;
  required?: boolean;
  hint?: string | undefined;
  error?: string | undefined;
  t?: Messages;
}) {
  const t = p.t ?? en;
  const hintId = p.hint ? `${p.id}-hint` : undefined;
  const errorId = p.error ? `${p.id}-error` : undefined;
  return (
    <div className={`ibx-field${p.error ? " ibx-field--error" : ""}`}>
      <label className="ibx-field__label" htmlFor={p.id}>
        {p.label}
        <span className="ibx-field__req">
          {" "}
          ({p.required ? t.t("ui.field.required") : t.t("ui.field.optional")})
        </span>
      </label>
      {p.hint ? (
        <p className="ibx-field__hint" id={hintId}>
          {p.hint}
        </p>
      ) : null}
      {p.error ? (
        <p className="ibx-field__error" id={errorId}>
          {p.error}
        </p>
      ) : null}
      <select
        className="ibx-field__input"
        id={p.id}
        name={p.name ?? p.id}
        required={p.required}
        defaultValue={p.defaultValue}
        aria-invalid={p.error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        data-help-key={p.helpKey}
      >
        {p.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A consent or choice checkbox: unticked unless the person ticked it (`checked` from their input). */
export function CheckboxField(p: {
  id: string;
  name?: string;
  label: ReactNode;
  helpKey: string;
  required?: boolean;
  checked?: boolean;
  error?: string | undefined;
  value?: string;
}) {
  const errorId = p.error ? `${p.id}-error` : undefined;
  return (
    <div className={`ibx-check${p.error ? " ibx-field--error" : ""}`}>
      {p.error ? (
        <p className="ibx-field__error" id={errorId}>
          {p.error}
        </p>
      ) : null}
      <input
        className="ibx-check__input"
        type="checkbox"
        id={p.id}
        name={p.name ?? p.id}
        value={p.value ?? "yes"}
        required={p.required}
        defaultChecked={p.checked === true}
        aria-invalid={p.error ? true : undefined}
        aria-describedby={errorId}
        data-help-key={p.helpKey}
      />
      <label className="ibx-check__label" htmlFor={p.id}>
        {p.label}
      </label>
    </div>
  );
}

/** Errors summarised at the top, each linked to its field; the page moves focus here. */
export function ErrorSummary({
  errors,
  t = en,
}: {
  errors: readonly { fieldId: string; message: string }[];
  t?: Messages;
}) {
  if (!errors.length) return null;
  return (
    <div className="ibx-error-summary" role="alert" tabIndex={-1} id="error-summary">
      <h2 className="ibx-error-summary__title">{t.t("ui.errors.summary")}</h2>
      <ul>
        {errors.map((e) => (
          <li key={e.fieldId}>
            <a href={`#${e.fieldId}`}>{e.message}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The four-part error (IPB-07-26): what happened, why, what to do, and the help key with its
 * code. Never blames the person; the correlation id goes under "Details".
 */
export function ErrorMessage(p: {
  code: string;
  whatHappened: string;
  why: string;
  whatToDo: string;
  helpKey: string;
  correlationId?: string;
  t?: Messages;
}) {
  const t = p.t ?? en;
  return (
    <div className="ibx-error" role="alert" data-help-key={p.helpKey}>
      <p className="ibx-error__what">{p.whatHappened}</p>
      <p className="ibx-error__why">{p.why}</p>
      <p className="ibx-error__todo">{p.whatToDo}</p>
      <p className="ibx-error__code">{t.t("ui.errors.reference", { code: p.code })}</p>
      {p.correlationId ? (
        <details className="ibx-error__details">
          <summary>{t.t("ui.errors.details")}</summary>
          <code>{p.correlationId}</code>
        </details>
      ) : null}
    </div>
  );
}
