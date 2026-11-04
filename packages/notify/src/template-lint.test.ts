// Tenant template lint, variable whitelist and SMS/WhatsApp selection (PR-LDC-27; R1-plan M58).
import { describe, expect, it } from "vitest";
import type { KernelContext, MutationKernel } from "@infrabyx/contracts/kernel";
import { NotificationClass } from "@infrabyx/contracts/ports";
import {
  Catalogue,
  lintCatalogues,
  PLATFORM_CATALOGUE_PATH,
  readCatalogueFiles,
} from "./catalogue.js";
import {
  TEMPLATE_LIMITS,
  TemplateLintError,
  lintEmailTemplate,
  lintHtml,
  renderEmailTemplate,
  templateVariables,
} from "./template-lint.js";
import { TenantTemplateStore, staticTemplateRegistry, templateLocales } from "./template-store.js";

const cls = NotificationClass.parse({
  id: "case.hearing_reminder",
  category: "transactional",
  resend: "safe",
  default_channels: ["email", "sms", "whatsapp"],
  help_key: "hlp.case.hearing_reminder",
  deep_link: "/cases/{id}",
  variables: ["name", "date", "court"],
  templates: {
    email: { key: "case.hearing_reminder", locales: ["en", "hi"] },
    sms: { dlt_template_id: "1107160000000000001", header: "IBXPLT", vars: ["name", "date"] },
    whatsapp: { name: "hearing_reminder", category: "utility", lang: ["en"], vars: ["date"] },
  },
});
const ok = { subject: "Hearing on {{date}}", text: "Dear {{name}}, your hearing is on {{date}}." };
const lint = (html: string) => lintHtml(html);
const allowed = templateVariables(cls);

describe("PR-LDC-27 variable whitelist", () => {
  it("is the class's variables, else its SMS and WhatsApp template variables", () => {
    expect(templateVariables(cls)).toEqual(["name", "date", "court"]);
    const { variables: _v, ...rest } = cls;
    expect(templateVariables(rest as NotificationClass)).toEqual(["name", "date"]);
  });
  it("refuses an unknown variable and a malformed placeholder", () => {
    const f = lintEmailTemplate(
      { subject: "Hi {{name}}", text: "Your OTP {{code}} {{ bad" },
      allowed,
    );
    expect(f.map((x) => x.message).join(" | ")).toMatch(/unknown variable \{\{code\}\}/);
    expect(f.map((x) => x.message).join(" | ")).toMatch(/malformed/);
  });
  it("accepts a clean template with whitelisted variables", () => {
    expect(lintEmailTemplate(ok, allowed)).toEqual([]);
    expect(lintEmailTemplate({ ...ok, html: "<p>Dear <b>{{name}}</b></p>" }, allowed)).toEqual([]);
  });
  it("the catalogue lint refuses a whitelist that leaves out a template's variables", () => {
    const doc = {
      catalogue: "t",
      version: 1,
      classes: [{ ...cls, variables: ["name"] }],
    };
    const f = lintCatalogues([{ file: "t.yaml", doc }]);
    expect(f.map((x) => x.message)).toContain(
      "the sms template takes date, which variables does not list",
    );
    expect(lintCatalogues(readCatalogueFiles([PLATFORM_CATALOGUE_PATH]))).toEqual([]);
  });
});

