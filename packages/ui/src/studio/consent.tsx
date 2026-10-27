// Consent texts (IPB-04 §04.3.12 section 12; IPB-05 template 18): every banner, notice and
// category text by region and locale. The DPO drafts a version; the legal reviewer approves it,
// never the same person (the service checks both).
import { Button, CheckboxField, Field, SelectField } from "../components/forms.js";
import { DataTable } from "../components/data.js";
import { oneOf, required, run, text } from "./form.js";
import { errorFor, Hidden, StatusBadge, StudioPage, StudioSectionBox } from "./layout.js";
import type { FormAction, ScreenProps, StudioResult } from "./types.js";

export interface StudioConsentText {
  id: string;
  key: string;
  version: string;
  locale: string;
  region: string;
  body: string;
  state: string;
}

export interface ConsentTextReader<C> {
  list(ctx: C): Promise<StudioConsentText[]>;
}

export interface ConsentTextWriter<C> {
  draft(
    ctx: C,
    t: { key: string; body: string; locale?: string; region?: string; major?: boolean },
  ): Promise<StudioConsentText>;
  approve(ctx: C, id: string): Promise<StudioConsentText>;
}

const REGIONS = ["IN", "EU", "US-CA"] as const;
const excerpt = (s: string) => (s.length > 120 ? `${s.slice(0, 117)}…` : s);

export async function ConsentTextsScreen<C>(
  p: ScreenProps<C> & {
    texts: ConsentTextReader<C>;
    actions: { draft: FormAction; approve: FormAction };
  },
) {
  const texts = await p.texts.list(p.ctx);
  const err = (id: string) => errorFor(p.errors, id);
  return (
    <StudioPage
      sections={p.sections}
      base={p.base}
      section="consent"
      title="Consent texts"
      flash={p.flash}
      errors={p.errors}
    >
      <DataTable
        caption={`Consent texts: ${texts.length}`}
        columns={[
          { key: "key", header: "Text", rowHeader: true },
          { key: "where", header: "Region and language" },
          { key: "version", header: "Version" },
          { key: "state", header: "State" },
          { key: "body", header: "Wording" },
          { key: "action", header: "Action" },
        ]}
        rows={texts.map((t) => ({
          key: t.key,
          where: `${t.region}, ${t.locale}`,
          version: t.version,
          state: <StatusBadge status={t.state} />,
          body: excerpt(t.body),
          action:
            t.state === "draft" ? (
              <form method="post" action={p.actions.approve}>
                <Hidden values={{ id: t.id }} />
                <Button type="submit" variant="ghost">
                  Approve {t.key} {t.version}
                </Button>
              </form>
            ) : (
              "—"
            ),
        }))}
      />
      <StudioSectionBox id="new-text" title="Draft a new version">
        <form method="post" action={p.actions.draft} noValidate>
          <Field
            id="f-key"
            name="key"
            label="Text key"
            helpKey="hlp.studio.consent_key"
            hint="For example consent.cookie.banner."
            required
            error={err("f-key")}
          />
          <SelectField
            id="f-region"
            name="region"
            label="Region"
            helpKey="hlp.studio.consent_region"
            options={REGIONS.map((r) => ({ value: r, label: r }))}
          />
          <Field
            id="f-locale"
            name="locale"
            label="Language"
            helpKey="hlp.studio.consent_locale"
            defaultValue="en-IN"
          />
          <Field
            id="f-body"
            name="body"
            label="Wording"
            helpKey="hlp.studio.consent_body"
            multiline
            required
            error={err("f-body")}
          />
          <CheckboxField
            id="f-major"
            name="major"
            label="A major change (people are asked again)"
            helpKey="hlp.studio.consent_major"
          />
          <Button type="submit" variant="primary">
            Draft the version
          </Button>
        </form>
      </StudioSectionBox>
    </StudioPage>
  );
}

export function consentTextHandlers<C>(texts: ConsentTextWriter<C>) {
  return {
    async draft(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(async () => {
        const t = await texts.draft(ctx, {
          key: required(fd, "key", "the text key"),
          body: required(fd, "body", "the wording"),
          locale: text(fd, "locale") ?? "en-IN",
          region: oneOf(fd, "region", REGIONS),
          major: fd.get("major") === "yes",
        });
        return {
          flash: {
            tone: "success",
            title: `Version ${t.version} drafted`,
            detail: "The legal reviewer approves it before it is shown.",
          },
        };
      });
    },
    async approve(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(async () => {
        const t = await texts.approve(ctx, required(fd, "id", "a text"));
        return { flash: { tone: "success", title: `${t.key} ${t.version} approved` } };
      });
    },
  };
}
