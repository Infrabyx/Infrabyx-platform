// EMAIL reference `ses` (PL2 plan §6.10): Amazon SES v2 in ap-south-1 with one configuration set
// per brand. Events arrive through SNS, verified per C-13 (SignatureVersion 2, pinned certificate
// hosts, one topic) and inside a timestamp window; SubscriptionConfirmation is confirmed only
// after it verifies. The idempotency key travels as the `ipb_idem` message tag (plan §3.5). SES
// has no message search, so there is no vendor lookup: a send left pending is sent again
// (at-least-once, PL2-D-64), and status comes from events, not from `getStatus`.
//
// Inbound (PR-LDC-50; R1-D-177; plan `docs/phases/R1-inbound-mail-plan.md` §3): SES email
// receiving publishes a `Received` notification to a separate SNS topic (`inbound.topicArn`), signed
// and checked as the events are. The message is in `content` (SNS action, at most 150 KB: "You can
// only publish emails that are 150 KB or less (including the header) to Amazon SNS", SES
// `SNSAction` API reference, read 18 Nov 2026) or in the configured S3 bucket (S3 action). The
// verdicts are taken from the signed `receipt` only ("Contents of notifications for Amazon SES email
// receiving", docs.aws.amazon.com/ses/latest/dg/receiving-email-notifications-contents.html, read
// 18 Nov 2026), never from headers inside the message.
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
  INBOUND_MAIL_LIMITS,
  type AdapterDescriptor,
  type EmailEvent,
  type InboundAuthResult,
  type InboundEmail,
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
  /**
   * SES email receiving (PR-LDC-50): the SNS topic of `Received` notifications, which must not be
   * the events topic, and the S3 bucket of the S3 action (in India) for messages over 150 KB.
   */
  inbound?: {
    topicArn: string;
    bucket?: { name: string; region: (typeof SES_REGIONS)[number] };
    maxAgeSeconds?: number;
  };
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
    // `content`: rendered subject and parts sent as SES simple content (PR-LDC-27; R1-D-90).
    // `attachments`: files given as bytes go as `RawContent`, unchanged (PR-UDF-055; R1-D-224).
    capabilities: {
      getStatus: "unsupported",
      content: "native",
      inbound: "native",
      attachments: "native",
    },
  };
  private readonly client: SESv2Client;
  private readonly certs = new Map<string, Promise<string>>();
  private readonly egress;
  private readonly s3?: S3Client;

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
    if (o.inbound) {
      if (o.inbound.topicArn === o.events.topicArn)
        throw new PortError("IPB-PORT-003", "EMAIL", {
          adapter: "ses",
          detail: "the inbound topic must not be the delivery-events topic",
        });
      if (o.inbound.bucket) {
        if (!(SES_REGIONS as readonly string[]).includes(o.inbound.bucket.region))
          throw new PortError("IPB-PORT-003", "EMAIL", {
            adapter: "ses",
            detail: `inbound bucket region ${o.inbound.bucket.region} is outside India`,
          });
        this.s3 = new S3Client({
          region: o.inbound.bucket.region,
          ...(o.endpoint ? { endpoint: o.endpoint, forcePathStyle: true } : {}),
          ...(o.credentials ? { credentials: o.credentials } : {}),
        });
      }
    }
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
    const files = await loadAttachments(this.descriptor, m.attachments, this.o.storage, m.files);
    const attachments = files.length
      ? {
          Attachments: files.map((f) => ({
            FileName: f.filename,
            ContentType: f.contentType,
            RawContent: f.body,
            ContentDisposition: "ATTACHMENT" as const,
          })),
        }
      : {};
    const utf8 = (Data: string) => ({ Data, Charset: "UTF-8" });
    const replyTo = m.replyTo ?? b.replyTo;
    const r = await this.client
      .send(
        new SendEmailCommand({
          FromEmailAddress: b.from,
          // A message's own reply address (an inbound reply token, PR-LDC-50) wins over the brand's.
          ...(replyTo ? { ReplyToAddresses: [replyTo] } : {}),
          Destination: { ToAddresses: m.to, ...(m.cc ? { CcAddresses: m.cc } : {}) },
          Content: m.content
            ? {
                Simple: {
                  Subject: utf8(m.content.subject),
                  Body: {
                    Text: utf8(m.content.text),
                    ...(m.content.html ? { Html: utf8(m.content.html) } : {}),
                  },
                  ...attachments,
                },
              }
            : {
                Template: {
                  TemplateName: m.template,
                  TemplateData: JSON.stringify(m.vars),
                  ...attachments,
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

  /**
   * SES email receiving (PR-LDC-50): a verified `Received` notification from the inbound topic
   * becomes one `InboundEmail`. Anything unverified, stale, of another type or another action,
   * over 10 MiB, or in another bucket is refused (`webhookRefused`, `IPB-SEC-013`).
   */
  async verifyInbound(
    rawBody: Uint8Array,
    _headers: Readonly<Record<string, string>>,
  ): Promise<InboundEmail[]> {
    const inbound = this.o.inbound;
    if (!inbound)
      throw new PortError("IPB-PORT-001", "EMAIL", {
        adapter: "ses",
        detail: "SES email receiving is not configured (inbound.topicArn)",
        meta: { reason: "unsupported" },
      });
    const m = parseJson("EMAIL", "ses", rawBody) as SnsMessage;
    const failure = await verifySnsMessage(m, {
      topicArn: inbound.topicArn,
      regions: this.o.events.regions ?? SES_REGIONS,
      fetchCertificate: (u) => this.certificate(u),
      ...(this.o.now ? { now: this.o.now() } : {}),
    });
    if (failure) throw webhookRefused("EMAIL", "ses", `SNS ${failure}`);
    const now = this.o.now?.() ?? Date.now();
    if (!withinWindow(Date.parse(m.Timestamp), (inbound.maxAgeSeconds ?? 3600) * 1000, now))
      throw webhookRefused("EMAIL", "ses", "SNS message outside the timestamp window");
    if (m.Type === "SubscriptionConfirmation") {
      if (!m.SubscribeURL) throw webhookRefused("EMAIL", "ses", "no SubscribeURL");
      const r = await this.egress(m.SubscribeURL);
      if (r.status !== 200)
        throw vendorError("EMAIL", "ses", r.status, "subscription confirmation");
      return [];
    }
    if (m.Type !== "Notification") return [];
    const n = parseReceived(m.Message);
    let raw: Uint8Array;
    if (n.action.type === "SNS") {
      if (typeof n.content !== "string")
        throw webhookRefused("EMAIL", "ses", "SNS action without content");
      raw =
        n.action.encoding === "BASE64"
          ? new Uint8Array(Buffer.from(n.content, "base64"))
          : new TextEncoder().encode(n.content);
    } else if (n.action.type === "S3") {
      raw = await this.readInbound(n.action.bucketName, n.action.objectKey);
    } else throw webhookRefused("EMAIL", "ses", `receipt action ${n.action.type} is not taken`);
    if (raw.byteLength > INBOUND_MAIL_LIMITS.maxBytes)
      throw new PortError("IPB-SEC-013", "EMAIL", {
        adapter: "ses",
        detail: "the received message is over 10 MiB",
        meta: { reason: "too_large" },
      });
    return [
      {
        adapter: "ses",
        vendorMessageId: n.messageId,
        receivedAt: n.receivedAt,
        envelopeFrom: n.source,
        recipients: n.recipients,
        auth: n.auth,
        raw,
      },
    ];
  }

  /** The S3 action's object, only from the configured bucket, capped at 10 MiB. */
  private async readInbound(bucket: unknown, key: unknown): Promise<Uint8Array> {
    const b = this.o.inbound?.bucket;
    if (!b || !this.s3) throw webhookRefused("EMAIL", "ses", "no inbound bucket is configured");
    if (bucket !== b.name || typeof key !== "string" || !/^[A-Za-z0-9!_.*'()/-]{1,1024}$/.test(key))
      throw webhookRefused("EMAIL", "ses", "the S3 action names another bucket or a bad key");
    const max = INBOUND_MAIL_LIMITS.maxBytes;
    const tooLarge = () =>
      new PortError("IPB-SEC-013", "EMAIL", {
        adapter: "ses",
        detail: "the received message is over 10 MiB",
        meta: { reason: "too_large" },
      });
    const r = await this.s3
      .send(new GetObjectCommand({ Bucket: b.name, Key: key }))
      .catch((e: unknown) => this.fail(e, "inbound read"));
    if ((r.ContentLength ?? 0) > max) throw tooLarge();
    const body = r.Body as AsyncIterable<Uint8Array> | undefined;
    if (!body) throw vendorError("EMAIL", "ses", 502, "inbound read: no body");
    const parts: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of body) {
      size += chunk.byteLength;
      if (size > max) {
        (body as { destroy?: () => void }).destroy?.();
        throw tooLarge();
      }
      parts.push(chunk);
    }
    return new Uint8Array(Buffer.concat(parts));
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

const VERDICT: Readonly<Record<string, InboundAuthResult>> = {
  PASS: "pass",
  FAIL: "fail",
  GRAY: "none",
  PROCESSING_FAILED: "error",
};
/** An SES verdict object; anything missing or unknown is `error` (fail closed). */
const verdict = (v: unknown): InboundAuthResult => {
  const s = (v as { status?: unknown } | undefined)?.status;
  return (typeof s === "string" && VERDICT[s]) || "error";
};
const ADDRESS = /^[^\s@<>"]{1,254}@[a-z0-9.-]{1,253}$/;

interface Received {
  messageId: string;
  receivedAt: string;
  source: string;
  recipients: string[];
  auth: InboundEmail["auth"];
  action: { type: string; encoding?: string; bucketName?: unknown; objectKey?: unknown };
  content?: unknown;
}

/**
 * Normalise an SES `Received` notification. The fields are the documented ones; a missing or
 * malformed field refuses the notification rather than guessing.
 */
export function parseReceived(message: string): Received {
  let n: {
    notificationType?: unknown;
    mail?: { messageId?: unknown; timestamp?: unknown; source?: unknown };
    receipt?: {
      recipients?: unknown;
      timestamp?: unknown;
      spfVerdict?: unknown;
      dkimVerdict?: unknown;
      dmarcVerdict?: unknown;
      action?: { type?: unknown; encoding?: unknown; bucketName?: unknown; objectKey?: unknown };
    };
    content?: unknown;
  };
  try {
    n = JSON.parse(message) as typeof n;
  } catch {
    throw webhookRefused("EMAIL", "ses", "SES notification is not JSON");
  }
  if (n.notificationType !== "Received")
    throw webhookRefused("EMAIL", "ses", "not an SES Received notification");
  const r = n.receipt;
  const messageId = n.mail?.messageId;
  if (!r || typeof messageId !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(messageId))
    throw webhookRefused("EMAIL", "ses", "the notification has no receipt or message id");
  const recipients = Array.isArray(r.recipients)
    ? r.recipients.filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase())
    : [];
  if (
    recipients.length === 0 ||
    recipients.length > 50 ||
    !recipients.every((x) => ADDRESS.test(x))
  )
    throw webhookRefused("EMAIL", "ses", "the receipt names no valid recipient");
  const source = typeof n.mail?.source === "string" ? n.mail.source.toLowerCase() : "";
  const at = typeof n.mail?.timestamp === "string" ? n.mail.timestamp : r.timestamp;
  const type = typeof r.action?.type === "string" ? r.action.type : "";
  return {
    messageId,
    receivedAt:
      typeof at === "string" && !Number.isNaN(Date.parse(at))
        ? new Date(at).toISOString()
        : new Date(0).toISOString(),
    source: ADDRESS.test(source) ? source : "",
    recipients,
    auth: {
      spf: verdict(r.spfVerdict),
      dkimAligned: verdict(r.dkimVerdict),
      dmarc: verdict(r.dmarcVerdict),
    },
    action: {
      type,
      ...(typeof r.action?.encoding === "string"
        ? { encoding: r.action.encoding.toUpperCase() }
        : {}),
      bucketName: r.action?.bucketName,
      objectKey: r.action?.objectKey,
    },
    content: n.content,
  };
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
