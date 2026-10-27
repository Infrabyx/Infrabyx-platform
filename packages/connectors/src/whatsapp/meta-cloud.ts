// WHATSAPP alternative `meta-cloud` (PL2 plan §6.12): the Meta WhatsApp Cloud API (Graph API)
// direct, the IPB catalogue reference. GLOBAL: bodies INTERNAL, recipients for delivery only under
// the DPA on file (IPB-DEV-05). Webhooks verify `X-Hub-Signature-256` over the raw body (C-13);
// the subscription handshake compares the verify token in constant time. No failover between BSPs
// (the WABA number is not portable on the fly); the channel falls back to SMS or EMAIL in NOTIFY.
// Meta has no idempotency key or message search: a send left pending is sent again.
import { PortError } from "@infrabyx/contracts/errors";
import {
  WhatsappSessionMessage,
  WhatsappTemplateMessage,
  type AdapterDescriptor,
  type PortCall,
  type PortHealth,
  type WebhookRequestMeta,
  type WhatsappEvent,
  type WhatsappPort,
} from "@infrabyx/contracts/ports";
import { verifyMetaSignature, verifyWebhookSecret } from "@infrabyx/crypto";
import { createEgress, type EgressResponse } from "../core/http.js";
import {
  assertBodyClass,
  header,
  parseJson,
  vendorError,
  webhookRefused,
} from "../messaging/common.js";
import { msisdn } from "../sms/common.js";
import {
  WhatsappPolicy,
  toCategory,
  toStatus,
  type TemplateCategory,
  type TemplateStatus,
  type WhatsappPolicyOptions,
} from "./common.js";

export interface MetaCloudOptions extends WhatsappPolicyOptions {
  /** `secrets/<env>/whatsapp/meta-cloud/access_token` (MSG_WHATSAPP_ACCESS_TOKEN_REF). */
  accessToken: string | (() => Promise<string> | string);
  /** `secrets/<env>/whatsapp/meta-cloud/app_secret`: webhook signatures. */
  appSecret: string | (() => Promise<string> | string);
  /** `…/webhook_verify_token` (MSG_WHATSAPP_VERIFY_TOKEN): subscription handshake. */
  verifyToken: string | (() => Promise<string> | string);
  /** `int.whatsapp.phone_id.<brand>` and `int.whatsapp.waba_id.<brand>`. */
  phoneNumberId: string;
  wabaId: string;
  dpaRef: string;
  graphVersion?: string;
  /** Tests only: the Graph API stub. */
  baseUrl?: string;
  allowLoopbackHttp?: boolean;
}

const BASE = "https://graph.facebook.com";
const MEDIA_MAX_BYTES = 100 * 1024 * 1024;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const OUTSIDE_WINDOW = new Set([131047]);
const read = async (v: string | (() => Promise<string> | string)) =>
  typeof v === "string" ? v : v();

interface GraphError {
  error?: { code?: number; message?: string };
}

export class MetaCloudWhatsapp implements WhatsappPort {
  readonly descriptor: AdapterDescriptor;
  private readonly egress;
  private readonly policy: WhatsappPolicy;

