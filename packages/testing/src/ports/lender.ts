// The origination contract cases (Udofin PR-UDF-051; R1-D-217): what any lender endpoint an LSP
// talks to must keep, run here against `FakeLender` and, when Finbyx publishes a sandbox, against
// an adapter over it. Ecosystem Specification §6.2, §6.3 and §3.6. PR-UDF-053 (R1-D-219) added the
// §6.13 documents, the execution-pack manifest and the LSP's signed eSign and eStamp evidence.
import { expect } from "vitest";
import { findAadhaarLike } from "@infrabyx/contracts";
import {
  DOCUMENT_EVENTS,
  DOCUMENT_URL_MAX_TTL_SECONDS,
  DocumentRetrieval,
  EXECUTION_PACK_MANIFEST_TYPE,
  ExecutionPackManifest,
  ELIGIBILITY_LENDER_UNAVAILABLE,
  EcosystemEnvelope,
  ORIGINATION_EVENTS,
  ORIGINATION_REGULATED,
  ORIGINATION_SCHEMA_VERSION,
  originationIdempotencyKey,
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
const uuidv7 = (): string => {
  const h = sha256Hex(`lsp:${++n}:${Date.now()}`);
  const t = Date.now().toString(16).padStart(12, "0");
  return `${t.slice(0, 8)}-${t.slice(8, 12)}-7${h.slice(0, 3)}-8${h.slice(3, 6)}-${h.slice(6, 18)}`;
};

/** An LSP-side Ecosystem envelope for one of the journey's events (Udofin's tests can use it too). */
export function lspEvent(
  name: OriginationEventName,
  data: Record<string, unknown>,
  o: { tenantId?: string; at?: Date; seq?: number } = {},
): EcosystemEnvelope {
  const spec = ORIGINATION_EVENTS[name];
  const tenant = o.tenantId ?? "tnt_udofin_test";
  return EcosystemEnvelope.parse({
    specversion: "1.0",
    id: uuidv7(),
    source: `urn:infrabyx:udofin:${tenant}`,
    type: spec.type,
    subject: originationIdempotencyKey(name, data),
    time: (o.at ?? new Date()).toISOString(),
    datacontenttype: "application/json",
    dataschema: `https://registry.infrabyx.example/schemas/${spec.type}/${ORIGINATION_SCHEMA_VERSION}.json`,
    tenantid: tenant,
    reid: "re_test",
    productfamily: "lending",
    consentref: "cpr_contract",
    dataclass: "FINANCIAL",
    schemaver: ORIGINATION_SCHEMA_VERSION,
    seq: o.seq ?? n,
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

const byName = (m: readonly LenderMessage[], name: OriginationEventName) =>
  m.filter((x) => x.name === name);

function expectNoAadhaarLike(v: unknown): void {
  expect(findAadhaarLike(JSON.stringify(v), { letters: "join" })).toEqual([]);
}

const sanctioned = async (l: LenderUnderTest, ref: string) => {
  const before = l.sharedDocuments?.().length ?? 0;
  const { applicationId } = await l.submitApplication(application(ref));
  return { applicationId, docs: l.sharedDocuments?.().slice(before) ?? [] };
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
          expect(m.event.subject).toBe(originationIdempotencyKey(m.name, m.event.data));
          expect(Boolean(m.jws)).toBe(spec.regulated);
          expectNoAadhaarLike(m);
        }
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
      name: "after a sanction the lender shares its documents by reference, each with a document JWS that verifies",
      async run(l) {
        if (!l.sharedDocuments) return;
        const { applicationId, docs } = await sanctioned(l, "lspapp_contract_doc1");
        const types = docs.map((d) => d.event.data.type);
        for (const t of ["KFS", "SANCTION_LETTER", "LOAN_AGREEMENT", EXECUTION_PACK_MANIFEST_TYPE])
          expect(types).toContain(t);
        const kfs = byName(l.outbox(), "KFSIssued").at(-1)!;
        for (const d of docs) {
          const spec = DOCUMENT_EVENTS.DocumentShared;
          expect(EcosystemEnvelope.safeParse(d.event).success).toBe(true);
          expect(d.event.type).toBe(spec.type);
          const data = spec.schema.parse(d.event.data);
          expect(data.application_id).toBe(applicationId);
          expect(d.event.subject).toBe(`document_id=${data.document_id}|version=${data.version}`);
          expect(verifyDocumentJws(data.jws, data, l.keys).ok, String(data.type)).toBe(true);
          expect(verifyDocumentJws(data.jws, { ...data, sha256: "f".repeat(64) }, l.keys).ok).toBe(
            false,
          );
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
        const { docs } = await sanctioned(l, "lspapp_contract_doc2");
        for (const d of docs) {
          const id = String(d.event.data.document_id);
          const r = DocumentRetrieval.parse(await l.getDocument(id));
          expect(r).toMatchObject({ document_id: id, sha256: d.event.data.sha256 });
          expect(r.url.startsWith("https://")).toBe(true);
          expect(Date.parse(r.url_expires_at) - Date.parse(r.issued_at)).toBeLessThanOrEqual(
            DOCUMENT_URL_MAX_TTL_SECONDS * 1000,
          );
          expect(verifyDocumentJws(r.jws, r, l.keys).ok).toBe(true);
          expect(sha256Hex(await l.fetchDocument(r.url))).toBe(r.sha256);
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
        const { applicationId, docs } = await sanctioned(l, "lspapp_contract_doc3");
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
      name: "ESignCompleted and EStampCompleted are refused unsigned or wrongly signed, and taken when the LSP signed them",
      async run(l) {
        if (!l.sharedDocuments || !l.eSignCompleted || !l.eStampCompleted) return;
        const { docs } = await sanctioned(l, "lspapp_contract_doc4");
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
  ];
}
