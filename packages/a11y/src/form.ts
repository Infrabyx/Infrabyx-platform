// Form-layout lint (PR-LDC-24). A product describes a form declaratively (its title, headings,
// field groups, help texts and controls in DOM order) and `lintForm` checks the structure that
// assistive technology depends on: accessible names, label visibility, unique names, error
// association, required marking, focus order, heading order, grouped choices, input purpose
// (autocomplete) and id references. Every finding carries its WCAG 2.2 success criterion, taken
// from `mapping.json`. The rendered form is checked with `axeFormScan` in
// `@infrabyx/a11y/playwright`, which returns the same finding shape.
import { z } from "zod";

/** Control kinds: the HTML input types a form uses, plus select, textarea and buttons. */
export const FORM_CONTROL_KINDS = [
  "text",
  "email",
  "tel",
  "url",
  "number",
  "password",
  "search",
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
  "range",
  "color",
  "select",
  "textarea",
  "checkbox",
  "radio",
  "file",
  "submit",
  "button",
  "reset",
  "hidden",
] as const;
export type FormControlKind = (typeof FORM_CONTROL_KINDS)[number];

const BUTTONS: ReadonlySet<FormControlKind> = new Set(["submit", "button", "reset"]);
const CHOICES: ReadonlySet<FormControlKind> = new Set(["radio", "checkbox"]);
/** Kinds that take a typed or chosen value with a purpose (SC 1.3.5). */
const PURPOSE_KINDS: ReadonlySet<FormControlKind> = new Set([
  "text",
  "email",
  "tel",
  "url",
  "number",
  "password",
  "search",
  "date",
  "month",
  "select",
  "textarea",
]);

const elementId = z.string().regex(/^\S+$/, "an id is non-empty and has no whitespace");

export const FormHeadingSchema = z
  .object({ id: elementId, level: z.number().int().min(1).max(6), text: z.string() })
  .strict();
export type FormHeading = z.infer<typeof FormHeadingSchema>;

/** A fieldset with a legend, or an element with `role="group"`/`"radiogroup"` and a label. */
export const FormGroupSchema = z
  .object({
    id: elementId,
    /** The `<legend>` text. */
    legend: z.string().optional(),
    /** `aria-labelledby` of a `role="group"` element, used when there is no legend. */
    labelledBy: z.array(elementId).optional(),
  })
  .strict();
export type FormGroup = z.infer<typeof FormGroupSchema>;

/** Static text that controls reference: hints, instructions, an error summary. */
export const FormTextSchema = z.object({ id: elementId, text: z.string() }).strict();
export type FormText = z.infer<typeof FormTextSchema>;

export const FormControlSchema = z
  .object({
    id: elementId,
    kind: z.enum(FORM_CONTROL_KINDS),
    /** The HTML `name` attribute (radios and checkboxes of one set share it). */
    name: z.string().optional(),
    /** The visible `<label for>` text; for a button, its visible text. */
    label: z.string().optional(),
    /** `aria-labelledby`: ids of headings, texts, groups or other controls. */
    labelledBy: z.array(elementId).optional(),
    ariaLabel: z.string().optional(),
    placeholder: z.string().optional(),
    /** `aria-describedby`, in order. */
    describedBy: z.array(elementId).optional(),
    /** The id of the element that shows this control's error message. */
    errorId: elementId.optional(),
    /** The error message currently shown, if any. */
    errorText: z.string().optional(),
    /** `aria-errormessage` (exposed only while `invalid` is true). */
    errorMessage: elementId.optional(),
    /** `aria-invalid="true"`. */
    invalid: z.boolean().optional(),
    /** `required` or `aria-required="true"`. */
    required: z.boolean().optional(),
    /** A visible required marker outside the label text (an explained asterisk, an icon). */
    requiredIndicator: z.boolean().optional(),
    autocomplete: z.string().optional(),
    /**
     * Whether the control collects data about the user (SC 1.3.5). `email`, `tel` and `password`
     * controls are taken as true unless this is false; otherwise the label is used as a hint.
     */
    personalData: z.boolean().optional(),
    tabIndex: z.number().int().optional(),
    /** The id of the group (fieldset) the control sits in. */
    group: elementId.optional(),
  })
  .strict();
