// BUREAU and AA_FIU contract cases and in-memory fakes (IPB-01-15; Finbyx PR-FBX-28, R1-D-43).
// The first vendor adapters, `cibil` and `setu-aa` (R1-D-61), run these cases against their stubs
// until the owner's sandboxes exist; then each runs `creditBureauContractCases(itsSandboxFixtures)`
// or `accountAggregatorContractCases(…)`. The fakes let products build their loan-origination
// flows now: deterministic fixtures, files as STORAGE references, no raw PAN in any result. The
// fake AA writes each FI payload's bytes to STORAGE as the `setu-aa` adapter does (Udofin
// PR-UDF-065, R1-D-243): REGULATED class, an IPB-01-27 key under the fetch's `dataPrefix`, and the
// SHA-256 of exactly the stored bytes, so a STATEMENT_ANALYSIS adapter can read them by reference.
import { PortError } from "@infrabyx/contracts/errors";
import {
  AA_APPROVAL_URL_REFUSED,
  AA_FIU_MISMATCH,
  AaConsentRequest,
  AaFetchRequest,
  aaApprovalUrlAllowed,
  aaFiuMismatch,
  BureauPullRequest,
  consentEcho,
  consentInForce,
  type AaConsent,
  type AaFetchResult,
  type AaNotification,
  type AccountAggregatorPort,
  type AdapterDescriptor,
  type BureauReport,
  type CreditBureauPort,
  type FiPayload,
  type FiType,
  type PortHealth,
  type StoragePort,
  type Tradeline,
  isValidStorageKey,
} from "@infrabyx/contracts/ports";
import { newId, sha256Hex, ulid } from "@infrabyx/crypto";
import { MemoryStorage } from "../core.js";

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
    const pullId = `pul_${sha256Hex(`${consentInForce(r)}:${++this.n}`).slice(0, 24)}`;
    // The consent's shape was checked by the schema; it is echoed, never looked up (PR-UDF-049).
    const base = {
      ...this.ev(),
      bureau: r.bureau,
      enquiry: r.enquiry,
      pullId,
      ...consentEcho(r),
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
  /**
   * The FIU the AA reports for this instance's consents (PR-UDF-050). Without it the FIU cases
   * check only that a consent's `fiuId`, when present, is the one asked for.
   */
  fiuId?: string;
  /**
   * The STORAGE adapter `p` writes its FI payloads to (PR-UDF-065). With it, the fetch case reads
   * each payload back: REGULATED, an IPB-01-27 key under `dataPrefix`, bytes matching its SHA-256.
   * Without it, the case checks the references only, as before.
   */
  storageOf?: (p: AccountAggregatorPort) => StoragePort;
  /**
   * Plays the AA reporting the consent for another FIU on its next read-backs (a sandbox cannot,
   * so only stubs and the fake give it; the read-back case is skipped without it).
   */
  reportFiu?: (p: AccountAggregatorPort, consentId: string, fiuId: string) => Promise<void>;
}

export const ACCOUNT_AGGREGATOR_FAKE_FIXTURES: AccountAggregatorFixtures = {
  customerHandle: "asha.rao@fake-aa",
  consentRef: () => newId("cpr"),
  dataPrefix: "tenant/tnt_aa/los/",
  approve: async (p, id) => (p as FakeAccountAggregator).approve(id),
  fiuId: "fake-fiu",
  reportFiu: async (p, id, fiu) => (p as FakeAccountAggregator).reportFiu(id, fiu),
  storageOf: (p) => (p as FakeAccountAggregator).storage,
};

const FI_SCHEMA_VERSION = "1.1.3";

/** The ReBIT `account.type` of each FI type, as the Setu stub writes it. */
const REBIT_TYPE: Record<FiType, string> = {
  DEPOSIT: "deposit",
  TERM_DEPOSIT: "term-deposit",
  RECURRING_DEPOSIT: "recurring_deposit",
  GST_GSTR1_3B: "gstr1_3b",
  MUTUAL_FUNDS: "mutualfunds",
  EQUITIES: "equities",
  INSURANCE_POLICIES: "insurance_policies",
};

