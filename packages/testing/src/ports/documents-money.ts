// ESTAMP, PAYOUTS, DOCGEN, PDF, the PAYMENTS mandate lifecycle and ESIGN: in-memory fakes and the
// contract cases every future adapter must pass (IPB-01-15; Finbyx PR-FBX-29, R1-D-52). No vendor
// adapter exists for any of them yet; the money-moving ones (payouts, mandates, stamp duty) wait for
// the owner (locked list). The fakes keep the same rules the interfaces document: money-moving calls
// need an idempotency key, an approved request and a user or service initiator (never an agent),
// a replayed key returns the first result, "accepted" is never final, and files are STORAGE
// references with their SHA-256.
// ESTAMP, PAYOUTS, DOCGEN, PDF, the PAYMENTS mandate lifecycle and ESIGN: in-memory fakes and the
// contract cases every future adapter must pass (IPB-01-15; Finbyx PR-FBX-29, R1-D-52). No vendor
// adapter exists for any of them yet; the money-moving ones (payouts, mandates, stamp duty) wait for
// the owner (locked list). The fakes keep the same rules the interfaces document: money-moving calls
// need an idempotency key, an approved request and a user or service initiator (never an agent),
// a replayed key returns the first result, "accepted" is never final, and files are STORAGE
// references with their SHA-256.
import { expect } from "vitest";
import {
  AccountValidation,
  DdeRegistration,
  DutyQuoteRequest,
  EstampPurchase,
  FINAL_PAYOUT_STATES,
  HtmlRenderRequest,
  MandateRegistration,
  PayoutSpec,
  RenderRequest,
  SIGNING_METHODS,
  payloadClass,
  type DocFileRef,
  type DocgenPort,
  type EstampPort,
  type MandateLifecycle,
  type MoneyAuthorisation,
  type PayoutsPort,
  type PdfPort,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";
import type { ContractCase } from "../contract.js";
import { CONTRACT_AUTH, type DdeFixtures, FakeEsign } from "@infrabyx/fakes";
export {
  FakeEstamp,
  FakePayouts,
  FakeMandates,
  FakeDocgen,
  type FakeDocgenDocument,
  type FakeDocgenFiles,
  type FakeDocgenPdfOptions,
  type FakeDocgenRenderers,
  FAKE_TEMPLATES,
  FakePdf,
  FakeEsign,
  CONTRACT_AUTH,
  type DdeFixtures,
  ESTAMP_DDE_FAKE_FIXTURES,
} from "@infrabyx/fakes";

// -------------------------------------------------------------------------------- contract cases

const PREFIX = "tenant/tnt_contract/dms";
/** An agent initiator, which every money-moving call must refuse (typed loosely on purpose). */
const AGENT_AUTH = {
  approvalRef: "apr_contract_0001",
  initiatedBy: { principalId: "agt_vidhi", principalType: "agent" },
} as unknown as MoneyAuthorisation;
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string }) => e.code ?? "error",
  );