export type FormControl = z.infer<typeof FormControlSchema>;

export const FormLayoutSchema = z
  .object({
    /** The form's id; form-level findings name it. */
    id: elementId,
    /** The form's visible title when it is not one of `headings`. */
    title: z.string().optional(),
    /** Headings inside the form, in DOM order. */
    headings: z.array(FormHeadingSchema).default([]),
    groups: z.array(FormGroupSchema).default([]),
    texts: z.array(FormTextSchema).default([]),
    /** Controls in DOM order, which is the expected focus order. */
    controls: z.array(FormControlSchema).min(1),
  })
  .strict();
export type FormLayout = z.infer<typeof FormLayoutSchema>;
export type FormLayoutInput = z.input<typeof FormLayoutSchema>;

/** The lint rules and the WCAG 2.2 success criterion each one checks. */
export const FORM_RULES = {
  "name-missing": { sc: "4.1.2", summary: "the control has no accessible name" },
  "label-placeholder-only": { sc: "3.3.2", summary: "a placeholder is the only label" },
  "label-not-visible": { sc: "3.3.2", summary: "the name comes only from aria-label" },
  "label-in-name": { sc: "2.5.3", summary: "aria-label does not contain the visible label" },
  "name-duplicate": {
    sc: "2.4.6",
    summary: "two controls share an accessible name and no distinct group legend",
  },
  "id-duplicate": { sc: "1.3.1", summary: "an id is used by two elements" },
  "labelledby-target-missing": { sc: "4.1.2", summary: "aria-labelledby names a missing id" },
  "describedby-target-missing": { sc: "1.3.1", summary: "aria-describedby names a missing id" },
  "errormessage-target-missing": { sc: "3.3.1", summary: "aria-errormessage names a missing id" },
  "error-not-associated": {
    sc: "3.3.1",
    summary: "the error message is not referenced by aria-describedby or aria-errormessage",
  },
  "error-state-missing": { sc: "4.1.2", summary: "an error is shown but aria-invalid is not set" },
  "required-not-programmatic": {
    sc: "1.3.1",
    summary: "the label marks the control required but the control is not required",
  },
  "required-not-visible": { sc: "3.3.2", summary: "a required control has no visible marker" },
  "tabindex-positive": { sc: "2.4.3", summary: "a positive tabindex overrides DOM focus order" },
  "tabindex-removed": { sc: "2.1.1", summary: "a negative tabindex takes the control out of Tab" },
  "heading-missing": { sc: "2.4.6", summary: "the form has neither a heading nor a title" },
  "heading-empty": { sc: "2.4.6", summary: "a heading has no text" },
  "heading-skip": { sc: "1.3.1", summary: "a heading level is skipped" },
  "group-missing": { sc: "1.3.1", summary: "a radio or checkbox set is not grouped" },
  "group-unknown": { sc: "1.3.1", summary: "a control names a group that does not exist" },
  "group-legend-missing": { sc: "1.3.1", summary: "a group has no legend" },
  "autocomplete-invalid": { sc: "1.3.5", summary: "autocomplete is not an HTML token list" },
  "autocomplete-missing": { sc: "1.3.5", summary: "a personal-data input has no purpose token" },
  "submit-missing": { sc: "3.2.2", summary: "the form has no submit button" },
} as const satisfies Record<string, { sc: string; summary: string }>;
export type FormRuleId = keyof typeof FORM_RULES;

export interface FormFinding {
  /** A `FORM_RULES` id, or the axe rule id when `source` is `axe`. */
  rule: string;
  /** The WCAG 2.2 success criterion, as in `mapping.json`. */
  sc: string;
  severity: "error" | "warning";
  /** The control, heading or group id, or the form id for form-level findings. */
  subject: string;
  message: string;
  source: "lint" | "axe";
}

