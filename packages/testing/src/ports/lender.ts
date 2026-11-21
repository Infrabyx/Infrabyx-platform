// The origination contract cases (Udofin PR-UDF-051; R1-D-217): what any lender endpoint an LSP
// talks to must keep, run here against `FakeLender` and, when Finbyx publishes a sandbox, against
// an adapter over it. Ecosystem Specification §6.2, §6.3 and §3.6. PR-UDF-053 (R1-D-219) added the
// §6.13 documents, the execution-pack manifest and the LSP's signed eSign and eStamp evidence;
// R1-D-229 the optional KFS loan amount and the manifest's disbursement clause; R1-D-231 the
// offer's instalment, penal charges and KFS link and the manifest items' stamp evidence; R1-D-232
// (PR-UDF-061) Udofin's udf_ext v1 list: two-character product codes, the application's chosen
// offer and profile, the acceptance's KFS version and hash, the lender's words, the KFS detail,
// the document references and the new `CoolingOffExitAnswered`. R1-D-236 (PR-UDF-061 items 12 to
// 17; PR-047 approved): the envelope `subject` is the aggregate id and `seq` counts per subject;
// `ExecutionPackIssued` and `CoolingOffExitAnswered` are signed; the pack follows the acceptance and
// lists the CF para 9(3) set; documents are real PDFs with a v2 document JWS; the KFS and the
// sanction letter name their file's version.
import { expect } from "vitest";
import {
  CF_PARA_9_3_DOCUMENT_KINDS,
  DOCUMENT_EVENTS,
  DOCUMENT_URL_MAX_TTL_SECONDS,
  DocumentRetrieval,
  EXECUTION_PACK_MANIFEST_TYPE,
  ExecutionPackIssuedData,
  ExecutionPackManifest,
  ELIGIBILITY_LENDER_UNAVAILABLE,
  INSTALMENT_FREQUENCIES,
  ApplicationStatusChangedData,
  CoolingOffExitAnsweredData,
  DecisionMadeData,
  KfsIssuedData,
  LoanDisbursedData,
  SanctionLetterIssuedData,
  OriginationOffer,
  EcosystemEnvelope,
  ORIGINATION_EVENTS,
  ORIGINATION_REGULATED,
  ORIGINATION_SCHEMA_VERSION,
  originationSubject,
  type OriginationEventName,
} from "@infrabyx/contracts/events";
import {
  MemoryReplayStore,
  canonicalize,
  sha256Hex,
  signRegulatedMessage,
  verifyDocumentJws,
  verifyRegulatedMessage,
  localRegulatedSigner,
  RegulatedKeyRing,
} from "@infrabyx/crypto";
import type { FakeLender, FakeLenderScript, LenderMessage } from "@infrabyx/fakes";
export {
  FakeLender,
  LenderRefusal,
  type DocumentMessage,
  type FakeLenderOptions,
  type FakeLenderScript,
  type LenderMessage,
} from "@infrabyx/fakes";
import { scanTextForAadhaar } from "../aadhaar-scan/index.js";
import type { ContractCase } from "../contract.js";

/** What the cases drive: the LSP-facing calls, the lender's sent messages and its key ring. */
export type LenderUnderTest = Pick<
  FakeLender,
  | "eligibilityCheck"
  | "submitApplication"
  | "accept"
  | "disburse"
  | "coolingOffExit"
  | "outbox"
  | "keys"
> & { script?(s: FakeLenderScript): void } & Partial<
    Pick<
      FakeLender,
      | "sharedDocuments"
      | "getDocument"
      | "fetchDocument"
      | "executionPack"
      | "eSignCompleted"
      | "eStampCompleted"
    >
  >;

/** The LSP's side of the regulated messages: a local ES256 key, its ring, and a signer for events. */
export interface LspSigner {
  kid: string;
  /** Give this to the lender (`new FakeLender({ lspKeys })`). */
  keys: RegulatedKeyRing;
  /** The detached JWS (`X-Infrabyx-JWS`) of one event, fresh `iat` and `jti` each call. */
  sign(event: EcosystemEnvelope): Promise<string>;
}

/** A local LSP signer for tests (`localRegulatedSigner`; never in production configuration). */
export function lspSigner(kid = "fake-lsp-1"): LspSigner {
  const s = localRegulatedSigner(kid);
  return {
    kid,
    keys: new RegulatedKeyRing([{ kid, key: s.publicKey }]),
    sign: (event) =>
      signRegulatedMessage({
        event: event as unknown as Record<string, unknown>,
        kid,
        sign: s.sign,
      }),
  };
}

let n = 0;
/** The LSP side's last `seq` per subject (§3.2 "per-subject sequence"; R1-D-236). */
const lspSeqs = new Map<string, number>();
const uuidv7 = (): string => {
  const h = sha256Hex(`lsp:${++n}:${Date.now()}`);
  const t = Date.now().toString(16).padStart(12, "0");
  return `${t.slice(0, 8)}-${t.slice(8, 12)}-7${h.slice(0, 3)}-8${h.slice(3, 6)}-${h.slice(6, 18)}`;
};

/**
 * An LSP-side Ecosystem envelope for one of the journey's events (Udofin's tests can use it too).
 * Its `subject` is the event's aggregate id (`originationSubject`, R1-D-236) and its `seq` counts per
 * subject from 1 unless `o.seq` is given.
 */
export function lspEvent(
  name: OriginationEventName,
  data: Record<string, unknown>,
  o: { tenantId?: string; at?: Date; seq?: number } = {},
): EcosystemEnvelope {
  const spec = ORIGINATION_EVENTS[name];
  const tenant = o.tenantId ?? "tnt_udofin_test";
  const subject = originationSubject(name, data);
  const seq = o.seq ?? (lspSeqs.get(subject) ?? 0) + 1;
  if (o.seq === undefined) lspSeqs.set(subject, seq);
  return EcosystemEnvelope.parse({
    specversion: "1.0",
    id: uuidv7(),
    source: `urn:infrabyx:udofin:${tenant}`,
    type: spec.type,
    subject,
    time: (o.at ?? new Date()).toISOString(),
    datacontenttype: "application/json",
    dataschema: `https://registry.infrabyx.example/schemas/${spec.type}/${ORIGINATION_SCHEMA_VERSION}.json`,
    tenantid: tenant,
    reid: "re_test",
    productfamily: "lending",
    consentref: "cpr_contract",
    dataclass: "FINANCIAL",
    schemaver: ORIGINATION_SCHEMA_VERSION,
    seq,
    environment: "test",
    data,
  });
}

