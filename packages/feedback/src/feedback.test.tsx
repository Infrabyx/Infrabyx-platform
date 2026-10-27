// Unit tests: payload minimisation (`@IPB-04-AT-91`), the widget's presence and markup
// (`@IPB-04-AT-90`, IPB-04-98), the SLA timer rules (IPB-06-62) and the HTTP handler.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AccessibilityReportForm,
  addBusinessDay,
  FeedbackDialog,
  FeedbackForm,
  FeedbackStatusView,
  FeedbackTrigger,
  FEEDBACK_CONTROLLER_JS,
  handleFeedbackPost,
  missedTimers,
  parseFeedback,
  piiKinds,
  routePattern,
  uaFamilies,
  type FeedbackService,
} from "./index.js";

const code = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};

describe("@IPB-04-AT-91 payload minimisation", () => {
  it("refuses page HTML, form values, screenshots and unknown fields whole", () => {
    for (const extra of [
      { page_html: "<main>…</main>" },
      { form_values: { pan: "x" } },
      { screenshot: "data:image/png;base64,AAAA" },
      { url: "https://example.org/x?y=1" },
      { anything_else: "x" },
    ])
      expect(code(() => parseFeedback({ type: "bug", summary: "Broken", ...extra }))).toBe(
        "IPB-FB-001",
      );
  });

  it("refuses a full URL or a query string in the route and reduces ids to :id", () => {
    expect(code(() => routePattern("https://example.org/a?b=1"))).toBe("IPB-FB-001");
    expect(code(() => routePattern("/loans?id=7"))).toBe("IPB-FB-001");
    expect(code(() => routePattern("//evil.example/x"))).toBe("IPB-FB-001");
    expect(routePattern("/loans/lon_01JB0000000000000000000001/kfs")).toBe("/loans/:id/kfs");
    expect(routePattern("/docs/[id]/edit")).toBe("/docs/[id]/edit");
    expect(routePattern("/orders/123456")).toBe("/orders/:id");
    expect(routePattern("/help/getting-started")).toBe("/help/getting-started");
  });

  it("refuses personal numbers and secrets in the text, naming the kind and never the value", () => {
    expect(piiKinds("My PAN is ABCPE1234F")).toEqual(["PAN"]);
    const e = (() => {
      try {
        parseFeedback({ type: "bug", summary: "Call me on 9876543210" });
      } catch (x) {
        return x as { code: string; detail: string };
      }
    })();
    expect(e?.code).toBe("IPB-FB-001");
    expect(e?.detail).toContain("MOBILE");
    expect(e?.detail).not.toContain("9876543210");
  });

  it("keeps only the families from a user agent", () => {
    expect(
      uaFamilies(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
      ),
    ).toEqual({ os: "Android", browser: "Chrome" });
    expect(uaFamilies(undefined)).toEqual({ os: null, browser: null });
  });

  it("pairs the score with the NPS type only", () => {
    expect(code(() => parseFeedback({ type: "nps", summary: "ok" }))).toBe("IPB-FB-001");
    expect(code(() => parseFeedback({ type: "bug", summary: "x", nps_score: 3 }))).toBe(
      "IPB-FB-001",
    );
    expect(parseFeedback({ type: "nps", summary: "ok", nps_score: "9" }).nps_score).toBe(9);
  });
});

