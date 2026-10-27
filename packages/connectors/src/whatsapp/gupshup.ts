// WHATSAPP reference `gupshup` (PL2 plan §6.12, OWN-07, OWN-08, D-07): the Gupshup BSP API
// (api.gupshup.io, `apikey` header, form posts). GLOBAL: bodies INTERNAL, recipients for delivery
// only under the DPA on file (IPB-DEV-05).
// - Templates are sent by Gupshup template id, looked up (cached) from the app's template list,
//   which also gives the category for the marketing check.
// - Webhooks (v2 envelope) carry no signature: the subscription URL carries our C-19 secret as
//   `ipb_token` (ingress logs redact it).
// - The non-partner API documents no media upload: media goes as a link (`uploadMedia`
//   unsupported; CONFIDENTIAL media is a secure link in any case).
// - No idempotency key or lookup: a send left pending is sent again.
// Field names not yet proven against the live API are marked [VERIFY] (sandbox leg, plan §3.11).
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
import { createEgress, type EgressResponse } from "../core/http.js";
import {
  assertBodyClass,
  checkSharedSecret,
  parseJson,
  vendorError,
  type SharedSecretAuth,
} from "../messaging/common.js";
import { msisdn } from "../sms/common.js";
import {
  WhatsappPolicy,
  bodyParams,
  toCategory,
  toStatus,
  type TemplateCategory,
  type TemplateStatus,
  type WhatsappPolicyOptions,
} from "./common.js";

export interface GupshupWhatsappOptions extends WhatsappPolicyOptions {
  /** `secrets/<env>/whatsapp/gupshup/access_token` (the app's API key). */
  apiKey: string | (() => Promise<string> | string);
  /** Gupshup app id and app name (`src.name`). */
  appId: string;
  appName: string;
  /** Business number, E.164 (`int.whatsapp.brand_number`). */
  source: string;
  dpaRef: string;
  webhook: SharedSecretAuth;
  /** Tests only: the Gupshup stub. */
  baseUrl?: string;
  allowLoopbackHttp?: boolean;
}

const BASE = "https://api.gupshup.io";
const TEMPLATE_TTL_MS = 10 * 60_000;
const OUTSIDE_WINDOW = new Set(["470"]);

interface GupshupTemplate {
  id?: string;
  elementName?: string;
  status?: string;
  category?: string;
  languageCode?: string;
}

export class GupshupWhatsapp implements WhatsappPort {
  readonly descriptor: AdapterDescriptor;
  private readonly egress;
  private readonly policy: WhatsappPolicy;
  private list: { at: number; templates: GupshupTemplate[] } | null = null;

