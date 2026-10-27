// Policy templates, parameters and rendering (IPB-05 §05.3–§05.4; PL5 plan §5.7).
import { describe, expect, it } from "vitest";
import {
  citations,
  clauseNumbers,
  MANDATORY_POLICY_KEYS,
  nextVersion,
  policyDate,
  policyTemplates,
  renderPolicy,
  resolveParams,
} from "./index.js";

describe("policy template skeletons", () => {
  it("ships the 17 IPB-05 templates with their mandatory sections, parameters and counsel markers", () => {
    const all = policyTemplates();
    expect(all.size).toBe(17);
    for (const k of MANDATORY_POLICY_KEYS) expect(all.has(k)).toBe(true);
    const privacy = all.get("privacy")!;
    expect(privacy).toMatchObject({
      template: 1,
      privacyClass: true,
      reconsentOnMajor: true,
      reviewMonths: 6,
    });
    expect(privacy.mandatorySections).toHaveLength(17);
    expect(privacy.parameters).toContain("dpo_email");
    expect(clauseNumbers(privacy.body)).toEqual(privacy.mandatorySections);
    expect(all.get("terms")).toMatchObject({
      termsClass: true,
      privacyClass: false,
      reviewMonths: 12,
    });
    for (const t of all.values()) {
      expect(t.body).toContain("[COUNSEL]");
      expect(clauseNumbers(t.body)).toEqual(t.mandatorySections);
    }
  });
});

describe("parameters (@IPB-05-AT-03) and rendering (IPB-05-11)", () => {
  it("substitutes parameters and conditionals, and reports what is unresolved or still open", () => {
    const r = resolveParams(
      "Write to {{dpo_email}}. {{#if white_label}}WL{{/if}} [Option A | Option B] {{missing}}",
      {
        dpo_email: "dpo@example.org",
        white_label: false,
      },
    );
    expect(r.text).toBe("Write to dpo@example.org.  [Option A | Option B] {{missing}}");
    expect(r.unresolved).toEqual(["missing"]);
    expect(r.open).toEqual(["[Option A | Option B]"]);
  });

  it("renders clause headings with stable anchors, escapes values and keeps only safe links", () => {
    const html = renderPolicy(
      "# Terms\n\n## 7. Liability\n\nWe **cap** <b>liability</b>. See [terms](/legal/terms) and [x](javascript:void-0).\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |",
    );
    expect(html).toBe(
      '<h1>Terms</h1><h2 id="clause-7">7. Liability</h2><p>We <strong>cap</strong> &lt;b&gt;liability&lt;/b&gt;. See <a href="/legal/terms">terms</a> and x.</p><ul><li>one</li><li>two</li></ul><table><thead><tr><th scope="col">A</th><th scope="col">B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    );
  });

  it("finds cited instruments and counts versions", () => {
    expect(
      citations("Under the Companies Act 1956 and the RBI 2017 NBFC outsourcing directions."),
    ).toEqual(
      expect.arrayContaining(["Companies Act 1956", "RBI 2017 NBFC outsourcing directions"]),
    );
    expect(nextVersion(null, "INITIAL")).toBe("1.0");
    expect(nextVersion("1.0", "MINOR")).toBe("1.1");
    expect(nextVersion("1.3", "MAJOR")).toBe("2.0");
    expect(policyDate(new Date("2026-03-03T00:00:00+05:30"))).toBe("03 Mar 2026");
  });
});
