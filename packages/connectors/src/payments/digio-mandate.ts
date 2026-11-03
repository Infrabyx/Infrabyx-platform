// PAYMENTS mandate adapter `digio-mandate` (owner answer #100, R1-D-62; Finbyx PR-FBX-29, R1-D-52):
// eNACH (net banking, debit card, Aadhaar) and UPI AutoPay mandates through Digio's mandate API
// over the egress client, no SDK. It provides PAYMENTS' optional `MandateLifecycle` only (IPB-01's
// port names stay; no mandate port): orders, checkout, refunds and reconciliation stay with the
// payment aggregator adapters. India-hosted (IN), REGULATED. Off behind
// `int.payments.digio_mandate.enabled` (default false) and `unproven` until the owner's Digio
// mandate account and the sponsor bank's configuration exist. Physical NACH is refused (not
// approved for this adapter); debits against a mandate are not built here.
//
// Money controls (R1-D-52): registering and cancelling a mandate are money-moving calls, so each
// runs `assertMoneyCall` first (an approved maker-checker reference, a user or service initiator,
// never an agent, and an idempotency key); amounts are integer paise, sent as an exact rupee
// decimal and checked back exactly (P-04); `kill.payments` pauses both (P-12); a live credential is
// refused outside prod/dr and a test one inside them (P-03). Each idempotency key is claimed in the
// product's key store before Digio is called, so a retry returns the first mandate and a key reused
// with another request is refused.
//
// Vendor facts below are STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX ([VERIFY]); each lives in one
// small mapping function so the sandbox can correct it in one place:
// - auth: HTTP Basic with client id and secret (as Digio's eSign API); sandbox `ext.digio.in`,
//   production `api.digio.in`;
// - create: `POST /v3/client/mandate/create_form` with `customer_identifier`, `auth_mode`
//   (`api` | `esign` | `upi`), `mandate_type: "create"`, `corporate_config_id` and `mandate_data`
//   (`maximum_amount` in rupees, `instrument_type: "debit"`, `first_collection_date`,
//   `final_collection_date`, `frequency`, `customer_name`, `customer_account_number`,
//   `destination_bank_id` (IFSC), `customer_account_type`, `customer_ref_number`), answered with
//   `{ id, state, umrn?, authentication_url? }`;
// - status: `GET /v3/client/mandate/{id}`; cancel: `POST /v3/client/mandate/{id}/cancel` with
//   `{ reason }`.
// The approvals engine (owner answer #100's gap, 4 Nov 2026; R1-D-66): before Digio is called to
// register or cancel, the adapter has the approvals engine consume the call's approval reference:
// a `payments.mandate.change` request, approved, not yet consumed, in the same tenant, for the same
// mandate (the registration's idempotency key, or the mandate id to cancel) and the same ceiling in
// integer paise. Refused, nothing reaches Digio; consumed, it can never be used again, so a call
// that must be made again after an unknown outcome or a vendor failure needs a fresh approval. A
// retry that only reads the first call's mandate back consumes nothing. The product's own
// maker-checker still runs first (defence in depth). Amendment has no port method yet: when it
// comes, it consumes an `amend` approval the same way.
//
// Digio documents no webhook signature here, so the callback URL carries our C-19 secret as
// `ipb_token` (as for Digio eSign) and the mandate is always read back from the API.
import type { AppEnv } from "@infrabyx/contracts/env";
import { PortError } from "@infrabyx/contracts/errors";
import {
  assertMoneyCall,
  decimalToMinor,
  MandateRegistration,
  minorToDecimal,
  type AdapterDescriptor,
  type Mandate,
  type MandateChannel,
  type MandateApprovalSubject,
  type MandateApprovalVerifier,
  type MandateLifecycle,
  type MandateState,
  type MoneyAuthorisation,
  type Port,
  type PortCall,
  type PortHealth,
  type WebhookRequestMeta,
} from "@infrabyx/contracts/ports";
import { canonicalDigest } from "@infrabyx/crypto";
import { createEgress } from "../core/http.js";
import { checkSharedSecret, parseJson, vendorError, webhookRefused } from "../messaging/common.js";
import { assertCredentialMode, assertNotKilled, assertSameAmount, reference } from "./common.js";

const PAYMENTS = "PAYMENTS";
const ADAPTER = "digio-mandate";
const HOSTS = { sandbox: "ext.digio.in", production: "api.digio.in" } as const;

