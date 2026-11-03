// ESTAMP, PAYOUTS, DOCGEN, PDF, the PAYMENTS mandate lifecycle and ESIGN: in-memory fakes and the
// contract cases every future adapter must pass (IPB-01-15; Finbyx PR-FBX-29, R1-D-52). No vendor
// adapter exists for any of them yet; the money-moving ones (payouts, mandates, stamp duty) wait for
// the owner (locked list). The fakes keep the same rules the interfaces document: money-moving calls
// need an idempotency key, an approved request and a user or service initiator (never an agent),
// a replayed key returns the first result, "accepted" is never final, and files are STORAGE
// references with their SHA-256.
import { expect } from "vitest";
import { PortError } from "@infrabyx/contracts/errors";
import {
  AccountValidation,
  BeneficiarySpec,
  DdeRegistration,
  DocumentRef,
  DutyQuoteRequest,
  EstampPurchase,
  FINAL_PAYOUT_STATES,
  HtmlRenderRequest,
  MandateRegistration,
  PayoutSpec,
  RenderRequest,
  assertMoneyCall,
  payloadClass,
  type AccountValidationResult,
  type AdapterDescriptor,
  type DdeRecord,
  type DocFileRef,
  type DocgenPort,
  type DutyQuote,
  type EnvelopeStatus,
  type EsignPort,
  type EstampCertificate,
  type EstampPort,
  type Mandate,
  type MandateLifecycle,
  type MoneyAuthorisation,
  type Payout,
  type PayoutsPort,
  type PdfPort,
  type PortHealth,
  type RenderedDocument,
  type SignatureRecord,
  type Signer,
  type TemplateInfo,
} from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";
import type { ContractCase } from "../contract.js";

const up = async (): Promise<PortHealth> => ({
  status: "up",
  latency_ms: 0,
  checked_at: new Date().toISOString(),
});

function fakeFile(prefix: string, ...parts: string[]): DocFileRef {
  const h = sha256Hex(parts.join("|"));
  return { storageKey: `${prefix}/${h.slice(0, 26).toUpperCase()}.pdf`, sha256: h };
}

/** Replays: a key used before returns the first result; with another body it is refused. */
class Replays<T> {
  private readonly seen = new Map<string, { body: string; result: T }>();
  run(port: string, key: string, body: unknown, make: () => T): T {
    const b = JSON.stringify(body);
    const prior = this.seen.get(key);
    if (prior) {
      if (prior.body !== b)
        throw new PortError("IPB-PORT-004", port, {
          detail: "idempotency key reused with a different payload",
        });
      return prior.result;
    }
    const result = make();
    this.seen.set(key, { body: b, result });
    return result;
  }
}

// ---------------------------------------------------------------------------------------- ESTAMP

/** Stamp duty for the fake: 0.1 % of the consideration, at least ₹100, per state it covers. */
export class FakeEstamp implements EstampPort {
  readonly descriptor: AdapterDescriptor = {
    port: "ESTAMP",
    adapter: "fake-estamp",
    residency: "IN",
    maxDataClass: "REGULATED",
    capabilities: { ddeRegister: "native", ddeStatus: "native", ddeDownloadExecuted: "native" },
  };
  health = up;
  private readonly certs = new Map<string, EstampCertificate>();
  private readonly attached = new Map<string, string>();
  private readonly dde = new Map<string, DdeRecord & { prefix: string; doc: string }>();
  private readonly replays = new Replays<EstampCertificate>();
  private readonly ddeReplays = new Replays<DdeRecord>();
  private n = 0;
  constructor(private readonly o: { states?: readonly string[]; now?: () => Date } = {}) {}
  private get states(): readonly string[] {
    return this.o.states ?? ["MH", "KA", "DL", "TN", "GJ"];
  }
  private now(): Date {
    return (this.o.now ?? (() => new Date()))();
  }

  async covers(state: string, _instrument?: string): Promise<boolean> {
    return this.states.includes(state);
  }

