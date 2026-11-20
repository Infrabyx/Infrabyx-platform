// The generic Standard Webhooks v1 receiver (PR-UDF-064, R1-D-238; IPB-10-21; C-13 as widened by
// owner answer #150).
import { describe, expect, it } from "vitest";
import { MemoryReplayStore } from "./regulated-jws.js";
import { signStandardWebhookForTest } from "./webhook-sig.js";
import {
  STANDARD_WEBHOOK_MAX_BODY_BYTES,
  STANDARD_WEBHOOK_REFUSALS,
  StandardWebhookReceiver,
  type StandardWebhookResult,
} from "./webhook-receiver.js";

const secretA = `whsec_${Buffer.alloc(32, 1).toString("base64")}`;
const secretB = `whsec_${Buffer.alloc(32, 2).toString("base64")}`;
const body = Buffer.from('{"type":"partner.event","data":{"ref":"evt-1"}}');
const t0 = new Date("2026-11-20T12:00:00Z");
const ts = (d: Date) => String(Math.floor(d.getTime() / 1000));

function delivery(o: { secret?: string; id?: string; at?: Date; raw?: Uint8Array } = {}) {
  const id = o.id ?? "msg_2pY7c1";
  const timestamp = ts(o.at ?? t0);
  return {
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": signStandardWebhookForTest(
      o.secret ?? secretA,
      id,
      timestamp,
      o.raw ?? body,
    ),
  };
}

function receiver(
  o: {
    secrets?: string[];
    now?: Date;
    replayKey?: "delivery" | "event";
    maxBodyBytes?: number;
  } = {},
) {
  let now = o.now ?? t0;
  const replay = new MemoryReplayStore(() => now);
  const r = new StandardWebhookReceiver({
    name: "partner-events",
    secrets: async () => o.secrets ?? [secretA],
    replay,
    now: () => now,
    ...(o.replayKey ? { replayKey: o.replayKey } : {}),
    ...(o.maxBodyBytes ? { maxBodyBytes: o.maxBodyBytes } : {}),
  });
  return { r, setNow: (d: Date) => (now = d) };
}

const reason = (x: StandardWebhookResult) => (x.ok ? "ok" : x.reason);