  constructor(private readonly o: GupshupWhatsappOptions) {
    if (!o.dpaRef)
      throw new PortError("IPB-PORT-005", "WHATSAPP", {
        adapter: "gupshup",
        detail: "gupshup is GLOBAL and receives recipients: a dpa_ref is required (IPB-DEV-05)",
      });
    this.descriptor = {
      port: "WHATSAPP",
      adapter: "gupshup",
      residency: "GLOBAL",
      maxDataClass: "INTERNAL",
      dpaRef: o.dpaRef,
      capabilities: { uploadMedia: "unsupported", getConversationCost: "emulated" },
    };
    this.policy = new WhatsappPolicy(this.descriptor, o);
    this.egress = createEgress({
      port: "WHATSAPP",
      adapter: "gupshup",
      allow: ["api.gupshup.io"],
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
  }

  private async call(
    method: string,
    path: string,
    form?: Record<string, string>,
  ): Promise<EgressResponse> {
    const key = typeof this.o.apiKey === "string" ? this.o.apiKey : await this.o.apiKey();
    return this.egress(`${(this.o.baseUrl ?? BASE).replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        apikey: key,
        accept: "application/json",
        ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(form ? { body: new URLSearchParams(form).toString() } : {}),
    });
  }

  private async templates(fresh = false): Promise<GupshupTemplate[]> {
    const now = this.o.now?.() ?? Date.now();
    if (!fresh && this.list && now - this.list.at < TEMPLATE_TTL_MS) return this.list.templates;
    const r = await this.call("GET", `/wa/app/${encodeURIComponent(this.o.appId)}/template`);
    if (r.status >= 300) throw vendorError("WHATSAPP", "gupshup", r.status, "template list");
    const templates = r.json<{ templates?: GupshupTemplate[] }>().templates ?? [];
    this.list = { at: now, templates };
    return templates;
  }

  private async template(name: string, lang?: string): Promise<GupshupTemplate> {
    const find = (ts: GupshupTemplate[]) =>
      ts.find(
        (t) => t.elementName === name && (!lang || !t.languageCode || t.languageCode === lang),
      );
    const t = find(await this.templates()) ?? find(await this.templates(true));
    if (!t?.id)
      throw new PortError("IPB-PORT-001", "WHATSAPP", {
        adapter: "gupshup",
        detail: `no template named ${name}`,
        meta: { reason: "not_found", definite: true },
      });
    return t;
  }

  private async post(path: string, form: Record<string, string>): Promise<{ messageId: string }> {
    const r = await this.call("POST", path, {
      channel: "whatsapp",
      source: msisdn(this.o.source),
      "src.name": this.o.appName,
      ...form,
    });
    const b = r.body.byteLength
      ? r.json<{ status?: string; messageId?: string; message?: string }>()
      : {};
    if (r.status >= 300 || b.status !== "submitted" || !b.messageId)
      throw vendorError("WHATSAPP", "gupshup", r.status >= 300 ? r.status : 400, "send");
    return { messageId: b.messageId };
  }

  async sendTemplate(
    message: WhatsappTemplateMessage,
    call?: PortCall,
  ): Promise<{ messageId: string }> {
    assertBodyClass(this.descriptor, call);
    const m = WhatsappTemplateMessage.parse(message);
    const category = await this.policy.category(m.templateName, () =>
      this.getTemplateStatus(m.templateName),
    );
    this.policy.assertCategory(category);
    const t = await this.template(m.templateName, m.lang);
    return this.post("/wa/api/v1/template/msg", {
      destination: msisdn(m.to),
      template: JSON.stringify({ id: t.id, params: bodyParams(m.components) }),
    });
  }

  async sendSession(
    message: WhatsappSessionMessage,
    call?: PortCall,
  ): Promise<{ messageId: string }> {
    assertBodyClass(this.descriptor, call);
    const m = WhatsappSessionMessage.parse(message);
    await this.policy.assertSessionOpen(m.to);
    return this.post("/wa/api/v1/msg", {
      destination: msisdn(m.to),
      message: JSON.stringify({ type: "text", text: m.text, previewUrl: false }),
    });
  }

  async uploadMedia(
    _file: { body: Uint8Array; contentType: string },
    _call?: PortCall,
  ): Promise<{ mediaId: string }> {
    throw new PortError("IPB-PORT-001", "WHATSAPP", {
      adapter: "gupshup",
      detail: "the Gupshup API has no media upload for this app type; send media as a link",
      meta: { reason: "unsupported" },
    });
  }

  async getTemplateStatus(
    name: string,
  ): Promise<{ status: TemplateStatus; category: TemplateCategory }> {
    const t = await this.template(name);
    return { status: toStatus(t.status), category: toCategory(t.category) };
  }

  async submitTemplate(spec: {
    name: string;
    category: TemplateCategory;
    lang: string;
    body: string;
  }): Promise<void> {
    this.policy.assertCategory(spec.category);
    const r = await this.call("POST", `/wa/app/${encodeURIComponent(this.o.appId)}/template`, {
      elementName: spec.name,
      languageCode: spec.lang,
      content: spec.body,
      category: spec.category.toUpperCase(),
      templateType: "TEXT",
      vertical: spec.category,
    });
    if (r.status >= 300) throw vendorError("WHATSAPP", "gupshup", r.status, "submitTemplate");
    this.list = null;
  }

  async verifyWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    meta?: WebhookRequestMeta,
  ): Promise<WhatsappEvent[]> {
    await checkSharedSecret(
      "WHATSAPP",
      "gupshup",
      this.o.webhook,
      headers,
      meta?.sourceIp,
      meta?.query,
    );
    const b = parseJson("WHATSAPP", "gupshup", rawBody) as GupshupWebhook;
    const at = b.timestamp ? new Date(b.timestamp).toISOString() : new Date().toISOString();
    const p = b.payload ?? {};
    if (b.type === "message" && p.id)
      return [{ vendorEventId: p.id, messageId: p.id, type: "inbound", at }];
    if (b.type !== "message-event" || !p.id) return [];
    const kind = p.type;
    const type = (["sent", "delivered", "read", "failed"] as const).find((t) => t === kind);
    if (!type) return []; // enqueued and deleted are not port events
    const code = p.payload?.code;
    return [
      {
        vendorEventId: `${p.gsId ?? p.id}:${kind}`,
        messageId: p.gsId ?? p.id,
        type,
        at,
        ...(code !== undefined ? { errorCode: String(code) } : {}),
      },
    ];
  }

  /** Whether a failed event means the 24-hour window had closed (Gupshup code 470). */
  static outsideWindow(e: WhatsappEvent): boolean {
    return e.type === "failed" && OUTSIDE_WINDOW.has(e.errorCode ?? "");
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
      await this.templates(true);
      status = "up";
    } catch {
      status = "down";
    }
    return { status, latency_ms: Date.now() - t0, checked_at: new Date().toISOString() };
  }
}

interface GupshupWebhook {
  app?: string;
  timestamp?: number;
  version?: number;
  type?: string;
  payload?: {
    id?: string;
    gsId?: string;
    type?: string;
    destination?: string;
    payload?: { code?: number | string; reason?: string; ts?: number };
  };
}