  constructor(private readonly o: MetaCloudOptions) {
    if (!o.dpaRef)
      throw new PortError("IPB-PORT-005", "WHATSAPP", {
        adapter: "meta-cloud",
        detail: "meta-cloud is GLOBAL and receives recipients: a dpa_ref is required (IPB-DEV-05)",
      });
    this.descriptor = {
      port: "WHATSAPP",
      adapter: "meta-cloud",
      residency: "GLOBAL",
      maxDataClass: "INTERNAL",
      dpaRef: o.dpaRef,
      capabilities: { getConversationCost: "emulated" },
    };
    this.policy = new WhatsappPolicy(this.descriptor, o);
    this.egress = createEgress({
      port: "WHATSAPP",
      adapter: "meta-cloud",
      allow: ["graph.facebook.com"],
      maxBytes: 1024 * 1024,
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
  }

  private url(path: string): string {
    return `${(this.o.baseUrl ?? BASE).replace(/\/$/, "")}/${this.o.graphVersion ?? "v26.0"}${path}`;
  }

  private async graph(
    method: string,
    path: string,
    body?: unknown,
    raw?: { body: BodyInit; contentType?: string },
  ): Promise<EgressResponse> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${await read(this.o.accessToken)}`,
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (raw?.contentType) headers["content-type"] = raw.contentType;
    return this.egress(this.url(path), {
      method,
      headers,
      ...(raw ? { body: raw.body } : body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  private fail(r: EgressResponse, what: string): never {
    let code: number | undefined;
    try {
      code = r.json<GraphError>().error?.code;
    } catch {
      code = undefined;
    }
    if (code !== undefined && OUTSIDE_WINDOW.has(code)) throw this.policy.outsideWindow();
    // 190: access token invalid or expired.
    throw vendorError("WHATSAPP", "meta-cloud", code === 190 ? 401 : r.status, what);
  }

  private async messages(payload: Record<string, unknown>): Promise<{ messageId: string }> {
    const r = await this.graph("POST", `/${this.o.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      ...payload,
    });
    if (r.status >= 300) this.fail(r, "send");
    return { messageId: r.json<{ messages?: Array<{ id?: string }> }>().messages?.[0]?.id ?? "" };
  }

  async sendTemplate(
    message: WhatsappTemplateMessage,
    call?: PortCall,
  ): Promise<{ messageId: string }> {
    assertBodyClass(this.descriptor, call);
    const m = WhatsappTemplateMessage.parse(message);
    this.policy.assertCategory(
      await this.policy.category(m.templateName, () => this.getTemplateStatus(m.templateName)),
    );
    return this.messages({
      to: msisdn(m.to),
      type: "template",
      template: { name: m.templateName, language: { code: m.lang }, components: m.components },
    });
  }

  async sendSession(
    message: WhatsappSessionMessage,
    call?: PortCall,
  ): Promise<{ messageId: string }> {
    assertBodyClass(this.descriptor, call);
    const m = WhatsappSessionMessage.parse(message);
    await this.policy.assertSessionOpen(m.to);
    return this.messages({
      to: msisdn(m.to),
      type: "text",
      text: { body: m.text, preview_url: false },
    });
  }

  async uploadMedia(
    file: { body: Uint8Array; contentType: string },
    call?: PortCall,
  ): Promise<{ mediaId: string }> {
    assertBodyClass(this.descriptor, call);
    const limit = file.contentType.startsWith("image/") ? IMAGE_MAX_BYTES : MEDIA_MAX_BYTES;
    if (file.body.byteLength > limit)
      throw new PortError("IPB-PORT-003", "WHATSAPP", {
        adapter: "meta-cloud",
        detail: `media exceeds ${limit / 1024 / 1024} MB`,
      });
    const form = new FormData();
    form.set("messaging_product", "whatsapp");
    form.set("type", file.contentType);
    form.set("file", new Blob([new Uint8Array(file.body)], { type: file.contentType }), "upload");
    const r = await this.graph("POST", `/${this.o.phoneNumberId}/media`, undefined, { body: form });
    if (r.status >= 300) this.fail(r, "uploadMedia");
    return { mediaId: r.json<{ id?: string }>().id ?? "" };
  }

  async getTemplateStatus(
    name: string,
  ): Promise<{ status: TemplateStatus; category: TemplateCategory }> {
    const q = new URLSearchParams({ name, fields: "name,status,category,language", limit: "10" });
    const r = await this.graph("GET", `/${this.o.wabaId}/message_templates?${q}`);
    if (r.status >= 300) this.fail(r, "getTemplateStatus");
    const t = r
      .json<{ data?: Array<{ name?: string; status?: string; category?: string }> }>()
      .data?.find((x) => x.name === name);
    if (!t)
      throw new PortError("IPB-PORT-001", "WHATSAPP", {
        adapter: "meta-cloud",
        detail: `no template named ${name}`,
        meta: { reason: "not_found", definite: true },
      });
    return { status: toStatus(t.status), category: toCategory(t.category) };
  }

