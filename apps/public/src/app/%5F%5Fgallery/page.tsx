// `/__gallery` (OWNER-QUESTIONS #45, PL5 plan §11 item 5): every `@infrabyx/ui` component, the CMP and
// the feedback forms on one page, so the accessibility gate scans them in place of Storybook. Not
// linked and not indexed.
import type { Metadata } from "next";
import { PreferenceCentre } from "@infrabyx/consent";
import { AccessibilityReportForm, FeedbackForm, FeedbackTrigger } from "@infrabyx/feedback";
import {
  AiLabel,
  BarChart,
  Breadcrumb,
  Button,
  ButtonLink,
  CheckboxField,
  ClickToLoad,
  ColumnChooser,
  CommandPalette,
  DataTable,
  EmptyState,
  ErrorMessage,
  ErrorState,
  ErrorSummary,
  Field,
  HelpButton,
  KeyboardMap,
  LiveRegion,
  Notice,
  PermissionDenied,
  SavedViewPicker,
  Skeleton,
  WorkspaceSwitcher,
} from "@infrabyx/ui";
import { requestContext } from "../../server/request.ts";

export const metadata: Metadata = {
  title: "Component gallery",
  robots: { index: false, follow: false },
};

const gstin = {
  key: "hlp.web.gstin",
  term: "GSTIN",
  plain:
    "The Goods and Services Tax Identification Number of a business registered for GST in India.",
};
const help = {
  key: "hlp.web.cin",
  term: "CIN",
  plain:
    "The Corporate Identity Number the Registrar of Companies gives every company registered in India.",
};

export default async function Gallery() {
  const ctx = await requestContext();
  return (
    <div className="ibx-page ibx-gallery">
      <h1>Component gallery</h1>
      <section aria-labelledby="g-nav">
        <h2 id="g-nav">Navigation</h2>
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: "Gallery", href: "/__gallery" },
          ]}
        />
      </section>
      <section aria-labelledby="g-buttons">
        <h2 id="g-buttons">Buttons and links</h2>
        <p>
          <Button variant="primary">Primary</Button> <Button>Secondary</Button>{" "}
          <Button variant="danger">Danger</Button> <Button variant="ghost">Ghost</Button>{" "}
          <Button disabled>Disabled</Button>
        </p>
        <p>
          <ButtonLink href="/contact" variant="primary">
            Contact us
          </ButtonLink>
        </p>
      </section>
      <section aria-labelledby="g-forms">
        <h2 id="g-forms">Form fields</h2>
        <form method="get" action="/__gallery">
          <ErrorSummary errors={[{ fieldId: "g-email", message: "Enter an email address" }]} />
          <Field
            id="g-name"
            label="Your name"
            helpKey="hlp.web.field.full_name"
            autoComplete="name"
            required
          />
          <Field
            id="g-email"
            label="Email address"
            helpKey="hlp.web.field.email"
            type="email"
            autoComplete="email"
            error="Enter an email address"
          />
          <Field id="g-cin" label="CIN" helpKey="hlp.web.cin" help={help} hint="21 characters" />
          <Field id="g-msg" label="Your message" helpKey="hlp.web.field.message" multiline />
          <CheckboxField
            id="g-ok"
            label="I agree to be contacted about this message"
            helpKey="hlp.web.consent_notice"
          />
          <Button type="submit">Send</Button>
        </form>
        <p>
          Help for the GSTIN: <HelpButton entry={gstin} label="GSTIN" />
        </p>
      </section>
      <section aria-labelledby="g-status">
        <h2 id="g-status">Status</h2>
        <Notice tone="success" title="Saved">
          <p>Your choices are saved.</p>
        </Notice>
        <Notice tone="warning" title="Check this">
          <p>A warning with its text.</p>
        </Notice>
        <Notice tone="danger" title="Something went wrong">
          <p>An error with what to do next.</p>
        </Notice>
        <Notice tone="info" title="For your information" />
        <ErrorMessage
          code="IPB-PORT-002"
          whatHappened="We could not send your message."
          why="A service we rely on is not answering."
          whatToDo="Try again in a few minutes."
          helpKey="hlp.int.adapter_unavailable"
        />
        <LiveRegion>Three results</LiveRegion>
        <p>
          <AiLabel />
        </p>
      </section>
      <section aria-labelledby="g-data">
        <h2 id="g-data">Data</h2>
        <DataTable
          caption="Offices"
          columns={[
            { key: "city", header: "City", rowHeader: true },
            { key: "pin", header: "PIN", numeric: true },
          ]}
          rows={[
            { city: "Delhi", pin: "110001" },
            { city: "Jaipur", pin: "302001" },
          ]}
        />
        <BarChart
          id="g-chart"
          title="Example chart"
          summary="Two example bars; A is twice B."
          data={[
            { label: "A", value: 2 },
            { label: "B", value: 1 },
          ]}
        />
      </section>
      <section aria-labelledby="g-shell">
        <h2 id="g-shell">Application shell</h2>
        <WorkspaceSwitcher
          assigned={[
            { key: "M", label: "Management", href: "/__gallery" },
            { key: "N", label: "Tenant administration", href: "/__gallery" },
          ]}
          current={{ key: "N", label: "Tenant administration", href: "/__gallery" }}
        />
        <CommandPalette
          action="/__gallery"
          result={{
            status: "ok",
            groups: [{ id: "pages", label: "Pages", hits: [{ label: "Offices", href: "/" }] }],
            failed: [],
          }}
          query="off"
        />
        <SavedViewPicker
          personal={[{ id: "v1", name: "My offices", href: "/__gallery", isDefault: true }]}
          shared={[{ id: "v2", name: "All offices", href: "/__gallery" }]}
          currentId="v1"
          saveAction="/__gallery"
        />
        <ColumnChooser
          action="/__gallery"
          columns={[
            { key: "city", header: "City", rowHeader: true },
            { key: "pin", header: "PIN" },
            { key: "phone", header: "Phone" },
          ]}
          visible={["pin"]}
        />
        <EmptyState
          purpose="Offices you add appear here."
          action={{ label: "Add an office", href: "/__gallery" }}
          tutorial={{ label: "How offices work", href: "/__gallery" }}
        />
        <Skeleton rows={2} />
        <ErrorState
          whatFailed="The office list could not be loaded."
          saved="nothing_to_save"
          correlationId="trc_gallery"
          retry={{ label: "Try again", href: "/__gallery" }}
        />
        <PermissionDenied
          code="IPB-SEC-005"
          reason="Offices are open to administrators."
          fix={{ label: "Ask an administrator", href: "/__gallery" }}
        />
        <KeyboardMap
          groups={[{ id: "global", label: "Global shortcuts" }]}
          shortcuts={[{ id: "palette", label: "Open search", combo: "Ctrl+K", group: "global" }]}
        />
      </section>
      <section aria-labelledby="g-media">
        <h2 id="g-media">Media</h2>
        <ClickToLoad
          id="g-video"
          provider="youtube"
          providerName="YouTube"
          videoId="example01"
          title="An example video"
        />
      </section>
      <section aria-labelledby="g-consent">
        <h2 id="g-consent">Consent</h2>
        {/* The banner itself is on every page until a choice is made (scanned on every route). */}
        <PreferenceCentre state={{ ...ctx.consent, show: true }} texts={ctx.cmpTexts} />
      </section>
      <section aria-labelledby="g-feedback">
        <h2 id="g-feedback">Feedback</h2>
        <FeedbackTrigger />
        <FeedbackForm route="/__gallery" />
        <AccessibilityReportForm route="/__gallery" />
      </section>
    </div>
  );
}
