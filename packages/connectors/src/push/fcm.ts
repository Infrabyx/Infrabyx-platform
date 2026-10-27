// PUSH alternative adapter `fcm` (PL3 plan §6.7): Firebase Cloud Messaging HTTP v1 over the egress
// client, no SDK. GLOBAL (Google), INTERNAL payloads only, under a DPA (IPB-DEV-05).
// - Credentials (PL3-C-01, C-24): either a service-account key read through SECRETS, from which
//   `@infrabyx/crypto` signs the RS256 assertion exchanged at Google's token endpoint, or a
//   short-lived access token from keyless workload identity federation (preferred once the
//   platform runs on a cloud that offers it). The access token is cached until 5 minutes before
//   it expires; neither the key nor the token is ever logged.
// - One request per device token; `UNREGISTERED` or an invalid token removes it from the store.
// - Topics are supported; FCM has no receipts (`unsupported`).
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
import { FCM_SCOPE } from "@infrabyx/crypto";
import { googleServiceAccountToken } from "../core/google-token.js";
import { createEgress } from "../core/http.js";
import { vendorError } from "../messaging/common.js";
import { guardPush, unsupported } from "./common.js";

export type FcmCredentials =
  | {
      kind: "service_account";
      clientEmail: string;
      /** `secrets/<env>/push/fcm/service_account_key` (PKCS#8 PEM). */
      privateKey: () => Promise<string> | string;
      privateKeyId?: string;
    }
  | { kind: "access_token"; accessToken: () => Promise<string> | string };

export interface FcmPushOptions {
  store: PushTokenStore;
  dpaRef: string;
  /** `int.push.fcm_project_id`. */
  projectId: string;
  credentials: FcmCredentials;
  /** `int.push.apns_topic` (the iOS bundle id), when iOS devices are served through FCM. */
  apnsTopic?: string;
  /** Tests only: the FCM and token-endpoint stubs. */
  baseUrl?: string;
  tokenUrl?: string;
  allowLoopbackHttp?: boolean;
  now?: () => number;
}

const BASE = "https://fcm.googleapis.com";
const TOPIC = /^[a-zA-Z0-9-_.~%]{1,900}$/;

export class FcmPush implements PushPort {
  readonly descriptor: AdapterDescriptor;
  private readonly egress;
  private readonly base: string;
  private readonly token: () => Promise<string>;

  constructor(private readonly o: FcmPushOptions) {
    if (!/^[a-z][a-z0-9-]{4,29}$/.test(o.projectId)) throw new Error("invalid FCM project id");
    this.descriptor = {
      port: "PUSH",
      adapter: "fcm",
      residency: "GLOBAL",
      maxDataClass: "INTERNAL",
      capabilities: { receipts: "unsupported" },
      dpaRef: o.dpaRef,
    };
    this.base = (o.baseUrl ?? BASE).replace(/\/$/, "");
    this.egress = createEgress({
      port: "PUSH",
      adapter: "fcm",
      allow: ["fcm.googleapis.com", "oauth2.googleapis.com"],
      retries: 1,
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
    const c = o.credentials;
    this.token =
      c.kind === "access_token"
        ? async () => c.accessToken()
        : googleServiceAccountToken({
            port: "PUSH",
            adapter: "fcm",
            clientEmail: c.clientEmail,
            privateKey: c.privateKey,
            ...(c.privateKeyId ? { privateKeyId: c.privateKeyId } : {}),
            scope: FCM_SCOPE,
            ...(o.tokenUrl ? { tokenUrl: o.tokenUrl } : {}),
            ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
            ...(o.now ? { now: o.now } : {}),
          });
  }

  async register(
    deviceToken: string,
    platform: PushPlatform,
    userId: string,
  ): Promise<{ tokenRef: string }> {
    if (!/^[A-Za-z0-9_:-]{20,4096}$/.test(deviceToken))
      throw vendorError("PUSH", "fcm", 400, "not an FCM registration token");
    return this.o.store.save({ userId, platform, provider: "fcm", token: deviceToken });
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
    const tokens = await this.o.store.forUsers(userIds, "fcm");
    const tickets: PushSendResult["tickets"] = [];
    for (const t of tokens) {
      const res = await this.call({ token: t.token, ...this.body(n) });
      if (res.status === 200) {
        const name = (res.json() as { name?: string }).name;
        tickets.push({
          tokenRef: t.tokenRef,
          status: "accepted",
          ...(name ? { vendorId: name } : {}),
        });
        continue;
      }
      const code = fcmErrorCode(res.json());
      if (
        res.status === 404 ||
        code === "UNREGISTERED" ||
        (res.status === 400 && code === "INVALID_ARGUMENT")
      ) {
        await this.o.store.remove(t.tokenRef);
        tickets.push({ tokenRef: t.tokenRef, status: "invalid_token" });
      } else if (res.status === 429 || code === "QUOTA_EXCEEDED")
        tickets.push({ tokenRef: t.tokenRef, status: "rate_limited" });
      else if (res.status === 401 || res.status === 403)
        throw vendorError("PUSH", "fcm", res.status, "FCM send");
      else tickets.push({ tokenRef: t.tokenRef, status: "error" });
    }
    return { tickets };
  }

  async sendTopic(
    topic: string,
    notification: PushNotification,
    call?: PortCall,
  ): Promise<{ vendorId: string }> {
    const n = guardPush(notification, call);
    if (!TOPIC.test(topic)) throw vendorError("PUSH", "fcm", 400, "invalid topic");
    const res = await this.call({ topic, ...this.body(n) });
    if (res.status !== 200) throw vendorError("PUSH", "fcm", res.status, "FCM topic send");
    return { vendorId: (res.json() as { name: string }).name };
  }

  async receipts(): Promise<PushReceipt[]> {
    throw unsupported("fcm", "receipts");
  }

  async health(): Promise<PortHealth> {
    const started = performance.now();
    let status: PortHealth["status"] = "up";
    try {
      await this.accessToken();
    } catch {
      status = "down";
    }
    return {
      status,
      latency_ms: Math.round(performance.now() - started),
      checked_at: new Date().toISOString(),
    };
  }

  private body(n: PushNotification): Record<string, unknown> {
    return {
      notification: { title: n.title },
      data: { deep_link: n.deepLink, ...(n.data ?? {}) },
      android: { priority: "high" },
      ...(this.o.apnsTopic ? { apns: { headers: { "apns-topic": this.o.apnsTopic } } } : {}),
    };
  }

  private async call(message: Record<string, unknown>) {
    const token = await this.accessToken();
    return this.egress(`${this.base}/v1/projects/${this.o.projectId}/messages:send`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ message }),
    });
  }

  /** The OAuth access token, cached until 5 minutes before expiry (PL3-C-01). */
  private accessToken(): Promise<string> {
    return this.token();
  }
}

function fcmErrorCode(body: unknown): string | undefined {
  const e = (body as { error?: { status?: string; details?: Array<{ errorCode?: string }> } })
    ?.error;
  return e?.details?.find((d) => d.errorCode)?.errorCode ?? e?.status;
}
