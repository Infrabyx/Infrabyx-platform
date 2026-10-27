// Resources, forms and pricing copy on PostgreSQL (PL5 plan §5.8, session 5b).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgOutbox } from "@infrabyx/tenancy";
import {
  FakeCatalogue,
  FakeConsentLedger,
  FakeCrm,
  FakeHr,
  FakeOhDesk,
  fixtureCatalogue,
  MemoryStorage,
  platformContext,
  startPostgres,
  type TestDatabase,
} from "@infrabyx/testing";
import { CmsStudio, FormService, MediaLibrary, PricingService, ResourceService } from "../index.js";

let db: TestDatabase;
let studio: CmsStudio;
let media: MediaLibrary;
let resources: ResourceService;
let forms: FormService;
let pricing: PricingService;
const storage = new MemoryStorage();
const crm = new FakeCrm();
const consent = new FakeConsentLedger();
const PACK = "brd_01JB0000000000000000000004";
const a = platformContext(["PLT_CONTENT_EDITOR"], "tnt_platform", "usr_editor_a");
const b = platformContext(["PLT_CONTENT_EDITOR"], "tnt_platform", "usr_editor_b");
const legal = platformContext(["PLT_LEGAL_REVIEWER"], "tnt_platform", "usr_legal");
const para = (text: string) => [
  { _type: "block", style: "normal", markDefs: [], children: [{ _type: "span", text, marks: [] }] },
];
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string }) => e.code ?? String(e),
  );

async function publish(id: string, needsLegal = false) {
  await studio.submit(a, id);
  if (needsLegal) await studio.legalApprove(legal, id);
  await studio.approve(b, id);
  return studio.publishNow(b, id);
}

beforeAll(async () => {
  db = await startPostgres();
  const outbox = new PgOutbox();
  const catalogue = fixtureCatalogue();
  catalogue.plans[0]!.prices.push({
    currency: "INR",
    amount_minor: 500_00,
    period: "one_time",
    gst_rate_bp: 1800,
    tax_inclusive: false,
  });
  pricing = new PricingService({ billing: new FakeCatalogue(catalogue), product: "OH" });
  studio = new CmsStudio({
    kernel: db.kernel,
    audit: db.audit,
    product: "OH",
    outbox,
    extraLint: async (item, body) =>
      item.type === "pricing_copy" ? pricing.lintCopy(item.packId, body) : [],
  });
  media = new MediaLibrary({ kernel: db.kernel, audit: db.audit, storage });
  resources = new ResourceService({
    kernel: db.kernel,
    audit: db.audit,
    product: "OH",
    storage,
    crm,
    consent,
    outbox,
    author: async () => "Example Group",
    base: async () => "https://group.example.org",
  });
  forms = new FormService({
    kernel: db.kernel,
    audit: db.audit,
    product: "OH",
    consent,
    crm,
    hr: new FakeHr(),
    support: new FakeOhDesk(),
    outbox,
  });
});
afterAll(async () => {
  await db?.end();
});