export interface LintFormOptions {
  /**
   * The level of the page heading the form sits under. When given, the form's first heading may be
   * at most one level deeper; otherwise the first heading may be at any level.
   */
  parentHeadingLevel?: number;
}

// --- autocomplete (HTML Living Standard §4.10.18.7.1, the autofill detail tokens) ---

const FIELD_NAMES: ReadonlySet<string> = new Set([
  "name",
  "honorific-prefix",
  "given-name",
  "additional-name",
  "family-name",
  "honorific-suffix",
  "nickname",
  "username",
  "new-password",
  "current-password",
  "one-time-code",
  "organization-title",
  "organization",
  "street-address",
  "address-line1",
  "address-line2",
  "address-line3",
  "address-level4",
  "address-level3",
  "address-level2",
  "address-level1",
  "country",
  "country-name",
  "postal-code",
  "cc-name",
  "cc-given-name",
  "cc-additional-name",
  "cc-family-name",
  "cc-number",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year",
  "cc-csc",
  "cc-type",
  "transaction-currency",
  "transaction-amount",
  "language",
  "bday",
  "bday-day",
  "bday-month",
  "bday-year",
  "sex",
  "url",
  "photo",
]);
const CONTACT_FIELD_NAMES: ReadonlySet<string> = new Set([
  "tel",
  "tel-country-code",
  "tel-national",
  "tel-area-code",
  "tel-local",
  "tel-local-prefix",
  "tel-local-suffix",
  "tel-extension",
  "email",
  "impp",
]);
const CONTACT_KINDS: ReadonlySet<string> = new Set(["home", "work", "mobile", "fax", "pager"]);

/**
 * True when `value` is a valid autofill detail token list: `on`, `off`, or
 * `[section-*] [shipping|billing] ([home|work|mobile|fax|pager] contact-field | field) [webauthn]`.
 * Case-insensitive, as in HTML.
 */
export function isValidAutocomplete(value: string): boolean {
  const t = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (t.length === 1 && (t[0] === "on" || t[0] === "off")) return true;
  let i = 0;
  if (t[i]?.startsWith("section-") && t[i]!.length > "section-".length) i++;
  if (t[i] === "shipping" || t[i] === "billing") i++;
  if (t[i] !== undefined && CONTACT_KINDS.has(t[i]!)) {
    i++;
    if (!CONTACT_FIELD_NAMES.has(t[i] ?? "")) return false;
    i++;
  } else if (FIELD_NAMES.has(t[i] ?? "") || CONTACT_FIELD_NAMES.has(t[i] ?? "")) {
    i++;
  } else return false;
  if (t[i] === "webauthn") i++;
  return i === t.length;
}

/** Label hints for SC 1.3.5, checked in order (the first match wins). */
const PURPOSE_HINTS: readonly (readonly [RegExp, string])[] = [
  [/\be-?mail\b/i, "email"],
  [/\b(phone|mobile|telephone)\b/i, "tel"],
  [/\b(first|given) name\b/i, "given-name"],
  [/\b(last|family) name\b|\bsurname\b/i, "family-name"],
  [/\buser ?name\b/i, "username"],
  [/\b(company|organi[sz]ation)\b/i, "organization"],
  [/\b(post ?code|postal code|zip( code)?|pin ?code)\b/i, "postal-code"],
  [/\baddress\b/i, "street-address"],
  [/\b(city|town)\b/i, "address-level2"],
  [/\bcountry\b/i, "country-name"],
  [/\b(date of birth|birth ?date|birthday|dob)\b/i, "bday"],
  [/^\s*(full |your )?name\b/i, "name"],
];
const IMPLIED_PURPOSE: Partial<Record<FormControlKind, string>> = {
  email: "email",
  tel: "tel",
  password: "current-password or new-password",
};

// --- names ---

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const nonEmpty = (s: string | undefined): s is string => s !== undefined && s.trim() !== "";

export interface AccessibleName {
  name: string;
  from: "labelledby" | "aria-label" | "label";
}

