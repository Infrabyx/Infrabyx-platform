// C-13 vendor signatures and SNS verification; C-19 webhook secrets.
import { execFileSync } from "node:child_process";
import { createHmac, sign as nodeSign, createPrivateKey } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  generateWebhookSecret,
  snsCertUrlAllowed,
  verifyCashfreeSignature,
  verifyMetaSignature,
  verifyRazorpaySignature,
  verifySnsMessage,
  verifyStandardWebhook,
  signStandardWebhookForTest,
  verifyWebhookSecret,
  type SnsMessage,
} from "./webhook-sig.js";

const body = Buffer.from('{"event":"payment.captured","payload":{"amount":50000}}');
const secret = "x".repeat(24); // low-entropy test value
const hmac = (data: Buffer) => createHmac("sha256", secret).update(data).digest();

describe("C-13 vendor HMAC signatures", () => {
  it("Razorpay: hex HMAC of the raw body; any change fails", () => {
    const sig = hmac(body).toString("hex");
    expect(verifyRazorpaySignature(secret, body, sig)).toBe(true);
    expect(verifyRazorpaySignature(secret, body, sig.toUpperCase())).toBe(true);
    expect(
      verifyRazorpaySignature(secret, Buffer.from(body.toString().replace("50000", "50001")), sig),
    ).toBe(false);
    expect(verifyRazorpaySignature("other", body, sig)).toBe(false);
    expect(verifyRazorpaySignature(secret, body, sig.slice(0, 62))).toBe(false);
    expect(verifyRazorpaySignature(secret, body, "zz")).toBe(false);
  });

  it("Cashfree: base64 HMAC of timestamp ‖ body inside ±5 min", () => {
    const now = Date.UTC(2026, 9, 26, 12);
    for (const ts of [String(now / 1000), String(now)]) {
      const sig = hmac(Buffer.concat([Buffer.from(ts), body])).toString("base64");
      expect(verifyCashfreeSignature(secret, body, ts, sig, { now })).toBe(true);
      expect(verifyCashfreeSignature(secret, body, ts, sig, { now: now + 301_000 })).toBe(false);
      expect(verifyCashfreeSignature(secret, body, ts, sig.replace(/=*$/, ""), { now })).toBe(
        false,
      );
    }
    expect(verifyCashfreeSignature(secret, body, "abc", "AAAA", { now })).toBe(false);
  });

  it("Meta: sha256=<hex> over the raw body with the app secret", () => {
    const sig = `sha256=${hmac(body).toString("hex")}`;
    expect(verifyMetaSignature(secret, body, sig)).toBe(true);
    expect(verifyMetaSignature(secret, body, sig.replace("sha256=", "sha1="))).toBe(false);
    expect(verifyMetaSignature(secret, Buffer.from(`${body} `), sig)).toBe(false);
  });

  it("C-19: webhook secrets are 32 random bytes, base64url", () => {
    const a = generateWebhookSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
    expect(generateWebhookSecret()).not.toBe(a);
  });

  it("C-19: a presented webhook secret is compared in constant time; short secrets never match", () => {
    const s = generateWebhookSecret();
    expect(verifyWebhookSecret(s, s)).toBe(true);
    expect(verifyWebhookSecret(s, `${s}x`)).toBe(false);
    expect(verifyWebhookSecret(s, s.slice(0, -1))).toBe(false);
    expect(verifyWebhookSecret(s, "")).toBe(false);
    expect(verifyWebhookSecret("short", "short")).toBe(false);
  });
});

