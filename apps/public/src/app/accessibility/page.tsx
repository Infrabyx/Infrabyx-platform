// The accessibility statement and the report form (IPB-06-19, 06-61, 06-62; PL5 plan §9.2). The
// statement names the standard, how the site is tested, the known issues and the response times;
// the report form posts to the feedback endpoint as an accessibility item with its SLA.
import type { Metadata } from "next";
import { AccessibilityReportForm } from "@infrabyx/feedback";
import { AppPage } from "../../render/page.tsx";

export const metadata: Metadata = { title: "Accessibility" };

export default function Accessibility() {
  return (
    <AppPage title="Accessibility" path="/accessibility">
      <section aria-labelledby="standard">
        <h2 id="standard">Our standard</h2>
        <p>
          We aim for this site to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level
          AA.
        </p>
      </section>
      <section aria-labelledby="testing">
        <h2 id="testing">How we test</h2>
        <ul>
          <li>
            Every page is checked with axe and HTML_CodeSniffer, in light and dark themes, on every
            change.
          </li>
          <li>
            We check that pages reflow at 320 pixels, work at 200% text size and work without
            JavaScript.
          </li>
          <li>People test the main journeys with screen readers before each release.</li>
        </ul>
      </section>
      <section aria-labelledby="known">
        <h2 id="known">Known issues</h2>
        <p>Hindi pages are not available yet. We will add them and update this statement.</p>
      </section>
      <section aria-labelledby="report">
        <h2 id="report">Report an accessibility problem</h2>
        <p>
          We acknowledge every report within 24 hours. If a problem stops you completing a task,
          tick the box below and we treat it first.
        </p>
        <AccessibilityReportForm route="/accessibility" />
      </section>
    </AppPage>
  );
}
