// WHATSAPP contract legs (PL2 plan §6.12). Hermetic: Gupshup BSP and Meta Graph API stubs built
// from the vendors' documentation. Marketing templates stay off (OWN-08); PL2 builds the utility
// and authentication path, test mode only. The sandbox legs (Gupshup sandbox app, Meta test
// business number, allow-listed recipients only) skip themselves until the accounts exist.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WhatsappPort, WhatsappTemplateMessage } from "@infrabyx/contracts/ports";
import { SecretKey, generateWebhookSecret, hmacSha256Hex } from "@infrabyx/crypto";
import {
  defineContractSuite,
  startGupshupWhatsappStub,
  startMetaGraphStub,
  type ContractCase,
  type WhatsappStub,
} from "@infrabyx/testing";
import { GupshupWhatsapp } from "../gupshup.js";
import { MetaCloudWhatsapp } from "../meta-cloud.js";

const OPEN = "+919999900011";
const STALE = "+919999900012";
const NEVER = "+919999900013";
const secret = generateWebhookSecret();
const appSecret = generateWebhookSecret();
const verifyToken = generateWebhookSecret();
let gup: WhatsappStub;
let meta: WhatsappStub;
let marketing = false;

const lastInboundAt = async (to: string) =>
  to === OPEN
    ? new Date(Date.now() - 3600_000)
    : to === STALE
      ? new Date(Date.now() - 25 * 3600_000)
      : undefined;
// Illustrative minor units only; real rates are configuration, never committed.
const rateCard = { currency: "INR", amountMinor: { utility: 101, authentication: 102 } };
const policy = { lastInboundAt, rateCard, marketingEnabled: () => marketing };

const gupshupAdapter = () =>
  new GupshupWhatsapp({
    ...policy,
    apiKey: () => gup.credential,
    appId: "app-1",
    appName: "ldapp",
    source: "+919999900099",
    dpaRef: "VAR-DPA-GUPSHUP-001",
    webhook: { secret: () => secret },
    // Stands in for Gupshup's status lookup until the sandbox leg finds one (PL2-D-65).
    confirmStatus: async (e) =>
      gup.sent.some((m) => m.id === e.messageId) || e.messageId === "gs-x",
    baseUrl: gup.url,
    allowLoopbackHttp: true,
  });
const metaAdapter = (o: { window?: boolean } = {}) =>
  new MetaCloudWhatsapp({
    rateCard,
    marketingEnabled: policy.marketingEnabled,
    ...(o.window === false ? {} : { lastInboundAt }),
    accessToken: () => meta.credential,
    appSecret: () => appSecret,
    verifyToken,
    phoneNumberId: "1000000001",
    wabaId: "2000000001",
    dpaRef: "VAR-DPA-META-001",
    baseUrl: meta.url,
    allowLoopbackHttp: true,
  });

const otp = (over: Partial<WhatsappTemplateMessage> = {}): WhatsappTemplateMessage => ({
  to: OPEN,
  templateName: "login_code",
  lang: "en",
  components: [{ type: "body", parameters: [{ type: "text", text: "482913" }] }],
  ...over,
});

interface Harness {
  stub(): WhatsappStub;
  status(
    id: string,
    status: "delivered" | "failed",
    code?: number,
  ): {
    body: Uint8Array;
    headers: Record<string, string>;
    query?: string;
  };
}

const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

const gupshupHarness: Harness = {
  stub: () => gup,
  status: (id, status, code) => ({
    body: enc({
      app: "ldapp",
      timestamp: Date.now(),
      version: 2,
      type: "message-event",
      payload: {
        id,
        gsId: id,
        type: status,
        destination: "919999900011",
        payload: code ? { code, reason: "window closed" } : { ts: Math.floor(Date.now() / 1000) },
      },
    }),
    headers: {},
    query: `ipb_token=${encodeURIComponent(secret)}`,
  }),
};

