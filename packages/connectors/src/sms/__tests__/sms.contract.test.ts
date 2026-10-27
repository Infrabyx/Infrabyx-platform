// SMS contract legs (PL2 plan §6.11). Hermetic: MSG91 and Gupshup Enterprise SMS stubs built from
// the vendors' documentation. The sandbox legs (read-only calls nightly; one real send a week to
// the owner's test number, only after DLT registration, D-07) skip themselves until the accounts
// exist (IPB-DEV-04).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkRouting } from "@infrabyx/contracts/routing";
import type { SmsMessage, SmsPort } from "@infrabyx/contracts/ports";
import { generateWebhookSecret } from "@infrabyx/crypto";
import {
  defineContractSuite,
  startGupshupSmsStub,
  startMsg91Stub,
  type ContractCase,
  type GupshupSmsStub,
  type Msg91Stub,
} from "@infrabyx/testing";
import { MemoryIdempotencyStore, runIdempotent } from "../../core/idempotency.js";
import { Router } from "../../core/router.js";
import type { DltTemplate } from "../common.js";
import { GupshupSms } from "../gupshup-sms.js";
import { Msg91Sms, msg91Crqid } from "../msg91.js";

const ENTITY = "1201160000000000001";
const OTP: DltTemplate = {
  templateId: "otp",
  dltTemplateId: "1207160000000000011",
  text: "{#var#} is your login code for LawDocs. It expires in {#var#} minutes.",
};
const RECEIPT: DltTemplate = {
  templateId: "receipt",
  dltTemplateId: "1207160000000000012",
  text: "Payment of Rs {#var#} received. Ref {#var#}.",
};
const secret = generateWebhookSecret();
let msg91: Msg91Stub;
let gup: GupshupSmsStub;

const sms = (over: Partial<SmsMessage> = {}): SmsMessage => ({
  to: "+919999900001",
  templateId: "otp",
  vars: ["482913", "10"],
  senderId: "LWDOCS",
  dltEntityId: ENTITY,
  ...over,
});

const dlt = { entityId: ENTITY, senders: ["LWDOCS"], templates: [OTP] };
const msg91Adapter = () =>
  new Msg91Sms({
    ...dlt,
    authKey: () => msg91.authKey,
    flows: { otp: { flowId: "flow-otp" }, receipt: { flowId: "flow-receipt" } },
    webhook: { secret: () => secret },
    baseUrl: msg91.url,
    allowLoopbackHttp: true,
  });
const gupshupAdapter = () =>
  new GupshupSms({
    ...dlt,
    credentials: () => ({ userId: gup.userId, password: gup.password }),
    webhook: { secret: () => secret },
    // Stands in for Gupshup's status lookup until the sandbox leg finds one (PL2-D-65).
    confirmStatus: async (e) => gup.sent.some((m) => m.id === e.messageId),
    baseUrl: gup.url,
    allowLoopbackHttp: true,
  });

interface Harness {
  sent(): number;
  last(): { to: string; sender: string; text?: string; crqid?: string };
  report(
    id: string,
    status: "delivered" | "failed",
  ): {
    body: Uint8Array;
    headers: Record<string, string>;
    query?: string;
  };
}

const msg91Harness: Harness = {
  sent: () => msg91.sent.length,
  last: () => msg91.sent.at(-1)!,
  report: (id, status) => ({
    body: new TextEncoder().encode(
      JSON.stringify({
        requestId: id,
        telNum: "919999900001",
        status: status === "delivered" ? 1 : 2,
        deliveryTime: "2026-10-27 10:15:00",
        eventName: "SMS",
      }),
    ),
    headers: { authorization: `Bearer ${secret}` },
  }),
};

const gupshupHarness: Harness = {
  sent: () => gup.sent.length,
  last: () => gup.sent.at(-1)!,
  report: (id, status) => ({
    body: new Uint8Array(),
    headers: {},
    query: new URLSearchParams({
      externalId: id,
      deliveredTS: String(Date.now()),
      status: status === "delivered" ? "SUCCESS" : "FAILURE",
      cause: status === "delivered" ? "SUCCESS" : "UNKNOWN_SUBSCRIBER",
      phoneNo: "919999900001",
      ipb_token: secret,
    }).toString(),
  }),
};

const verify = (p: SmsPort, r: ReturnType<Harness["report"]>) =>
  p.verifyWebhook(r.body, r.headers, r.query === undefined ? {} : { query: r.query });

