// BUREAU and AA_FIU contract cases and in-memory fakes (IPB-01-15; Finbyx PR-FBX-28, R1-D-43).
// The first vendor adapters, `cibil` and `setu-aa` (R1-D-61), run these cases against their stubs
// until the owner's sandboxes exist; then each runs `creditBureauContractCases(itsSandboxFixtures)`
// or `accountAggregatorContractCases(…)`. The fakes let products build their loan-origination
// flows now: deterministic fixtures, files as STORAGE references, no raw PAN in any result.
import { PortError } from "@infrabyx/contracts/errors";
import {
  AaConsentRequest,
  AaFetchRequest,
  BureauPullRequest,
  type AaConsent,
  type AaFetchResult,
  type AaNotification,
  type AccountAggregatorPort,
  type AdapterDescriptor,
  type BureauReport,
  type CreditBureauPort,
  type FiType,
  type PortHealth,
  type Tradeline,
} from "@infrabyx/contracts/ports";
import { newId, sha256Hex } from "@infrabyx/crypto";

// ------------------------------------------------------------------------------- credit bureau

/** Inputs a bureau adapter's contract run needs: the CIC sandbox's own test subjects. */
export interface CreditBureauFixtures {
  /** A subject the CIC knows, with a tradeline that reports an EMI and one that does not. */
  known: { pan: string; name: string };
  /** A subject the CIC has no record of. */
  noHit: { pan: string; name: string };
  /** A fresh consent receipt id for each pull (`cpr_…`). */
  consentRef: () => string;
  reportPrefix: string;
}

export const CREDIT_BUREAU_FAKE_FIXTURES: CreditBureauFixtures = {
  known: { pan: "AAAPZ1234C", name: "Asha Rao" },
  noHit: { pan: "ZZZPZ9999Z", name: "No Record" },
  consentRef: () => newId("cpr"),
  reportPrefix: "tenant/tnt_bureau/los/",
};

const fail = (port: string, adapter: string, reason: string, detail: string) =>
  new PortError("IPB-PORT-001", port as never, {
    adapter,
    detail,
    meta: { reason, definite: true },
  });

/**
 * In-memory bureau. Subjects in `pending` answer `pending` until `completePending` (the CIC's
 * async report) runs; a hard enquiry is counted on the subject's next report.
 */