/** Inputs an ESTAMP adapter's contract run needs: a state its sandbox covers. */
export function estampContractCases(
  o: { state: string } = { state: "MH" },
): Array<ContractCase<EstampPort>> {
  const party = (r: string) => ({ partyRef: r, name: `Party ${r}` });
  const purchase = (over: Record<string, unknown> = {}) => ({
    state: o.state,
    instrument: "loan_agreement",
    dutyMinor: 50_000,
    considerationMinor: 50_000_000,
    firstParty: party("p1"),
    secondParty: party("p2"),
    purchaser: party("p1"),
    outputPrefix: PREFIX,
    authorisation: CONTRACT_AUTH,
    ...over,
  });
  return [
    {
      name: "classes parties and amounts REGULATED; stays IN",
      async run(p) {
        expect(payloadClass(EstampPurchase).bodyHighest).toBe("REGULATED");
        expect(payloadClass(DutyQuoteRequest).bodyHighest).toBe("REGULATED");
        expect(p.descriptor.residency).toBe("IN");
      },
    },
    {
      name: "quotes duty through rules and buys a certificate once per idempotency key",
      async run(p) {
        expect(await p.covers(o.state, "loan_agreement")).toBe(true);
        const q = await p.quoteDuty({
          state: o.state,
          instrument: "loan_agreement",
          considerationMinor: 50_000_000,
        });
        expect(Number.isSafeInteger(q.dutyMinor) && q.dutyMinor > 0).toBe(true);
        expect(q.ruleSet).toBeTruthy();
        const a = await p.purchase(purchase(), "contract-estamp-0001");
        const b = await p.purchase(purchase(), "contract-estamp-0001");
        expect(b.certificateId).toBe(a.certificateId);
        if (a.state === "issued") {
          expect(a.certificateNumber).toBeTruthy();
          expect(a.file?.sha256).toMatch(/^[0-9a-f]{64}$/);
        }
        expect((await p.verify(a.certificateId)).certificateId).toBe(a.certificateId);
        await p.attach(a.certificateId, "doc_contract_1");
      },
    },
    {
      name: "refuses a purchase without an approval or key, or initiated by an agent",
      async run(p) {
        expect(
          await code(p.purchase(purchase({ authorisation: AGENT_AUTH }), "contract-estamp-0002")),
        ).toBe("IPB-SEC-004");
        expect(
          await code(p.purchase(purchase({ authorisation: undefined }), "contract-estamp-0003")),
        ).toBe("IPB-UX-004");
        expect(await code(p.purchase(purchase(), ""))).toBe("IPB-UX-004");
      },
    },
  ];
}

/** Inputs a PAYOUTS adapter's contract run needs: a sandbox account that validates. */
export function payoutsContractCases(
  o: { ifsc: string; account: string } = { ifsc: "HDFC0000001", account: "000123456789" },
): Array<ContractCase<PayoutsPort>> {
  return [
    {
      name: "classes accounts and amounts REGULATED; stays IN",
      async run(p) {
        expect(payloadClass(PayoutSpec).bodyHighest).toBe("REGULATED");
        expect(payloadClass(AccountValidation).bodyHighest).toBe("REGULATED");
        expect(p.descriptor.residency).toBe("IN");
      },
    },
    {
      name: "validates an account with the holder's name and pays once per key; accepted is not final",
      async run(p) {
        const v = await p.validateAccount({ ifsc: o.ifsc, account: o.account }, "contract-pd-0001");
        expect(v.valid).toBe(true);
        expect(v.holderName).toBeTruthy();
        const { beneficiaryId } = await p.createBeneficiary({
          beneficiaryRef: "cus_contract",
          name: v.holderName ?? "Holder",
          ifsc: o.ifsc,
          account: o.account,
        });
        const spec = {
          beneficiaryId,
          amountMinor: 1_00,
          mode: "IMPS" as const,
          purposeRef: "loan_contract",
          authorisation: CONTRACT_AUTH,
        };
        const a = await p.payout(spec, "contract-payout-0001");
        const b = await p.payout(spec, "contract-payout-0001");
        expect(b.payoutId).toBe(a.payoutId);
        expect(
          FINAL_PAYOUT_STATES.includes(a.state) && a.state !== "settled" ? "final-failure" : "ok",
        ).toBe("ok");
        expect(["accepted", "processing", "settled"]).toContain(a.state);
        if (a.state === "settled") expect(a.utr).toBeTruthy();
        expect(await code(p.payout({ ...spec, amountMinor: 2_00 }, "contract-payout-0001"))).toBe(
          "IPB-PORT-004",
        );
        const bal = await p.balance();
        expect(Number.isSafeInteger(bal.availableMinor)).toBe(true);
      },
    },
    {
      name: "refuses a payout initiated by an agent or without an approval or key",
      async run(p) {
        const { beneficiaryId } = await p.createBeneficiary({
          beneficiaryRef: "cus_contract_2",
          name: "Holder",
          ifsc: o.ifsc,
          account: o.account,
        });
        const spec = {
          beneficiaryId,
          amountMinor: 1_00,
          mode: "NEFT" as const,
          purposeRef: "loan_contract",
        };
        expect(
          await code(p.payout({ ...spec, authorisation: AGENT_AUTH }, "contract-payout-0002")),
        ).toBe("IPB-SEC-004");
        expect(await code(p.payout(spec as never, "contract-payout-0003"))).toBe("IPB-UX-004");
        expect(await code(p.payout({ ...spec, authorisation: CONTRACT_AUTH }, "short"))).toBe(
          "IPB-UX-004",
        );
        expect(
          await code(
            p.payout(
              { ...spec, amountMinor: 1.5, authorisation: CONTRACT_AUTH },
              "contract-payout-0004",
            ),
          ),
        ).not.toBeNull();
      },
    },
  ];
}

