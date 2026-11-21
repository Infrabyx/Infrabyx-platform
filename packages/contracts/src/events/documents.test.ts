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
  CF_PARA_9_3_DOCUMENT_KINDS,
  ExecutionPackIssuedData,
  IT_ACT_FIRST_SCHEDULE_INSTRUMENTS,
  PACK_SIGNER_ROLES,
  PackStampEvidence,
  PACK_PHYSICAL_REASONS,
  PACK_RE_INSTRUCTIONS_MAX,
  CoolingOffExitAnsweredData,
  ESTAMP_SYSTEMS,
  NOT_STAMPABLE_REASON_CODES,
  parsePageOrClauseRef,
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

// ---- PR-UDF-061 items 12 and 13 (owner, 20 Nov 2026 18:50; R1-D-236) ---------------------------

const kfsHash = h("a");
const doc = (id: string, kind: string, over: Record<string, unknown> = {}) => ({
  document_id: id,
  version: 1,
  kind,
  sha256: kind === "KFS" ? kfsHash : h("e"),
  execution_mode: "NONE",
  stamp_required: false,
  signers: [] as string[],
  ...over,
});
const stampEvidence = {
  channel: "E_STAMP",
  certificate_no: "IN-MH12345678901234X",
  state: "IN-MH",
  duty_paise: 50_000,
  stated_duty_paise: 50_000,
  stamped_document_sha256: h("d"),
  issued_at: "2026-11-20T09:00:00+05:30",
  vendor_certificate_id: "SHCIL/2026/0001",
  certificate_document_id: "doc_cert_0001",
};
const issued = {
  pack_id: "pack_0001",
  version: 1,
  application_id: "app_0001",
  kfs_id: "kfs_0001",
  kfs_version: 1,
  kfs_sha256: kfsHash,
  sanction_id: "snc_0001",
  documents: [
    doc("doc_agr_0001", "LOAN_AGREEMENT", {
      sha256: h("d"),
      execution_mode: "ESIGN_AADHAAR",
      stamp_required: true,
      signers: ["BORROWER", "LENDER"],
      instrument_code: "LOAN_AGREEMENT",
      stamp_evidence: stampEvidence,
    }),
    doc("doc_kfs_0001", "KFS", { enclosure_code: "ANNEX_A" }),
    doc("doc_snc_0001", "SANCTION_LETTER", { enclosure_code: "ANNEX_B" }),
    doc("doc_tnc_0001", "TERMS_AND_CONDITIONS", { enclosure_code: "ANNEX_C" }),
    doc("doc_sum_0001", "PRODUCT_SUMMARY"),
    doc("doc_prv_0001", "PRIVACY_POLICY"),
  ],
  stamp: {
    state: "IN-MH",
    article: "5(h)",
    duty_paise: 50_000,
    mode: "E_STAMP",
    payer: "BORROWER",
  },
  summary_box: { document_id: "doc_agr_0001", page: 2 },
  covenant: { business_purpose: false, declared: false },
  enclosure_list: [
    { code: "ANNEX_A", clause_ref: "cl.1.2" },
    { code: "ANNEX_B", clause_ref: "cl.1.3" },
    { code: "ANNEX_C", clause_ref: "cl.1.4" },
  ],
  not_stampable: [
    { document_id: "doc_kfs_0001", reason: "A disclosure statement, not an instrument" },
    { document_id: "doc_prv_0001", reason: "A policy notice, not an instrument" },
  ],
  countersignature: { required: true, by: "LENDER", order: "AFTER_BORROWER", within_days: 3 },
  disbursement_clause: {
    document_id: "doc_agr_0001",
    page_or_clause_ref: "cl.4.2",
    amount_stated_paise: 5_000_000,
  },
};
const withDoc = (i: number, over: Record<string, unknown>) => ({
  ...issued,
  documents: issued.documents.map((d, j) => (j === i ? { ...d, ...over } : d)),
});
const ok = (v: unknown) => ExecutionPackIssuedData.safeParse(v).success;
const decl = { document_id: "doc_agr_0001", sha256: h("d") };

