// EMAIL contract legs (PL2 plan §6.10). Hermetic: the SES v2 stub and the Brevo stub (both from
// the vendors' API definitions; moto 5.2.4 lacks SES v2 templates, suppression and the account
// call), plus moto for SES raw send and identities. SES events are SNS messages signed with a
// throwaway certificate (C-13). The sandbox legs (SES mailbox simulator, Brevo `X-Sib-Sandbox:
// drop`) skip themselves until their accounts exist (IPB-DEV-04).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EmailEvent, EmailMessage, EmailPort } from "@infrabyx/contracts/ports";
import { generateWebhookSecret, ulid } from "@infrabyx/crypto";
import {
  MemoryStorage,
  createSnsSigner,
  defineContractSuite,
  sandboxLeg,
  startBrevoStub,
  startService,
  startSesStub,
  type BrevoStub,
  type ContractCase,
  type SesStub,
  type SnsSigner,
  type StartedService,
} from "@infrabyx/testing";
import { suppressionFor } from "../common.js";
import { BrevoEmail, brevoIdempotencyKey } from "../brevo.js";
import { SesEmail, idempotencyTag } from "../ses.js";

const TOPIC = "arn:aws:sns:ap-south-1:111122223333:ses-events-ld";
const CREDS = { accessKeyId: "test", secretAccessKey: "test" };
const BREVO_IP = "1.179.112.10";
const secret = generateWebhookSecret();
let ses: SesStub;
let brevo: BrevoStub;
let signer: SnsSigner;
let moto: StartedService;
const storage = new MemoryStorage();

const message = (over: Partial<EmailMessage> = {}): EmailMessage => ({
  to: [`user.${ulid().toLowerCase()}@example.test`],
  template: "otp",
  vars: { code: "123456" },
  tags: { flow: "login" },
  brand: "ld",
  ...over,
});

const sesAdapter = () =>
  new SesEmail({
    region: "ap-south-1",
    brands: { ld: { from: "noreply@ld.example.test", configurationSet: "ld-events" } },
    events: { topicArn: TOPIC },
    storage,
    endpoint: ses.url,
    credentials: CREDS,
    fetchCertificate: async (u) => {
      if (u !== signer.certUrl) throw new Error("unexpected certificate URL");
      return signer.certPem;
    },
  });

const brevoAdapter = (o: { from?: string } = {}) =>
  new BrevoEmail({
    apiKey: () => brevo.apiKey,
    brands: {
      ld: { from: o.from ?? "noreply@ld.example.test", templates: { otp: 11, receipt: 12 } },
    },
    dpaRef: "VAR-DPA-BREVO-001",
    webhook: { secret: () => secret },
    storage,
    baseUrl: `${brevo.url}/v3`,
    allowLoopbackHttp: true,
  });

/** Per-adapter view of what the vendor received, and how to build its webhooks. */
interface Harness {
  sent(): Array<{ to: string[]; template: string; tags: string[]; attachments: number }>;
  bounce(
    address: string,
    messageId: string,
  ): { body: Uint8Array; headers: Record<string, string>; ip?: string };
  complaint(
    address: string,
    messageId: string,
  ): { body: Uint8Array; headers: Record<string, string>; ip?: string };
  suppressed(address: string): boolean | "vendor-managed";
}

const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

const sesHarness: Harness = {
  sent: () =>
    ses.messages.map((m) => ({
      to: m.to,
      template: m.template ?? "",
      tags: Object.entries(m.tags).map(([k, v]) => `${k}=${v}`),
      attachments: m.attachments.length,
    })),
  bounce: (address, messageId) => ({
    body: enc(
      signer.sign({
        Type: "Notification",
        MessageId: `sns-${ulid()}`,
        TopicArn: TOPIC,
        Timestamp: new Date().toISOString(),
        Message: JSON.stringify({
          eventType: "Bounce",
          mail: { messageId, timestamp: new Date().toISOString() },
          bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: address }] },
        }),
      }),
    ),
    headers: { "x-amz-sns-message-type": "Notification" },
  }),
  complaint: (address, messageId) => ({
    body: enc(
      signer.sign({
        Type: "Notification",
        MessageId: `sns-${ulid()}`,
        TopicArn: TOPIC,
        Timestamp: new Date().toISOString(),
        Message: JSON.stringify({
          eventType: "Complaint",
          mail: { messageId },
          complaint: { complainedRecipients: [{ emailAddress: address }] },
        }),
      }),
    ),
    headers: {},
  }),
  suppressed: (a) => ses.suppressed.has(a.toLowerCase()),
};