  async quoteDuty(req: unknown): Promise<DutyQuote> {
    const r = DutyQuoteRequest.parse(req);
    if (!this.states.includes(r.state))
      throw new PortError("IPB-PORT-001", "ESTAMP", { detail: `state ${r.state} not covered` });
    return {
      dutyMinor: Math.max(10_000, Math.round(r.considerationMinor / 1000)),
      ruleSet: "fake.estamp",
      ruleVersion: "1",
    };
  }

  async purchase(req: unknown, idempotencyKey: string): Promise<EstampCertificate> {
    assertMoneyCall("ESTAMP", (req as { authorisation?: unknown })?.authorisation, idempotencyKey);
    const r = EstampPurchase.parse(req);
    if (!this.states.includes(r.state))
      throw new PortError("IPB-PORT-001", "ESTAMP", { detail: `state ${r.state} not covered` });
    return this.replays.run("ESTAMP", idempotencyKey, r, () => {
      const id = `est_${++this.n}`;
      const c: EstampCertificate = {
        certificateId: id,
        certificateNumber: `IN-${r.state}${String(this.n).padStart(10, "0")}`,
        state: "issued",
        stateCode: r.state,
        instrument: r.instrument,
        dutyMinor: r.dutyMinor,
        purchaserRef: r.purchaser.partyRef,
        file: fakeFile(r.outputPrefix, id, r.purchaser.partyRef),
        vendorRef: `fake-${id}`,
        adapter: "fake-estamp",
        issuedAt: this.now().toISOString(),
      };
      this.certs.set(id, c);
      return c;
    });
  }

  async attach(certificateId: string, documentId: string): Promise<void> {
    if (!this.certs.has(certificateId))
      throw new PortError("IPB-PORT-001", "ESTAMP", { detail: "unknown certificate" });
    const prior = this.attached.get(certificateId);
    if (prior && prior !== documentId)
      throw new PortError("IPB-PORT-004", "ESTAMP", {
        detail: "a certificate is attached to one document only",
      });
    this.attached.set(certificateId, documentId);
  }

  async verify(certificateId: string): Promise<EstampCertificate> {
    const c = this.certs.get(certificateId);
    if (!c) throw new PortError("IPB-PORT-001", "ESTAMP", { detail: "unknown certificate" });
    return c;
  }

  async handleWebhook(rawBody: Uint8Array): Promise<EstampCertificate> {
    const { certificateId } = JSON.parse(new TextDecoder().decode(rawBody)) as {
      certificateId: string;
    };
    return this.verify(certificateId);
  }

  async ddeRegister(req: unknown, idempotencyKey: string): Promise<DdeRecord> {
    const r = DdeRegistration.parse(req);
    if (!this.certs.has(r.certificateId))
      throw new PortError("IPB-PORT-001", "ESTAMP", {
        detail: "the document needs its stamp first",
      });
    return this.ddeReplays.run("ESTAMP", idempotencyKey, r, () => {
      const id = `dde_${++this.n}`;
      const rec = {
        ddeId: id,
        state: "pending_execution" as const,
        executed: [] as string[],
        vendorRef: `fake-${id}`,
        adapter: "fake-estamp",
        prefix: r.outputPrefix,
        doc: r.document.sha256,
        executants: r.executants.map((e) => e.partyRef),
      };
      this.dde.set(id, rec);
      return this.ddePublic(rec);
    });
  }

  /** Test helper: an executant signs at the information utility. */
  execute(ddeId: string, partyRef: string): void {
    const d = this.dde.get(ddeId) as (DdeRecord & { executants: string[] }) | undefined;
    if (!d) throw new Error("unknown DDE");
    if (!d.executed.includes(partyRef)) d.executed.push(partyRef);
    if (d.executants.every((e) => d.executed.includes(e))) d.state = "executed";
  }

  private ddePublic(d: DdeRecord): DdeRecord {
    return {
      ddeId: d.ddeId,
      state: d.state,
      executed: [...d.executed],
      vendorRef: d.vendorRef,
      adapter: d.adapter,
    };
  }