export class FakeCreditBureau implements CreditBureauPort {
  readonly descriptor: AdapterDescriptor = {
    port: "BUREAU",
    adapter: "fake-bureau",
    residency: "IN",
    maxDataClass: "REGULATED",
  };
  private readonly fx: CreditBureauFixtures;
  private readonly pulls = new Map<string, BureauReport>();
  private readonly hardEnquiries = new Map<string, number>();
  private readonly pending: Set<string>;
  private readonly now: () => Date;
  private n = 0;
  constructor(
    o: { fixtures?: CreditBureauFixtures; pendingPans?: string[]; now?: () => Date } = {},
  ) {
    this.fx = o.fixtures ?? CREDIT_BUREAU_FAKE_FIXTURES;
    this.pending = new Set(o.pendingPans ?? []);
    this.now = o.now ?? (() => new Date());
  }

  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: this.now().toISOString() };
  }

  private ev() {
    return {
      vendorRef: `fake-bureau-${++this.n}`,
      adapter: "fake-bureau",
      formatVersion: "fake-cir-1",
      checkedAt: this.now().toISOString(),
    };
  }

  private tradelines(): Tradeline[] {
    return [
      {
        lenderType: "bank",
        accountType: "credit_card",
        ownership: "individual",
        sanctionedPaise: 10_000_000,
        currentPaise: 2_500_000,
        overduePaise: 0,
        // A card: the CIC reports no instalment (PR-FBX-35).
        emiPaise: null,
        worstDpd12m: "0",
        currentDpd: "0",
        status: "active",
        openedOn: "2021-04-01",
      },
      {
        lenderType: "nbfc",
        accountType: "personal_loan",
        ownership: "individual",
        sanctionedPaise: 50_000_000,
        currentPaise: 0,
        overduePaise: 0,
        emiPaise: 1_500_000,
        worstDpd12m: "1-30",
        currentDpd: "0",
        status: "closed",
        openedOn: "2022-01-15",
        closedOn: "2024-01-15",
      },
    ];
  }

  async pull(raw: Parameters<CreditBureauPort["pull"]>[0]): Promise<BureauReport> {
    const r = BureauPullRequest.parse(raw);
    const pan = r.subject.pan ?? "";
    const pullId = `pul_${sha256Hex(`${r.consentRef}:${++this.n}`).slice(0, 24)}`;
    const base = {
      ...this.ev(),
      bureau: r.bureau,
      enquiry: r.enquiry,
      pullId,
      consentRef: r.consentRef,
    };
    if (pan !== this.fx.known.pan && !this.pending.has(pan)) {
      const out: BureauReport = { ...base, state: "no_hit" };
      this.pulls.set(pullId, out);
      return out;
    }
    const prior = this.hardEnquiries.get(pan) ?? 0;
    if (r.enquiry === "hard") this.hardEnquiries.set(pan, prior + 1);
    if (this.pending.has(pan)) {
      const out: BureauReport = { ...base, state: "pending" };
      this.pulls.set(pullId, { ...out, reportPrefix: r.reportPrefix } as BureauReport);
      return out;
    }
    const out = this.ready(base, r.reportPrefix, prior + (r.enquiry === "hard" ? 1 : 0));
    this.pulls.set(pullId, out);
    return out;
  }

  private ready(base: Omit<BureauReport, "state">, prefix: string, hard: number): BureauReport {
    return {
      ...base,
      state: "ready",
      report: {
        storageKey: `${prefix}${base.pullId}.json`,
        sha256: sha256Hex(`report:${base.pullId}`),
      },
      summary: {
        score: 761,
        scoreVersion: "fake-score-2",
        tradelines: this.tradelines(),
        enquiries: { last30d: hard, last90d: hard + 1, last365d: hard + 2 },
      },
    };
  }

  /** Test hook: the CIC finishes a pending report. */
  completePending(pullId: string): void {
    const p = this.pulls.get(pullId) as (BureauReport & { reportPrefix?: string }) | undefined;
    if (!p || p.state !== "pending") throw new Error(`no pending pull ${pullId}`);
    const { reportPrefix, ...rest } = p;
    this.pulls.set(pullId, this.ready(rest, reportPrefix ?? "tenant/tnt_bureau/los/", 1));
  }

  async status(pullId: string): Promise<BureauReport> {
    const p = this.pulls.get(pullId);
    if (!p) throw fail("BUREAU", "fake-bureau", "unknown_pull", "no such pull");
    const { reportPrefix: _drop, ...out } = p as BureauReport & { reportPrefix?: string };
    return out;
  }

  async handleWebhook(
    rawBody: Uint8Array,
    _headers: Readonly<Record<string, string>> = {},
  ): Promise<BureauReport> {
    let pullId: unknown;
    try {
      pullId = (JSON.parse(new TextDecoder().decode(rawBody)) as { pullId?: unknown }).pullId;
    } catch {
      pullId = undefined;
    }
    if (typeof pullId !== "string")
      throw fail("BUREAU", "fake-bureau", "malformed", "the event names no pull");
    // Only the CIC's own read-back is trusted, never the event body.
    return this.status(pullId);
  }
}

// -------------------------------------------------------------------------- account aggregator

export interface AccountAggregatorFixtures {
  customerHandle: string;
  consentRef: () => string;
  dataPrefix: string;
  /** Plays the customer approving a consent at the AA (a sandbox call, or the fake's hook). */
  approve: (p: AccountAggregatorPort, consentId: string) => Promise<void>;
}

export const ACCOUNT_AGGREGATOR_FAKE_FIXTURES: AccountAggregatorFixtures = {
  customerHandle: "asha.rao@fake-aa",
  consentRef: () => newId("cpr"),
  dataPrefix: "tenant/tnt_aa/los/",
  approve: async (p, id) => (p as FakeAccountAggregator).approve(id),
};

const FI_SCHEMA_VERSION = "1.1.3";

