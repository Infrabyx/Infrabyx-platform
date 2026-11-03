// AA_FIU adapter `setu-aa`: Setu's FIU APIs, the first Account Aggregator technology service
// provider in the owner's order (OWNER-QUESTIONS #97, R1-D-43, R1-D-61). Over the egress client,
// no SDK. India-hosted (IN), REGULATED. Off behind `int.aa_fiu.setu.enabled` (default false) and
// `unproven` until the owner's Setu FIU sandbox exists; built against a stub meanwhile.
//
// Vendor facts below are STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX ([VERIFY]); each one lives in
// one small mapping function so the sandbox can correct it in one place:
// - auth: headers `x-client-id`, `x-client-secret` and `x-product-instance-id`; hosts
//   `fiu.setu.co` and `fiu-sandbox.setu.co`;
// - consent: `POST /v2/consents` with the ReBIT template (`vua`, `purpose`, `fiTypes`,
//   `fetchType`, `frequency`, `dataRange`, `dataLife`, `consentDateRange`, `consentMode`),
//   answered `{ id, url, status }`; `GET /v2/consents/<id>` answers `{ id, status, detail }`;
//   `POST /v2/consents/<id>/revoke`;
// - data: `POST /v2/sessions` with `{ consentId, dataRange, format: "json" }`, answered `{ id }`;
//   `GET /v2/sessions/<id>` answers `{ id, status, fips[{ fipID, accounts[{ maskedAccNumber,
//   FIstatus, data: { account: { type, version, … } } }] }] }`;
// - notifications: `{ type: CONSENT_STATUS_UPDATE | SESSION_STATUS_UPDATE, consentId,
//   dataSessionId?, data }`.
// Revoking some FI types is kept here (the FIU stops fetching them; Setu has no partial revoke to
// confirm yet); revoking the last one, or all, revokes the consent at Setu. Every payload goes to
// STORAGE as received with its SHA-256 and ReBIT schema version; the result carries only the masked
// account. A notification is never trusted: the consent is read back from Setu.
import { PortError } from "@infrabyx/contracts/errors";
import {
  AaConsentRequest,
  AaFetchRequest,
  FI_TYPES,
  type AaConsent,
  type AaConsentState,
  type AaFetchResult,
  type AaNotification,
  type AccountAggregatorPort,
  type AdapterDescriptor,
  type FiPayload,
  type FiType,
  type PortCall,
  type PortHealth,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { sha256Hex, ulid } from "@infrabyx/crypto";
import { createEgress } from "../core/http.js";
import { vendorError } from "../messaging/common.js";

const PORT = "AA_FIU";
const ADAPTER = "setu-aa";
const HOSTS = ["fiu.setu.co", "fiu-sandbox.setu.co"];
const API_VERSION = "2.0.0";

/** What the adapter keeps per consent (the product's table). */
export interface SetuConsentRecord {
  /** Setu's page where the customer approves the consent (shown by the product). */
  approvalUrl?: string;
  /** FI types revoked one by one, which the adapter no longer fetches. */
  revokedFiTypes: FiType[];
}

export interface SetuAccountAggregatorOptions {
  storage: StoragePort;
  /** The product's consent records (a table in its AA schema); keyed by Setu's consent id. */
  consents: {
    get(consentId: string): Promise<SetuConsentRecord | undefined>;
    set(consentId: string, rec: SetuConsentRecord): Promise<void>;
  };
  /** `int.aa_fiu.setu.enabled`, read on every call; off until the owner's sandbox exists. */
  enabled: () => Promise<boolean> | boolean;
  /** `secrets/<env>/aa_fiu/setu/client_id`, `client_secret` and `product_instance_id`. */
  clientId: () => Promise<string> | string;
  clientSecret: () => Promise<string> | string;
  productInstanceId: () => Promise<string> | string;
  /** Setu's sandbox host instead of production (test environments only). */
  sandbox?: boolean;
  /** Polls of a data session before `fetch` answers PENDING (default 10, 1 s apart). */
  pollAttempts?: number;
  pollDelayMs?: number;
  /** Tests only: the Setu stub. */
  baseUrl?: string;
  allowLoopbackHttp?: boolean;
  now?: () => Date;
}

// ---- stub-shaped mappings (to confirm against the sandbox) -------------------------------------

/** STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX: Setu's consent request body. */
export function setuConsentBody(r: ReturnType<typeof AaConsentRequest.parse>) {
  return {
    vua: r.customerHandle,
    purpose: {
      code: r.purposeCode,
      refUri: "https://api.rebit.org.in/aa/purpose/" + r.purposeCode + ".xml",
      text: "Loan underwriting",
      category: { type: "string" },
    },
    fiTypes: r.fiTypes,
    fetchType: r.fetchType,
    ...(r.frequency ? { frequency: r.frequency } : {}),
    dataRange: r.dataRange,
    dataLife: r.dataLife,
    consentDateRange: { startDate: r.consentStart, endDate: r.consentExpiry },
    consentMode: "STORE",
    consentTypes: ["PROFILE", "SUMMARY", "TRANSACTIONS"],
    context: [],
  };
}

const STATES = new Set<string>(["PENDING", "ACTIVE", "PAUSED", "REJECTED", "REVOKED", "EXPIRED"]);

/** STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX: Setu's consent read-back. */
export function mapSetuConsent(body: unknown): {
  id: string;
  state: AaConsentState;
  fiTypes: FiType[];
  dataRange: { from: string; to: string };
  consentExpiry: string;
  url?: string;
} {
  const b = body as Record<string, unknown> | undefined;
  const d = (b?.detail ?? {}) as Record<string, unknown>;
  const range = d.dataRange as { from?: unknown; to?: unknown } | undefined;
  const dates = d.consentDateRange as { endDate?: unknown } | undefined;
  const fiTypes = Array.isArray(d.fiTypes)
    ? (d.fiTypes as unknown[]).filter((f): f is FiType => FI_TYPES.includes(f as FiType))
    : [];
  if (
    typeof b?.id !== "string" ||
    typeof b.status !== "string" ||
    !STATES.has(b.status) ||
    typeof range?.from !== "string" ||
    typeof range.to !== "string" ||
    typeof dates?.endDate !== "string" ||
    fiTypes.length === 0
  )
    throw vendorError(PORT, ADAPTER, 502, "consent without its id, state, range or FI types");
  return {
    id: b.id,
    state: b.status as AaConsentState,
    fiTypes,
    dataRange: { from: range.from, to: range.to },
    consentExpiry: dates.endDate,
    ...(typeof b.url === "string" ? { url: b.url } : {}),
  };
}

/** STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX: a ReBIT account `type` to the port's FI type. */
export function setuFiType(type: unknown): FiType | undefined {
  if (typeof type !== "string") return undefined;
  const t = type.toUpperCase().replace(/-/g, "_");
  const alias: Record<string, FiType> = { MUTUALFUNDS: "MUTUAL_FUNDS", GSTR1_3B: "GST_GSTR1_3B" };
  const f = alias[t] ?? t;
  return FI_TYPES.includes(f as FiType) ? (f as FiType) : undefined;
}

/** Only the last four characters of an account number survive. */
export function maskAccount(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length < 4) return "XXXX";
  // Already masked when no run of digits is left before the last four.
  if (!/[0-9]{3,}/.test(s.slice(0, -4))) return s;
  return `${"X".repeat(Math.max(4, s.length - 4))}${s.slice(-4)}`;
}

