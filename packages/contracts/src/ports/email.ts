// EMAIL port (IPB-01 §01.4.4.2). Bodies are INTERNAL; CONFIDENTIAL content goes only as a secure
// link; recipient addresses may reach a GLOBAL provider for delivery only, under a DPA (IPB-DEV-05).
import { z } from "zod";
import type { Port, PortCall, WebhookRequestMeta } from "./common.js";
import { classed, recipient } from "./payload-class.js";

const internal = <T extends z.ZodType>(s: T): T => classed(s, "INTERNAL");

/**
 * Content the caller rendered, sent in place of the vendor template (LawDocsComply PR-LDC-27;
 * R1-D-90): a subject without line breaks, a plain-text part and an optional HTML part. An adapter
 * that sends it declares the capability `content: "native"`; NOTIFY never hands it to one that
 * does not, so a tenant's text never silently becomes the vendor's template.
 */
export const EmailContent = z
  .object({
    subject: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[^\r\n]*$/),
    text: z.string().min(1).max(50_000),
    html: z.string().min(1).max(200_000).optional(),
  })
  .strict();
export type EmailContent = z.infer<typeof EmailContent>;

export const EmailMessage = z.object({
  to: z.array(recipient(z.email())).min(1).max(50),
  cc: z.array(recipient(z.email())).max(50).optional(),
  /** The logical template; with `content` it only names the message (tags, reports). */
  template: internal(z.string().min(1)),
  vars: internal(z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))),
  /** STORAGE keys of INTERNAL attachments; CONFIDENTIAL documents go as secure links instead. */
  attachments: internal(z.array(z.string()).max(10)).optional(),
  tags: internal(z.record(z.string(), z.string())).optional(),
  brand: internal(z.string()),
  /** Rendered content sent instead of the vendor template (PR-LDC-27). */
  content: internal(EmailContent).optional(),
  /**
   * The reply address of this message (an inbound reply token, PR-LDC-50; R1-D-177). It replaces
   * the brand's `int.email.reply_to` for this message only.
   */
  replyTo: recipient(z.email()).optional(),
});
export type EmailMessage = z.infer<typeof EmailMessage>;

export const EmailEventType = z.enum([
  "sent",
  "delivered",
  "bounced",
  "complained",
  "rejected",
  "delayed",
  "opened",
  "clicked",
]);

export interface EmailEvent {
  vendorEventId: string;
  messageId: string;
  type: z.infer<typeof EmailEventType>;
  /** Present for bounces and complaints so the address can be suppressed. */
  recipient?: string;
  at: string;
}

// ------------------------------------------------------------------ inbound (PR-LDC-50; R1-D-177)

/**
 * An authentication verdict as the receiving adapter computed it from its own signed record (for
 * SES, the SNS-signed receipt notification), never from headers in the message: `none` is "no
 * result that binds" (no DKIM signature, SPF none/neutral/softfail, no enforceable DMARC policy),
 * `error` is a check that could not run.
 */
export const INBOUND_AUTH_RESULTS = ["pass", "fail", "none", "error"] as const;
export type InboundAuthResult = (typeof INBOUND_AUTH_RESULTS)[number];

/** One inbound message, verified to come from the adapter's vendor (C-13). */
export interface InboundEmail {
  adapter: string;
  /** The vendor's id of the received message (redeliveries carry the same id). */
  vendorMessageId: string;
  receivedAt: string;
  /** The envelope MAIL FROM (lower case), or an empty string for a null reverse-path. */
  envelopeFrom: string;
  /** The envelope RCPT TO addresses the receiving rule matched (lower case). */
  recipients: readonly string[];
  auth: {
    spf: InboundAuthResult;
    /** A DKIM signature that verifies and whose domain is the `From` domain. */
    dkimAligned: InboundAuthResult;
    dmarc: InboundAuthResult;
  };
  /** The message as received (RFC 5322 / MIME). */
  raw: Uint8Array;
}

/**
 * The bounds of an inbound message (design `docs/phases/R1-inbound-mail-design.md` §3): a message
 * over any of them is dropped, never parsed further. `maxLineOctets` is RFC 5322 §2.1.1's 998.
 */
export const INBOUND_MAIL_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxParts: 200,
  maxDepth: 10,
  maxHeaderBytes: 64 * 1024,
  maxLineOctets: 998,
  maxAttachments: 20,
  maxTextChars: 20_000,
} as const;

/**
 * Character sets an inbound message may declare (WHATWG Encoding labels `TextDecoder` decodes the
 * same way everywhere); any other declared charset drops the message.
 */
export const INBOUND_MAIL_CHARSETS = [
  "us-ascii",
  "ascii",
  "utf-8",
  "utf8",
  "iso-8859-1",
  "latin1",
  "iso-8859-2",
  "iso-8859-15",
  "windows-1250",
  "windows-1251",
  "windows-1252",
  "cp1252",
] as const;

export interface EmailPort extends Port {
  send(message: EmailMessage, call?: PortCall): Promise<{ messageId: string }>;
  sendRaw(mime: Uint8Array, call?: PortCall): Promise<{ messageId: string }>;
  getStatus(messageId: string): Promise<{ status: string; at?: string }>;
  /** Verifies the vendor signature (C-13) and normalises the event; throws on an unverified payload. */
  verifyWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    meta?: WebhookRequestMeta,
  ): Promise<EmailEvent[]>;
  verifyDomain(domain: string): Promise<{
    verified: boolean;
    dnsRecords: Array<{ type: string; name: string; value: string }>;
  }>;
  suppress(address: string, reason: "bounce" | "complaint" | "manual"): Promise<void>;
  /**
   * Inbound route (capability `inbound: "native"`): verifies the vendor's signature (C-13) and
   * returns the received messages; throws on an unverified payload, as `verifyWebhook` does.
   */
  verifyInbound?(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    meta?: WebhookRequestMeta,
  ): Promise<InboundEmail[]>;
}
