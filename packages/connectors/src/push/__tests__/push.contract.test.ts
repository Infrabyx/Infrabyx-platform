// PUSH contract legs (PL3 plan §6.7, §12). Hermetic: Expo and FCM stubs; the FCM stub also checks
// the C-24 RS256 assertion at its token endpoint. Sandbox legs wait for the owner's Expo and
// Firebase accounts (PL3-D-11) and skip themselves until then.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PushPort } from "@infrabyx/contracts/ports";
import {
  defineContractSuite,
  MemoryPushTokenStore,
  startExpoStub,
  startFcmStub,
  type ContractCase,
  type ExpoStub,
  type FcmStub,
} from "@infrabyx/testing";
import { ExpoPush } from "../expo.js";
import { FcmPush } from "../fcm.js";

let expo: ExpoStub;
let fcm: FcmStub;
beforeAll(async () => {
  expo = await startExpoStub();
  fcm = await startFcmStub();
});
afterAll(async () => {
  await expo?.close();
  await fcm?.close();
});

const dpaRef = "VAR-PUSH-TEST";
const stores = new WeakMap<PushPort, MemoryPushTokenStore>();
const expoAdapter = () => {
  const store = new MemoryPushTokenStore();
  const p = new ExpoPush({ store, dpaRef, baseUrl: expo.url, allowLoopbackHttp: true });
  stores.set(p, store);
  return p;
};
const fcmAdapter = () => {
  const store = new MemoryPushTokenStore();
  const p = new FcmPush({
    store,
    dpaRef,
    projectId: fcm.projectId,
    credentials: {
      kind: "service_account",
      clientEmail: fcm.clientEmail,
      privateKey: () => fcm.privateKeyPem,
    },
    baseUrl: fcm.url,
    tokenUrl: `${fcm.url}/token`,
    allowLoopbackHttp: true,
  });
  stores.set(p, store);
  return p;
};
const tokenFor = (p: PushPort, n: number) =>
  p.descriptor.adapter === "expo"
    ? `ExponentPushToken[contract${n}abcdefghij]`
    : `fcm-contract-token-${n}-abcdefghijklmnop`;

const cases: ContractCase<PushPort>[] = [
  {
    name: "register stores the token once; send reaches each device with title and deep link only",
    async run(p) {
      const a = await p.register(tokenFor(p, 1), "android", "usr_a");
      expect((await p.register(tokenFor(p, 1), "android", "usr_a")).tokenRef).toBe(a.tokenRef);
      await p.register(tokenFor(p, 2), "ios", "usr_a");
      const r = await p.send(["usr_a"], {
        title: "Your document is ready",
        deepLink: "/docs/doc_1",
        data: { kind: "doc" },
      });
      expect(r.tickets.map((t) => t.status)).toEqual(["accepted", "accepted"]);
      const body = JSON.stringify(
        p.descriptor.adapter === "expo" ? expo.sent.slice(-2) : fcm.sent.slice(-2),
      );
      expect(body).toContain("/docs/doc_1");
      expect(body).toContain("Your document is ready");
    },
  },
  {
    name: "IPB-NTF-006: a payload beyond title, deep link and INTERNAL data is refused before any request",
    async run(p) {
      await p.register(tokenFor(p, 3), "android", "usr_b");
      const before = p.descriptor.adapter === "expo" ? expo.requests.length : fcm.requests.length;
      for (const bad of [
        { title: "x", deepLink: "/x", body: "account balance 10,000" },
        { title: "x", deepLink: "https://evil.example/x" },
        {
          title: "x",
          deepLink: "/x",
          data: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, "v"])),
        },
      ])
        await expect(p.send(["usr_b"], bad as never)).rejects.toMatchObject({
          code: "IPB-NTF-006",
        });
      await expect(
        p.send(["usr_b"], { title: "x", deepLink: "/x" }, { dataClass: "CONFIDENTIAL" }),
      ).rejects.toMatchObject({
        code: "IPB-NTF-006",
      });
      expect(p.descriptor.adapter === "expo" ? expo.requests.length : fcm.requests.length).toBe(
        before,
      );
    },
  },
  {
    name: "a token the vendor no longer knows is reported invalid and removed from the store",
    async run(p) {
      const t = tokenFor(p, 4);
      await p.register(t, "android", "usr_c");
      (p.descriptor.adapter === "expo" ? expo.unregistered : fcm.unregistered).add(t);
      const r = await p.send(["usr_c"], { title: "Hello", deepLink: "/home" });
      expect(r.tickets.map((x) => x.status)).toEqual(["invalid_token"]);
      expect(await stores.get(p)?.forUsers(["usr_c"], p.descriptor.adapter)).toEqual([]);
    },
  },
  {
    name: "sendTopic: FCM topics; Expo has none (unsupported)",
    method: "sendTopic",
    invoke: (p) => p.sendTopic("news", { title: "x", deepLink: "/x" }),
    async run(p) {
      const r = await p.sendTopic("tenant-updates", {
        title: "Maintenance tonight",
        deepLink: "/status",
      });
      expect(r.vendorId).toMatch(/messages\//);
    },
  },
  {
    name: "receipts: Expo reports delivery; FCM has none (unsupported)",
    method: "receipts",
    invoke: (p) => p.receipts(["x"]),
    async run(p) {
      await p.register(tokenFor(p, 5), "android", "usr_d");
      const r = await p.send(["usr_d"], { title: "Hi", deepLink: "/" });
      const ids = r.tickets.flatMap((t) => (t.vendorId ? [t.vendorId] : []));
      expect((await p.receipts(ids)).map((x) => x.status)).toEqual(["delivered"]);
    },
  },
];

