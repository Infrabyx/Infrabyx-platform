// EMAIL alternative `brevo` (PL2 plan §6.10, D-08, PR-007): the Brevo transactional API v3 over the
// egress client. GLOBAL (EU processing): bodies are INTERNAL and recipients go for delivery only,
// so the instance must carry a DPA reference (IPB-DEV-05).
// - Idempotency: the key is sent as Brevo's `idempotencyKey` (a UUID derived from the key) and as
//   an `ipb_idem_*` tag, which `lookup` finds through the event log (plan §3.5).
// - Failover target only for brands whose sending domain is authenticated (DKIM) on Brevo;
//   otherwise the send is refused before any request and the caller queues and alerts.
// - Webhooks have no vendor signature: our C-19 secret as bearer or URL credentials, plus Brevo's
//   published source ranges.
// - Brevo blocks hard bounces and spam complaints itself; a manual suppression would need a contact
//   record at Brevo, beyond delivery-only, so it is refused (PL2-D-64).
// - `verifyDomain` is emulated: it reads the domain's status and the DNS records the owner adds.
// Vendor facts not yet proven against the live API are marked [VERIFY] (sandbox leg, PL2 plan §3.11).
import { PortError } from "@infrabyx/contracts/errors";
import {
  EmailMessage,
  type AdapterDescriptor,
  type EmailEvent,
  type EmailPort,
  type IdempotencyLookup,
  type LookupResult,
  type PortCall,
  type PortHealth,
  type StoragePort,
  type WebhookRequestMeta,
} from "@infrabyx/contracts/ports";
import { sha256, sha256Hex, toHex } from "@infrabyx/crypto";
import { createEgress, type EgressResponse } from "../core/http.js";
import {
  assertBodyClass,
  checkSharedSecret,
  loadAttachments,
  parseJson,
  vendorError,
  type SharedSecretAuth,
} from "../messaging/common.js";

/** Brevo's published webhook source ranges [VERIFY against help.brevo.com before production]. */
export const BREVO_WEBHOOK_CIDRS = ["1.179.112.0/20", "172.246.240.0/20"] as const;

export interface BrevoBrand {
  /** `int.email.from.<brand>`; its domain must be authenticated on Brevo. */
  from: string;
  fromName?: string;
  replyTo?: string;
  /** Brevo template id for each logical template of the brand. */
  templates: Readonly<Record<string, number>>;
}

export interface BrevoEmailOptions {
  /** `secrets/<env>/email/brevo/api_key` */
  apiKey: string | (() => Promise<string> | string);
  brands: Readonly<Record<string, BrevoBrand>>;
  /** Vendor Assurance Room reference of the DPA (IPB-DEV-05); required for recipients. */
  dpaRef: string;
  /** `secrets/<env>/email/brevo/webhook_bearer` and the source ranges (default: Brevo's). */
  webhook: SharedSecretAuth;
  storage?: StoragePort;
  /** Sandbox leg: validate and drop (`X-Sib-Sandbox: drop`), never send. */
  sandbox?: boolean;
  /** Tests only: the Brevo stub. */
  baseUrl?: string;
  allowLoopbackHttp?: boolean;
  now?: () => number;
}

const BASE = "https://api.brevo.com/v3";
const DOMAIN_TTL_MS = 10 * 60_000;

