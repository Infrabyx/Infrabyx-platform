// The PL5 website fakes behave like the ports they stand in for (PL5 plan §8).
import { describe, expect, it } from "vitest";
import { Catalogue, VadDocument } from "@infrabyx/contracts/ports";
import {
  FakeConsentLedger,
  FakeCrm,
  FakeLawRegister,
  FakeTrustFeed,
  fixtureCatalogue,
  fixtureTrustDocuments,
  NoneTagManager,
} from "./web.js";

describe("website fakes", () => {
  it("the consent ledger appends and returns the latest cookie choice", async () => {
    const l = new FakeConsentLedger();
    const base = {
      cid: "c".repeat(22),
      method: "CMP_BANNER" as const,
      textKey: "consent.cookie.banner",
      textVersion: "2026-10",
      region: "IN" as const,
      gpc: false,
    };
    await l.recordConsent({
      ...base,
      choice: { functional: true, analytics: false, marketing: false },
    });
    await l.recordConsent({
      ...base,
      choice: { functional: false, analytics: false, marketing: false },
    });
    expect(l.records).toHaveLength(2);
    expect((await l.getConsent(base.cid))?.choice.functional).toBe(false);
    await expect(l.recordConsent({ ...base, cid: undefined })).rejects.toThrow();
  });

  it("fixtures parse against the contracts and claim no certification", async () => {
    expect(Catalogue.parse(fixtureCatalogue()).plans).toHaveLength(2);
    for (const d of fixtureTrustDocuments()) VadDocument.parse(d);
    const publicDocs = fixtureTrustDocuments().filter((d) => d.visibility === "PUBLIC");
    expect(publicDocs.some((d) => d.category === "CERTIFICATE")).toBe(false);
    const feed = new FakeTrustFeed();
    expect(await feed.publicationDigest()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the CRM fixture fails on request; the launch tag manager loads nothing", async () => {
    const crm = new FakeCrm();
    crm.failNext = true;
    await expect(
      crm.upsertLead({
        source: "FORM",
        product: "OH",
        fields: {},
        consentReceiptId: "cns_x",
        noticeVersion: "1",
        pageUrl: "/contact",
      }),
    ).rejects.toThrow();
    expect(crm.leads).toHaveLength(0);
    expect(new NoneTagManager().scripts()).toEqual([]);
  });

  it("the law register marks the IPB-04-45 examples as stale", async () => {
    const r = await new FakeLawRegister().checkCitations([
      "Section 66A of the IT Act",
      "Digital Personal Data Protection Act, 2023",
    ]);
    expect(r.map((x) => x.status)).toEqual(["superseded", "current"]);
  });
});