/** The text an id refers to, for `aria-labelledby` (not recursive, as in accname). */
function idTexts(f: FormLayout): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of f.controls) {
    const t = c.ariaLabel ?? c.label;
    if (t !== undefined && !m.has(c.id)) m.set(c.id, t);
    if (c.errorId && c.errorText !== undefined && !m.has(c.errorId)) m.set(c.errorId, c.errorText);
  }
  for (const g of f.groups) if (g.legend !== undefined) m.set(g.id, g.legend);
  for (const h of f.headings) m.set(h.id, h.text);
  for (const t of f.texts) m.set(t.id, t.text);
  return m;
}

const fromRefs = (refs: readonly string[] | undefined, texts: Map<string, string>) =>
  (refs ?? [])
    .map((r) => texts.get(r))
    .filter((x): x is string => x !== undefined)
    .join(" ")
    .trim();

/**
 * The accessible name in accname precedence: `aria-labelledby` (its existing targets), then
 * `aria-label`, then the `<label>` (a button's text). A placeholder is never a name here.
 */
export function formControlName(
  control: FormControl,
  layout: FormLayout,
  texts: Map<string, string> = idTexts(layout),
): AccessibleName | undefined {
  const lb = fromRefs(control.labelledBy, texts);
  if (lb) return { name: lb, from: "labelledby" };
  if (nonEmpty(control.ariaLabel)) return { name: control.ariaLabel.trim(), from: "aria-label" };
  if (nonEmpty(control.label)) return { name: control.label.trim(), from: "label" };
  return undefined;
}

const REQUIRED_MARK = /\*|\brequired\b/i;

/**
 * Lints a form layout. The layout is parsed with `FormLayoutSchema` first (a `ZodError` when it is
 * not a layout). Findings come in a fixed order: the form, then headings, groups and controls in
 * their array order, then by rule id and message.
 */
