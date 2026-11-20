// PR-UDF-051 (R1-D-217): the origination schemas of Ecosystem Spec §6.2 and §6.3.
import { describe, expect, it } from "vitest";
import { ECOSYSTEM_TYPE_REGEX } from "./envelope.js";
import {
  ApplicationStatusChangedData,
  ApplicationSubmittedData,
  CoolingOffExitAnsweredData,
  CoolingOffExitRequestedData,
  PRODUCT_CODE_PATTERN,
  SanctionLetterIssuedData,
  BorrowerAcceptedData,
  DecisionMadeData,
  EligibilityCheckAnswer,
  EligibilityCheckRequest,
  INSTALMENT_FREQUENCIES,
  KfsIssuedData,
  LoanDisbursedData,
  ORIGINATION_EVENTS,
  ORIGINATION_REGULATED,
  OriginationOffer,
  PENAL_CHARGE_BASES,
  originationIdempotencyKey,
  originationSubject,
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

  it("lists the eight regulated messages, as the Specification's regulated list has them", () => {
    expect([...ORIGINATION_REGULATED].sort()).toEqual(
      [
        "CoolingOffExitAnswered",
        "ExecutionPackIssued",
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

  it("R1-D-229: takes an optional KFS loan amount in integer paise and refuses a fractional or negative one", () => {
    const kfs = {
      kfs_id: "kfs_1",
      version: 1,
      application_id: "app_1",
      proposal_no: "PRP-1",
      validity_expiry: T,
      apr_bp: 1800,
      document_sha256: H,
    };
    expect(KfsIssuedData.safeParse(kfs).success).toBe(true);
    expect(KfsIssuedData.parse({ ...kfs, loan_amount_paise: 5_000_000 }).loan_amount_paise).toBe(
      5_000_000,
    );
    for (const bad of [5_000_000.5, -100, 0, "5000000"])
      expect(KfsIssuedData.safeParse({ ...kfs, loan_amount_paise: bad }).success).toBe(false);
  });

  it("R1-D-231: takes an offer's optional instalment, penal charges and KFS link, in both offer lists", () => {
    const base = { offer_id: "ofr_1", amount_paise: 5_000_000, tenor_months: 12, apr_bp: 1800 };
    const full = {
      ...base,
      monthly_instalment: { amount_paise: 458_400, frequency: "MONTHLY" },
      penal_charges: [
        { basis: "PER_MONTH_ON_OVERDUE", rate_bp: 200, description: "2% a month on the overdue" },
        { basis: "PER_INSTANCE", amount_paise: 50_000, description: "Per bounced instalment" },
      ],
      kfs_link: { document_id: "doc_kfs_0001", version: 1 },
    };
    expect(OriginationOffer.safeParse(base).success).toBe(true);
    expect(OriginationOffer.parse(full)).toEqual(full);
    expect(
      OriginationOffer.safeParse({ ...base, kfs_link: { document_id: "doc_k1" } }).success,
    ).toBe(true);
    for (const f of INSTALMENT_FREQUENCIES)
      expect(
        OriginationOffer.safeParse({
          ...base,
          monthly_instalment: { amount_paise: 1, frequency: f },
        }).success,
      ).toBe(true);
    expect(PENAL_CHARGE_BASES).toContain("PER_MONTH_ON_OVERDUE");
    const answer = {
      check_id: "elc_1",
      outcome: "ELIGIBLE",
      offers: [full],
      reason_codes: [],
      rule_version: "bre-7",
      valid_until: T,
    };
    expect(EligibilityCheckAnswer.safeParse(answer).success).toBe(true);
    const decision = {
      application_id: "app_1",
      decision_version: 1,
      decision: "SANCTIONED",
      reason_codes: [],
      rule_version: "bre-7",
      offers: [full],
    };
    expect(DecisionMadeData.safeParse(decision).success).toBe(true);
    expect(
      DecisionMadeData.safeParse({
        ...decision,
        offers: [{ ...full, monthly_instalment: { amount_paise: 1.5, frequency: "MONTHLY" } }],
      }).success,
    ).toBe(false);
    expect(
      EligibilityCheckAnswer.safeParse({
        ...answer,
        offers: [{ ...full, kfs_link: { document_id: "https://x.example.in/k" } }],
      }).success,
    ).toBe(false);
  });

  it("R1-D-231: refuses a bad instalment, a penal charge without exactly one of rate or amount, and a URL as a KFS link", () => {
    const base = { offer_id: "ofr_1", amount_paise: 5_000_000, tenor_months: 12, apr_bp: 1800 };
    const charge = { basis: "FLAT", amount_paise: 50_000, description: "Flat charge" };
    const bad: Array<Record<string, unknown>> = [
      { monthly_instalment: { amount_paise: 0, frequency: "MONTHLY" } },
      { monthly_instalment: { amount_paise: 100.5, frequency: "MONTHLY" } },
      { monthly_instalment: { amount_paise: 100, frequency: "WEEKLY" } },
      { monthly_instalment: { amount_paise: 100 } },
      { penal_charges: [{ ...charge, rate_bp: 200 }] },
      { penal_charges: [{ basis: "FLAT", description: "Neither" }] },
      { penal_charges: [{ basis: "FLAT", rate_bp: 2.5, description: "Fractional rate" }] },
      { penal_charges: [{ ...charge, basis: "per_instance" }] },
      { penal_charges: [{ ...charge, description: "" }] },
      { penal_charges: [{ ...charge, description: "x".repeat(201) }] },
      { penal_charges: [{ ...charge, amount_paise: -1 }] },
      { penal_charges: Array.from({ length: 21 }, () => charge) },
      { kfs_link: { document_id: "https://lender.example.in/kfs.pdf" } },
      { kfs_link: { document_id: "https:lender.example.in" } },
      { kfs_link: { document_id: "storage:tenant.x" } },
      { kfs_link: { document_id: "www.lender.example.in" } },
      { kfs_link: { document_id: "doc_kfs_0001", url: "https://lender.example.in/kfs.pdf" } },
      { kfs_link: { document_id: "doc_kfs_0001", version: 0 } },
      { kfs_link: { version: 1 } },
      { kfs_link: "doc_kfs_0001" },
    ];
    for (const b of bad)
      expect(OriginationOffer.safeParse({ ...base, ...b }).success, JSON.stringify(b)).toBe(false);
    expect(
      OriginationOffer.safeParse({
        ...base,
        penal_charges: Array.from({ length: 20 }, () => charge),
      }).success,
    ).toBe(true);
  });
});

// PR-UDF-061 (owner, 20 Nov 2026 14:30; R1-D-232): Udofin's udf_ext v1 list, all optional.
describe("the udf_ext v1 fields (PR-UDF-061)", () => {
  const offer = { offer_id: "ofr_0001", amount_paise: 5_000_000, tenor_months: 12, apr_bp: 1800 };
  const submitted = {
    lsp_application_ref: "lspapp_1",
    applicants: [{ applicant_ref: "cus_1", role: "PRIMARY" }],
    kyc_evidence_refs: [],
    bureau_refs: [],
    aa_refs: [],
    documents: [],
    consents: ["cpr_bureau", "cpr_aa"],
  };
  const kfs = {
    kfs_id: "kfs_1",
    version: 1,
    application_id: "app_1",
    proposal_no: "prp_1",
    validity_expiry: T,
    apr_bp: 1800,
    document_sha256: H,
  };
  const inst = (seq: number, due: string) => ({ seq, due_date: due, amount_paise: 45_840 });

  it("takes two-character product codes and every earlier reference", () => {
    for (const c of ["PL", "P1", "PL_STD", "A".repeat(16), "pl-01", "prd:v2"])
      expect(EligibilityCheckRequest.shape.product_code.safeParse(c).success, c).toBe(true);
    for (const c of ["P", "pl", "1P", "P-", ""])
      expect(EligibilityCheckRequest.shape.product_code.safeParse(c).success, c).toBe(false);
    expect(PRODUCT_CODE_PATTERN.test("PL")).toBe(true);
  });

  it("takes an offer's instalment figure, penal-charges text and KFS URL, and refuses a disagreeing instalment or a non-https URL", () => {
    const good = {
      ...offer,
      monthly_instalment_paise: 45_840,
      monthly_instalment: { amount_paise: 45_840, frequency: "MONTHLY" },
      penal_charges_text: "2% a month on the overdue instalment.",
      kfs_url: "https://documents.lender.example.in/kfs/1",
    };
    expect(OriginationOffer.safeParse(good).success).toBe(true);
    expect(OriginationOffer.safeParse({ ...offer, monthly_instalment_paise: 1 }).success).toBe(
      true,
    );
    for (const b of [
      { monthly_instalment: { amount_paise: 45_841, frequency: "MONTHLY" } },
      { monthly_instalment: { amount_paise: 45_840, frequency: "QUARTERLY" } },
      { kfs_url: "http://documents.lender.example.in/kfs/1" },
      { kfs_url: "https://user:pw@documents.lender.example.in/kfs/1" },
      { kfs_url: "https://documents.lender.example.in/kfs/1#p2" },
      { kfs_url: "doc_kfs_0001" },
      { penal_charges_text: "" },
      { penal_charges_text: "bad\u0007bell" },
      { monthly_instalment_paise: 0 },
    ])
      expect(OriginationOffer.safeParse({ ...good, ...b }).success, JSON.stringify(b)).toBe(false);
  });

  it("takes ApplicationSubmitted's chosen offer, request, profile, household, KYC, credit modes and consent purposes", () => {
    const full = {
      ...submitted,
      offer_ref: "ofr_0001",
      product_code: "PL",
      request: { amount_paise: 5_000_000, tenor_days: 365, purpose: "PERSONAL" },
      economic_profile: {
        age_years: 32,
        occupation: "SALARIED",
        monthly_income_paise: 6_000_000,
        income_source: "SALARY",
      },
      household: {
        household_ref: "hh_1",
        monthly_household_income_paise: 9_000_000,
        is_microfinance: false,
      },
      kyc: { level: "FULL_KYC", state: "VERIFIED" },
      credit_data_modes: { bureau: true, aa: false },
      consent_purposes: [{ purpose: "BUREAU_PULL", consent_ref: "cpr_bureau" }],
    };
    expect(ApplicationSubmittedData.safeParse(full).success).toBe(true);
    expect(ApplicationSubmittedData.safeParse(submitted).success).toBe(true);
    for (const b of [
      { consent_purposes: [{ purpose: "BUREAU_PULL", consent_ref: "cpr_other" }] },
      { economic_profile: { age_years: 17 } },
      { economic_profile: { monthly_income_paise: -1 } },
      { request: { amount_paise: 5_000_000, tenor_days: 0, purpose: "PERSONAL" } },
      { request: { amount_paise: 5_000_000, tenor_days: 30, purpose: "personal" } },
      { credit_data_modes: { bureau: true } },
      { credit_data_modes: { bureau: true, aa: false, gst: true } },
      { household: { monthly_household_income_paise: 1 } },
      { product_code: "p" },
    ])
      expect(ApplicationSubmittedData.safeParse({ ...full, ...b }).success, JSON.stringify(b)).toBe(
        false,
      );
  });

  it("takes BorrowerAccepted's KFS version, hash and acknowledgement time, not after acceptance", () => {
    const b = {
      kfs_id: "kfs_1",
      accepted_at: "2026-11-20T10:00:00+05:30",
      explanation_acknowledged: true,
      lsp_application_ref: "lspapp_1",
      kfs_version: 1,
      kfs_sha256: H,
      acknowledged_at: "2026-11-20T09:59:00+05:30",
      device_ref: "dev_1",
    };
    expect(BorrowerAcceptedData.safeParse(b).success).toBe(true);
    expect(
      BorrowerAcceptedData.safeParse({ ...b, acknowledged_at: "2026-11-20T10:00:01+05:30" })
        .success,
    ).toBe(false);
    expect(BorrowerAcceptedData.safeParse({ ...b, kfs_sha256: "A".repeat(64) }).success).toBe(
      false,
    );
  });

  it("answers an exit request with an amount, a reference and a plain-text instruction with no link", () => {
    expect(ORIGINATION_EVENTS.CoolingOffExitAnswered).toMatchObject({
      type: "in.infrabyx.servicing.CoolingOffExitAnswered.v1",
      idempotency: ["loan_id", "exit_ref"],
      direction: "LENDER_TO_LSP",
      // Signed from Spec v1.6 (PR-047 approved, owner 20 Nov 2026 18:50; R1-D-236).
      regulated: true,
    });
    const a = {
      loan_id: "ln_1",
      exit_ref: "ext_1",
      exit_amount_paise: 5_001_200,
      payment_instruction: "Pay by NEFT to the lender's loan account quoting ext_1.",
      answered_at: T,
      lsp_application_ref: "lspapp_1",
    };
    expect(CoolingOffExitAnsweredData.safeParse(a).success).toBe(true);
    for (const text of [
      "Pay at https://pay.example.in/x",
      "Pay at www.example.in",
      "Pay at pay.example.in/x",
      "Pay with upi:pay?pa=x@y",
      "Open intent://pay",
      "",
    ])
      expect(
        CoolingOffExitAnsweredData.safeParse({ ...a, payment_instruction: text }).success,
        text,
      ).toBe(false);
    expect(CoolingOffExitAnsweredData.safeParse({ ...a, exit_amount_paise: 1.5 }).success).toBe(
      false,
    );
    expect(
      CoolingOffExitRequestedData.safeParse({
        loan_id: "ln_1",
        requested_at: T,
        evidence: { sha256: H, uri: "storage:x/1.pdf" },
        lsp_application_ref: "lspapp_1",
      }).success,
    ).toBe(true);
  });

  it("takes the lender's status and reason texts, the latter only for codes it sent, once each", () => {
    expect(
      ApplicationStatusChangedData.safeParse({
        application_id: "app_1",
        seq: 1,
        from: "SUBMITTED",
        to: "UNDER_REVIEW",
        status_text: "Your application is with our credit team.",
      }).success,
    ).toBe(true);
    const d = {
      application_id: "app_1",
      decision_version: 1,
      decision: "REJECTED",
      reason_codes: ["POLICY_DECLINE"],
      rule_version: "r1",
      offers: [],
    };
    expect(
      DecisionMadeData.safeParse({
        ...d,
        reason_texts: [{ reason_code: "POLICY_DECLINE", text: "Outside our lending policy." }],
      }).success,
    ).toBe(true);
    for (const rt of [
      [{ reason_code: "OTHER", text: "Not a sent code" }],
      [
        { reason_code: "POLICY_DECLINE", text: "a" },
        { reason_code: "POLICY_DECLINE", text: "b" },
      ],
    ])
      expect(DecisionMadeData.safeParse({ ...d, reason_texts: rt }).success).toBe(false);
  });

  it("takes the KFS's schedule, charges, cooling-off, exit terms and Annex items, and refuses inconsistent ones", () => {
    const full = {
      ...kfs,
      issued_at: T,
      language: "en-IN",
      document_ref: "doc_kfs_1",
      tenor_days: 365,
      loan_amount_paise: 5_000_000,
      cash_flows: {
        net_disbursed_paise: 4_950_000,
        instalments: [
          { ...inst(1, "2026-12-20"), principal_paise: 38_340, interest_paise: 7_500 },
          inst(2, "2027-01-20"),
        ],
      },
      charges: [
        {
          code: "PROCESSING_FEE",
          description: "Processing fee",
          amount_paise: 50_000,
          payable_to: "RE",
          recurrence: "ONE_TIME",
        },
        { code: "STAMP_DUTY", description: "At actuals", payable_to: "THIRD_PARTY" },
      ],
      cooling_off_days: 3,
      exit_terms: "Repay the principal and the proportionate APR within the cooling-off period.",
      nodal_gro: {
        name: "Grievance Officer",
        designation: "Nodal Officer",
        phone: "+91 22 0000 0000",
        email: "gro@lender.example.in",
      },
      co_lending: {
        parties: [
          { name: "Bank A", share_bp: 8_000, rate_bp: 1_600 },
          { name: "NBFC B", share_bp: 2_000, rate_bp: 2_400 },
        ],
        blended_rate_bp: 1_760,
      },
      lsp_recovery_agent: [{ role: "LSP", name: "LSP Ltd", functions: "Sourcing" }],
    };
    expect(KfsIssuedData.safeParse(full).success).toBe(true);
    for (const b of [
      { cash_flows: { net_disbursed_paise: 5_000_001, instalments: [] } },
      {
        cash_flows: {
          net_disbursed_paise: 1,
          instalments: [inst(2, "2027-01-20"), inst(1, "2026-12-20")],
        },
      },
      {
        cash_flows: {
          net_disbursed_paise: 1,
          instalments: [{ ...inst(1, "2026-12-20"), principal_paise: 1, interest_paise: 1 }],
        },
      },
      {
        co_lending: {
          parties: [
            { name: "A", share_bp: 8_000 },
            { name: "B", share_bp: 1_000 },
          ],
        },
      },
      { co_lending: { parties: [{ name: "A", share_bp: 10_000 }] } },
      { language: "English" },
      { document_ref: "https://lender.example.in/kfs.pdf" },
      { nodal_gro: { name: "x", email: "not-an-email" } },
      { cooling_off_days: -1 },
      { charges: [{ code: "FEE", description: "" }] },
      { lsp_recovery_agent: [{ role: "COLLECTOR", name: "x" }] },
    ])
      expect(KfsIssuedData.safeParse({ ...full, ...b }).success, JSON.stringify(b)).toBe(false);
  });

  it("takes the sanction letter's document reference and LoanDisbursed's application id and time", () => {
    const s = {
      sanction_id: "snc_1",
      version: 1,
      application_id: "app_1",
      terms: { amount_paise: 5_000_000, tenor_months: 12, apr_bp: 1800 },
      document_sha256: H,
    };
    expect(SanctionLetterIssuedData.safeParse({ ...s, document_ref: "doc_snc_1" }).success).toBe(
      true,
    );
    expect(
      SanctionLetterIssuedData.safeParse({ ...s, document_ref: "https://x.in/a" }).success,
    ).toBe(false);
    expect(
      LoanDisbursedData.safeParse({
        loan_id: "ln_1",
        utr: "UTR123456789012",
        amount_paise: 5_000_000,
        value_date: "2026-11-20",
        beneficiary_type: "BORROWER",
        kind: "INITIAL",
        cooling_off_end: T,
        application_id: "app_1",
        disbursed_at: T,
      }).success,
    ).toBe(true);
  });
});

describe("PR-UDF-061 items 12 to 17 (owner, 20 Nov 2026 18:50; R1-D-236)", () => {
  it("registers ExecutionPackIssued as a signed lender → LSP §6.2 event keyed (pack_id, version)", () => {
    expect(ORIGINATION_EVENTS.ExecutionPackIssued).toMatchObject({
      type: "in.infrabyx.origination.ExecutionPackIssued.v1",
      idempotency: ["pack_id", "version"],
      direction: "LENDER_TO_LSP",
      regulated: true,
      subject: "application_id",
    });
  });

  it("names every event's subject field: its aggregate, the application or the loan (§3.2)", () => {
    const subjects = Object.fromEntries(
      Object.entries(ORIGINATION_EVENTS).map(([n, e]) => [n, e.subject]),
    );
    expect(subjects).toEqual({
      ApplicationSubmitted: "lsp_application_ref",
      ApplicationStatusChanged: "application_id",
      AdditionalInfoRequested: "application_id",
      DecisionMade: "application_id",
      KFSIssued: "application_id",
      SanctionLetterIssued: "application_id",
      ExecutionPackIssued: "application_id",
      BorrowerAccepted: "lsp_application_ref",
      ESignCompleted: "application_id",
      EStampCompleted: "application_id",
      CoolingOffExitRequested: "loan_id",
      CoolingOffExitAnswered: "loan_id",
      LoanDisbursed: "loan_id",
    });
    // Every lender-produced origination event that carries application_id is on it.
    for (const [n, e] of Object.entries(ORIGINATION_EVENTS))
      if (e.direction === "LENDER_TO_LSP" && e.type.includes(".origination."))
        expect(e.subject, n).toBe("application_id");
    const kfs = { kfs_id: "kfs_1", application_id: "app_1" };
    expect(originationSubject("KFSIssued", kfs)).toBe("app_1");
    expect(originationSubject("AdditionalInfoRequested", { application_id: "app_1" })).toBe(
      "app_1",
    );
    // The fallbacks, where the Specification makes the aggregate's field optional.
    expect(
      originationSubject("BorrowerAccepted", { kfs_id: "kfs_1", lsp_application_ref: "lsp_1" }),
    ).toBe("lsp_1");
    expect(originationSubject("BorrowerAccepted", { kfs_id: "kfs_1" })).toBe("kfs_1");
    expect(
      originationSubject("ESignCompleted", { document_id: "doc_1", application_id: "app_1" }),
    ).toBe("app_1");
    expect(originationSubject("EStampCompleted", { document_id: "doc_1" })).toBe("doc_1");
    expect(() => originationSubject("LoanDisbursed", { utr: "X" })).toThrow(/loan_id/);
    expect(() => originationSubject("KFSIssued", { kfs_id: "kfs_1" })).toThrow(/application_id/);
  });

  it("takes the KFS's and the sanction letter's document version beside the reference, refusing a bad one", () => {
    const k = {
      kfs_id: "kfs_1",
      version: 1,
      application_id: "app_1",
      proposal_no: "PRP-1",
      validity_expiry: T,
      apr_bp: 1800,
      document_sha256: H,
    };
    expect(
      KfsIssuedData.safeParse({ ...k, document_ref: "doc_kfs_1", document_version: 2 }).success,
    ).toBe(true);
    const s = {
      sanction_id: "snc_1",
      version: 1,
      application_id: "app_1",
      terms: { amount_paise: 5_000_000, tenor_months: 12, apr_bp: 1800 },
      document_sha256: H,
    };
    expect(
      SanctionLetterIssuedData.safeParse({ ...s, document_ref: "doc_snc_1", document_version: 1 })
        .success,
    ).toBe(true);
    for (const v of [0, 1.5, "1"]) {
      expect(KfsIssuedData.safeParse({ ...k, document_version: v }).success).toBe(false);
      expect(SanctionLetterIssuedData.safeParse({ ...s, document_version: v }).success).toBe(false);
    }
  });
});
