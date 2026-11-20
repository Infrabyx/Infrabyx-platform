// PR-UDF-053 (R1-D-219): §6.13 documents, the §6.2 eSign and eStamp evidence and the execution-pack
// manifest (plan `docs/phases/R1-udofin-phase8-plan.md` §E).
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_EVENTS,
  DOCUMENT_URL_MAX_TTL_SECONDS,
  DocumentRetrieval,
  DocumentSharedData,
  ESignCompletedData,
  EStampCompletedData,
  ExecutionPackManifest,
  ORIGINATION_EVENTS,
  ECOSYSTEM_TYPE_REGEX,
  STAMP_EVIDENCE_MODES,
  STAMP_EVIDENCE_MODE_OF,
  StampEvidence,
} from "./index.js";

const h = (c: string) => c.repeat(64);
const jws = "eyJhbGciOiJFUzI1NiJ9..c2ln";

const shared = {
  document_id: "doc_kfs_0001",
  version: 1,
  type: "KFS",
  sha256: h("a"),
  jws,
  retention_class: "LOAN_RECORD",
  legal_hold: false,
  media_type: "application/pdf",
  size_bytes: 1024,
};

const retrieval = {
  document_id: "doc_kfs_0001",
  version: 1,
  sha256: h("a"),
  jws,
  url: "https://documents.example.in/d/doc_kfs_0001?exp=1&sig=abc",
  issued_at: "2026-11-20T10:00:00+05:30",
  url_expires_at: "2026-11-20T10:15:00+05:30",
  data_residency: "IN",
};

const esign = {
  document_id: "doc_agr_0001",
  esp_txn_id: "ESP-TXN-12345",
  esp: "NSDL",
  signer_ref: "app_ref_primary",
  signing_method: "AADHAAR_OTP",
  signed_at: "2026-11-20T10:05:00+05:30",
  signed_sha256: h("b"),
  certificate: {
    serial_no: "0A1B2C",
    issuer: "CN=Example eSign CA",
    not_before: "2026-11-20T10:04:00+05:30",
    not_after: "2026-11-20T10:34:00+05:30",
    sha256: h("c"),
  },
};

const estamp = {
  document_id: "doc_agr_0001",
  certificate_no: "IN-MH12345678901234X",
  state: "IN-MH",
  duty_paise: 50_000,
  article: "5(h)",
  issued_at: "2026-11-20T09:00:00+05:30",
  stamp_mode: "E_STAMP",
};

const manifest = {
  pack_id: "pack_0001",
  version: 1,
  application_id: "app_0001",
  kfs_id: "kfs_0001",
  documents: [
    {
      document_id: "doc_agr_0001",
      version: 1,
      kind: "LOAN_AGREEMENT",
      sha256: h("d"),
      execution_mode: "ESIGN_AADHAAR",
      stamp_required: true,
      signers: ["BORROWER", "LENDER"],
    },
    {
      document_id: "doc_kfs_0001",
      version: 1,
      kind: "KFS",
      sha256: h("a"),
      execution_mode: "NONE",
      stamp_required: false,
      signers: [],
    },
  ],
  stamp: {
    state: "IN-MH",
    article: "5(h)",
    duty_paise: 50_000,
    mode: "E_STAMP",
    payer: "BORROWER",
  },
  summary_box: { document_id: "doc_agr_0001", page: 2 },
  covenant_declaration: { document_id: "doc_agr_0001", sha256: h("d") },
  countersignature: { required: true, by: "LENDER", order: "AFTER_BORROWER", within_days: 3 },
};

describe("§6.13 documents (PR-UDF-053)", () => {
  it("types DocumentShared as an Ecosystem type keyed by (document_id, version)", () => {
    expect(ECOSYSTEM_TYPE_REGEX.test(DOCUMENT_EVENTS.DocumentShared.type)).toBe(true);
    expect(DOCUMENT_EVENTS.DocumentShared.idempotency).toEqual(["document_id", "version"]);
    expect(DocumentSharedData.parse(shared).type).toBe("KFS");
  });

  it("refuses a DocumentShared without its JWS, with a non-hex hash or a joined JWS", () => {
    const { jws: _j, ...noJws } = shared;
    expect(DocumentSharedData.safeParse(noJws).success).toBe(false);
    expect(DocumentSharedData.safeParse({ ...shared, sha256: "Z".repeat(64) }).success).toBe(false);
    expect(DocumentSharedData.safeParse({ ...shared, jws: "a.b.c" }).success).toBe(false);
    expect(DocumentSharedData.safeParse({ ...shared, legal_hold: "no" }).success).toBe(false);
  });

  it("answers GET /v1/documents/{id} with an https URL living at most 15 minutes, hosted in India", () => {
    expect(DocumentRetrieval.parse(retrieval).data_residency).toBe("IN");
    expect(DOCUMENT_URL_MAX_TTL_SECONDS).toBe(900);
    const long = { ...retrieval, url_expires_at: "2026-11-20T10:15:01+05:30" };
    expect(DocumentRetrieval.safeParse(long).success).toBe(false);
    const back = { ...retrieval, url_expires_at: "2026-11-20T09:59:00+05:30" };
    expect(DocumentRetrieval.safeParse(back).success).toBe(false);
    expect(
      DocumentRetrieval.safeParse({ ...retrieval, url: "http://x.example.in/d" }).success,
    ).toBe(false);
    expect(DocumentRetrieval.safeParse({ ...retrieval, data_residency: "US" }).success).toBe(false);
  });
});

