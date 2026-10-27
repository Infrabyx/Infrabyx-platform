import { describe, expect, it } from "vitest";
import {
  Catalogue,
  lintCatalogues,
  PLATFORM_CATALOGUE_PATH,
  readCatalogueFiles,
} from "./catalogue.js";
import { main } from "./lint-cli.js";

describe("notification catalogue (PL3 plan §6.2)", () => {
  it("the platform file is clean and loads", () => {
    expect(lintCatalogues(readCatalogueFiles([PLATFORM_CATALOGUE_PATH]))).toEqual([]);
    const c = Catalogue.load();
    expect(c.get("approval.requested")).toMatchObject({ mandatory: true, resend: "safe" });
    expect(c.get("breach.notice").never_channels).toContain("whatsapp");
    expect(() => c.get("no.such")).toThrow(expect.objectContaining({ code: "IPB-NTF-002" }));
    expect(main([])).toBe(0);
  });
  it("refuses duplicates, missing templates, marketing WhatsApp and collections on WhatsApp", () => {
    const doc = {
      catalogue: "bad",
      version: 1,
      classes: [
        {
          id: "approval.requested",
          category: "transactional",
          resend: "safe",
          default_channels: ["inapp"],
          help_key: "ntf.x.y",
          deep_link: "/x",
        },
        {
          id: "loan.collection_due",
          category: "regulatory",
          resend: "hold",
          default_channels: ["sms"],
          help_key: "ntf.x.y",
          deep_link: "/x",
        },
        {
          id: "mkt.whatsapp_offer",
          category: "marketing",
          marketing_purpose: "MARKETING_WHATSAPP",
          resend: "hold",
          default_channels: ["whatsapp"],
          help_key: "ntf.x.y",
          deep_link: "/x",
          templates: { whatsapp: { name: "offer", category: "marketing", lang: ["en"] } },
        },
      ],
    };
    const msgs = lintCatalogues([
      ...readCatalogueFiles([PLATFORM_CATALOGUE_PATH]),
      { file: "bad.yaml", doc },
    ]).map((f) => `${f.classId}: ${f.message}`);
    expect(msgs).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^approval.requested: duplicate/),
        expect.stringMatching(/^loan.collection_due: collection/),
        expect.stringMatching(/^loan.collection_due: sms channel without/),
        expect.stringMatching(/^mkt.whatsapp_offer: marketing WhatsApp is refused/),
      ]),
    );
    expect(
      lintCatalogues([{ file: "bad.yaml", doc }], { metaMarketingEnabled: true }).some((f) =>
        /marketing WhatsApp/.test(f.message),
      ),
    ).toBe(false);
  });
});
