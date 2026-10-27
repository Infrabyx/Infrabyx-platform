// EMAIL reference `ses` (PL2 plan §6.10): Amazon SES v2 in ap-south-1 with one configuration set
// per brand. Events arrive through SNS, verified per C-13 (SignatureVersion 2, pinned certificate
// hosts, one topic) and inside a timestamp window; SubscriptionConfirmation is confirmed only
// after it verifies. The idempotency key travels as the `ipb_idem` message tag (plan §3.5). SES
// has no message search, so there is no vendor lookup: a send left pending is sent again
// (at-least-once, PL2-D-64), and status comes from events, not from `getStatus`.
import {
  CreateEmailIdentityCommand,
  GetAccountCommand,
  GetEmailIdentityCommand,
  PutSuppressedDestinationCommand,
  SESv2Client,
  SendEmailCommand,
  type MessageTag,
} from "@aws-sdk/client-sesv2";
import { PortError } from "@infrabyx/contracts/errors";
import {
  EmailMessage,
  type AdapterDescriptor,
  type EmailEvent,
  type EmailPort,
  type PortCall,
  type PortHealth,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { sha256Hex, verifySnsMessage, type SnsMessage } from "@infrabyx/crypto";
import { createEgress } from "../core/http.js";
import {
  EMAIL_ATTACHMENTS_MAX_BYTES,
  assertBodyClass,
  loadAttachments,
  parseJson,
  vendorError,
  webhookRefused,
  withinWindow,
} from "../messaging/common.js";

const SES_REGIONS = ["ap-south-1", "ap-south-2"] as const;
const TAG = /^[A-Za-z0-9_-]{1,256}$/;

export interface EmailBrand {
  /** `int.email.from.<brand>` */
  from: string;
  /** `int.email.reply_to` */
  replyTo?: string;
  /** SES configuration set of the brand (event destination to the brand's SNS topic). */
  configurationSet: string;
}

export interface SesEmailOptions {
  region: (typeof SES_REGIONS)[number];
  brands: Readonly<Record<string, EmailBrand>>;
  /** Configuration set for `sendRaw`, whose MIME carries its own From. */
  rawConfigurationSet?: string;
  /** The SNS topic that carries this deployment's SES events. */
  events: { topicArn: string; regions?: readonly string[]; maxAgeSeconds?: number };
  /** Where attachment keys are read from (INTERNAL classes only). */
  storage?: StoragePort;
  /** Tests only: endpoint and static credentials (moto or the SES stub). */
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
  /** Tests only: signing certificate source; production fetches through egress. */
  fetchCertificate?: (url: string) => Promise<string>;
  now?: () => number;
}

type SesError = Error & { name: string; $metadata?: { httpStatusCode?: number } };

/** Tags are `[A-Za-z0-9_-]`; the idempotency key is hashed so any key fits. */
export const idempotencyTag = (key: string): MessageTag => ({
  Name: "ipb_idem",
  Value: sha256Hex(key).slice(0, 32),
});

export class SesEmail implements EmailPort {
  readonly descriptor: AdapterDescriptor = {
    port: "EMAIL",
    adapter: "ses",
    residency: "IN",
    maxDataClass: "INTERNAL",
    capabilities: { getStatus: "unsupported" },
  };
  private readonly client: SESv2Client;
  private readonly certs = new Map<string, Promise<string>>();
  private readonly egress;

  constructor(private readonly o: SesEmailOptions) {
    if (!(SES_REGIONS as readonly string[]).includes(o.region))
      throw new PortError("IPB-PORT-003", "EMAIL", {
        adapter: "ses",
        detail: `region ${o.region} is outside India (ap-south-1, ap-south-2)`,
      });
    this.client = new SESv2Client({
      region: o.region,
      ...(o.endpoint ? { endpoint: o.endpoint } : {}),
      ...(o.credentials ? { credentials: o.credentials } : {}),
    });
    const regions = o.events.regions ?? SES_REGIONS;
    this.egress = createEgress({
      port: "EMAIL",
      adapter: "ses",
      allow: regions.map((r) => `sns.${r}.amazonaws.com`),
      maxBytes: 64 * 1024,
    });
  }

  private fail(e: unknown, what: string): never {
    const err = e as SesError;
    if (err instanceof PortError) throw err;
    // A paused or suspended account is a reputation block: unavailable, so the router may fail over.
    if (["SendingPausedException", "AccountSuspendedException"].includes(err.name))
      throw new PortError("IPB-PORT-002", "EMAIL", {
        adapter: "ses",
        detail: `${what}: sending is paused for the account`,
        meta: { reason: "reputation_block" },
      });
    throw vendorError("EMAIL", "ses", err.$metadata?.httpStatusCode ?? 503, what);
  }

  private brand(name: string): EmailBrand {
    const b = this.o.brands[name];
    if (!b)
      throw new PortError("IPB-PORT-001", "EMAIL", {
        adapter: "ses",
        detail: `brand ${name} has no sender configured (int.email.from.<brand>)`,
      });
    return b;
  }

  private tags(m: EmailMessage, call?: PortCall): MessageTag[] {
    const out: MessageTag[] = [{ Name: "ipb_brand", Value: m.brand }];
    for (const [Name, Value] of Object.entries(m.tags ?? {})) {
      if (!TAG.test(Name) || !TAG.test(Value) || Name.startsWith("ipb_"))
        throw new PortError("IPB-PORT-001", "EMAIL", {
          adapter: "ses",
          detail: "tag names and values are [A-Za-z0-9_-], and ipb_ is reserved",
          meta: { reason: "invalid_request", definite: true },
        });
      out.push({ Name, Value });
    }
    if (call?.idempotencyKey) out.push(idempotencyTag(call.idempotencyKey));
    return out;
  }

  async send(message: EmailMessage, call?: PortCall): Promise<{ messageId: string }> {
    assertBodyClass(this.descriptor, call);
    const m = EmailMessage.parse(message);
    const b = this.brand(m.brand);
    const files = await loadAttachments(this.descriptor, m.attachments, this.o.storage);
    const r = await this.client
      .send(
        new SendEmailCommand({
          FromEmailAddress: b.from,
          ...(b.replyTo ? { ReplyToAddresses: [b.replyTo] } : {}),
          Destination: { ToAddresses: m.to, ...(m.cc ? { CcAddresses: m.cc } : {}) },
          Content: {
            Template: {
              TemplateName: m.template,
              TemplateData: JSON.stringify(m.vars),
              ...(files.length
                ? {
                    Attachments: files.map((f) => ({
                      FileName: f.filename,
                      ContentType: f.contentType,
                      RawContent: f.body,
                      ContentDisposition: "ATTACHMENT" as const,
                    })),
                  }
                : {}),
            },
          },
          ConfigurationSetName: b.configurationSet,
          EmailTags: this.tags(m, call),
        }),
      )
      .catch((e: unknown) => this.fail(e, "send"));
    return { messageId: r.MessageId ?? "" };
  }

  async sendRaw(mime: Uint8Array, call?: PortCall): Promise<{ messageId: string }> {
    assertBodyClass(this.descriptor, call);
    if (mime.byteLength > EMAIL_ATTACHMENTS_MAX_BYTES + 1024 * 1024)
      throw new PortError("IPB-PORT-003", "EMAIL", {
        adapter: "ses",
        detail: "raw message exceeds 11 MiB",
      });
    const r = await this.client
      .send(
        new SendEmailCommand({
          Content: { Raw: { Data: mime } },
          ...(this.o.rawConfigurationSet
            ? { ConfigurationSetName: this.o.rawConfigurationSet }
            : {}),
          ...(call?.idempotencyKey ? { EmailTags: [idempotencyTag(call.idempotencyKey)] } : {}),
        }),
      )
      .catch((e: unknown) => this.fail(e, "sendRaw"));
    return { messageId: r.MessageId ?? "" };
  }

  /** SES has no message status API; delivery state comes from the SNS events. */
  async getStatus(_messageId: string): Promise<{ status: string; at?: string }> {
    throw new PortError("IPB-PORT-001", "EMAIL", {
      adapter: "ses",
      detail: "SES reports status through events only",
      meta: { reason: "unsupported" },
    });
  }

  private certificate(url: string): Promise<string> {
    if (this.o.fetchCertificate) return this.o.fetchCertificate(url);
    let p = this.certs.get(url);
    if (!p) {
      p = this.egress(url).then((r) => {
        if (r.status !== 200) throw new Error(`certificate fetch answered ${r.status}`);
        return r.text();
      });
      p.catch(() => this.certs.delete(url));
      this.certs.set(url, p);
    }
    return p;
  }

  async verifyWebhook(
    rawBody: Uint8Array,
    _headers: Readonly<Record<string, string>>,
  ): Promise<EmailEvent[]> {
    const m = parseJson("EMAIL", "ses", rawBody) as SnsMessage;
    const failure = await verifySnsMessage(m, {
      topicArn: this.o.events.topicArn,
      regions: this.o.events.regions ?? SES_REGIONS,
      fetchCertificate: (u) => this.certificate(u),
      ...(this.o.now ? { now: this.o.now() } : {}),
    });
    if (failure) throw webhookRefused("EMAIL", "ses", `SNS ${failure}`);
    const now = this.o.now?.() ?? Date.now();
    if (!withinWindow(Date.parse(m.Timestamp), (this.o.events.maxAgeSeconds ?? 3600) * 1000, now))
      throw webhookRefused("EMAIL", "ses", "SNS message outside the timestamp window");
    if (m.Type === "SubscriptionConfirmation") {
      if (!m.SubscribeURL) throw webhookRefused("EMAIL", "ses", "no SubscribeURL");
      const r = await this.egress(m.SubscribeURL);
      if (r.status !== 200)
        throw vendorError("EMAIL", "ses", r.status, "subscription confirmation");
      return [];
    }
    if (m.Type !== "Notification") return [];
    return sesEvents(m.MessageId, m.Message);
  }

  async verifyDomain(domain: string): Promise<{
    verified: boolean;
    dnsRecords: Array<{ type: string; name: string; value: string }>;
  }> {
    const get = () => this.client.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
    let id = await get().catch((e: unknown) =>
      (e as SesError).name === "NotFoundException" ? null : this.fail(e, "verifyDomain"),
    );
    if (!id) {
      await this.client
        .send(new CreateEmailIdentityCommand({ EmailIdentity: domain }))
        .catch((e: unknown) => this.fail(e, "verifyDomain"));
      id = await get().catch((e: unknown) => this.fail(e, "verifyDomain"));
    }
    const dkim = id.DkimAttributes;
    return {
      verified: id.VerifiedForSendingStatus === true && dkim?.Status === "SUCCESS",
      dnsRecords: (dkim?.Tokens ?? []).map((t) => ({
        type: "CNAME",
        name: `${t}._domainkey.${domain}`,
        value: `${t}.dkim.amazonses.com`,
      })),
    };
  }

  async suppress(address: string, reason: "bounce" | "complaint" | "manual"): Promise<void> {
    // SES knows two reasons; a manual suppression is recorded as a bounce.
    await this.client
      .send(
        new PutSuppressedDestinationCommand({
          EmailAddress: address,
          Reason: reason === "complaint" ? "COMPLAINT" : "BOUNCE",
        }),
      )
      .catch((e: unknown) => this.fail(e, "suppress"));
  }

  async health(): Promise<PortHealth> {
    const t0 = Date.now();
    let status: PortHealth["status"];
    try {
      const a = await this.client.send(new GetAccountCommand({}));
      status =
        a.SendingEnabled === false
          ? "down"
          : a.EnforcementStatus && a.EnforcementStatus !== "HEALTHY"
            ? "degraded"
            : "up";
    } catch {
      status = "down";
    }
    return { status, latency_ms: Date.now() - t0, checked_at: new Date().toISOString() };
  }
}

interface SesEventJson {
  eventType?: string;
  notificationType?: string;
  mail?: { messageId?: string; destination?: string[]; timestamp?: string };
  bounce?: {
    bounceType?: string;
    bouncedRecipients?: Array<{ emailAddress?: string }>;
    timestamp?: string;
  };
  complaint?: { complainedRecipients?: Array<{ emailAddress?: string }>; timestamp?: string };
  delivery?: { recipients?: string[]; timestamp?: string };
}

/** Normalise one SES event (event publishing or notification format) into port events. */
export function sesEvents(snsMessageId: string, message: string): EmailEvent[] {
  let e: SesEventJson;
  try {
    e = JSON.parse(message) as SesEventJson;
  } catch {
    throw webhookRefused("EMAIL", "ses", "SES event is not JSON");
  }
  const messageId = e.mail?.messageId ?? "";
  const at = e.mail?.timestamp ?? new Date().toISOString();
  const kind = (e.eventType ?? e.notificationType ?? "").toLowerCase();
  const each = (
    type: EmailEvent["type"],
    recipients: Array<string | undefined>,
    when?: string,
  ): EmailEvent[] =>
    recipients
      .filter((r): r is string => typeof r === "string" && r.length > 0)
      .map((recipient, i) => ({
        vendorEventId: recipients.length > 1 ? `${snsMessageId}:${i}` : snsMessageId,
        messageId,
        type,
        recipient,
        at: when ?? at,
      }));
  switch (kind) {
    case "bounce":
      // Only a permanent bounce suppresses; transient ones are delays.
      return e.bounce?.bounceType === "Permanent"
        ? each(
            "bounced",
            (e.bounce.bouncedRecipients ?? []).map((r) => r.emailAddress),
            e.bounce.timestamp,
          )
        : [{ vendorEventId: snsMessageId, messageId, type: "delayed", at }];
    case "complaint":
      return each(
        "complained",
        (e.complaint?.complainedRecipients ?? []).map((r) => r.emailAddress),
        e.complaint?.timestamp,
      );
    case "delivery":
      return each("delivered", e.delivery?.recipients ?? [], e.delivery?.timestamp);
    case "send":
      return [{ vendorEventId: snsMessageId, messageId, type: "sent", at }];
    case "reject":
    case "rendering failure":
      return [{ vendorEventId: snsMessageId, messageId, type: "rejected", at }];
    case "deliverydelay":
      return [{ vendorEventId: snsMessageId, messageId, type: "delayed", at }];
    case "open":
      return [{ vendorEventId: snsMessageId, messageId, type: "opened", at }];
    case "click":
      return [{ vendorEventId: snsMessageId, messageId, type: "clicked", at }];
    default:
      return [];
  }
}