  async ddeStatus(ddeId: string): Promise<DdeRecord> {
    const d = this.dde.get(ddeId);
    if (!d) throw new PortError("IPB-PORT-001", "ESTAMP", { detail: "unknown DDE" });
    return this.ddePublic(d);
  }

  async ddeDownloadExecuted(ddeId: string): Promise<DocFileRef> {
    const d = this.dde.get(ddeId);
    if (!d) throw new PortError("IPB-PORT-001", "ESTAMP", { detail: "unknown DDE" });
    if (d.state !== "executed")
      throw new PortError("IPB-PORT-001", "ESTAMP", { detail: "not executed yet" });
    return fakeFile(d.prefix, d.ddeId, d.doc, "executed");
  }
}

// --------------------------------------------------------------------------------------- PAYOUTS

/** A fake disbursement account: every payout is accepted, then settled by `settle()`. */
export class FakePayouts implements PayoutsPort {
  readonly descriptor: AdapterDescriptor = {
    port: "PAYOUTS",
    adapter: "fake-payouts",
    residency: "IN",
    maxDataClass: "REGULATED",
  };
  health = up;
  private readonly beneficiaries = new Map<string, { name: string; account?: string }>();
  private readonly payouts = new Map<string, Payout>();
  private readonly replays = new Replays<Payout>();
  private readonly validations = new Replays<AccountValidationResult>();
  private n = 0;
  constructor(
    private readonly o: {
      balanceMinor?: number;
      /** Account numbers the fake bank closes (a payout to one fails, then is reported failed). */
      closedAccounts?: readonly string[];
      now?: () => Date;
    } = {},
  ) {
    this.balanceMinor = o.balanceMinor ?? 1_000_000_000;
  }
  private balanceMinor: number;
  private now(): Date {
    return (this.o.now ?? (() => new Date()))();
  }

  async lookup(operation: string, idempotencyKey: string) {
    const p = [...this.payouts.values()].find(
      (x) => x.vendorRef === `${operation}:${idempotencyKey}`,
    );
    return p ? { status: "found" as const, result: p } : { status: "absent" as const };
  }

  async createBeneficiary(spec: unknown): Promise<{ beneficiaryId: string }> {
    const b = BeneficiarySpec.parse(spec);
    const id = `ben_${++this.n}`;
    this.beneficiaries.set(id, { name: b.name, ...(b.account ? { account: b.account } : {}) });
    return { beneficiaryId: id };
  }

  async validateAccount(req: unknown, idempotencyKey: string): Promise<AccountValidationResult> {
    const r = AccountValidation.parse(req);
    return this.validations.run("PAYOUTS", idempotencyKey, r, () => {
      const closed = (this.o.closedAccounts ?? []).includes(r.account);
      return {
        valid: !closed,
        holderName: closed ? null : `HOLDER ${r.account.slice(-4)}`,
        vendorRef: `fake-pd-${++this.n}`,
        adapter: "fake-payouts",
        checkedAt: this.now().toISOString(),
      };
    });
  }

  async payout(spec: unknown, idempotencyKey: string): Promise<Payout> {
    assertMoneyCall(
      "PAYOUTS",
      (spec as { authorisation?: unknown })?.authorisation,
      idempotencyKey,
    );
    const s = PayoutSpec.parse(spec);
    const ben = this.beneficiaries.get(s.beneficiaryId);
    if (!ben) throw new PortError("IPB-PORT-001", "PAYOUTS", { detail: "unknown beneficiary" });
    return this.replays.run("PAYOUTS", idempotencyKey, s, () => {
      if (s.amountMinor > this.balanceMinor)
        throw new PortError("IPB-PORT-002", "PAYOUTS", { detail: "insufficient balance" });
      this.balanceMinor -= s.amountMinor;
      const id = `pout_${++this.n}`;
      const p: Payout = {
        payoutId: id,
        beneficiaryId: s.beneficiaryId,
        amountMinor: s.amountMinor,
        mode: s.mode,
        state: "accepted",
        utr: null,
        valueDate: null,
        failureReason: null,
        vendorRef: `payout:${idempotencyKey}`,
        adapter: "fake-payouts",
      };
      this.payouts.set(id, p);
      return { ...p };
    });
  }