/** Brevo wants a UUID; derive a stable one from our key (version nibble 4, variant 10). */
export function brevoIdempotencyKey(key: string): string {
  const h = sha256(`ipb/brevo-idempotency/${key}`).slice(0, 16);
  h[6] = (h[6]! & 0x0f) | 0x40;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = toHex(h);
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export const brevoIdempotencyTag = (key: string): string =>
  `ipb_idem_${sha256Hex(key).slice(0, 32)}`;

const EVENT_TYPES: Readonly<Record<string, EmailEvent["type"]>> = {
  request: "sent",
  delivered: "delivered",
  hard_bounce: "bounced",
  soft_bounce: "delayed",
  deferred: "delayed",
  spam: "complained",
  blocked: "rejected",
  invalid_email: "rejected",
  error: "rejected",
  opened: "opened",
  unique_opened: "opened",
  click: "clicked",
};

interface BrevoWebhookEvent {
  event?: string;
  email?: string;
  "message-id"?: string;
  ts_event?: number;
  ts_epoch?: number;
  date?: string;
}

export class BrevoEmail implements EmailPort, IdempotencyLookup {
  readonly descriptor: AdapterDescriptor;
  private readonly egress;
  private readonly domains = new Map<string, { authenticated: boolean; at: number }>();

  constructor(private readonly o: BrevoEmailOptions) {
    if (!o.dpaRef)
      throw new PortError("IPB-PORT-005", "EMAIL", {
        adapter: "brevo",
        detail: "brevo is GLOBAL and receives recipients: a dpa_ref is required (IPB-DEV-05)",
      });
    this.descriptor = {
      port: "EMAIL",
      adapter: "brevo",
      residency: "GLOBAL",
      maxDataClass: "INTERNAL",
      dpaRef: o.dpaRef,
      capabilities: { verifyDomain: "emulated", suppress: "emulated", sendRaw: "unsupported" },
    };
    const base = new URL(o.baseUrl ?? BASE);
    this.egress = createEgress({
      port: "EMAIL",
      adapter: "brevo",
      allow: ["api.brevo.com"],
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
    if (base.hostname !== "api.brevo.com" && !o.allowLoopbackHttp)
      throw new PortError("IPB-PORT-005", "EMAIL", {
        adapter: "brevo",
        detail: "baseUrl other than api.brevo.com is for tests only",
      });
  }

  private get base(): string {
    return (this.o.baseUrl ?? BASE).replace(/\/$/, "");
  }

  private async call(method: string, path: string, body?: unknown): Promise<EgressResponse> {
    return this.egress(`${this.base}${path}`, {
      method,
      headers: {
        "api-key": typeof this.o.apiKey === "string" ? this.o.apiKey : await this.o.apiKey(),
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  private brand(name: string): BrevoBrand {
    const b = this.o.brands[name];
    if (!b)
      throw new PortError("IPB-PORT-001", "EMAIL", {
        adapter: "brevo",
        detail: `brand ${name} has no sender configured on brevo`,
      });
    return b;
  }

  private async domainAuthenticated(domain: string): Promise<boolean> {
    const now = this.o.now?.() ?? Date.now();
    const c = this.domains.get(domain);
    if (c && now - c.at < DOMAIN_TTL_MS) return c.authenticated;
    const r = await this.call("GET", `/senders/domains/${encodeURIComponent(domain)}`);
    if (r.status === 404) return false;
    if (r.status >= 300) throw vendorError("EMAIL", "brevo", r.status, "domain status");
    const authenticated = r.json<{ authenticated?: boolean }>().authenticated === true;
    this.domains.set(domain, { authenticated, at: now });
    return authenticated;
  }

  async send(message: EmailMessage, call?: PortCall): Promise<{ messageId: string }> {
    assertBodyClass(this.descriptor, call);
    const m = EmailMessage.parse(message);
    const b = this.brand(m.brand);
    const templateId = b.templates[m.template];
    if (templateId === undefined)
      throw new PortError("IPB-PORT-001", "EMAIL", {
        adapter: "brevo",
        detail: `template ${m.template} is not mapped for brand ${m.brand} on brevo`,
        meta: { reason: "invalid_request", definite: true },
      });
    const domain = b.from.slice(b.from.lastIndexOf("@") + 1);
    if (!(await this.domainAuthenticated(domain)))
      throw new PortError("IPB-PORT-001", "EMAIL", {
        adapter: "brevo",
        detail: `the sending domain of brand ${m.brand} is not authenticated (DKIM) on brevo`,
        meta: { reason: "dkim_not_provisioned", definite: true },
      });
    const files = await loadAttachments(this.descriptor, m.attachments, this.o.storage);
    const headers: Record<string, string> = {};
    if (call?.idempotencyKey) headers.idempotencyKey = brevoIdempotencyKey(call.idempotencyKey);
    if (this.o.sandbox) headers["X-Sib-Sandbox"] = "drop";
    const tags = [
      `ipb_brand_${m.brand}`,
      ...Object.entries(m.tags ?? {}).map(([k, v]) => `${k}:${v}`),
      ...(call?.idempotencyKey ? [brevoIdempotencyTag(call.idempotencyKey)] : []),
    ];
    const r = await this.call("POST", "/smtp/email", {
      sender: { email: b.from, ...(b.fromName ? { name: b.fromName } : {}) },
      to: m.to.map((email) => ({ email })),
      ...(m.cc ? { cc: m.cc.map((email) => ({ email })) } : {}),
      ...(b.replyTo ? { replyTo: { email: b.replyTo } } : {}),
      templateId,
      params: m.vars,
      tags,
      ...(Object.keys(headers).length ? { headers } : {}),
      ...(files.length
        ? {
            attachment: files.map((f) => ({
              name: f.filename,
              content: Buffer.from(f.body).toString("base64"),
            })),
          }
        : {}),
    });
    if (r.status >= 300) throw vendorError("EMAIL", "brevo", r.status, "send");
    return { messageId: r.json<{ messageId?: string }>().messageId ?? "" };
  }

  async sendRaw(_mime: Uint8Array, _call?: PortCall): Promise<{ messageId: string }> {
    throw new PortError("IPB-PORT-001", "EMAIL", {
      adapter: "brevo",
      detail: "brevo's API takes structured messages, not raw MIME",
      meta: { reason: "unsupported" },
    });
  }

  async getStatus(messageId: string): Promise<{ status: string; at?: string }> {
    const q = new URLSearchParams({ messageId, limit: "50", days: "30", sort: "desc" });
    const r = await this.call("GET", `/smtp/statistics/events?${q}`);
    if (r.status >= 300) throw vendorError("EMAIL", "brevo", r.status, "status");
    const events = r.json<{ events?: Array<{ event?: string; date?: string }> }>().events ?? [];
    const latest = events[0];
    if (!latest)
      throw new PortError("IPB-PORT-001", "EMAIL", {
        adapter: "brevo",
        detail: "no such message",
        meta: { reason: "not_found" },
      });
    return { status: latest.event ?? "unknown", ...(latest.date ? { at: latest.date } : {}) };
  }

  /** Router lookup for a pending send (plan §3.5): the idempotency tag in the event log. */
  async lookup(operation: string, idempotencyKey: string): Promise<LookupResult<unknown>> {
    if (operation !== "send") return { status: "unknown", reason: `no lookup for ${operation}` };
    const q = new URLSearchParams({
      tags: JSON.stringify([brevoIdempotencyTag(idempotencyKey)]),
      event: "requests",
      days: "2",
      limit: "1",
    });
    const r = await this.call("GET", `/smtp/statistics/events?${q}`).catch(() => null);
    if (!r || r.status >= 300) return { status: "unknown", reason: "brevo event log unavailable" };
    const hit = r.json<{ events?: Array<{ messageId?: string }> }>().events?.[0];
    // Brevo de-duplicates a resend with the same idempotencyKey, so "none yet" is safe to resend.
    return hit?.messageId
      ? { status: "found", result: { messageId: hit.messageId } }
      : { status: "absent" };
  }

  async verifyWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    meta?: WebhookRequestMeta,
  ): Promise<EmailEvent[]> {
    await checkSharedSecret(
      "EMAIL",
      "brevo",
      { sourceCidrs: BREVO_WEBHOOK_CIDRS, ...this.o.webhook },
      headers,
      meta?.sourceIp,
    );
    const body = parseJson("EMAIL", "brevo", rawBody) as BrevoWebhookEvent | BrevoWebhookEvent[];
    const out: EmailEvent[] = [];
    for (const e of Array.isArray(body) ? body : [body]) {
      const type = e.event ? EVENT_TYPES[e.event] : undefined;
      const messageId = e["message-id"];
      if (!type || !messageId) continue;
      const tsMs = e.ts_epoch ?? (e.ts_event ? e.ts_event * 1000 : Date.parse(e.date ?? ""));
      // Brevo's `id` is the webhook's, not the event's; the event is its message, kind, time and address.
      const vendorEventId = sha256Hex(`${messageId}|${e.event}|${tsMs}|${e.email ?? ""}`).slice(
        0,
        40,
      );
      out.push({
        vendorEventId,
        messageId,
        type,
        ...((type === "bounced" || type === "complained") && e.email ? { recipient: e.email } : {}),
        at: Number.isFinite(tsMs) ? new Date(tsMs).toISOString() : new Date().toISOString(),
      });
    }
    return out;
  }

  async verifyDomain(domain: string): Promise<{
    verified: boolean;
    dnsRecords: Array<{ type: string; name: string; value: string }>;
  }> {
    const r = await this.call("GET", `/senders/domains/${encodeURIComponent(domain)}`);
    if (r.status >= 300) throw vendorError("EMAIL", "brevo", r.status, "verifyDomain");
    const d = r.json<{
      authenticated?: boolean;
      verified?: boolean;
      dns_records?: Record<string, { host_name?: string; type?: string; value?: string }>;
    }>();
    this.domains.set(domain, {
      authenticated: d.authenticated === true,
      at: this.o.now?.() ?? Date.now(),
    });
    return {
      verified: d.authenticated === true && d.verified === true,
      dnsRecords: Object.values(d.dns_records ?? {})
        .filter((x) => x.host_name && x.type && x.value)
        .map((x) => ({ type: x.type!, name: x.host_name!, value: x.value! })),
    };
  }

  async suppress(_address: string, reason: "bounce" | "complaint" | "manual"): Promise<void> {
    if (reason === "manual")
      throw new PortError("IPB-PORT-001", "EMAIL", {
        adapter: "brevo",
        detail: "a manual suppression needs a contact record at brevo (beyond delivery-only)",
        meta: { reason: "unsupported" },
      });
    // Hard bounces and complaints are blocked by Brevo itself; nothing to send.
  }

  async health(): Promise<PortHealth> {
    const t0 = Date.now();
    let status: PortHealth["status"];
    try {
      const r = await this.call("GET", "/account");
      status = r.status === 200 ? "up" : r.status === 429 ? "degraded" : "down";
    } catch {
      status = "down";
    }
    return { status, latency_ms: Date.now() - t0, checked_at: new Date().toISOString() };
  }
}