describe("ExecutionPackIssued (PR-047 approved; PR-UDF-061 item 12)", () => {
  it("is registered signed and takes the full pack: accepted KFS, CF para 9(3) set, enclosures, stamp evidence, not-stampable list", () => {
    expect(ORIGINATION_EVENTS.ExecutionPackIssued.regulated).toBe(true);
    const r = ExecutionPackIssuedData.safeParse(issued);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    expect(issued.documents.map((d) => d.kind)).toEqual([...CF_PARA_9_3_DOCUMENT_KINDS]);
    expect(PACK_SIGNER_ROLES).toEqual(["BORROWER", "CO_APPLICANT", "GUARANTOR", "LENDER"]);
  });

  it("needs the accepted KFS's version and hash, and a KFS document with that hash", () => {
    for (const k of ["kfs_version", "kfs_sha256", "covenant", "enclosure_list"] as const) {
      const v: Record<string, unknown> = { ...issued };
      delete v[k];
      expect(ok(v), k).toBe(false);
    }
    expect(ok({ ...issued, kfs_sha256: h("9") })).toBe(false);
    expect(ok({ ...issued, kfs_version: 0 })).toBe(false);
  });

  it("takes signers only as the role enum, each once, and refuses an executed document without signers", () => {
    expect(ok(withDoc(0, { signers: ["BORROWER", "WITNESS"] }))).toBe(false);
    expect(ok(withDoc(0, { signers: ["BORROWER", "BORROWER"] }))).toBe(false);
    expect(ok(withDoc(0, { signers: [] }))).toBe(false);
    expect(ok(withDoc(0, { signers: [...PACK_SIGNER_ROLES] }))).toBe(true);
  });

  it("guards the IT Act First Schedule: such an instrument is never executed by eSign or DSC", () => {
    const dpn = (mode: string) => ({
      ...issued,
      documents: [
        ...issued.documents,
        doc("doc_dpn_0001", "DPN", {
          execution_mode: mode,
          signers: ["BORROWER"],
          instrument_code: "DEMAND_PROMISSORY_NOTE",
        }),
      ],
    });
    expect(ok(dpn("WET_INK"))).toBe(true);
    expect(ok(dpn("ESIGN_AADHAAR"))).toBe(false);
    expect(ok(dpn("ESIGN_DSC"))).toBe(false);
    for (const c of IT_ACT_FIRST_SCHEDULE_INSTRUMENTS)
      expect(ok(withDoc(0, { instrument_code: c })), c).toBe(false);
    // An executed document names its instrument.
    expect(ok(withDoc(0, { instrument_code: undefined }))).toBe(false);
  });

  it("makes the covenant declaration conditional: required for a business purpose, present exactly when declared", () => {
    const cov = (business_purpose: boolean, declared: boolean) => ({ business_purpose, declared });
    expect(ok({ ...issued, covenant: cov(true, true), covenant_declaration: decl })).toBe(true);
    expect(ok({ ...issued, covenant: cov(true, true) })).toBe(false);
    expect(ok({ ...issued, covenant: cov(true, false) })).toBe(false);
    expect(ok({ ...issued, covenant_declaration: decl })).toBe(false);
    expect(ok({ ...issued, covenant: cov(false, true), covenant_declaration: decl })).toBe(true);
    expect(
      ok({
        ...issued,
        covenant: cov(true, true),
        covenant_declaration: { ...decl, document_id: "doc_elsewhere" },
      }),
    ).toBe(false);
    expect(ok({ ...issued, covenant: { ...cov(false, false), extra: 1 } })).toBe(false);
  });

  it("furnishes each quoted enclosure by exactly one pack document (RBC para 14)", () => {
    const extra = { code: "ANNEX_D", clause_ref: "cl.9" };
    expect(ok({ ...issued, enclosure_list: [...issued.enclosure_list, extra] })).toBe(false);
    expect(ok({ ...issued, enclosure_list: issued.enclosure_list.slice(1) })).toBe(false);
    expect(ok(withDoc(4, { enclosure_code: "ANNEX_A" }))).toBe(false);
    expect(
      ok({ ...issued, enclosure_list: [...issued.enclosure_list, issued.enclosure_list[0]!] }),
    ).toBe(false);
    expect(
      ok({
        ...issued,
        enclosure_list: [{ ...issued.enclosure_list[0]!, clause_ref: "" }],
      }),
    ).toBe(false);
  });

  it("takes the stamp evidence's full shape and refuses deficient, misplaced or self-referring evidence", () => {
    expect(PackStampEvidence.safeParse(stampEvidence).success).toBe(true);
    for (const bad of [
      { channel: "ESTAMP" },
      { certificate_no: "x" },
      { state: "MH" },
      { duty_paise: 1.5 },
      { stated_duty_paise: 60_000 },
      { stamped_document_sha256: "D".repeat(64) },
      { issued_at: "yesterday" },
    ])
      expect(
        PackStampEvidence.safeParse({ ...stampEvidence, ...bad }).success,
        JSON.stringify(bad),
      ).toBe(false);
    expect(PackStampEvidence.safeParse({ ...stampEvidence, duty_paise: 60_000 }).success).toBe(
      true,
    );
    const ev = (over: Record<string, unknown>) =>
      withDoc(0, { stamp_evidence: { ...stampEvidence, ...over } });
    expect(ok(ev({ state: "IN-DL" }))).toBe(false);
    expect(ok(ev({ certificate_document_id: "doc_agr_0001" }))).toBe(false);
    expect(ok(withDoc(4, { stamp_evidence: stampEvidence }))).toBe(false);
    expect(ok(withDoc(0, { stamp_required: false }))).toBe(false);
  });

  it("lists not-stampable documents only inside the pack, once, and never stamp-required or stamped", () => {
    const ns = (list: unknown[]) => ok({ ...issued, not_stampable: list });
    expect(ns([])).toBe(true);
    expect(ns([{ document_id: "doc_elsewhere", reason: "x" }])).toBe(false);
    expect(ns([{ document_id: "doc_agr_0001", reason: "x" }])).toBe(false);
    expect(ns([{ document_id: "doc_kfs_0001", reason: "" }])).toBe(false);
    expect(
      ns([
        { document_id: "doc_kfs_0001", reason: "x" },
        { document_id: "doc_kfs_0001", reason: "y" },
      ]),
    ).toBe(false);
  });

  it("keeps the manifest's rules: unique documents, summary box and clause in the pack, a stamp for stamp-required, a closed countersignature", () => {
    expect(ok({ ...issued, documents: [...issued.documents, issued.documents[1]!] })).toBe(false);
    expect(ok({ ...issued, summary_box: { document_id: "doc_elsewhere", page: 2 } })).toBe(false);
    expect(
      ok({
        ...issued,
        disbursement_clause: { ...issued.disbursement_clause, document_id: "doc_x01" },
      }),
    ).toBe(false);
    const v: Record<string, unknown> = { ...issued };
    delete v.stamp;
    expect(ok(v)).toBe(false);
    expect(ok({ ...issued, countersignature: { required: true } })).toBe(false);
  });
});