describe("@IPB-10-AT-12 Standard Webhooks receiver", () => {
  it("accepts a valid delivery and returns its id and signed timestamp", async () => {
    const { r } = receiver();
    const got = await r.receive(body, delivery());
    expect(got).toEqual({
      ok: true,
      id: "msg_2pY7c1",
      timestamp: new Date(Math.floor(t0.getTime() / 1000) * 1000),
      receivedAt: t0,
    });
  });

  it("reads Fetch Headers as well as Node's header record (any case)", async () => {
    const { r } = receiver();
    expect((await r.receive(body, new Headers(delivery()))).ok).toBe(true);
    const upper = Object.fromEntries(
      Object.entries(delivery({ id: "msg_upper" })).map(([k, v]) => [k.toUpperCase(), v]),
    );
    expect((await r.receive(body, upper)).ok).toBe(true);
  });

  it("refuses a bad signature, a changed body and the wrong secret", async () => {
    const { r } = receiver();
    const h = delivery();
    expect(reason(await r.receive(body, { ...h, "webhook-signature": "v1,AAAA" }))).toBe(
      "signature_invalid",
    );
    expect(reason(await r.receive(Buffer.from(body.toString().replace("evt-1", "evt-2")), h))).toBe(
      "signature_invalid",
    );
    expect(reason(await r.receive(body, delivery({ secret: secretB })))).toBe("signature_invalid");
    // v1a (Ed25519) is not an approved algorithm, so it is never read.
    expect(reason(await r.receive(body, { ...h, "webhook-signature": "v1a,AAAA" }))).toBe(
      "signature_invalid",
    );
  });

  it("refuses a stale or future timestamp (an attacker's replay after 10 minutes)", async () => {
    const { r } = receiver({ now: new Date(t0.getTime() + 10 * 60_000) });
    expect(reason(await r.receive(body, delivery()))).toBe("timestamp_stale");
    const { r: early } = receiver({ now: new Date(t0.getTime() - 6 * 60_000) });
    expect(reason(await early.receive(body, delivery()))).toBe("timestamp_stale");
  });

  it("refuses the same delivery twice; a signed retry of the event verifies (delivery key)", async () => {
    const { r } = receiver();
    expect((await r.receive(body, delivery())).ok).toBe(true);
    expect(reason(await r.receive(body, delivery()))).toBe("replayed");
    const retry = delivery({ at: new Date(t0.getTime() + 30_000) });
    expect((await r.receive(body, retry)).ok).toBe(true);
  });

  it("with replayKey event, refuses the same webhook-id inside the window", async () => {
    const { r } = receiver({ replayKey: "event" });
    expect((await r.receive(body, delivery())).ok).toBe(true);
    const retry = delivery({ at: new Date(t0.getTime() + 30_000) });
    expect(reason(await r.receive(body, retry))).toBe("replayed");
  });

  it("claims only after the signature verified: a forgery cannot burn a real delivery", async () => {
    const { r } = receiver();
    const real = delivery();
    expect(reason(await r.receive(body, { ...real, "webhook-signature": "v1,AAAA" }))).toBe(
      "signature_invalid",
    );
    expect((await r.receive(body, real)).ok).toBe(true);
  });

  it("verifies with either secret during a rotation (two v1 signatures or one)", async () => {
    const { r } = receiver({ secrets: [secretB, secretA] });
    expect((await r.receive(body, delivery({ id: "msg_a" }))).ok).toBe(true);
    expect((await r.receive(body, delivery({ id: "msg_b", secret: secretB }))).ok).toBe(true);
    const id = "msg_both";
    const both = delivery({ id });
    const second = delivery({ id, secret: secretB })["webhook-signature"];
    both["webhook-signature"] = `${both["webhook-signature"]} ${second}`;
    expect((await receiver({ secrets: [secretB] }).r.receive(body, both)).ok).toBe(true);
    const three = receiver({ secrets: [secretA, secretB, secretA] }).r;
    await expect(three.receive(body, delivery())).rejects.toThrow(RangeError);
  });

  it("refuses missing, repeated and malformed headers, and an oversize body first", async () => {
    const { r } = receiver();
    const h = delivery();
    for (const k of Object.keys(h)) {
      const { [k as keyof typeof h]: _drop, ...rest } = h;
      expect(reason(await r.receive(body, rest))).toBe("headers_missing");
    }
    expect(reason(await r.receive(body, { ...h, "webhook-id": [h["webhook-id"], "x"] }))).toBe(
      "headers_malformed",
    );
    expect(reason(await r.receive(body, { ...h, "Webhook-Id": "msg_dup" }))).toBe(
      "headers_malformed",
    );
    expect(reason(await r.receive(body, { ...h, "webhook-timestamp": "12:00" }))).toBe(
      "headers_malformed",
    );
    expect(reason(await r.receive(body, { ...h, "webhook-id": "has space" }))).toBe(
      "headers_malformed",
    );
    const big = Buffer.alloc(STANDARD_WEBHOOK_MAX_BODY_BYTES + 1, 0x20);
    expect(reason(await r.receive(big, {}))).toBe("body_too_large");
    const small = receiver({ maxBodyBytes: 16 }).r;
    expect(reason(await small.receive(body, h))).toBe("body_too_large");
  });

  it("returns only fixed labels, never a header or body value", async () => {
    const { r } = receiver();
    const got = await r.receive(body, { ...delivery(), "webhook-signature": "v1,AAAA" });
    expect(Object.keys(got)).toEqual(["ok", "reason"]);
    expect(STANDARD_WEBHOOK_REFUSALS).toContain(reason(got));
  });

  it("refuses a configuration outside C-13: a window over five minutes, a bad name or limit", () => {
    const base = { name: "x", secrets: () => [secretA], replay: new MemoryReplayStore() };
    expect(() => new StandardWebhookReceiver({ ...base, toleranceSeconds: 301 })).toThrow(
      RangeError,
    );
    expect(() => new StandardWebhookReceiver({ ...base, toleranceSeconds: 0 })).toThrow(RangeError);
    expect(() => new StandardWebhookReceiver({ ...base, name: "Bad Name" })).toThrow(RangeError);
    expect(() => new StandardWebhookReceiver({ ...base, maxBodyBytes: 2_000_000 })).toThrow(
      RangeError,
    );
    expect(() => new StandardWebhookReceiver({ ...base, toleranceSeconds: 60 })).not.toThrow();
  });
});