describe("@IPB-04-AT-90 widget presence and accessibility (IPB-04-98)", () => {
  it("renders a keyboard-reachable link trigger that works without JavaScript", () => {
    const html = renderToStaticMarkup(<FeedbackTrigger floating />);
    expect(html).toMatch(/<a class="ibx-fb-trigger" href="\/feedback"[^>]*>Report a problem<\/a>/);
    expect(html).toContain("ibx-fb-float");
    expect(html).not.toContain("tabindex");
  });

  it("never offers the score question unless it is due", () => {
    expect(renderToStaticMarkup(<FeedbackForm />)).not.toContain('value="nps"');
    expect(renderToStaticMarkup(<FeedbackForm npsDue />)).toContain('value="nps"');
  });

  it("labels every field, links errors and keeps the honeypot out of the tab order", () => {
    const html = renderToStaticMarkup(
      <FeedbackForm
        route="/loans/:id"
        errors={[{ fieldId: "ibx-fb-summary", message: "remove personal details" }]}
      />,
    );
    expect(html).toContain('<label class="ibx-field__label" for="ibx-fb-summary">');
    expect(html).toContain('aria-describedby="ibx-fb-summary-hint ibx-fb-summary-error"');
    expect(html).toMatch(
      /name="website_url"[^>]*tabindex="-1"|tabindex="-1"[^>]*name="website_url"/i,
    );
    expect(html).toContain('name="route" value="/loans/:id"');
    expect(html).not.toMatch(/checked=""[^>]*name="contact_ok"/);
  });

  it("opens the same form in a labelled modal dialog", () => {
    const html = renderToStaticMarkup(<FeedbackDialog />);
    expect(html).toContain(
      '<dialog class="ibx-fb-dialog" id="ibx-fb-dialog" aria-labelledby="ibx-fb-dialog-title">',
    );
    expect(FEEDBACK_CONTROLLER_JS).toContain("showModal");
    expect(FEEDBACK_CONTROLLER_JS).not.toContain("cookie");
    expect(FEEDBACK_CONTROLLER_JS).not.toContain("localStorage");
  });

  it("asks the IPB-06-61 questions on the accessibility form with no CAPTCHA", () => {
    const html = renderToStaticMarkup(<AccessibilityReportForm route="/account" />);
    for (const name of ["route", "assistive_tech", "summary", "expected", "blocking"])
      expect(html).toContain(`name="${name}"`);
    expect(html).toContain('name="type" value="accessibility"');
    expect(html.toLowerCase()).not.toContain("captcha");
  });

  it("shows the reference and the status", () => {
    const html = renderToStaticMarkup(
      <FeedbackStatusView
        view={{
          id: "fbk_01JB0000000000000000000001",
          type: "bug",
          status: "shipped",
          submittedAt: "2026-10-01T00:00:00.000Z",
          statusChangedAt: "2026-10-05T00:00:00.000Z",
          history: [
            { status: "received", at: "2026-10-01T00:00:00.000Z", note: null },
            { status: "shipped", at: "2026-10-05T00:00:00.000Z", note: "Fixed in 1.4" },
          ],
        }}
      />,
    );
    expect(html).toContain("fbk_01JB0000000000000000000001");
    expect(html).toContain('data-fb-status="shipped"');
  });
});

describe("IPB-06-62 SLA timers", () => {
  const at = (s: string) => new Date(s);
  const row = {
    id: "fbk_x",
    tenant_id: "tnt_a",
    ack_due_at: at("2026-10-02T10:00:00Z"),
    interim_due_at: at("2026-10-02T10:00:00Z"),
    workaround_due_at: at("2026-10-06T10:00:00Z"),
    fix_due_at: at("2026-10-31T10:00:00Z"),
    acknowledged_at: null,
    workaround_at: null,
    sla_breaches: [] as string[],
  };

  it("reports each missed timer once and none that were met", () => {
    expect(missedTimers(row, at("2026-10-01T12:00:00Z"))).toEqual([]);
    expect(missedTimers(row, at("2026-10-03T00:00:00Z")).map((t) => t.timer)).toEqual([
      "ack",
      "interim",
    ]);
    expect(
      missedTimers(
        { ...row, acknowledged_at: at("2026-10-01T13:00:00Z"), sla_breaches: ["interim"] },
        at("2026-11-01T00:00:00Z"),
      ).map((t) => t.timer),
    ).toEqual(["workaround", "fix"]);
  });

  it("puts the interim path on the next business day", () => {
    expect(addBusinessDay(at("2026-10-30T09:00:00Z")).toISOString()).toBe(
      "2026-11-02T09:00:00.000Z",
    );
    expect(addBusinessDay(at("2026-10-27T09:00:00Z")).toISOString()).toBe(
      "2026-10-28T09:00:00.000Z",
    );
  });
});

describe("handleFeedbackPost", () => {
  const fake = (result: unknown) =>
    ({
      submit: async (body: Record<string, unknown>) => {
        if (result instanceof Error) throw result;
        (fake as unknown as { last: unknown }).last = body;
        return result;
      },
    }) as unknown as FeedbackService;
  const submitter = { tenantId: "tnt_platform", cid: "AbCdEfGhIjKlMnOpQrSt", clientKey: "k" };

  it("refuses a form without a valid CSRF token", async () => {
    const r = await handleFeedbackPost(fake(null), {
      body: {},
      csrfOk: false,
      mode: "form",
      submitter,
    });
    expect(r.status).toBe(403);
  });

  it("redirects a form post to the status link and answers JSON with the reference", async () => {
    const ok = {
      id: "fbk_01JB0000000000000000000001",
      reference: "fbk_01JB0000000000000000000001",
      viewKey: "k3y",
      ohRef: null,
      status: "received",
    };
    const form = await handleFeedbackPost(fake(ok), {
      body: { type: "bug", summary: "x", nps_score: "4", csrf: "t" },
      csrfOk: true,
      mode: "form",
      submitter,
    });
    expect(form).toEqual({
      status: 303,
      location: "/feedback/status/fbk_01JB0000000000000000000001?key=k3y",
    });
    expect((fake as unknown as { last: Record<string, unknown> }).last).toEqual({
      type: "bug",
      summary: "x",
    });
    const json = await handleFeedbackPost(fake(ok), {
      body: { type: "idea", summary: "x" },
      csrfOk: true,
      mode: "json",
      submitter,
    });
    expect(json.status).toBe(201);
  });
});
