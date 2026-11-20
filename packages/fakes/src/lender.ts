// A contract-faithful mock lender (Udofin PR-UDF-051; R1-D-217): Finbyx's side of the origination
// contract (Ecosystem Specification §6.2) and the two §6.3 items of the loan journey, so an LSP's
// tests run against the same messages, idempotency keys and signatures as the real lender. Every
// message it takes or gives is checked against `@infrabyx/contracts/events` (`ORIGINATION_EVENTS`);
// every regulated one carries a detached JWS made with its own ES256 key, which `keys` holds, so a
// test verifies with `verifyRegulatedMessage` exactly as against the real lender. Test only.
// PR-UDF-053 (R1-D-219): after a sanction it shares the KFS, the sanction letter, the loan agreement
// and the execution-pack manifest by reference (`DocumentShared`, each with a document JWS), serves
// `GET /v1/documents/{id}` with a 15-minute URL, and takes the LSP's signed `ESignCompleted` and
// `EStampCompleted`, verified against `lspKeys`. R1-D-229: its KFS carries `loan_amount_paise` and
// its manifest a `disbursement_clause` in the loan agreement, both the application's amount.
// R1-D-231: every offer carries a `monthly_instalment` (the EMI of amount, tenor and APR) and one
// `penal_charges` entry; a sanctioned `DecisionMade` offer carries `kfs_link`, the id of the KFS
// document the lender shares right after the decision (it fixes the id first). An eligibility offer
// has no `kfs_link`: no KFS exists before an application. In the manifest the loan agreement carries
// `stamp_evidence` (ESTAMP, the pack's stamp State and duty, the agreement's SHA-256) and the KFS
// `not_stampable: true` with a reason.
// R1-D-232 (PR-UDF-061, Udofin's udf_ext v1 list): offers add `monthly_instalment_paise` and the
// penal-charges text, a sanctioned offer a `kfs_url`; an application may name the eligibility
// offer it takes (`offer_ref`, refused `offer_unknown` if the lender never made it) or carry its
// request, whose amount and tenor the lender then uses; status changes and a rejection carry the
// lender's words; the KFS carries its issue time, language, document reference, tenor in days,
// cash flows (net disbursed and a monthly schedule), charges, cooling-off days, exit terms, nodal
// grievance officer and the LSP entry; the sanction letter its document reference; `LoanDisbursed`
// the application id and time. An acceptance naming another KFS version or hash, or another
// application, is refused (`kfs_mismatch`, `application_mismatch`). An exit request inside the
// cooling-off period is answered once with `CoolingOffExitAnswered`: principal plus the APR for the
// days held, a payment instruction in words and the lender's exit reference.
// R1-D-236 (PR-UDF-061 items 12 to 17; PR-047 approved): every envelope's `subject` is the
// aggregate id its spec names (`originationSubject`; a document's id for `DocumentShared`) and its
// `seq` counts per subject from 1; the documents are small real synthetic PDFs (`pdfFixture`) whose
// SHA-256 is over those bytes, the KFS's and the sanction letter's named by `document_ref` and
// `document_version`; each is shared with a v2 document JWS (type, media type, size and
// application bound) and its language, and `GET /v1/documents/{id}` answers those fields too. The
// KFS and the sanction letter are shared after the sanction; the execution pack only after the
// borrower's acceptance: the CF para 9(3) set (agreement, KFS, sanction letter, terms, product
// summary, privacy policy), the agreement's e-stamp certificate, the signed `ExecutionPackIssued`
// (the accepted KFS, enclosures, stamp evidence, not-stampable list, the covenant declared for a
// business purpose) and, for consumers of the interim carrier, the `EXECUTION_PACK_MANIFEST`
// document. `CoolingOffExitAnswered` is signed (v1.6).
import {
  DOCUMENT_EVENTS,
  DOCUMENTS_SCHEMA_VERSION,
  DOCUMENT_URL_MAX_TTL_SECONDS,
  DocumentRetrieval,
  EXECUTION_PACK_MANIFEST_TYPE,
  ExecutionPackIssuedData,
  ExecutionPackManifest,
  ELIGIBILITY_CHECK_BUDGET_MS,
  ELIGIBILITY_LENDER_UNAVAILABLE,
  EcosystemEnvelope,
  EligibilityCheckAnswer,
  EligibilityCheckRequest,
  ORIGINATION_EVENTS,
  ORIGINATION_SCHEMA_VERSION,
  STAMP_EVIDENCE_MODE_OF,
  originationIdempotencyKey,
  originationSubject,
  type OriginationEventName,
} from "@infrabyx/contracts/events";
import {
  MemoryReplayStore,
  RegulatedKeyRing,
  canonicalize,
  localRegulatedSigner,
  randomBytes,
  sha256Hex,
  signDocumentJwsV2,
  signRegulatedMessage,
  verifyRegulatedMessage,
} from "@infrabyx/crypto";
import { pdfFixture } from "./ports/pdf-text.js";

/** A small real synthetic PDF (R1-D-236, PR-UDF-061 item 14): a title page and a body page. */
const pdfOf = (title: string, lines: readonly string[]): Uint8Array =>
  pdfFixture([`${title}\nSynthetic test document, not a real loan record`, lines.join("\n")]);

const rupees = (paise: number): string => `INR ${(paise / 100).toFixed(2)}`;