  /** Test helper: the bank settles (or, for a closed account, fails and returns) the payout. */
  settle(payoutId: string): Payout {
    const p = this.payouts.get(payoutId);
    if (!p) throw new Error("unknown payout");
    const ben = this.beneficiaries.get(p.beneficiaryId);
    if (ben?.account && (this.o.closedAccounts ?? []).includes(ben.account)) {
      p.state = "failed";
      p.failureReason = "account closed";
      this.balanceMinor += p.amountMinor;
    } else {
      p.state = "settled";
      p.utr = `FAKE${String(this.n).padStart(12, "0")}`;
      p.valueDate = this.now().toISOString().slice(0, 10);
    }
    return { ...p };
  }

  async getStatus(payoutId: string): Promise<Payout> {
    const p = this.payouts.get(payoutId);
    if (!p) throw new PortError("IPB-PORT-001", "PAYOUTS", { detail: "unknown payout" });
    return { ...p };
  }

  async handleWebhook(rawBody: Uint8Array): Promise<Payout> {
    const { payoutId } = JSON.parse(new TextDecoder().decode(rawBody)) as { payoutId: string };
    return this.getStatus(payoutId);
  }

  async balance(): Promise<{ availableMinor: number; asOf: string }> {
    return { availableMinor: this.balanceMinor, asOf: this.now().toISOString() };
  }
}

// -------------------------------------------------------------------------------------- MANDATES

/** The PAYMENTS mandate lifecycle on its own (`MandateLifecycle`); `confirm()` plays the bank. */
export class FakeMandates implements MandateLifecycle {
  private readonly mandates = new Map<string, Mandate>();
  private readonly replays = new Replays<Mandate>();
  private n = 0;

  async registerMandate(spec: unknown, idempotencyKey: string): Promise<Mandate> {
    assertMoneyCall(
      "PAYMENTS",
      (spec as { authorisation?: unknown })?.authorisation,
      idempotencyKey,
    );
    const m = MandateRegistration.parse(spec);
    return this.replays.run("PAYMENTS", idempotencyKey, m, () => {
      const id = `mdt_${++this.n}`;
      const physical = m.channel === "PHYSICAL_NACH";
      const out: Mandate = {
        mandateId: id,
        channel: m.channel,
        state: physical ? "pending_bank" : "pending_customer",
        umrn: null,
        maxAmountMinor: m.maxAmountMinor,
        authorisationUrl: physical ? null : `https://fake-mandates.invalid/authorise/${id}`,
        rejectionReason: null,
        vendorRef: `fake-${id}`,
        adapter: "fake-mandates",
      };
      this.mandates.set(id, out);
      return { ...out };
    });
  }

  /** Test helper: the customer authorises and the sponsor bank registers the mandate (UMRN). */
  confirm(mandateId: string, accept = true): Mandate {
    const m = this.mandates.get(mandateId);
    if (!m) throw new Error("unknown mandate");
    if (accept) {
      m.state = "active";
      m.umrn = `FAKE${String(this.n).padStart(16, "0")}`;
    } else {
      m.state = "rejected";
      m.rejectionReason = "rejected by the destination bank";
    }
    return { ...m };
  }

  async mandateStatus(mandateId: string): Promise<Mandate> {
    const m = this.mandates.get(mandateId);
    if (!m) throw new PortError("IPB-PORT-001", "PAYMENTS", { detail: "unknown mandate" });
    return { ...m };
  }