const brevoEvent = (event: string, address: string, messageId: string) => ({
  body: enc({
    event,
    email: address,
    id: 1,
    "message-id": messageId,
    ts_event: Math.floor(Date.now() / 1000),
    ts_epoch: Date.now(),
    tags: ["ipb_brand_ld"],
  }),
  headers: { authorization: `Bearer ${secret}` },
  ip: BREVO_IP,
});

const brevoHarness: Harness = {
  sent: () =>
    brevo.messages.map((m) => ({
      to: m.to,
      template: m.templateId === 11 ? "otp" : String(m.templateId),
      tags: m.tags,
      attachments: m.attachments.length,
    })),
  bounce: (a, id) => brevoEvent("hard_bounce", a, id),
  complaint: (a, id) => brevoEvent("spam", a, id),
  // Brevo blocks hard bounces and complaints itself (PL2-D-64).
  suppressed: () => "vendor-managed",
};

const verify = (p: EmailPort, w: ReturnType<Harness["bounce"]>) =>
  p.verifyWebhook(w.body, w.headers, w.ip ? { sourceIp: w.ip } : {});

const cases = (h: () => Harness): Array<ContractCase<EmailPort>> => [
  {
    name: "send with template and tags reaches the vendor once",
    async run(p) {
      const m = message();
      const before = h().sent().length;
      const { messageId } = await p.send(m);
      expect(messageId).not.toBe("");
      const got = h().sent().slice(before);
      expect(got).toHaveLength(1);
      expect(got[0]!.to).toEqual(m.to);
      expect(got[0]!.template).toBe("otp");
      expect(got[0]!.tags.join(" ")).toMatch(/flow/);
    },
  },
  {
    name: "the idempotency key travels with the send (plan §3.5)",
    async run(p) {
      const key = `idem-${ulid()}`;
      const m = message();
      const a = await p.send(m, { idempotencyKey: key });
      if (p.descriptor.adapter === "brevo") {
        // Brevo de-duplicates on its idempotencyKey and the lookup finds the send by tag.
        const b = await p.send(m, { idempotencyKey: key });
        expect(b.messageId).toBe(a.messageId);
        expect(brevo.messages.filter((x) => x.messageId === a.messageId)).toHaveLength(1);
        expect(brevo.messages.at(-1)!.headers.idempotencyKey).toBe(brevoIdempotencyKey(key));
        const found = await (p as BrevoEmail).lookup("send", key);
        expect(found).toEqual({ status: "found", result: { messageId: a.messageId } });
        expect(await (p as BrevoEmail).lookup("send", `other-${ulid()}`)).toEqual({
          status: "absent",
        });
      } else {
        const tag = idempotencyTag(key);
        expect(ses.messages.at(-1)!.tags[tag.Name!]).toBe(tag.Value);
      }
    },
  },
  {
    name: "status of a sent message",
    method: "getStatus",
    invoke: (p) => p.getStatus("any"),
    async run(p) {
      const { messageId } = await p.send(message());
      expect((await p.getStatus(messageId)).status).toBeTruthy();
    },
  },
  {
    name: "a permanent bounce becomes a suppression",
    async run(p) {
      const m = message();
      const { messageId } = await p.send(m);
      const events = await verify(p, h().bounce(m.to[0]!, messageId));
      expect(events.map((e) => e.type)).toEqual(["bounced"]);
      const s = suppressionFor(events[0]!);
      expect(s).toEqual({ address: m.to[0], reason: "bounce" });
      await p.suppress(s!.address, s!.reason);
      expect(h().suppressed(m.to[0]!)).not.toBe(false);
    },
  },
  {
    name: "a complaint becomes a suppression",
    async run(p) {
      const m = message();
      const { messageId } = await p.send(m);
      const [e] = await verify(p, h().complaint(m.to[0]!, messageId));
      expect(suppressionFor(e as EmailEvent)).toEqual({ address: m.to[0], reason: "complaint" });
      await p.suppress(m.to[0]!, "complaint");
      expect(h().suppressed(m.to[0]!)).not.toBe(false);
    },
  },
  {
    name: "attachments: INTERNAL files go, CONFIDENTIAL documents and more than 10 MiB are refused",
    async run(p) {
      const small = `tenant/tnt_mail/notify/${ulid()}.pdf`;
      const big = `tenant/tnt_mail/notify/${ulid()}.pdf`;
      const conf = `tenant/tnt_mail/notify/${ulid()}.pdf`;
      await storage.put(small, new Uint8Array(1024), {
        bucketClass: "GENERAL",
        contentType: "application/pdf",
      });
      await storage.put(big, new Uint8Array(10 * 1024 * 1024 + 1), { bucketClass: "GENERAL" });
      await storage.put(conf, new Uint8Array(10), { bucketClass: "CONFIDENTIAL" });
      await p.send(message({ attachments: [small] }));
      expect(h().sent().at(-1)!.attachments).toBe(1);
      const n = h().sent().length;
      await expect(p.send(message({ attachments: [big] }))).rejects.toMatchObject({
        code: "IPB-PORT-003",
      });
      await expect(p.send(message({ attachments: [conf] }))).rejects.toMatchObject({
        code: "IPB-PORT-003",
      });
      expect(h().sent()).toHaveLength(n);
    },
  },
  {
    name: "a CONFIDENTIAL inline body is refused before any request",
    async run(p) {
      const n = h().sent().length;
      await expect(p.send(message(), { dataClass: "CONFIDENTIAL" })).rejects.toMatchObject({
        code: "IPB-PORT-003",
      });
      expect(h().sent()).toHaveLength(n);
    },
  },
  {
    name: "@IPB-02-AT-05 webhooks: a forged or altered payload is refused; a replay keeps its event id",
    async run(p) {
      const m = message();
      const { messageId } = await p.send(m);
      const w = h().bounce(m.to[0]!, messageId);
      const first = await verify(p, w);
      const again = await verify(p, w);
      // The inbox keys on vendorEventId, so the replay is acknowledged and not processed twice.
      expect(again.map((e) => e.vendorEventId)).toEqual(first.map((e) => e.vendorEventId));
      if (p.descriptor.adapter === "ses") {
        // SNS signs the message, so an altered body fails; Brevo does not sign (shared secret).
        const altered = new TextEncoder().encode(
          new TextDecoder().decode(w.body).replace(m.to[0]!, "someone.else@example.test"),
        );
        await expect(verify(p, { ...w, body: altered })).rejects.toMatchObject({
          code: "IPB-API-018",
        });
      } else {
        await expect(
          verify(p, { ...w, headers: { authorization: "Bearer wrong-secret-0123456789" } }),
        ).rejects.toMatchObject({ code: "IPB-API-018" });
        await expect(verify(p, { ...w, ip: "203.0.113.9" })).rejects.toMatchObject({
          code: "IPB-API-018",
        });
      }
    },
  },
  {
    name: "verifyDomain reports the DNS records to add",
    async run(p) {
      ses.identities.set("ld.example.test", { tokens: ["t1", "t2", "t3"], verified: true });
      brevo.domains.set("ld.example.test", true);
      const d = await p.verifyDomain("ld.example.test");
      expect(d.verified).toBe(true);
      expect(d.dnsRecords.length).toBeGreaterThan(0);
    },
  },
];