describe("§6.2 execution evidence (PR-UDF-053)", () => {
  it("registers ESignCompleted and EStampCompleted as signed LSP → lender events", () => {
    expect(ORIGINATION_EVENTS.ESignCompleted.type).toBe(
      "in.infrabyx.origination.ESignCompleted.v1",
    );
    expect(ORIGINATION_EVENTS.ESignCompleted.regulated).toBe(true);
    expect(ORIGINATION_EVENTS.ESignCompleted.direction).toBe("LSP_TO_LENDER");
    expect(ORIGINATION_EVENTS.ESignCompleted.idempotency).toEqual(["document_id", "esp_txn_id"]);
    expect(ORIGINATION_EVENTS.EStampCompleted.regulated).toBe(true);
    expect(ORIGINATION_EVENTS.EStampCompleted.idempotency).toEqual([
      "document_id",
      "certificate_no",
    ]);
  });

  it("takes an ESignCompleted with its certificate and signed hash, never a bare flag", () => {
    expect(ESignCompletedData.parse(esign).esp).toBe("NSDL");
    const { certificate: _c, ...noCert } = esign;
    expect(ESignCompletedData.safeParse(noCert).success).toBe(false);
    const { signed_sha256: _s, ...noHash } = esign;
    expect(ESignCompletedData.safeParse(noHash).success).toBe(false);
    expect(
      ESignCompletedData.safeParse({ document_id: "doc_agr_0001", signed: true }).success,
    ).toBe(false);
    expect(ESignCompletedData.safeParse({ ...esign, signing_method: "CLICK" }).success).toBe(false);
  });

  it("refuses an eSign made outside its certificate's validity", () => {
    expect(
      ESignCompletedData.safeParse({ ...esign, signed_at: "2026-11-20T11:00:00+05:30" }).success,
    ).toBe(false);
  });

  it("takes an EStampCompleted for an Indian State, refusing other codes and fractional duty", () => {
    expect(EStampCompletedData.parse(estamp).state).toBe("IN-MH");
    expect(EStampCompletedData.safeParse({ ...estamp, state: "MH" }).success).toBe(false);
    expect(EStampCompletedData.safeParse({ ...estamp, duty_paise: 10.5 }).success).toBe(false);
    expect(EStampCompletedData.safeParse({ ...estamp, stamp_mode: "SELF" }).success).toBe(false);
  });
});