/** In-memory FIU-side AA. `approve` plays the customer; consents expire on the injected clock. */
export class FakeAccountAggregator implements AccountAggregatorPort {
  readonly descriptor: AdapterDescriptor = {
    port: "AA_FIU",
    adapter: "fake-aa",
    residency: "IN",
    maxDataClass: "REGULATED",
  };
  private readonly consents = new Map<string, AaConsent>();
  private readonly now: () => Date;
  private n = 0;
  constructor(o: { now?: () => Date } = {}) {
    this.now = o.now ?? (() => new Date());
  }

  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: this.now().toISOString() };
  }

  private ev() {
    return {
      vendorRef: `fake-aa-${++this.n}`,
      adapter: "fake-aa",
      apiVersion: "2.0.0",
      checkedAt: this.now().toISOString(),
    };
  }

  private current(id: string): AaConsent {
    const c = this.consents.get(id);
    if (!c) throw fail("AA_FIU", "fake-aa", "unknown_consent", "no such consent");
    if (
      (c.state === "ACTIVE" || c.state === "PENDING" || c.state === "PAUSED") &&
      Date.parse(c.consentExpiry) <= this.now().getTime()
    ) {
      c.state = "EXPIRED";
    }
    return c;
  }

  async requestConsent(raw: Parameters<AccountAggregatorPort["requestConsent"]>[0]) {
    const r = AaConsentRequest.parse(raw);
    const consentId = `aac_${sha256Hex(`${r.consentRef}:${++this.n}`).slice(0, 24)}`;
    const c: AaConsent = {
      ...this.ev(),
      consentId,
      consentHandle: `handle-${consentId}`,
      state: "PENDING",
      fiTypes: [...r.fiTypes],
      dataRange: { from: r.dataRange.from, to: r.dataRange.to },
      consentExpiry: r.consentExpiry,
      revokedFiTypes: [],
    };
    this.consents.set(consentId, c);
    return { ...c };
  }

  /** Test hook: the customer approves at the AA. */
  approve(consentId: string): void {
    const c = this.current(consentId);
    if (c.state !== "PENDING") throw new Error(`consent ${consentId} is ${c.state}`);
    c.state = "ACTIVE";
  }

  async consentStatus(consentId: string): Promise<AaConsent> {
    return { ...this.current(consentId), ...this.ev() };
  }

  async revoke(consentId: string, fiTypes?: readonly FiType[]): Promise<AaConsent> {
    const c = this.current(consentId);
    if (c.state === "REVOKED" || c.state === "EXPIRED" || c.state === "REJECTED")
      throw fail("AA_FIU", "fake-aa", "consent_closed", `the consent is ${c.state}`);
    if (!fiTypes?.length) c.state = "REVOKED";
    else {
      c.revokedFiTypes = [...new Set([...c.revokedFiTypes, ...fiTypes])];
      if (c.fiTypes.every((f) => c.revokedFiTypes.includes(f))) c.state = "REVOKED";
    }
    return { ...c, ...this.ev() };
  }

  async fetch(raw: Parameters<AccountAggregatorPort["fetch"]>[0]): Promise<AaFetchResult> {
    const r = AaFetchRequest.parse(raw);
    const c = this.current(r.consentId);
    if (c.state !== "ACTIVE")
      throw fail("AA_FIU", "fake-aa", "consent_inactive", `the consent is ${c.state}`);
    if (
      Date.parse(r.range.from) < Date.parse(c.dataRange.from) ||
      Date.parse(r.range.to) > Date.parse(c.dataRange.to) ||
      Date.parse(r.range.from) > Date.parse(r.range.to)
    )
      throw fail("AA_FIU", "fake-aa", "range", "outside the consent's data range");
    const allowed = c.fiTypes.filter((f) => !c.revokedFiTypes.includes(f));
    const asked = r.fiTypes ?? allowed;
    if (asked.some((f) => !allowed.includes(f)))
      throw fail("AA_FIU", "fake-aa", "fi_type", "an FI type outside the consent");
    const sessionId = `aas_${++this.n}`;
    return {
      ...this.ev(),
      sessionId,
      consentId: c.consentId,
      state: "COMPLETED",
      payloads: asked.map((fiType, i) => ({
        fiType,
        maskedAccount: `XXXXXX${String(1000 + i)}`,
        storageKey: `${r.dataPrefix}${sessionId}-${fiType.toLowerCase()}.json`,
        sha256: sha256Hex(`${sessionId}:${fiType}`),
        schemaVersion: FI_SCHEMA_VERSION,
      })),
    };
  }

  async handleWebhook(
    rawBody: Uint8Array,
    _headers: Readonly<Record<string, string>> = {},
  ): Promise<AaNotification> {
    let body: { consentId?: unknown; kind?: unknown; sessionId?: unknown } = {};
    try {
      body = JSON.parse(new TextDecoder().decode(rawBody)) as typeof body;
    } catch {
      body = {};
    }
    if (typeof body.consentId !== "string" || (body.kind !== "consent" && body.kind !== "fi"))
      throw fail("AA_FIU", "fake-aa", "malformed", "not a consent or FI notification");
    // The notification's own state is ignored: the consent is read back from the AA.
    const consent = await this.consentStatus(body.consentId);
    return {
      kind: body.kind,
      consentId: body.consentId,
      consent,
      ...(typeof body.sessionId === "string" ? { sessionId: body.sessionId } : {}),
    };
  }
}