  async cancelMandate(
    mandateId: string,
    _reason: string,
    authorisation: MoneyAuthorisation,
    idempotencyKey: string,
  ): Promise<Mandate> {
    assertMoneyCall("PAYMENTS", authorisation, idempotencyKey);
    const m = this.mandates.get(mandateId);
    if (!m) throw new PortError("IPB-PORT-001", "PAYMENTS", { detail: "unknown mandate" });
    if (m.state === "cancelled") return { ...m };
    if (["rejected", "expired"].includes(m.state)) throw new RangeError(`mandate is ${m.state}`);
    m.state = "cancelled";
    return { ...m };
  }
}

// ----------------------------------------------------------------------------------- DOCGEN, PDF

/** Deterministic rendering: the output's hash is the hash of the template, data and format. */
export class FakeDocgen implements DocgenPort {
  readonly descriptor: AdapterDescriptor = {
    port: "DOCGEN",
    adapter: "fake-docgen",
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
  };
  health = up;
  constructor(private readonly templates: readonly TemplateInfo[] = FAKE_TEMPLATES) {}

  private template(id: string): TemplateInfo {
    const t = this.templates.find((x) => x.templateId === id);
    if (!t) throw new PortError("IPB-PORT-001", "DOCGEN", { detail: `unknown template ${id}` });
    return t;
  }

  async render(req: unknown): Promise<RenderedDocument> {
    const r = RenderRequest.parse(req);
    const t = this.template(r.templateId);
    if (!t.formats.includes(r.format))
      throw new PortError("IPB-PORT-001", "DOCGEN", { detail: `format ${r.format} not offered` });
    return {
      file: fakeFile(r.outputPrefix, r.templateId, t.version, r.format, JSON.stringify(r.data)),
      format: r.format,
      pageCount: r.format === "html" ? null : 1 + (JSON.stringify(r.data).length % 5),
      templateVersion: t.version,
      adapter: "fake-docgen",
    };
  }

  async renderBatch(reqs: unknown[]): Promise<RenderedDocument[]> {
    return Promise.all(reqs.map((r) => this.render(r)));
  }

  async renderHtml(req: unknown): Promise<RenderedDocument> {
    const r = HtmlRenderRequest.parse(req);
    return {
      file: fakeFile(r.outputPrefix, "html", r.format, r.html),
      format: r.format,
      pageCount: 1 + Math.floor(r.html.length / 3000),
      templateVersion: null,
      adapter: "fake-docgen",
    };
  }

  async previewHtml(templateId: string, data: Record<string, unknown>): Promise<string> {
    this.template(templateId);
    return `<!doctype html><title>${templateId}</title><pre>${Object.keys(data).sort().join(",")}</pre>`;
  }

  async listTemplates(): Promise<TemplateInfo[]> {
    return [...this.templates];
  }

  async validateTemplate(file: DocFileRef): Promise<{ valid: boolean; problems: string[] }> {
    return /^[0-9a-f]{64}$/.test(file.sha256)
      ? { valid: true, problems: [] }
      : { valid: false, problems: ["unreadable file"] };
  }
}

export const FAKE_TEMPLATES: readonly TemplateInfo[] = [
  { templateId: "sanction_letter", version: "3", formats: ["pdf", "pdfa", "docx", "html"] },
  { templateId: "kfs", version: "2", formats: ["pdf", "pdfa"] },
];