describe("C-13 Amazon SNS SignatureVersion 2", () => {
  const regions = ["ap-south-1", "ap-south-2"];
  const topicArn = "arn:aws:sns:ap-south-1:111122223333:ses-events-ld";
  const certUrl =
    "https://sns.ap-south-1.amazonaws.com/SimpleNotificationService-0123456789abcdef.pem";
  let dir: string;
  let certPem: string;
  let keyPem: string;
  beforeAll(() => {
    // A throwaway self-signed certificate generated per run; no key material is committed.
    dir = mkdtempSync(join(tmpdir(), "sns-"));
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "2",
        "-subj",
        "/CN=sns.ap-south-1.amazonaws.com",
        "-keyout",
        join(dir, "k.pem"),
        "-out",
        join(dir, "c.pem"),
      ],
      { stdio: "ignore" },
    );
    certPem = readFileSync(join(dir, "c.pem"), "utf8");
    keyPem = readFileSync(join(dir, "k.pem"), "utf8");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const signed = (m: Omit<SnsMessage, "Signature">): SnsMessage => {
    const f =
      m.Type === "Notification"
        ? [
            "Message",
            "MessageId",
            ...(m.Subject ? ["Subject"] : []),
            "Timestamp",
            "TopicArn",
            "Type",
          ]
        : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
    const s = f.map((k) => `${k}\n${(m as unknown as Record<string, string>)[k]}\n`).join("");
    return {
      ...m,
      Signature: nodeSign("sha256", Buffer.from(s), createPrivateKey(keyPem)).toString("base64"),
    };
  };
  const note = (over: Partial<SnsMessage> = {}) =>
    signed({
      Type: "Notification",
      MessageId: "a1b2",
      TopicArn: topicArn,
      Message: '{"eventType":"Bounce"}',
      Timestamp: "2026-10-26T12:00:00.000Z",
      SignatureVersion: "2",
      SigningCertURL: certUrl,
      ...over,
    });
  const opts = () => ({ topicArn, regions, fetchCertificate: async () => certPem });

  it("accepts a signed notification and a subscription confirmation", async () => {
    expect(await verifySnsMessage(note(), opts())).toBeNull();
    expect(
      await verifySnsMessage(note({ Subject: "Amazon SES Email Event Notification" }), opts()),
    ).toBeNull();
    const conf = signed({
      Type: "SubscriptionConfirmation",
      MessageId: "c1",
      TopicArn: topicArn,
      Message: "You have chosen to subscribe",
      Timestamp: "2026-10-26T12:00:00.000Z",
      SignatureVersion: "2",
      SigningCertURL: certUrl,
      Token: "tok",
      SubscribeURL: "https://sns.ap-south-1.amazonaws.com/?Action=ConfirmSubscription",
    });
    expect(await verifySnsMessage(conf, opts())).toBeNull();
  });

  it("refuses SignatureVersion 1, another topic, a tampered message and a bad certificate", async () => {
    expect(await verifySnsMessage(note({ SignatureVersion: "1" }), opts())).toBe(
      "signature_version",
    );
    expect(await verifySnsMessage(note({ TopicArn: `${topicArn}-x` }), opts())).toBe("topic");
    expect(await verifySnsMessage({ ...note(), Message: '{"eventType":"Delivery"}' }, opts())).toBe(
      "signature",
    );
    expect(
      await verifySnsMessage(note(), { ...opts(), fetchCertificate: async () => "not a cert" }),
    ).toBe("certificate");
    expect(await verifySnsMessage(note(), { ...opts(), now: Date.now() + 5 * 86_400_000 })).toBe(
      "certificate",
    );
  });

  it.each([
    ["http://sns.ap-south-1.amazonaws.com/SimpleNotificationService-ab.pem", false],
    ["https://sns.us-east-1.amazonaws.com/SimpleNotificationService-ab.pem", false],
    ["https://sns.ap-south-1.amazonaws.com.evil.example/SimpleNotificationService-ab.pem", false],
    ["https://sns.ap-south-1.amazonaws.com:8443/SimpleNotificationService-ab.pem", false],
    ["https://sns.ap-south-1.amazonaws.com/SimpleNotificationService-ab.pem?x=1", false],
    ["https://sns.ap-south-1.amazonaws.com/other.pem", false],
    ["https://sns.ap-south-2.amazonaws.com/SimpleNotificationService-ab.pem", true],
  ])("signing certificate URL %s allowed: %s", (url, ok) => {
    expect(snsCertUrlAllowed(url, regions)).toBe(ok);
  });
});

