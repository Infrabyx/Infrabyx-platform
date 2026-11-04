// BUREAU adapter `cibil`: TransUnion CIBIL, the first credit information company in the owner's
// order (OWNER-QUESTIONS #97, R1-D-43, R1-D-61). Over the egress client, no SDK. India-hosted (IN),
// REGULATED. Off behind `int.bureau.cibil.enabled` (default false) and `unproven` until the owner's
// CIBIL sandbox documents and member account exist; it is built against a stub meanwhile. It
// serves `bureau: "cibil"` only: a pull for another CIC is refused before anything leaves.
//
// Vendor facts below are STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX ([VERIFY]); each one lives in
// one small mapping function so the sandbox can correct it in one place:
// - auth: headers `member-id` (the member code) and `api-key`; host `api.transunioncibil.com`
//   (mutual TLS, if CIBIL requires it, is the egress agent's concern);
// - a pull: `POST /consumer/v4/reports` with `{ memberReference, enquiryType: SOFT|HARD,
//   enquiryPurpose, enquiryAmount (rupees), consumer: { name, pan, dob, mobile, pincode } }`,
//   answered `{ requestId, memberReference, status: COMPLETED|PENDING|NO_HIT, report? }`;
// - a read-back: `GET /consumer/v4/reports/<requestId>`, the same answer;
// - the report (CIR 4.0): `scores[{ scoreName, score }]`, `accounts[{ memberType, accountType,
//   ownershipIndicator, highCreditAmount, currentBalance, amountOverdue, emiAmount (the instalment,
//   absent or empty when not reported; PR-FBX-35, R1-D-84), paymentHistory (3-digit days past due
//   per month, latest first), accountStatus, dateOpened, dateClosed }]` (amounts in whole rupees,
//   dates DDMMYYYY), `enquiries[{ enquiryDate }]`;
// - the async-report event: `{ memberReference, requestId, status }`.
// The pull id is ours and is sent as the member reference, so the CIC's event names it. The raw
// report goes to STORAGE as received with its SHA-256; the result carries only the normalised
// summary, never a PAN. An event is never trusted: the pull is read back from CIBIL.
import { PortError } from "@infrabyx/contracts/errors";
import {
  BureauPullRequest,
  DPD_BUCKETS,
  type AdapterDescriptor,
  type BureauReport,
  type BureauSummary,
  type CreditBureauPort,
  type DpdBucket,
  type EnquiryType,
  type PortCall,
  type PortHealth,
  type StoragePort,
  type Tradeline,
} from "@infrabyx/contracts/ports";
import { newId, sha256Hex } from "@infrabyx/crypto";
import { createEgress } from "../core/http.js";
import { vendorError } from "../messaging/common.js";

const PORT = "BUREAU";
const ADAPTER = "cibil";
const HOST = "api.transunioncibil.com";
const PAN_LIKE = /[A-Z]{5}[0-9]{4}[A-Z]/;

/** What the adapter keeps per pull so a pending one can be completed (the product's table). */
export interface CibilPullRecord {
  requestId: string;
  reportPrefix: string;
  consentRef: string;
  enquiry: EnquiryType;
}

export interface CibilBureauOptions {
  storage: StoragePort;
  /** The product's pull records (a table in its bureau schema); keyed by our pull id. */
  pulls: {
    get(pullId: string): Promise<CibilPullRecord | undefined>;
    set(pullId: string, rec: CibilPullRecord): Promise<void>;
  };
  /** `int.bureau.cibil.enabled`, read on every call; off until the owner's sandbox exists. */
  enabled: () => Promise<boolean> | boolean;
  /** `secrets/<env>/bureau/cibil/member_id` and `api_key`. */
  memberId: () => Promise<string> | string;
  apiKey: () => Promise<string> | string;
  /** Tests only: the CIBIL stub. */
  baseUrl?: string;
  allowLoopbackHttp?: boolean;
  now?: () => Date;
}

interface CibilAnswer {
  requestId?: string;
  memberReference?: string;
  status?: string;
  report?: unknown;
}

// ---- stub-shaped mappings (to confirm against the sandbox) -------------------------------------

/** STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX: the enquiry purpose codes. */
export const CIBIL_PURPOSE: Record<BureauPullRequest["purpose"], string> = {
  new_credit: "NEW_CREDIT",
  review: "ACCOUNT_REVIEW",
  collections: "COLLECTIONS",
  guarantor: "GUARANTOR",
  co_applicant: "CO_APPLICANT",
};

/** STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX: a 3-digit days-past-due value to a bucket. */
export function cibilDpdBucket(days: number): DpdBucket {
  if (!Number.isFinite(days) || days <= 0) return "0";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  if (days <= 180) return "91-180";
  return "180+";
}

const worse = (a: DpdBucket, b: DpdBucket): DpdBucket =>
  DPD_BUCKETS.indexOf(a) >= DPD_BUCKETS.indexOf(b) ? a : b;

/** DDMMYYYY to YYYY-MM-DD, or undefined. */
const isoDate = (v: unknown): string | undefined => {
  if (typeof v !== "string" || !/^[0-9]{8}$/.test(v)) return undefined;
  return `${v.slice(4, 8)}-${v.slice(2, 4)}-${v.slice(0, 2)}`;
};

/** Whole rupees (number or numeric string) to integer paise, never negative. */
const paise = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};

/**
 * STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX ([VERIFY] the field name `emiAmount` and its unit):
 * an account's reported instalment in whole rupees to integer paise, or `null` when CIBIL reports
 * none. Absent, empty, unparseable, zero or negative are all `null`, so a product computing FOIR
 * never reads a missing instalment as a zero obligation.
 */
export function cibilEmiPaise(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!/^[0-9][0-9,]*(\.[0-9]{1,2})?$/.test(s)) return null;
  const n = Number(s.replace(/,/g, ""));
  const p = Math.round(n * 100);
  return Number.isSafeInteger(p) && p > 0 ? p : null;
}

const LENDER: Record<string, Tradeline["lenderType"]> = {
  BANK: "bank",
  NBFC: "nbfc",
  HFC: "hfc",
  MFI: "mfi",
};
const OWNERSHIP: Record<string, Tradeline["ownership"]> = {
  "1": "individual",
  "2": "individual",
  "3": "guarantor",
  "4": "joint",
};
const STATUS: Record<string, Tradeline["status"]> = {
  ACTIVE: "active",
  CLOSED: "closed",
  WRITTEN_OFF: "written_off",
  SETTLED: "settled",
  RESTRUCTURED: "restructured",
};

/** STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX: a CIR 4.0 report to the port's summary. */
export function mapCibilReport(report: unknown, now: Date): BureauSummary {
  const r = report as Record<string, unknown> | undefined;
  if (!r || !Array.isArray(r.accounts) || !Array.isArray(r.enquiries))
    throw vendorError(PORT, ADAPTER, 502, "report without its accounts or enquiries");
  const scores = Array.isArray(r.scores) ? (r.scores as Array<Record<string, unknown>>) : [];
  const s = scores[0];
  const raw = s ? Number(s.score) : NaN;
  const tradelines = (r.accounts as Array<Record<string, unknown>>).map((a): Tradeline => {
    const history = typeof a.paymentHistory === "string" ? a.paymentHistory : "";
    const months = (history.match(/.{3}/g) ?? []).map((m) => (/^[0-9]{3}$/.test(m) ? +m : 0));
    const buckets = months.slice(0, 12).map(cibilDpdBucket);
    const openedOn = isoDate(a.dateOpened);
    if (!openedOn) throw vendorError(PORT, ADAPTER, 502, "account without its opening date");
    const closedOn = isoDate(a.dateClosed);
    return {
      lenderType: LENDER[String(a.memberType)] ?? "other",
      accountType: typeof a.accountType === "string" ? a.accountType : "unknown",
      ownership: OWNERSHIP[String(a.ownershipIndicator)] ?? "individual",
      sanctionedPaise: paise(a.highCreditAmount),
      currentPaise: paise(a.currentBalance),
      overduePaise: paise(a.amountOverdue),
      emiPaise: cibilEmiPaise(a.emiAmount),
      worstDpd12m: buckets.reduce<DpdBucket>(worse, "0"),
      currentDpd: buckets[0] ?? "0",
      status: STATUS[String(a.accountStatus)] ?? "active",
      openedOn,
      ...(closedOn ? { closedOn } : {}),
    };
  });
  const day = 86_400_000;
  const ages = (r.enquiries as Array<Record<string, unknown>>)
    .map((e) => isoDate(e.enquiryDate))
    .filter((d): d is string => d !== undefined)
    .map((d) => (now.getTime() - Date.parse(`${d}T00:00:00Z`)) / day);
  const within = (n: number) => ages.filter((a) => a >= -1 && a <= n).length;
  return {
    score: Number.isFinite(raw) && raw > 0 ? raw : null,
    scoreVersion: s && typeof s.scoreName === "string" ? s.scoreName : "cibil-unknown",
    tradelines,
    enquiries: { last30d: within(30), last90d: within(90), last365d: within(365) },
  };
}

/** STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX: the report's format and version. */
export function cibilFormatVersion(report: unknown): string {
  const v = (report as { formatVersion?: unknown } | undefined)?.formatVersion;
  return typeof v === "string" && /^[A-Za-z0-9.-]{1,20}$/.test(v)
    ? `cibil-${v.toLowerCase()}`
    : "cibil-cir";
}

/**
 * STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX: the pull an event names. CIBIL's event carries our
 * pull id as `memberReference`; `pullId` is the platform's own relayed form.
 */
export function cibilEventPullId(body: unknown): string | undefined {
  const b = body as { memberReference?: unknown; pullId?: unknown } | undefined;
  const id = b?.memberReference ?? b?.pullId;
  return typeof id === "string" && /^bpl_[0-9A-HJKMNP-TV-Z]{26}$/.test(id) ? id : undefined;
}

const refused = (detail: string, reason: string): PortError =>
  new PortError("IPB-PORT-001", PORT, {
    adapter: ADAPTER,
    detail,
    meta: { reason, definite: true },
  });

export class CibilBureau implements CreditBureauPort {
  readonly descriptor: AdapterDescriptor = {
    port: PORT,
    adapter: ADAPTER,
    residency: "IN",
    maxDataClass: "REGULATED",
  };
  private readonly egress;
  private readonly base: string;
  private readonly now: () => Date;