/** What the product resolves for a registration; sent to Digio, never returned or stored here. */
export interface DigioMandateDebtor {
  name: string;
  /** The customer's e-mail address or mobile number (`+91…`), where Digio sends the request. */
  identifier: string;
  accountNumber: string;
  ifsc: string;
  accountType: "savings" | "current";
}

/** An idempotency key's claim: the request it is bound to and the mandate it created. */
export interface MandateKeyClaim {
  digest: string;
  /** Null while the first call is in flight or ended with an unknown outcome. */
  mandateId: string | null;
  /** When the key was claimed (ms since the epoch). */
  claimedAt: number;
}

/** The first mandate each idempotency key created (the product's durable store in production). */
export interface MandateKeyStore {
  /** Claims `key` for a request with `digest`: null when this call claimed it, else the claim. */
  claim(key: string, digest: string): Promise<MandateKeyClaim | null>;
  complete(key: string, mandateId: string): Promise<void>;
  /** Frees a claim whose call definitely did not create a mandate. */
  release(key: string): Promise<void>;
}

/** In-memory key store for tests and single-process tools. */
export class MemoryMandateKeyStore implements MandateKeyStore {
  private readonly m = new Map<string, MandateKeyClaim>();
  constructor(private readonly now: () => number = Date.now) {}
  async claim(key: string, digest: string) {
    const prior = this.m.get(key);
    if (prior) return { ...prior };
    this.m.set(key, { digest, mandateId: null, claimedAt: this.now() });
    return null;
  }
  async complete(key: string, mandateId: string) {
    const r = this.m.get(key);
    if (r) r.mandateId = mandateId;
  }
  async release(key: string) {
    this.m.delete(key);
  }
}

export interface DigioMandateOptions {
  /** `int.payments.digio_mandate.enabled`, read on every call; off until the owner's account exists. */
  enabled: () => Promise<boolean> | boolean;
  keys: MandateKeyStore;
  /**
   * The approvals engine (`ApprovalsEngine.mandateVerifier` in `@infrabyx/tenancy`), which consumes
   * each call's approval before Digio is called (R1-D-66).
   */
  approvals: MandateApprovalVerifier;
  /** The tenant this adapter instance serves (the call's tenancy context). */
  tenantId: () => Promise<string> | string;
  /** Resolves the customer and the verified debtor account the registration names by reference. */
  debtor: (customerRef: string, debtorAccountRef: string) => Promise<DigioMandateDebtor>;
  /** `secrets/<env>/payments/digio_mandate/client_id` and `client_secret`. */
  clientId: () => Promise<string> | string;
  clientSecret: () => Promise<string> | string;
  /** The sponsor bank configuration at Digio (`corporate_config_id`). */
  corporateConfigId: () => Promise<string> | string;
  /** Our C-19 URL secret for the callback (`ipb_token`), at least 32 random bytes. */
  webhookToken: () => Promise<string> | string;
  env: AppEnv;
  /** Sandbox until the owner's account exists (default); production is a live credential (P-03). */
  mode?: "sandbox" | "production";
  /** `kill.payments` (P-12). */
  killed?: () => boolean | Promise<boolean>;
  /** Tests only: the Digio mandate stub. */
  baseUrl?: string;
  allowLoopbackHttp?: boolean;
  now?: () => number;
}

/** A claim older than this whose mandate Digio does not know is retried (egress times out sooner). */
const SETTLED_MS = 120_000;

interface DigioMandate {
  id?: string;
  state?: string;
  umrn?: string | null;
  authentication_url?: string | null;
  reject_reason?: string | null;
  mandate_details?: { maximum_amount?: string | number; auth_mode?: string; sub_mode?: string };
}

// ---- stub-shaped mappings (to confirm against the sandbox) -------------------------------------

/** STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX: the channel as Digio's auth mode. */
export function digioAuthMode(channel: MandateChannel): { auth_mode: string; sub_mode?: string } {
  switch (channel) {
    case "ENACH_NETBANKING":
      return { auth_mode: "api", sub_mode: "netbanking" };
    case "ENACH_DEBIT_CARD":
      return { auth_mode: "api", sub_mode: "debit_card" };
    case "ENACH_AADHAAR":
      return { auth_mode: "esign" };
    case "UPI_AUTOPAY":
      return { auth_mode: "upi" };
    default:
      throw refused(`${ADAPTER} does not register ${channel} mandates`, "unsupported");
  }
}

/** STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX: Digio's auth mode back to the channel. */
export function digioChannel(authMode?: string, subMode?: string): MandateChannel {
  if (authMode === "upi") return "UPI_AUTOPAY";
  if (authMode === "esign") return "ENACH_AADHAAR";
  if (authMode === "api") return subMode === "debit_card" ? "ENACH_DEBIT_CARD" : "ENACH_NETBANKING";
  throw vendorError(PAYMENTS, ADAPTER, 502, `unknown mandate auth mode ${authMode ?? "(none)"}`);
}

/** STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX: Digio's mandate state to the port's. */
export function mapDigioMandateState(state: string | undefined): MandateState {
  switch ((state ?? "").toLowerCase()) {
    case "initiated":
    case "partial":
      return "pending_customer";
    case "auth_success":
    case "register_pending":
      return "pending_bank";
    case "register_success":
    case "active":
      return "active";
    case "auth_fail":
    case "register_failed":
    case "rejected":
      return "rejected";
    case "paused":
    case "suspended":
      return "paused";
    case "revoked":
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
    default:
      throw vendorError(PAYMENTS, ADAPTER, 502, `unknown mandate state ${state ?? "(none)"}`);
  }
}

/** STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX: the port's frequency as Digio's. */
export function digioFrequency(f: string): string {
  return {
    ADHOC: "Adhoc",
    MONTHLY: "Monthly",
    QUARTERLY: "Quarterly",
    HALF_YEARLY: "Half-Yearly",
    YEARLY: "Yearly",
  }[f] as string;
}

// ------------------------------------------------------------------------------------------------

const refused = (detail: string, reason: string): PortError =>
  new PortError("IPB-PORT-001", PAYMENTS, {
    adapter: ADAPTER,
    detail,
    meta: { reason, definite: true },
  });

/** The request a key is bound to: everything but who approved it (a retry may be re-approved). */
const digestOf = (m: ReturnType<typeof MandateRegistration.parse>) => {
  const { authorisation: _a, ...rest } = m;
  return canonicalDigest(rest);
};

export class DigioMandates implements Port, MandateLifecycle {
  readonly descriptor: AdapterDescriptor = {
    port: PAYMENTS,
    adapter: ADAPTER,
    residency: "IN",
    maxDataClass: "REGULATED",
    capabilities: { registerMandate: "native", mandateStatus: "native", cancelMandate: "native" },
  };
  private readonly egress;
  private readonly base: string;
  private readonly mode: "sandbox" | "production";

