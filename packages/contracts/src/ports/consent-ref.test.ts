// PR-UDF-049 (R1-D-203): the consent reference a port call carries, a `cpr_` receipt or a product's
// own artefact, and what a product reference may not hold.
import { describe, expect, it } from "vitest";
import { verhoeffValid } from "../aadhaar.js";
import { BureauPullRequest } from "./credit-bureau.js";
import {
  consentRefEcho,
  consentRefText,
  isProductConsentRef,
  parseConsentRefText,
  PortConsentRef,
  productConsentRefProblem,
  ProductConsentRef,
} from "./consent-ref.js";

const CPR = "cpr_01JA0000000000000000000000";
const REF = { kind: "udf.purpose_consent", id: "pcn_01JA0000000000000000000000" };

/** A 12-digit number that reads as an Aadhaar number, built at run time. */
const aadhaarLike = (): string => {
  const head = "2" + "3456789034";
  for (let d = 0; d < 10; d++) if (verhoeffValid(head + d)) return head + d;
  throw new Error("unreachable");
};

describe("PortConsentRef (PR-UDF-049)", () => {
  it("accepts a `cpr_` receipt unchanged and a product's own artefact", () => {
    expect(PortConsentRef.parse(CPR)).toBe(CPR);
    expect(PortConsentRef.parse(REF)).toEqual(REF);
    for (const ok of [
      { kind: "udf", id: "abc" },
      { kind: "fbx.consent.v2", id: "A.b_c-9" },
      { kind: "a_b.c_d.e_f.g_h", id: "x".repeat(128) },
    ])
      expect(PortConsentRef.safeParse(ok).success, JSON.stringify(ok)).toBe(true);
  });

  it("refuses each bad shape, reserved kind or personal data with a fixed label", () => {
    const a = aadhaarLike();
    const cases: Array<[unknown, string]> = [
      [{ kind: "Udf.Consent", id: "pcn-1" }, "consent_kind_invalid"],
      [{ kind: "ud", id: "pcn-1" }, "consent_kind_invalid"],
      [{ kind: "udf..consent", id: "pcn-1" }, "consent_kind_invalid"],
      [{ kind: "a.b.c.d.e", id: "pcn-1" }, "consent_kind_invalid"],
      [{ kind: "1udf", id: "pcn-1" }, "consent_kind_invalid"],
      [{ kind: "udf:consent", id: "pcn-1" }, "consent_kind_invalid"],
      [{ kind: "cpr", id: "pcn-1" }, "consent_kind_reserved"],
      [{ kind: "cns.ledger", id: "pcn-1" }, "consent_kind_reserved"],
      [{ kind: "udf.consent", id: "x" }, "consent_id_invalid"],
      [{ kind: "udf.consent", id: "-pcn1" }, "consent_id_invalid"],
      [{ kind: "udf.consent", id: "pcn1." }, "consent_id_invalid"],
      [{ kind: "udf.consent", id: "asha@example.com" }, "consent_id_invalid"],
      [{ kind: "udf.consent", id: "pcn 1" }, "consent_id_invalid"],
      [{ kind: "udf.consent", id: "pcn:1" }, "consent_id_invalid"],
      [{ kind: "udf.consent", id: "+919876543210" }, "consent_id_invalid"],
      [{ kind: "udf.consent", id: CPR }, "consent_id_platform"],
      [{ kind: "udf.consent", id: "cns_01JA0000000000000000000000" }, "consent_id_platform"],
      [{ kind: "udf.consent", id: `pcn-${a}` }, "consent_ref_digits"],
      [{ kind: "udf.consent", id: "pcn-9876543210" }, "consent_ref_digits"],
      [{ kind: "udf.x_9876543210", id: "pcn-1" }, "consent_ref_digits"],
      [{ kind: "udf.consent", id: `pcn.${a}.x` }, "consent_ref_digits"],
      [{ kind: "udf.consent", id: `pcnA${a}B` }, "consent_ref_aadhaar_like"],
      [
        { kind: "udf.consent", id: `pcn-${a.slice(0, 4)}-${a.slice(4, 8)}-${a.slice(8)}` },
        "consent_ref_aadhaar_like",
      ],
      [{ kind: "udf.consent", id: "ABCPE1234F" }, "consent_ref_pan_like"],
      [{ kind: "udf.consent", id: "pan-ABCPE1234F-x" }, "consent_ref_pan_like"],
    ];
    for (const [bad, label] of cases) {
      const r = ProductConsentRef.safeParse(bad);
      expect(r.success, JSON.stringify(bad)).toBe(false);
      expect(r.error?.issues.map((i) => i.message)).toContain(label);
      expect(PortConsentRef.safeParse(bad).success).toBe(false);
      // The issue names the rule, never the value.
      expect(JSON.stringify(r.error?.issues)).not.toContain(a);
    }
    // A PAN-shaped run or ten digits inside a longer identifier (a ULID) are not standing alone.
    expect(productConsentRefProblem("udf.consent", "01JABCPE1234FXYZ")).toBeUndefined();
    expect(productConsentRefProblem("udf.consent", "pcn_01JA9876543210XYZ")).toBeUndefined();
  });

  it("refuses unknown fields, a bare non-`cpr_` string and the wrong types", () => {
    for (const bad of [
      { ...REF, purpose: "bureau" },
      { kind: REF.kind },
      { id: REF.id },
      "pcn-1",
      "cpr_1",
      `${REF.kind}:${REF.id}`,
      { kind: 1, id: "pcn-1" },
      { kind: "udf.consent", id: "p".repeat(129) },
      null,
    ])
      expect(PortConsentRef.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it("writes either form as text and reads it back", () => {
    expect(consentRefText(CPR)).toBe(CPR);
    expect(consentRefText(REF)).toBe(`udf.purpose_consent:${REF.id}`);
    expect(parseConsentRefText(CPR)).toBe(CPR);
    expect(parseConsentRefText(consentRefText(REF))).toEqual(REF);
    for (const bad of ["pcn-1", "cpr:pcn-1", "udf.consent:x", ":pcn-1", "udf.consent:a:b"])
      expect(parseConsentRefText(bad), bad).toBeUndefined();
    expect(isProductConsentRef(CPR)).toBe(false);
    expect(isProductConsentRef(REF)).toBe(true);
  });

  it("echoes a `cpr_` as before and a product artefact with its copy", () => {
    expect(consentRefEcho(CPR)).toEqual({ consentRef: CPR });
    const e = consentRefEcho(REF);
    expect(e).toEqual({ consentRef: `${REF.kind}:${REF.id}`, productConsentRef: REF });
    expect(e.productConsentRef).not.toBe(REF);
  });

  it("is what BureauPullRequest takes; the old form is unchanged", () => {
    const req = (consentRef: unknown) => ({
      bureau: "cibil",
      enquiry: "soft",
      purpose: "new_credit",
      consentRef,
      subject: { subjectRef: "cus:1", kind: "individual", name: "Asha Rao", pan: "AAAPZ1234C" },
      reportPrefix: "tenant/tnt_udf/los/",
    });
    expect(BureauPullRequest.parse(req(CPR)).consentRef).toBe(CPR);
    expect(BureauPullRequest.parse(req(REF)).consentRef).toEqual(REF);
    expect(BureauPullRequest.safeParse(req(undefined)).success).toBe(false);
    expect(BureauPullRequest.safeParse(req({ kind: "cpr", id: "x01" })).success).toBe(false);
  });
});