describe("PR-LDC-27 template lint", () => {
  it("requires a plain-text part and a subject, and caps every field", () => {
    const f = lintEmailTemplate({ subject: " ", text: "", html: "<p>x</p>" }, allowed);
    expect(f).toContainEqual({ field: "text", message: "a plain-text part is required" });
    expect(f).toContainEqual({ field: "subject", message: "subject is required" });
    const long = lintEmailTemplate(
      {
        subject: "s".repeat(TEMPLATE_LIMITS.subject + 1),
        text: "t".repeat(TEMPLATE_LIMITS.text + 1),
        html: `<p>${"h".repeat(TEMPLATE_LIMITS.html)}</p>`,
      },
      allowed,
    );
    expect(long.map((x) => x.field).sort()).toEqual(["html", "subject", "text"]);
    expect(
      lintEmailTemplate({ subject: "a\r\nBcc: x@example.test", text: "t" }, allowed)[0]?.message,
    ).toMatch(/line breaks/);
  });
  it.each([
    ["<script>alert(1)</script>", /<script> is not allowed/],
    ["<style>p{color:red}</style>", /<style> is not allowed/],
    ['<iframe src="https://example.test"></iframe>', /<iframe> is not allowed/],
    ['<form action="https://example.test"><input name="pin"></form>', /<form> is not allowed/],
    ['<p onclick="steal()">x</p>', /event-handler attribute onclick/],
    ["<img src=x onerror=alert(1)>", /event-handler attribute onerror/],
    ['<a href="javascript:alert(1)">x</a>', /javascript: URL/],
    ['<a href="java&#x09;script:alert(1)">x</a>', /javascript: URL/],
    ['<a href=" JaVaScRiPt:alert(1)">x</a>', /javascript: URL/],
    ['<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>', /data: URL/],
    ['<a href="http://example.test">x</a>', /https:, mailto: or tel:/],
    ['<a href="https://bank.example.test@evil.example.test/">x</a>', /user name or password/],
    ['<img src="https://tracker.example.test/p.gif">', /remote images/],
    ['<img src="//tracker.example.test/p.gif">', /remote images/],
    ['<img src="data:image/svg+xml;base64,PHN2Zz4=">', /inline PNG/],
    ['<p style="background:url(https://x.example.test/a.png)">x</p>', /CSS/],
    ['<p style="width:expression(alert(1))">x</p>', /CSS/],
    ['<p style="position:fixed">x</p>', /CSS property position/],
    [
      '<div background="https://x.example.test/a.png">x</div>',
      /attribute background is not allowed/,
    ],
    ['<a href="{{court}}">x</a>', /only in text/],
    ["<!--[if mso]><p>hidden</p><![endif]-->", /comments/],
    ["<svg><circle/></svg>", /<svg> is not allowed/],
    ['<meta http-equiv="refresh" content="0;url=https://evil.example.test">', /http-equiv/],
    ["<blink>x</blink>", /tag <blink> is not allowed/],
    ["1 < 2", /bare </],
    ['<p title="a" title="b">x</p>', /repeats the attribute/],
    ['<base href="https://evil.example.test/">', /<base> is not allowed/],
  ])("refuses %s", (html, message) => {
    expect(lint(html).join(" | ")).toMatch(message);
  });
  it("accepts ordinary email HTML", () => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Hearing</title></head>
<body style="margin:0;padding:0;background-color:#ffffff"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="font-family:Arial, sans-serif;font-size:14px;color:#222 !important">
<h1>Hearing reminder</h1><p>Dear {{name}},<br/>your hearing at {{court}} is on <strong>{{date}}</strong>.</p>
<p><a href="https://app.example.test/cases" target="_blank" rel="noopener">Open the case</a> or write to <a href="mailto:help@example.test">us</a>.</p>
<img alt="logo" width="40" src="data:image/png;base64,iVBORw0KGgo=">
<hr><ul><li>One &amp; two</li></ul></td></tr></table></body></html>`;
    expect(lint(html)).toEqual([]);
  });
  it("can hold links to the tenant's own hosts", () => {
    const f = lintHtml('<a href="https://evil.example.org/">x</a>', {
      linkHosts: ["example.test"],
    });
    expect(f.join()).toMatch(/link host evil.example.org is not allowed/);
    expect(
      lintHtml('<a href="https://app.example.test/">x</a>', { linkHosts: ["example.test"] }),
    ).toEqual([]);
  });
});

describe("PR-LDC-27 rendering", () => {
  it("escapes values in HTML, strips line breaks from the subject and fails on a missing variable", () => {
    const r = renderEmailTemplate(
      cls,
      { ...ok, html: "<p>Dear {{name}}</p>" },
      { name: '<img src=x onerror=alert(1)> "A"', date: "1 Dec\r\nBcc: x@example.test" },
    );
    expect(r.html).toBe("<p>Dear &lt;img src=x onerror=alert(1)&gt; &quot;A&quot;</p>");
    expect(r.subject).toBe("Hearing on 1 Dec Bcc: x@example.test");
    expect(r.text).toContain("Dear <img src=x onerror=alert(1)>");
    expect(() => renderEmailTemplate(cls, ok, { name: "A" })).toThrow(
      /lacks the template variable date/,
    );
  });
  it("a template that no longer passes the lint fails closed", () => {
    expect(() =>
      renderEmailTemplate(cls, { subject: "x", text: "{{secret}}" }, { secret: "s" }),
    ).toThrow(
      expect.objectContaining({
        code: "IPB-PORT-001",
        meta: expect.objectContaining({ reason: "template_invalid" }),
      }),
    );
  });
  it("tries the delivery's locale, its language, then the class's first locale", () => {
    expect(templateLocales(cls, "email", "hi-IN")).toEqual(["hi-IN", "hi", "en"]);
    expect(templateLocales(cls, "email", null)).toEqual(["en"]);
  });
});

describe("PR-LDC-27 SMS and WhatsApp overrides select registered templates only", () => {
  const catalogue = new Catalogue([
    ...readCatalogueFiles([PLATFORM_CATALOGUE_PATH]),
    {
      file: "t.yaml",
      doc: {
        catalogue: "t",
        version: 1,
        classes: [
          { ...cls, never_channels: [] },
          {
            id: "case.recovery_notice",
            category: "regulatory",
            resend: "hold",
            default_channels: ["email"],
            never_channels: ["whatsapp"],
            help_key: "hlp.case.recovery_notice",
            deep_link: "/cases/{id}",
            templates: { email: { key: "case.recovery_notice", locales: ["en"] } },
          },
        ],
      },
    },
  ]);
  const kernel = {
    mutate: () => Promise.reject(new Error("validation must refuse before any write")),
    read: () => Promise.reject(new Error("no read expected")),
  } as unknown as MutationKernel;
  const store = new TenantTemplateStore({
    kernel,
    audit: { record: async () => ({ id: "x" }) },
    catalogue,
    registry: staticTemplateRegistry({
      sms: [
        {
          dltTemplateId: "1107160000000000009",
          senderId: "LAWDOC",
          dltEntityId: "1101160000000000001",
          vars: ["name", "date"],
        },
        {
          dltTemplateId: "1107160000000000010",
          senderId: "LAWDOC",
          dltEntityId: "1101160000000000001",
          vars: ["otp"],
        },
        {
          dltTemplateId: "1107160000000000011",
          senderId: "LAWDOC",
          dltEntityId: "1101160000000000001",
          classes: ["other.class"],
        },
      ],
      whatsapp: [{ name: "promo", lang: "en", category: "marketing" }],
    }),
  });
  const maker: KernelContext = {
    tenantId: "tnt_a",
    principal: { id: "usr_m", type: "user", roles: ["ORG_MAKER"] },
  };
  const approvals = { request: async () => ({ id: "apr_x" }) };
  const refused = async (
    change: Parameters<TenantTemplateStore["requestChange"]>[2],
    m: RegExp,
  ) => {
    const e = await store.requestChange(maker, approvals, change).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TemplateLintError);
    expect(String((e as Error).message)).toMatch(m);
  };
  it("refuses free text and unregistered templates", async () => {
    await refused(
      {
        class: cls.id,
        channel: "sms",
        locale: "en",
        dltTemplateId: "1107160000000000009",
        text: "Pay now",
      } as never,
      /only selects a registered DLT template/,
    );
    await refused(
      { class: cls.id, channel: "sms", locale: "en", dltTemplateId: "1107169999999999999" },
      /not registered/,
    );
    await refused(
      { class: cls.id, channel: "whatsapp", locale: "en", name: "nope", lang: "en" },
      /not approved/,
    );
    await refused(
      {
        class: cls.id,
        channel: "whatsapp",
        locale: "en",
        name: "promo",
        lang: "en",
        body: "x",
      } as never,
      /only selects an approved template/,
    );
  });
  it("refuses a template whose variables the class does not offer, or registered for another class", async () => {
    await refused(
      { class: cls.id, channel: "sms", locale: "en", dltTemplateId: "1107160000000000010" },
      /takes otp/,
    );
    await refused(
      { class: cls.id, channel: "sms", locale: "en", dltTemplateId: "1107160000000000011" },
      /not registered for/,
    );
  });
  it("refuses a marketing WhatsApp template on a transactional class and a never channel", async () => {
    await refused(
      { class: cls.id, channel: "whatsapp", locale: "en", name: "promo", lang: "en" },
      /marketing classes only/,
    );
    await refused(
      {
        class: "case.recovery_notice",
        channel: "whatsapp",
        locale: "en",
        name: "promo",
        lang: "en",
      },
      /never sent by whatsapp/,
    );
  });
  it("refuses an email override of a security class and HTML that fails the lint", async () => {
    await refused(
      { class: "security.login_alert", channel: "email", locale: "en", subject: "s", text: "t" },
      /security classes/,
    );
    await refused(
      { class: cls.id, channel: "email", locale: "en", ...ok, html: "<script>x</script>" },
      /<script>/,
    );
  });
  it("tenant roles only: a platform context or a member is refused", async () => {
    await expect(
      store.requestChange({ ...maker, scope: "platform" }, approvals, {
        class: cls.id,
        channel: "email",
        locale: "en",
        ...ok,
      }),
    ).rejects.toMatchObject({ code: "IPB-UX-011" });
    await expect(
      store.requestChange(
        { ...maker, principal: { ...maker.principal, roles: ["ORG_MEMBER"] } },
        approvals,
        {
          class: cls.id,
          channel: "email",
          locale: "en",
          ...ok,
        },
      ),
    ).rejects.toMatchObject({ code: "IPB-UX-011" });
  });
});