/**
 * STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX: what a notification names. `kind` and `sessionId`
 * are the platform's own relayed form.
 */
export function setuNotification(
  body: unknown,
): { kind: "consent" | "fi"; consentId: string; sessionId?: string } | undefined {
  const b = body as Record<string, unknown> | undefined;
  if (typeof b?.consentId !== "string" || b.consentId.length < 3) return undefined;
  const kind =
    b.type === "CONSENT_STATUS_UPDATE" || b.kind === "consent"
      ? "consent"
      : b.type === "SESSION_STATUS_UPDATE" || b.kind === "fi"
        ? "fi"
        : undefined;
  if (!kind) return undefined;
  const session = b.dataSessionId ?? b.sessionId;
  return {
    kind,
    consentId: b.consentId,
    ...(typeof session === "string" ? { sessionId: session } : {}),
  };
}

const refused = (detail: string, reason: string): PortError =>
  new PortError("IPB-PORT-001", PORT, {
    adapter: ADAPTER,
    detail,
    meta: { reason, definite: true },
  });

const CLOSED = new Set<AaConsentState>(["REVOKED", "EXPIRED", "REJECTED"]);

export class SetuAccountAggregator implements AccountAggregatorPort {
  readonly descriptor: AdapterDescriptor = {
    port: PORT,
    adapter: ADAPTER,
    residency: "IN",
    maxDataClass: "REGULATED",
  };
  private readonly egress;
  private readonly base: string;
  private readonly now: () => Date;