describe("DocumentShared and the retrieval answer (PR-UDF-061 item 13)", () => {
  it("takes an optional BCP 47 language and refuses another shape", () => {
    expect(DocumentSharedData.safeParse({ ...shared, language: "hi" }).success).toBe(true);
    expect(DocumentSharedData.safeParse({ ...shared, language: "mr-IN" }).success).toBe(true);
    for (const l of ["Hindi", "EN", "en_IN", ""])
      expect(DocumentSharedData.safeParse({ ...shared, language: l }).success, l).toBe(false);
  });

  it("names document_id as the subject of DocumentShared", () => {
    expect(DOCUMENT_EVENTS.DocumentShared.subject).toBe("document_id");
  });

  it("takes the retrieval answer's optional media type, size, type and application, refusing bad values", () => {
    const full = {
      ...retrieval,
      media_type: "application/pdf",
      size_bytes: 1024,
      type: "KFS",
      application_id: "app_0001",
    };
    expect(DocumentRetrieval.safeParse(full).success).toBe(true);
    for (const bad of [
      { media_type: "PDF" },
      { size_bytes: -1 },
      { type: "kfs" },
      { application_id: "x" },
    ])
      expect(DocumentRetrieval.safeParse({ ...full, ...bad }).success, JSON.stringify(bad)).toBe(
        false,
      );
  });
});

// ---- PR-UDF-061 item 18 (owner, 21 Nov 2026 07:30 IST; R1-D-252) ------------------------------