/** PDF operations as pure functions over STORAGE references (hashes derived from the inputs). */
export class FakePdf implements PdfPort {
  readonly descriptor: AdapterDescriptor = {
    port: "PDF",
    adapter: "fake-pdf",
    residency: "IN",
    maxDataClass: "REGULATED",
  };
  health = up;
  private readonly pages = new Map<string, number>();
  private out(prefix: string, op: string, ...inputs: string[]): DocFileRef {
    const f = fakeFile(prefix, op, ...inputs);
    return f;
  }
  /** Test helper: declare a file's page count (default 3). */
  setPages(file: DocFileRef, n: number): void {
    this.pages.set(file.sha256, n);
  }
  async pageCount(file: DocFileRef): Promise<number> {
    return this.pages.get(file.sha256) ?? 3;
  }
  async merge(files: DocFileRef[], outputPrefix: string): Promise<DocFileRef> {
    if (files.length < 2) throw new RangeError("merge needs two files or more");
    const f = this.out(outputPrefix, "merge", ...files.map((x) => x.sha256));
    let n = 0;
    for (const x of files) n += await this.pageCount(x);
    this.pages.set(f.sha256, n);
    return f;
  }
  async split(
    file: DocFileRef,
    ranges: { from: number; to: number }[],
    outputPrefix: string,
  ): Promise<DocFileRef[]> {
    const n = await this.pageCount(file);
    return ranges.map((r) => {
      if (r.from < 1 || r.to > n || r.from > r.to)
        throw new RangeError("range outside the document");
      const f = this.out(outputPrefix, "split", file.sha256, `${r.from}-${r.to}`);
      this.pages.set(f.sha256, r.to - r.from + 1);
      return f;
    });
  }
  async stamp(
    file: DocFileRef,
    mark: { text?: string; image?: DocFileRef },
    position: { page: number },
    outputPrefix: string,
  ): Promise<DocFileRef> {
    if (!mark.text && !mark.image) throw new RangeError("a stamp has a text or an image");
    if (position.page > (await this.pageCount(file)))
      throw new RangeError("page outside the document");
    return this.out(outputPrefix, "stamp", file.sha256, mark.text ?? mark.image?.sha256 ?? "");
  }
  async sign(
    file: DocFileRef,
    keyRef: string,
    _f: unknown,
    outputPrefix: string,
  ): Promise<DocFileRef> {
    return this.out(outputPrefix, "sign", file.sha256, keyRef);
  }
  async redact(file: DocFileRef, regions: unknown[], outputPrefix: string): Promise<DocFileRef> {
    if (!regions.length) throw new RangeError("nothing to redact");
    return this.out(outputPrefix, "redact", file.sha256, JSON.stringify(regions));
  }
  async toPdfA(file: DocFileRef, outputPrefix: string): Promise<DocFileRef> {
    return this.out(outputPrefix, "pdfa", file.sha256);
  }
  async extractPages(file: DocFileRef, pages: number[], outputPrefix: string): Promise<DocFileRef> {
    const n = await this.pageCount(file);
    if (!pages.length || pages.some((p) => p < 1 || p > n))
      throw new RangeError("page outside the document");
    const f = this.out(outputPrefix, "extract", file.sha256, pages.join(","));
    this.pages.set(f.sha256, pages.length);
    return f;
  }
  async watermark(file: DocFileRef, text: string, outputPrefix: string): Promise<DocFileRef> {
    return this.out(outputPrefix, "watermark", file.sha256, text);
  }
  async linearise(file: DocFileRef, outputPrefix: string): Promise<DocFileRef> {
    return this.out(outputPrefix, "linearise", file.sha256);
  }
}

// ----------------------------------------------------------------------------------------- ESIGN

/**
 * A deterministic ESIGN fake (PR-FBX-29 item 6): envelopes move to `completed` as each signer
 * signs through `sign()`, and every signature record carries the ESP's transaction id and the
 * signer's IP (item 7). It never downgrades a signer's method.
 */
export class FakeEsign implements EsignPort {
  readonly descriptor: AdapterDescriptor = {
    port: "ESIGN",
    adapter: "fake-esign",
    residency: "IN",
    maxDataClass: "REGULATED",
  };
  health = up;
  private readonly envelopes = new Map<
    string,
    EnvelopeStatus & { doc: DocumentRef; records: SignatureRecord[] }
  >();
  private n = 0;
  constructor(private readonly now: () => Date = () => new Date()) {}

