// PR-UDF-046 (R1-D-199): a V-CIP webhook verified without a vendor call. `standardWebhookKycVerifier`
// checks the size, then Standard Webhooks (C-13), then the replay claim, then the session id; the
// router never moves a refused webhook to another adapter, and moves past one that lacks it.
import { describe, expect, it } from "vitest";
import { MemoryReplayStore, signStandardWebhookForTest } from "@infrabyx/crypto";
import { KYC_WEBHOOK_MAX_BODY_BYTES, type KycPort } from "@infrabyx/contracts/ports";
import { FakeKyc, signFakeKycWebhook } from "@infrabyx/testing";
import { kycMethodRouter } from "../routing.js";
import { standardWebhookKycVerifier } from "../webhook.js";

const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const current = `whsec_${Buffer.alloc(32, 1).toString("base64")}`;
const previous = `whsec_${Buffer.alloc(32, 2).toString("base64")}`;
const sign = (body: Uint8Array, secret: string, id: string, at: Date) => {
  const timestamp = String(Math.floor(at.getTime() / 1000));
  return {
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": signStandardWebhookForTest(secret, id, timestamp, body),
  };
};

describe("standardWebhookKycVerifier (PR-UDF-046)", () => {
  const now = new Date("2026-11-19T06:00:00Z");
  const make = () => {
    let reads = 0;
    const verify = standardWebhookKycVerifier({
      adapter: "provider-kyc",
      secrets: async () => (reads++, [current, previous]),
      replay: new MemoryReplayStore(() => now),
      vcipIdOf: (b) => (b as { data?: { session?: unknown } }).data?.session,
      now: () => now,
    });
    return { verify, reads: () => reads };
  };
  const body = enc({ type: "vcip.completed", data: { session: "vcip_provider_1" } });

  it("answers ids and the time for either secret of a rotation; a retry with a new timestamp verifies", async () => {
    const { verify } = make();
    expect(await verify(body, sign(body, current, "msg_1", now))).toEqual({
      eventId: "msg_1",
      vcipId: "vcip_provider_1",
      receivedAt: now.toISOString(),
    });
    expect((await verify(body, sign(body, previous, "msg_2", now))).eventId).toBe("msg_2");
    const retry = sign(body, current, "msg_1", new Date(now.getTime() - 30_000));
    expect((await verify(body, retry)).eventId).toBe("msg_1");
  });

  it("refuses IPB-API-018 with a fixed label; an oversize body before the secrets are read", async () => {
    const { verify, reads } = make();
    const r = (reason: string) => ({ code: "IPB-API-018", meta: { reason, definite: true } });
    const big = new Uint8Array(KYC_WEBHOOK_MAX_BODY_BYTES + 1);
    await expect(verify(big, sign(big, current, "msg_big", now))).rejects.toMatchObject(
      r("body_too_large"),
    );
    expect(reads()).toBe(0);
    const other = `whsec_${Buffer.alloc(32, 3).toString("base64")}`;
    await expect(verify(body, sign(body, other, "msg_3", now))).rejects.toMatchObject(
      r("signature_invalid"),
    );
    await expect(
      verify(body, sign(body, current, "msg_4", new Date(now.getTime() - 301_000))),
    ).rejects.toMatchObject(r("timestamp_stale"));
    const h = sign(body, current, "msg_5", now);
    await verify(body, h);
    await expect(verify(body, h)).rejects.toMatchObject(r("event_replayed"));
    await expect(verify(body, {})).rejects.toMatchObject(r("signature_invalid"));
  });
});

describe("kycMethodRouter and webhooks (PR-UDF-046)", () => {
  const event = (vcipId: string) => enc({ vcipId });

  it("a refused webhook is final; an adapter without verifyWebhook is passed over", async () => {
    const fake = new FakeKyc();
    let otherCalls = 0;
    const other = {
      descriptor: { port: "KYC", adapter: "other-kyc", residency: "IN", maxDataClass: "REGULATED" },
      health: async () => ({ status: "up", latency_ms: 0, checked_at: new Date().toISOString() }),
      verifyWebhook: async () => {
        otherCalls++;
        return { eventId: "x", vcipId: "vcip_x", receivedAt: new Date().toISOString() };
      },
    } as unknown as KycPort;
    const router = kycMethodRouter({ adapters: [fake, other] });
    const b = event("vcip_1");
    await expect(router.verifyWebhook!(b, {})).rejects.toMatchObject({ code: "IPB-API-018" });
    await expect(router.handleWebhook(b, {})).rejects.toMatchObject({ code: "IPB-API-018" });
    expect(otherCalls).toBe(0);
    const lacking = { ...other, descriptor: { ...other.descriptor, adapter: "lacking-kyc" } };
    delete (lacking as Partial<KycPort>).verifyWebhook;
    const through = kycMethodRouter({ adapters: [lacking as KycPort, fake] });
    expect((await through.verifyWebhook!(b, signFakeKycWebhook(b))).vcipId).toBe("vcip_1");
  });
});
