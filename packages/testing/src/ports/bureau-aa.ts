// BUREAU and AA_FIU contract cases and in-memory fakes (IPB-01-15; Finbyx PR-FBX-28, R1-D-43).
// The first vendor adapters, `cibil` and `setu-aa` (R1-D-61), run these cases against their stubs
// until the owner's sandboxes exist; then each runs `creditBureauContractCases(itsSandboxFixtures)`
// or `accountAggregatorContractCases(…)`. The fakes let products build their loan-origination
// flows now: deterministic fixtures, files as STORAGE references, no raw PAN in any result.
import { expect } from "vitest";
import { PortError } from "@infrabyx/contracts/errors";
import {
  AaConsentRequest,
  AaFetchRequest,
  BureauPullRequest,
  payloadClass,
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
import type { ContractCase } from "../contract.js";

const PAN_LIKE = /[A-Z]{5}[0-9]{4}[A-Z]/;

// ------------------------------------------------------------------------------- credit bureau

/** Inputs a bureau adapter's contract run needs: the CIC sandbox's own test subjects. */
export interface CreditBureauFixtures {
  /** A subject the CIC knows. */
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

export function creditBureauContractCases(
  fx: CreditBureauFixtures,
): Array<ContractCase<CreditBureauPort>> {
  const req = (pan: string, name: string, enquiry: "soft" | "hard" = "soft") => ({
    bureau: "cibil" as const,
    enquiry,
    purpose: "new_credit" as const,
    consentRef: fx.consentRef(),
    subject: { subjectRef: "cus:contract", kind: "individual" as const, name, pan },
    reportPrefix: fx.reportPrefix,
  });
  return [
    {
      name: "the pull request classes identity fields REGULATED; the adapter stays IN",
      async run(p) {
        expect(payloadClass(BureauPullRequest).bodyHighest).toBe("REGULATED");
        expect(p.descriptor.residency).toBe("IN");
        expect(p.descriptor.maxDataClass).toBe("REGULATED");
      },
    },
    {
      name: "a pull needs a consent receipt and a well-formed subject; neither reaches the CIC otherwise",
      async run(p) {
        const { consentRef: _c, ...noConsent } = req(fx.known.pan, fx.known.name);
        await expect(p.pull(noConsent as never)).rejects.toThrow();
        await expect(
          p.pull({ ...req(fx.known.pan, fx.known.name), consentRef: "consent-1" }),
        ).rejects.toThrow();
        await expect(p.pull(req("abc", fx.known.name))).rejects.toThrow();
      },
    },
    {
      name: "a known subject returns the raw report by STORAGE reference with its hash, a normalised summary in paise and the evidence",
      async run(p) {
        const r = await p.pull(req(fx.known.pan, fx.known.name));
        if (r.state === "pending") return; // completed through status or the webhook
        expect(r.state).toBe("ready");
        expect(r.report?.storageKey.startsWith(fx.reportPrefix)).toBe(true);
        expect(r.report?.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(r.vendorRef && r.adapter && r.formatVersion && r.checkedAt).toBeTruthy();
        expect(r.summary?.scoreVersion).toBeTruthy();
        for (const t of r.summary?.tradelines ?? [])
          for (const v of [t.sanctionedPaise, t.currentPaise, t.overduePaise])
            expect(Number.isInteger(v) && v >= 0).toBe(true);
        expect(JSON.stringify(r)).not.toMatch(PAN_LIKE);
        expect((await p.status(r.pullId)).pullId).toBe(r.pullId);
      },
    },
    {
      name: "an unknown subject is a no-hit, and a hard enquiry shows on the next report",
      async run(p) {
        expect((await p.pull(req(fx.noHit.pan, fx.noHit.name))).state).toBe("no_hit");
        const before = await p.pull(req(fx.known.pan, fx.known.name));
        await p.pull(req(fx.known.pan, fx.known.name, "hard"));
        const after = await p.pull(req(fx.known.pan, fx.known.name));
        if (before.summary && after.summary)
          expect(after.summary.enquiries.last30d).toBeGreaterThan(before.summary.enquiries.last30d);
      },
    },
    {
      name: "a webhook is read back from the CIC; an event naming no pull is refused",
      async run(p) {
        const r = await p.pull(req(fx.known.pan, fx.known.name));
        const back = await p.handleWebhook(
          new TextEncoder().encode(JSON.stringify({ pullId: r.pullId, state: "no_hit" })),
          {},
        );
        expect(back.pullId).toBe(r.pullId);
        expect(back.state).not.toBe("no_hit");
        await expect(p.handleWebhook(new TextEncoder().encode("{}"), {})).rejects.toMatchObject({
          code: "IPB-PORT-001",
        });
      },
    },
  ];
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

export function accountAggregatorContractCases(
  fx: AccountAggregatorFixtures,
): Array<ContractCase<AccountAggregatorPort>> {
  const year = 365 * 86_400_000;
  const ask = (over: Partial<AaConsentRequest> = {}): AaConsentRequest => {
    const now = Date.now();
    return {
      customerHandle: fx.customerHandle,
      subjectRef: "cus:contract",
      consentRef: fx.consentRef(),
      purposeCode: "101",
      fiTypes: ["DEPOSIT", "TERM_DEPOSIT"],
      fetchType: "ONETIME",
      dataRange: {
        from: new Date(now - year).toISOString(),
        to: new Date(now).toISOString(),
      },
      dataLife: { unit: "MONTH", value: 3 },
      consentStart: new Date(now).toISOString(),
      consentExpiry: new Date(now + 30 * 86_400_000).toISOString(),
      ...over,
    };
  };
  const range = (c: AaConsent) => ({ from: c.dataRange.from, to: c.dataRange.to });
  return [
    {
      name: "the consent request classes the customer's handle REGULATED; the adapter stays IN",
      async run(p) {
        expect(payloadClass(AaConsentRequest).bodyHighest).toBe("REGULATED");
        expect(p.descriptor.residency).toBe("IN");
        expect(p.descriptor.maxDataClass).toBe("REGULATED");
      },
    },
    {
      name: "a consent request needs the product's receipt and a valid template; a PERIODIC one needs a frequency",
      async run(p) {
        const { consentRef: _c, ...noReceipt } = ask();
        await expect(p.requestConsent(noReceipt as never)).rejects.toThrow();
        await expect(p.requestConsent(ask({ fetchType: "PERIODIC" }))).rejects.toThrow();
        const c = await p.requestConsent(ask());
        expect(c.state).toBe("PENDING");
        expect((await p.consentStatus(c.consentId)).consentId).toBe(c.consentId);
      },
    },
    {
      name: "fetch works only under an ACTIVE consent, within its range and FI types; each payload names its ReBIT schema version and hash",
      async run(p) {
        const c = await p.requestConsent(ask());
        const fetch = (over: Partial<AaFetchRequest> = {}) =>
          p.fetch({ consentId: c.consentId, range: range(c), dataPrefix: fx.dataPrefix, ...over });
        await expect(fetch()).rejects.toMatchObject({ code: "IPB-PORT-001" });
        await fx.approve(p, c.consentId);
        const r = await fetch();
        expect(r.payloads.map((x) => x.fiType).sort()).toEqual(["DEPOSIT", "TERM_DEPOSIT"]);
        for (const x of r.payloads) {
          expect(x.schemaVersion).toMatch(/^\d+\.\d+(\.\d+)?$/);
          expect(x.sha256).toMatch(/^[0-9a-f]{64}$/);
          expect(x.storageKey.startsWith(fx.dataPrefix)).toBe(true);
          expect(x.maskedAccount).not.toMatch(/^[0-9]{9,}$/);
        }
        await expect(
          fetch({
            range: { from: new Date(Date.now() - 3 * year).toISOString(), to: c.dataRange.to },
          }),
        ).rejects.toMatchObject({ code: "IPB-PORT-001" });
        await expect(fetch({ fiTypes: ["EQUITIES"] })).rejects.toMatchObject({
          code: "IPB-PORT-001",
        });
      },
    },
    {
      name: "revoking one FI type narrows the consent; revoking in full stops every fetch",
      async run(p) {
        const c = await p.requestConsent(ask());
        await fx.approve(p, c.consentId);
        const part = await p.revoke(c.consentId, ["TERM_DEPOSIT"]);
        expect(part.state).toBe("ACTIVE");
        expect(part.revokedFiTypes).toEqual(["TERM_DEPOSIT"]);
        const r = await p.fetch({
          consentId: c.consentId,
          range: range(c),
          dataPrefix: fx.dataPrefix,
        });
        expect(r.payloads.map((x) => x.fiType)).toEqual(["DEPOSIT"]);
        expect((await p.revoke(c.consentId)).state).toBe("REVOKED");
        await expect(
          p.fetch({ consentId: c.consentId, range: range(c), dataPrefix: fx.dataPrefix }),
        ).rejects.toMatchObject({ code: "IPB-PORT-001" });
      },
    },
    {
      name: "a notification is read back from the AA; its own state is never trusted",
      async run(p) {
        const c = await p.requestConsent(ask());
        const n = await p.handleWebhook(
          new TextEncoder().encode(
            JSON.stringify({ kind: "consent", consentId: c.consentId, state: "ACTIVE" }),
          ),
          {},
        );
        expect(n.consent?.state).toBe("PENDING");
        await expect(p.handleWebhook(new TextEncoder().encode("{}"), {})).rejects.toMatchObject({
          code: "IPB-PORT-001",
        });
      },
    },
  ];
}