export function lintForm(layout: FormLayoutInput, opts: LintFormOptions = {}): FormFinding[] {
  const f = FormLayoutSchema.parse(layout);
  const out: FormFinding[] = [];
  const add = (
    rule: FormRuleId,
    subject: string,
    message: string,
    severity: "error" | "warning" = "error",
  ) => out.push({ rule, sc: FORM_RULES[rule].sc, severity, subject, message, source: "lint" });
  const texts = idTexts(f);
  const groups = new Map(f.groups.map((g) => [g.id, g]));

  // Ids: duplicates, and the set that references may point at.
  const declared = [
    ...f.headings.map((h) => h.id),
    ...f.groups.map((g) => g.id),
    ...f.texts.map((t) => t.id),
    ...f.controls.map((c) => c.id),
  ];
  const seen = new Set<string>([f.id]);
  for (const id of declared) {
    if (seen.has(id)) add("id-duplicate", id, `the id "${id}" is used by more than one element`);
    seen.add(id);
  }
  const exists = new Set<string>([...seen, ...f.controls.flatMap((c) => c.errorId ?? [])]);

  // Headings.
  const title = nonEmpty(f.title);
  if (!f.headings.length && !title)
    add(
      "heading-missing",
      f.id,
      "the form has no heading and no title, so its purpose is not announced",
      "warning",
    );
  let prev = opts.parentHeadingLevel;
  for (const h of f.headings) {
    if (!nonEmpty(h.text)) add("heading-empty", h.id, `the h${h.level} has no text`);
    if (prev !== undefined && h.level > prev + 1)
      add("heading-skip", h.id, `h${h.level} follows h${prev}; heading levels must not skip`);
    prev = h.level;
  }

  // Groups.
  const members = new Map<string, FormControl[]>();
  for (const c of f.controls)
    if (c.group) members.set(c.group, [...(members.get(c.group) ?? []), c]);
  for (const g of f.groups) {
    for (const r of g.labelledBy ?? [])
      if (!exists.has(r))
        add(
          "labelledby-target-missing",
          g.id,
          `aria-labelledby names "${r}", which is not in the form`,
        );
    const legend = nonEmpty(g.legend) ? g.legend : fromRefs(g.labelledBy, texts);
    if (!legend) {
      const choice = (members.get(g.id) ?? []).some((c) => CHOICES.has(c.kind));
      add(
        "group-legend-missing",
        g.id,
        choice
          ? "the group of radio buttons or checkboxes has no legend"
          : "the group has no legend",
        choice ? "error" : "warning",
      );
    }
  }

  // Controls.
  const named: { c: FormControl; name: string }[] = [];
  const checkboxNames = new Map<string, number>();
  for (const c of f.controls)
    if (c.kind === "checkbox" && nonEmpty(c.name))
      checkboxNames.set(c.name, (checkboxNames.get(c.name) ?? 0) + 1);
  let hasSubmit = false;

  for (const c of f.controls) {
    if (c.kind === "hidden") continue;
    if (c.kind === "submit") hasSubmit = true;
    const button = BUTTONS.has(c.kind);

    // References.
    for (const r of c.labelledBy ?? [])
      if (!exists.has(r))
        add(
          "labelledby-target-missing",
          c.id,
          `aria-labelledby names "${r}", which is not in the form`,
        );
    for (const r of c.describedBy ?? [])
      if (!exists.has(r))
        add(
          "describedby-target-missing",
          c.id,
          `aria-describedby names "${r}", which is not in the form`,
        );
    if (c.errorMessage && !exists.has(c.errorMessage))
      add(
        "errormessage-target-missing",
        c.id,
        `aria-errormessage names "${c.errorMessage}", which is not in the form`,
      );

    // Name and label.
    const an = formControlName(c, f, texts);
    if (!an) {
      if (nonEmpty(c.placeholder))
        add(
          "label-placeholder-only",
          c.id,
          `the placeholder "${c.placeholder.trim()}" is the only label; it disappears on input`,
        );
      else add("name-missing", c.id, `the ${c.kind} control has no accessible name`);
    } else {
      named.push({ c, name: an.name });
      if (an.from === "aria-label" && !button && !nonEmpty(c.label))
        add(
          "label-not-visible",
          c.id,
          "the name comes only from aria-label; give the control a visible label",
          "warning",
        );
      if (
        an.from === "aria-label" &&
        nonEmpty(c.label) &&
        !norm(an.name).includes(norm(c.label).replace(/\s*\*$/, ""))
      )
        add(
          "label-in-name",
          c.id,
          `the aria-label "${an.name}" does not contain the visible label "${c.label.trim()}"`,
          "warning",
        );
    }

    // Errors.
    const shown = nonEmpty(c.errorText);
    if (shown || c.errorId) {
      if (!c.errorId)
        add(
          "error-not-associated",
          c.id,
          "the error message has no id, so the control cannot reference it",
        );
      else {
        const viaDescribed = (c.describedBy ?? []).includes(c.errorId);
        const viaErrorMessage = c.errorMessage === c.errorId && c.invalid === true;
        if (!viaDescribed && !viaErrorMessage)
          add(
            "error-not-associated",
            c.id,
            c.errorMessage === c.errorId
              ? `aria-errormessage "${c.errorId}" is exposed only while aria-invalid is true; set invalid or add it to aria-describedby`
              : `the error message "${c.errorId}" is not in aria-describedby or aria-errormessage`,
          );
      }
      if (shown && c.invalid !== true)
        add(
          "error-state-missing",
          c.id,
          "an error message is shown but the control is not marked aria-invalid",
          "warning",
        );
    }

    // Required.
    if (!button) {
      const visible = nonEmpty(c.label) ? c.label : fromRefs(c.labelledBy, texts);
      const marked = REQUIRED_MARK.test(visible);
      if (marked && c.required !== true)
        add(
          "required-not-programmatic",
          c.id,
          "the label marks the control required but it has no required or aria-required",
        );
      if (c.required === true && !marked && c.requiredIndicator !== true)
        add(
          "required-not-visible",
          c.id,
          "the control is required but nothing visible says so",
          "warning",
        );
    }

    // Focus order.
    if (c.tabIndex !== undefined && c.tabIndex > 0)
      add(
        "tabindex-positive",
        c.id,
        `tabindex ${c.tabIndex} overrides the DOM order; use 0 or omit it and order the DOM instead`,
      );
    if (c.tabIndex !== undefined && c.tabIndex < 0)
      add(
        "tabindex-removed",
        c.id,
        `tabindex ${c.tabIndex} removes the control from the Tab sequence`,
        "warning",
      );

    // Groups.
    if (c.group && !groups.has(c.group))
      add(
        "group-unknown",
        c.id,
        `the control names the group "${c.group}", which is not in the form`,
      );
    if (!c.group && c.kind === "radio")
      add("group-missing", c.id, "the radio button is not inside a group with a legend");
    if (!c.group && c.kind === "checkbox" && nonEmpty(c.name) && checkboxNames.get(c.name)! > 1)
      add(
        "group-missing",
        c.id,
        `the checkbox is one of a set named "${c.name}" that is not inside a group with a legend`,
      );

    // Input purpose.
    // An empty attribute is the default state, as if it were absent.
    if (nonEmpty(c.autocomplete) && !isValidAutocomplete(c.autocomplete))
      add(
        "autocomplete-invalid",
        c.id,
        `autocomplete "${c.autocomplete}" is not a token list from the HTML specification`,
      );
    else if (PURPOSE_KINDS.has(c.kind) && c.personalData !== false) {
      const token = c.autocomplete?.trim().toLowerCase();
      const noPurpose = token === undefined || token === "" || token === "on" || token === "off";
      if (noPurpose) {
        const implied = IMPLIED_PURPOSE[c.kind];
        const hint = PURPOSE_HINTS.find(([re]) => re.test(an?.name ?? c.placeholder ?? ""))?.[1];
        const what = token
          ? `autocomplete "${token}" names no purpose`
          : "there is no autocomplete";
        if (c.personalData === true || implied)
          add(
            "autocomplete-missing",
            c.id,
            `the control collects personal data but ${what}; use ${implied ?? hint ?? "the token for its purpose"}`,
          );
        else if (hint)
          add(
            "autocomplete-missing",
            c.id,
            `the label suggests personal data but ${what}; use "${hint}" or set personalData: false`,
            "warning",
          );
      }
    }
  }

  // Unique names: a duplicate is allowed only between different groups with distinct legends.
  const legendOf = (c: FormControl) => {
    const g = c.group ? groups.get(c.group) : undefined;
    if (!g) return "";
    return norm(nonEmpty(g.legend) ? g.legend : fromRefs(g.labelledBy, texts));
  };
  for (let i = 1; i < named.length; i++) {
    const a = named[i]!;
    const clash = named.slice(0, i).find((b) => {
      if (norm(b.name) !== norm(a.name)) return false;
      const la = legendOf(a.c);
      const lb = legendOf(b.c);
      return !(a.c.group && b.c.group && a.c.group !== b.c.group && la && lb && la !== lb);
    });
    if (clash)
      add(
        "name-duplicate",
        a.c.id,
        `the accessible name "${a.name}" is also the name of ${clash.c.id}`,
      );
  }

  if (!hasSubmit) add("submit-missing", f.id, "the form has no submit button", "warning");

  return sortFindings(out, [
    f.id,
    ...f.headings.map((h) => h.id),
    ...f.groups.map((g) => g.id),
    ...f.controls.map((c) => c.id),
  ]);
}

/**
 * Orders findings by the position of their subject in `order` (subjects not in it come last, by
 * name), then by rule id and message.
 */
export function sortFindings(
  findings: readonly FormFinding[],
  order: readonly string[] = [],
): FormFinding[] {
  const rank = new Map<string, number>();
  order.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i);
  });
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...findings].sort(
    (a, b) =>
      (rank.get(a.subject) ?? order.length) - (rank.get(b.subject) ?? order.length) ||
      cmp(a.subject, b.subject) ||
      cmp(a.rule, b.rule) ||
      cmp(a.message, b.message),
  );
}
