// PR-UDF-051 (R1-D-217), PR-UDF-053 (R1-D-219): the origination contract cases against the mock lender.
import { describe, expect, it } from "vitest";
import {
  CF_PARA_9_3_DOCUMENT_KINDS,
  DocumentSharedData,
  ExecutionPackIssuedData,
  ExecutionPackManifest,
  LoanDisbursedData,
  originationSubject,
  parsePageOrClauseRef,
} from "@infrabyx/contracts/events";
import { sha256Hex, verifyDocumentJws } from "@infrabyx/crypto";
import { FakeLender, type LenderMessage } from "@infrabyx/fakes";
import { lenderContractCases, lspEvent, lspSigner } from "./lender.js";

describe("origination contract (Ecosystem Spec §6.2, §6.3, §6.13): FakeLender", () => {
  const lsp = lspSigner();
  for (const c of lenderContractCases({ lsp }))
    it(c.name, () => c.run(new FakeLender({ lspKeys: lsp.keys })));
});

describe("origination contract: FakeLender without the LSP's keys refuses all evidence", () => {
  for (const c of lenderContractCases()) it(c.name, () => c.run(new FakeLender()));
});

// PR-UDF-061 items 14, 15 and 17 (owner, 20 Nov 2026 18:50; R1-D-236): what the mock lender does.
const submit = (ref: string, purpose?: string) =>
  lspEvent("ApplicationSubmitted", {
    lsp_application_ref: ref,
    applicants: [{ applicant_ref: "cus_fake_1", role: "PRIMARY" }],
    kyc_evidence_refs: ["kyc_ev_1"],
    bureau_refs: [],
    aa_refs: [],
    documents: [],
    consents: ["cpr_fake"],
    ...(purpose ? { request: { amount_paise: 3_000_000, tenor_days: 360, purpose } } : {}),
  });
const kfsOf = (l: FakeLender, applicationId: string): LenderMessage =>
  l.outbox().find((m) => m.name === "KFSIssued" && m.event.data.application_id === applicationId)!;
const accept = (l: FakeLender, applicationId: string) =>
  l.accept(
    lspEvent("BorrowerAccepted", {
      kfs_id: kfsOf(l, applicationId).event.data.kfs_id,
      accepted_at: new Date().toISOString(),
      explanation_acknowledged: true,
    }),
  );