  constructor(private readonly o: SetuAccountAggregatorOptions) {
    this.base = (o.baseUrl ?? `https://${o.sandbox ? HOSTS[1] : HOSTS[0]}`).replace(/\/$/, "");
    this.now = o.now ?? (() => new Date());
    this.egress = createEgress({
      port: PORT,
      adapter: ADAPTER,
      allow: HOSTS,
      retries: 1,
      timeoutMs: 15_000,
      maxBytes: 16 * 1024 * 1024,
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
  }

  private async guard(): Promise<void> {
    if (!(await this.o.enabled()))
      throw refused("the Setu AA adapter is off (int.aa_fiu.setu.enabled)", "adapter_disabled");
  }

  private async headers(): Promise<Record<string, string>> {
    return {
      "x-client-id": await this.o.clientId(),
      "x-client-secret": await this.o.clientSecret(),
      "x-product-instance-id": await this.o.productInstanceId(),
      accept: "application/json",
      "content-type": "application/json",
    };
  }

  private ev(vendorRef: string) {
    return {
      vendorRef,
      adapter: ADAPTER,
      apiVersion: API_VERSION,
      checkedAt: this.now().toISOString(),
    };
  }

  private async record(consentId: string): Promise<SetuConsentRecord> {
    const rec = await this.o.consents.get(consentId);
    if (!rec) throw refused("no such consent", "unknown_consent");
    return rec;
  }

  /** Setu's consent with what is kept here (revoked FI types; an elapsed expiry is EXPIRED). */
  private async read(consentId: string): Promise<AaConsent> {
    const rec = await this.record(consentId);
    const res = await this.egress(`${this.base}/v2/consents/${encodeURIComponent(consentId)}`, {
      headers: await this.headers(),
    });
    if (res.status === 404) throw refused("Setu does not know the consent", "unknown_consent");
    if (res.status !== 200) throw vendorError(PORT, ADAPTER, res.status, "Setu consent read-back");
    const c = mapSetuConsent(res.json());
    if (c.id !== consentId) throw vendorError(PORT, ADAPTER, 502, "Setu answered another consent");
    const lapsed =
      (c.state === "ACTIVE" || c.state === "PENDING" || c.state === "PAUSED") &&
      Date.parse(c.consentExpiry) <= this.now().getTime();
    return {
      ...this.ev(c.id),
      consentId: c.id,
      consentHandle: c.id,
      state: lapsed ? "EXPIRED" : c.state,
      fiTypes: c.fiTypes,
      dataRange: c.dataRange,
      consentExpiry: c.consentExpiry,
      revokedFiTypes: rec.revokedFiTypes.filter((f) => c.fiTypes.includes(f)),
    };
  }

  async requestConsent(
    raw: Parameters<AccountAggregatorPort["requestConsent"]>[0],
    _call?: PortCall,
  ): Promise<AaConsent> {
    const r = AaConsentRequest.parse(raw);
    await this.guard();
    const res = await this.egress(`${this.base}/v2/consents`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(setuConsentBody(r)),
    });
    if (res.status === 400 || res.status === 422)
      throw refused("Setu refused the consent request", "invalid_request");
    if (res.status !== 200 && res.status !== 201)
      throw vendorError(PORT, ADAPTER, res.status, "Setu consent API");
    const a = res.json<{ id?: unknown; url?: unknown }>();
    if (typeof a.id !== "string" || a.id.length < 3 || a.id.length > 200)
      throw vendorError(PORT, ADAPTER, 502, "Setu answer without its consent id");
    await this.o.consents.set(a.id, {
      ...(typeof a.url === "string" ? { approvalUrl: a.url } : {}),
      revokedFiTypes: [],
    });
    return this.read(a.id);
  }

  /** Setu's page where the customer approves the consent (not on the port yet; R1-D-61). */
  async approvalUrl(consentId: string): Promise<string | undefined> {
    return (await this.record(consentId)).approvalUrl;
  }

  async consentStatus(consentId: string, _call?: PortCall): Promise<AaConsent> {
    await this.guard();
    return this.read(consentId);
  }

  async revoke(
    consentId: string,
    fiTypes?: readonly FiType[],
    _call?: PortCall,
  ): Promise<AaConsent> {
    await this.guard();
    const c = await this.read(consentId);
    if (CLOSED.has(c.state)) throw refused(`the consent is ${c.state}`, "consent_closed");
    const rec = await this.record(consentId);
    const revoked = [...new Set([...rec.revokedFiTypes, ...(fiTypes ?? [])])];
    if (fiTypes?.length && !c.fiTypes.every((f) => revoked.includes(f))) {
      await this.o.consents.set(consentId, { ...rec, revokedFiTypes: revoked });
      return this.read(consentId);
    }
    const res = await this.egress(
      `${this.base}/v2/consents/${encodeURIComponent(consentId)}/revoke`,
      { method: "POST", headers: await this.headers(), body: "{}" },
    );
    if (res.status !== 200 && res.status !== 204)
      throw vendorError(PORT, ADAPTER, res.status, "Setu consent revoke");
    await this.o.consents.set(consentId, { ...rec, revokedFiTypes: revoked });
    return this.read(consentId);
  }

  async fetch(
    raw: Parameters<AccountAggregatorPort["fetch"]>[0],
    _call?: PortCall,
  ): Promise<AaFetchResult> {
    const r = AaFetchRequest.parse(raw);
    await this.guard();
    const c = await this.read(r.consentId);
    if (c.state !== "ACTIVE") throw refused(`the consent is ${c.state}`, "consent_inactive");
    if (
      Date.parse(r.range.from) < Date.parse(c.dataRange.from) ||
      Date.parse(r.range.to) > Date.parse(c.dataRange.to) ||
      Date.parse(r.range.from) > Date.parse(r.range.to)
    )
      throw refused("outside the consent's data range", "range");
    const allowed = c.fiTypes.filter((f) => !c.revokedFiTypes.includes(f));
    const asked = r.fiTypes ?? allowed;
    if (asked.some((f) => !allowed.includes(f)))
      throw refused("an FI type outside the consent", "fi_type");
    const started = await this.egress(`${this.base}/v2/sessions`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify({ consentId: c.consentId, dataRange: r.range, format: "json" }),
    });
    if (started.status !== 200 && started.status !== 201)
      throw vendorError(PORT, ADAPTER, started.status, "Setu data session");
    const sessionId = started.json<{ id?: unknown }>().id;
    if (typeof sessionId !== "string" || sessionId.length < 3)
      throw vendorError(PORT, ADAPTER, 502, "Setu answer without its session id");
    const s = await this.poll(sessionId);
    const payloads: FiPayload[] = [];
    for (const fip of s.fips)
      for (const a of fip.accounts ?? []) {
        if (a.FIstatus !== "READY" || !a.data) continue;
        const account = (a.data as { account?: { type?: unknown; version?: unknown } }).account;
        const fiType = setuFiType(account?.type);
        // Only what was asked and is still consented leaves Setu's answer.
        if (!fiType || !asked.includes(fiType)) continue;
        const version = account?.version;
        if (typeof version !== "string" || !/^\d+\.\d+(\.\d+)?$/.test(version))
          throw vendorError(PORT, ADAPTER, 502, "FI payload without its ReBIT schema version");
        const body = new TextEncoder().encode(JSON.stringify(a.data));
        const sha256 = sha256Hex(body);
        const storageKey = `${r.dataPrefix}${ulid()}.json`;
        await this.o.storage.put(storageKey, body, {
          bucketClass: "REGULATED",
          contentType: "application/json",
          sha256,
        });
        payloads.push({
          fiType,
          maskedAccount: maskAccount(a.maskedAccNumber),
          storageKey,
          sha256,
          schemaVersion: version,
        });
      }
    return { ...this.ev(sessionId), sessionId, consentId: c.consentId, state: s.state, payloads };
  }

