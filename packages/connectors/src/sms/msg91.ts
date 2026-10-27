// SMS reference `msg91` (PL2 plan §6.11, OWN-07, D-07): the MSG91 Flow API v5 over the egress
// client, with the DLT template mapping checked before any request. IN residency; bodies INTERNAL
// (OTP, references; never REGULATED).
// - The idempotency key becomes the per-recipient `CRQID`, which MSG91 echoes in delivery reports.
//   MSG91 documents no SMS lookup by it, so a send left pending is sent again (at-least-once).
// - Delivery reports ("Webhook (New)", JSON, one per number) carry no vendor signature: MSG91 sends
//   the configured `Authorization: Bearer <our C-19 secret>` header.
// - There is no SMS status API; status comes from delivery reports (`getStatus` unsupported).
// Vendor facts not yet proven against the live API are marked [VERIFY] (sandbox leg, plan §3.11).
import { PortError } from "@infrabyx/contracts/errors";
import {
  SmsMessage,
  type AdapterDescriptor,
  type PortCall,
  type PortHealth,
  type SmsDeliveryReport,
  type SmsPort,
  type WebhookRequestMeta,
} from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";
import { createEgress, type EgressResponse } from "../core/http.js";
import {
  assertBodyClass,
  checkSharedSecret,
  parseJson,
  vendorError,
  type SharedSecretAuth,
} from "../messaging/common.js";
import { DltRegistry, msisdn, type DltOptions, type DltTemplate } from "./common.js";

export interface Msg91Flow {
  /** MSG91 template (flow) id mapped to the DLT template in the MSG91 panel. */
  flowId: string;
  /** Variable names of the MSG91 template, in DLT order (default var1, var2, …) [VERIFY]. */
  vars?: readonly string[];
}

export interface Msg91SmsOptions extends DltOptions {
  /** `secrets/<env>/sms/msg91/auth_key` (MSG_SMS_API_KEY). */
  authKey: string | (() => Promise<string> | string);
  /** Logical template id → MSG91 flow. */
  flows: Readonly<Record<string, Msg91Flow>>;
  /** Our C-19 secret for the delivery-report webhook. */
  webhook: SharedSecretAuth;
  /** Balance below this many SMS credits reports `degraded` (default 500). */
  lowBalance?: number;
  /** Tests only: the MSG91 stub. */
  baseUrl?: string;
  allowLoopbackHttp?: boolean;
}

const BASE = "https://control.msg91.com";

/** CRQID: alphanumeric, at most 52 characters, echoed in delivery reports. */
export const msg91Crqid = (idempotencyKey: string): string =>
  sha256Hex(idempotencyKey).slice(0, 40);

const DLR_STATUS: Readonly<Record<string, SmsDeliveryReport["status"]>> = {
  "1": "delivered",
  "2": "failed",
  "9": "rejected",
  "16": "rejected",
  "17": "rejected",
  "20": "rejected",
  "25": "rejected",
};

export class Msg91Sms implements SmsPort {
  readonly descriptor: AdapterDescriptor = {
    port: "SMS",
    adapter: "msg91",
    residency: "IN",
    maxDataClass: "INTERNAL",
    capabilities: { getStatus: "unsupported", registerTemplate: "emulated" },
  };
  private readonly dlt: DltRegistry;
  private readonly egress;

  constructor(private readonly o: Msg91SmsOptions) {
    this.dlt = new DltRegistry(this.descriptor, o);
    this.egress = createEgress({
      port: "SMS",
      adapter: "msg91",
      allow: ["control.msg91.com"],
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
  }

  private async call(method: string, path: string, body?: unknown): Promise<EgressResponse> {
    const key = typeof this.o.authKey === "string" ? this.o.authKey : await this.o.authKey();
    return this.egress(`${(this.o.baseUrl ?? BASE).replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        authkey: key,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async send(message: SmsMessage, call?: PortCall): Promise<{ messageId: string }> {
    assertBodyClass(this.descriptor, call);
    const m = SmsMessage.parse(message);
    const { template } = this.dlt.check(m);
    const flow = this.o.flows[template.templateId];
    if (!flow)
      throw new PortError("IPB-PORT-001", "SMS", {
        adapter: "msg91",
        detail: `template ${template.templateId} has no MSG91 flow`,
        meta: { reason: "template_not_registered", definite: true },
      });
    const names = flow.vars ?? m.vars.map((_, i) => `var${i + 1}`);
    const recipient: Record<string, string> = { mobiles: msisdn(m.to) };
    m.vars.forEach((v, i) => (recipient[names[i] ?? `var${i + 1}`] = v));
    if (call?.idempotencyKey) recipient.CRQID = msg91Crqid(call.idempotencyKey);
    const r = await this.call("POST", "/api/v5/flow", {
      template_id: flow.flowId,
      sender: m.senderId,
      short_url: "0",
      recipients: [recipient],
    });
    if (r.status >= 300) throw vendorError("SMS", "msg91", r.status, "send");
    // MSG91 can answer 200 with `type: "error"`: a definite refusal [VERIFY codes].
    const b = r.json<{ type?: string; message?: string; code?: string | number }>();
    if (b.type !== "success" || !b.message)
      throw vendorError("SMS", "msg91", String(b.code) === "207" ? 401 : 400, "send");
    return { messageId: b.message };
  }

  async getStatus(_id: string): Promise<{ status: string; at?: string }> {
    throw new PortError("IPB-PORT-001", "SMS", {
      adapter: "msg91",
      detail: "MSG91 reports SMS status through delivery reports only",
      meta: { reason: "unsupported" },
    });
  }

  async registerTemplate(dlt: DltTemplate): Promise<void> {
    this.dlt.register(dlt);
  }

  async verifyWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    meta?: WebhookRequestMeta,
  ): Promise<SmsDeliveryReport[]> {
    await checkSharedSecret("SMS", "msg91", this.o.webhook, headers, meta?.sourceIp);
    const body = parseJson("SMS", "msg91", rawBody) as Dlr | Dlr[];
    const out: SmsDeliveryReport[] = [];
    for (const d of Array.isArray(body) ? body : [body]) {
      const status = DLR_STATUS[String(d.status ?? "")];
      // Status 0 ("sent") is not final; anything unknown is a failure.
      if (!d.requestId || String(d.status) === "0") continue;
      out.push({
        vendorEventId: `${d.requestId}:${d.telNum ?? ""}:${d.status}`,
        messageId: d.requestId,
        status: status ?? "failed",
        at: parseTime(d.deliveryTime),
      });
    }
    return out;
  }

  async health(): Promise<PortHealth> {
    const t0 = Date.now();
    let status: PortHealth["status"];
    try {
      // Balance of the transactional route (type 4); the key goes as a header, never in the URL [VERIFY].
      const r = await this.call("GET", "/api/balance.php?type=4");
      const balance = Number.parseFloat(r.text());
      status =
        r.status !== 200 || !Number.isFinite(balance)
          ? "down"
          : balance < (this.o.lowBalance ?? 500)
            ? "degraded"
            : "up";
    } catch {
      status = "down";
    }
    return { status, latency_ms: Date.now() - t0, checked_at: new Date().toISOString() };
  }
}

interface Dlr {
  requestId?: string;
  telNum?: string;
  status?: string | number;
  deliveryTime?: string;
  CRQID?: string;
}

const parseTime = (s?: string): string => {
  const t = s ? Date.parse(s.includes("T") ? s : s.replace(" ", "T") + "+05:30") : Number.NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
};