describe("@IPB-01-15 PUSH hermetic legs (Expo and FCM stubs)", () => {
  defineContractSuite("PUSH", expoAdapter, cases, { leg: "hermetic" });
  defineContractSuite("PUSH", fcmAdapter, cases, { leg: "hermetic" });
});

describe("FCM credentials (PL3-C-01, C-24)", () => {
  it("signs the assertion, exchanges it once and caches the access token until 5 minutes before expiry", async () => {
    let now = Date.now();
    const store = new MemoryPushTokenStore();
    const p = new FcmPush({
      store,
      dpaRef,
      projectId: fcm.projectId,
      credentials: {
        kind: "service_account",
        clientEmail: fcm.clientEmail,
        privateKey: () => fcm.privateKeyPem,
      },
      baseUrl: fcm.url,
      tokenUrl: `${fcm.url}/token`,
      allowLoopbackHttp: true,
      now: () => now,
    });
    await p.register("fcm-cache-token-abcdefghijklmnopq", "android", "usr_e");
    const issued = fcm.tokensIssued;
    await p.send(["usr_e"], { title: "a", deepLink: "/" });
    await p.send(["usr_e"], { title: "b", deepLink: "/" });
    expect(fcm.tokensIssued).toBe(issued + 1);
    now += 56 * 60_000;
    await p.send(["usr_e"], { title: "c", deepLink: "/" });
    expect(fcm.tokensIssued).toBe(issued + 2);
    const tokenReq = fcm.requests.filter((r) => r.path === "/token").at(-1);
    expect(tokenReq?.body.toString()).not.toContain("PRIVATE KEY");
  });
  it("a wrong key is refused at the token endpoint and the adapter reports down", async () => {
    const other = await startFcmStub();
    const p = new FcmPush({
      store: new MemoryPushTokenStore(),
      dpaRef,
      projectId: fcm.projectId,
      credentials: {
        kind: "service_account",
        clientEmail: fcm.clientEmail,
        privateKey: () => other.privateKeyPem,
      },
      baseUrl: fcm.url,
      tokenUrl: `${fcm.url}/token`,
      allowLoopbackHttp: true,
    });
    expect((await p.health()).status).toBe("down");
    await other.close();
  });
});
