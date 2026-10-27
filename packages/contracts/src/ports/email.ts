// EMAIL port (IPB-01 §01.4.4.2). Bodies are INTERNAL; CONFIDENTIAL content goes only as a secure
// link; recipient addresses may reach a GLOBAL provider for delivery only, under a DPA (IPB-DEV-05).
import { z } from "zod";
import type { Port, PortCall, WebhookRequestMeta } from "./common.js";
import { classed, recipient } from "./payload-class.js";

const internal = <T extends z.ZodType>(s: T): T => classed(s, "INTERNAL");

export const EmailMessage = z.object({
  to: z.array(recipient(z.email())).min(1).max(50),
  cc: z.array(recipient(z.email())).max(50).optional(),
  template: internal(z.string().min(1)),
  vars: internal(z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))),
  /** STORAGE keys of INTERNAL attachments; CONFIDENTIAL documents go as secure links instead. */
  attachments: internal(z.array(z.string()).max(10)).optional(),
  tags: internal(z.record(z.string(), z.string())).optional(),
  brand: internal(z.string()),
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
}