describe("@IPB-04-AT-60 resource versions and cite-as", () => {
  let resId: string;
  it("serves v3 at the stable URL and v2 with ?v=2; cite-as shows v3; history lists every version", async () => {
    const file = async (n: number) =>
      (
        await media.upload(a, {
          mime: "application/pdf",
          bytes: new TextEncoder().encode(`%PDF-1.7 v${n}`),
          gated: true,
        })
      ).id;
    const body = async (v: string) => ({
      artefact_type: "report",
      abstract: para("A report"),
      version: v,
      gating: "public",
      file_media_id: await file(Number(v)),
    });
    const r = await studio.createItem(a, {
      type: "resource",
      packId: PACK,
      slug: "annual-report",
      title: "Annual report",
      body: await body("2"),
    });
    resId = r.item.id;
    await publish(resId);
    await studio.saveDraft(a, resId, {
      title: "Annual report",
      slug: "annual-report",
      body: await body("3"),
    });
    await publish(resId);
    const view = await resources.view(PACK, resId);
    expect(view).toMatchObject({ current: "3", path: "/resources/report/annual-report" });
    expect(view.citeAs).toMatch(
      /^Example Group\. \(\d{4}\)\. Annual report \(v3\)\. https:\/\/group\.example\.org\/resources\/report\/annual-report$/,
    );
    expect(view.versions.map((v) => v.version)).toEqual(["3", "2"]);
    expect(
      (await resources.download({ packId: PACK, resourceId: resId, pageUrl: "/x" })).version,
    ).toBe("3");
    expect(
      (await resources.download({ packId: PACK, resourceId: resId, version: "2", pageUrl: "/x" }))
        .version,
    ).toBe("2");
    await resources.withdrawVersion(b, resId, "2");
    expect(
      await code(
        resources.download({ packId: PACK, resourceId: resId, version: "2", pageUrl: "/x" }),
      ),
    ).toBe("IPB-CMS-041");
  });

  it("@IPB-04-AT-13 emits ResourceReviewDue 30 days before the review date", async () => {
    const now = new Date("2026-10-27T09:00:00+05:30");
    const r = await studio.createItem(a, {
      type: "resource",
      packId: PACK,
      slug: "checklist",
      title: "Checklist",
      body: {
        artefact_type: "checklist",
        abstract: para("x"),
        version: "1",
        gating: "public",
        review_due: "2026-11-26",
      },
    });
    await publish(r.item.id);
    expect(await resources.emitReviewDue(now)).toEqual([r.item.id]);
    expect(await resources.emitReviewDue(new Date("2026-10-28T09:00:00+05:30"))).toEqual([]);
  });
});

describe("@IPB-04-AT-61 gating and download tracking", () => {
  it("an email-gated file needs consent, creates a CRM lead with the receipt and is served by a short signed URL", async () => {
    const f = await media.upload(a, {
      mime: "application/pdf",
      bytes: new TextEncoder().encode("%PDF gated"),
      gated: true,
    });
    const r = await studio.createItem(a, {
      type: "resource",
      packId: PACK,
      slug: "whitepaper",
      title: "Whitepaper",
      body: {
        artefact_type: "whitepaper",
        abstract: para("x"),
        version: "1",
        gating: "email_gate",
        file_media_id: f.id,
      },
    });
    await publish(r.item.id);
    const lead = { name: "A Person", email: "a.person@example.org", consent: false };
    expect(
      await code(
        resources.download({
          packId: PACK,
          resourceId: r.item.id,
          lead,
          pageUrl: "/resources/whitepaper/whitepaper",
        }),
      ),
    ).toBe("IPB-WEB-002");
    const d = await resources.download({
      packId: PACK,
      resourceId: r.item.id,
      lead: { ...lead, consent: true },
      pageUrl: "/r",
      utm: { source: "newsletter" },
    });
    expect(d.url).toMatch(/^memory:\/\/.*\?op=get&exp=\d+$/);
    expect(d.expiresInSeconds).toBe(300);
    const l = crm.leads.at(-1)!;
    expect(l).toMatchObject({
      source: "RESOURCE_GATE",
      consentReceiptId: expect.stringMatching(/^cns_/),
    });
    const row = (
      await db.admin.query(
        "select lead_ref, consent_receipt_id, gating, utm from cms.resource_download order by created_at desc limit 1",
      )
    ).rows[0];
    expect(row).toMatchObject({
      lead_ref: l.leadId,
      consent_receipt_id: l.consentReceiptId,
      gating: "email_gate",
      utm: { source: "newsletter" },
    });
    expect(
      (await db.admin.query("select 1 from cms.outbox where type like '%.ResourceDownloaded.%'"))
        .rowCount,
    ).toBeGreaterThan(0);
  });

  it("a plan-gated template without entitlement is IPB-CMS-040 with an upgrade link", async () => {
    const f = await media.upload(a, {
      mime: "application/pdf",
      bytes: new TextEncoder().encode("%PDF plan"),
      gated: true,
    });
    const r = await studio.createItem(a, {
      type: "resource",
      packId: PACK,
      slug: "template",
      title: "Template",
      body: {
        artefact_type: "template",
        abstract: para("x"),
        version: "1",
        gating: "plan",
        file_media_id: f.id,
      },
    });
    await publish(r.item.id);
    const e = await resources
      .download({
        packId: PACK,
        resourceId: r.item.id,
        pageUrl: "/x",
        session: { authenticated: true, entitled: async () => false },
      })
      .catch((x: { code: string; meta: unknown }) => x);
    expect(e).toMatchObject({ code: "IPB-CMS-040", meta: { action: "upgrade", url: "/pricing" } });
  });
});

