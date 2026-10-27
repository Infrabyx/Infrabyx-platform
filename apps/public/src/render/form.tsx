// A CMS form (contact, careers) rendered server-side (IPB-04 §04.3.1 form block; IPB-06 SC 3.3.x).
// It posts to `/api/forms/<id>` and works without JavaScript. The consent box shows the exact
// consent text and is never ticked in advance; a honeypot field sits outside the visible form.
import { HONEYPOT_FIELD } from "@infrabyx/cms";
import { Button, CheckboxField, ErrorSummary, Field } from "@infrabyx/ui";
import type { FormDefinition } from "./blocks.tsx";

/** Help keys of the site's form fields (literals, so `hlp-lint` checks each one). */
const FIELD_HELP: Readonly<Record<string, string>> = {
  full_name: "hlp.web.field.full_name",
  email: "hlp.web.field.email",
  organisation: "hlp.web.field.organisation",
  message: "hlp.web.field.message",
};
const OTHER_HELP = "hlp.web.field.other";

const FIELD_TYPES = new Set(["text", "email", "tel"]);

export function FormBlock({
  form,
  errors,
  headingLevel,
}: {
  form: FormDefinition;
  errors: readonly { fieldId: string; message: string }[];
  headingLevel: 2 | 3;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  const err = (name: string) => errors.find((e) => e.fieldId === `f-${name}`)?.message;
  const titleId = `form-${form.id}-title`;
  return (
    <section className="ibx-form" aria-labelledby={titleId}>
      <H id={titleId}>{form.title}</H>
      <form method="post" action={`/api/forms/${form.id}`} noValidate>
        <ErrorSummary errors={errors} />
        {form.body.fields.map((f) =>
          f.kind === "checkbox" ? (
            <CheckboxField
              key={f.name}
              id={`f-${f.name}`}
              name={f.name}
              label={f.label}
              helpKey={FIELD_HELP[f.name] ?? OTHER_HELP}
              {...(f.required ? { required: true } : {})}
              {...(err(f.name) ? { error: err(f.name)! } : {})}
            />
          ) : (
            <Field
              key={f.name}
              id={`f-${f.name}`}
              name={f.name}
              label={f.label}
              helpKey={FIELD_HELP[f.name] ?? OTHER_HELP}
              {...(FIELD_TYPES.has(f.kind) ? { type: f.kind as "text" | "email" | "tel" } : {})}
              {...(f.kind === "textarea" ? { multiline: true, maxLength: 5000 } : {})}
              {...(f.autocomplete ? { autoComplete: f.autocomplete } : {})}
              {...(f.required ? { required: true } : {})}
              {...(err(f.name) ? { error: err(f.name)! } : {})}
            />
          ),
        )}
        <CheckboxField
          id="f-consent"
          name="consent"
          label={form.consentText}
          helpKey="hlp.web.consent_notice"
          required
          {...(err("consent") ? { error: err("consent")! } : {})}
        />
        <div className="ibx-honeypot" aria-hidden="true">
          <label htmlFor={`f-${HONEYPOT_FIELD}`}>Leave this field empty</label>
          <input
            id={`f-${HONEYPOT_FIELD}`}
            name={HONEYPOT_FIELD}
            tabIndex={-1}
            autoComplete="off"
          />
        </div>
        <Button type="submit" variant="primary">
          Send
        </Button>
      </form>
    </section>
  );
}
