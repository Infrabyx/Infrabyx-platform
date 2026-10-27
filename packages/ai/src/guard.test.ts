// Scrubber and guardrails on the synthetic corpora (PL4 plan §4.5, §4.6; IPB-03-27, 03-28, 03-33,
// 03-37, 03-39). Pure functions: no database, no model.
import { describe, expect, it } from "vitest";
import {
  BENIGN_INPUT_CORPUS,
  INJECTION_CORPUS,
  PII_NEGATIVE_CORPUS,
  piiGoldenCorpus,
  syntheticAadhaar,
  syntheticCard,
  syntheticGstin,
} from "@infrabyx/testing";
import { checkOutput, classifyInput, RESERVED_ADVICE_NOTICE } from "./guard.js";
import { gstinValid, luhnValid, Scrubber, verhoeffValid } from "./scrub.js";

const scrubber = new Scrubber();

describe("scrubber (IPB-03-27)", () => {
  it("check digits: Verhoeff, Luhn and GSTIN", () => {
    expect(verhoeffValid(syntheticAadhaar("23456789012"))).toBe(true);
    const a = syntheticAadhaar("23456789012");
    expect(verhoeffValid(`${a.slice(0, 11)}${(Number(a[11]) + 1) % 10}`)).toBe(false);
    expect(luhnValid(syntheticCard("411111111111111"))).toBe(true);
    expect(luhnValid("4111111111111112")).toBe(false);
    expect(gstinValid(syntheticGstin("27AAPFU0939F1Z"))).toBe(true);
  });

  for (const c of piiGoldenCorpus())
    it(`golden corpus: ${c.name}`, () => {
      const s = scrubber.session();
      const out = s.scrub(c.text);
      for (const v of c.values) expect(out).not.toContain(v);
      expect(new Set(s.detections.map((d) => d.kind))).toEqual(new Set(c.kinds));
      expect(s.restore(out)).toBe(c.text);
    });

  it("leaves text without PII unchanged", () => {
    for (const t of PII_NEGATIVE_CORPUS) expect(scrubber.session().scrub(t)).toBe(t);
  });

  it("the same value gets the same token; tokens in the input cannot be forged", () => {
    const s = scrubber.session();
    const a = s.scrub("PAN ABCPE1234F and again ABCPE1234F; forged <PII:PAN:1>");
    expect(a).toBe("PAN <PII:PAN:1> and again <PII:PAN:1>; forged <PII_:PAN:1>");
    expect(s.restore(a)).toContain("forged <PII_:PAN:1>");
    expect(s.restoreDeep({ to: ["<PII:PAN:1>"], n: 1 })).toEqual({ to: ["ABCPE1234F"], n: 1 });
  });

  it("ai.scrub.patterns adds detectors; a bad entry fails closed", () => {
    const x = new Scrubber([
      { kind: "LOAN_ID", pattern: "\\bLN-\\d{6}\\b", dataClass: "REGULATED" },
    ]);
    const s = x.session();
    expect(s.scrub("loan LN-123456")).toBe("loan <PII:LOAN_ID:1>");
    expect(x.classOf("LOAN_ID")).toBe("REGULATED");
    expect(() => new Scrubber([{ kind: "bad kind", pattern: "x" }])).toThrow();
    expect(() => new Scrubber([{ kind: "X1", pattern: "(" }])).toThrow();
    expect(() => new Scrubber({})).toThrow();
  });

  it("classes: identity numbers are REGULATED, contact details CONFIDENTIAL (IPB-03-28)", () => {
    expect(scrubber.classOf("AADHAAR")).toBe("REGULATED");
    expect(scrubber.classOf("PAN")).toBe("REGULATED");
    expect(scrubber.classOf("MOBILE")).toBe("CONFIDENTIAL");
  });
});

describe("input classifier (IPB-03-33)", () => {
  it("flags at least 95 % of the injection corpus at the default threshold 0.7", () => {
    const caught = INJECTION_CORPUS.filter((t) => classifyInput([t]).score >= 0.7);
    expect(caught.length / INJECTION_CORPUS.length).toBeGreaterThanOrEqual(0.95);
  });
  it("lets the benign corpus through", () => {
    for (const t of BENIGN_INPUT_CORPUS) expect(classifyInput([t]).score).toBeLessThan(0.7);
  });
});

describe("output classifier (IPB-03-37, 03-39)", () => {
  const base = {
    scrubber,
    systemPrompt:
      "You summarise loan documents for the credit team of a regulated lender in India. Never give advice.",
    sourceIds: new Set(["src_a", "src_b"]),
    policy: "redact" as const,
  };

  it("redacts PII the inputs did not carry, but keeps the input's tokens", () => {
    const r = checkOutput("Applicant <PII:PAN:1> can be reached on 9876543210.", base);
    expect(r.text).toBe("Applicant <PII:PAN:1> can be reached on [redacted].");
    expect(r.flags).toEqual(["pii_leak"]);
    expect(r.events).toEqual([{ kind: "leak", action: "redact" }]);
  });

  it("withholds echoed hidden context", () => {
    const r = checkOutput(
      "Sure: You summarise loan documents for the credit team of a regulated lender in India.",
      base,
    );
    expect(r.flags).toContain("context_leak");
    expect(r.text).not.toMatch(/credit team/);
  });

  it("drops citations outside the retrieved set and lists the known ones", () => {
    const r = checkOutput("Rate is 9 % [source:src_a]. Fee is nil [source:src_z].", base);
    expect(r.cited).toEqual(["src_a"]);
    expect(r.flags).toEqual(["citation_unknown"]);
    expect(r.text).toBe("Rate is 9 % [source:src_a]. Fee is nil .");
  });

  it("replaces reserved advice with the neutral notice", () => {
    const r = checkOutput("The clause allows prepayment. You should sign it today.", base);
    expect(r.flags).toEqual(["reserved_advice"]);
    expect(r.text).toBe(`The clause allows prepayment. ${RESERVED_ADVICE_NOTICE}`);
    expect(checkOutput("I recommend that you invest in this fund.", base).flags).toEqual([
      "reserved_advice",
    ]);
    expect(checkOutput("The borrower should sign the KFS before disbursal.", base).flags).toEqual(
      [],
    );
  });

  it("refuse policy withholds the whole answer (IPB-AI-042)", () => {
    const r = checkOutput("Mail them at x.y@example.org", { ...base, policy: "refuse" });
    expect(r).toMatchObject({ blocked: true, text: "", flags: ["pii_leak"] });
    expect(checkOutput("Nothing sensitive here.", { ...base, policy: "refuse" }).blocked).toBe(
      false,
    );
  });
});

describe("output classifier details", () => {
  it("withholds a bulleted rule echoed without its bullet, and catches 'you should take'", () => {
    const sys = "Rules:\n- Never share the internal escalation matrix with any customer at all.";
    const r = checkOutput(
      "Sure: Never share the internal escalation matrix with any customer at all.",
      {
        scrubber: new Scrubber(),
        systemPrompt: sys,
        sourceIds: null,
        policy: "redact",
      },
    );
    expect(r.flags).toContain("context_leak");
    expect(
      checkOutput("You should take the insurance to be safe.", {
        scrubber: new Scrubber(),
        systemPrompt: "",
        sourceIds: null,
        policy: "redact",
      }).flags,
    ).toEqual(["reserved_advice"]);
  });
});