  constructor(private readonly o: CibilBureauOptions) {
    this.base = (o.baseUrl ?? `https://${HOST}`).replace(/\/$/, "");
    this.now = o.now ?? (() => new Date());
    this.egress = createEgress({
      port: PORT,
      adapter: ADAPTER,
      allow: [HOST],
      retries: 1,
      timeoutMs: 20_000,
      maxBytes: 8 * 1024 * 1024,
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
  }

  private async guard(): Promise<void> {
    if (!(await this.o.enabled()))
      throw refused("the CIBIL adapter is off (int.bureau.cibil.enabled)", "adapter_disabled");
  }

  private async headers(): Promise<Record<string, string>> {
    return {
      "member-id": await this.o.memberId(),
      "api-key": await this.o.apiKey(),
      accept: "application/json",
      "content-type": "application/json",
    };
  }

  /** Map CIBIL's answer to the port's result, writing a ready report to STORAGE first. */
  private async result(
    pullId: string,
    rec: CibilPullRecord,
    a: CibilAnswer,
  ): Promise<BureauReport> {
    if (a.requestId !== rec.requestId)
      throw vendorError(PORT, ADAPTER, 502, "CIBIL answered for another request");
    const base = {
      vendorRef: rec.requestId,
      adapter: ADAPTER,
      formatVersion: cibilFormatVersion(a.report),
      checkedAt: this.now().toISOString(),
      bureau: "cibil" as const,
      enquiry: rec.enquiry,
      pullId,
      consentRef: rec.consentRef,
    };
    if (a.status === "PENDING") return { ...base, state: "pending" };
    if (a.status === "NO_HIT") return { ...base, state: "no_hit" };
    if (a.status !== "COMPLETED" || a.report === undefined)
      throw vendorError(PORT, ADAPTER, 502, `CIBIL report status ${String(a.status)}`);
    const summary = mapCibilReport(a.report, this.now());
    if (PAN_LIKE.test(JSON.stringify(summary)))
      throw vendorError(PORT, ADAPTER, 502, "the summary carried a PAN-like value");
    const body = new TextEncoder().encode(JSON.stringify(a.report));
    const sha256 = sha256Hex(body);
    // The key is the pull's ULID (IPB-01-27), so a re-read writes the same object.
    const storageKey = `${rec.reportPrefix}${pullId.slice(4)}.json`;
    await this.o.storage.put(storageKey, body, {
      bucketClass: "REGULATED",
      contentType: "application/json",
      sha256,
    });
    return { ...base, state: "ready", report: { storageKey, sha256 }, summary };
  }

  async pull(
    raw: Parameters<CreditBureauPort["pull"]>[0],
    _call?: PortCall,
  ): Promise<BureauReport> {
    const r = BureauPullRequest.parse(raw);
    if (r.bureau !== "cibil")
      throw refused(`${ADAPTER} serves CIBIL only, not ${r.bureau}`, "unsupported_bureau");
    await this.guard();
    const pullId = newId("bpl");
    const s = r.subject;
    const res = await this.egress(`${this.base}/consumer/v4/reports`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify({
        memberReference: pullId,
        enquiryType: r.enquiry === "hard" ? "HARD" : "SOFT",
        enquiryPurpose: CIBIL_PURPOSE[r.purpose],
        ...(r.amountPaise !== undefined ? { enquiryAmount: Math.ceil(r.amountPaise / 100) } : {}),
        consumer: {
          type: s.kind === "commercial" ? "COMMERCIAL" : "INDIVIDUAL",
          name: s.name,
          ...(s.pan ? { pan: s.pan } : {}),
          ...(s.dob ? { dob: s.dob } : {}),
          ...(s.mobile ? { mobile: s.mobile } : {}),
          ...(s.pincode ? { pincode: s.pincode } : {}),
        },
      }),
    });
    if (res.status === 400 || res.status === 422)
      throw refused("CIBIL refused the request", "invalid_request");
    if (res.status !== 200 && res.status !== 202)
      throw vendorError(PORT, ADAPTER, res.status, "CIBIL report API");
    const a = res.json<CibilAnswer>();
    if (!a.requestId || a.memberReference !== pullId)
      throw vendorError(PORT, ADAPTER, 502, "CIBIL answer without its request id");
    const rec: CibilPullRecord = {
      requestId: a.requestId,
      reportPrefix: r.reportPrefix,
      consentRef: r.consentRef,
      enquiry: r.enquiry,
    };
    await this.o.pulls.set(pullId, rec);
    return this.result(pullId, rec, a);
  }

  async status(pullId: string, _call?: PortCall): Promise<BureauReport> {
    await this.guard();
    const rec = await this.o.pulls.get(pullId);
    if (!rec) throw refused("no such pull", "unknown_pull");
    const res = await this.egress(
      `${this.base}/consumer/v4/reports/${encodeURIComponent(rec.requestId)}`,
      { headers: await this.headers() },
    );
    if (res.status === 404) throw refused("CIBIL does not know the request", "unknown_pull");
    if (res.status !== 200) throw vendorError(PORT, ADAPTER, res.status, "CIBIL report read-back");
    return this.result(pullId, rec, res.json<CibilAnswer>());
  }

  /** The event only names a pull; its state is read back from CIBIL. */
  async handleWebhook(
    rawBody: Uint8Array,
    _headers: Readonly<Record<string, string>> = {},
  ): Promise<BureauReport> {
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      body = undefined;
    }
    const pullId = cibilEventPullId(body);
    if (!pullId) throw refused("the event names no pull", "malformed");
    return this.status(pullId);
  }

  async health(): Promise<PortHealth> {
    const started = performance.now();
    let status: PortHealth["status"] = "up";
    try {
      if (!(await this.o.enabled())) status = "down";
      else {
        // An empty pull: 400/422 proves the credentials and the route; 401/403/5xx are down.
        const res = await this.egress(`${this.base}/consumer/v4/reports`, {
          method: "POST",
          headers: await this.headers(),
          body: "{}",
        });
        if (res.status >= 500 || res.status === 401 || res.status === 403) status = "down";
      }
    } catch {
      status = "down";
    }
    return {
      status,
      latency_ms: Math.round(performance.now() - started),
      checked_at: this.now().toISOString(),
    };
  }
}
