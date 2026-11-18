// SES email receiving (PR-LDC-50; R1-D-177; plan `docs/phases/R1-inbound-mail-plan.md` §3). The
// `Received` notification is an SNS message signed with a throwaway certificate (C-13), as the
// delivery events are. The S3 action is exercised against moto in `email.contract.test.ts`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createSnsSigner,
  defineEmailInboundContract,
  type InboundFixture,
  type SnsSigner,
} from "@infrabyx/testing";
import { SesEmail, parseReceived } from "../ses.js";

const EVENTS = "arn:aws:sns:ap-south-1:111122223333:ses-events-ld";
const INBOUND = "arn:aws:sns:ap-south-1:111122223333:ses-inbound-ld";
let signer: SnsSigner;
// The adapter's clock, a minute after the real one. The throwaway certificate is minted by openssl
// with the real clock (valid from now, for two days), so a fixed date here stops working once that
// date is passed or two days old (it broke at 06:00 UTC on 18 Nov 2026).
const NOW = Date.now() + 60_000;

const adapter = (o: { inbound?: boolean } = {}) =>
  new SesEmail({
    region: "ap-south-1",
    brands: { ld: { from: "noreply@ld.example.test", configurationSet: "ld" } },
    events: { topicArn: EVENTS },
    ...(o.inbound === false ? {} : { inbound: { topicArn: INBOUND } }),
    fetchCertificate: async (u) => {
      if (u !== signer.certUrl) throw new Error("unexpected certificate URL");
      return signer.certPem;
    },
    now: () => NOW,
  });

const MIME =
  "From: Asha <asha@client.example>\r\nTo: reply+abc@reply.ld.example\r\n" +
  "Authentication-Results: mx.forged.example; dmarc=pass; dkim=pass; spf=pass\r\n" +
  "Subject: Re: note\r\n\r\nThanks, noted.\r\n";

const received = (over: Record<string, unknown> = {}, receipt: Record<string, unknown> = {}) =>
  JSON.stringify({
    notificationType: "Received",
    mail: {
      messageId: "o3vrnil0e2ic28trm7dfhrc2v0clambda4nbp0g1",
      timestamp: "2026-11-18T05:59:58.000Z",
      source: "Asha@Client.Example",
      destination: ["reply+abc@reply.ld.example"],
    },
    receipt: {
      timestamp: "2026-11-18T05:59:58.500Z",
      recipients: ["Reply+ABC@reply.ld.example"],
      spfVerdict: { status: "PASS" },
      dkimVerdict: { status: "PASS" },
      dmarcVerdict: { status: "PASS" },
      spamVerdict: { status: "PASS" },
      virusVerdict: { status: "PASS" },
      action: { type: "SNS", topicArn: INBOUND, encoding: "UTF8" },
      ...receipt,
    },
    content: MIME,
    ...over,
  });

const post = (message: string, o: { topic?: string; at?: number; type?: string } = {}) =>
  new TextEncoder().encode(
    JSON.stringify(
      signer.sign({
        Type: o.type ?? "Notification",
        MessageId: "6f0a5bde-3bb4-5d2d-a9f2-30f1c2b0d0aa",
        TopicArn: o.topic ?? INBOUND,
        Subject: "Amazon SES Email Receipt Notification",
        Message: message,
        Timestamp: new Date(o.at ?? NOW - 2000).toISOString(),
      } as Parameters<SnsSigner["sign"]>[0]),
    ),
  );

beforeAll(() => {
  signer = createSnsSigner();
});
afterAll(() => signer?.close());