/**
 * The bytes the fake AA stores for one FI payload: a synthetic ReBIT-shaped JSON object (the
 * `account` the AA decrypts, as `setu-aa` stores it), deterministic by its inputs. Test data only:
 * a masked account, round figures, and no identity number or 12-digit run.
 */
export function fakeFiPayload(p: {
  fiType: FiType;
  maskedAccount: string;
  sessionId: string;
  range: { from: string; to: string };
  schemaVersion?: string;
}): Uint8Array {
  const day = (iso: string) => iso.slice(0, 10);
  return new TextEncoder().encode(
    JSON.stringify({
      account: {
        type: REBIT_TYPE[p.fiType],
        version: p.schemaVersion ?? FI_SCHEMA_VERSION,
        maskedAccNumber: p.maskedAccount,
        linkedAccRef: `fake-link-${p.sessionId}-${p.fiType.toLowerCase()}`,
        summary: { currentBalance: "25000.00", currency: "INR" },
        transactions: {
          startDate: day(p.range.from),
          endDate: day(p.range.to),
          transaction: [
            {
              txnId: `fake-txn-${p.sessionId}-1`,
              type: "CREDIT",
              mode: "UPI",
              amount: "1500.00",
              currentBalance: "25000.00",
              valueDate: day(p.range.to),
              narration: "SYNTHETIC CREDIT",
            },
          ],
        },
      },
      synthetic: true,
    }),
  );
}

/** A consent as the fake AA keeps it: the port's view plus what only the AA knows. */
interface FakeConsent extends Omit<AaConsent, "fiuId" | "approvalUrl"> {
  /** The FIU the request asked for (compared on every read-back), if it named one. */
  askedFiu?: string;
  /** The FIU the AA reports on the consent. */
  reportedFiu: string;
  /** The approval page while PENDING. */
  link: string;
}

/** Letters only, so a link never carries a run of digits (hex digits 0–9 become g–p). */
const letters = (hex: string): string => hex.replace(/[0-9]/g, (d) => "ghijklmnop"[Number(d)]!);

/**
 * In-memory FIU-side AA. `approve` plays the customer; consents expire on the injected clock. It
 * reports its own FIU (`fiuId`, default `fake-fiu`) on every consent, as an AA reports the FIU
 * behind the credentials, so a request naming another FIU is refused `fiu_mismatch` with nothing
 * kept; `reportFiu` makes the AA report another FIU on later read-backs. A fetch writes each FI
 * payload (`fakeFiPayload`) to `storage` (PR-UDF-065): the REGULATED class, the key
 * `<dataPrefix><ULID>.json` (IPB-01-27), and the SHA-256 of the stored bytes in the result. Without
 * a `storage` the fake keeps its own `MemoryStorage`, so `new FakeAccountAggregator()` works as
 * before; pass the STORAGE a STATEMENT_ANALYSIS adapter reads to join the two.
 */
