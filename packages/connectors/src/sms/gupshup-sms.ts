// SMS alternative `gupshup-sms` (PL2 plan §6.11, OWN-07, D-07): Gupshup Enterprise SMS
// (GatewayAPI/rest) with the same DLT mapping as msg91. The rendered text must match the DLT
// template exactly, so it is built from the registered text.
// - Sent as an HTTPS POST form so the account password never sits in a URL [VERIFY: the docs show
//   GET; POST is the sandbox leg's first check].
// - No client reference or lookup is documented: a send left pending is sent again (at-least-once).
// - Delivery reports arrive by GET (query parameters) without a signature: the configured URL
//   carries our C-19 secret (at least 32 random bytes) as `ipb_token`, redacted by the telemetry
//   scrubber; a report is passed on only after its status is confirmed (`confirmStatus`), and
//   withheld without one (PL2-D-65).
// - No status or balance API is documented: `getStatus` is unsupported and health is reachability.
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
import { createEgress } from "../core/http.js";
import {
  assertBodyClass,
  checkSharedSecret,
  confirmed,
  vendorError,
  type ConfirmStatus,
  webhookRefused,
  type SharedSecretAuth,
} from "../messaging/common.js";
import { DltRegistry, msisdn, type DltOptions, type DltTemplate } from "./common.js";

export interface GupshupSmsOptions extends DltOptions {
  /** `secrets/<env>/sms/gupshup-sms/{user_id,password}` */
  credentials: () =>
    Promise<{ userId: string; password: string }> | { userId: string; password: string };
  webhook: SharedSecretAuth;
  /** Status confirmation before a report is acted on (PL2-D-65); without it reports are withheld. */
  confirmStatus?: ConfirmStatus;
  /** Told how many reports were withheld (unconfirmed). */
  onWithheld?: (n: number) => void;
  /** Tests only: the Gupshup SMS stub. */
  baseUrl?: string;
  allowLoopbackHttp?: boolean;
}

const BASE = "https://enterprise.smsgupshup.com";
const PATH = "/GatewayAPI/rest";

/** Gupshup error codes that mean the credentials were refused. */
const AUTH_ERRORS = new Set(["102", "105", "106"]);

export class GupshupSms implements SmsPort {
  readonly descriptor: AdapterDescriptor = {
    port: "SMS",
    adapter: "gupshup-sms",
    residency: "IN",
    maxDataClass: "INTERNAL",
    capabilities: { getStatus: "unsupported", registerTemplate: "emulated" },
  };
  private readonly dlt: DltRegistry;
  private readonly egress;

  constructor(private readonly o: GupshupSmsOptions) {
    this.dlt = new DltRegistry(this.descriptor, o);
    this.egress = createEgress({
      port: "SMS",
      adapter: "gupshup-sms",
      allow: ["enterprise.smsgupshup.com"],
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
  }

  private get base(): string {
    return (this.o.baseUrl ?? BASE).replace(/\/$/, "");
  }

  async send(message: SmsMessage, call?: PortCall): Promise<{ messageId: string }> {
    assertBodyClass(this.descriptor, call);
    const m = SmsMessage.parse(message);
    const { template, text } = this.dlt.check(m);
    const c = await this.o.credentials();
    const form = new URLSearchParams({
      method: "SendMessage",
      send_to: msisdn(m.to),
      msg: text,
      msg_type: "TEXT",
      userid: c.userId,
      password: c.password,
      auth_scheme: "plain",
      v: "1.1",
      format: "text",
      mask: m.senderId,
      principalEntityId: m.dltEntityId,
      dltTemplateId: template.dltTemplateId,
    });
    const r = await this.egress(`${this.base}${PATH}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (r.status >= 300) throw vendorError("SMS", "gupshup-sms", r.status, "send");
    // `success | 919812345678 | <id>` or `error | <code> | <text>`
    const [state, second, third] = r
      .text()
      .split("|")
      .map((x) => x.trim());
    if (state?.toLowerCase() === "success" && third) return { messageId: third };
    throw vendorError("SMS", "gupshup-sms", AUTH_ERRORS.has(second ?? "") ? 401 : 400, "send");
  }

  async getStatus(_id: string): Promise<{ status: string; at?: string }> {
    throw new PortError("IPB-PORT-001", "SMS", {
      adapter: "gupshup-sms",
      detail: "Gupshup Enterprise SMS reports status through delivery reports only",
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
    const query = meta?.query ?? "";
    await checkSharedSecret("SMS", "gupshup-sms", this.o.webhook, headers, meta?.sourceIp, query);
    // GET reports carry the fields in the query; a POST report carries them as a form body.
    const p = new URLSearchParams(rawBody.byteLength ? new TextDecoder().decode(rawBody) : query);
    const id = p.get("externalId");
    const state = (p.get("status") ?? "").toUpperCase();
    if (!id) throw webhookRefused("SMS", "gupshup-sms", "report without externalId");
    if (state !== "SUCCESS" && state !== "FAILURE") return []; // UNKNOWN is not final
    const cause = (p.get("cause") ?? "").toUpperCase();
    const ts = Number(p.get("deliveredTS"));
    const reports: SmsDeliveryReport[] = [
      {
        vendorEventId: `${id}:${state}`,
        messageId: id,
        status:
          state === "SUCCESS" ? "delivered" : cause.includes("EXPIRED") ? "expired" : "failed",
        at: Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : new Date().toISOString(),
      },
    ];
    return confirmed(reports, this.o.confirmStatus, this.o.onWithheld);
  }

  async health(): Promise<PortHealth> {
    const t0 = Date.now();
    let status: PortHealth["status"];
    try {
      const r = await this.egress(`${this.base}${PATH}`, { method: "HEAD" });
      status = r.status < 500 ? "up" : "down";
    } catch {
      status = "down";
    }
    return { status, latency_ms: Date.now() - t0, checked_at: new Date().toISOString() };
  }
}