describe("physical_reason and re_instructions on pack documents (PR-UDF-061 item 18)", () => {
  const instructions =
    "Bring the signed agreement and two photo IDs to the Sub-Registrar office, Pune, on a working day.";
  // The interim manifest: item `i` of the two-document manifest, with `over`.
  const inManifest = (i: number, over: Record<string, unknown>) => ({
    ...manifest,
    documents: manifest.documents.map((d, j) => (j === i ? { ...d, ...over } : d)),
  });
  const manifestOk = (v: unknown) => ExecutionPackManifest.safeParse(v).success;
  // Both carriers, the agreement (item 0) changed by `over`.
  const both = (over: Record<string, unknown>) => [
    ExecutionPackManifest.safeParse(inManifest(0, over)),
    ExecutionPackIssuedData.safeParse(withDoc(0, over)),
  ];

  it("keeps every earlier pack valid: both fields are optional", () => {
    expect(manifestOk(manifest)).toBe(true);
    expect(ok(issued)).toBe(true);
    expect(PACK_PHYSICAL_REASONS).toEqual(["REGISTRATION_REQUIRED", "NOTARISATION_REQUIRED"]);
    expect(PACK_RE_INSTRUCTIONS_MAX).toBe(1000);
  });

  it("takes each physical reason with re_instructions on a WET_INK document, in both carriers", () => {
    for (const reason of PACK_PHYSICAL_REASONS) {
      const over = {
        execution_mode: "WET_INK",
        physical_reason: reason,
        re_instructions: instructions,
      };
      for (const r of both(over)) expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
      const m = ExecutionPackManifest.parse(inManifest(0, over));
      expect(m.documents[0]?.physical_reason).toBe(reason);
      expect(m.documents[0]?.re_instructions).toBe(instructions);
      const p = ExecutionPackIssuedData.parse(withDoc(0, over));
      expect(p.documents[0]?.physical_reason).toBe(reason);
      expect(p.documents[0]?.re_instructions).toBe(instructions);
    }
  });

  it("takes re_instructions alone, on any execution mode, from 1 to 1,000 characters of plain text", () => {
    for (const text of [
      "x",
      "x".repeat(PACK_RE_INSTRUCTIONS_MAX),
      "Sign each page.\nInitial the schedule.\tKeep a copy.\r\n",
      "प्रत्येक पृष्ठ पर हस्ताक्षर करें।",
      "Call the branch on 020-1234-5678 between 10:00 and 17:00.",
    ]) {
      for (const r of both({ re_instructions: text })) expect(r.success, text).toBe(true);
      expect(manifestOk(inManifest(1, { re_instructions: text })), text).toBe(true);
      expect(ok(withDoc(1, { re_instructions: text })), text).toBe(true);
    }
  });

  it("refuses an unknown physical reason", () => {
    for (const reason of ["STAMPING_REQUIRED", "registration_required", "", 1]) {
      const over = { execution_mode: "WET_INK", physical_reason: reason };
      for (const r of both(over)) expect(r.success, String(reason)).toBe(false);
    }
  });

  it("refuses a physical reason on a document not executed WET_INK, on physical_reason", () => {
    for (const reason of PACK_PHYSICAL_REASONS) {
      for (const mode of ["ESIGN_AADHAAR", "ESIGN_DSC"]) {
        for (const r of both({ execution_mode: mode, physical_reason: reason })) {
          expect(r.success, `${reason} ${mode}`).toBe(false);
          expect(r.error?.issues.map((i) => i.path)).toContainEqual([
            "documents",
            0,
            "physical_reason",
          ]);
        }
      }
      // NONE: the KFS (item 1) is not executed at all.
      const m = ExecutionPackManifest.safeParse(inManifest(1, { physical_reason: reason }));
      expect(m.success).toBe(false);
      expect(m.error?.issues.map((i) => i.path)).toContainEqual([
        "documents",
        1,
        "physical_reason",
      ]);
      const p = ExecutionPackIssuedData.safeParse(withDoc(1, { physical_reason: reason }));
      expect(p.success).toBe(false);
      expect(p.error?.issues.map((i) => i.path)).toContainEqual([
        "documents",
        1,
        "physical_reason",
      ]);
    }
  });

  it("refuses empty, over-long, non-text, control-character and linked re_instructions", () => {
    for (const text of [
      "",
      "x".repeat(PACK_RE_INSTRUCTIONS_MAX + 1),
      42,
      null,
      "Sign here\u0007",
      "Sign\u0000here",
      "Sign \u001b[31mhere",
      "Sign here\u007f",
      "See https://lender.example.in/register",
      "See http://lender.example",
      "Book at www.lender.example",
      "Pay the fee at upi:lender@bank",
      "Details at lender.example.in/register",
      "Open ftp://files.example/forms",
    ]) {
      for (const r of both({
        execution_mode: "WET_INK",
        physical_reason: "REGISTRATION_REQUIRED",
        re_instructions: text,
      }))
        expect(r.success, JSON.stringify(text)).toBe(false);
      expect(manifestOk(inManifest(1, { re_instructions: text })), JSON.stringify(text)).toBe(
        false,
      );
    }
  });

  it("applies the same link rule as CoolingOffExitAnswered.payment_instruction (R1-D-232)", () => {
    const answered = {
      loan_id: "loan_0001",
      exit_ref: "exit_0001",
      exit_amount_paise: 100,
      answered_at: "2026-11-21T10:00:00+05:30",
    };
    for (const text of ["Pay at the branch.", "See https://lender.example.in/pay", "x\u0007"]) {
      const exit = CoolingOffExitAnsweredData.safeParse({ ...answered, payment_instruction: text });
      const pack = ExecutionPackManifest.safeParse(inManifest(1, { re_instructions: text }));
      expect(pack.success, text).toBe(exit.success);
    }
  });
});