  async submitTemplate(spec: {
    name: string;
    category: TemplateCategory;
    lang: string;
    body: string;
  }): Promise<void> {
    this.policy.assertCategory(spec.category);
    const r = await this.graph("POST", `/${this.o.wabaId}/message_templates`, {
      name: spec.name,
      category: spec.category.toUpperCase(),
      language: spec.lang,
      components: [{ type: "BODY", text: spec.body }],
    });
    if (r.status >= 300) this.fail(r, "submitTemplate");
  }

  /** Subscription handshake: the challenge to echo, or null (answer 403). */
  async verifyChallenge(query: string): Promise<string | null> {
    const p = new URLSearchParams(query);
    const ok =
      p.get("hub.mode") === "subscribe" &&
      verifyWebhookSecret(await read(this.o.verifyToken), p.get("hub.verify_token") ?? "");
    return ok ? (p.get("hub.challenge") ?? null) : null;
  }

  async verifyWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    _meta?: WebhookRequestMeta,
  ): Promise<WhatsappEvent[]> {
    const sig = header(headers, "x-hub-signature-256") ?? "";
    if (!verifyMetaSignature(await read(this.o.appSecret), rawBody, sig))
      throw webhookRefused("WHATSAPP", "meta-cloud", "X-Hub-Signature-256 does not verify");
    const b = parseJson("WHATSAPP", "meta-cloud", rawBody) as MetaWebhook;
    const out: WhatsappEvent[] = [];
    for (const entry of b.entry ?? [])
      for (const change of entry.changes ?? []) {
        const v = change.value ?? {};
        for (const s of v.statuses ?? []) {
          const type = (["sent", "delivered", "read", "failed"] as const).find(
            (t) => t === s.status,
          );
          if (!type || !s.id) continue;
          out.push({
            vendorEventId: `${s.id}:${s.status}:${s.timestamp ?? ""}`,
            messageId: s.id,
            type,
            at: epoch(s.timestamp),
            ...(s.pricing?.category ? { pricingCategory: s.pricing.category } : {}),
            ...(s.errors?.[0]?.code !== undefined ? { errorCode: String(s.errors[0].code) } : {}),
          });
        }
        for (const m of v.messages ?? [])
          if (m.id)
            out.push({
              vendorEventId: m.id,
              messageId: m.id,
              type: "inbound",
              at: epoch(m.timestamp),
            });
      }
    return out;
  }

  async getConversationCost(
    category: TemplateCategory,
  ): Promise<{ currency: string; amountMinor: number }> {
    return this.policy.cost(category);
  }

  async health(): Promise<PortHealth> {
    const t0 = Date.now();
    let status: PortHealth["status"];
    try {
      const r = await this.graph("GET", `/${this.o.phoneNumberId}?fields=quality_rating`);
      const q = r.status === 200 ? r.json<{ quality_rating?: string }>().quality_rating : undefined;
      status =
        q === "GREEN" || q === "UNKNOWN" || q === "NA"
          ? "up"
          : q === "YELLOW"
            ? "degraded"
            : "down";
    } catch {
      status = "down";
    }
    return { status, latency_ms: Date.now() - t0, checked_at: new Date().toISOString() };
  }
}

interface MetaWebhook {
  entry?: Array<{
    changes?: Array<{
      value?: {
        statuses?: Array<{
          id?: string;
          status?: string;
          timestamp?: string;
          pricing?: { category?: string };
          errors?: Array<{ code?: number }>;
        }>;
        messages?: Array<{ id?: string; timestamp?: string }>;
      };
    }>;
  }>;
}

const epoch = (s?: string): string => {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
};
