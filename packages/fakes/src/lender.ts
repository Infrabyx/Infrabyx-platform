// A contract-faithful mock lender (Udofin PR-UDF-051; R1-D-217): Finbyx's side of the origination
// contract (Ecosystem Specification §6.2) and the two §6.3 items of the loan journey, so an LSP's
// tests run against the same messages, idempotency keys and signatures as the real lender. Every
// message it takes or gives is checked against `@infrabyx/contracts/events` (`ORIGINATION_EVENTS`);
// every regulated one carries a detached JWS made with its own ES256 key, which `keys` holds, so a
// test verifies with `verifyRegulatedMessage` exactly as against the real lender. Test only.
import {
  ELIGIBILITY_CHECK_BUDGET_MS,
  ELIGIBILITY_LENDER_UNAVAILABLE,
  EcosystemEnvelope,
  EligibilityCheckAnswer,
  EligibilityCheckRequest,
  ORIGINATION_EVENTS,
  ORIGINATION_SCHEMA_VERSION,
  originationIdempotencyKey,
  type OriginationEventName,
} from "@infrabyx/contracts/events";
import {
  RegulatedKeyRing,
  canonicalize,
  localRegulatedSigner,
  randomBytes,
  sha256Hex,
  signRegulatedMessage,
} from "@infrabyx/crypto";

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
  seq: number;
  state: string;
  kfs?: { kfsId: string; validityExpiry: Date };
  loanId?: string;
  coolingOffEnd?: Date;
  amountPaise: number;
  tenorMonths: number;
  aprBp: number;
}