const cases = (h: () => Harness): Array<ContractCase<SmsPort>> => [
  {
    name: "a DLT template send reaches the vendor with the registered header",
    async run(p) {
      const n = h().sent();
      const { messageId } = await p.send(sms());
      expect(messageId).not.toBe("");
      expect(h().sent()).toBe(n + 1);
      expect(h().last()).toMatchObject({ to: "919999900001", sender: "LWDOCS" });
      if (p.descriptor.adapter === "gupshup-sms")
        expect(h().last().text).toBe(
          "482913 is your login code for LawDocs. It expires in 10 minutes.",
        );
    },
  },
  {
    name: "an unregistered template, a non-DLT header, another entity or wrong variables are refused before sending",
    async run(p) {
      const n = h().sent();
      for (const bad of [
        sms({ templateId: "promo" }),
        sms({ senderId: "OTHERS" }),
        sms({ dltEntityId: "1201160000000000999" }),
        sms({ vars: ["482913"] }),
      ])
        await expect(p.send(bad)).rejects.toMatchObject({
          code: "IPB-PORT-001",
          meta: { definite: true },
        });
      expect(h().sent()).toBe(n);
    },
  },
  {
    name: "registerTemplate makes a new DLT template sendable",
    async run(p) {
      const receipt = sms({ templateId: "receipt", vars: ["1500", "R123"] });
      await expect(p.send(receipt)).rejects.toMatchObject({
        meta: { reason: "template_not_registered" },
      });
      await p.registerTemplate(RECEIPT);
      expect((await p.send(receipt)).messageId).not.toBe("");
    },
  },
  {
    name: "idempotent send: the same key reaches the vendor once through the idempotency store",
    async run(p) {
      const store = new MemoryIdempotencyStore();
      const key = `otp-${Date.now()}-${Math.random()}`;
      const req = {
        port: "SMS",
        adapter: p.descriptor.adapter,
        operation: "send",
        key,
        request: sms(),
        dataClass: "INTERNAL" as const,
        money: false,
      };
      const n = h().sent();
      const a = await runIdempotent({
        store,
        req,
        call: () => p.send(sms(), { idempotencyKey: key }),
      });
      const b = await runIdempotent({
        store,
        req,
        call: () => p.send(sms(), { idempotencyKey: key }),
      });
      expect(b).toEqual(a);
      expect(h().sent()).toBe(n + 1);
      if (p.descriptor.adapter === "msg91") expect(h().last().crqid).toBe(msg91Crqid(key));
    },
  },
  {
    name: "@IPB-02-AT-05 a delivery report is verified and keeps its event id on replay",
    async run(p) {
      const { messageId } = await p.send(sms());
      const r = h().report(messageId, "delivered");
      const [a] = await verify(p, r);
      expect(a).toMatchObject({ messageId, status: "delivered" });
      const [b] = await verify(p, r);
      expect(b!.vendorEventId).toBe(a!.vendorEventId);
      const [f] = await verify(p, h().report(messageId, "failed"));
      expect(f!.status).toBe("failed");
      expect(f!.vendorEventId).not.toBe(a!.vendorEventId);
      const forged =
        r.query === undefined
          ? { ...r, headers: { authorization: "Bearer not-the-secret-000000" } }
          : { ...r, query: r.query.replace(/ipb_token=[^&]+/, "ipb_token=wrong-token-0000000000") };
      await expect(verify(p, forged)).rejects.toMatchObject({ code: "IPB-API-018" });
    },
  },
  {
    name: "status of a sent message",
    method: "getStatus",
    invoke: (p) => p.getStatus("any"),
    async run(p) {
      const { messageId } = await p.send(sms());
      expect((await p.getStatus(messageId)).status).toBeTruthy();
    },
  },
  {
    name: "a CONFIDENTIAL body is refused before any request (OTP and references only)",
    async run(p) {
      const n = h().sent();
      await expect(p.send(sms(), { dataClass: "CONFIDENTIAL" })).rejects.toMatchObject({
        code: "IPB-PORT-003",
      });
      expect(h().sent()).toBe(n);
    },
  },
];

beforeAll(async () => {
  [msg91, gup] = await Promise.all([startMsg91Stub(), startGupshupSmsStub()]);
  msg91.flows.add("flow-otp").add("flow-receipt");
  gup.templates.set(OTP.dltTemplateId, OTP.text).set(RECEIPT.dltTemplateId, RECEIPT.text);
});
afterAll(async () => {
  await Promise.all([msg91?.close(), gup?.close()]);
});