export class FakeAccountAggregator implements AccountAggregatorPort {
  readonly descriptor: AdapterDescriptor = {
    port: "AA_FIU",
    adapter: "fake-aa",
    residency: "IN",
    maxDataClass: "REGULATED",
  };
  private readonly consents = new Map<string, FakeConsent>();
  private readonly now: () => Date;
  private readonly fiuId: string;
  private readonly approvalHost: string;
  /** Where each fetch writes its FI payloads (PR-UDF-065); its own `MemoryStorage` by default. */
  readonly storage: StoragePort;
  private n = 0;
  constructor(
    o: { now?: () => Date; fiuId?: string; approvalHost?: string; storage?: StoragePort } = {},
  ) {
    this.now = o.now ?? (() => new Date());
    this.fiuId = o.fiuId ?? "fake-fiu";
    this.approvalHost = o.approvalHost ?? "approve.fake-aa.example";
    this.storage = o.storage ?? new MemoryStorage(() => this.now());
  }

  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: this.now().toISOString() };
  }

  /** Test hook: how many consents the fake keeps (a refused request keeps none). */
  get consentsKept(): number {
    return this.consents.size;
  }

  private ev() {
    return {
      vendorRef: `fake-aa-${++this.n}`,
      adapter: "fake-aa",
      apiVersion: "2.0.0",
      checkedAt: this.now().toISOString(),
    };
  }

  private fiuRefused(): PortError {
    return fail("AA_FIU", "fake-aa", AA_FIU_MISMATCH, "the AA reports the consent for another FIU");
  }

  private current(id: string): FakeConsent {
    const c = this.consents.get(id);
    if (!c) throw fail("AA_FIU", "fake-aa", "unknown_consent", "no such consent");
    if (aaFiuMismatch(c.askedFiu, c.reportedFiu)) throw this.fiuRefused();
    if (
      (c.state === "ACTIVE" || c.state === "PENDING" || c.state === "PAUSED") &&
      Date.parse(c.consentExpiry) <= this.now().getTime()
    ) {
      c.state = "EXPIRED";
    }
    return c;
  }

  /** The port's view: the reported FIU, and the approval page only while PENDING. */
  private view(c: FakeConsent): AaConsent {
    const { askedFiu: _a, reportedFiu, link, ...rest } = c;
    return {
      ...rest,
      revokedFiTypes: [...c.revokedFiTypes],
      fiuId: reportedFiu,
      ...(c.state === "PENDING" ? { approvalUrl: link } : {}),
    };
  }

  async requestConsent(raw: Parameters<AccountAggregatorPort["requestConsent"]>[0]) {
    const r = AaConsentRequest.parse(raw);
    // The AA records the consent for the FIU behind the credentials; checked before anything is kept.
    if (aaFiuMismatch(r.fiuId, this.fiuId)) throw this.fiuRefused();
    const consentId = `aac_${sha256Hex(`${consentInForce(r)}:${++this.n}`).slice(0, 24)}`;
    const link = `https://${this.approvalHost}/consents/${letters(sha256Hex(`link:${consentId}`).slice(0, 32))}`;
    if (!aaApprovalUrlAllowed(link, [this.approvalHost]))
      throw fail(
        "AA_FIU",
        "fake-aa",
        AA_APPROVAL_URL_REFUSED,
        "the approval link failed its check",
      );
    const c: FakeConsent = {
      ...this.ev(),
      consentId,
      consentHandle: `handle-${consentId}`,
      state: "PENDING",
      fiTypes: [...r.fiTypes],
      dataRange: { from: r.dataRange.from, to: r.dataRange.to },
      consentExpiry: r.consentExpiry,
      revokedFiTypes: [],
      ...(r.fiuId !== undefined ? { askedFiu: r.fiuId } : {}),
      reportedFiu: this.fiuId,
      link,
    };
    this.consents.set(consentId, c);
    return this.view(c);
  }

  /** Test hook: the customer approves at the AA. */
  approve(consentId: string): void {
    const c = this.current(consentId);
    if (c.state !== "PENDING") throw new Error(`consent ${consentId} is ${c.state}`);
    c.state = "ACTIVE";
  }

  /** Test hook: the AA reports the consent for `fiuId` from now on. */
  reportFiu(consentId: string, fiuId: string): void {
    const c = this.consents.get(consentId);
    if (!c) throw new Error(`no consent ${consentId}`);
    c.reportedFiu = fiuId;
  }

  async consentStatus(consentId: string): Promise<AaConsent> {
    return { ...this.view(this.current(consentId)), ...this.ev() };
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
    return { ...this.view(c), ...this.ev() };
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
    const payloads: FiPayload[] = [];
    for (const [i, fiType] of asked.entries()) {
      const maskedAccount = `XXXXXX${String(1000 + i)}`;
      const body = fakeFiPayload({ fiType, maskedAccount, sessionId, range: r.range });
      const sha256 = sha256Hex(body);
      // `dataPrefix` is `tenant/<tenant>/<module>/` (the schema), so the key is IPB-01-27's.
      const storageKey = `${r.dataPrefix}${ulid()}.json`;
      if (!isValidStorageKey(storageKey))
        throw fail("AA_FIU", "fake-aa", "storage_key", "not an IPB-01-27 storage key");
      await this.storage.put(storageKey, body, {
        bucketClass: "REGULATED",
        contentType: "application/json",
        sha256,
      });
      payloads.push({
        fiType,
        maskedAccount,
        storageKey,
        sha256,
        schemaVersion: FI_SCHEMA_VERSION,
      });
    }
    return {
      ...this.ev(),
      sessionId,
      consentId: c.consentId,
      state: "COMPLETED",
      payloads,
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
