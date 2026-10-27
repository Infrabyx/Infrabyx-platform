// SMS port (IPB-01 §01.4.4.2). Indian traffic uses DLT-registered templates and headers only;
// SMS OTP is never an MFA factor for admin roles (IPB-02-02).
import { z } from "zod";
import type { Port, PortCall, WebhookRequestMeta } from "./common.js";
import { classed, recipient } from "./payload-class.js";

const internal = <T extends z.ZodType>(s: T): T => classed(s, "INTERNAL");

/** E.164 number, e.g. +919812345678. */
export const E164 = z.string().regex(/^\+[1-9]\d{7,14}$/);

export const SmsMessage = z.object({
  to: recipient(E164),
  /** Logical template id, mapped to the DLT template id by `int.sms.template_map`. */
  templateId: internal(z.string().min(1)),
  vars: internal(z.array(z.string().max(30)).max(10)),
  senderId: internal(z.string().regex(/^[A-Z]{6}$/)),
  dltEntityId: internal(z.string().regex(/^\d{19}$/)),
});
export type SmsMessage = z.infer<typeof SmsMessage>;

export interface SmsDeliveryReport {
  vendorEventId: string;
  messageId: string;
  status: "delivered" | "failed" | "expired" | "rejected";
  at: string;
}

export interface SmsPort extends Port {
  send(message: SmsMessage, call?: PortCall): Promise<{ messageId: string }>;
  getStatus(messageId: string): Promise<{ status: string; at?: string }>;
  registerTemplate(dlt: { templateId: string; dltTemplateId: string; text: string }): Promise<void>;
  verifyWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    meta?: WebhookRequestMeta,
  ): Promise<SmsDeliveryReport[]>;
}