const application = (ref: string) =>
  lspEvent("ApplicationSubmitted", {
    lsp_application_ref: ref,
    applicants: [{ applicant_ref: "cus_contract_1", role: "PRIMARY" }],
    kyc_evidence_refs: ["kyc_ev_1"],
    bureau_refs: ["bpl_1"],
    aa_refs: [],
    documents: [{ document_id: "doc_1", kind: "BANK_STATEMENT", sha256: "a".repeat(64) }],
    consents: ["cpr_contract"],
  });

const eligibility = (over: Record<string, unknown> = {}) => ({
  lsp_ref: "lsp_contract",
  product_code: "PL_STD",
  amount_paise: 5_000_000,
  tenor_months: 12,
  consentref: "cpr_contract",
  fields: { monthly_income_band: "B3", employment: "SALARIED" },
  ...over,
});

/** An application carrying Udofin's udf_ext v1 fields (R1-D-232), choosing `offerRef` if given. */
const udfExtApplication = (ref: string, offerRef?: string) => {
  const base = application(ref);
  return lspEvent("ApplicationSubmitted", {
    ...base.data,
    consents: ["cpr_contract", "cpr_contract_aa"],
    ...(offerRef ? { offer_ref: offerRef } : {}),
    product_code: "PL",
    request: { amount_paise: 4_000_000, tenor_days: 180, purpose: "PERSONAL" },
    economic_profile: {
      age_years: 34,
      occupation: "SALARIED",
      monthly_income_paise: 6_000_000,
      income_source: "SALARY",
    },
    household: {
      household_ref: "hh_contract_1",
      monthly_household_income_paise: 9_000_000,
      is_microfinance: false,
    },
    kyc: { level: "FULL_KYC", state: "VERIFIED" },
    credit_data_modes: { bureau: true, aa: true },
    consent_purposes: [
      { purpose: "BUREAU_PULL", consent_ref: "cpr_contract" },
      { purpose: "AA_FETCH", consent_ref: "cpr_contract_aa" },
    ],
  });
};

/** A URL or web address inside text (R1-D-232: a payment instruction carries none). */
const LINKISH = /:\/\/|www\.|\bupi:/i;

const byName = (m: readonly LenderMessage[], name: OriginationEventName) =>
  m.filter((x) => x.name === name);

/**
 * No Aadhaar-like number in a message (R1-D-247). Read as the repository sweep reads text: UUIDs
 * (the envelope `id`, RFC 9562) are identifiers and blanked first, and letters join a run (hashes,
 * base64, ULIDs). Without the blanking, a random UUID whose middle groups are all digits reads as
 * a grouped twelve-digit number about once in two thousand, and the case failed at random.
 */
function expectNoAadhaarLike(v: unknown): void {
  expect(scanTextForAadhaar(JSON.stringify(v), { letters: "join" })).toEqual([]);
}

const sanctioned = async (l: LenderUnderTest, ref: string) => {
  const before = l.sharedDocuments?.().length ?? 0;
  const { applicationId } = await l.submitApplication(application(ref));
  return { applicationId, docs: l.sharedDocuments?.().slice(before) ?? [] };
};

/** The borrower's acceptance; with `lspRef` it is on the LSP's application aggregate (§3.2). */
const accepted = (kfs: LenderMessage, lspRef?: string) =>
  lspEvent("BorrowerAccepted", {
    kfs_id: kfs.event.data.kfs_id,
    accepted_at: new Date().toISOString(),
    explanation_acknowledged: true,
    ...(lspRef ? { lsp_application_ref: lspRef } : {}),
  });

/**
 * Submits and accepts an application (R1-D-236: the execution pack follows the acceptance, CF
 * para 9(3)); answers the documents shared and the messages sent from the submission on.
 */
const executed = async (l: LenderUnderTest, ref: string, app = application(ref)) => {
  const before = l.sharedDocuments?.().length ?? 0;
  const out = l.outbox().length;
  const { applicationId } = await l.submitApplication(app);
  const atSanction = l.sharedDocuments?.().length ?? 0;
  const kfs = byName(l.outbox().slice(out), "KFSIssued").at(-1)!;
  await l.accept(accepted(kfs));
  return {
    applicationId,
    kfs,
    docs: l.sharedDocuments?.().slice(before) ?? [],
    docsAtSanction: l.sharedDocuments?.().slice(before, atSanction) ?? [],
    sent: l.outbox().slice(out),
  };
};

const esignData = (documentId: string, txn: string) => {
  const now = Date.now();
  return {
    document_id: documentId,
    esp_txn_id: txn,
    esp: "NSDL",
    signer_ref: "cus_contract_1",
    signing_method: "AADHAAR_OTP",
    signed_at: new Date(now).toISOString(),
    signed_sha256: "c".repeat(64),
    certificate: {
      serial_no: "0A1B2C3D",
      issuer: "CN=Test eSign CA",
      not_before: new Date(now - 60_000).toISOString(),
      not_after: new Date(now + 1_800_000).toISOString(),
      sha256: "d".repeat(64),
    },
  };
};

/**
 * The cases. Pass the LSP signer whose `keys` the lender holds to run the signed-evidence case;
 * without it only the refusals of unsigned or wrongly signed evidence run.
 */