// ---- PR-UDF-075 (owner, 21 Nov 2026 11:00; R1-D-258) ------------------------------------------

describe("pack evidence additions (PR-UDF-075; R1-D-258)", () => {
  const manifestEvidence = {
    mode: "ESTAMP",
    state: "IN-MH",
    certificate_number: "IN-MH12345678901234X",
    duty_paise: 50_000,
    stamped_document_sha256: h("d"),
  };
  const inManifest = (i: number, over: Record<string, unknown>) => ({
    ...manifest,
    documents: manifest.documents.map((d, j) => (j === i ? { ...d, ...over } : d)),
  });
  const manifestOk = (v: unknown) => ExecutionPackManifest.safeParse(v).success;
  const clause = (over: Record<string, unknown>) => ({
    document_id: "doc_agr_0001",
    page_or_clause_ref: "cl.4.2",
    amount_stated_paise: 5_000_000,
    ...over,
  });
  const issues = (v: unknown) => {
    const r = ExecutionPackIssuedData.safeParse(v);
    return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
  };

  it("keeps every earlier pack valid: each addition is optional", () => {
    expect(ok(issued)).toBe(true);
    expect(manifestOk(manifest)).toBe(true);
    expect(manifestOk({ ...manifest, disbursement_clause: clause({}) })).toBe(true);
    expect(ESTAMP_SYSTEMS).toEqual(["SHCIL", "STATE_PORTAL", "NESL_DDE", "GRAS"]);
    expect(NOT_STAMPABLE_REASON_CODES).toEqual(["NOT_AN_INSTRUMENT", "ACKNOWLEDGEMENT", "OTHER"]);
  });

  it("(1) takes an estamp_system only with an e-stamp, in both carriers", () => {
    for (const system of ESTAMP_SYSTEMS) {
      expect(PackStampEvidence.safeParse({ ...stampEvidence, estamp_system: system }).success).toBe(
        true,
      );
      expect(StampEvidence.safeParse({ ...manifestEvidence, estamp_system: system }).success).toBe(
        true,
      );
      expect(ok(withDoc(0, { stamp_evidence: { ...stampEvidence, estamp_system: system } }))).toBe(
        true,
      );
    }
    expect(PackStampEvidence.safeParse({ ...stampEvidence, estamp_system: "NSDL" }).success).toBe(
      false,
    );
    for (const channel of ["FRANKING", "PHYSICAL_PAPER"]) {
      const r = PackStampEvidence.safeParse({ ...stampEvidence, channel, estamp_system: "SHCIL" });
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.path).toEqual(["estamp_system"]);
      // Without the new field, those channels parse as before.
      expect(PackStampEvidence.safeParse({ ...stampEvidence, channel }).success).toBe(true);
    }
    for (const mode of ["PAPER", "FRANKING"])
      expect(
        StampEvidence.safeParse({ ...manifestEvidence, mode, estamp_system: "GRAS" }).success,
      ).toBe(false);
  });

  it("(2) takes a not-stampable reason code beside the reason, never instead of it", () => {
    for (const reason_code of NOT_STAMPABLE_REASON_CODES)
      expect(
        ok({
          ...issued,
          not_stampable: issued.not_stampable.map((n) => ({ ...n, reason_code })),
        }),
      ).toBe(true);
    const [first] = issued.not_stampable;
    expect(ok({ ...issued, not_stampable: [{ ...first, reason_code: "EXEMPT" }] })).toBe(false);
    // OTHER (and every code) still needs the free-text reason.
    expect(
      ok({ ...issued, not_stampable: [{ document_id: "doc_kfs_0001", reason_code: "OTHER" }] }),
    ).toBe(false);
    // The manifest: on a not-stampable item only, with its reason.
    const kfs = {
      not_stampable: true,
      not_stampable_reason: "A disclosure, not an instrument",
      not_stampable_reason_code: "NOT_AN_INSTRUMENT",
    };
    expect(manifestOk(inManifest(1, kfs))).toBe(true);
    expect(
      manifestOk(
        inManifest(1, {
          ...kfs,
          not_stampable_reason: undefined,
          not_stampable_reason_code: "OTHER",
        }),
      ),
    ).toBe(false);
    const stray = ExecutionPackManifest.safeParse(
      inManifest(1, { not_stampable_reason_code: "ACKNOWLEDGEMENT" }),
    );
    expect(stray.error?.issues.map((i) => i.path.join("."))).toEqual([
      "documents.1.not_stampable_reason_code",
    ]);
  });

  it("(3) reads the stated forms of page_or_clause_ref", () => {
    const cases: Array<[string, ReturnType<typeof parsePageOrClauseRef>]> = [
      ["p.3", { page: 3 }],
      ["P 3", { page: 3 }],
      ["pg.12", { page: 12 }],
      ["page 7", { page: 7 }],
      ["cl.4.2", { clause: "4.2" }],
      ["cl 4.2(a)", { clause: "4.2(a)" }],
      ["Clause 9A.1(ii)", { clause: "9a.1(ii)" }],
      ["p.3 cl.4.2", { page: 3, clause: "4.2" }],
      ["p.3, cl.4.2", { page: 3, clause: "4.2" }],
      ["cl.4.2; p.3", { page: 3, clause: "4.2" }],
      ["cl.4.2/p.3", { page: 3, clause: "4.2" }],
      ["Schedule II", undefined],
      ["p.0", undefined],
      ["p.2001", undefined],
      ["4.2", undefined],
      ["", undefined],
    ];
    for (const [text, read] of cases) expect(parsePageOrClauseRef(text), text).toEqual(read);
  });

  it("(3) takes page and clause_ref beside page_or_clause_ref, agreeing where it can be read", () => {
    const at = (over: Record<string, unknown>) => ({
      ...issued,
      disbursement_clause: clause(over),
    });
    for (const over of [
      { clause_ref: "4.2" },
      { clause_ref: "4.2", page: 3 },
      { page_or_clause_ref: "p.3 cl.4.2", page: 3, clause_ref: "4.2" },
      { page_or_clause_ref: "P.3, CL.4.2(A)", page: 3, clause_ref: "4.2(a)" },
      // Free text is not compared.
      { page_or_clause_ref: "Schedule II, item 4", page: 9, clause_ref: "4" },
    ]) {
      expect(ok(at(over)), JSON.stringify(over)).toBe(true);
      expect(manifestOk({ ...manifest, disbursement_clause: clause(over) })).toBe(true);
    }
    expect(issues(at({ clause_ref: "4.3" }))).toEqual(["disbursement_clause.clause_ref"]);
    expect(issues(at({ page_or_clause_ref: "p.3", page: 4 }))).toEqual([
      "disbursement_clause.page",
    ]);
    expect(issues(at({ page_or_clause_ref: "p.3 cl.4.2", page: 4, clause_ref: "4.1" }))).toEqual([
      "disbursement_clause.page",
      "disbursement_clause.clause_ref",
    ]);
    for (const bad of [
      { page: 0 },
      { page: 2001 },
      { page: 1.5 },
      { clause_ref: "cl.4.2" },
      { clause_ref: "" },
    ])
      expect(ok(at(bad)), JSON.stringify(bad)).toBe(false);
    expect(manifestOk({ ...manifest, disbursement_clause: clause({ clause_ref: "4.3" }) })).toBe(
      false,
    );
  });

  it("(4) still refuses a document naming itself as its certificate, and takes a certificate outside the pack", () => {
    expect(ok(issued)).toBe(true); // doc_cert_0001 is not listed in the pack
    expect(
      issues(
        withDoc(0, {
          stamp_evidence: { ...stampEvidence, certificate_document_id: "doc_agr_0001" },
        }),
      ),
    ).toEqual(["documents.0.stamp_evidence"]);
  });
});
