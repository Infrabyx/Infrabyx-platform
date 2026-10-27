// PL5 contracts: website ports, error areas, id prefixes and event payloads (PL5 plan §8).
import { describe, expect, it } from "vitest";
import { ERROR_CATALOGUE } from "./error-catalogue.js";
import { ID_PREFIXES, idSchema } from "./ids.js";
import {
  BRAND_EVENTS,
  EcoFeedbackSubmitted,
  EcoMarketingConsentUpdated,
  EcoVendorAssuranceDocumentPublished,
} from "./events/pl5-events.js";
import { PORT_CATALOGUE } from "./ports/catalogue.js";
import { Catalogue, ConsentRecordInput, LeadInput, PL5_PORTS, VadDocument } from "./ports/web.js";

const sha = "a".repeat(64);

describe("PL5 ports", () => {
  it("defines every website port in the catalogue", () => {
    for (const p of PL5_PORTS) expect(PORT_CATALOGUE[p].interfaceDefined, p).toBe(true);
    expect(PORT_CATALOGUE.TAG_MANAGER.configPrefix).toBe("mkt.tag_manager.");
  });

  it("a consent record needs a cid or a principal and refuses unknown methods", () => {
    const ok = {
      cid: "c".repeat(22),
      method: "CMP_BANNER",
      choice: { functional: false, analytics: false, marketing: false },
      textKey: "consent.cookie.banner",
      textVersion: "2026-10",
      region: "IN",
      gpc: true,
    };
    expect(ConsentRecordInput.safeParse(ok).success).toBe(true);
    expect(ConsentRecordInput.safeParse({ ...ok, cid: undefined }).success).toBe(false);
    expect(ConsentRecordInput.safeParse({ ...ok, method: "PIXEL" }).success).toBe(false);
  });

  it("a lead carries a consent receipt; a catalogue carries integer minor units only", () => {
    expect(
      LeadInput.safeParse({
        source: "FORM",
        product: "OH",
        fields: { email: "a@example.org" },
        pageUrl: "/contact",
        noticeVersion: "1.0",
      }).success,
    ).toBe(false);
    const cat = {
      product: "OH",
      brand_pack_id: null,
      catalogue_version: "fixture-1",
      catalogue_hash: sha,
      plans: [
        {
          plan_key: "starter",
          name: "Starter",
          features: ["feature.one"],
          prices: [
            {
              currency: "INR",
              amount_minor: 100,
              period: "month",
              gst_rate_bp: 1800,
              tax_inclusive: false,
            },
          ],
          trial_days: null,
        },
      ],
      coupons: [],
      fetched_at: "2026-10-27T10:00:00+05:30",
    };
    expect(Catalogue.safeParse(cat).success).toBe(true);
    const bad = structuredClone(cat);
    (bad.plans[0]!.prices[0] as { amount_minor: number }).amount_minor = 1.5;
    expect(Catalogue.safeParse(bad).success).toBe(false);
  });

  it("trust documents use the Ecosystem §6.34 codes", () => {
    const doc = {
      vad_id: "vad_01JB000000000000000000000A",
      title: "Sub-processor list",
      category: "STATEMENT",
      cadence: "EVENT",
      valid_from: "2026-10-01",
      valid_until: null,
      version: 1,
      storage_ref: "assurance/oh/subprocessors-1.pdf",
      sha256: sha,
      visibility: "PUBLIC",
      publication_targets: ["OH"],
      nda_required: false,
      summary: "Who processes data for us.",
    };
    expect(VadDocument.parse(doc).state).toBe("PUBLISHED");
    expect(VadDocument.safeParse({ ...doc, visibility: "per_tenant" }).success).toBe(false);
    expect(EcoVendorAssuranceDocumentPublished.safeParse(doc).success).toBe(true);
  });
});

describe("PL5 error areas and ids", () => {
  it("registers the CMS, brand, web, feedback, policy, accessibility, trust and artefact codes", () => {
    for (const code of [
      "IPB-CMS-010",
      "IPB-BRD-003",
      "IPB-WEB-002",
      "IPB-FB-001",
      "IPB-POL-009",
      "IPB-A11Y-006",
      "IPB-TRUST-015",
      "IPB-RES-010",
    ])
      expect(ERROR_CATALOGUE, code).toHaveProperty(code);
    expect(ERROR_CATALOGUE["IPB-CMS-006"].status).toBe(410);
    expect(ERROR_CATALOGUE["IPB-A11Y-004"].status).toBe("ci");
  });

  it("registers the content, consent and trust prefixes", () => {
    for (const p of ["brv", "pg", "rev", "clm", "cns", "pol", "pin", "vad", "vada", "vadr", "gco"])
      expect(ID_PREFIXES).toHaveProperty(p);
    expect(idSchema("vada").safeParse("vada_01JB000000000000000000000A").success).toBe(true);
  });
});

describe("PL5 events", () => {
  it("puts brand-pack events in the tenancy namespace (IPB-04 §04.6.1)", () => {
    expect(BRAND_EVENTS.BrandPackPublished.module).toBe("tenancy");
  });

  it("Ecosystem payloads carry hashes and references, not names or contacts", () => {
    expect(
      EcoMarketingConsentUpdated.safeParse({
        consent_id: "cns_01JB000000000000000000000A",
        principal_hash: "h".repeat(32),
        purpose: "MARKETING_EMAIL",
        state: "WITHDRAWN",
        channel: "WEB_CMP",
        brand_pack_id: null,
        notice_version: "2026-10",
        occurred_at: "2026-10-27T10:00:00+05:30",
        email: "a@example.org",
      }).success,
    ).toBe(false);
    expect(
      EcoFeedbackSubmitted.safeParse({
        fbk_id: "fbk_01JB000000000000000000000A",
        product: "OH",
        tenantid: "h".repeat(32),
        module: "public",
        surface: "WIDGET",
        severity: "S3",
        category: "BUG",
        summary: "The contact form button is hard to find.",
        attachments_count: 0,
        submitted_by_role: "ANONYMOUS",
        contact_ok: false,
      }).success,
    ).toBe(true);
  });
});
