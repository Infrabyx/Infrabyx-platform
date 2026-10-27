// PUSH port (IPB-01 PUSH; PL3 plan §6.7). Payloads are INTERNAL only: a title and a deep link, plus
// an INTERNAL data map; content is fetched in-app. GLOBAL providers are acceptable for this reason.
import { z } from "zod";
import type { Port, PortCall, WebhookRequestMeta } from "./common.js";
import { classed } from "./payload-class.js";

const internal = <T extends z.ZodType>(s: T): T => classed(s, "INTERNAL");

export const PUSH_PLATFORMS = ["ios", "android", "web"] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/** Anything beyond title, deep link and a small INTERNAL data map is refused (IPB-NTF-006). */
export const PushNotification = z
  .object({
    title: internal(z.string().min(1).max(120)),
    deepLink: internal(z.string().regex(/^\/[A-Za-z0-9/_:.?=&%-]*$/)),
    data: internal(
      z
        .record(z.string().regex(/^[a-z][a-z0-9_]*$/), z.string().max(120))
        .refine((d) => Object.keys(d).length <= 8, "at most 8 data keys"),
    ).optional(),
  })
  .strict();
export type PushNotification = z.infer<typeof PushNotification>;

export interface PushSendResult {
  /** One ticket per device; `invalid_token` tickets unregister the token. */
  tickets: {
    tokenRef: string;
    status: "accepted" | "invalid_token" | "rate_limited" | "error";
    vendorId?: string;
  }[];
}

export interface PushReceipt {
  vendorId: string;
  status: "delivered" | "failed" | "invalid_token";
  at: string;
}

export interface PushPort extends Port {
  /** Stores the token sealed (FieldCrypto) and returns an opaque reference. */
  register(
    deviceToken: string,
    platform: PushPlatform,
    userId: string,
  ): Promise<{ tokenRef: string }>;
  send(userIds: string[], notification: PushNotification, call?: PortCall): Promise<PushSendResult>;
  sendTopic(
    topic: string,
    notification: PushNotification,
    call?: PortCall,
  ): Promise<{ vendorId: string }>;
  unregister(tokenRef: string): Promise<void>;
  /** Delivery receipts (Expo `getReceipts`; FCM has none and reports `unsupported`). */
  receipts(vendorIds: string[]): Promise<PushReceipt[]>;
  verifyWebhook?(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    meta?: WebhookRequestMeta,
  ): Promise<PushReceipt[]>;
}

/**
 * Device tokens behind the PUSH adapters (PL3 plan §6.7). `@infrabyx/notify` implements it on
 * `notify.device_token` with the token sealed by FieldCrypto and a lookup digest; adapters hold no
 * tokens themselves.
 */
export interface PushTokenStore {
  /** Idempotent per token: the same device token returns the same reference. */
  save(t: {
    userId: string;
    platform: PushPlatform;
    provider: string;
    token: string;
  }): Promise<{ tokenRef: string }>;
  forUsers(
    userIds: readonly string[],
    provider: string,
  ): Promise<{ tokenRef: string; userId: string; platform: PushPlatform; token: string }[]>;
  remove(tokenRef: string): Promise<void>;
}