describe("the execution-pack manifest (PR-UDF-053, proposal PR-047)", () => {
  it("takes a pack whose summary box, covenant and stamp rules hold", () => {
    const m = ExecutionPackManifest.parse(manifest);
    expect(m.documents).toHaveLength(2);
    expect(m.countersignature.order).toBe("AFTER_BORROWER");
  });

  it("refuses a summary box or covenant declaration outside the pack", () => {
    const off = { ...manifest, summary_box: { document_id: "doc_other", page: 1 } };
    expect(ExecutionPackManifest.safeParse(off).success).toBe(false);
    const cov = { ...manifest, covenant_declaration: { document_id: "doc_x", sha256: h("e") } };
    expect(ExecutionPackManifest.safeParse(cov).success).toBe(false);
  });

  it("refuses a stamp-required document without stamp details or an execution mode", () => {
    const { stamp: _s, ...noStamp } = manifest;
    expect(ExecutionPackManifest.safeParse(noStamp).success).toBe(false);
    const docs = manifest.documents.map((d, i) => (i === 0 ? { ...d, execution_mode: "NONE" } : d));
    expect(ExecutionPackManifest.safeParse({ ...manifest, documents: docs }).success).toBe(false);
  });

  it("refuses duplicate documents, an executed document without signers and an open countersignature", () => {
    const dup = { ...manifest, documents: [manifest.documents[0], manifest.documents[0]] };
    expect(ExecutionPackManifest.safeParse(dup).success).toBe(false);
    const docs = manifest.documents.map((d, i) => (i === 0 ? { ...d, signers: [] } : d));
    expect(ExecutionPackManifest.safeParse({ ...manifest, documents: docs }).success).toBe(false);
    const cs = { ...manifest, countersignature: { required: true } };
    expect(ExecutionPackManifest.safeParse(cs).success).toBe(false);
  });

  it("R1-D-229: takes an optional disbursement clause in a pack document, refusing one outside it or with bad fields", () => {
    const clause = {
      document_id: "doc_agr_0001",
      page_or_clause_ref: "cl.4.2",
      amount_stated_paise: 5_000_000,
    };
    const m = ExecutionPackManifest.parse({ ...manifest, disbursement_clause: clause });
    expect(m.disbursement_clause).toEqual(clause);
    expect(
      ExecutionPackManifest.safeParse({
        ...manifest,
        disbursement_clause: { ...clause, page_or_clause_ref: "p.3", amount_stated_paise: 0 },
      }).success,
    ).toBe(true);
    const off = ExecutionPackManifest.safeParse({
      ...manifest,
      disbursement_clause: { ...clause, document_id: "doc_other" },
    });
    expect(off.success).toBe(false);
    expect(off.error?.issues[0]?.path).toEqual(["disbursement_clause", "document_id"]);
    for (const bad of [
      { page_or_clause_ref: "" },
      { page_or_clause_ref: "x".repeat(65) },
      { amount_stated_paise: 100.5 },
      { amount_stated_paise: -1 },
    ])
      expect(
        ExecutionPackManifest.safeParse({
          ...manifest,
          disbursement_clause: { ...clause, ...bad },
        }).success,
      ).toBe(false);
  });

  const evidence = {
    mode: "ESTAMP",
    state: "IN-MH",
    certificate_number: "IN-MH12345678901234X",
    duty_paise: 50_000,
    stamped_document_sha256: h("d"),
    vendor_ref: "stv_shcil_1",
  };
  const withItems = (
    agreement: Record<string, unknown>,
    kfs: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    ...manifest,
    documents: [
      { ...manifest.documents[0], ...agreement },
      { ...manifest.documents[1], ...kfs },
    ],
  });

  it("R1-D-231: takes optional stamp evidence on one item and not_stampable with a reason on another", () => {
    const m = ExecutionPackManifest.parse(
      withItems(
        { stamp_evidence: evidence },
        { not_stampable: true, not_stampable_reason: "A disclosure, not an instrument" },
      ),
    );
    expect(m.documents[0]!.stamp_evidence).toEqual(evidence);
    expect(m.documents[1]!.not_stampable).toBe(true);
    const { vendor_ref: _v, ...noVendor } = evidence;
    for (const mode of STAMP_EVIDENCE_MODES)
      expect(
        ExecutionPackManifest.safeParse(
          withItems({ stamp_evidence: { ...noVendor, mode, duty_paise: 0 } }),
        ).success,
      ).toBe(true);
    expect(ExecutionPackManifest.safeParse(withItems({}, { not_stampable: false })).success).toBe(
      true,
    );
    // The pack-level stamp mode keeps its names; the map gives the evidence mode for each.
    expect(STAMP_EVIDENCE_MODE_OF).toEqual({
      E_STAMP: "ESTAMP",
      PHYSICAL_PAPER: "PAPER",
      FRANKING: "FRANKING",
    });
    expect(StampEvidence.parse(evidence).mode).toBe(STAMP_EVIDENCE_MODE_OF.E_STAMP);
  });

  it("R1-D-231: refuses bad stamp evidence fields", () => {
    for (const bad of [
      { mode: "E_STAMP" },
      { mode: "SELF" },
      { state: "MH" },
      { certificate_number: "AB" },
      { certificate_number: "IN MH 1" },
      { certificate_number: "x".repeat(65) },
      { duty_paise: -1 },
      { duty_paise: 10.5 },
      { stamped_document_sha256: "D".repeat(64) },
      { stamped_document_sha256: "d".repeat(63) },
      { vendor_ref: "x" },
    ])
      expect(
        ExecutionPackManifest.safeParse(withItems({ stamp_evidence: { ...evidence, ...bad } }))
          .success,
        JSON.stringify(bad),
      ).toBe(false);
  });

  it("R1-D-231: refuses not_stampable with stamp evidence, with stamp_required, or without a reason", () => {
    const reason = "Not chargeable";
    const both = ExecutionPackManifest.safeParse(
      withItems(
        {},
        { stamp_evidence: evidence, not_stampable: true, not_stampable_reason: reason },
      ),
    );
    expect(both.success).toBe(false);
    expect(both.error?.issues.map((i) => i.path)).toContainEqual([
      "documents",
      1,
      "stamp_evidence",
    ]);
    const required = ExecutionPackManifest.safeParse(
      withItems({ not_stampable: true, not_stampable_reason: reason }),
    );
    expect(required.success).toBe(false);
    expect(required.error?.issues.map((i) => i.path)).toContainEqual([
      "documents",
      0,
      "not_stampable",
    ]);
    for (const kfs of [
      { not_stampable: true },
      { not_stampable: true, not_stampable_reason: "" },
      { not_stampable: true, not_stampable_reason: "x".repeat(201) },
      { not_stampable_reason: reason },
      { not_stampable: false, not_stampable_reason: reason },
      { not_stampable: "yes", not_stampable_reason: reason },
    ])
      expect(ExecutionPackManifest.safeParse(withItems({}, kfs)).success, JSON.stringify(kfs)).toBe(
        false,
      );
  });
});