export function lenderContractCases(
  o: { lsp?: LspSigner } = {},
): Array<ContractCase<LenderUnderTest>> {
  return [
    {
      name: "EligibilityCheck answers within the budget, is idempotent, and refuses a changed body under the same key",
      async run(l) {
        const a = await l.eligibilityCheck(eligibility(), { idempotencyKey: "idem-elig-0001" });
        expect(a).toMatchObject({ outcome: "ELIGIBLE" });
        expect(
          await l.eligibilityCheck(eligibility(), { idempotencyKey: "idem-elig-0001" }),
        ).toEqual(a);
        await expect(
          l.eligibilityCheck(eligibility({ amount_paise: 6_000_000 }), {
            idempotencyKey: "idem-elig-0001",
          }),
        ).rejects.toMatchObject({ reason: "idempotency_conflict" });
        await expect(l.eligibilityCheck(eligibility(), { idempotencyKey: "" })).rejects.toThrow();
        await expect(
          l.eligibilityCheck(eligibility({ amount_paise: 10.5 }), {
            idempotencyKey: "idem-elig-0002",
          }),
        ).rejects.toThrow();
      },
    },
    {
      name: "a lender slower than 3 s is `lender_unavailable`",
      async run(l) {
        if (!l.script) return;
        l.script({ latencyMs: 3001 });
        expect(
          await l.eligibilityCheck(eligibility(), { idempotencyKey: "idem-elig-slow1" }),
        ).toEqual({
          outcome: ELIGIBILITY_LENDER_UNAVAILABLE,
        });
        l.script({ latencyMs: 50 });
      },
    },
    {
      name: "the journey's events are valid envelopes in order, keyed as the Specification says, and the regulated ones are signed",
      async run(l) {
        const before = l.outbox().length;
        const { applicationId } = await l.submitApplication(application("lspapp_contract_1"));
        // Resubmitting the same application is the same application.
        expect((await l.submitApplication(application("lspapp_contract_1"))).applicationId).toBe(
          applicationId,
        );
        const sent = l.outbox().slice(before);
        expect(sent.map((m) => m.name).filter((x) => x !== "ApplicationStatusChanged")).toEqual([
          "DecisionMade",
          "KFSIssued",
          "SanctionLetterIssued",
        ]);
        const seqs = byName(sent, "ApplicationStatusChanged").map(
          (m) => m.event.data.seq as number,
        );
        expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
        for (const m of sent) {
          const spec = ORIGINATION_EVENTS[m.name];
          expect(EcosystemEnvelope.safeParse(m.event).success).toBe(true);
          expect(m.event.type).toBe(spec.type);
          expect(spec.schema.safeParse(m.event.data).success).toBe(true);
          // §3.2: the subject is the aggregate id (R1-D-236, PR-UDF-061 item 15).
          expect(m.event.subject).toBe(originationSubject(m.name, m.event.data));
          expect(Boolean(m.jws)).toBe(spec.regulated);
          expectNoAadhaarLike(m);
        }
        // `seq` counts per subject from 1: a new application's subjects each run 1..n.
        const bySubject = new Map<string, number[]>();
        for (const m of sent)
          bySubject.set(m.event.subject, [...(bySubject.get(m.event.subject) ?? []), m.event.seq]);
        for (const [subject, seqs] of bySubject)
          expect(seqs, subject).toEqual(seqs.map((_, i) => i + 1));
        const replay = new MemoryReplayStore();
        for (const m of sent.filter((x) => ORIGINATION_REGULATED.includes(x.name))) {
          const ok = await verifyRegulatedMessage(
            m.event as unknown as Record<string, unknown>,
            m.jws!,
            {
              keys: l.keys,
              replay,
            },
          );
          expect(ok.ok, m.name).toBe(true);
        }
      },
    },
    {
      name: "a regulated message does not verify with another key or after its data changed",
      async run(l) {
        await l.submitApplication(application("lspapp_contract_2"));
        const kfs = byName(l.outbox(), "KFSIssued").at(-1)!;
        const other = localRegulatedSigner("fake-lender-1");
        const otherRing = new RegulatedKeyRing([{ kid: other.kid, key: other.publicKey }]);
        const event = kfs.event as unknown as Record<string, unknown>;
        expect(
          (
            await verifyRegulatedMessage(event, kfs.jws!, {
              keys: otherRing,
              replay: new MemoryReplayStore(),
            })
          ).ok,
        ).toBe(false);
        const changed = { ...event, data: { ...(event.data as object), apr_bp: 1 } };
        expect(
          (
            await verifyRegulatedMessage(changed, kfs.jws!, {
              keys: l.keys,
              replay: new MemoryReplayStore(),
            })
          ).ok,
        ).toBe(false);
      },
    },
    {
      name: "acceptance within the KFS validity books the loan; disbursal carries the cooling-off end; an exit inside it is taken",
      async run(l) {
        const { applicationId } = await l.submitApplication(application("lspapp_contract_3"));
        const kfs = byName(l.outbox(), "KFSIssued").at(-1)!;
        expect(kfs.event.data.application_id).toBe(applicationId);
        await l.accept(
          lspEvent("BorrowerAccepted", {
            kfs_id: kfs.event.data.kfs_id,
            accepted_at: new Date().toISOString(),
            explanation_acknowledged: true,
          }),
        );
        const { loanId } = await l.disburse(applicationId);
        const disbursed = byName(l.outbox(), "LoanDisbursed").at(-1)!;
        expect(disbursed.event.data).toMatchObject({ loan_id: loanId, kind: "INITIAL" });
        expect(Date.parse(String(disbursed.event.data.cooling_off_end))).toBeGreaterThan(
          Date.now(),
        );
        await l.coolingOffExit(
          lspEvent("CoolingOffExitRequested", {
            loan_id: loanId,
            requested_at: new Date().toISOString(),
            evidence: { sha256: "b".repeat(64), uri: "storage:tenant/tnt_udofin_test/exit/1.pdf" },
          }),
        );
        await expect(
          l.coolingOffExit(
            lspEvent("CoolingOffExitRequested", {
              loan_id: loanId,
              requested_at: new Date(Date.now() + 400 * 86_400_000).toISOString(),
              evidence: {
                sha256: "b".repeat(64),
                uri: "storage:tenant/tnt_udofin_test/exit/2.pdf",
              },
            }),
          ),
        ).rejects.toMatchObject({ reason: "cooling_off_ended" });
      },
    },
    {
      name: "an acceptance after the KFS validity is refused, and an unacknowledged one is not a valid message",
      async run(l) {
        await l.submitApplication(application("lspapp_contract_4"));
        const kfs = byName(l.outbox(), "KFSIssued").at(-1)!;
        const late = new Date(
          Date.parse(String(kfs.event.data.validity_expiry)) + 1000,
        ).toISOString();
        await expect(
          l.accept(
            lspEvent("BorrowerAccepted", {
              kfs_id: kfs.event.data.kfs_id,
              accepted_at: late,
              explanation_acknowledged: true,
            }),
          ),
        ).rejects.toMatchObject({ reason: "kfs_expired" });
        expect(() =>
          lspEvent("BorrowerAccepted", {
            kfs_id: kfs.event.data.kfs_id,
            accepted_at: new Date().toISOString(),
            explanation_acknowledged: false,
          }),
        ).not.toThrow();
        await expect(
          l.accept(
            lspEvent("BorrowerAccepted", {
              kfs_id: kfs.event.data.kfs_id,
              accepted_at: new Date().toISOString(),
              explanation_acknowledged: false,
            }),
          ),
        ).rejects.toThrow();
      },
    },
    {
      name: "a rejected application gets a signed DecisionMade with no offers, and no KFS",
      async run(l) {
        if (!l.script) return;
        l.script({ decision: "REJECTED" });
        const before = l.outbox().length;
        await l.submitApplication(application("lspapp_contract_5"));
        l.script({ decision: "SANCTIONED" });
        const sent = l.outbox().slice(before);
        const d = byName(sent, "DecisionMade")[0]!;
        expect(d.event.data).toMatchObject({ decision: "REJECTED", offers: [] });
        expect(d.jws).toBeTruthy();
        expect(byName(sent, "KFSIssued")).toEqual([]);
      },
    },
    {
      name: "the lender refuses a message of the wrong type or with an invalid payload",
      async run(l) {
        const wrong = {
          ...application("lspapp_contract_6"),
          type: ORIGINATION_EVENTS.BorrowerAccepted.type,
        };
        await expect(l.submitApplication(wrong)).rejects.toThrow();
        const bad = application("lspapp_contract_7");
        await expect(
          l.submitApplication({ ...bad, data: { ...bad.data, applicants: [] } }),
        ).rejects.toThrow();
      },
    },
    {
      name: "the lender shares its documents by reference, the KFS and sanction letter before the acceptance, each with a document JWS that verifies",
      async run(l) {
        if (!l.sharedDocuments) return;
        const { applicationId, docs, docsAtSanction, kfs } = await executed(
          l,
          "lspapp_contract_doc1",
        );
        const types = docs.map((d) => d.event.data.type);
        for (const t of ["KFS", "SANCTION_LETTER", "LOAN_AGREEMENT", EXECUTION_PACK_MANIFEST_TYPE])
          expect(types).toContain(t);
        // The borrower sees the KFS and the sanction letter before accepting (§6.2).
        const early = docsAtSanction.map((d) => d.event.data.type);
        expect(early).toContain("KFS");
        expect(early).toContain("SANCTION_LETTER");
        for (const d of docs) {
          const spec = DOCUMENT_EVENTS.DocumentShared;
          expect(EcosystemEnvelope.safeParse(d.event).success).toBe(true);
          expect(d.event.type).toBe(spec.type);
          const data = spec.schema.parse(d.event.data);
          expect(data.application_id).toBe(applicationId);
          // §3.2: the subject is the document's id (R1-D-236).
          expect(d.event.subject).toBe(data.document_id);
          expect(verifyDocumentJws(data.jws, data, l.keys).ok, String(data.type)).toBe(true);
          expect(verifyDocumentJws(data.jws, { ...data, sha256: "f".repeat(64) }, l.keys).ok).toBe(
            false,
          );
          // A v2 JWS (R1-D-236) also binds the type, media type, size and application.
          if (data.media_type !== undefined && data.size_bytes !== undefined) {
            for (const other of [
              { type: "OTHER_TYPE" },
              { media_type: "text/plain" },
              { size_bytes: data.size_bytes + 1 },
              { application_id: "app_someone_else" },
            ])
              expect(
                verifyDocumentJws(data.jws, { ...data, ...other }, l.keys, new Date(), {
                  requireV2: true,
                }).ok,
                JSON.stringify(other),
              ).toBe(false);
          }
          expectNoAadhaarLike(d);
        }
        const kfsDoc = docs.find((d) => d.event.data.type === "KFS")!;
        expect(kfsDoc.event.data.sha256).toBe(kfs.event.data.document_sha256);
      },
    },
    {
      name: "GET /v1/documents/{id} answers an India-hosted https URL valid at most 15 minutes whose bytes match the hash",
      async run(l) {
        if (!l.sharedDocuments || !l.getDocument || !l.fetchDocument) return;
        const { docs } = await executed(l, "lspapp_contract_doc2");
        for (const d of docs) {
          const id = String(d.event.data.document_id);
          const r = DocumentRetrieval.parse(await l.getDocument(id));
          expect(r).toMatchObject({ document_id: id, sha256: d.event.data.sha256 });
          expect(r.url.startsWith("https://")).toBe(true);
          expect(Date.parse(r.url_expires_at) - Date.parse(r.issued_at)).toBeLessThanOrEqual(
            DOCUMENT_URL_MAX_TTL_SECONDS * 1000,
          );
          expect(verifyDocumentJws(r.jws, r, l.keys).ok).toBe(true);
          const bytes = await l.fetchDocument(r.url);
          expect(sha256Hex(bytes)).toBe(r.sha256);
          // R1-D-236 (items 13, 14): the answer's size and media type, when given, are the bytes'.
          if (r.size_bytes !== undefined) expect(bytes.byteLength).toBe(r.size_bytes);
          if (r.media_type !== undefined) expect(r.media_type).toBe(d.event.data.media_type);
          if (r.media_type === "application/pdf")
            expect(new TextDecoder("latin1").decode(bytes.slice(0, 5))).toBe("%PDF-");
        }
        await expect(l.getDocument("doc_not_shared")).rejects.toThrow();
        await expect(
          l.fetchDocument("https://documents.fake-lender.in/v1/blobs/" + "0".repeat(32)),
        ).rejects.toThrow();
      },
    },
    {
      name: "the execution-pack manifest is valid, names the shared documents, and is itself shared as a document",
      async run(l) {
        if (!l.sharedDocuments || !l.executionPack || !l.getDocument || !l.fetchDocument) return;
        const { applicationId, docs } = await executed(l, "lspapp_contract_doc3");
        const pack = ExecutionPackManifest.parse(l.executionPack(applicationId));
        expect(pack.application_id).toBe(applicationId);
        const shared = new Map(docs.map((d) => [d.event.data.document_id, d.event.data.sha256]));
        for (const d of pack.documents) expect(shared.get(d.document_id)).toBe(d.sha256);
        const m = docs.find((d) => d.event.data.type === EXECUTION_PACK_MANIFEST_TYPE)!;
        const r = await l.getDocument(String(m.event.data.document_id));
        const bytes = new TextDecoder().decode(await l.fetchDocument(r.url));
        expect(bytes).toBe(canonicalize(pack));
      },
    },
    {
      name: "a KFS loan amount, when given, is integer paise and equals the sanctioned amount",
      async run(l) {
        const { applicationId } = await l.submitApplication(application("lspapp_contract_kfs_amt"));
        const kfs = byName(l.outbox(), "KFSIssued").at(-1)!;
        expect(kfs.event.data.application_id).toBe(applicationId);
        const amount = kfs.event.data.loan_amount_paise;
        if (amount === undefined) return;
        const data = KfsIssuedData.parse(kfs.event.data);
        expect(Number.isSafeInteger(data.loan_amount_paise)).toBe(true);
        expect(data.loan_amount_paise).toBeGreaterThan(0);
        const sanction = byName(l.outbox(), "SanctionLetterIssued").at(-1)!;
        expect(sanction.event.data.application_id).toBe(applicationId);
        expect(amount).toBe((sanction.event.data.terms as { amount_paise: number }).amount_paise);
      },
    },
    {
      name: "a manifest's disbursement clause names a pack document, and a product can compare its amount with LoanDisbursed",
      async run(l) {
        if (!l.executionPack) return;
        const { applicationId } = await executed(l, "lspapp_contract_disb_clause");
        const pack = ExecutionPackManifest.parse(l.executionPack(applicationId));
        const clause = pack.disbursement_clause;
        if (!clause) return;
        expect(pack.documents.map((d) => d.document_id)).toContain(clause.document_id);
        expect(clause.page_or_clause_ref.length).toBeGreaterThan(0);
        await l.disburse(applicationId);
        const disbursed = byName(l.outbox(), "LoanDisbursed").at(-1)!;
        // What a product checks before it books the loan: the stated amount and the amount paid out.
        expect(clause.amount_stated_paise).toBe(disbursed.event.data.amount_paise);
      },
    },
    {
      name: "an offer's instalment, penal charges and KFS link, when given, are valid, and the KFS link names a document the lender shared",
      async run(l) {
        const answer = await l.eligibilityCheck(eligibility(), {
          idempotencyKey: "idem-elig-offer-terms",
        });
        const before = l.outbox().length;
        const { docs } = await sanctioned(l, "lspapp_contract_offer_terms");
        const decision = byName(l.outbox().slice(before), "DecisionMade")[0]!;
        const offers = [
          ...("offers" in answer ? answer.offers : []),
          ...(decision.event.data.offers as unknown[]),
        ].map((x) => OriginationOffer.parse(x));
        const sharedIds = new Set(docs.map((d) => String(d.event.data.document_id)));
        for (const offer of offers) {
          if (offer.monthly_instalment) {
            expect(Number.isSafeInteger(offer.monthly_instalment.amount_paise)).toBe(true);
            expect(offer.monthly_instalment.amount_paise).toBeGreaterThan(0);
            expect(INSTALMENT_FREQUENCIES).toContain(offer.monthly_instalment.frequency);
          }
          if (offer.monthly_instalment_paise !== undefined && offer.monthly_instalment)
            expect(offer.monthly_instalment.amount_paise).toBe(offer.monthly_instalment_paise);
          if (offer.kfs_url !== undefined) expect(new URL(offer.kfs_url).protocol).toBe("https:");
          for (const c of offer.penal_charges ?? []) {
            // A penal charge is a rate or an amount, never both (RBI Penal Charges directions).
            expect((c.rate_bp === undefined) !== (c.amount_paise === undefined)).toBe(true);
            expect(c.description.length).toBeGreaterThan(0);
          }
          if (offer.kfs_link && l.sharedDocuments) {
            const kfsDoc = l
              .sharedDocuments()
              .find((d) => d.event.data.document_id === offer.kfs_link!.document_id);
            expect(kfsDoc, "kfs_link names a shared document").toBeDefined();
            expect(kfsDoc!.event.data.type).toBe("KFS");
            if (offer.kfs_link.version !== undefined)
              expect(kfsDoc!.event.data.version).toBe(offer.kfs_link.version);
          }
        }
        // A sanctioned offer's KFS link, when given, is to this application's KFS.
        for (const x of decision.event.data.offers as Array<{ kfs_link?: { document_id: string } }>)
          if (x.kfs_link && l.sharedDocuments) expect(sharedIds).toContain(x.kfs_link.document_id);
      },
    },
    {
      name: "a manifest item's stamp evidence matches the stamped document and the pack's stamp, and a not-stampable item is not stamp-required",
      async run(l) {
        if (!l.executionPack) return;
        const { applicationId, docs } = await executed(l, "lspapp_contract_stamp_evidence");
        const pack = ExecutionPackManifest.parse(l.executionPack(applicationId));
        const shared = new Map(
          docs.map((d) => [String(d.event.data.document_id), String(d.event.data.sha256)]),
        );
        for (const d of pack.documents) {
          if (d.stamp_evidence) {
            expect(d.not_stampable).not.toBe(true);
            expect(d.stamp_evidence.stamped_document_sha256).toBe(d.sha256);
            if (shared.size > 0)
              expect(d.stamp_evidence.stamped_document_sha256).toBe(shared.get(d.document_id));
            expect(pack.stamp, "stamp evidence needs the pack's stamp").toBeDefined();
            expect(d.stamp_evidence.state).toBe(pack.stamp!.state);
            expect(d.stamp_evidence.duty_paise).toBe(pack.stamp!.duty_paise);
          }
          if (d.not_stampable === true) {
            expect(d.stamp_required).toBe(false);
            expect(d.not_stampable_reason?.length ?? 0).toBeGreaterThan(0);
          }
        }
      },
    },
    {
      name: "a two-character product code is taken by the eligibility call",
      async run(l) {
        const a = await l.eligibilityCheck(eligibility({ product_code: "PL" }), {
          idempotencyKey: "idem-elig-product-2ch",
        });
        expect(["ELIGIBLE", "NOT_ELIGIBLE", "REFER"]).toContain((a as { outcome: string }).outcome);
      },
    },
    {
      name: "an application naming an offer the lender made is decided on that offer; one naming an unknown offer is refused",
      async run(l) {
        const answer = await l.eligibilityCheck(eligibility({ product_code: "PL" }), {
          idempotencyKey: "idem-elig-udf-ext-1",
        });
        if (!("offers" in answer) || answer.offers.length === 0) return;
        const chosen = answer.offers[0]!;
        const before = l.outbox().length;
        await l.submitApplication(udfExtApplication("lspapp_contract_udf_ext_1", chosen.offer_id));
        const decision = byName(l.outbox().slice(before), "DecisionMade")[0]!;
        const d = DecisionMadeData.parse(decision.event.data);
        if (d.decision === "SANCTIONED")
          expect(d.offers[0]).toMatchObject({
            amount_paise: chosen.amount_paise,
            tenor_months: chosen.tenor_months,
          });
        await expect(
          l.submitApplication(udfExtApplication("lspapp_contract_udf_ext_2", "ofr_never_made")),
        ).rejects.toMatchObject({ reason: "offer_unknown" });
        // Every udf_ext field together is a valid ApplicationSubmitted.
        await l.submitApplication(udfExtApplication("lspapp_contract_udf_ext_3"));
      },
    },
    {
      name: "an acceptance naming the KFS version and hash is taken when they match and refused when they do not",
      async run(l) {
        await l.submitApplication(application("lspapp_contract_kfs_match"));
        const kfs = byName(l.outbox(), "KFSIssued").at(-1)!;
        const accepted = (over: Record<string, unknown>) =>
          lspEvent("BorrowerAccepted", {
            kfs_id: kfs.event.data.kfs_id,
            accepted_at: new Date().toISOString(),
            acknowledged_at: new Date(Date.now() - 60_000).toISOString(),
            explanation_acknowledged: true,
            lsp_application_ref: "lspapp_contract_kfs_match",
            kfs_version: kfs.event.data.version,
            kfs_sha256: kfs.event.data.document_sha256,
            device_ref: "dev_contract_1",
            ...over,
          });
        await expect(l.accept(accepted({ kfs_version: 2 }))).rejects.toMatchObject({
          reason: "kfs_mismatch",
        });
        await expect(l.accept(accepted({ kfs_sha256: "e".repeat(64) }))).rejects.toMatchObject({
          reason: "kfs_mismatch",
        });
        await expect(
          l.accept(accepted({ lsp_application_ref: "lspapp_someone_else" })),
        ).rejects.toMatchObject({ reason: "application_mismatch" });
        await l.accept(accepted({}));
      },
    },
    {
      name: "an exit request inside the cooling-off period is answered once with the amount, a reference and a payment instruction in words without a link",
      async run(l) {
        const { applicationId } = await l.submitApplication(application("lspapp_contract_exit"));
        const kfs = byName(l.outbox(), "KFSIssued").at(-1)!;
        await l.accept(
          lspEvent("BorrowerAccepted", {
            kfs_id: kfs.event.data.kfs_id,
            accepted_at: new Date().toISOString(),
            explanation_acknowledged: true,
          }),
        );
        const { loanId } = await l.disburse(applicationId);
        const exit = (n: number) =>
          lspEvent("CoolingOffExitRequested", {
            loan_id: loanId,
            requested_at: new Date().toISOString(),
            evidence: {
              sha256: "b".repeat(64),
              uri: `storage:tenant/tnt_udofin_test/exit/${n}.pdf`,
            },
            lsp_application_ref: "lspapp_contract_exit",
          });
        const before = l.outbox().length;
        await l.coolingOffExit(exit(1));
        await l.coolingOffExit(exit(2));
        const answers = byName(l.outbox().slice(before), "CoolingOffExitAnswered");
        if (answers.length === 0) return; // a lender that answers later, out of band
        expect(answers).toHaveLength(1);
        const m = answers[0]!;
        const spec = ORIGINATION_EVENTS.CoolingOffExitAnswered;
        expect(m.event.type).toBe(spec.type);
        expect(m.event.subject).toBe(originationSubject("CoolingOffExitAnswered", m.event.data));
        // Signed from Spec v1.6 (PR-047; R1-D-236): it states an amount owed and how to pay it.
        expect(spec.regulated).toBe(true);
        expect(
          (
            await verifyRegulatedMessage(m.event as unknown as Record<string, unknown>, m.jws!, {
              keys: l.keys,
              replay: new MemoryReplayStore(),
            })
          ).ok,
        ).toBe(true);
        const a = CoolingOffExitAnsweredData.parse(m.event.data);
        expect(a.loan_id).toBe(loanId);
        expect(LINKISH.test(a.payment_instruction)).toBe(false);
        // The exit amount is at least the principal disbursed (CF para 11).
        const disbursed = byName(l.outbox(), "LoanDisbursed").at(-1)!;
        expect(a.exit_amount_paise).toBeGreaterThanOrEqual(
          disbursed.event.data.amount_paise as number,
        );
        expectNoAadhaarLike(m);
        await expect(
          l.coolingOffExit(
            lspEvent("CoolingOffExitRequested", {
              ...exit(3).data,
              lsp_application_ref: "lspapp_someone_else",
            }),
          ),
        ).rejects.toMatchObject({ reason: "application_mismatch" });
      },
    },
    {
      name: "the lender's status and reason texts, when given, are plain text for the codes it sent",
      async run(l) {
        const before = l.outbox().length;
        if (l.script) l.script({ decision: "REJECTED" });
        await l.submitApplication(application("lspapp_contract_texts"));
        if (l.script) l.script({ decision: "SANCTIONED" });
        const sent = l.outbox().slice(before);
        for (const m of byName(sent, "ApplicationStatusChanged"))
          ApplicationStatusChangedData.parse(m.event.data);
        const d = DecisionMadeData.parse(byName(sent, "DecisionMade")[0]!.event.data);
        for (const t of d.reason_texts ?? []) expect(d.reason_codes).toContain(t.reason_code);
      },
    },
    {
      name: "a KFS's detail, when given, is consistent: the schedule in order, the net disbursed within the loan amount, its document shared",
      async run(l) {
        const { docs } = await sanctioned(l, "lspapp_contract_kfs_detail");
        const k = KfsIssuedData.parse(byName(l.outbox(), "KFSIssued").at(-1)!.event.data);
        const sharedIds = new Map(docs.map((d) => [String(d.event.data.document_id), d]));
        if (k.document_ref && sharedIds.size > 0) {
          const doc = sharedIds.get(k.document_ref);
          expect(doc, "document_ref names a shared document").toBeDefined();
          expect(doc!.event.data.type).toBe("KFS");
          expect(doc!.event.data.sha256).toBe(k.document_sha256);
        }
        if (k.cash_flows) {
          const seqs = k.cash_flows.instalments.map((i) => i.seq);
          expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
          if (k.loan_amount_paise !== undefined)
            expect(k.cash_flows.net_disbursed_paise).toBeLessThanOrEqual(k.loan_amount_paise);
        }
        if (k.co_lending)
          expect(k.co_lending.parties.reduce((t, p) => t + p.share_bp, 0)).toBe(10_000);
        if (k.issued_at)
          expect(Date.parse(k.issued_at)).toBeLessThanOrEqual(Date.parse(k.validity_expiry));
      },
    },
    {
      name: "a sanction letter's document reference names the shared letter, and LoanDisbursed names the application by application_id, lsp_application_ref or both",
      async run(l) {
        const { applicationId, docs } = await sanctioned(l, "lspapp_contract_doc_refs");
        const s = SanctionLetterIssuedData.parse(
          byName(l.outbox(), "SanctionLetterIssued").at(-1)!.event.data,
        );
        if (s.document_ref && docs.length > 0) {
          const doc = docs.find((d) => d.event.data.document_id === s.document_ref);
          expect(doc, "document_ref names a shared document").toBeDefined();
          expect(doc!.event.data.type).toBe("SANCTION_LETTER");
          expect(doc!.event.data.sha256).toBe(s.document_sha256);
        }
        const kfs = byName(l.outbox(), "KFSIssued").at(-1)!;
        await l.accept(
          lspEvent("BorrowerAccepted", {
            kfs_id: kfs.event.data.kfs_id,
            accepted_at: new Date().toISOString(),
            explanation_acknowledged: true,
          }),
        );
        await l.disburse(applicationId);
        const d = LoanDisbursedData.parse(byName(l.outbox(), "LoanDisbursed").at(-1)!.event.data);
        // R1-D-256 (PR-UDF-061 finding (i)): the schema requires neither (a minor), but an LSP must
        // be able to tell which application was disbursed, so a lender sends at least one.
        expect(
          d.application_id !== undefined || d.lsp_application_ref !== undefined,
          "LoanDisbursed carries application_id or lsp_application_ref",
        ).toBe(true);
        if (d.application_id !== undefined) expect(d.application_id).toBe(applicationId);
        if (d.lsp_application_ref !== undefined)
          expect(d.lsp_application_ref).toBe("lspapp_contract_doc_refs");
      },
    },
    {
      name: "ESignCompleted and EStampCompleted are refused unsigned or wrongly signed, and taken when the LSP signed them",
      async run(l) {
        if (!l.sharedDocuments || !l.eSignCompleted || !l.eStampCompleted) return;
        const { docs } = await executed(l, "lspapp_contract_doc4");
        const agreement = String(
          docs.find((d) => d.event.data.type === "LOAN_AGREEMENT")!.event.data.document_id,
        );
        const esign = lspEvent("ESignCompleted", esignData(agreement, "ESP-TXN-CONTRACT-1"));
        await expect(l.eSignCompleted(esign)).rejects.toMatchObject({
          reason: "signature-invalid",
        });
        const stranger = lspSigner("fake-lsp-1");
        await expect(l.eSignCompleted(esign, await stranger.sign(esign))).rejects.toMatchObject({
          reason: "signature-invalid",
        });
        const estamp = lspEvent("EStampCompleted", {
          document_id: agreement,
          certificate_no: "IN-MH-CONTRACT-0001",
          state: "IN-MH",
          duty_paise: 50_000,
          issued_at: new Date().toISOString(),
          stamp_mode: "E_STAMP",
        });
        await expect(l.eStampCompleted(estamp)).rejects.toMatchObject({
          reason: "signature-invalid",
        });
        if (!o.lsp) return;
        await l.eSignCompleted(esign, await o.lsp.sign(esign));
        // A retry carries a fresh JWS and is taken again without effect.
        await l.eSignCompleted(esign, await o.lsp.sign(esign));
        await l.eStampCompleted(estamp, await o.lsp.sign(estamp));
        const unknown = lspEvent("ESignCompleted", esignData("doc_not_shared", "ESP-TXN-2"));
        await expect(l.eSignCompleted(unknown, await o.lsp.sign(unknown))).rejects.toMatchObject({
          reason: "document_unknown",
        });
        // Changing the event after signing breaks the signature.
        const changed = { ...esign, data: { ...esign.data, signed_sha256: "e".repeat(64) } };
        await expect(l.eSignCompleted(changed, await o.lsp.sign(esign))).rejects.toMatchObject({
          reason: "signature-invalid",
        });
      },
    },
    {
      name: "the signed ExecutionPackIssued follows the borrower's acceptance, names the accepted KFS and lists the CF para 9(3) set of shared documents",
      async run(l) {
        const before = l.sharedDocuments?.().length ?? 0;
        const out = l.outbox().length;
        const { applicationId } = await l.submitApplication(application("lspapp_contract_pack_1"));
        expect(
          byName(l.outbox().slice(out), "ExecutionPackIssued"),
          "no pack before the acceptance",
        ).toEqual([]);
        if (l.executionPack) expect(() => l.executionPack!(applicationId)).toThrow();
        const kfs = byName(l.outbox().slice(out), "KFSIssued").at(-1)!;
        await l.accept(accepted(kfs));
        const packs = byName(l.outbox().slice(out), "ExecutionPackIssued");
        if (packs.length === 0) return; // a lender that issues the pack later, out of band
        const m = packs.at(-1)!;
        const spec = ORIGINATION_EVENTS.ExecutionPackIssued;
        expect(m.event.type).toBe(spec.type);
        expect(m.event.subject).toBe(originationSubject("ExecutionPackIssued", m.event.data));
        expect(spec.regulated).toBe(true);
        expect(
          (
            await verifyRegulatedMessage(m.event as unknown as Record<string, unknown>, m.jws!, {
              keys: l.keys,
              replay: new MemoryReplayStore(),
            })
          ).ok,
          "ExecutionPackIssued is signed",
        ).toBe(true);
        const p = ExecutionPackIssuedData.parse(m.event.data);
        expect(p.application_id).toBe(applicationId);
        expect(p.kfs_id).toBe(kfs.event.data.kfs_id);
        expect(p.kfs_version).toBe(kfs.event.data.version);
        expect(p.kfs_sha256).toBe(kfs.event.data.document_sha256);
        const kinds = p.documents.map((d) => d.kind);
        for (const k of CF_PARA_9_3_DOCUMENT_KINDS) expect(kinds, k).toContain(k);
        for (const d of p.documents)
          if (d.stamp_evidence) {
            expect(d.stamp_evidence.stamped_document_sha256).toBe(d.sha256);
            if (p.stamp) expect(d.stamp_evidence.duty_paise).toBe(p.stamp.duty_paise);
          }
        if (l.sharedDocuments) {
          const shared = new Map(
            l
              .sharedDocuments()
              .slice(before)
              .map((d) => [String(d.event.data.document_id), d.event.data]),
          );
          for (const d of p.documents) {
            const s = shared.get(d.document_id);
            expect(s, `${d.kind} ${d.document_id} is shared`).toBeDefined();
            expect(s!.sha256).toBe(d.sha256);
            expect(s!.version).toBe(d.version);
            expect(s!.application_id).toBe(applicationId);
          }
          for (const d of p.documents) {
            const cert = d.stamp_evidence?.certificate_document_id;
            if (!cert) continue;
            expect(shared.has(cert), "the stamp certificate is shared").toBe(true);
            // R1-D-258 (PR-UDF-075 (4)): a document of the same application, and when the pack
            // lists it, a document of its own: not stamp-required and not itself stamped.
            expect(shared.get(cert)!.application_id, "the certificate's application").toBe(
              applicationId,
            );
            const listed = p.documents.find((x) => x.document_id === cert);
            if (listed) {
              expect(listed.stamp_required).toBe(false);
              expect(listed.stamp_evidence).toBeUndefined();
            }
          }
        }
        expectNoAadhaarLike(m);
        // A retried acceptance issues no second pack.
        await l.accept(accepted(kfs));
        expect(byName(l.outbox().slice(out), "ExecutionPackIssued")).toHaveLength(packs.length);
      },
    },
    {
      name: "a business-purpose loan's pack declares the wilful-defaulter covenant and names the declaration in the pack",
      async run(l) {
        const ref = "lspapp_contract_pack_business";
        const app = lspEvent("ApplicationSubmitted", {
          ...application(ref).data,
          request: { amount_paise: 4_000_000, tenor_days: 360, purpose: "BUSINESS" },
        });
        const { sent } = await executed(l, ref, app);
        const m = byName(sent, "ExecutionPackIssued").at(-1);
        if (!m) return;
        const p = ExecutionPackIssuedData.parse(m.event.data);
        expect(p.covenant).toEqual({ business_purpose: true, declared: true });
        expect(p.documents.map((d) => d.document_id)).toContain(
          p.covenant_declaration!.document_id,
        );
        const personal = await executed(l, "lspapp_contract_pack_personal");
        const q = byName(personal.sent, "ExecutionPackIssued").at(-1);
        if (q) {
          const pq = ExecutionPackIssuedData.parse(q.event.data);
          expect(pq.covenant_declaration !== undefined).toBe(pq.covenant.declared);
        }
      },
    },
    {
      name: "the KFS and the sanction letter name the shared file by id and version, whose hash they carry",
      async run(l) {
        const { docs, sent } = await executed(l, "lspapp_contract_doc_versions");
        const k = KfsIssuedData.parse(byName(sent, "KFSIssued").at(-1)!.event.data);
        const s = SanctionLetterIssuedData.parse(
          byName(sent, "SanctionLetterIssued").at(-1)!.event.data,
        );
        for (const [x, type] of [
          [k, "KFS"],
          [s, "SANCTION_LETTER"],
        ] as const) {
          if (x.document_version === undefined) continue;
          expect(x.document_ref, `${type} names its document`).toBeDefined();
          if (docs.length === 0) continue;
          const d = docs.find((y) => y.event.data.document_id === x.document_ref);
          expect(d, `${type} document_ref names a shared document`).toBeDefined();
          expect(d!.event.data).toMatchObject({
            type,
            version: x.document_version,
            sha256: x.document_sha256,
          });
        }
      },
    },
    {
      name: "every envelope's subject is its aggregate and seq counts per subject from 1: one application's lifecycle is one stream, with two applications interleaved",
      async run(l) {
        const before = l.sharedDocuments?.().length ?? 0;
        const out = l.outbox().length;
        const subA = application("lspapp_contract_seq_a");
        const a = await l.submitApplication(subA);
        const b = await l.submitApplication(application("lspapp_contract_seq_b"));
        const kfsOf = (id: string) =>
          byName(l.outbox().slice(out), "KFSIssued").find(
            (m) => m.event.data.application_id === id,
          )!;
        await l.accept(accepted(kfsOf(b.applicationId), "lspapp_contract_seq_b"));
        const accA = accepted(kfsOf(a.applicationId), "lspapp_contract_seq_a");
        await l.accept(accA);
        // The LSP's submission and acceptance are on its own application aggregate, in order.
        expect(subA.subject).toBe("lspapp_contract_seq_a");
        expect(accA.subject).toBe(subA.subject);
        expect(accA.seq).toBeGreaterThan(subA.seq);
        await l.disburse(b.applicationId);
        await l.disburse(a.applicationId);
        const sent = l.outbox().slice(out);
        for (const m of sent)
          expect(m.event.subject, m.name).toBe(originationSubject(m.name, m.event.data));
        const events = [
          ...sent.map((m) => m.event),
          ...(l.sharedDocuments?.().slice(before) ?? []).map((d) => d.event),
        ];
        const bySubject = new Map<string, number[]>();
        for (const e of events)
          bySubject.set(e.subject, [...(bySubject.get(e.subject) ?? []), e.seq]);
        for (const [subject, seqs] of bySubject)
          expect(seqs, subject).toEqual(seqs.map((_, i) => i + 1));
        // Each application is one subject counted 1..n across its decision, KFS, sanction letter
        // and pack, although the two applications' events interleave; the loan is its own subject.
        for (const id of [a.applicationId, b.applicationId]) {
          const stream = sent.filter((m) => m.event.subject === id);
          expect(
            stream.map((m) => m.event.seq),
            id,
          ).toEqual(stream.map((_, i) => i + 1));
          const names: string[] = stream.map((m) => m.name);
          const order = ["DecisionMade", "KFSIssued", "SanctionLetterIssued"].map((x) =>
            names.indexOf(x),
          );
          expect(order.every((i) => i >= 0)).toBe(true);
          expect([...order].sort((x, y) => x - y)).toEqual(order);
          const pack = names.indexOf("ExecutionPackIssued");
          if (pack >= 0) expect(pack).toBeGreaterThan(order[2]!);
          const disbursed = sent.find(
            (m) => m.name === "LoanDisbursed" && m.event.data.application_id === id,
          );
          if (disbursed) {
            expect(disbursed.event.subject).toBe(disbursed.event.data.loan_id);
            expect(disbursed.event.seq).toBe(1);
          }
        }
      },
    },
  ];
}