  private async poll(sessionId: string): Promise<{
    state: AaFetchResult["state"];
    fips: Array<{
      accounts?: Array<{ maskedAccNumber?: unknown; FIstatus?: unknown; data?: unknown }>;
    }>;
  }> {
    const attempts = Math.max(1, this.o.pollAttempts ?? 10);
    const delay = this.o.pollDelayMs ?? 1000;
    for (let i = 0; i < attempts; i++) {
      if (i > 0 && delay > 0) await new Promise((r) => setTimeout(r, delay));
      const res = await this.egress(`${this.base}/v2/sessions/${encodeURIComponent(sessionId)}`, {
        headers: await this.headers(),
      });
      if (res.status !== 200) throw vendorError(PORT, ADAPTER, res.status, "Setu session read");
      const b = res.json<{ id?: unknown; status?: unknown; fips?: unknown }>();
      if (b.id !== sessionId)
        throw vendorError(PORT, ADAPTER, 502, "Setu answered another session");
      if (b.status === "FAILED" || b.status === "EXPIRED")
        throw vendorError(PORT, ADAPTER, 502, `Setu data session ${b.status}`);
      if (b.status === "COMPLETED" || b.status === "PARTIAL")
        return {
          state: b.status,
          fips: Array.isArray(b.fips) ? (b.fips as never) : [],
        };
    }
    return { state: "PENDING", fips: [] };
  }

  /** The notification only names a consent; its state is read back from Setu. */
  async handleWebhook(
    rawBody: Uint8Array,
    _headers: Readonly<Record<string, string>> = {},
  ): Promise<AaNotification> {
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      body = undefined;
    }
    const n = setuNotification(body);
    if (!n) throw refused("not a consent or FI notification", "malformed");
    const consent = await this.consentStatus(n.consentId);
    return { ...n, consent };
  }

  async health(): Promise<PortHealth> {
    const started = performance.now();
    let status: PortHealth["status"] = "up";
    try {
      if (!(await this.o.enabled())) status = "down";
      else {
        // An unknown consent: 404 proves the credentials and the route; 401/403/5xx are down.
        const res = await this.egress(`${this.base}/v2/consents/health-probe`, {
          headers: await this.headers(),
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
