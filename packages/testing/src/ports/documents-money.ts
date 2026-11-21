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
import {
  padesSignerCertificates,
  sha256Hex,
  signerCertificateSummary,
  verifyPadesSignatures,
} from "@infrabyx/crypto";
import { minimalPdf, padesTestAuthority } from "@infrabyx/crypto/pades-test";
import type { ContractCase } from "../contract.js";
import { CONTRACT_AUTH, type DdeFixtures, FakeEsign } from "@infrabyx/fakes";
import type { DocumentRef, Signer } from "@infrabyx/contracts/ports";
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
  type FakeEsignOptions,
  type FakeEsignSignedObject,
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
    {
      name: "@IPB-01-15 PR-UDF-070 every record carries its signer certificate's summary",
      async run(p) {
        const doc = esignDoc("cert");
        const { envelopeId } = await p.createEnvelope(
          doc,
          [{ ref: "sgn_one", name: "One Test", method: "AADHAAR_OTP_ESIGN" }],
          "parallel",
          [],
        );
        await p.sendForSignature(envelopeId);
        p.sign(envelopeId, "sgn_one");
        const [r] = (await p.downloadSigned(envelopeId)).signatures;
        expect(r?.signerCertificate).toMatchObject({
          subjectCommonName: "One Test",
          serialNumber: expect.stringMatching(/^[0-9A-F]+$/),
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          issuer: expect.stringContaining("CN="),
        });
        const c = r!.signerCertificate!;
        expect(Date.parse(c.notBefore)).toBeLessThan(Date.parse(c.notAfter));
      },
    },
    {
      name: "@IPB-01-15 PR-UDF-070 a multi-document envelope completes only when every document is signed by every signer",
      method: "createMultiDocumentEnvelope",
      async run(p) {
        const a = esignDoc("multi-a");
        const b = esignDoc("multi-b");
        const signers: Signer[] = [
          { ref: "sgn_one", name: "One", method: "AADHAAR_OTP_ESIGN" },
          { ref: "sgn_two", name: "Two", method: "AADHAAR_OTP_ESIGN" },
        ];
        const field = { signerRef: "sgn_two", page: 1, x: 10, y: 10, width: 100, height: 40 };
        const { envelopeId } = await p.createMultiDocumentEnvelope(
          [
            { doc: a, fields: [] },
            { doc: b, fields: [field] },
          ],
          signers,
          "sequential",
        );
        await p.sendForSignature(envelopeId);
        let st = p.signDocument(envelopeId, "sgn_one", a.documentId);
        expect(st.state).toBe("partially_signed");
        expect(st.signers[0]?.state).toBe("pending");
        expect(st.documents).toEqual([
          { documentId: a.documentId, state: "partially_signed", signedBy: ["sgn_one"] },
          { documentId: b.documentId, state: "pending", signedBy: [] },
        ]);
        p.sign(envelopeId, "sgn_one");
        st = p.signDocument(envelopeId, "sgn_two", b.documentId);
        expect(st.documents?.map((d) => d.state)).toEqual(["partially_signed", "signed"]);
        // All or nothing: nothing downloads until every document is signed by every signer.
        await expect(p.downloadSignedDocuments(envelopeId)).rejects.toMatchObject({
          meta: { reason: "not_completed" },
        });
        st = p.sign(envelopeId, "sgn_two");
        expect(st.state).toBe("completed");
        await expect(p.downloadSigned(envelopeId)).rejects.toMatchObject({
          code: "IPB-PORT-001",
          meta: { reason: "multi_document" },
        });
        const out = await p.downloadSignedDocuments(envelopeId);
        expect(out.documents.map((d) => d.documentId)).toEqual([a.documentId, b.documentId]);
        for (const d of out.documents) {
          expect(d.signatures.map((s) => s.signerRef).sort()).toEqual(["sgn_one", "sgn_two"]);
          for (const s of d.signatures)
            expect(s.signerCertificate?.sha256).toMatch(/^[0-9a-f]{64}$/);
        }
        // A single-document envelope downloads through either method.
        const one = await p.createEnvelope(esignDoc("multi-c"), [signers[0]!], "parallel", []);
        await p.sendForSignature(one.envelopeId);
        p.sign(one.envelopeId, "sgn_one");
        expect((await p.downloadSignedDocuments(one.envelopeId)).documents).toHaveLength(1);
        expect((await p.getStatus(one.envelopeId)).documents).toBeUndefined();
      },
    },
    {
      name: "@IPB-01-15 PR-UDF-070 a multi-document envelope refuses duplicates, more than ten documents and fields naming no signer; a decline declines it",
      async run(p) {
        const s: Signer[] = [{ ref: "sgn_one", name: "One", method: "DSC" }];
        const a = esignDoc("bad-a");
        for (const docs of [
          [
            { doc: a, fields: [] },
            { doc: { ...esignDoc("bad-b"), documentId: a.documentId }, fields: [] },
          ],
          Array.from({ length: 11 }, (_, i) => ({ doc: esignDoc(`bad-${i}`), fields: [] })),
          [
            {
              doc: a,
              fields: [{ signerRef: "nobody", page: 1, x: 0, y: 0, width: 1, height: 1 }],
            },
          ],
          [],
        ])
          await expect(p.createMultiDocumentEnvelope(docs, s, "parallel")).rejects.toMatchObject({
            code: "IPB-PORT-001",
            meta: { reason: "invalid_request" },
          });
        const { envelopeId } = await p.createMultiDocumentEnvelope(
          [
            { doc: a, fields: [] },
            { doc: esignDoc("bad-b"), fields: [] },
          ],
          [...s, { ref: "sgn_two", name: "Two", method: "DSC" }],
          "parallel",
        );
        await p.sendForSignature(envelopeId);
        p.sign(envelopeId, "sgn_one");
        expect(p.decline(envelopeId, "sgn_two").state).toBe("declined");
        await expect(p.downloadSignedDocuments(envelopeId)).rejects.toMatchObject({
          meta: { reason: "not_completed" },
        });
      },
    },
  ];
}