describe("@IPB-01-15 SMS hermetic leg: msg91 (stub)", () => {
  defineContractSuite(
    "SMS",
    msg91Adapter,
    cases(() => msg91Harness),
    { leg: "hermetic" },
  );

  it("balance health: below the threshold is degraded", async () => {
    msg91.balance = 120;
    try {
      expect((await msg91Adapter().health()).status).toBe("degraded");
    } finally {
      msg91.balance = 10_000;
    }
    expect((await msg91Adapter().health()).status).toBe("up");
    expect(msg91.requests.at(-1)!.path).toBe("/api/balance.php");
    expect(msg91.requests.at(-1)!.query.has("authkey")).toBe(false);
  });

  it("a vendor refusal in a 200 answer is a definite error; bad credentials say so", async () => {
    msg91.flows.delete("flow-otp");
    try {
      await expect(msg91Adapter().send(sms())).rejects.toMatchObject({
        code: "IPB-PORT-001",
        meta: { definite: true },
      });
    } finally {
      msg91.flows.add("flow-otp");
    }
    const bad = new Msg91Sms({
      ...dlt,
      authKey: "wrong",
      flows: { otp: { flowId: "flow-otp" } },
      webhook: { secret: () => secret },
      baseUrl: msg91.url,
      allowLoopbackHttp: true,
    });
    await expect(bad.send(sms())).rejects.toMatchObject({ meta: { reason: "credentials" } });
  });
});

describe("@IPB-01-15 SMS hermetic leg: gupshup-sms (stub)", () => {
  defineContractSuite(
    "SMS",
    gupshupAdapter,
    cases(() => gupshupHarness),
    { leg: "hermetic" },
  );

  it("credentials go in a POST body, never in the URL", async () => {
    await gupshupAdapter().send(sms());
    const r = gup.requests.at(-1)!;
    expect(r.method).toBe("POST");
    expect([...r.query.keys()]).toEqual([]);
    expect(r.form().get("password")).toBe(gup.password);
  });

  it("reports are withheld until their status is confirmed; a short URL token is refused (PL2-D-65)", async () => {
    const withheld: number[] = [];
    const bare = new GupshupSms({
      ...dlt,
      credentials: () => ({ userId: gup.userId, password: gup.password }),
      webhook: { secret: () => secret },
      onWithheld: (n) => withheld.push(n),
      baseUrl: gup.url,
      allowLoopbackHttp: true,
    });
    const { messageId } = await bare.send(sms());
    expect(await verify(bare, gupshupHarness.report(messageId, "delivered"))).toEqual([]);
    expect(withheld).toEqual([1]);
    expect(
      await verify(gupshupAdapter(), gupshupHarness.report("spoofed-id", "delivered")),
    ).toEqual([]);
    const short = new GupshupSms({
      ...dlt,
      credentials: () => ({ userId: gup.userId, password: gup.password }),
      webhook: { secret: () => "short-token-1234567890" },
      baseUrl: gup.url,
      allowLoopbackHttp: true,
    });
    const r = gupshupHarness.report(messageId, "delivered");
    await expect(
      verify(short, {
        ...r,
        query: r.query!.replace(/ipb_token=[^&]+/, "ipb_token=short-token-1234567890"),
      }),
    ).rejects.toMatchObject({ code: "IPB-API-018" });
  });

  it("text that does not match the approved template is refused by the gateway (error 038)", async () => {
    gup.templates.set(OTP.dltTemplateId, "Different approved text {#var#}");
    try {
      await expect(gupshupAdapter().send(sms())).rejects.toMatchObject({
        code: "IPB-PORT-001",
        meta: { definite: true },
      });
    } finally {
      gup.templates.set(OTP.dltTemplateId, OTP.text);
    }
  });
});

describe("SMS failover msg91 → gupshup-sms (IPB-01-18, plan §6.11)", () => {
  it("after repeated 5xx from the primary the next send goes to the secondary with the same DLT mapping", async () => {
    const doc = {
      version: 1,
      ports: {
        SMS: {
          primary: { adapter: "msg91", residency: "IN", max_data_class: "INTERNAL" },
          secondary: {
            adapter: "gupshup-sms",
            residency: "IN",
            max_data_class: "INTERNAL",
            mode: "active_failover",
          },
        },
      },
    };
    const router = await Router.create({
      routing: { env: "dev", ...checkRouting(doc, { env: "dev" }) },
      factories: { msg91: msg91Adapter, "gupshup-sms": gupshupAdapter },
      module: "test",
    });
    const port = router.port<SmsPort>("SMS");
    msg91.failNext(20, 503);
    try {
      for (let i = 0; i < 5; i++)
        await expect(port.send(sms())).rejects.toMatchObject({ code: "IPB-PORT-002" });
      const n = gup.sent.length;
      await port.send(sms());
      expect(gup.sent.length).toBe(n + 1);
    } finally {
      msg91.failNext(0);
    }
  });
});