beforeAll(async () => {
  [ses, brevo, moto] = await Promise.all([
    startSesStub(),
    startBrevoStub(),
    startService("moto", { ports: [5000], readyLog: /Running on/ }),
  ]);
  ses.templates.add("otp");
  brevo.templates.add(11);
  brevo.domains.set("ld.example.test", true);
  signer = createSnsSigner();
});
afterAll(async () => {
  signer?.close();
  await Promise.all([ses?.close(), brevo?.close(), moto?.stop()]);
});

describe("EMAIL hermetic leg: ses (SES v2 stub)", () => {
  defineContractSuite(
    "EMAIL",
    sesAdapter,
    cases(() => sesHarness),
    { leg: "hermetic" },
  );

  it("SNS events outside the window, on another topic or unsigned are refused (C-13)", async () => {
    const p = sesAdapter();
    const old = signer.sign({
      Type: "Notification",
      MessageId: "sns-old",
      TopicArn: TOPIC,
      Timestamp: new Date(Date.now() - 2 * 3600_000).toISOString(),
      Message: JSON.stringify({ eventType: "Send", mail: { messageId: "m" } }),
    });
    await expect(p.verifyWebhook(enc(old), {})).rejects.toMatchObject({ code: "IPB-API-018" });
    const other = signer.sign({
      Type: "Notification",
      MessageId: "sns-other",
      TopicArn: "arn:aws:sns:ap-south-1:111122223333:someone-else",
      Timestamp: new Date().toISOString(),
      Message: "{}",
    });
    await expect(p.verifyWebhook(enc(other), {})).rejects.toMatchObject({ code: "IPB-API-018" });
    await expect(p.verifyWebhook(enc({ Type: "Notification" }), {})).rejects.toMatchObject({
      code: "IPB-API-018",
    });
  });

  it("a subscription confirmation is followed only to an SNS host", async () => {
    const p = sesAdapter();
    const c = signer.sign({
      Type: "SubscriptionConfirmation",
      MessageId: "sns-sub",
      TopicArn: TOPIC,
      Timestamp: new Date().toISOString(),
      Message: "confirm",
      Token: "tok",
      SubscribeURL: "https://attacker.example.test/confirm",
    });
    await expect(p.verifyWebhook(enc(c), {})).rejects.toMatchObject({ code: "IPB-SEC-018" });
  });

  it("a paused account is a reputation block: unavailable, so the router fails over", async () => {
    const p = sesAdapter();
    ses.paused = true;
    try {
      await expect(p.send(message())).rejects.toMatchObject({
        code: "IPB-PORT-002",
        meta: { reason: "reputation_block" },
      });
      expect((await p.health()).status).toBe("down");
    } finally {
      ses.paused = false;
    }
  });

  it("an unknown brand or template is a definite refusal", async () => {
    const p = sesAdapter();
    await expect(p.send(message({ brand: "nobody" }))).rejects.toMatchObject({
      code: "IPB-PORT-001",
    });
    await expect(p.send(message({ template: "missing" }))).rejects.toMatchObject({
      code: "IPB-PORT-001",
      meta: { definite: true },
    });
  });

  it("the region must be in India", () => {
    expect(
      () =>
        new SesEmail({
          region: "us-east-1" as "ap-south-1",
          brands: {},
          events: { topicArn: TOPIC },
        }),
    ).toThrow(/outside India/);
  });
});

