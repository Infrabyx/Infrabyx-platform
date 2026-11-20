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

/**
 * Attachments a caller may send as bytes (Udofin PR-UDF-055; R1-D-224): at most 10 files and
 * 10 MiB together (with any `attachments` keys; PL2-D-64), of these media types only.
 */
export const EMAIL_ATTACHMENT_LIMITS = { maxFiles: 10, maxBytes: 10 * 1024 * 1024 } as const;
export const EMAIL_ATTACHMENT_MEDIA_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;
export type EmailAttachmentMediaType = (typeof EMAIL_ATTACHMENT_MEDIA_TYPES)[number];
/** Extensions a filename of each media type may end with (lower case). */
export const EMAIL_ATTACHMENT_EXTENSIONS: Readonly<
  Record<EmailAttachmentMediaType, readonly string[]>
> = Object.freeze({
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
});

/** A plain file name with an extension: no path, no control characters, at most 100 characters. */
export const EmailAttachmentFilename = z
  .string()
  .min(3)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ._()-]*\.[A-Za-z0-9]{1,8}$/);

/** Whether `filename`'s extension fits `mediaType`. */
export function attachmentExtensionFits(filename: string, mediaType: string): boolean {
  const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  const allowed = (EMAIL_ATTACHMENT_EXTENSIONS as Record<string, readonly string[] | undefined>)[
    mediaType
  ];
  return allowed !== undefined && allowed.includes(ext);
}

/**
 * The media type the bytes are, by their magic number (PDF `%PDF-`, the PNG signature, the JPEG
 * start of image), or `undefined` for anything else. A declared type is taken only when the
 * bytes agree (IPB-02-44).
 */
export function emailAttachmentTypeOf(body: Uint8Array): EmailAttachmentMediaType | undefined {
  const starts = (sig: readonly number[]) =>
    body.byteLength >= sig.length && sig.every((b, i) => body[i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  return undefined;
}

/**
 * One attachment as bytes (PR-UDF-055; R1-D-224): the caller read them from STORAGE and checked
 * them against `sha256`; the adapter checks the digest again and sends the bytes as given, never
 * decoded, re-encoded or re-rendered. Only for an adapter with the capability
 * `attachments: "native"`.
 */
export const EmailAttachment = z
  .object({
    filename: EmailAttachmentFilename,
    contentType: z.enum(EMAIL_ATTACHMENT_MEDIA_TYPES),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    body: z.custom<Uint8Array>((v) => v instanceof Uint8Array, "bytes (a Uint8Array)"),
  })
  .strict();
export type EmailAttachment = z.infer<typeof EmailAttachment>;

export const EmailMessage = z.object({
  to: z.array(recipient(z.email())).min(1).max(50),
  cc: z.array(recipient(z.email())).max(50).optional(),
  /** The logical template; with `content` it only names the message (tags, reports). */
  template: internal(z.string().min(1)),
  vars: internal(z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))),
  /** STORAGE keys of INTERNAL attachments; CONFIDENTIAL documents go as secure links instead. */
  attachments: internal(z.array(z.string()).max(10)).optional(),
  /**
   * Attachments as verified bytes (PR-UDF-055; R1-D-224), counted with `attachments` against
   * `EMAIL_ATTACHMENT_LIMITS`. Handed only to an adapter that declares `attachments: "native"`.
   */
  files: internal(z.array(EmailAttachment).max(10)).optional(),
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
