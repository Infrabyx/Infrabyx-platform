// Server-rendered output of the shared components (IPB-06 §06.3.2, IPB-07-26, IPB-04 §04.3.8).
// Browser checks (axe, HTML_CodeSniffer, reflow, focus) run against the gallery in the a11y gate.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AppShell,
  BarChart,
  Breadcrumb,
  CheckboxField,
  ClickToLoad,
  copyrightLine,
  DataTable,
  embedUrl,
  entityLine,
  ErrorMessage,
  Field,
  Footer,
  Header,
  HelpButton,
  messages,
  pageTitle,
} from "../index.js";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const nav = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ label: `Item ${i}`, href: `/i${i}` }));

describe("shell", () => {
  it("puts skip links first, one main landmark, and labels the navigation", () => {
    const out = html(
      <AppShell
        header={<Header brand={{ name: "Example", href: "/" }} nav={nav(3)} />}
        footer={<footer>f</footer>}
      >
        <h1>Hello</h1>
      </AppShell>,
    );
    expect(out.indexOf('href="#main"')).toBeLessThan(out.indexOf("<header"));
    expect(out.match(/<main/g)).toHaveLength(1);
    expect(out).toContain('id="navigation"');
    expect(out).toContain('aria-label="Main"');
    expect(out).not.toMatch(/style="/);
  });

  it("@IPB-07-AT-12 refuses more than seven top-level nav items (IPB-07-05, IPB-UX-002)", () => {
    expect(() => html(<Header brand={{ name: "x", href: "/" }} nav={nav(8)} />)).toThrow(
      /IPB-UX-002/,
    );
  });

  it("marks the current page in the breadcrumb and builds the title pattern", () => {
    const out = html(
      <Breadcrumb
        items={[
          { label: "Home", href: "/" },
          { label: "Careers", href: "/careers" },
        ]}
      />,
    );
    expect(out).toContain('<span aria-current="page">Careers</span>');
    expect(pageTitle("Careers", "Infrabyx")).toBe("Careers · Infrabyx");
    expect(pageTitle("Privacy Notice", "Infrabyx", "Policies")).toBe(
      "Privacy Notice · Policies · Infrabyx",
    );
  });
});

describe("footer (IPB-04 §04.3.8)", () => {
  const props = {
    brand: { name: "Example Group", href: "/" },
    groupLink: {
      label: "Part of the Infrabyx Group",
      href: "https://group.example.org",
      external: true,
    },
    columns: [{ heading: "Company", links: [{ label: "About", href: "/about" }] }],
    contact: {
      registeredOffice: ["1 Example Road", "New Delhi 110001"],
      phone: "+91 00000 00000",
      email: "hello@example.org",
    },
    entityLine: entityLine({
      name: "Example Group Private Limited",
      cin: "U00000DL2026PTC000000",
      gstin: null,
    }),
    officers: [
      {
        role: "Grievance Officer",
        name: "A. Officer",
        email: "grievance@example.org",
        href: "/grievance",
      },
      {
        role: "Data Protection Officer",
        name: "A. Officer",
        email: "dpo@example.org",
        href: "/legal/privacy#clause-1",
      },
    ],
    social: [{ network: "LinkedIn", href: "https://www.linkedin.com/company/example" }],
    utilities: [
      { label: "Cookie settings", href: "/cookie-settings" },
      { label: "Accessibility", href: "/accessibility" },
    ],
    copyright: copyrightLine("Example Group Private Limited", new Date("2026-10-27T00:00:00Z")),
  };

  it("renders the entity and officers lines as text, with headed columns in a footer landmark", () => {
    const out = html(<Footer {...props} />);
    expect(out).toContain('aria-label="Footer"');
    expect(out).toContain("<h2");
    expect(out).toContain("Example Group Private Limited · CIN U00000DL2026PTC000000");
    expect(out).toContain("Grievance Officer</a>: A. Officer");
    expect(out).toContain("© 2026 Example Group Private Limited. All rights reserved.");
    expect(out).toContain("(opens in new tab)");
  });

  it("leaves out GSTIN only when the entity has none", () => {
    expect(entityLine({ name: "X Pvt Ltd", cin: "C1", gstin: "G1" })).toBe(
      "X Pvt Ltd · CIN C1 · GSTIN G1",
    );
  });
});

describe("forms (IPB-07-26, 07-42)", () => {
  it("links label, hint and error, marks invalid, and carries the help key", () => {
    const out = html(
      <Field
        id="email"
        label="Work email"
        helpKey="hlp.web.work_email"
        type="email"
        autoComplete="email"
        required
        error="Enter an email address like name@example.org"
        hint="We reply within two working days"
      />,
    );
    expect(out).toContain('for="email"');
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('aria-describedby="email-hint email-error"');
    // HTML attribute names are case-insensitive; React writes `autoComplete`.
    expect(out.toLowerCase()).toContain('autocomplete="email"');
    expect(out).toContain('data-help-key="hlp.web.work_email"');
  });

  it("never pre-ticks a consent checkbox", () => {
    const out = html(
      <CheckboxField id="consent" label="Email me updates" helpKey="hlp.consent.marketing_email" />,
    );
    expect(out).not.toContain("checked");
  });

  it("@IPB-07-AT-23 shows the four parts of an error and its code", () => {
    const out = html(
      <ErrorMessage
        code="IPB-WEB-002"
        whatHappened="We could not send your message."
        why="The consent box was not ticked."
        whatToDo="Tick the box to let us reply, then send again."
        helpKey="hlp.web.consent_required"
        correlationId="4bf92f35"
      />,
    );
    for (const part of [
      "We could not send your message.",
      "The consent box was not ticked.",
      "Tick the box",
      "Reference IPB-WEB-002",
      "4bf92f35",
    ])
      expect(out).toContain(part);
    expect(out).toContain('role="alert"');
  });
});

describe("help popover (IPB-07-44)", () => {
  it("@IPB-07-AT-14 names the button after the label and uses the native popover", () => {
    const out = html(
      <HelpButton
        label="CIN"
        entry={{ key: "hlp.web.cin", term: "CIN", plain: "The company's registration number." }}
      />,
    );
    expect(out).toContain('aria-label="Help: CIN"');
    expect(out.toLowerCase()).toContain('popovertarget="help-hlp-web-cin"');
    expect(out).toContain('popover="auto"');
  });

  it("translates the labels in Hindi", () => {
    const out = html(
      <HelpButton
        t={messages("hi-IN")}
        label="CIN"
        entry={{ key: "hlp.web.cin", term: "CIN", plain: "x" }}
      />,
    );
    expect(out).toContain("सहायता: CIN");
  });
});

describe("data (IPB-06-24, 06-25)", () => {
  it("captions the table, scopes headers and offers a chart as a table", () => {
    const table = html(
      <DataTable
        caption="Offices"
        columns={[
          { key: "city", header: "City", rowHeader: true },
          { key: "hours", header: "Hours" },
        ]}
        rows={[{ city: "Delhi", hours: "10:00–18:00" }]}
      />,
    );
    expect(table).toContain("<caption>Offices</caption>");
    expect(table).toContain('scope="col"');
    expect(table).toContain('scope="row"');
    const chart = html(
      <BarChart
        id="c1"
        title="Requests"
        summary="Delhi had the most requests."
        data={[{ label: "Delhi", value: 3 }]}
      />,
    );
    expect(chart).toContain('role="img"');
    expect(chart).toContain('aria-describedby="c1-summary"');
    expect(chart).toContain("View as table");
  });
});

describe("click-to-load (IPB-04-54)", () => {
  it("renders no provider request: the iframe stays inside a template", () => {
    const out = html(
      <ClickToLoad
        id="v1"
        provider="youtube"
        providerName="YouTube"
        videoId="abcdEFGH123"
        title="How the group works"
      />,
    );
    const outsideTemplate = out.replace(/<template[\s\S]*?<\/template>/g, "");
    expect(outsideTemplate).not.toContain("youtube");
    expect(out).toContain("www.youtube-nocookie.com/embed/abcdEFGH123");
    expect(out).toContain("Loads content from YouTube");
    expect(embedUrl("vimeo", "12345678")).toContain("dnt=1");
    expect(() => embedUrl("youtube", 'x"><script>')).toThrow();
  });
});