  async createEnvelope(
    doc: DocumentRef,
    signers: Signer[],
    _order?: "sequential" | "parallel",
    _fields?: unknown[],
  ): Promise<{ envelopeId: string }> {
    DocumentRef.parse(doc);
    if (!signers.length) throw new RangeError("an envelope has a signer");
    const id = `esr_FAKE${String(++this.n).padStart(22, "0")}`;
    this.envelopes.set(id, {
      envelopeId: id,
      vendorRef: `fake-${this.n}`,
      state: "draft",
      signers: signers.map((s) => ({ ref: s.ref, state: "pending", method: s.method })),
      doc,
      records: [],
    });
    return { envelopeId: id };
  }
  private get(id: string) {
    const e = this.envelopes.get(id);
    if (!e) throw new PortError("IPB-PORT-001", "ESIGN", { detail: "unknown envelope" });
    return e;
  }
  private status(id: string): EnvelopeStatus {
    const e = this.get(id);
    return {
      envelopeId: e.envelopeId,
      vendorRef: e.vendorRef,
      state: e.state,
      signers: e.signers.map((s) => ({ ...s })),
    };
  }
  async sendForSignature(id: string): Promise<EnvelopeStatus> {
    const e = this.get(id);
    if (e.state === "draft") e.state = "sent";
    return this.status(id);
  }
  async getStatus(id: string): Promise<EnvelopeStatus> {
    return this.status(id);
  }
  /** Test helper: a signer signs at the ESP from `ip`. */
  sign(id: string, signerRef: string, ip = "203.0.113.10"): EnvelopeStatus {
    const e = this.get(id);
    const s = e.signers.find((x) => x.ref === signerRef);
    if (!s || !["sent", "partially_signed"].includes(e.state)) throw new Error("cannot sign now");
    s.state = "signed";
    s.at = this.now().toISOString();
    e.records.push({
      alg: "rsa-pkcs1-sha256",
      keyId: `fake-key-${signerRef}`,
      certChainRef: `fake-chain-${signerRef}`,
      signerRef,
      signedAt: s.at,
      espTransactionId: `ESP-${sha256Hex(id + signerRef)
        .slice(0, 16)
        .toUpperCase()}`,
      signerIp: ip,
    });
    e.state = e.signers.every((x) => x.state === "signed") ? "completed" : "partially_signed";
    return this.status(id);
  }
  async downloadSigned(id: string) {
    const e = this.get(id);
    if (e.state !== "completed")
      throw new PortError("IPB-PORT-001", "ESIGN", { detail: "envelope not completed" });
    const sha256 = sha256Hex(e.doc.sha256 + JSON.stringify(e.records));
    return {
      storageKey: `${e.doc.storageKey}.signed.pdf`,
      sha256,
      signatures: e.records.map((r) => ({ ...r })),
    };
  }
  async aadhaarEsign(session: { envelopeId: string; signerRef: string }) {
    this.get(session.envelopeId);
    return { redirectUrl: `https://fake-esp.invalid/${session.envelopeId}/${session.signerRef}` };
  }
  async dscSign(session: { envelopeId: string; signerRef: string }) {
    this.get(session.envelopeId);
    return { redirectUrl: `https://fake-dsc.invalid/${session.envelopeId}/${session.signerRef}` };
  }
  async verifySignature(doc: DocumentRef) {
    const e = [...this.envelopes.values()].find(
      (x) => `${x.doc.storageKey}.signed.pdf` === doc.storageKey,
    );
    return { valid: !!e && e.state === "completed", signatures: e?.records ?? [] };
  }
  async cancel(id: string): Promise<void> {
    const e = this.get(id);
    if (e.state === "completed") throw new RangeError("the envelope is completed");
    e.state = "cancelled";
  }
  async handleWebhook(rawBody: Uint8Array): Promise<EnvelopeStatus> {
    const { envelopeId } = JSON.parse(new TextDecoder().decode(rawBody)) as { envelopeId: string };
    return this.status(envelopeId);
  }
}

// -------------------------------------------------------------------------------- contract cases

const PREFIX = "tenant/tnt_contract/dms";
/** A valid authorisation for contract runs; adapters' sandboxes accept any approval reference. */
export const CONTRACT_AUTH: MoneyAuthorisation = {
  approvalRef: "apr_contract_0001",
  initiatedBy: { principalId: "usr_contract", principalType: "user" },
};
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