const metaHarness: Harness = {
  stub: () => meta,
  status: (id, status, code) => {
    const body = enc({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "2000000001",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "1000000001" },
                statuses: [
                  {
                    id,
                    status,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    recipient_id: "919999900011",
                    pricing: { billable: true, pricing_model: "PMP", category: "utility" },
                    ...(code ? { errors: [{ code, title: "window closed" }] } : {}),
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const key = new SecretKey(
      "meta-app-secret",
      "hmac-sha-256",
      new TextEncoder().encode(appSecret),
    );
    return { body, headers: { "X-Hub-Signature-256": `sha256=${hmacSha256Hex(key, body)}` } };
  },
};

const verify = (p: WhatsappPort, w: ReturnType<Harness["status"]>) =>
  p.verifyWebhook(w.body, w.headers, w.query === undefined ? {} : { query: w.query });

const cases = (h: () => Harness): Array<ContractCase<WhatsappPort>> => [
  {
    name: "a utility template send reaches the vendor with its parameters",
    async run(p) {
      const n = h().stub().sent.length;
      const { messageId } = await p.sendTemplate(otp());
      expect(messageId).not.toBe("");
      expect(h().stub().sent.slice(n)).toEqual([
        expect.objectContaining({ to: "919999900011", template: "login_code", params: ["482913"] }),
      ]);
    },
  },
  {
    name: "marketing templates are refused while mkt.meta.enabled is false (OWN-08)",
    async run(p) {
      const n = h().stub().sent.length;
      await expect(p.sendTemplate(otp({ templateName: "festive_offer" }))).rejects.toMatchObject({
        meta: { reason: "marketing_disabled" },
      });
      await expect(
        p.submitTemplate({ name: "promo2", category: "marketing", lang: "en", body: "Hi" }),
      ).rejects.toMatchObject({ meta: { reason: "marketing_disabled" } });
      expect(h().stub().sent.length).toBe(n);
      marketing = true;
      try {
        await p.sendTemplate(otp({ templateName: "festive_offer" }));
        expect(h().stub().sent.length).toBe(n + 1);
      } finally {
        marketing = false;
      }
    },
  },
  {
    name: "session messages only inside the 24-hour window",
    async run(p) {
      await p.sendSession({ to: OPEN, text: "Your document is ready." });
      const n = h().stub().sent.length;
      for (const to of [STALE, NEVER])
        await expect(p.sendSession({ to, text: "Hello" })).rejects.toMatchObject({
          meta: { reason: "outside_session_window" },
        });
      expect(h().stub().sent.length).toBe(n);
    },
  },
  {
    name: "media upload",
    method: "uploadMedia",
    invoke: (p) => p.uploadMedia({ body: new Uint8Array(10), contentType: "image/png" }),
    async run(p) {
      const { mediaId } = await p.uploadMedia({
        body: new Uint8Array(2048),
        contentType: "application/pdf",
      });
      expect(mediaId).not.toBe("");
      await expect(
        p.uploadMedia(
          { body: new Uint8Array(10), contentType: "image/png" },
          { dataClass: "CONFIDENTIAL" },
        ),
      ).rejects.toMatchObject({ code: "IPB-PORT-003" });
    },
  },
  {
    name: "template status and submission",
    async run(p) {
      expect(await p.getTemplateStatus("login_code")).toEqual({
        status: "approved",
        category: "utility",
      });
      expect(await p.getTemplateStatus("pending_one")).toMatchObject({ status: "pending" });
      await p.submitTemplate({
        name: "doc_ready",
        category: "utility",
        lang: "en",
        body: "Ready {{1}}",
      });
      expect(h().stub().submitted.length).toBeGreaterThan(0);
    },
  },
  {
    name: "@IPB-02-AT-05 status webhooks verify, de-duplicate on replay and expose the error code",
    async run(p) {
      const { messageId } = await p.sendTemplate(otp());
      const w = h().status(messageId, "delivered");
      const [a] = await verify(p, w);
      expect(a).toMatchObject({ messageId, type: "delivered" });
      const [b] = await verify(p, w);
      expect(b!.vendorEventId).toBe(a!.vendorEventId);
      const [f] = await verify(
        p,
        h().status(messageId, "failed", p.descriptor.adapter === "gupshup" ? 470 : 131047),
      );
      expect(f).toMatchObject({ type: "failed" });
      expect(f!.errorCode).toMatch(/^(470|131047)$/);
      const forged =
        w.query === undefined
          ? { ...w, body: enc({ entry: [] }) }
          : { ...w, query: "ipb_token=wrong-token-000000000000" };
      await expect(verify(p, forged)).rejects.toMatchObject({ code: "IPB-API-018" });
    },
  },
  {
    name: "the conversation cost category comes from configuration, never from code",
    async run(p) {
      expect(await p.getConversationCost("utility")).toEqual({ currency: "INR", amountMinor: 101 });
      await expect(p.getConversationCost("marketing")).rejects.toMatchObject({
        meta: { reason: "unsupported" },
      });
    },
  },
  {
    name: "a CONFIDENTIAL body is refused before any request",
    async run(p) {
      const n = h().stub().sent.length;
      await expect(p.sendTemplate(otp(), { dataClass: "CONFIDENTIAL" })).rejects.toMatchObject({
        code: "IPB-PORT-003",
      });
      expect(h().stub().sent.length).toBe(n);
    },
  },
];

const seed = (s: WhatsappStub) => {
  s.templates = [
    { id: "t-1", name: "login_code", category: "UTILITY", status: "APPROVED", language: "en" },
    { id: "t-2", name: "festive_offer", category: "MARKETING", status: "APPROVED", language: "en" },
    { id: "t-3", name: "pending_one", category: "UTILITY", status: "PENDING", language: "en" },
  ];
  s.openSessions.add("919999900011");
};

beforeAll(async () => {
  [gup, meta] = await Promise.all([startGupshupWhatsappStub(), startMetaGraphStub()]);
  seed(gup);
  seed(meta);
});
afterAll(async () => {
  await Promise.all([gup?.close(), meta?.close()]);
});

describe("WHATSAPP hermetic leg: gupshup (stub)", () => {
  defineContractSuite(
    "WHATSAPP",
    gupshupAdapter,
    cases(() => gupshupHarness),
    { leg: "hermetic" },
  );

  it("events are withheld until their status is confirmed (PL2-D-65)", async () => {
    const withheld: number[] = [];
    const bare = new GupshupWhatsapp({
      ...policy,
      apiKey: () => gup.credential,
      appId: "app-1",
      appName: "ldapp",
      source: "+919999900099",
      dpaRef: "VAR-DPA-GUPSHUP-001",
      webhook: { secret: () => secret },
      onWithheld: (n) => withheld.push(n),
      baseUrl: gup.url,
      allowLoopbackHttp: true,
    });
    expect(await verify(bare, gupshupHarness.status("gs-x", "delivered"))).toEqual([]);
    expect(withheld).toEqual([1]);
    expect(await verify(gupshupAdapter(), gupshupHarness.status("spoofed", "delivered"))).toEqual(
      [],
    );
  });

  it("a failed event with code 470 means the window had closed", async () => {
    const [e] = await verify(gupshupAdapter(), gupshupHarness.status("gs-x", "failed", 470));
    expect(GupshupWhatsapp.outsideWindow(e!)).toBe(true);
  });
});

describe("WHATSAPP hermetic leg: meta-cloud (Graph stub)", () => {
  defineContractSuite(
    "WHATSAPP",
    () => metaAdapter(),
    cases(() => metaHarness),
    { leg: "hermetic" },
  );

  it("without a session store, Meta's own refusal (131047) maps to the same error", async () => {
    await expect(
      metaAdapter({ window: false }).sendSession({ to: NEVER, text: "Hi" }),
    ).rejects.toMatchObject({
      meta: { reason: "outside_session_window" },
    });
  });

  it("the pricing category is exposed on status events for OH8 billing", async () => {
    const [e] = await verify(metaAdapter(), metaHarness.status("wamid.X", "delivered"));
    expect(e!.pricingCategory).toBe("utility");
  });

  it("the subscription handshake echoes the challenge only for our verify token", async () => {
    const p = metaAdapter();
    expect(
      await p.verifyChallenge(
        `hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=42`,
      ),
    ).toBe("42");
    expect(
      await p.verifyChallenge("hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42"),
    ).toBeNull();
  });

  it("quality rating health: YELLOW is degraded, RED is down", async () => {
    meta.qualityRating = "YELLOW";
    expect((await metaAdapter().health()).status).toBe("degraded");
    meta.qualityRating = "RED";
    expect((await metaAdapter().health()).status).toBe("down");
    meta.qualityRating = "GREEN";
  });

  it("images over 5 MB are refused before upload", async () => {
    await expect(
      metaAdapter().uploadMedia({
        body: new Uint8Array(5 * 1024 * 1024 + 1),
        contentType: "image/jpeg",
      }),
    ).rejects.toMatchObject({ code: "IPB-PORT-003" });
  });

  it("both WhatsApp adapters are GLOBAL and need a DPA reference (IPB-DEV-05)", () => {
    expect(metaAdapter().descriptor).toMatchObject({
      residency: "GLOBAL",
      dpaRef: "VAR-DPA-META-001",
    });
    expect(gupshupAdapter().descriptor).toMatchObject({
      residency: "GLOBAL",
      dpaRef: "VAR-DPA-GUPSHUP-001",
    });
  });
});
