// The Studio frame (IPB-04-100; PL5 plan §9.6): the section list, the page heading, the result of
// the last action and its error summary. It sits inside the app's `AppShell` main; it adds no
// landmark of its own besides the section navigation.
import type { ReactNode } from "react";
import { ErrorSummary } from "../components/forms.js";
import { Notice } from "../components/status.js";
import type { FieldError, Flash } from "./types.js";

/** The Studio sections the PL5 packages cover, in menu order. */
export const STUDIO_SECTIONS = [
  { key: "approvals", label: "Approvals" },
  { key: "brand", label: "Brand" },
  { key: "pricing", label: "Pricing" },
  { key: "pages", label: "Pages and sections" },
  { key: "menus", label: "Menus" },
  { key: "footer", label: "Footer and contact" },
  { key: "policies", label: "Policies" },
  { key: "redirects", label: "Redirects" },
  { key: "media", label: "Media" },
  { key: "claims", label: "Claims Register" },
  { key: "resources", label: "Resources" },
  { key: "forms", label: "Forms" },
  { key: "consent", label: "Consent texts" },
  { key: "feedback", label: "Feedback" },
  { key: "trust", label: "Trust documents" },
  { key: "previews", label: "Preview links" },
] as const;
export type StudioSection = (typeof STUDIO_SECTIONS)[number]["key"];

/** The path of a section or of something inside it. */
export const studioPath = (base: string, section: StudioSection, ...rest: string[]) =>
  [base.replace(/\/+$/, ""), section, ...rest.map(encodeURIComponent)].join("/");

export function StudioPage({
  base,
  section,
  title,
  flash,
  errors = [],
  reveal,
  sections = STUDIO_SECTIONS.map((s) => s.key),
  children,
}: {
  base: string;
  section: StudioSection;
  title: string;
  flash?: Flash | null | undefined;
  errors?: readonly FieldError[] | undefined;
  /** A value shown once after the action (a preview link). */
  reveal?: string | undefined;
  /** The sections this app mounts (default: all). */
  sections?: readonly StudioSection[];
  children: ReactNode;
}) {
  return (
    <div className="ibx-studio">
      <nav className="ibx-studio__nav" aria-label="Studio sections">
        <ul>
          {STUDIO_SECTIONS.filter((s) => sections.includes(s.key)).map((s) => (
            <li key={s.key}>
              <a
                href={studioPath(base, s.key)}
                aria-current={s.key === section ? "page" : undefined}
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="ibx-studio__content">
        <h1>{title}</h1>
        {flash ? (
          <Notice tone={flash.tone} title={flash.title}>
            {flash.detail ? <p>{flash.detail}</p> : null}
            {reveal ? (
              <p>
                <code className="ibx-studio__reveal">{reveal}</code>
              </p>
            ) : null}
          </Notice>
        ) : null}
        <ErrorSummary errors={errors} />
        {children}
      </div>
    </div>
  );
}

/** A state as words, with the state as a data attribute for styling (never colour alone). */
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className="ibx-badge" data-status={status}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

/** A labelled group of fields that posts to one action. */
export function StudioSectionBox({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="ibx-studio__box" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

/** The error message of one field, if any. */
export const errorFor = (errors: readonly FieldError[] | undefined, fieldId: string) =>
  errors?.find((e) => e.fieldId === fieldId)?.message;

/** Hidden inputs (ids the handler needs). */
export function Hidden({ values }: { values: Readonly<Record<string, string>> }) {
  return (
    <>
      {Object.entries(values).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );
}
