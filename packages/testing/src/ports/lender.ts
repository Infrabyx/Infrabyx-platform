// The origination contract cases (Udofin PR-UDF-051; R1-D-217): what any lender endpoint an LSP
// talks to must keep, run here against `FakeLender` and, when Finbyx publishes a sandbox, against
// an adapter over it. Ecosystem Specification §6.2, §6.3 and §3.6.
import { expect } from "vitest";
import { findAadhaarLike } from "@infrabyx/contracts";
import {
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
  sha256Hex,
  verifyRegulatedMessage,
  localRegulatedSigner,
  RegulatedKeyRing,
} from "@infrabyx/crypto";
import type { FakeLender, FakeLenderScript, LenderMessage } from "@infrabyx/fakes";
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
> & { script?(s: FakeLenderScript): void };

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

export function lenderContractCases(): Array<ContractCase<LenderUnderTest>> {
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
  ];
}