let esignSeq = 0;
/** A document reference for the fake without STORAGE (its bytes are never read). */
const esignDoc = (tag: string): DocumentRef => ({
  documentId: `doc_${tag}_${++esignSeq}`,
  sha256: sha256Hex(`esign-${tag}-${esignSeq}`),
  storageKey: `tenant/tnt_contract/documents/01JA${String(esignSeq).padStart(22, "0")}.pdf`,
});

/**
 * PR-UDF-070: `FakeEsign({ storage })` cases. The fake must be built over `storage`; each case
 * puts its own documents there. PR-UDF-074 (R1-D-260): with `opts.keyRef`, a reference `storage`
 * resolves in tenant `tnt_contract` (REGULATED), the named-key download cases run too; `storage`
 * must not know `opts.unknownKeyRef` (default `lender:contract_unknown`).
 */
export function esignFakeStorageCases(
  storage: StoragePort,
  opts: { keyRef?: string; unknownKeyRef?: string } = {},
): Array<ContractCase<FakeEsign>> {
  let seq = 0;
  const put = async (body: Uint8Array): Promise<DocumentRef> => {
    const n = ++seq;
    const storageKey = `tenant/tnt_contract/documents/01JB${String(n).padStart(22, "0")}.pdf`;
    await storage.put(storageKey, body, {
      bucketClass: "REGULATED",
      contentType: "application/pdf",
    });
    return { documentId: `doc_stored_${n}`, sha256: sha256Hex(body), storageKey };
  };
  const two: Signer[] = [
    { ref: "sgn_one", name: "One Test", method: "AADHAAR_OTP_ESIGN" },
    { ref: "sgn_two", name: "Two Test", method: "DSC" },
  ];
  const complete = async (p: FakeEsign, doc: DocumentRef, signers = two) => {
    const { envelopeId } = await p.createEnvelope(doc, signers, "sequential", []);
    await p.sendForSignature(envelopeId);
    for (const s of signers) p.sign(envelopeId, s.ref);
    return envelopeId;
  };
  const keyRef = opts.keyRef;
  const unknownKeyRef = opts.unknownKeyRef ?? "lender:contract_unknown";
  // Own signer references, so the fake's chain keys (envelope and signer) never meet the other
  // cases' chains, written without a reference, in a shared store (STORAGE's `key_ref_changed`).
  const mine: Signer[] = two.map((s) => ({ ...s, ref: `${s.ref}_named` }));
  const named: Array<ContractCase<FakeEsign>> = keyRef
    ? [
        {
          name: "@IPB-01-15 PR-UDF-074 a download naming the tenant's key writes the signed PDF and the chains under it",
          async run(p) {
            const envelopeId = await complete(p, await put(minimalPdf()), mine);
            const out = await p.downloadSigned(envelopeId, { keyRef });
            const stored = await storage.get(out.storageKey);
            expect(stored.meta).toMatchObject({ bucketClass: "REGULATED", keyRef });
            expect(sha256Hex(stored.body)).toBe(out.sha256);
            const [obj] = p.signedObjects().filter((o) => o.envelopeId === envelopeId);
            expect(obj?.keyRef).toBe(keyRef);
            for (const c of obj?.chains ?? [])
              expect((await storage.get(c.storageKey)).meta.keyRef).toBe(keyRef);
            // The same reference returns the same file; another (or none) is refused, never a
            // second copy under another key.
            expect((await p.downloadSigned(envelopeId, { keyRef })).storageKey).toBe(
              out.storageKey,
            );
            for (const other of [{}, { keyRef: unknownKeyRef }])
              await expect(p.downloadSigned(envelopeId, other)).rejects.toMatchObject({
                code: "IPB-PORT-003",
                meta: { reason: "key_ref_changed" },
              });
          },
        },
        {
          name: "@IPB-01-15 PR-UDF-074 a key the tenant does not have, or a malformed reference, fails the download and writes nothing",
          async run(p) {
            const envelopeId = await complete(p, await put(minimalPdf()), mine);
            const before = p.signedObjects().length;
            await expect(
              p.downloadSigned(envelopeId, { keyRef: unknownKeyRef }),
            ).rejects.toMatchObject({ meta: { reason: "key_ref_unknown" } });
            for (const bad of ["arn:aws:kms:ap-south-1:111122223333:key/x", "X", "mrk-1234"])
              await expect(p.downloadSigned(envelopeId, { keyRef: bad })).rejects.toMatchObject({
                code: "IPB-PORT-003",
                meta: { reason: "key_ref_invalid" },
              });
            expect(p.signedObjects()).toHaveLength(before);
            const tenantEsign = (await storage.list("tenant/tnt_contract/esign/")).keys;
            // Never a fallback to the class key: the refused calls wrote no signed file.
            const out = await p.downloadSigned(envelopeId, { keyRef });
            expect(tenantEsign).not.toContain(out.storageKey);
            expect((await storage.get(out.storageKey)).meta.keyRef).toBe(keyRef);
            for (const c of p.signedObjects().at(-1)?.chains ?? [])
              expect((await storage.get(c.storageKey)).meta.keyRef).toBe(keyRef);
          },
        },
        {
          name: "@IPB-01-15 PR-UDF-074 a multi-document download names one key for every signed document",
          async run(p) {
            const { envelopeId } = await p.createMultiDocumentEnvelope(
              [
                { doc: await put(minimalPdf()), fields: [] },
                { doc: await put(minimalPdf()), fields: [] },
              ],
              mine,
              "parallel",
            );
            await p.sendForSignature(envelopeId);
            for (const s of mine) p.sign(envelopeId, s.ref);
            await expect(
              p.downloadSignedDocuments(envelopeId, { keyRef: unknownKeyRef }),
            ).rejects.toMatchObject({ meta: { reason: "key_ref_unknown" } });
            const out = await p.downloadSignedDocuments(envelopeId, { keyRef });
            for (const d of out.documents)
              expect((await storage.get(d.storageKey)).meta.keyRef).toBe(keyRef);
          },
        },
      ]
    : [];
  return [
    ...named,
    {
      name: "@IPB-01-15 PR-UDF-070 the signed PDF and each signer's chain go to STORAGE (REGULATED, IPB-01-27 keys, SHA-256 of the bytes)",
      async run(p) {
        const envelopeId = await complete(p, await put(minimalPdf()));
        const out = await p.downloadSigned(envelopeId);
        expect(out.storageKey).toMatch(/^tenant\/tnt_contract\/esign\/[0-7][0-9A-Z]{25}\.pdf$/);
        const stored = await storage.get(out.storageKey);
        expect(sha256Hex(stored.body)).toBe(out.sha256);
        expect(stored.meta).toMatchObject({
          bucketClass: "REGULATED",
          contentType: "application/pdf",
        });
        // A real PAdES file: one signature per signer, in signing order, each naming its record's certificate.
        const v = verifyPadesSignatures(stored.body, { trust: p.trustStore() });
        expect(v).toMatchObject({ outcome: "valid", trustStore: "custom" });
        expect(v.signatures).toHaveLength(2);
        expect(padesSignerCertificates(stored.body)).toEqual(
          out.signatures.map((s) => s.signerCertificate),
        );
        expect(out.signatures.map((s) => s.signerCertificate?.subjectCommonName)).toEqual([
          "One Test",
          "Two Test",
        ]);
        const [obj] = p.signedObjects();
        expect(obj).toMatchObject({ envelopeId, storageKey: out.storageKey, base: "original" });
        expect(obj?.chains.map((c) => c.signerRef)).toEqual(["sgn_one", "sgn_two"]);
        for (const [i, c] of (obj?.chains ?? []).entries()) {
          expect(c.storageKey).toMatch(/^tenant\/tnt_contract\/esign\/[0-7][0-9A-Z]{25}\.pem$/);
          expect(out.signatures[i]?.certChainRef).toBe(c.storageKey);
          const chain = await storage.get(c.storageKey);
          expect(sha256Hex(chain.body)).toBe(c.sha256);
          expect(chain.meta.bucketClass).toBe("REGULATED");
          const text = Buffer.from(chain.body).toString("utf8");
          expect(text.match(/BEGIN CERTIFICATE/g)).toHaveLength(3);
          expect(signerCertificateSummary(text)).toEqual(out.signatures[i]?.signerCertificate);
        }
        // A second download returns the same object; nothing is written twice.
        expect((await p.downloadSigned(envelopeId)).storageKey).toBe(out.storageKey);
        expect(p.signedObjects()).toHaveLength(1);
        expect(
          (
            await p.verifySignature({
              documentId: "x",
              storageKey: out.storageKey,
              sha256: out.sha256,
            })
          ).valid,
        ).toBe(true);
      },
    },
    {
      name: "@IPB-01-15 PR-UDF-070 the document is read from STORAGE: a SHA-256 mismatch or a non-PDF is refused",
      async run(p) {
        const doc = await put(minimalPdf());
        await expect(
          p.createEnvelope({ ...doc, sha256: "0".repeat(64) }, two, "parallel", []),
        ).rejects.toMatchObject({ code: "IPB-PORT-001", meta: { reason: "hash_mismatch" } });
        await expect(
          p.createEnvelope(await put(Buffer.from("not a pdf")), two, "parallel", []),
        ).rejects.toMatchObject({ meta: { reason: "invalid_request" } });
      },
    },
    {
      name: "@IPB-01-15 PR-UDF-070 test hooks: an injected download failure writes nothing; an injected signer certificate is named",
      async run(p) {
        const envelopeId = await complete(p, await put(minimalPdf()));
        const before = p.signedObjects().length;
        p.failNextDownload();
        await expect(p.downloadSigned(envelopeId)).rejects.toMatchObject({ code: "IPB-PORT-002" });
        expect(p.signedObjects()).toHaveLength(before);
        await p.downloadSigned(envelopeId);
        expect(p.signedObjects()).toHaveLength(before + 1);

        // A different ESP certificate that signs: the PDF verifies under that authority.
        const other = padesTestAuthority({ kind: "ec256" });
        const esp = other.newSigner({ kind: "ec256", subject: "Other ESP Signer" });
        p.setSignerCertificate("sgn_solo", esp);
        const solo: Signer[] = [{ ref: "sgn_solo", name: "Solo", method: "DSC" }];
        const a = await p.downloadSigned(await complete(p, await put(minimalPdf()), solo));
        expect(a.signatures[0]?.signerCertificate).toEqual(signerCertificateSummary(esp.der));
        const body = (await storage.get(a.storageKey)).body;
        expect(verifyPadesSignatures(body, { trust: other.trust }).valid).toBe(true);

        // A certificate given as bytes is named, but the PDF is signed by another: a mismatch.
        const named = other.newSigner({ kind: "ec256", subject: "Named Only" });
        p.setSignerCertificate("sgn_named", named.der);
        const b = await p.downloadSigned(
          await complete(p, await put(minimalPdf()), [
            { ref: "sgn_named", name: "N", method: "DSC" },
          ]),
        );
        const inPdf = padesSignerCertificates((await storage.get(b.storageKey)).body);
        expect(b.signatures[0]?.signerCertificate?.subjectCommonName).toBe("Named Only");
        expect(inPdf[0]?.sha256).not.toBe(b.signatures[0]?.signerCertificate?.sha256);
        expect(() => p.setSignerCertificate("sgn_bad", new Uint8Array([1, 2, 3]))).toThrow(
          TypeError,
        );
      },
    },
    {
      name: "@IPB-01-15 PR-UDF-070 a multi-document envelope writes each signed document; an original without a classic trailer is signed as a fixture",
      async run(p) {
        const a = await put(minimalPdf());
        const b = await put(Buffer.from("%PDF-1.7\n% no classic cross-reference\n%%EOF\n"));
        const { envelopeId } = await p.createMultiDocumentEnvelope(
          [
            { doc: a, fields: [] },
            { doc: b, fields: [] },
          ],
          two,
          "parallel",
        );
        await p.sendForSignature(envelopeId);
        for (const s of two) p.sign(envelopeId, s.ref);
        const out = await p.downloadSignedDocuments(envelopeId);
        expect(new Set(out.documents.map((d) => d.storageKey)).size).toBe(2);
        for (const d of out.documents) {
          const body = (await storage.get(d.storageKey)).body;
          expect(sha256Hex(body)).toBe(d.sha256);
          expect(verifyPadesSignatures(body, { trust: p.trustStore() }).valid).toBe(true);
        }
        expect(
          p
            .signedObjects()
            .filter((o) => o.envelopeId === envelopeId)
            .map((o) => o.base),
        ).toEqual(["original", "fixture"]);
      },
    },
  ];
}