describe("FakeLender: PR-UDF-061 items 14, 15 and 17 (R1-D-236)", () => {
  it("shares real synthetic PDFs and hashes those bytes (item 14)", async () => {
    const l = new FakeLender();
    const { applicationId } = await l.submitApplication(submit("lspapp_fake_pdf"));
    await accept(l, applicationId);
    const kfs = kfsOf(l, applicationId);
    const pdfs = l.sharedDocuments().filter((d) => d.event.data.media_type === "application/pdf");
    expect(pdfs.map((d) => d.event.data.type).sort()).toEqual(
      [...CF_PARA_9_3_DOCUMENT_KINDS, "ESTAMP_CERTIFICATE"].sort(),
    );
    for (const d of pdfs) {
      const r = await l.getDocument(String(d.event.data.document_id));
      const bytes = await l.fetchDocument(r.url);
      const text = new TextDecoder("latin1").decode(bytes);
      expect(text.startsWith("%PDF-1.7\n")).toBe(true);
      expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
      expect(sha256Hex(bytes)).toBe(d.event.data.sha256);
      expect(bytes.byteLength).toBe(d.event.data.size_bytes);
      expect(r).toMatchObject({ size_bytes: bytes.byteLength, type: d.event.data.type });
      expect(verifyDocumentJws(r.jws, r, l.keys, new Date(), { requireV2: true }).ok).toBe(true);
    }
    const kfsDoc = pdfs.find((d) => d.event.data.type === "KFS")!;
    expect(kfsDoc.event.data.sha256).toBe(kfs.event.data.document_sha256);
    const kfsText = new TextDecoder("latin1").decode(
      await l.fetchDocument((await l.getDocument(String(kfsDoc.event.data.document_id))).url),
    );
    expect(kfsText).toContain(`Key Facts Statement ${String(kfs.event.data.kfs_id)}`);
    expect(kfs.event.data).toMatchObject({
      document_ref: kfsDoc.event.data.document_id,
      document_version: 1,
    });
  });

  it("counts seq per subject from 1 and keeps interleaved applications apart (item 15)", async () => {
    const l = new FakeLender();
    const a = await l.submitApplication(submit("lspapp_fake_seq_a"));
    const b = await l.submitApplication(submit("lspapp_fake_seq_b"));
    await accept(l, a.applicationId);
    await accept(l, b.applicationId);
    const forApp = (id: string) =>
      l
        .outbox()
        .filter((m) => m.event.subject === id)
        .map((m) => [m.name, m.event.seq]);
    // One application, one ordered stream (§3.2): status, decision, KFS, sanction letter, pack.
    expect(forApp(a.applicationId)).toEqual([
      ["ApplicationStatusChanged", 1],
      ["DecisionMade", 2],
      ["ApplicationStatusChanged", 3],
      ["KFSIssued", 4],
      ["SanctionLetterIssued", 5],
      ["ApplicationStatusChanged", 6],
      ["ExecutionPackIssued", 7],
    ]);
    expect(forApp(b.applicationId).map(([, s]) => s)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(l.outbox().every((m) => m.event.subject === m.event.data.application_id)).toBe(true);
    // A loan is its own aggregate once it exists.
    const { loanId } = await l.disburse(a.applicationId);
    const disbursed = l.outbox().find((m) => m.name === "LoanDisbursed")!;
    expect([disbursed.event.subject, disbursed.event.seq]).toEqual([loanId, 1]);
    expect(forApp(a.applicationId).at(-1)).toEqual(["ApplicationStatusChanged", 8]);
    for (const d of l.sharedDocuments()) {
      expect(d.event.subject).toBe(d.event.data.document_id);
      expect(d.event.seq).toBe(1);
    }
    // The LSP side counts its own subjects the same way.
    const x = lspEvent("CoolingOffExitRequested", {
      loan_id: "ln_fake_seq_1",
      requested_at: new Date().toISOString(),
      evidence: { sha256: "b".repeat(64), uri: "storage:x/1.pdf" },
    });
    const y = lspEvent("CoolingOffExitRequested", { ...x.data });
    const z = lspEvent("CoolingOffExitRequested", { ...x.data, loan_id: "ln_fake_seq_2" });
    expect([x.subject, x.seq, y.seq, z.subject, z.seq]).toEqual([
      "ln_fake_seq_1",
      1,
      2,
      "ln_fake_seq_2",
      1,
    ]);
  });

  it("issues the pack only after the acceptance, with the CF para 9(3) set (item 17)", async () => {
    const l = new FakeLender();
    const { applicationId } = await l.submitApplication(submit("lspapp_fake_pack"));
    const types = () => l.sharedDocuments().map((d) => d.event.data.type);
    expect(types()).toEqual(["KFS", "SANCTION_LETTER"]);
    expect(l.outbox().some((m) => m.name === "ExecutionPackIssued")).toBe(false);
    expect(() => l.executionPack(applicationId)).toThrow(/pack_unknown/);
    await accept(l, applicationId);
    const names = l.outbox().map((m) => m.name);
    const accepted = names.lastIndexOf("ApplicationStatusChanged");
    expect(names.indexOf("ExecutionPackIssued")).toBeGreaterThan(accepted);
    const m = l.outbox().find((x) => x.name === "ExecutionPackIssued")!;
    expect(m.jws).toBeTruthy();
    const p = ExecutionPackIssuedData.parse(m.event.data);
    expect(p.documents.map((d) => d.kind)).toEqual([...CF_PARA_9_3_DOCUMENT_KINDS]);
    expect(p.covenant).toEqual({ business_purpose: false, declared: false });
    expect(p.covenant_declaration).toBeUndefined();
    expect(types().at(-1)).toBe("EXECUTION_PACK_MANIFEST");
    // The interim manifest names the same documents.
    const manifest = ExecutionPackManifest.parse(l.executionPack(applicationId));
    expect(manifest.documents.map((d) => d.document_id)).toEqual(
      p.documents.map((d) => d.document_id),
    );
  });

  it("declares the covenant for a business purpose", async () => {
    const l = new FakeLender();
    const { applicationId } = await l.submitApplication(submit("lspapp_fake_biz", "BUSINESS"));
    await accept(l, applicationId);
    const p = ExecutionPackIssuedData.parse(
      l.outbox().find((x) => x.name === "ExecutionPackIssued")!.event.data,
    );
    expect(p.covenant).toEqual({ business_purpose: true, declared: true });
    const agreement = p.documents.find((d) => d.kind === "LOAN_AGREEMENT")!;
    expect(p.covenant_declaration).toEqual({
      document_id: agreement.document_id,
      sha256: agreement.sha256,
    });
  });
});

// PR-UDF-061 finding (i) (owner, 21 Nov 2026 11:00; R1-D-256).
describe("FakeLender: LoanDisbursed names the application both ways (R1-D-256)", () => {
  it("sends application_id and lsp_application_ref, and keeps loan_id as the subject", async () => {
    const l = new FakeLender();
    const { applicationId } = await l.submitApplication(submit("lspapp_fake_disbursed"));
    await accept(l, applicationId);
    const { loanId } = await l.disburse(applicationId);
    const m = l.outbox().find((x) => x.name === "LoanDisbursed")!;
    const d = LoanDisbursedData.parse(m.event.data);
    expect(d.application_id).toBe(applicationId);
    expect(d.lsp_application_ref).toBe("lspapp_fake_disbursed");
    expect(m.event.subject).toBe(loanId);
    expect(originationSubject("LoanDisbursed", m.event.data)).toBe(loanId);
  });
});

// PR-UDF-075 (owner, 21 Nov 2026 11:00; R1-D-258).
describe("FakeLender: the pack evidence additions in both carriers (R1-D-258)", () => {
  it("names the e-stamp system, the not-stampable reason code and the clause_ref", async () => {
    const l = new FakeLender();
    const { applicationId } = await l.submitApplication(submit("lspapp_fake_evidence"));
    await accept(l, applicationId);
    const p = ExecutionPackIssuedData.parse(
      l.outbox().find((x) => x.name === "ExecutionPackIssued")!.event.data,
    );
    const agreement = p.documents.find((d) => d.kind === "LOAN_AGREEMENT")!;
    expect(agreement.stamp_evidence?.channel).toBe("E_STAMP");
    expect(agreement.stamp_evidence?.estamp_system).toBe("SHCIL");
    expect(p.not_stampable?.length).toBeGreaterThan(0);
    for (const n of p.not_stampable ?? []) expect(n.reason_code).toBe("NOT_AN_INSTRUMENT");
    expect(p.disbursement_clause?.clause_ref).toBe("4.2");
    expect(parsePageOrClauseRef(p.disbursement_clause!.page_or_clause_ref)).toEqual({
      clause: "4.2",
    });
    const m = ExecutionPackManifest.parse(l.executionPack(applicationId));
    const item = m.documents.find((d) => d.kind === "LOAN_AGREEMENT")!;
    expect(item.stamp_evidence?.estamp_system).toBe("SHCIL");
    for (const d of m.documents.filter((x) => x.not_stampable))
      expect(d.not_stampable_reason_code).toBe("NOT_AN_INSTRUMENT");
    expect(m.disbursement_clause?.clause_ref).toBe("4.2");
  });

  it("verifies each shared document's v2 JWS from the announcement and reports the profile", async () => {
    const l = new FakeLender();
    const { applicationId } = await l.submitApplication(submit("lspapp_fake_profile"));
    await accept(l, applicationId);
    for (const d of l.sharedDocuments()) {
      const data = DocumentSharedData.parse(d.event.data);
      // The announcement as it arrives, at the event's time (guide §7ei).
      const r = verifyDocumentJws(data.jws, data, l.keys, new Date(d.event.time), {
        requireV2: true,
        reportProfile: true,
      });
      expect(r, String(data.type)).toMatchObject({ ok: true, profile: "v2" });
    }
  });
});