  constructor(private readonly o: DigioMandateOptions) {
    this.mode = o.mode ?? "sandbox";
    this.base = (o.baseUrl ?? `https://${HOSTS[this.mode]}`).replace(/\/$/, "");
    this.egress = createEgress({
      port: PAYMENTS,
      adapter: ADAPTER,
      allow: [HOSTS[this.mode]],
      retries: 1,
      maxBytes: 256 * 1024,
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
  }

  private async guard(method: string, opts: { healthProbe?: boolean } = {}): Promise<void> {
    if (!(await this.o.enabled()))
      throw refused(
        "the Digio mandate adapter is off (int.payments.digio_mandate.enabled)",
        "adapter_disabled",
      );
    assertCredentialMode(
      this.descriptor,
      this.o.env,
      this.mode === "production" ? "live" : "test",
      opts,
    );
    if (method !== "mandateStatus") await assertNotKilled(this.descriptor, this.o.killed, method);
  }

  private async headers(): Promise<Record<string, string>> {
    const basic = Buffer.from(`${await this.o.clientId()}:${await this.o.clientSecret()}`).toString(
      "base64",
    );
    return {
      authorization: `Basic ${basic}`,
      accept: "application/json",
      "content-type": "application/json",
    };
  }

  /** Digio's mandate as the port's, its amount checked exactly against ours when we know it. */
  private toMandate(d: DigioMandate, expectMinor?: number): Mandate {
    if (!d.id) throw vendorError(PAYMENTS, ADAPTER, 502, "mandate without its id");
    const raw = d.mandate_details?.maximum_amount;
    if (raw === undefined) throw vendorError(PAYMENTS, ADAPTER, 502, "mandate without its amount");
    const maxAmountMinor = decimalToMinor(String(raw));
    if (expectMinor !== undefined) assertSameAmount(this.descriptor, expectMinor, maxAmountMinor);
    return {
      mandateId: d.id,
      channel: digioChannel(d.mandate_details?.auth_mode, d.mandate_details?.sub_mode),
      state: mapDigioMandateState(d.state),
      umrn: d.umrn ?? null,
      maxAmountMinor,
      authorisationUrl: d.authentication_url ?? null,
      rejectionReason: d.reject_reason ?? null,
      vendorRef: d.id,
      adapter: ADAPTER,
    };
  }

  private async read(mandateId: string): Promise<DigioMandate> {
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(mandateId))
      throw refused("not a Digio mandate id", "invalid_request");
    const res = await this.egress(
      `${this.base}/v3/client/mandate/${encodeURIComponent(mandateId)}`,
      { method: "GET", headers: await this.headers() },
    );
    if (res.status === 404) throw refused("unknown mandate", "not_found");
    if (res.status !== 200) throw vendorError(PAYMENTS, ADAPTER, res.status, "Digio mandate");
    return res.json<DigioMandate>();
  }

  async registerMandate(
    spec: Parameters<MandateLifecycle["registerMandate"]>[0],
    idempotencyKey: string,
    _call?: PortCall,
  ): Promise<Mandate> {
    assertMoneyCall(
      PAYMENTS,
      (spec as { authorisation?: unknown } | undefined)?.authorisation,
      idempotencyKey,
    );
    const m = MandateRegistration.parse(spec);
    const mode = digioAuthMode(m.channel);
    await this.guard("registerMandate");
    const digest = digestOf(m);
    const ref = reference("mdt", idempotencyKey, 24);
    const prior = await this.o.keys.claim(idempotencyKey, digest);
    if (prior) {
      if (prior.digest !== digest)
        throw new PortError("IPB-PORT-004", PAYMENTS, {
          adapter: ADAPTER,
          detail: "idempotency key reused with a different mandate",
        });
      if (prior.mandateId)
        return this.toMandate(await this.read(prior.mandateId), m.maxAmountMinor);
      // The first call's outcome is unknown: ask Digio for our reference before creating again.
      const found = await this.findByRef(ref);
      if (found) {
        const out = this.toMandate(found, m.maxAmountMinor);
        await this.o.keys.complete(idempotencyKey, out.mandateId);
        return out;
      }
      if ((this.o.now ?? Date.now)() - prior.claimedAt < SETTLED_MS)
        throw new PortError("IPB-PORT-002", PAYMENTS, {
          adapter: ADAPTER,
          detail: "the first registration with this key is still in flight; ask again shortly",
          meta: { reason: "in_flight" },
        });
    }
    let created: DigioMandate;
    try {
      await this.consume(m.authorisation.approvalRef, {
        operation: "register",
        mandate: idempotencyKey,
        maxAmountMinor: m.maxAmountMinor,
      });
      const debtor = await this.o.debtor(m.customerRef, m.debtorAccountRef);
      const res = await this.egress(`${this.base}/v3/client/mandate/create_form`, {
        method: "POST",
        headers: await this.headers(),
        body: JSON.stringify({
          customer_identifier: debtor.identifier.replace(/^\+91/, ""),
          ...mode,
          mandate_type: "create",
          corporate_config_id: await this.o.corporateConfigId(),
          mandate_data: {
            maximum_amount: minorToDecimal(m.maxAmountMinor),
            instrument_type: "debit",
            is_recurring: m.frequency !== "ADHOC",
            frequency: digioFrequency(m.frequency),
            first_collection_date: m.startDate,
            ...(m.endDate ? { final_collection_date: m.endDate } : {}),
            customer_name: debtor.name,
            customer_account_number: debtor.accountNumber,
            destination_bank_id: debtor.ifsc,
            customer_account_type: debtor.accountType,
            // Our reference, derived from the key; carries no personal data (P-05).
            customer_ref_number: ref,
          },
        }),
      });
      if (res.status === 400 || res.status === 422)
        throw refused("Digio refused the mandate request", "vendor_rejected");
      if (res.status !== 200 && res.status !== 201)
        throw vendorError(PAYMENTS, ADAPTER, res.status, "Digio mandate create");
      created = res.json<DigioMandate>();
    } catch (e) {
      // A definite refusal, or a failure before Digio was called, frees the key; an unknown
      // outcome (a timeout, a 5xx) keeps it claimed until Digio is asked for our reference.
      if (!(e instanceof PortError) || e.meta?.definite === true)
        await this.o.keys.release(idempotencyKey);
      throw e;
    }
    const out = this.toMandate(created, m.maxAmountMinor);
    await this.o.keys.complete(idempotencyKey, out.mandateId);
    return out;
  }

  /** The approvals engine consumes the approval, or refuses before anything reaches Digio. */
  private async consume(approvalRef: string, subject: MandateApprovalSubject): Promise<void> {
    await this.o.approvals.consume({ tenantId: await this.o.tenantId(), approvalRef, subject });
  }

  /** STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX: the mandate created with our reference, if any. */
  private async findByRef(ref: string): Promise<DigioMandate | null> {
    const res = await this.egress(
      `${this.base}/v3/client/mandate/search?customer_ref_number=${encodeURIComponent(ref)}`,
      { method: "GET", headers: await this.headers() },
    );
    if (res.status === 404) return null;
    if (res.status !== 200) throw vendorError(PAYMENTS, ADAPTER, res.status, "Digio search");
    const list = res.json<{ mandates?: DigioMandate[] }>().mandates ?? [];
    if (list.length > 1)
      throw vendorError(PAYMENTS, ADAPTER, 502, "two mandates carry one idempotency reference");
    return list[0] ?? null;
  }

  async mandateStatus(mandateId: string): Promise<Mandate> {
    await this.guard("mandateStatus");
    return this.toMandate(await this.read(mandateId));
  }

  async cancelMandate(
    mandateId: string,
    reason: string,
    authorisation: MoneyAuthorisation,
    idempotencyKey: string,
  ): Promise<Mandate> {
    assertMoneyCall(PAYMENTS, authorisation, idempotencyKey);
    await this.guard("cancelMandate");
    const now = this.toMandate(await this.read(mandateId));
    // Cancelling twice is the same cancellation: the key's retry reads it back.
    if (now.state === "cancelled") return now;
    if (now.state === "rejected" || now.state === "expired")
      throw refused(`the mandate is ${now.state}`, "invalid_state");
    await this.consume(authorisation.approvalRef, {
      operation: "cancel",
      mandate: mandateId,
      maxAmountMinor: now.maxAmountMinor,
    });
    const res = await this.egress(
      `${this.base}/v3/client/mandate/${encodeURIComponent(mandateId)}/cancel`,
      {
        method: "POST",
        headers: await this.headers(),
        body: JSON.stringify({ reason: reason.slice(0, 200) }),
      },
    );
    if (res.status !== 200) throw vendorError(PAYMENTS, ADAPTER, res.status, "Digio cancel");
    return this.toMandate(await this.read(mandateId));
  }

  /** Digio's callback is only a trigger: the mandate returned is the one read back from the API. */
  async handleWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    meta?: WebhookRequestMeta,
  ): Promise<Mandate> {
    if (!(await this.o.enabled()))
      throw refused(
        "the Digio mandate adapter is off (int.payments.digio_mandate.enabled)",
        "adapter_disabled",
      );
    await checkSharedSecret(
      PAYMENTS,
      ADAPTER,
      { secret: this.o.webhookToken },
      headers,
      meta?.sourceIp,
      meta?.query,
    );
    const body = parseJson(PAYMENTS, ADAPTER, rawBody) as {
      payload?: { mandate?: { id?: unknown } };
      mandate_id?: unknown;
    };
    const id = body.payload?.mandate?.id ?? body.mandate_id;
    if (typeof id !== "string" || !id) throw webhookRefused(PAYMENTS, ADAPTER, "no mandate id");
    return this.toMandate(await this.read(id));
  }

  async health(): Promise<PortHealth> {
    const started = performance.now();
    let status: PortHealth["status"] = "up";
    try {
      await this.guard("mandateStatus", { healthProbe: true });
      // An unknown id: 404 proves the credentials and the route; 401/403/5xx are down.
      const res = await this.egress(`${this.base}/v3/client/mandate/ipb-health`, {
        method: "GET",
        headers: await this.headers(),
      });
      if (res.status >= 500 || res.status === 401 || res.status === 403) status = "down";
    } catch {
      status = "down";
    }
    return {
      status,
      latency_ms: Math.round(performance.now() - started),
      checked_at: new Date().toISOString(),
    };
  }
}
