// The DDE registration's two paths (PR-FBX-35 (c), R1-D-84): a stamped document with its
// certificate, or a not-stampable one with a reason code and no certificate or duty.
import { describe, expect, it } from "vitest";
import { DDE_NOT_STAMPABLE_REASONS, DdeRegistration } from "./estamp.js";
import { payloadClass } from "./payload-class.js";

const base = {
  document: { storageKey: "tenant/tnt_x/los/DOC.pdf", sha256: "a".repeat(64) },
  executants: [{ partyRef: "p1", name: "Party p1" }],
  outputPrefix: "tenant/tnt_x/los",
};

describe("DDE registration (R1-D-84)", () => {
  it("takes a stamped document with its certificate, as before", () => {
    expect(DdeRegistration.safeParse({ ...base, certificateId: "IN-MH0001" }).success).toBe(true);
  });

  it("takes a not-stampable document with a reason code, and a note for OTHER", () => {
    expect(DDE_NOT_STAMPABLE_REASONS).toEqual(["NOT_AN_INSTRUMENT", "ACKNOWLEDGEMENT", "OTHER"]);
    for (const reason of ["NOT_AN_INSTRUMENT", "ACKNOWLEDGEMENT"])
      expect(DdeRegistration.safeParse({ ...base, notStampable: { reason } }).success).toBe(true);
    expect(DdeRegistration.safeParse({ ...base, notStampable: { reason: "OTHER" } }).success).toBe(
      false,
    );
    expect(
      DdeRegistration.safeParse({
        ...base,
        notStampable: { reason: "OTHER", note: "a borrower's declaration" },
      }).success,
    ).toBe(true);
    expect(DdeRegistration.safeParse({ ...base, notStampable: { reason: "EXEMPT" } }).success).toBe(
      false,
    );
  });

  it("refuses a not-stampable registration that also carries an e-stamp or a duty, and one with neither path", () => {
    const ns = { reason: "ACKNOWLEDGEMENT" };
    expect(
      DdeRegistration.safeParse({ ...base, notStampable: ns, certificateId: "IN-MH0001" }).success,
    ).toBe(false);
    expect(
      DdeRegistration.safeParse({ ...base, notStampable: ns, dutyMinor: 10_000 }).success,
    ).toBe(false);
    expect(DdeRegistration.safeParse(base).success).toBe(false);
  });

  it("keeps the registration REGULATED and fully classed", () => {
    const c = payloadClass(DdeRegistration);
    expect(c.bodyHighest).toBe("REGULATED");
    expect(c.unannotated).toEqual([]);
  });
});
