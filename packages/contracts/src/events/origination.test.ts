// PR-UDF-051 (R1-D-217): the origination schemas of Ecosystem Spec §6.2 and §6.3.
import { describe, expect, it } from "vitest";
import { ECOSYSTEM_TYPE_REGEX } from "./envelope.js";
import {
  ApplicationStatusChangedData,
  BorrowerAcceptedData,
  DecisionMadeData,
  EligibilityCheckAnswer,
  EligibilityCheckRequest,
  KfsIssuedData,
  LoanDisbursedData,
  ORIGINATION_EVENTS,
  ORIGINATION_REGULATED,
  originationIdempotencyKey,
} from "./origination.js";
import { REGULATED_MESSAGE_EVENTS } from "./regulated.js";

const H = "a".repeat(64);
const T = "2026-11-20T10:00:00+05:30";

describe("origination schemas (PR-UDF-051)", () => {
  it("names every type as an Ecosystem type, v1, in its Specification domain", () => {
    for (const [name, s] of Object.entries(ORIGINATION_EVENTS)) {
      expect(s.type).toMatch(ECOSYSTEM_TYPE_REGEX);
      expect(s.type.endsWith(`.${name}.v1`)).toBe(true);
    }
    expect(ORIGINATION_EVENTS.LoanDisbursed.type).toBe("in.infrabyx.servicing.LoanDisbursed.v1");
    expect(ORIGINATION_EVENTS.CoolingOffExitRequested.type).toBe(
      "in.infrabyx.servicing.CoolingOffExitRequested.v1",
    );
    expect(ORIGINATION_EVENTS.KFSIssued.type).toBe("in.infrabyx.origination.KFSIssued.v1");
  });

  it("lists the six regulated messages, as the Specification's regulated list has them", () => {
    expect([...ORIGINATION_REGULATED].sort()).toEqual(
      [
        "DecisionMade",
        "EStampCompleted",
        "ESignCompleted",
        "KFSIssued",
        "LoanDisbursed",
        "SanctionLetterIssued",
      ].sort(),
    );
    for (const n of ORIGINATION_REGULATED)
      expect((REGULATED_MESSAGE_EVENTS as readonly string[]).includes(n)).toBe(true);
  });

  it("keys each event by the Specification's idempotency fields", () => {
    expect(ORIGINATION_EVENTS.KFSIssued.idempotency).toEqual(["kfs_id", "version"]);
    expect(ORIGINATION_EVENTS.LoanDisbursed.idempotency).toEqual(["loan_id", "utr"]);
    expect(
      originationIdempotencyKey("DecisionMade", { application_id: "app_1", decision_version: 2 }),
    ).toBe("application_id=app_1|decision_version=2");
  });

  it("takes the eligibility call's request and answer and refuses bad money, offers without eligibility and unknown outcomes", () => {
    const req = {
      lsp_ref: "lsp_1",
      product_code: "PL_STD",
      amount_paise: 5_000_000,
      tenor_months: 12,
      consentref: "cpr_1abc",
      fields: { income_band: "B3" },
    };
    expect(EligibilityCheckRequest.safeParse(req).success).toBe(true);
    for (const bad of [
      { amount_paise: 1.5 },
      { amount_paise: -1 },
      { tenor_months: 0 },
      { consentref: undefined },
    ])
      expect(
        EligibilityCheckRequest.safeParse({ ...req, ...bad }).success,
        JSON.stringify(bad),
      ).toBe(false);
    const ans = {
      check_id: "elc_1",
      outcome: "ELIGIBLE",
      offers: [{ offer_id: "ofr_1", amount_paise: 5_000_000, tenor_months: 12, apr_bp: 1800 }],
      reason_codes: [],
      rule_version: "bre-7",
      valid_until: T,
    };
    expect(EligibilityCheckAnswer.safeParse(ans).success).toBe(true);
    expect(EligibilityCheckAnswer.safeParse({ ...ans, outcome: "NOT_ELIGIBLE" }).success).toBe(
      false,
    );
    expect(EligibilityCheckAnswer.safeParse({ ...ans, outcome: "MAYBE" }).success).toBe(false);
    expect(EligibilityCheckAnswer.safeParse({ ...ans, offers: [], outcome: "REFER" }).success).toBe(
      true,
    );
  });

  it("takes the events' Specification fields and refuses wrong types and values", () => {
    expect(
      KfsIssuedData.safeParse({
        kfs_id: "kfs_1",
        version: 1,
        application_id: "app_1",
        proposal_no: "PRP-1",
        validity_expiry: T,
        apr_bp: 1800,
        document_sha256: H,
      }).success,
    ).toBe(true);
    expect(
      KfsIssuedData.safeParse({
        kfs_id: "kfs_1",
        version: 1,
        application_id: "app_1",
        proposal_no: "P1",
        validity_expiry: T,
        apr_bp: 18.5,
        document_sha256: H,
      }).success,
    ).toBe(false);
    expect(
      DecisionMadeData.safeParse({
        application_id: "app_1",
        decision_version: 1,
        decision: "REJECTED",
        reason_codes: ["POLICY"],
        rule_version: "r",
        offers: [{ offer_id: "o_1", amount_paise: 1, tenor_months: 1, apr_bp: 1 }],
      }).success,
    ).toBe(false);
    expect(
      ApplicationStatusChangedData.safeParse({
        application_id: "app_1",
        seq: 1,
        from: "SUBMITTED",
        to: "SUBMITTED",
      }).success,
    ).toBe(false);
    expect(
      BorrowerAcceptedData.safeParse({
        kfs_id: "kfs_1",
        accepted_at: T,
        explanation_acknowledged: false,
      }).success,
    ).toBe(false);
    const ld = {
      loan_id: "ln_1",
      utr: "UTR000000000123",
      amount_paise: 5_000_000,
      value_date: "2026-11-20",
      beneficiary_type: "BORROWER",
      kind: "INITIAL",
      cooling_off_end: T,
    };
    expect(LoanDisbursedData.safeParse(ld).success).toBe(true);
    expect(LoanDisbursedData.safeParse({ ...ld, kind: "REFUND" }).success).toBe(false);
    expect(LoanDisbursedData.safeParse({ ...ld, utr: "utr lower" }).success).toBe(false);
    // An id that is a person's number standing alone is not an id shape the schemas accept in hashes.
    expect(
      KfsIssuedData.safeParse({
        kfs_id: "kfs_1",
        version: 1,
        application_id: "app_1",
        proposal_no: "P1",
        validity_expiry: T,
        apr_bp: 1,
        document_sha256: "XYZ",
      }).success,
    ).toBe(false);
  });
});