describe("C-13 Standard Webhooks v1 (IPB-10-21; PR-UDF-046)", () => {
  // The specification's own example (standard-webhooks spec, "Verifying a signature"); a public
  // test vector, built here so a secret scanner does not read it as a credential.
  const vector = "MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
  const spec = {
    secret: `whsec_${vector}`,
    id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
    timestamp: "1614265330",
    body: Buffer.from('{"test": 2432232314}'),
    signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
  };
  const at = Number(spec.timestamp) * 1000;
  const h = (over: Partial<typeof spec> = {}) => ({
    id: over.id ?? spec.id,
    timestamp: over.timestamp ?? spec.timestamp,
    signature: over.signature ?? spec.signature,
  });

  it("verifies the specification's example, and signs it the same way", () => {
    expect(verifyStandardWebhook([spec.secret], spec.body, h(), { now: at })).toBeNull();
    expect(signStandardWebhookForTest(spec.secret, spec.id, spec.timestamp, spec.body)).toBe(
      spec.signature,
    );
  });

  it("accepts any v1 entry and any secret during rotation; ignores v1a and other versions", () => {
    const other = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;
    const both = `v1a,${"A".repeat(86)}== v1,${"B".repeat(43)}= ${spec.signature}`;
    expect(
      verifyStandardWebhook([other, spec.secret], spec.body, h({ signature: both }), {
        now: at,
      }),
    ).toBeNull();
    expect(
      verifyStandardWebhook(
        [spec.secret],
        spec.body,
        h({ signature: `v1a,${spec.signature.slice(3)}` }),
        {
          now: at,
        },
      ),
    ).toBe("signature");
    expect(verifyStandardWebhook([other], spec.body, h(), { now: at })).toBe("signature");
  });

  it("refuses a changed body, id or timestamp, a stale or future timestamp and malformed headers", () => {
    const ok = { now: at };
    expect(verifyStandardWebhook([spec.secret], Buffer.from('{"test": 2432232315}'), h(), ok)).toBe(
      "signature",
    );
    expect(verifyStandardWebhook([spec.secret], spec.body, h({ id: "msg_other" }), ok)).toBe(
      "signature",
    );
    expect(verifyStandardWebhook([spec.secret], spec.body, h(), { now: at + 301_000 })).toBe(
      "timestamp",
    );
    expect(verifyStandardWebhook([spec.secret], spec.body, h(), { now: at - 301_000 })).toBe(
      "timestamp",
    );
    expect(verifyStandardWebhook([spec.secret], spec.body, h(), { now: at + 299_000 })).toBeNull();
    for (const bad of [
      h({ id: "" }),
      h({ id: "has space" }),
      h({ timestamp: "1614265330.5" }),
      h({ timestamp: "" }),
      h({ signature: "v1," + "A".repeat(5000) }),
    ])
      expect(verifyStandardWebhook([spec.secret], spec.body, bad, ok)).toBe("headers");
    expect(verifyStandardWebhook([spec.secret], spec.body, h({ signature: "" }), ok)).toBe(
      "signature",
    );
    expect(verifyStandardWebhook([spec.secret], spec.body, h({ signature: "v1,***" }), ok)).toBe(
      "signature",
    );
  });

  it("throws on a secret that is not whsec_ and 24 to 64 bytes, or none", () => {
    for (const s of [vector, "whsec_c2hvcnQ=", `whsec_${"A".repeat(90)}`])
      expect(() => verifyStandardWebhook([s], spec.body, h(), { now: at })).toThrow(RangeError);
    expect(() => verifyStandardWebhook([], spec.body, h(), { now: at })).toThrow(RangeError);
  });
});