export function docgenContractCases(
  templateId = "sanction_letter",
): Array<ContractCase<DocgenPort>> {
  return [
    {
      name: "renders a template to PDF in STORAGE with its hash, page count and template version",
      async run(p) {
        const t = (await p.listTemplates("tnt_contract")).find((x) => x.templateId === templateId);
        expect(t).toBeTruthy();
        const req = {
          templateId,
          data: { name: "A" },
          format: "pdf" as const,
          outputPrefix: PREFIX,
        };
        const a = await p.render(req);
        expect(a.file.storageKey.startsWith(PREFIX)).toBe(true);
        expect(a.file.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(a.pageCount).toBeGreaterThan(0);
        expect(a.templateVersion).toBe(t?.version);
        const h = await p.renderHtml({ html: "<p>KFS</p>", format: "pdfa", outputPrefix: PREFIX });
        expect(h.format).toBe("pdfa");
        expect(payloadClass(RenderRequest).bodyHighest).toBe("CONFIDENTIAL");
      },
    },
  ];
}

/**
 * DOCGEN `renderHtml` contract cases (#120, R1-D-100), for every adapter that renders HTML, the
 * template ones and `gotenberg` alike: a PDF or PDF/A in STORAGE under the prefix, with its hash and
 * page count; a request outside the schema is refused before anything is rendered.
 */
export function docgenHtmlContractCases(): Array<ContractCase<DocgenPort>> {
  const page = (body: string) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"></head><body>${body}</body></html>`;
  return [
    {
      name: "renders HTML to a PDF in STORAGE under the prefix, with its hash and page count",
      method: "renderHtml",
      async run(p) {
        const a = await p.renderHtml({
          html: page("<h1>Key Fact Statement</h1><p>Loan amount: ₹1,25,000</p>"),
          format: "pdf",
          outputPrefix: PREFIX,
        });
        expect(a.file.storageKey.startsWith(PREFIX)).toBe(true);
        expect(a.file.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(a.format).toBe("pdf");
        expect(a.pageCount).toBeGreaterThan(0);
        expect(a.templateVersion).toBeNull();
      },
    },
    {
      name: "renders PDF/A on request, and refuses a request outside the schema",
      method: "renderHtml",
      async run(p) {
        const a = await p.renderHtml({
          html: page("<p>Notice</p>"),
          format: "pdfa",
          outputPrefix: PREFIX,
        });
        expect(a.format).toBe("pdfa");
        await expect(
          p.renderHtml({ html: page("<p>x</p>"), format: "docx", outputPrefix: PREFIX } as never),
        ).rejects.toThrow();
        await expect(
          p.renderHtml({
            html: page("<p>x</p>"),
            format: "pdf",
            outputPrefix: "../escape",
          } as never),
        ).rejects.toThrow();
        expect(payloadClass(HtmlRenderRequest).bodyHighest).toBe("CONFIDENTIAL");
      },
    },
  ];
}

/**
 * DOCGEN cases for an adapter that writes its files (PR-UDF-077, R1-D-259): each render is an
 * object in `storage` (the one the adapter writes to) under the prefix, whose bytes hash to the
 * returned `sha256`; a PDF and a PDF/A start `%PDF-` and are stored as `application/pdf`.
 */
export function docgenStorageContractCases(storage: StoragePort): Array<ContractCase<DocgenPort>> {
  return [
    {
      name: "writes each rendered PDF and PDF/A to STORAGE, its bytes hashing to the returned sha256",
      method: "renderHtml",
      async run(p) {
        for (const format of ["pdf", "pdfa"] as const) {
          const r = await p.renderHtml({
            html: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Notice</title></head><body><h1>Notice</h1><p>Loan amount: 1,25,000</p></body></html>',
            format,
            outputPrefix: PREFIX,
          });
          expect(r.file.storageKey.startsWith(`${PREFIX}/`)).toBe(true);
          const o = await storage.get(r.file.storageKey);
          expect(sha256Hex(o.body)).toBe(r.file.sha256);
          expect(Buffer.from(o.body.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
          expect(o.meta.contentType).toBe("application/pdf");
          expect(r.pageCount).toBeGreaterThan(0);
        }
      },
    },
  ];
}

export function pdfContractCases(): Array<ContractCase<PdfPort>> {
  const f = (s: string): DocFileRef => ({ storageKey: `${PREFIX}/${s}.pdf`, sha256: sha256Hex(s) });
  return [
    {
      name: "merges, splits and converts as functions over STORAGE references",
      async run(p) {
        const a = f("a");
        const b = f("b");
        const m = await p.merge([a, b], PREFIX);
        expect(await p.pageCount(m)).toBe((await p.pageCount(a)) + (await p.pageCount(b)));
        const parts = await p.split(m, [{ from: 1, to: 1 }], PREFIX);
        expect(await p.pageCount(parts[0]!)).toBe(1);
        await expect(p.split(m, [{ from: 1, to: 999 }], PREFIX)).rejects.toThrow();
        const x = await p.toPdfA(a, PREFIX);
        expect(x.sha256).not.toBe(a.sha256);
        expect((await p.toPdfA(a, PREFIX)).sha256).toBe(x.sha256);
      },
    },
  ];
}

/** Contract cases of the PAYMENTS mandate lifecycle (`MandateLifecycle`). */
export function mandateContractCases(): Array<ContractCase<MandateLifecycle>> {
  const reg = (over: Record<string, unknown> = {}) => ({
    customerRef: "cus_contract",
    channel: "ENACH_NETBANKING",
    maxAmountMinor: 25_000_00,
    frequency: "MONTHLY",
    startDate: "2026-12-01",
    debtorAccountRef: "bac_contract",
    authorisation: CONTRACT_AUTH,
    ...over,
  });
  return [
    {
      name: "registers a mandate once per key, pending the customer; physical NACH needs the form",
      async run(p) {
        const a = await p.registerMandate(reg() as never, "contract-mandate-0001");
        expect((await p.registerMandate(reg() as never, "contract-mandate-0001")).mandateId).toBe(
          a.mandateId,
        );
        expect(a.umrn).toBeNull();
        expect(["initiated", "pending_customer", "pending_bank"]).toContain(a.state);
        await expect(
          p.registerMandate(reg({ channel: "PHYSICAL_NACH" }) as never, "contract-mandate-0002"),
        ).rejects.toThrow(/signed form/);
        expect(payloadClass(MandateRegistration).bodyHighest).toBe("REGULATED");
      },
    },
    {
      name: "refuses an agent and a missing approval; cancellation needs one too",
      async run(p) {
        expect(
          await code(
            p.registerMandate(reg({ authorisation: AGENT_AUTH }) as never, "contract-mandate-0003"),
          ),
        ).toBe("IPB-SEC-004");
        expect(
          await code(
            p.registerMandate(reg({ authorisation: undefined }) as never, "contract-mandate-0004"),
          ),
        ).toBe("IPB-UX-004");
        const m = await p.registerMandate(reg() as never, "contract-mandate-0005");
        expect(
          await code(
            p.cancelMandate(m.mandateId, "closed", AGENT_AUTH as never, "contract-mcancel-0001"),
          ),
        ).toBe("IPB-SEC-004");
        expect(
          (await p.cancelMandate(m.mandateId, "closed", CONTRACT_AUTH, "contract-mcancel-0002"))
            .state,
        ).toBe("cancelled");
      },
    },
  ];
}

/** Contract cases of ESTAMP's optional NeSL Digital Document Execution (`capabilities.dde*`). */
export function estampDdeContractCases(fx: DdeFixtures): Array<ContractCase<EstampPort>> {
  const executants = [
    { partyRef: "p1", name: "Party p1" },
    { partyRef: "p2", name: "Party p2" },
  ];
  const reg = async (p: EstampPort, document = fx.document) => ({
    document,
    certificateId: await fx.certificateId(p),
    executants,
    outputPrefix: fx.outputPrefix,
  });
  return [
    {
      name: "classes the executants REGULATED; DDE is declared and stays IN",
      async run(p) {
        expect(payloadClass(DdeRegistration).bodyHighest).toBe("REGULATED");
        expect(p.descriptor.residency).toBe("IN");
        expect(p.descriptor.capabilities?.ddeRegister).toBeDefined();
      },
    },
    {
      name: "registers a stamped document once per key, pending its executants; another document under the key is refused",
      method: "ddeRegister",
      async run(p) {
        const r = await reg(p);
        const a = await p.ddeRegister!(r, "contract-dde-0001");
        expect((await p.ddeRegister!(r, "contract-dde-0001")).ddeId).toBe(a.ddeId);
        expect(["registered", "pending_execution"]).toContain(a.state);
        expect(a.executed).toEqual([]);
        expect(a.signers).toEqual([]);
        expect(a.notStampableReason).toBeNull();
        expect(
          await code(p.ddeRegister!(await reg(p, fx.otherDocument), "contract-dde-0001")),
        ).toBe("IPB-PORT-004");
        expect((await p.ddeStatus!(a.ddeId)).ddeId).toBe(a.ddeId);
      },
    },
    {
      name: "the executed document is released only once every executant has signed, under the output prefix with its hash",
      method: "ddeDownloadExecuted",
      async run(p) {
        const a = await p.ddeRegister!(await reg(p), "contract-dde-0002");
        await fx.execute(p, a.ddeId, "p1");
        const half = await p.ddeStatus!(a.ddeId);
        expect(half.state).toBe("pending_execution");
        expect(half.executed).toEqual(["p1"]);
        expect(await code(p.ddeDownloadExecuted!(a.ddeId))).toBe("IPB-PORT-001");
        await fx.execute(p, a.ddeId, "p2");
        expect((await p.ddeStatus!(a.ddeId)).state).toBe("executed");
        const f = await p.ddeDownloadExecuted!(a.ddeId);
        expect(f.storageKey.startsWith(fx.outputPrefix)).toBe(true);
        expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      },
    },
    {
      name: "each signed executant carries its evidence: reference, time, method, and the ESP's transaction id or IP",
      method: "ddeStatus",
      async run(p) {
        const a = await p.ddeRegister!(await reg(p), "contract-dde-0003");
        await fx.execute(p, a.ddeId, "p1");
        const half = await p.ddeStatus!(a.ddeId);
        expect(half.signers.map((s) => s.signerRef)).toEqual(half.executed);
        await fx.execute(p, a.ddeId, "p2");
        const done = await p.ddeStatus!(a.ddeId);
        expect(done.signers.map((s) => s.signerRef)).toEqual(["p1", "p2"]);
        for (const s of done.signers) {
          expect(new Date(s.signedAt).toISOString()).toBe(s.signedAt);
          expect(SIGNING_METHODS).toContain(s.method);
          expect(s.espTransactionId !== undefined || s.signerIp !== undefined).toBe(true);
          // The trail names the party by reference only: no executant name, nothing else.
          for (const k of Object.keys(s))
            expect(["signerRef", "signedAt", "method", "espTransactionId", "signerIp"]).toContain(
              k,
            );
          expect(JSON.stringify(s)).not.toContain("Party p");
        }
      },
    },
    {
      name: "registers a not-stampable document with a reason code and no e-stamp; refuses one that also carries an e-stamp or a duty",
      method: "ddeRegister",
      async run(p) {
        const ns = (over: Record<string, unknown> = {}) => ({
          document: fx.document,
          notStampable: { reason: "ACKNOWLEDGEMENT" as const },
          executants,
          outputPrefix: fx.outputPrefix,
          ...over,
        });
        const a = await p.ddeRegister!(ns(), "contract-dde-0004");
        expect(["registered", "pending_execution"]).toContain(a.state);
        expect(a.notStampableReason).toBe("ACKNOWLEDGEMENT");
        expect((await p.ddeStatus!(a.ddeId)).notStampableReason).toBe("ACKNOWLEDGEMENT");
        expect((await p.ddeRegister!(ns(), "contract-dde-0004")).ddeId).toBe(a.ddeId);
        // The same key replayed as a stamped registration is another registration.
        expect(await code(p.ddeRegister!(await reg(p), "contract-dde-0004"))).toBe("IPB-PORT-004");
        const other = await p.ddeRegister!(
          ns({ notStampable: { reason: "OTHER", note: "a borrower's declaration" } }),
          "contract-dde-0005",
        );
        expect(other.notStampableReason).toBe("OTHER");
        // Refused before anything is registered: an e-stamp or a duty with it, OTHER without a
        // note, an unknown reason, or neither path.
        for (const bad of [
          ns({ certificateId: await fx.certificateId(p) }),
          ns({ dutyMinor: 10_000 }),
          ns({ notStampable: { reason: "OTHER" } }),
          ns({ notStampable: { reason: "EXEMPT" } }),
          ns({ notStampable: undefined }),
        ])
          await expect(p.ddeRegister!(bad as never, "contract-dde-0006")).rejects.toThrow();
        // Nothing was registered under the refused key.
        expect(
          (
            await p.ddeRegister!(
              ns({ notStampable: { reason: "NOT_AN_INSTRUMENT" } }),
              "contract-dde-0006",
            )
          ).notStampableReason,
        ).toBe("NOT_AN_INSTRUMENT");
      },
    },
  ];
}

export function esignFakeCases(): Array<ContractCase<FakeEsign>> {
  return [
    {
      name: "completes an envelope and keeps the ESP transaction id and signer IP on each record",
      async run(p) {
        const doc = {
          documentId: "doc_contract",
          sha256: sha256Hex("d"),
          storageKey: `${PREFIX}/D.pdf`,
        };
        const { envelopeId } = await p.createEnvelope(
          doc,
          [
            { ref: "sgn_one", name: "One", method: "AADHAAR_OTP_ESIGN" },
            { ref: "sgn_two", name: "Two", method: "DSC" },
          ],
          "sequential",
          [],
        );
        await p.sendForSignature(envelopeId);
        p.sign(envelopeId, "sgn_one", "198.51.100.7");
        expect((await p.getStatus(envelopeId)).state).toBe("partially_signed");
        p.sign(envelopeId, "sgn_two");
        const signed = await p.downloadSigned(envelopeId);
        expect(signed.signatures).toHaveLength(2);
        expect(signed.signatures[0]).toMatchObject({ signerIp: "198.51.100.7" });
        expect(signed.signatures[0]?.espTransactionId).toMatch(/^ESP-/);
        expect(
          (
            await p.verifySignature({
              ...doc,
              storageKey: signed.storageKey,
              sha256: signed.sha256,
            })
          ).valid,
        ).toBe(true);
      },
    },
  ];
}