/**
 * The equated monthly instalment of `amountPaise` over `tenorMonths` at `aprBp` (R1-D-231), in
 * integer paise: `P·r·(1+r)^n / ((1+r)^n − 1)` with `r` the monthly rate, rounded; `P / n` at 0 %.
 * A plausible figure for tests, not a lender's schedule (the APR is used as the interest rate).
 */
function fakeEmiPaise(amountPaise: number, tenorMonths: number, aprBp: number): number {
  const r = aprBp / 10_000 / 12;
  if (r === 0) return Math.max(1, Math.round(amountPaise / tenorMonths));
  const f = (1 + r) ** tenorMonths;
  return Math.max(1, Math.round((amountPaise * r * f) / (f - 1)));
}

/** The fake's lender-text penal charges (R1-D-232), the words behind its `penal_charges` entry. */
const PENAL_TEXT =
  "A penal charge of 2% a month on the overdue instalment from its due date until paid; a charge, not penal interest, and never added to the principal.";

/** The fake's offer fields of R1-D-231 and R1-D-232, without `kfs_link` and `kfs_url`. */
const offerTerms = (amountPaise: number, tenorMonths: number, aprBp: number) => ({
  monthly_instalment: {
    amount_paise: fakeEmiPaise(amountPaise, tenorMonths, aprBp),
    frequency: "MONTHLY",
  },
  monthly_instalment_paise: fakeEmiPaise(amountPaise, tenorMonths, aprBp),
  penal_charges_text: PENAL_TEXT,
  penal_charges: [
    {
      basis: "PER_MONTH_ON_OVERDUE",
      rate_bp: 200,
      description:
        "2% a month on the overdue instalment; a penal charge, not penal interest, never capitalised",
    },
  ],
});

/** The fake's words for each application state (R1-D-232 `status_text`). */
const STATUS_TEXT: Record<string, string> = {
  UNDER_REVIEW: "Your application is with our credit team.",
  INFO_REQUESTED: "We need one more document to continue.",
  SANCTIONED: "Your loan is sanctioned. Read the Key Facts Statement before you accept.",
  REJECTED: "We cannot offer you a loan at this time.",
  ACCEPTED: "You accepted the offer. We will disburse the loan shortly.",
  DISBURSED: "Your loan is disbursed.",
};

/** The same calendar day `months` months after `d` (UTC), clamped to the month's last day. */
function addMonths(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last)));
}