describe("@IPB-01-15 SES inbound route (PR-LDC-50)", () => {
  it("turns a signed Received notification into one InboundEmail, verdicts from the receipt", async () => {
    const [m, ...rest] = await adapter().verifyInbound(post(received()), {});
    expect(rest).toEqual([]);
    expect(m).toMatchObject({
      adapter: "ses",
      vendorMessageId: "o3vrnil0e2ic28trm7dfhrc2v0clambda4nbp0g1",
      receivedAt: "2026-11-18T05:59:58.000Z",
      envelopeFrom: "asha@client.example",
      recipients: ["reply+abc@reply.ld.example"],
      auth: { spf: "pass", dkimAligned: "pass", dmarc: "pass" },
    });
    expect(new TextDecoder().decode(m?.raw)).toBe(MIME);
  });

  it("takes the verdicts only from the signed receipt, never from the message's headers", async () => {
    const [m] = await adapter().verifyInbound(
      post(
        received(
          {},
          {
            spfVerdict: { status: "GRAY" },
            dkimVerdict: { status: "FAIL" },
            dmarcVerdict: { status: "FAIL" },
          },
        ),
      ),
      { "authentication-results": "dmarc=pass" },
    );
    expect(m?.auth).toEqual({ spf: "none", dkimAligned: "fail", dmarc: "fail" });
  });

  it("maps PROCESSING_FAILED, a missing verdict and an unknown status to error (fail closed)", async () => {
    const [m] = await adapter().verifyInbound(
      post(
        received(
          {},
          {
            spfVerdict: { status: "PROCESSING_FAILED" },
            dkimVerdict: undefined,
            dmarcVerdict: { status: "MAYBE" },
          },
        ),
      ),
      {},
    );
    expect(m?.auth).toEqual({ spf: "error", dkimAligned: "error", dmarc: "error" });
  });

  it("decodes Base64 content", async () => {
    const [m] = await adapter().verifyInbound(
      post(
        received(
          { content: Buffer.from(MIME).toString("base64") },
          { action: { type: "SNS", topicArn: INBOUND, encoding: "BASE64" } },
        ),
      ),
      {},
    );
    expect(new TextDecoder().decode(m?.raw)).toBe(MIME);
  });

  it("refuses the delivery-events topic, a bad signature and a stale message", async () => {
    await expect(adapter().verifyInbound(post(received(), { topic: EVENTS }), {})).rejects.toThrow(
      /SNS topic/,
    );
    const body = JSON.parse(new TextDecoder().decode(post(received()))) as Record<string, string>;
    body.Message = received({ content: MIME.replace("noted", "approved") });
    await expect(
      adapter().verifyInbound(new TextEncoder().encode(JSON.stringify(body)), {}),
    ).rejects.toThrow(/SNS signature/);
    await expect(
      adapter().verifyInbound(post(received(), { at: NOW - 2 * 3600_000 }), {}),
    ).rejects.toThrow(/timestamp window/);
  });

  it("refuses another notification type, another action and a missing recipient or id", async () => {
    await expect(
      adapter().verifyInbound(post(received({ notificationType: "Bounce" })), {}),
    ).rejects.toThrow(/Received/);
    await expect(
      adapter().verifyInbound(post(received({}, { action: { type: "Lambda" } })), {}),
    ).rejects.toThrow(/not taken/);
    await expect(
      adapter().verifyInbound(post(received({}, { recipients: [] })), {}),
    ).rejects.toThrow(/recipient/);
    await expect(
      adapter().verifyInbound(post(received({ mail: { messageId: "../x" } })), {}),
    ).rejects.toThrow(/message id/);
    await expect(
      adapter().verifyInbound(post(received({}, { action: { type: "S3", bucketName: "b" } })), {}),
    ).rejects.toThrow(/no inbound bucket/);
  });

  it("refuses a message over 10 MiB", async () => {
    const big = "x".repeat(10 * 1024 * 1024 + 1);
    await expect(
      adapter().verifyInbound(post(received({ content: big })), {}),
    ).rejects.toMatchObject({ code: "IPB-SEC-013" });
  });

  it("is not offered without an inbound topic, and the topics must differ", async () => {
    await expect(
      adapter({ inbound: false }).verifyInbound(post(received()), {}),
    ).rejects.toMatchObject({ code: "IPB-PORT-001" });
    expect(
      () =>
        new SesEmail({
          region: "ap-south-1",
          brands: {},
          events: { topicArn: EVENTS },
          inbound: { topicArn: EVENTS },
        }),
    ).toThrow(/must not be the delivery-events topic/);
    expect(
      () =>
        new SesEmail({
          region: "ap-south-1",
          brands: {},
          events: { topicArn: EVENTS },
          inbound: {
            topicArn: INBOUND,
            bucket: { name: "b", region: "us-east-1" as "ap-south-1" },
          },
        }),
    ).toThrow(/outside India/);
    expect(adapter().descriptor.capabilities).toMatchObject({ inbound: "native" });
  });

  it("parseReceived keeps an unparseable envelope sender empty and lower-cases recipients", () => {
    const n = parseReceived(received({ mail: { messageId: "abc", source: "<>" } }));
    expect(n.source).toBe("");
    expect(n.recipients).toEqual(["reply+abc@reply.ld.example"]);
    expect(n.receivedAt).toBe("2026-11-18T05:59:58.500Z");
  });
});

/** The shared inbound contract (testing's `defineEmailInboundContract`) on the SES adapter. */
const sesPost = (f: InboundFixture, tamper = false) => {
  const message = received(
    {
      mail: {
        messageId: f.vendorMessageId,
        timestamp: "2026-11-18T05:59:58.000Z",
        source: f.envelopeFrom,
      },
      content: Buffer.from(f.raw).toString("base64"),
    },
    {
      recipients: f.recipients,
      spfVerdict: {
        status: { pass: "PASS", fail: "FAIL", none: "GRAY", error: "PROCESSING_FAILED" }[
          f.auth.spf
        ],
      },
      dkimVerdict: {
        status: { pass: "PASS", fail: "FAIL", none: "GRAY", error: "PROCESSING_FAILED" }[
          f.auth.dkimAligned
        ],
      },
      dmarcVerdict: {
        status: { pass: "PASS", fail: "FAIL", none: "GRAY", error: "PROCESSING_FAILED" }[
          f.auth.dmarc
        ],
      },
      action: { type: "SNS", topicArn: INBOUND, encoding: "BASE64" },
    },
  );
  const body = post(message);
  if (!tamper) return { body, headers: {} };
  const j = JSON.parse(new TextDecoder().decode(body)) as Record<string, string>;
  j.Message = message.replace(f.vendorMessageId, `${f.vendorMessageId}x`);
  return { body: new TextEncoder().encode(JSON.stringify(j)), headers: {} };
};
defineEmailInboundContract("ses", () => ({
  port: adapter(),
  post: (f) => sesPost(f),
  forge: (f) => sesPost(f, true),
}));