describe("EMAIL hermetic leg: ses raw send and identities on moto 5.2.4", () => {
  it("sendRaw and verifyDomain work against an independent SES v2 implementation", async () => {
    const p = new SesEmail({
      region: "ap-south-1",
      brands: {},
      events: { topicArn: TOPIC },
      endpoint: `http://${moto.host}:${moto.ports[5000]}`,
      credentials: CREDS,
    });
    // moto accepts mail only from a known identity: verifyDomain creates it first.
    const d = await p.verifyDomain("moto.example.test");
    expect(d.verified).toBe(false);
    const mime = new TextEncoder().encode(
      "From: noreply@moto.example.test\r\nTo: a@example.test\r\nSubject: raw\r\n\r\nbody",
    );
    expect((await p.sendRaw(mime, { idempotencyKey: "raw-1" })).messageId).not.toBe("");
  });
});

describe("EMAIL hermetic leg: brevo (stub)", () => {
  defineContractSuite(
    "EMAIL",
    () => brevoAdapter(),
    cases(() => brevoHarness),
    {
      leg: "hermetic",
    },
  );

  it("failover target only with DKIM: an unauthenticated brand domain is refused before sending", async () => {
    brevo.domains.set("new-brand.example.test", false);
    const p = brevoAdapter({ from: "noreply@new-brand.example.test" });
    const n = brevo.messages.length;
    await expect(p.send(message())).rejects.toMatchObject({
      code: "IPB-PORT-001",
      meta: { reason: "dkim_not_provisioned" },
    });
    expect(brevo.messages).toHaveLength(n);
  });

  it("brevo is GLOBAL and needs a DPA reference for recipients (IPB-DEV-05)", () => {
    expect(p0().descriptor).toMatchObject({ residency: "GLOBAL", dpaRef: "VAR-DPA-BREVO-001" });
    expect(
      () =>
        new BrevoEmail({
          apiKey: "k",
          brands: {},
          dpaRef: "",
          webhook: { secret: () => secret },
        }),
    ).toThrow(/dpa_ref/);
  });

  it("a manual suppression is refused (it would need a contact record at Brevo)", async () => {
    await expect(p0().suppress("a@example.test", "manual")).rejects.toMatchObject({
      code: "IPB-PORT-001",
      meta: { reason: "unsupported" },
    });
  });

  it("the sandbox header drops the message at the vendor", async () => {
    const p = new BrevoEmail({
      apiKey: () => brevo.apiKey,
      brands: { ld: { from: "noreply@ld.example.test", templates: { otp: 11 } } },
      dpaRef: "VAR-DPA-BREVO-001",
      webhook: { secret: () => secret },
      sandbox: true,
      baseUrl: `${brevo.url}/v3`,
      allowLoopbackHttp: true,
    });
    await p.send(message());
    expect(brevo.messages.at(-1)!.dropped).toBe(true);
  });
});

const p0 = () => brevoAdapter();

const leg = await sandboxLeg("brevo", ["BREVO_API_KEY", "BREVO_SENDER"] as const);
describe("EMAIL sandbox leg: brevo (X-Sib-Sandbox: drop)", () => {
  it.skipIf(!leg.available)("validates a send without delivering it", async () => {
    const p = new BrevoEmail({
      apiKey: leg.values.BREVO_API_KEY,
      brands: { ld: { from: leg.values.BREVO_SENDER, templates: {} } },
      dpaRef: "VAR-DPA-BREVO-001",
      webhook: { secret: () => secret },
      sandbox: true,
    });
    expect((await p.health()).status).toBe("up");
  });
});
