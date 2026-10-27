// WHATSAPP port (IPB-01 §01.4.4.2). Message content is INTERNAL; media of class CONFIDENTIAL goes
// as a secure link; marketing templates stay off (OWN-08).
import { z } from "zod";
import type { Port, PortCall, WebhookRequestMeta } from "./common.js";
import { classed, recipient } from "./payload-class.js";
import { E164 } from "./sms.js";

const internal = <T extends z.ZodType>(s: T): T => classed(s, "INTERNAL");

export const WHATSAPP_TEMPLATE_CATEGORIES = ["utility", "authentication", "marketing"] as const;

export const WhatsappTemplateMessage = z.object({
  to: recipient(E164),
  templateName: internal(z.string().min(1)),
  lang: internal(z.string().min(2)),
  components: internal(z.array(z.record(z.string(), z.unknown()))),
});
export type WhatsappTemplateMessage = z.infer<typeof WhatsappTemplateMessage>;

export const WhatsappSessionMessage = z.object({
  to: recipient(E164),
  text: internal(z.string().min(1).max(4096)),
});
export type WhatsappSessionMessage = z.infer<typeof WhatsappSessionMessage>;

export interface WhatsappEvent {
  vendorEventId: string;
  messageId?: string;
  type: "sent" | "delivered" | "read" | "failed" | "inbound";
  at: string;
}

export interface WhatsappPort extends Port {
  sendTemplate(message: WhatsappTemplateMessage, call?: PortCall): Promise<{ messageId: string }>;
  /** Only inside the 24-hour customer-service window. */
  sendSession(message: WhatsappSessionMessage, call?: PortCall): Promise<{ messageId: string }>;
  uploadMedia(
    file: { body: Uint8Array; contentType: string },
    call?: PortCall,
  ): Promise<{ mediaId: string }>;
  getTemplateStatus(name: string): Promise<{
    status: "approved" | "pending" | "rejected" | "paused";
    category: (typeof WHATSAPP_TEMPLATE_CATEGORIES)[number];
  }>;
  submitTemplate(spec: {
    name: string;
    category: (typeof WHATSAPP_TEMPLATE_CATEGORIES)[number];
    lang: string;
    body: string;
  }): Promise<void>;
  verifyWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    meta?: WebhookRequestMeta,
  ): Promise<WhatsappEvent[]>;
  /** Category and per-message cost so OH8 can bill (IPB-01 WHATSAPP). */
  getConversationCost(
    category: (typeof WHATSAPP_TEMPLATE_CATEGORIES)[number],
  ): Promise<{ currency: string; amountMinor: number }>;
}
