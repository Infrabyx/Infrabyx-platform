import { describe, expect, it } from "vitest";
import { isoDate, paiseToRupees, rupeesToPaise, tallyDate } from "./amounts.js";
import { el, esc, field, findAll, parseXml, XmlError } from "./xml.js";

describe("XML builder and strict reader (R1-D-178)", () => {
  it("escapes every text and attribute value", () => {
    expect(esc(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;");
    const x = el("LEDGERNAME", { NAME: `R&D "Ops"` }, "Loans <1>").xml;
    expect(x).toBe(`<LEDGERNAME NAME="R&amp;D &quot;Ops&quot;">Loans &lt;1&gt;</LEDGERNAME>`);
    expect(parseXml(x)).toMatchObject({ attrs: { NAME: `R&D "Ops"` }, text: "Loans <1>" });
    expect(() => el("BAD NAME", null)).toThrow(XmlError);
    expect(() => el("X", { "a b": "1" })).toThrow(XmlError);
  });

  it("reads TallyPrime's answers: declaration, BOM, comments, CDATA, references", () => {
    const doc = parseXml(
      `\ufeff<?xml version="1.0"?><!-- answer --><ENVELOPE><BODY><DATA a='1'>` +
        `<LEDGER NAME="Bank &amp; Cash">&#4; Primary<![CDATA[ <raw> ]]></LEDGER>` +
        `<EMPTY/><N>&#x41;&#66;</N></DATA></BODY></ENVELOPE><!-- end -->`,
    );
    const ledger = findAll(doc, "LEDGER")[0]!;
    expect(ledger.attrs.NAME).toBe("Bank & Cash");
    expect(ledger.text).toBe(" Primary <raw> ");
    expect(field(findAll(doc, "DATA")[0]!, "N")).toBe("AB");
    expect(field(findAll(doc, "DATA")[0]!, "a")).toBe("1");
  });

  it("refuses what could expand or confuse", () => {
    for (const bad of [
      `<!DOCTYPE x [<!ENTITY e "boom">]><x>&e;</x>`,
      `<x>&e;</x>`,
      `<x>a & b</x>`,
      `<?php ?><x/>`,
      `<x><?pi?></x>`,
      `<x><y></x></y>`,
      `<x>`,
      `<x></x><y></y>`,
      `<x a="1" a="2"/>`,
      `<x a=1/>`,
      `<x a="<"/>`,
      `text<x/>`,
      `<x>&#xD800;</x>`,
      `<x>&#1114112;</x>`,
    ])
      expect(() => parseXml(bad), bad).toThrow(XmlError);
    const deep = "<a>".repeat(33) + "</a>".repeat(33);
    expect(() => parseXml(deep)).toThrow(/deep/);
    expect(() =>
      parseXml("<a>" + "<b/>".repeat(11) + "</a>", { ...limits(), maxElements: 10 }),
    ).toThrow(/too many/);
    expect(() => parseXml("<a>xxxxxxxxxx</a>", { ...limits(), maxChars: 10 })).toThrow(/large/);
  });
});

const limits = () => ({ maxChars: 8 * 1024 * 1024, maxDepth: 32, maxElements: 200_000 });

describe("amounts by string arithmetic (P-04)", () => {
  it("writes paise as rupees and reads them back exactly", () => {
    expect(paiseToRupees(150_000)).toBe("1500.00");
    expect(paiseToRupees(5, true)).toBe("-0.05");
    expect(paiseToRupees(0, true)).toBe("0.00");
    expect(paiseToRupees(1_000_000_000_000_000)).toBe("10000000000000.00");
    for (const p of [1, 99, 100, 123_456_789, 999_999_999_999_999])
      expect(rupeesToPaise(paiseToRupees(p, true))).toBe(-p);
    expect(rupeesToPaise("1500")).toBe(150_000);
    expect(rupeesToPaise("1500.5")).toBe(150_050);
    expect(rupeesToPaise(" -0.10 ")).toBe(-10);
    for (const bad of ["1,500.00", "1500.005", "1e3", "₹1500", "", "abc", "10000000000000.01"])
      expect(rupeesToPaise(bad), bad).toBeNull();
    expect(() => paiseToRupees(1.5)).toThrow(RangeError);
    expect(() => paiseToRupees(-1)).toThrow(RangeError);
  });

  it("converts dates both ways", () => {
    expect(tallyDate("2026-11-02")).toBe("20261102");
    expect(isoDate("20261102")).toBe("2026-11-02");
    expect(isoDate("2026-11-02")).toBeNull();
  });
});
