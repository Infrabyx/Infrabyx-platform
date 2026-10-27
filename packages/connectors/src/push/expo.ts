// PUSH reference adapter `expo` (PL3 plan §6.7, PL3-D-15): the Expo push HTTP API v2 over the egress
// client, no SDK. GLOBAL (Expo's service), INTERNAL payloads only, under a DPA (IPB-DEV-05).
// - `send` in chunks of 100 to `/--/api/v2/push/send`; a `DeviceNotRegistered` ticket removes the
//   token from the store; `receipts` reads `/--/api/v2/push/getReceipts` in chunks of 300.
// - The optional access token ("enhanced security for push") comes from SECRETS.
// - Expo has no topics: `sendTopic` is `unsupported`.
// Vendor facts not yet proven against the live service are [VERIFY] until the sandbox leg (#14).
import type {
  AdapterDescriptor,
  PortCall,
  PortHealth,
  PushNotification,
  PushPlatform,
  PushPort,
  PushReceipt,
  PushSendResult,
  PushTokenStore,
} from "@infrabyx/contracts/ports";
import { createEgress } from "../core/http.js";
import { vendorError } from "../messaging/common.js";
import { chunks, guardPush, unsupported } from "./common.js";

const BASE = "https://exp.host";
const EXPO_TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/;

export interface ExpoPushOptions {
  store: PushTokenStore;
  /** Vendor Assurance Room reference of the DPA (IPB-DEV-05). */
  dpaRef: string;
  /** `secrets/<env>/push/expo/access_token`, when enhanced push security is on. */
  accessToken?: () => Promise<string | undefined> | string | undefined;
  /** Tests only: the Expo stub. */
  baseUrl?: string;
  allowLoopbackHttp?: boolean;
}

interface Ticket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

export class ExpoPush implements PushPort {
  readonly descriptor: AdapterDescriptor;
  private readonly egress;
  private readonly base: string;

  constructor(private readonly o: ExpoPushOptions) {
    this.descriptor = {
      port: "PUSH",
      adapter: "expo",
      residency: "GLOBAL",
      maxDataClass: "INTERNAL",
      capabilities: { sendTopic: "unsupported" },
      dpaRef: o.dpaRef,
    };
    this.base = (o.baseUrl ?? BASE).replace(/\/$/, "");
    this.egress = createEgress({
      port: "PUSH",
      adapter: "expo",
      allow: ["exp.host"],
      retries: 1,
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
  }

  async register(
    deviceToken: string,
    platform: PushPlatform,
    userId: string,
  ): Promise<{ tokenRef: string }> {
    if (!EXPO_TOKEN.test(deviceToken))
      throw vendorError("PUSH", "expo", 400, "not an Expo push token");
    return this.o.store.save({ userId, platform, provider: "expo", token: deviceToken });
  }

  async unregister(tokenRef: string): Promise<void> {
    await this.o.store.remove(tokenRef);
  }

  async send(
    userIds: string[],
    notification: PushNotification,
    call?: PortCall,
  ): Promise<PushSendResult> {
    const n = guardPush(notification, call);
    const tokens = await this.o.store.forUsers(userIds, "expo");
    const tickets: PushSendResult["tickets"] = [];
    for (const part of chunks(tokens, 100)) {
      const res = await this.post(
        "/--/api/v2/push/send",
        part.map((t) => this.message(t.token, n)),
      );
      const data = (res as { data?: Ticket[] }).data ?? [];
      for (const [i, t] of part.entries()) {
        const k = data[i];
        if (k?.status === "ok")
          tickets.push({
            tokenRef: t.tokenRef,
            status: "accepted",
            ...(k.id ? { vendorId: k.id } : {}),
          });
        else if (k?.details?.error === "DeviceNotRegistered") {
          await this.o.store.remove(t.tokenRef);
          tickets.push({ tokenRef: t.tokenRef, status: "invalid_token" });
        } else if (k?.details?.error === "MessageRateExceeded")
          tickets.push({ tokenRef: t.tokenRef, status: "rate_limited" });
        else tickets.push({ tokenRef: t.tokenRef, status: "error" });
      }
    }
    return { tickets };
  }

  async sendTopic(): Promise<{ vendorId: string }> {
    throw unsupported("expo", "sendTopic");
  }

  async receipts(vendorIds: string[]): Promise<PushReceipt[]> {
    const out: PushReceipt[] = [];
    for (const part of chunks(vendorIds, 300)) {
      const res = (await this.post("/--/api/v2/push/getReceipts", { ids: part })) as {
        data?: Record<string, { status: "ok" | "error"; details?: { error?: string } }>;
      };
      const at = new Date().toISOString();
      for (const [vendorId, r] of Object.entries(res.data ?? {}))
        out.push({
          vendorId,
          at,
          status:
            r.status === "ok"
              ? "delivered"
              : r.details?.error === "DeviceNotRegistered"
                ? "invalid_token"
                : "failed",
        });
    }
    return out;
  }

  async health(): Promise<PortHealth> {
    const started = performance.now();
    let status: PortHealth["status"] = "up";
    try {
      await this.post("/--/api/v2/push/getReceipts", { ids: [] });
    } catch {
      status = "down";
    }
    return {
      status,
      latency_ms: Math.round(performance.now() - started),
      checked_at: new Date().toISOString(),
    };
  }

  private message(to: string, n: PushNotification): Record<string, unknown> {
    return {
      to,
      title: n.title,
      data: { deep_link: n.deepLink, ...(n.data ?? {}) },
      priority: "high",
    };
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const token =
      typeof this.o.accessToken === "function" ? await this.o.accessToken() : this.o.accessToken;
    const res = await this.egress(`${this.base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (res.status !== 200) throw vendorError("PUSH", "expo", res.status, "Expo push API");
    return res.json();
  }
}