describe("@IPB-04-AT-47 lead and consent hand-off", () => {
  let formId: string;
  beforeAll(async () => {
    const f = await studio.createItem(a, {
      type: "form",
      packId: PACK,
      title: "Contact",
      body: {
        destination: "crm_lead",
        fields: [
          { name: "name", label: "Name", kind: "text", required: true, personal: true },
          { name: "email", label: "Work email", kind: "email", required: true, personal: true },
          { name: "message", label: "Message", kind: "textarea", required: true },
        ],
      },
    });
    formId = f.item.id;
    await publish(formId);
  });
  const fields = { name: "A Person", email: "a.person@example.org", message: "Hello" };

  it("refuses an unticked consent box with IPB-WEB-002 and the honeypot with IPB-WEB-003", async () => {
    expect(
      await code(
        forms.submit({
          packId: PACK,
          formId,
          fields,
          consent: false,
          clientKey: "ip1",
          pageUrl: "/contact",
        }),
      ),
    ).toBe("IPB-WEB-002");
    expect(
      await code(
        forms.submit({
          packId: PACK,
          formId,
          fields,
          consent: true,
          honeypot: "x",
          clientKey: "ip1",
          pageUrl: "/contact",
        }),
      ),
    ).toBe("IPB-WEB-003");
    expect(
      await code(
        forms.submit({
          packId: PACK,
          formId,
          fields: { ...fields, email: "nope" },
          consent: true,
          clientKey: "ip1",
          pageUrl: "/contact",
        }),
      ),
    ).toBe("IPB-CMS-001");
  });

  it("hands the lead to the CRM with the consent receipt and keeps no field values, on success or failure", async () => {
    const ok = await forms.submit({
      packId: PACK,
      formId,
      fields,
      consent: true,
      marketing: { email: true },
      clientKey: "ip1",
      pageUrl: "/contact",
    });
    expect(crm.leads.at(-1)).toMatchObject({
      leadId: ok.reference,
      consentReceiptId: ok.consentReceiptId,
      fields,
    });
    expect(consent.records.at(-1)).toMatchObject({
      method: "FORM",
      purposes: ["LEAD_CONTACT", "MARKETING_EMAIL"],
      textKey: "consent.contact_form",
    });
    crm.failNext = true;
    expect(
      await code(
        forms.submit({
          packId: PACK,
          formId,
          fields,
          consent: true,
          clientKey: "ip1",
          pageUrl: "/contact",
        }),
      ),
    ).toBe("IPB-PORT-002");
    const rows = await db.admin.query(
      "select row_to_json(s)::text as j, state from cms.form_submission s order by created_at",
    );
    expect(rows.rows.map((r) => r.state)).toEqual(["handed_off", "failed"]);
    for (const r of rows.rows) {
      expect(r.j).not.toContain("a.person@example.org");
      expect(r.j).not.toContain("Hello");
    }
  });
});

describe("@IPB-04-AT-32 pricing copy and CTAs at submit", () => {
  it("refuses a hidden one-time fee and an 'Only 2 seats left — hurry!' CTA with IPB-CMS-015", async () => {
    const pc = await studio.createItem(a, {
      type: "pricing_copy",
      packId: PACK,
      title: "Pricing",
      body: {
        plans: [{ plan_key: "fixture_basic", cta: { label: "Start", href: "/signup" } }],
        price_periods_shown: ["month"],
      },
    });
    expect(await code(studio.submit(a, pc.item.id))).toBe("IPB-CMS-015");
    const cta = await studio.createItem(a, {
      type: "page",
      packId: PACK,
      slug: "offer",
      title: "Offer",
      body: {
        template: "blank",
        blocks: [
          {
            type: "cta",
            heading: "Only 2 seats left — hurry!",
            button: { label: "Buy", href: "/buy" },
          },
        ],
      },
    });
    expect(await code(studio.submit(a, cta.item.id))).toBe("IPB-CMS-015");
    await studio.saveDraft(a, pc.item.id, {
      title: "Pricing",
      body: { plans: [{ plan_key: "fixture_basic", cta: { label: "Start", href: "/signup" } }] },
    });
    expect((await studio.submit(a, pc.item.id)).status).toBe("legal_review");
  });
});