const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function uuidv7(ms: number): string {
  const b = randomBytes(16);
  const t = BigInt(ms);
  for (let i = 0; i < 6; i++) b[i] = Number((t >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** One message the lender sent: the Ecosystem envelope, and its detached JWS when regulated. */
export interface LenderMessage {
  name: OriginationEventName;
  event: EcosystemEnvelope;
  /** The detached compact JWS (`X-Infrabyx-JWS`), present on regulated messages only. */
  jws?: string;
}

/** One document the lender shared (`DocumentShared`, §6.13). Its bytes come through `getDocument`. */
export interface DocumentMessage {
  event: EcosystemEnvelope;
}

export interface FakeLenderScript {
  /** The decision on the next application (default `SANCTIONED`). */
  decision?: "SANCTIONED" | "REJECTED";
  /** Ask for more information before deciding (default false). */
  infoRequest?: boolean;
  /** How long the next eligibility check takes, in ms (default 50); over the budget it is unavailable. */
  latencyMs?: number;
  /** The eligibility outcome (default `ELIGIBLE`). */
  outcome?: "ELIGIBLE" | "NOT_ELIGIBLE" | "REFER";
}

export interface FakeLenderOptions {
  /** The RE's tenant at the lender (`tenantid`, `urn:infrabyx:finbyx:<tenant>`). */
  tenantId?: string;
  /** The RE id (`reid`). */
  reId?: string;
  /** The signing key id (default `fake-lender-1`). */
  kid?: string;
  /** The clock (default the system clock). */
  now?: () => Date;
  /** KFS validity in ms (default three days, RBC para 29(2)'s floor for most loans). */
  kfsValidityMs?: number;
  /** Cooling-off after disbursal in ms (default three days). */
  coolingOffMs?: number;
  /**
   * The LSP's public keys, to verify its regulated messages (`ESignCompleted`, `EStampCompleted`).
   * Without them every such message is refused `signature-invalid`, as the real lender would.
   */
  lspKeys?: RegulatedKeyRing;
}

/** A refusal with a fixed reason label, as the real lender answers it. */
export class LenderRefusal extends Error {
  constructor(readonly reason: string) {
    super(`lender refused: ${reason}`);
    this.name = "LenderRefusal";
  }
}

interface Application {
  applicationId: string;
  lspRef: string;
  seq: number;
  state: string;
  kfs?: { kfsId: string; validityExpiry: Date; version: number; sha256: string };
  loanId?: string;
  coolingOffEnd?: Date;
  disbursedAt?: Date;
  exitRef?: string;
  amountPaise: number;
  tenorMonths: number;
  aprBp: number;
  /** R1-D-236: the request's purpose is a business one (`BUSINESS…`): the WD covenant applies. */
  businessPurpose: boolean;
  /** R1-D-236: set at the sanction, used for the pack after the acceptance. */
  sanction?: { sanctionId: string; kfsDocumentId: string; sanctionDocumentId: string };
  pack?: ExecutionPackManifest;
  issued?: ExecutionPackIssuedData;
}

interface StoredDocument {
  documentId: string;
  version: number;
  sha256: string;
  jws: string;
  bytes: Uint8Array;
  type: string;
  mediaType: string;
  applicationId: string;
}

export class FakeLender {
  private readonly signer;
  /** The lender's public keys, as an LSP's verifier holds them. */
  readonly keys: RegulatedKeyRing;
  private readonly sent: LenderMessage[] = [];
  private readonly checks = new Map<string, { body: string; answer: EligibilityCheckAnswer }>();
  private readonly offers = new Map<
    string,
    { amountPaise: number; tenorMonths: number; aprBp: number }
  >();
  private readonly applications = new Map<string, Application>();
  private readonly byKfs = new Map<string, Application>();
  private readonly byLoan = new Map<string, Application>();
  private readonly shared: DocumentMessage[] = [];
  private readonly docs = new Map<string, StoredDocument>();
  private readonly urls = new Map<string, { documentId: string; expires: number }>();
  private readonly evidence = new Set<string>();
  private readonly lspReplay = new MemoryReplayStore();
  private next: FakeLenderScript = {};
  /** R1-D-236: the last `seq` sent per envelope subject (§3.2 "per-subject sequence"). */
  private readonly seqs = new Map<string, number>();
  private n = 0;
  private readonly now: () => Date;

  constructor(private readonly o: FakeLenderOptions = {}) {
    this.signer = localRegulatedSigner(o.kid ?? "fake-lender-1");
    this.keys = new RegulatedKeyRing([{ kid: this.signer.kid, key: this.signer.publicKey }]);
    this.now = o.now ?? (() => new Date());
  }

  /** What the next calls do (test hook). */
  script(s: FakeLenderScript): void {
    this.next = { ...this.next, ...s };
  }

  /** Every message the lender has sent, oldest first (test hook). */
  outbox(): readonly LenderMessage[] {
    return this.sent;
  }

  /** Every `DocumentShared` the lender has sent, oldest first (test hook; not in `outbox`). */
  sharedDocuments(): readonly DocumentMessage[] {
    return this.shared;
  }

  /**
   * The interim execution-pack manifest of an accepted application (PR-UDF-053), as shared in its
   * `EXECUTION_PACK_MANIFEST` document; refused `pack_unknown` before the borrower's acceptance
   * (R1-D-236). The signed `ExecutionPackIssued` in `outbox()` carries the full pack.
   */
  executionPack(applicationId: string): ExecutionPackManifest {
    const app = [...this.applications.values()].find((a) => a.applicationId === applicationId);
    if (!app?.pack) throw new LenderRefusal("pack_unknown");
    return app.pack;
  }

  /**
   * `GET /v1/documents/{id}` (§6.13): the document's hash and JWS and an `https` URL valid
   * 15 minutes, hosted in India. Fetch the bytes with `fetchDocument(url)`.
   */
  async getDocument(documentId: string): Promise<DocumentRetrieval> {
    const d = this.docs.get(documentId);
    if (!d) throw new LenderRefusal("document_unknown");
    const issued = this.now();
    const expires = issued.getTime() + DOCUMENT_URL_MAX_TTL_SECONDS * 1000;
    const token = hex(randomBytes(16));
    this.urls.set(token, { documentId, expires });
    return DocumentRetrieval.parse({
      document_id: d.documentId,
      version: d.version,
      sha256: d.sha256,
      jws: d.jws,
      url: `https://documents.fake-lender.in/v1/blobs/${token}`,
      issued_at: issued.toISOString(),
      url_expires_at: new Date(expires).toISOString(),
      data_residency: "IN",
      // R1-D-236: the fields the v2 document JWS binds, so the answer verifies on its own.
      media_type: d.mediaType,
      size_bytes: d.bytes.byteLength,
      type: d.type,
      application_id: d.applicationId,
    });
  }

  /** The bytes behind a retrieval URL; refused `url_expired` after 15 minutes, `url_invalid` if unknown. */
  async fetchDocument(url: string): Promise<Uint8Array> {
    const m = /^https:\/\/documents\.fake-lender\.in\/v1\/blobs\/([0-9a-f]{32})$/.exec(url);
    const u = m ? this.urls.get(m[1]!) : undefined;
    if (!u) throw new LenderRefusal("url_invalid");
    if (this.now().getTime() > u.expires) throw new LenderRefusal("url_expired");
    return new Uint8Array(this.docs.get(u.documentId)!.bytes);
  }

  /** Takes the LSP's signed `ESignCompleted` (§6.2) for a document the lender shared. */
  async eSignCompleted(event: unknown, jws?: string): Promise<void> {
    await this.takeEvidence("ESignCompleted", event, jws);
  }

  /** Takes the LSP's signed `EStampCompleted` (§6.2) for a document the lender shared. */
  async eStampCompleted(event: unknown, jws?: string): Promise<void> {
    await this.takeEvidence("EStampCompleted", event, jws);
  }

  private async takeEvidence(
    name: "ESignCompleted" | "EStampCompleted",
    raw: unknown,
    jws: string | undefined,
  ): Promise<void> {
    const e = this.take(name, raw);
    if (!jws || !this.o.lspKeys) throw new LenderRefusal("signature-invalid");
    const v = await verifyRegulatedMessage(e as unknown as Record<string, unknown>, jws, {
      keys: this.o.lspKeys,
      replay: this.lspReplay,
      now: this.now(),
    });
    if (!v.ok) throw new LenderRefusal("signature-invalid");
    if (!this.docs.has(String(e.data.document_id))) throw new LenderRefusal("document_unknown");
    this.evidence.add(`${name}:${originationIdempotencyKey(name, e.data)}`);
  }

  /** True once the lender has taken this evidence (test hook). */
  hasEvidence(name: "ESignCompleted" | "EStampCompleted", data: Record<string, unknown>): boolean {
    return this.evidence.has(`${name}:${originationIdempotencyKey(name, data)}`);
  }

  private id(prefix: string): string {
    return `${prefix}_${sha256Hex(`${prefix}:${++this.n}:${hex(randomBytes(8))}`).slice(0, 24)}`;
  }

  /**
   * `POST /v1/eligibility-checks` (§6.2). The same key and body answer the same result; another
   * body under the same key is refused `idempotency_conflict`. Over the 3 s budget the answer is
   * `lender_unavailable`, as the caller's timeout would read it.
   */
  async eligibilityCheck(
    raw: unknown,
    call: { idempotencyKey: string },
  ): Promise<EligibilityCheckAnswer | { outcome: typeof ELIGIBILITY_LENDER_UNAVAILABLE }> {
    if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(call.idempotencyKey ?? ""))
      throw new LenderRefusal("idempotency_key_required");
    const req = EligibilityCheckRequest.parse(raw);
    const body = canonicalize(req);
    const seen = this.checks.get(call.idempotencyKey);
    if (seen) {
      if (seen.body !== body) throw new LenderRefusal("idempotency_conflict");
      return seen.answer;
    }
    if ((this.next.latencyMs ?? 50) > ELIGIBILITY_CHECK_BUDGET_MS)
      return { outcome: ELIGIBILITY_LENDER_UNAVAILABLE };
    const outcome = this.next.outcome ?? "ELIGIBLE";
    const answer = EligibilityCheckAnswer.parse({
      check_id: this.id("elc"),
      outcome,
      offers:
        outcome === "ELIGIBLE"
          ? [
              {
                offer_id: this.id("ofr"),
                amount_paise: req.amount_paise,
                tenor_months: req.tenor_months,
                apr_bp: 1800,
                ...offerTerms(req.amount_paise, req.tenor_months, 1800),
              },
            ]
          : [],
      reason_codes: outcome === "ELIGIBLE" ? [] : ["POLICY_" + outcome],
      rule_version: "fake-bre-1",
      valid_until: new Date(this.now().getTime() + 86_400_000).toISOString(),
    });
    this.checks.set(call.idempotencyKey, { body, answer });
    for (const x of answer.offers)
      this.offers.set(x.offer_id, {
        amountPaise: x.amount_paise,
        tenorMonths: x.tenor_months,
        aprBp: x.apr_bp,
      });
    return answer;
  }

  /** Takes `ApplicationSubmitted`; the lender reviews, decides and, if sanctioned, issues the KFS and sanction letter. */
  async submitApplication(event: unknown): Promise<{ applicationId: string }> {
    const e = this.take("ApplicationSubmitted", event);
    const ref = String(e.data.lsp_application_ref);
    const known = this.applications.get(ref);
    if (known) return { applicationId: known.applicationId };
    // R1-D-232: the offer the borrower chose, which the lender must have made, or the request.
    const offerRef = e.data.offer_ref as string | undefined;
    const chosen = offerRef === undefined ? undefined : this.offers.get(offerRef);
    if (offerRef !== undefined && !chosen) throw new LenderRefusal("offer_unknown");
    const request = e.data.request as
      { amount_paise: number; tenor_days: number; purpose: string } | undefined;
    const app: Application = {
      applicationId: this.id("app"),
      lspRef: ref,
      seq: 0,
      state: "SUBMITTED",
      amountPaise: chosen?.amountPaise ?? request?.amount_paise ?? 5_000_000,
      tenorMonths:
        chosen?.tenorMonths ??
        (request ? Math.min(600, Math.max(1, Math.round(request.tenor_days / 30))) : 12),
      aprBp: chosen?.aprBp ?? 1800,
      businessPurpose: /^BUSINESS/.test(request?.purpose ?? ""),
    };
    this.applications.set(ref, app);
    await this.move(app, "UNDER_REVIEW");
    if (this.next.infoRequest) {
      await this.move(app, "INFO_REQUESTED");
      await this.emit("AdditionalInfoRequested", {
        request_id: this.id("air"),
        application_id: app.applicationId,
        items: [{ item_code: "BANK_STATEMENT" }],
        due_date: new Date(this.now().getTime() + 7 * 86_400_000).toISOString().slice(0, 10),
      });
      await this.move(app, "UNDER_REVIEW");
    }
    const decision = this.next.decision ?? "SANCTIONED";
    // R1-D-231: the KFS and its document id are fixed before the decision, so the offer can link it.
    const kfsId = decision === "SANCTIONED" ? this.id("kfs") : "";
    const kfsDocumentId = decision === "SANCTIONED" ? this.id("doc") : "";
    const sanctionDocumentId = decision === "SANCTIONED" ? this.id("doc") : "";
    await this.emit("DecisionMade", {
      application_id: app.applicationId,
      decision_version: 1,
      decision,
      reason_codes: decision === "SANCTIONED" ? [] : ["POLICY_DECLINE"],
      ...(decision === "SANCTIONED"
        ? {}
        : {
            reason_texts: [
              {
                reason_code: "POLICY_DECLINE",
                text: "The application falls outside our lending policy for this product.",
              },
            ],
          }),
      rule_version: "fake-bre-1",
      offers:
        decision === "SANCTIONED"
          ? [
              {
                offer_id: this.id("ofr"),
                amount_paise: app.amountPaise,
                tenor_months: app.tenorMonths,
                apr_bp: app.aprBp,
                ...offerTerms(app.amountPaise, app.tenorMonths, app.aprBp),
                kfs_link: { document_id: kfsDocumentId, version: 1 },
                kfs_url: `https://documents.fake-lender.in/v1/kfs/${kfsDocumentId}`,
              },
            ]
          : [],
    });
    await this.move(app, decision);
    if (decision === "SANCTIONED") {
      const validityExpiry = new Date(
        this.now().getTime() + (this.o.kfsValidityMs ?? 3 * 86_400_000),
      );
      // R1-D-236 (item 14): the hashes are over the real synthetic PDFs the lender shares.
      const terms = [
        `Application ${app.applicationId}`,
        `Loan amount ${rupees(app.amountPaise)}`,
        `Tenor ${app.tenorMonths} months`,
        `Annual percentage rate ${(app.aprBp / 100).toFixed(2)}%`,
      ];
      const kfsPdf = pdfOf(`Key Facts Statement ${kfsId} version 1`, terms);
      const sanctionId = this.id("snc");
      const sanctionPdf = pdfOf(`Sanction letter ${sanctionId} version 1`, terms);
      const kfsSha256 = sha256Hex(kfsPdf);
      app.kfs = { kfsId, validityExpiry, version: 1, sha256: kfsSha256 };
      app.sanction = { sanctionId, kfsDocumentId, sanctionDocumentId };
      this.byKfs.set(kfsId, app);
      await this.emit("KFSIssued", {
        kfs_id: kfsId,
        version: 1,
        application_id: app.applicationId,
        proposal_no: this.id("prp"),
        validity_expiry: validityExpiry.toISOString(),
        apr_bp: app.aprBp,
        document_sha256: kfsSha256,
        // R1-D-229: the KFS "Loan amount" (Annex A Part 1); the fake deducts nothing upfront.
        loan_amount_paise: app.amountPaise,
        ...this.kfsDetail(app, kfsDocumentId),
        // R1-D-236 (item 16): the file's version beside its document_ref.
        document_version: 1,
      });
      await this.emit("SanctionLetterIssued", {
        sanction_id: sanctionId,
        version: 1,
        application_id: app.applicationId,
        terms: { amount_paise: app.amountPaise, tenor_months: app.tenorMonths, apr_bp: app.aprBp },
        document_sha256: sha256Hex(sanctionPdf),
        document_ref: sanctionDocumentId,
        document_version: 1,
      });
      // The KFS and the sanction letter go before the acceptance; the pack after it (item 17).
      await this.share(app, "KFS", kfsPdf, "application/pdf", kfsDocumentId);
      await this.share(app, "SANCTION_LETTER", sanctionPdf, "application/pdf", sanctionDocumentId);
    }
    return { applicationId: app.applicationId };
  }

  /** The KFS's optional detail of R1-D-232: a plausible test KFS, not a lender's figures. */
  private kfsDetail(app: Application, kfsDocumentId: string): Record<string, unknown> {
    const now = this.now();
    const emi = fakeEmiPaise(app.amountPaise, app.tenorMonths, app.aprBp);
    const instalments = Array.from({ length: app.tenorMonths }, (_, i) => ({
      seq: i + 1,
      due_date: addMonths(now, i + 1)
        .toISOString()
        .slice(0, 10),
      amount_paise: emi,
    }));
    const last = Date.parse(instalments.at(-1)!.due_date);
    const coolingOffDays = Math.round((this.o.coolingOffMs ?? 3 * 86_400_000) / 86_400_000);
    return {
      issued_at: now.toISOString(),
      language: "en",
      document_ref: kfsDocumentId,
      tenor_days: Math.max(1, Math.ceil((last - now.getTime()) / 86_400_000)),
      cash_flows: { net_disbursed_paise: app.amountPaise, instalments },
      charges: [
        {
          code: "STAMP_DUTY",
          description: "Stamp duty on the loan agreement, at actuals, paid by the borrower",
          amount_paise: 50_000,
          payable_to: "THIRD_PARTY",
          recurrence: "ONE_TIME",
        },
      ],
      cooling_off_days: coolingOffDays,
      exit_terms: `You may exit within ${coolingOffDays} days of disbursal by repaying the principal and the APR for the days you held the loan, with no other charge.`,
      nodal_gro: {
        name: "Nodal Grievance Redressal Officer",
        designation: "Nodal Officer, test lender",
        phone: "+91 22 0000 0000",
        email: "gro@fake-lender.in",
      },
      lsp_recovery_agent: [
        { role: "LSP", name: "Test LSP", functions: "Sourcing, KYC and borrower communication" },
      ],
    };
  }

  /**
   * Takes `BorrowerAccepted`; refused `kfs_expired` after the KFS's validity (§6.2), and
   * `kfs_mismatch` or `application_mismatch` when it names another KFS version, hash or application.
   */
  async accept(event: unknown): Promise<void> {
    const e = this.take("BorrowerAccepted", event);
    const app = this.byKfs.get(String(e.data.kfs_id));
    if (!app?.kfs) throw new LenderRefusal("kfs_unknown");
    if (
      (e.data.kfs_version !== undefined && e.data.kfs_version !== app.kfs.version) ||
      (e.data.kfs_sha256 !== undefined && e.data.kfs_sha256 !== app.kfs.sha256)
    )
      throw new LenderRefusal("kfs_mismatch");
    if (e.data.lsp_application_ref !== undefined && e.data.lsp_application_ref !== app.lspRef)
      throw new LenderRefusal("application_mismatch");
    if (app.state === "ACCEPTED") return;
    if (
      Date.parse(String(e.data.accepted_at)) > app.kfs.validityExpiry.getTime() ||
      this.now().getTime() > app.kfs.validityExpiry.getTime()
    )
      throw new LenderRefusal("kfs_expired");
    await this.move(app, "ACCEPTED");
    // R1-D-236 (item 17): the execution pack follows the borrower's acceptance.
    await this.issueExecutionPack(app);
  }

  /** Disburses an accepted application: `LoanDisbursed` with the cooling-off end (§6.3). */
  async disburse(applicationId: string): Promise<{ loanId: string; utr: string }> {
    const app = [...this.applications.values()].find((a) => a.applicationId === applicationId);
    if (!app || app.state !== "ACCEPTED") throw new LenderRefusal("not_accepted");
    const loanId = this.id("ln");
    const utr = `FAKE${hex(randomBytes(6)).toUpperCase()}`;
    const coolingOffEnd = new Date(this.now().getTime() + (this.o.coolingOffMs ?? 3 * 86_400_000));
    const disbursedAt = this.now();
    app.loanId = loanId;
    app.coolingOffEnd = coolingOffEnd;
    app.disbursedAt = disbursedAt;
    this.byLoan.set(loanId, app);
    await this.emit("LoanDisbursed", {
      loan_id: loanId,
      utr,
      amount_paise: app.amountPaise,
      value_date: disbursedAt.toISOString().slice(0, 10),
      beneficiary_type: "BORROWER",
      kind: "INITIAL",
      cooling_off_end: coolingOffEnd.toISOString(),
      application_id: app.applicationId,
      disbursed_at: disbursedAt.toISOString(),
    });
    await this.move(app, "DISBURSED");
    return { loanId, utr };
  }

  /**
   * Takes `CoolingOffExitRequested`; refused `cooling_off_ended` after its end (CF para 11) and
   * `application_mismatch` when it names another application. The first request inside the period
   * is answered with `CoolingOffExitAnswered` (R1-D-232); a repeat is taken without a second answer.
   */
  async coolingOffExit(event: unknown): Promise<void> {
    const e = this.take("CoolingOffExitRequested", event);
    const app = this.byLoan.get(String(e.data.loan_id));
    if (!app?.coolingOffEnd || !app.disbursedAt) throw new LenderRefusal("loan_unknown");
    if (e.data.lsp_application_ref !== undefined && e.data.lsp_application_ref !== app.lspRef)
      throw new LenderRefusal("application_mismatch");
    const requested = Date.parse(String(e.data.requested_at));
    if (requested > app.coolingOffEnd.getTime()) throw new LenderRefusal("cooling_off_ended");
    if (app.exitRef) return;
    // Principal plus the APR for the days held (CF para 11), at least one day.
    const days = Math.max(1, Math.ceil((requested - app.disbursedAt.getTime()) / 86_400_000));
    const interest = Math.round((app.amountPaise * app.aprBp * days) / (10_000 * 365));
    app.exitRef = this.id("ext");
    await this.emit("CoolingOffExitAnswered", {
      loan_id: app.loanId,
      exit_ref: app.exitRef,
      exit_amount_paise: app.amountPaise + interest,
      payment_instruction: `Pay the exit amount by NEFT or UPI to your loan account with the lender, quoting ${app.exitRef}. Do not pay anyone else.`,
      answered_at: this.now().toISOString(),
      lsp_application_ref: app.lspRef,
    });
  }

  /**
   * After the acceptance (R1-D-236, item 17): shares the rest of the CF para 9(3) set (the loan
   * agreement, the terms and conditions, the product summary, the privacy policy) and the
   * agreement's e-stamp certificate, emits the signed `ExecutionPackIssued` listing the whole set
   * with the KFS and the sanction letter shared at the sanction, and shares the interim manifest.
   */
  private async issueExecutionPack(app: Application): Promise<void> {
    if (!app.kfs || !app.sanction || app.issued) return;
    const { sanctionId, kfsDocumentId, sanctionDocumentId } = app.sanction;
    const pdf = "application/pdf";
    const agreement = await this.share(
      app,
      "LOAN_AGREEMENT",
      pdfOf(`Loan agreement for ${app.applicationId}`, [
        `Clause 1.2: the Key Facts Statement ${app.kfs.kfsId} is Annex A`,
        `Clause 1.3: the sanction letter ${sanctionId} is Annex B`,
        "Clause 1.4: the terms and conditions are Annex C",
        `Clause 4.2: the lender disburses ${rupees(app.amountPaise)}`,
        ...(app.businessPurpose
          ? ["Clause 9.1: the borrower will not induct a wilful defaulter into its management"]
          : []),
      ]),
      pdf,
    );
    const tnc = await this.share(
      app,
      "TERMS_AND_CONDITIONS",
      pdfOf("Terms and conditions", [`For application ${app.applicationId}`]),
      pdf,
    );
    const summary = await this.share(
      app,
      "PRODUCT_SUMMARY",
      pdfOf("Product summary", ["A personal loan of the test lender"]),
      pdf,
    );
    const privacy = await this.share(
      app,
      "PRIVACY_POLICY",
      pdfOf("Privacy policy", ["How the test lender and its LSP use the borrower's data"]),
      pdf,
    );
    const stamp = {
      state: "IN-MH",
      article: "5(h)",
      duty_paise: 50_000,
      mode: "E_STAMP",
      payer: "BORROWER",
    } as const;
    const certificateNo = `${stamp.state}-FAKE-${agreement.documentId.slice(-12).toUpperCase()}`;
    const certificate = await this.share(
      app,
      "ESTAMP_CERTIFICATE",
      pdfOf(`e-Stamp certificate ${certificateNo}`, [
        `Duty ${rupees(stamp.duty_paise)} under article ${stamp.article}`,
      ]),
      pdf,
    );
    const docRow = (
      d: StoredDocument,
      kind: string,
      over: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      document_id: d.documentId,
      version: d.version,
      kind,
      sha256: d.sha256,
      execution_mode: "NONE",
      stamp_required: false,
      signers: [],
      ...over,
    });
    const kfsDoc = this.docs.get(kfsDocumentId)!;
    const sanctionDoc = this.docs.get(sanctionDocumentId)!;
    const reason = "A disclosure or notice, not an instrument chargeable with duty";
    const issued = ExecutionPackIssuedData.parse({
      pack_id: this.id("pack"),
      version: 1,
      application_id: app.applicationId,
      kfs_id: app.kfs.kfsId,
      kfs_version: app.kfs.version,
      kfs_sha256: app.kfs.sha256,
      sanction_id: sanctionId,
      documents: [
        docRow(agreement, "LOAN_AGREEMENT", {
          execution_mode: "ESIGN_AADHAAR",
          stamp_required: true,
          signers: ["BORROWER", "LENDER"],
          instrument_code: "LOAN_AGREEMENT",
          stamp_evidence: {
            channel: stamp.mode,
            certificate_no: certificateNo,
            state: stamp.state,
            duty_paise: stamp.duty_paise,
            stated_duty_paise: stamp.duty_paise,
            stamped_document_sha256: agreement.sha256,
            issued_at: this.now().toISOString(),
            vendor_certificate_id: "stv_fake_vendor",
            certificate_document_id: certificate.documentId,
          },
        }),
        docRow(kfsDoc, "KFS", { enclosure_code: "ANNEX_A" }),
        docRow(sanctionDoc, "SANCTION_LETTER", { enclosure_code: "ANNEX_B" }),
        docRow(tnc, "TERMS_AND_CONDITIONS", { enclosure_code: "ANNEX_C" }),
        docRow(summary, "PRODUCT_SUMMARY"),
        docRow(privacy, "PRIVACY_POLICY"),
      ],
      stamp,
      summary_box: { document_id: agreement.documentId, page: 2 },
      covenant: { business_purpose: app.businessPurpose, declared: app.businessPurpose },
      ...(app.businessPurpose
        ? { covenant_declaration: { document_id: agreement.documentId, sha256: agreement.sha256 } }
        : {}),
      enclosure_list: [
        { code: "ANNEX_A", clause_ref: "cl.1.2" },
        { code: "ANNEX_B", clause_ref: "cl.1.3" },
        { code: "ANNEX_C", clause_ref: "cl.1.4" },
      ],
      not_stampable: [kfsDoc, sanctionDoc, summary, privacy].map((d) => ({
        document_id: d.documentId,
        reason,
      })),
      countersignature: { required: true, by: "LENDER", order: "AFTER_BORROWER", within_days: 3 },
      // R1-D-229: the loan agreement's clause stating the amount to be disbursed.
      disbursement_clause: {
        document_id: agreement.documentId,
        page_or_clause_ref: "cl.4.2",
        amount_stated_paise: app.amountPaise,
      },
    });
    app.issued = issued;
    await this.emit("ExecutionPackIssued", issued as unknown as Record<string, unknown>);
    // The interim carrier (PR-UDF-053), unchanged in shape, for consumers that still read it.
    const pack = ExecutionPackManifest.parse(manifestOf(issued, agreement));
    app.pack = pack;
    await this.share(
      app,
      EXECUTION_PACK_MANIFEST_TYPE,
      new TextEncoder().encode(canonicalize(pack)),
      "application/json",
    );
  }

  private async share(
    app: Application,
    type: string,
    bytes: Uint8Array,
    mediaType: string,
    documentId = this.id("doc"),
  ): Promise<StoredDocument> {
    const sha256 = sha256Hex(bytes);
    // R1-D-236 (item 13): the v2 descriptor binds the type, media type, size and application.
    const jws = await signDocumentJwsV2({
      descriptor: {
        document_id: documentId,
        version: 1,
        sha256,
        type,
        media_type: mediaType,
        size_bytes: bytes.byteLength,
        application_id: app.applicationId,
      },
      kid: this.signer.kid,
      sign: this.signer.sign,
    });
    const d: StoredDocument = {
      documentId,
      version: 1,
      sha256,
      jws,
      bytes,
      type,
      mediaType,
      applicationId: app.applicationId,
    };
    this.docs.set(documentId, d);
    const spec = DOCUMENT_EVENTS.DocumentShared;
    const data = spec.schema.parse({
      document_id: documentId,
      version: 1,
      type,
      sha256,
      jws,
      retention_class: "LOAN_RECORD",
      legal_hold: false,
      media_type: mediaType,
      size_bytes: bytes.byteLength,
      application_id: app.applicationId,
      language: "en",
    });
    this.shared.push({
      event: this.envelope(spec.type, documentId, DOCUMENTS_SCHEMA_VERSION, data),
    });
    return d;
  }

  /** Validates an incoming message: its envelope, its type and its data. */
  private take(name: OriginationEventName, raw: unknown): EcosystemEnvelope {
    const spec = ORIGINATION_EVENTS[name];
    if (spec.direction !== "LSP_TO_LENDER") throw new Error(`${name} is not sent to the lender`);
    const e = EcosystemEnvelope.parse(raw);
    if (e.type !== spec.type) throw new LenderRefusal("wrong_type");
    spec.schema.parse(e.data);
    return e;
  }

  private async move(app: Application, to: string): Promise<void> {
    const from = app.state;
    app.state = to;
    app.seq += 1;
    const statusText = STATUS_TEXT[to];
    await this.emit("ApplicationStatusChanged", {
      application_id: app.applicationId,
      seq: app.seq,
      from,
      to,
      ...(statusText ? { status_text: statusText } : {}),
    });
  }

  private async emit(name: OriginationEventName, data: Record<string, unknown>): Promise<void> {
    const spec = ORIGINATION_EVENTS[name];
    spec.schema.parse(data);
    const now = this.now();
    const event = this.envelope(
      spec.type,
      originationSubject(name, data),
      ORIGINATION_SCHEMA_VERSION,
      data,
    );
    const msg: LenderMessage = { name, event };
    if (spec.regulated)
      msg.jws = await signRegulatedMessage({
        event: event as unknown as Record<string, unknown>,
        kid: this.signer.kid,
        sign: this.signer.sign,
        now,
      });
    this.sent.push(msg);
  }

  private envelope(
    type: string,
    subject: string,
    schemaver: string,
    data: Record<string, unknown>,
  ): EcosystemEnvelope {
    const now = this.now();
    const tenant = this.o.tenantId ?? "tnt_fake_re";
    // R1-D-236 (item 15): `subject` is the aggregate id, `seq` counts per subject from 1.
    const seq = (this.seqs.get(subject) ?? 0) + 1;
    this.seqs.set(subject, seq);
    return EcosystemEnvelope.parse({
      specversion: "1.0",
      id: uuidv7(now.getTime()),
      source: `urn:infrabyx:finbyx:${tenant}`,
      type,
      subject,
      time: now.toISOString(),
      datacontenttype: "application/json",
      dataschema: `https://registry.infrabyx.example/schemas/${type}/${schemaver}.json`,
      tenantid: tenant,
      reid: this.o.reId ?? "re_fake",
      productfamily: "lending",
      legalbasis: "CONTRACT_PERFORMANCE_RE",
      dataclass: "FINANCIAL",
      schemaver,
      seq,
      environment: "test",
      data,
    });
  }
}

/** The interim manifest (PR-UDF-053's shape, unchanged) of an issued pack (R1-D-236). */
function manifestOf(p: ExecutionPackIssuedData, agreement: StoredDocument): unknown {
  const reasons = new Map((p.not_stampable ?? []).map((n) => [n.document_id, n.reason]));
  return {
    pack_id: p.pack_id,
    version: p.version,
    application_id: p.application_id,
    kfs_id: p.kfs_id,
    sanction_id: p.sanction_id,
    documents: p.documents.map((d) => ({
      document_id: d.document_id,
      version: d.version,
      kind: d.kind,
      sha256: d.sha256,
      execution_mode: d.execution_mode,
      stamp_required: d.stamp_required,
      signers: d.signers,
      ...(d.stamp_evidence
        ? {
            stamp_evidence: {
              mode: STAMP_EVIDENCE_MODE_OF[d.stamp_evidence.channel],
              state: d.stamp_evidence.state,
              certificate_number: d.stamp_evidence.certificate_no,
              duty_paise: d.stamp_evidence.duty_paise,
              stamped_document_sha256: d.stamp_evidence.stamped_document_sha256,
              vendor_ref: d.stamp_evidence.vendor_certificate_id,
            },
          }
        : {}),
      ...(reasons.has(d.document_id)
        ? { not_stampable: true, not_stampable_reason: reasons.get(d.document_id) }
        : {}),
    })),
    stamp: p.stamp,
    summary_box: p.summary_box,
    // The interim shape requires a covenant declaration: the agreement, as before R1-D-236.
    covenant_declaration: p.covenant_declaration ?? {
      document_id: agreement.documentId,
      sha256: agreement.sha256,
    },
    countersignature: p.countersignature,
    disbursement_clause: p.disbursement_clause,
  };
}
