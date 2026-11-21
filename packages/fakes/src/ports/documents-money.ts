// ESTAMP, PAYOUTS, DOCGEN, PDF, the PAYMENTS mandate lifecycle and ESIGN: in-memory fakes and the
// contract cases every future adapter must pass (IPB-01-15; Finbyx PR-FBX-29, R1-D-52). No vendor
// adapter exists for any of them yet; the money-moving ones (payouts, mandates, stamp duty) wait for
// the owner (locked list). The fakes keep the same rules the interfaces document: money-moving calls
// need an idempotency key, an approved request and a user or service initiator (never an agent),
// a replayed key returns the first result, "accepted" is never final, and files are STORAGE
// references with their SHA-256.
import { PortError } from "@infrabyx/contracts/errors";
import {
  AccountValidation,
  BeneficiarySpec,
  DdeRegistration,
  DutyQuoteRequest,
  EstampPurchase,
  HtmlRenderRequest,
  MandateRegistration,
  PayoutSpec,
  RenderRequest,
  assertMoneyCall,
  assertStampRecord,
  isValidStorageKey,
  type AccountValidationResult,
  type AdapterDescriptor,
  type BucketClass,
  type DdeRecord,
  type DdeSignerEvidence,
  type DocFileRef,
  type DocgenPort,
  type DutyQuote,
  type EstampCertificate,
  type EstampPort,
  type Mandate,
  type MandateLifecycle,
  type MoneyAuthorisation,
  type Payout,
  type PayoutsPort,
  type PdfPort,
  type PdfTextRequest,
  type PdfTextResult,
  type PortHealth,
  type RenderFormat,
  type RenderedDocument,
  type StoragePort,
  type TemplateInfo,
} from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";
import { fakeExtractText } from "./pdf-text.js";

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
    capabilities: {
      ddeRegister: "native",
      ddeStatus: "native",
      ddeDownloadExecuted: "native",
      recordCertificate: "native",
    },
  };
  health = up;
  private readonly certs = new Map<string, EstampCertificate>();
  private readonly recordReplays = new Replays<EstampCertificate>();
  /** Recorded certificate numbers, by State, channel and number (a stamp is used once). */
  private readonly recorded = new Map<string, string>();
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

  /**
   * Records a stamp bought outside the platform (R1-D-245): the shared check first, once per key, a
   * certificate number once per State and channel. The fake reads no STORAGE and asks no issuer.
   */
  async recordCertificate(req: unknown, idempotencyKey: string): Promise<EstampCertificate> {
    const r = assertStampRecord("ESTAMP", req, idempotencyKey, "fake-estamp");
    const slot = `${r.state}|${r.channel}|${r.certificateNumber}`;
    return this.recordReplays.run("ESTAMP", idempotencyKey, r, () => {
      if (this.recorded.has(slot))
        throw new PortError("IPB-PORT-004", "ESTAMP", {
          adapter: "fake-estamp",
          detail: "this certificate is already recorded (a stamp is used for one instrument)",
          meta: { reason: "certificate_reused" },
        });
      const id = `est_${++this.n}`;
      const c: EstampCertificate = {
        certificateId: id,
        certificateNumber: r.certificateNumber,
        state: "issued",
        stateCode: r.state,
        instrument: r.instrument,
        dutyMinor: r.dutyMinor,
        purchaserRef: r.purchaser.partyRef,
        file: null,
        vendorRef: `fake-${id}`,
        adapter: "fake-estamp",
        issuedAt: new Date(r.issuedAt).toISOString(),
        channel: r.channel,
        ...(r.statedDutyMinor !== undefined ? { statedDutyMinor: r.statedDutyMinor } : {}),
        stampedDocumentSha256: r.stampedDocument.sha256,
        ...(r.certificateDocumentId !== undefined
          ? { certificateDocumentId: r.certificateDocumentId }
          : {}),
        ...(r.vendorLicence !== undefined ? { vendorLicence: r.vendorLicence } : {}),
        ...(r.vendorCertificateId !== undefined
          ? { vendorCertificateId: r.vendorCertificateId }
          : {}),
        verification: "MANUAL_RECORD",
      };
      this.recorded.set(slot, id);
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
    // A not-stampable registration (a reason code, no certificate or duty) skips the stamp check;
    // the schema refuses one that also names a certificate or a duty (PR-FBX-35 (c)).
    const r = DdeRegistration.parse(req);
    if (!r.notStampable && !this.certs.has(r.certificateId ?? ""))
      throw new PortError("IPB-PORT-001", "ESTAMP", {
        detail: "the document needs its stamp first",
      });
    return this.ddeReplays.run("ESTAMP", idempotencyKey, r, () => {
      const id = `dde_${++this.n}`;
      const rec = {
        ddeId: id,
        state: "pending_execution" as const,
        executed: [] as string[],
        signers: [] as DdeSignerEvidence[],
        notStampableReason: r.notStampable?.reason ?? null,
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

  /** Test helper: an executant signs at the information utility (Aadhaar OTP eSign there). */
  execute(ddeId: string, partyRef: string): void {
    const d = this.dde.get(ddeId) as (DdeRecord & { executants: string[] }) | undefined;
    if (!d) throw new Error("unknown DDE");
    if (!d.executed.includes(partyRef)) {
      d.executed.push(partyRef);
      const n = d.executed.length;
      d.signers.push({
        signerRef: partyRef,
        signedAt: this.now().toISOString(),
        method: "AADHAAR_OTP_ESIGN",
        espTransactionId: `fake-esp-${d.ddeId}-${n}`,
        // Documentation range (RFC 5737): a test address only.
        signerIp: `203.0.113.${n}`,
      });
    }
    if (d.executants.every((e) => d.executed.includes(e))) d.state = "executed";
  }

  private ddePublic(d: DdeRecord): DdeRecord {
    return {
      ddeId: d.ddeId,
      state: d.state,
      executed: [...d.executed],
      signers: d.signers.map((s) => ({ ...s })),
      notStampableReason: d.notStampableReason,
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

/**
 * The document `FakeDocgen` lays out for a renderer (PR-UDF-077, R1-D-259): a title, a level-1
 * heading and paragraphs. It is a subset of `@infrabyx/export`'s block model, so `toPdf` and
 * `toDocx` are renderers as they are.
 */
export interface FakeDocgenDocument {
  title: string;
  blocks: ReadonlyArray<
    { type: "heading"; level: 1; text: string } | { type: "paragraph"; runs: readonly string[] }
  >;
}
/** What `FakeDocgen` asks of the PDF renderer: plain PDF (`{}`) or PDF/A-2b with PDF/UA-1. */
export interface FakeDocgenPdfOptions {
  pdfa?: "2b";
  pdfua?: boolean;
  lang?: string;
}
/**
 * The renderers that give `FakeDocgen` real bytes. `@infrabyx/fakes` cannot depend on
 * `@infrabyx/export` (export's tests depend on `@infrabyx/testing`, which depends on this
 * package), so the caller passes them: `{ pdf: toPdf, docx: toDocx }`.
 */
export interface FakeDocgenRenderers {
  pdf: (doc: FakeDocgenDocument, o: FakeDocgenPdfOptions) => Uint8Array;
  /** Without it, a `docx` render is refused (`IPB-PORT-001`) while files are written. */
  docx?: (doc: FakeDocgenDocument) => Uint8Array;
}
/** Where `FakeDocgen` writes its files (PR-UDF-077). */
export interface FakeDocgenFiles {
  storage: StoragePort;
  renderers: FakeDocgenRenderers;
  /** STORAGE bucket class of rendered documents (default `CONFIDENTIAL`, as their data is). */
  bucketClass?: BucketClass;
}

/** At most this many data fields (or HTML blocks) become paragraphs. */
const FAKE_DOCGEN_MAX_FIELDS = 1_000;
const FAKE_DOCGEN_MAX_TEXT = 2_000;
const CONTENT_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  html: "text/html; charset=utf-8",
} as const;

/** Text the bundled fonts always show: printable ASCII and the rupee sign; the rest become `?`. */
function fakeText(s: string): string {
  let t = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    t += cp < 0x20 || cp === 0x7f ? " " : cp <= 0x7e || cp === 0x20b9 ? ch : "?";
  }
  t = t.replace(/ {2,}/g, " ").trim();
  return t.length > FAKE_DOCGEN_MAX_TEXT ? `${t.slice(0, FAKE_DOCGEN_MAX_TEXT - 3)}...` : t;
}

/** A template render's document: the template and version as the title, a field per paragraph. */
function templateDocument(t: TemplateInfo, data: Record<string, unknown>): FakeDocgenDocument {
  const title = fakeText(`${t.templateId} v${t.version}`);
  const keys = Object.keys(data).sort();
  const paras = keys.slice(0, FAKE_DOCGEN_MAX_FIELDS).map((k) => {
    const v = data[k];
    return fakeText(`${k}: ${typeof v === "string" ? v : (JSON.stringify(v) ?? String(v))}`);
  });
  if (keys.length > FAKE_DOCGEN_MAX_FIELDS)
    paras.push(`${keys.length - FAKE_DOCGEN_MAX_FIELDS} more fields`);
  return {
    title,
    blocks: [
      { type: "heading", level: 1, text: title },
      ...paras.map((p) => ({ type: "paragraph" as const, runs: [p] })),
    ],
  };
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
const decodeEntities = (s: string): string =>
  s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (m, e: string) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
    const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "?";
  });

/** An HTML render's document: its text, a paragraph per block element (a fake: no layout). */
function htmlDocument(html: string): FakeDocgenDocument {
  const named = /<title[^>]*>([^<]*)<\/title>/i.exec(html) ?? /<h1[^>]*>([^<]*)<\/h1>/i.exec(html);
  const title = fakeText(decodeEntities(named?.[1] ?? "")) || "HTML document";
  const text = decodeEntities(
    html
      .replace(/<(head|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<(?:br|\/p|\/h[1-6]|\/li|\/div|\/tr|\/td|\/th)\b[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  );
  const paras = text
    .split("\n")
    .map(fakeText)
    .filter((x) => x !== "")
    .slice(0, FAKE_DOCGEN_MAX_FIELDS);
  return {
    title,
    blocks: [
      { type: "heading", level: 1, text: title },
      ...paras.map((p) => ({ type: "paragraph" as const, runs: [p] })),
    ],
  };
}

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** A `html` render's page: the same document, escaped, with nothing to load. */
function documentHtml(d: FakeDocgenDocument): string {
  const body = d.blocks
    .map((b) =>
      b.type === "heading"
        ? `<h1>${escapeHtml(b.text)}</h1>`
        : `<p>${escapeHtml(b.runs.join(""))}</p>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(d.title)}</title></head><body>${body}</body></html>`;
}

/** Pages of a PDF, by its page objects (`/Type /Page`, not `/Pages`). */
function pdfPages(b: Uint8Array): number {
  return (
    Buffer.from(b)
      .toString("latin1")
      .match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []
  ).length;
}

/**
 * Deterministic rendering. Without `files`, the output is a STORAGE reference whose hash is the
 * hash of the template, data and format (nothing is written). With `files` (PR-UDF-077,
 * R1-D-259), real bytes from the given renderers are written to STORAGE under the request's
 * prefix, as `tenant/<tenant>/<module>/<ULID-shaped id>.<ext>`, with the SHA-256 of the bytes:
 * `pdf` plain PDF, `pdfa` PDF/A-2b claiming PDF/UA-1, `docx` with a `docx` renderer, `html` the
 * page as UTF-8. The id is taken from the bytes' hash, so the same request gives the same key.
 */
export class FakeDocgen implements DocgenPort {
  readonly descriptor: AdapterDescriptor = {
    port: "DOCGEN",
    adapter: "fake-docgen",
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
  };
  health = up;
  constructor(
    private readonly templates: readonly TemplateInfo[] = FAKE_TEMPLATES,
    private readonly files?: FakeDocgenFiles,
  ) {}

  private template(id: string): TemplateInfo {
    const t = this.templates.find((x) => x.templateId === id);
    if (!t) throw new PortError("IPB-PORT-001", "DOCGEN", { detail: `unknown template ${id}` });
    return t;
  }

  /** Renders `doc` in `format` and writes it to STORAGE under `outputPrefix`. */
  private async write(
    files: FakeDocgenFiles,
    doc: FakeDocgenDocument,
    format: RenderFormat,
    outputPrefix: string,
  ): Promise<{ file: DocFileRef; pageCount: number | null }> {
    let body: Uint8Array;
    let ext: keyof typeof CONTENT_TYPES;
    if (format === "pdf" || format === "pdfa") {
      body = files.renderers.pdf(
        doc,
        format === "pdfa" ? { pdfa: "2b", pdfua: true, lang: "en" } : {},
      );
      ext = "pdf";
    } else if (format === "docx") {
      if (!files.renderers.docx)
        throw new PortError("IPB-PORT-001", "DOCGEN", {
          detail: "format docx needs a docx renderer",
        });
      body = files.renderers.docx(doc);
      ext = "docx";
    } else {
      body = new TextEncoder().encode(documentHtml(doc));
      ext = "html";
    }
    const sha256 = sha256Hex(body);
    const storageKey = `${outputPrefix.replace(/\/$/, "")}/0${sha256.slice(0, 25).toUpperCase()}.${ext}`;
    if (!isValidStorageKey(storageKey))
      throw new PortError("IPB-PORT-001", "DOCGEN", {
        detail: "the output prefix must be tenant/<tenant id>/<module>",
      });
    await files.storage.put(storageKey, body, {
      contentType: CONTENT_TYPES[ext],
      bucketClass: files.bucketClass ?? "CONFIDENTIAL",
      sha256,
    });
    return { file: { storageKey, sha256 }, pageCount: ext === "pdf" ? pdfPages(body) : null };
  }

  async render(req: unknown): Promise<RenderedDocument> {
    const r = RenderRequest.parse(req);
    const t = this.template(r.templateId);
    if (!t.formats.includes(r.format))
      throw new PortError("IPB-PORT-001", "DOCGEN", { detail: `format ${r.format} not offered` });
    if (this.files) {
      const doc = templateDocument(t, r.data);
      const out = await this.write(this.files, doc, r.format, r.outputPrefix);
      return { ...out, format: r.format, templateVersion: t.version, adapter: "fake-docgen" };
    }
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
    if (this.files) {
      const out = await this.write(this.files, htmlDocument(r.html), r.format, r.outputPrefix);
      return { ...out, format: r.format, templateVersion: null, adapter: "fake-docgen" };
    }
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

/**
 * PDF operations as pure functions over STORAGE references (hashes derived from the inputs), and
 * `extractText` over `storage` (PR-LDC-39; `fakeExtractText`) when one is given.
 */
export class FakePdf implements PdfPort {
  readonly descriptor: AdapterDescriptor = {
    port: "PDF",
    adapter: "fake-pdf",
    residency: "IN",
    maxDataClass: "REGULATED",
  };
  health = up;
  private readonly pages = new Map<string, number>();
  constructor(private readonly storage?: StoragePort) {}
  async extractText(req: PdfTextRequest): Promise<PdfTextResult> {
    return fakeExtractText(this.storage, req);
  }
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

// ESIGN: FakeEsign lives in ./esign.ts (PR-UDF-070) and is exported from the package index.

// -------------------------------------------------------------------------------- contract cases

const PREFIX = "tenant/tnt_contract/dms";
/** A valid authorisation for contract runs; adapters' sandboxes accept any approval reference. */
export const CONTRACT_AUTH: MoneyAuthorisation = {
  approvalRef: "apr_contract_0001",
  initiatedBy: { principalId: "usr_contract", principalType: "user" },
};

/** Inputs an ESTAMP adapter's DDE contract run needs (owner answer #100, R1-D-62). */
export interface DdeFixtures {
  /** A stamped PDF in the adapter's STORAGE, and another one. */
  document: DocFileRef;
  otherDocument: DocFileRef;
  /** The certificate the document was stamped with (the fake needs one it issued). */
  certificateId: (p: EstampPort) => Promise<string>;
  outputPrefix: string;
  /** Plays an executant signing at the information utility (the stub's or the fake's hook). */
  execute: (p: EstampPort, ddeId: string, partyRef: string) => Promise<void> | void;
}

/** DDE fixtures for `FakeEstamp`: a certificate it issues, and its `execute` hook. */
export const ESTAMP_DDE_FAKE_FIXTURES: DdeFixtures = {
  document: { storageKey: `${PREFIX}/DOC1.pdf`, sha256: sha256Hex("dde-doc-1") },
  otherDocument: { storageKey: `${PREFIX}/DOC2.pdf`, sha256: sha256Hex("dde-doc-2") },
  certificateId: async (p) =>
    (
      await p.purchase(
        {
          state: "MH",
          instrument: "loan_agreement",
          dutyMinor: 50_000,
          considerationMinor: 50_000_000,
          firstParty: { partyRef: "p1", name: "Party p1" },
          secondParty: { partyRef: "p2", name: "Party p2" },
          purchaser: { partyRef: "p1", name: "Party p1" },
          outputPrefix: PREFIX,
          authorisation: CONTRACT_AUTH,
        },
        "contract-dde-stamp-0001",
      )
    ).certificateId,
  outputPrefix: PREFIX,
  execute: (p, ddeId, partyRef) => (p as FakeEstamp).execute(ddeId, partyRef),
};
