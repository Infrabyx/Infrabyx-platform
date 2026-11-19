// PR-UDF-049 (R1-D-203, owner answer #153): `consentRef` unchanged, the optional `consentArtefact`
// beside it, and what an artefact may not hold.
import { describe, expect, it } from "vitest";
import { verhoeffValid } from "../aadhaar.js";
import { BureauPullRequest } from "./credit-bureau.js";
import { AaConsentRequest } from "./account-aggregator.js";
import {
  ConsentArtefact,
  consentArtefactProblem,
  consentEcho,
  consentInForce,
} from "./consent-ref.js";

const CPR = "cpr_01JA0000000000000000000000";
const REF = { kind: "udf.purpose_consent", id: "pcn_01JA0000000000000000000000" };

/** A 12-digit number that reads as an Aadhaar number, built at run time. */
const aadhaarLike = (): string => {
  const head = "2" + "3456789034";
  for (let d = 0; d < 10; d++) if (verhoeffValid(head + d)) return head + d;
  throw new Error("unreachable");
};

describe("ConsentArtefact (PR-UDF-049)", () => {
  it("accepts a product's own artefact", () => {
    expect(ConsentArtefact.parse(REF)).toEqual(REF);
    for (const ok of [
      { kind: "udf", id: "abc" },
      { kind: "fbx.consent.v2", id: "A.b_c-9" },
      { kind: "a_b.c_d.e_f.g_h", id: "x".repeat(128) },
    ])
      expect(ConsentArtefact.safeParse(ok).success, JSON.stringify(ok)).toBe(true);
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
      const r = ConsentArtefact.safeParse(bad);
      expect(r.success, JSON.stringify(bad)).toBe(false);
      expect(r.error?.issues.map((i) => i.message)).toContain(label);
      // The issue names the rule, never the value.
      expect(JSON.stringify(r.error?.issues)).not.toContain(a);
    }
    // A PAN-shaped run or ten digits inside a longer identifier (a ULID) are not standing alone.
    expect(consentArtefactProblem("udf.consent", "01JABCPE1234FXYZ")).toBeUndefined();
    expect(consentArtefactProblem("udf.consent", "pcn_01JA9876543210XYZ")).toBeUndefined();
  });

  it("refuses unknown fields, any string (a `cpr_` included) and the wrong types", () => {
    for (const bad of [
      { ...REF, purpose: "bureau" },
      { kind: REF.kind },
      { id: REF.id },
      "pcn-1",
      CPR,
      `${REF.kind}:${REF.id}`,
      { kind: 1, id: "pcn-1" },
      { kind: "udf.consent", id: "p".repeat(129) },
      null,
    ])
      expect(ConsentArtefact.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it("keeps and echoes the artefact when present, else `consentRef`", () => {
    expect(consentInForce({ consentRef: CPR })).toBe(CPR);
    expect(consentInForce({ consentRef: CPR, consentArtefact: REF })).toBe(
      `udf.purpose_consent:${REF.id}`,
    );
    expect(consentEcho({ consentRef: CPR })).toEqual({ consentRef: CPR });
    expect(consentEcho({ consentRef: CPR, consentArtefact: undefined })).toEqual({
      consentRef: CPR,
    });
    const e = consentEcho({ consentRef: CPR, consentArtefact: REF });
    expect(e).toEqual({ consentRef: CPR, consentArtefact: REF });
    expect(e.consentArtefact).not.toBe(REF);
  });

  it("leaves `consentRef` exactly as it was on BureauPullRequest and AaConsentRequest", () => {
    const pull = (extra: Record<string, unknown>) => ({
      bureau: "cibil",
      enquiry: "soft",
      purpose: "new_credit",
      consentRef: CPR,
      subject: { subjectRef: "cus:1", kind: "individual", name: "Asha Rao", pan: "AAAPZ1234C" },
      reportPrefix: "tenant/tnt_udf/los/",
      ...extra,
    });
    expect(BureauPullRequest.parse(pull({})).consentRef).toBe(CPR);
    expect("consentArtefact" in BureauPullRequest.parse(pull({}))).toBe(false);
    expect(BureauPullRequest.parse(pull({ consentArtefact: REF }))).toMatchObject({
      consentRef: CPR,
      consentArtefact: REF,
    });
    // `consentRef` is still required and still only a `cpr_`, with or without an artefact.
    for (const consentRef of [undefined, REF, "pcn-1", `${REF.kind}:${REF.id}`])
      expect(
        BureauPullRequest.safeParse(pull({ consentRef, consentArtefact: REF })).success,
        JSON.stringify(consentRef),
      ).toBe(false);
    expect(
      BureauPullRequest.safeParse(pull({ consentArtefact: { kind: "cpr", id: "x01" } })).success,
    ).toBe(false);
    const ask = (extra: Record<string, unknown>) => ({
      customerHandle: "asha.rao@setu",
      subjectRef: "cus:1",
      consentRef: CPR,
      purposeCode: "101",
      fiTypes: ["DEPOSIT"],
      fetchType: "ONETIME",
      dataRange: { from: "2026-11-18T00:00:00.000Z", to: "2026-11-19T00:00:00.000Z" },
      dataLife: { unit: "MONTH", value: 1 },
      consentStart: "2026-11-19T00:00:00.000Z",
      consentExpiry: "2026-11-20T00:00:00.000Z",
      ...extra,
    });
    expect(AaConsentRequest.parse(ask({})).consentRef).toBe(CPR);
    expect(AaConsentRequest.parse(ask({ consentArtefact: REF })).consentArtefact).toEqual(REF);
    for (const consentRef of [undefined, REF, "pcn-1"])
      expect(
        AaConsentRequest.safeParse(ask({ consentRef, consentArtefact: REF })).success,
        JSON.stringify(consentRef),
      ).toBe(false);
  });
});