export class FakeLender {
  private readonly signer;
  /** The lender's public keys, as an LSP's verifier holds them. */
  readonly keys: RegulatedKeyRing;
  private readonly sent: LenderMessage[] = [];
  private readonly checks = new Map<string, { body: string; answer: EligibilityCheckAnswer }>();
  private readonly applications = new Map<string, Application>();
  private readonly byKfs = new Map<string, Application>();
  private readonly byLoan = new Map<string, Application>();
  private next: FakeLenderScript = {};
  private seq = 0;
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
              },
            ]
          : [],
      reason_codes: outcome === "ELIGIBLE" ? [] : ["POLICY_" + outcome],
      rule_version: "fake-bre-1",
      valid_until: new Date(this.now().getTime() + 86_400_000).toISOString(),
    });
    this.checks.set(call.idempotencyKey, { body, answer });
    return answer;
  }

  /** Takes `ApplicationSubmitted`; the lender reviews, decides and, if sanctioned, issues the KFS and sanction letter. */
  async submitApplication(event: unknown): Promise<{ applicationId: string }> {
    const e = this.take("ApplicationSubmitted", event);
    const ref = String(e.data.lsp_application_ref);
    const known = this.applications.get(ref);
    if (known) return { applicationId: known.applicationId };
    const app: Application = {
      applicationId: this.id("app"),
      seq: 0,
      state: "SUBMITTED",
      amountPaise: 5_000_000,
      tenorMonths: 12,
      aprBp: 1800,
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
    await this.emit("DecisionMade", {
      application_id: app.applicationId,
      decision_version: 1,
      decision,
      reason_codes: decision === "SANCTIONED" ? [] : ["POLICY_DECLINE"],
      rule_version: "fake-bre-1",
      offers:
        decision === "SANCTIONED"
          ? [
              {
                offer_id: this.id("ofr"),
                amount_paise: app.amountPaise,
                tenor_months: app.tenorMonths,
                apr_bp: app.aprBp,
              },
            ]
          : [],
    });
    await this.move(app, decision);
    if (decision === "SANCTIONED") {
      const kfsId = this.id("kfs");
      const validityExpiry = new Date(
        this.now().getTime() + (this.o.kfsValidityMs ?? 3 * 86_400_000),
      );
      app.kfs = { kfsId, validityExpiry };
      this.byKfs.set(kfsId, app);
      await this.emit("KFSIssued", {
        kfs_id: kfsId,
        version: 1,
        application_id: app.applicationId,
        proposal_no: this.id("prp"),
        validity_expiry: validityExpiry.toISOString(),
        apr_bp: app.aprBp,
        document_sha256: sha256Hex(`kfs:${kfsId}`),
      });
      await this.emit("SanctionLetterIssued", {
        sanction_id: this.id("snc"),
        version: 1,
        application_id: app.applicationId,
        terms: { amount_paise: app.amountPaise, tenor_months: app.tenorMonths, apr_bp: app.aprBp },
        document_sha256: sha256Hex(`sanction:${app.applicationId}`),
      });
    }
    return { applicationId: app.applicationId };
  }

  /** Takes `BorrowerAccepted`; refused `kfs_expired` after the KFS's validity (§6.2). */
  async accept(event: unknown): Promise<void> {
    const e = this.take("BorrowerAccepted", event);
    const app = this.byKfs.get(String(e.data.kfs_id));
    if (!app?.kfs) throw new LenderRefusal("kfs_unknown");
    if (app.state === "ACCEPTED") return;
    if (
      Date.parse(String(e.data.accepted_at)) > app.kfs.validityExpiry.getTime() ||
      this.now().getTime() > app.kfs.validityExpiry.getTime()
    )
      throw new LenderRefusal("kfs_expired");
    await this.move(app, "ACCEPTED");
  }

  /** Disburses an accepted application: `LoanDisbursed` with the cooling-off end (§6.3). */
  async disburse(applicationId: string): Promise<{ loanId: string; utr: string }> {
    const app = [...this.applications.values()].find((a) => a.applicationId === applicationId);
    if (!app || app.state !== "ACCEPTED") throw new LenderRefusal("not_accepted");
    const loanId = this.id("ln");
    const utr = `FAKE${hex(randomBytes(6)).toUpperCase()}`;
    const coolingOffEnd = new Date(this.now().getTime() + (this.o.coolingOffMs ?? 3 * 86_400_000));
    app.loanId = loanId;
    app.coolingOffEnd = coolingOffEnd;
    this.byLoan.set(loanId, app);
    await this.emit("LoanDisbursed", {
      loan_id: loanId,
      utr,
      amount_paise: app.amountPaise,
      value_date: this.now().toISOString().slice(0, 10),
      beneficiary_type: "BORROWER",
      kind: "INITIAL",
      cooling_off_end: coolingOffEnd.toISOString(),
    });
    await this.move(app, "DISBURSED");
    return { loanId, utr };
  }

  /** Takes `CoolingOffExitRequested`; refused `cooling_off_ended` after its end (CF para 11). */
  async coolingOffExit(event: unknown): Promise<void> {
    const e = this.take("CoolingOffExitRequested", event);
    const app = this.byLoan.get(String(e.data.loan_id));
    if (!app?.coolingOffEnd) throw new LenderRefusal("loan_unknown");
    if (Date.parse(String(e.data.requested_at)) > app.coolingOffEnd.getTime())
      throw new LenderRefusal("cooling_off_ended");
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
    await this.emit("ApplicationStatusChanged", {
      application_id: app.applicationId,
      seq: app.seq,
      from,
      to,
    });
  }

  private async emit(name: OriginationEventName, data: Record<string, unknown>): Promise<void> {
    const spec = ORIGINATION_EVENTS[name];
    spec.schema.parse(data);
    const now = this.now();
    const tenant = this.o.tenantId ?? "tnt_fake_re";
    const event = EcosystemEnvelope.parse({
      specversion: "1.0",
      id: uuidv7(now.getTime()),
      source: `urn:infrabyx:finbyx:${tenant}`,
      type: spec.type,
      subject: originationIdempotencyKey(name, data),
      time: now.toISOString(),
      datacontenttype: "application/json",
      dataschema: `https://registry.infrabyx.example/schemas/${spec.type}/${ORIGINATION_SCHEMA_VERSION}.json`,
      tenantid: tenant,
      reid: this.o.reId ?? "re_fake",
      productfamily: "lending",
      legalbasis: "CONTRACT_PERFORMANCE_RE",
      dataclass: "FINANCIAL",
      schemaver: ORIGINATION_SCHEMA_VERSION,
      seq: ++this.seq,
      environment: "test",
      data,
    });
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
}
