// The customer sign-in contract (R1-D-19), one list of cases run on Keycloak (with the extension)
// and on Zitadel: a code by SMS or email, a DPoP-bound session on the device key, requests proved
// by that key only, refresh rotation, sign-out, the resend interval, and one account per tenant.
import { expect } from "vitest";
import type { CustomerIdentityPort } from "@infrabyx/contracts/ports";
import { jwkThumbprint, randomInt } from "@infrabyx/crypto";
import type { ContractCase } from "@infrabyx/testing";
import { testDevice, type TestDevice } from "./dpop-device.js";

export interface CustomerCaseContext {
  /** Codes as the customer's phone or mailbox received them, by login. */
  inbox: Map<string, string>;
  /** The IdP binds the access token to the key itself (`cnf.jkt`). */
  nativeBinding: boolean;
  /** Roles a new customer receives in this realm or organisation. */
  roles: readonly string[];
  /** Wait between a wrong and a right code (Keycloak locks a second try within 1 s). */
  pauseMs: number;
}

const API = "https://api.example.test/v1/me";
const phone = () => `+9198${String(randomInt(100_000_000)).padStart(8, "0")}`;
const payload = (jwt: string) =>
  JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;

async function signIn(
  p: CustomerIdentityPort,
  ctx: CustomerCaseContext,
  o: { tenantId?: string; login?: string; channel?: "sms" | "email"; device?: TestDevice } = {},
) {
  const tenantId = o.tenantId ?? "tnt_a";
  const login = o.login ?? phone();
  const channel = o.channel ?? "sms";
  const device = o.device ?? testDevice();
  const t = p.signInProofTarget;
  const ch = await p.startChallenge({
    tenantId,
    channel,
    login,
    dpopProof: device.proof(t.htm, t.htu),
  });
  const code = ctx.inbox.get(login.toLowerCase());
  expect(code).toMatch(/^[0-9]{6}$/);
  const session = await p.verifyChallenge({
    tenantId,
    challengeId: ch.challengeId,
    code: code!,
    dpopProof: device.proof(t.htm, t.htu),
    deviceLabel: "contract phone",
  });
  return { tenantId, login, device, session, challenge: ch };
}

const call = (
  p: CustomerIdentityPort,
  device: TestDevice,
  token: string,
  o: { method?: string; url?: string } = {},
) =>
  p.verifyRequest({
    authorization: `DPoP ${token}`,
    dpopProof: device.proof(o.method ?? "GET", o.url ?? API, { accessToken: token }),
    method: o.method ?? "GET",
    url: o.url ?? API,
  });

export function customerCases(ctx: CustomerCaseContext): Array<ContractCase<CustomerIdentityPort>> {
  return [
    {
      name: "@IPB-02-01 a one-time code by SMS gives a DPoP session bound to the device key",
      async run(p) {
        const { session, device } = await signIn(p, ctx);
        expect(session.tokenType).toBe("DPoP");
        expect(session.device.jkt).toBe(jwkThumbprint(device.jwk));
        expect(session.expiresIn).toBeLessThanOrEqual(300);
        if (ctx.nativeBinding)
          expect((payload(session.accessToken).cnf as { jkt?: string }).jkt).toBe(
            session.device.jkt,
          );
        const claims = await call(p, device, session.accessToken);
        expect(claims).toMatchObject({
          tid: "tnt_a",
          typ: "user",
          mfa: false,
          jkt: session.device.jkt,
          deviceId: session.device.id,
        });
        expect(claims.roles).toEqual([...ctx.roles]);
      },
    },
    {
      name: "a request is refused without DPoP, with another key, a replayed proof or another target",
      async run(p) {
        const { session, device } = await signIn(p, ctx);
        const token = session.accessToken;
        await expect(
          p.verifyRequest({
            authorization: `Bearer ${token}`,
            dpopProof: device.proof("GET", API, { accessToken: token }),
            method: "GET",
            url: API,
          }),
        ).rejects.toMatchObject({ code: "IPB-IDN-001", meta: { reason: "scheme" } });
        await expect(call(p, testDevice(), token)).rejects.toMatchObject({
          code: "IPB-IDN-001",
          meta: { reason: ctx.nativeBinding ? "dpop_jkt" : "device" },
        });
        const proof = device.proof("GET", API, { accessToken: token });
        await p.verifyRequest({
          authorization: `DPoP ${token}`,
          dpopProof: proof,
          method: "GET",
          url: API,
        });
        await expect(
          p.verifyRequest({
            authorization: `DPoP ${token}`,
            dpopProof: proof,
            method: "GET",
            url: API,
          }),
        ).rejects.toMatchObject({ meta: { reason: "dpop_replay" } });
        await expect(
          p.verifyRequest({
            authorization: `DPoP ${token}`,
            dpopProof: device.proof("GET", API, { accessToken: token }),
            method: "POST",
            url: API,
          }),
        ).rejects.toMatchObject({ meta: { reason: "dpop_htm" } });
        await expect(
          p.verifyRequest({
            authorization: `DPoP ${token}`,
            dpopProof: device.proof("GET", API),
            method: "GET",
            url: API,
          }),
        ).rejects.toMatchObject({ meta: { reason: "dpop_ath" } });
      },
    },
    {
      name: "a wrong code is refused, the right one then works; a code is for the key that asked and is used once",
      async run(p) {
        const tenantId = "tnt_a";
        const login = phone();
        const device = testDevice();
        const t = p.signInProofTarget;
        const ch = await p.startChallenge({
          tenantId,
          channel: "sms",
          login,
          dpopProof: device.proof(t.htm, t.htu),
        });
        const code = ctx.inbox.get(login)!;
        const wrong = code === "000000" ? "111111" : "000000";
        await expect(
          p.verifyChallenge({
            tenantId,
            challengeId: ch.challengeId,
            code: wrong,
            dpopProof: device.proof(t.htm, t.htu),
          }),
        ).rejects.toMatchObject({ code: "IPB-IDN-001", meta: { reason: "code" } });
        await expect(
          p.verifyChallenge({
            tenantId,
            challengeId: ch.challengeId,
            code,
            dpopProof: testDevice().proof(t.htm, t.htu),
          }),
        ).rejects.toMatchObject({ code: "IPB-IDN-001", meta: { reason: "dpop_jkt" } });
        await new Promise((r) => setTimeout(r, ctx.pauseMs));
        const s = await p.verifyChallenge({
          tenantId,
          challengeId: ch.challengeId,
          code,
          dpopProof: device.proof(t.htm, t.htu),
        });
        expect(s.tokenType).toBe("DPoP");
        await expect(
          p.verifyChallenge({
            tenantId,
            challengeId: ch.challengeId,
            code,
            dpopProof: device.proof(t.htm, t.htu),
          }),
        ).rejects.toMatchObject({ code: "IPB-IDN-001", meta: { reason: "challenge" } });
      },
    },
    {
      name: "@IPB-02-03 refresh rotates the token; the old one is dead; another key revokes the device",
      async run(p) {
        const { tenantId, session, device } = await signIn(p, ctx);
        const t = p.signInProofTarget;
        const next = await p.refreshSession({
          tenantId,
          refreshToken: session.refreshToken,
          dpopProof: device.proof(t.htm, t.htu),
        });
        expect(next.refreshToken).not.toBe(session.refreshToken);
        expect(next.device.id).toBe(session.device.id);
        await call(p, device, next.accessToken);
        await expect(
          p.refreshSession({
            tenantId,
            refreshToken: session.refreshToken,
            dpopProof: device.proof(t.htm, t.htu),
          }),
        ).rejects.toMatchObject({ code: "IPB-IDN-001", meta: { reason: "refresh" } });
        // The current refresh token with another key: it has left the device, so the device goes.
        await expect(
          p.refreshSession({
            tenantId,
            refreshToken: next.refreshToken,
            dpopProof: testDevice().proof(t.htm, t.htu),
          }),
        ).rejects.toMatchObject({ meta: { reason: "dpop_jkt" } });
        await expect(call(p, device, next.accessToken)).rejects.toMatchObject({
          code: "IPB-IDN-001",
        });
        await expect(
          p.refreshSession({
            tenantId,
            refreshToken: next.refreshToken,
            dpopProof: device.proof(t.htm, t.htu),
          }),
        ).rejects.toMatchObject({ meta: { reason: "refresh" } });
      },
    },
    {
      name: "@IPB-02-05 unbinding a device refuses its tokens and its refresh and forgets it; closing the account forgets every device",
      async run(p) {
        const a = await signIn(p, ctx);
        const sub = (await call(p, a.device, a.session.accessToken)).sub;
        const b = await signIn(p, ctx, { login: a.login, device: testDevice() }).catch(
          async (e: unknown) => {
            // The resend interval applies per account: wait it out once.
            if ((e as { code?: string }).code !== "IPB-SEC-019") throw e;
            const wait = Number(
              (e as { meta?: { retryAfterSeconds?: number } }).meta?.retryAfterSeconds ?? 30,
            );
            await new Promise((r) => setTimeout(r, wait * 1000 + 200));
            return signIn(p, ctx, { login: a.login, device: testDevice() });
          },
        );
        expect(b.session.device.id).not.toBe(a.session.device.id);
        await p.revokeDevice("tnt_a", sub, a.session.device.id);
        await expect(call(p, a.device, a.session.accessToken)).rejects.toMatchObject({
          code: "IPB-IDN-001",
        });
        const t = p.signInProofTarget;
        await expect(
          p.refreshSession({
            tenantId: "tnt_a",
            refreshToken: a.session.refreshToken,
            dpopProof: a.device.proof(t.htm, t.htu),
          }),
        ).rejects.toMatchObject({ meta: { reason: "refresh" } });
        await call(p, b.device, b.session.accessToken);
        // Deleted at once (owner answer #86): only the other device is left.
        const list = await p.listDevices("tnt_a", sub);
        expect(list.map((d) => d.id)).toEqual([b.session.device.id]);
        expect(list[0]?.revokedAt).toBeUndefined();
        await p.forgetDevices("tnt_a", sub);
        await expect(call(p, b.device, b.session.accessToken)).rejects.toMatchObject({
          code: "IPB-IDN-001",
        });
        expect(await p.listDevices("tnt_a", sub)).toEqual([]);
      },
    },
    {
      name: "@IPB-02 auth.otp a second code inside the resend interval is IPB-SEC-019 before the IdP is asked",
      async run(p) {
        const login = phone();
        const device = testDevice();
        const t = p.signInProofTarget;
        await p.startChallenge({
          tenantId: "tnt_a",
          channel: "sms",
          login,
          dpopProof: device.proof(t.htm, t.htu),
        });
        const first = ctx.inbox.get(login);
        await expect(
          p.startChallenge({
            tenantId: "tnt_a",
            channel: "sms",
            login,
            dpopProof: device.proof(t.htm, t.htu),
          }),
        ).rejects.toMatchObject({ code: "IPB-SEC-019", meta: { reason: "resend_interval" } });
        expect(ctx.inbox.get(login)).toBe(first);
      },
    },
    {
      name: "one account per tenant and login; an email login works the same way",
      async run(p) {
        const login = phone();
        const a = await signIn(p, ctx, { tenantId: "tnt_a", login });
        const b = await signIn(p, ctx, { tenantId: "tnt_b", login });
        const ca = await call(p, a.device, a.session.accessToken);
        const cb = await call(p, b.device, b.session.accessToken);
        expect(ca.tid).toBe("tnt_a");
        expect(cb.tid).toBe("tnt_b");
        expect(ca.sub).not.toBe(cb.sub);
        const e = await signIn(p, ctx, {
          channel: "email",
          login: `Asha.${randomInt(1_000_000_000)}@Example.test`,
        });
        expect((await call(p, e.device, e.session.accessToken)).tid).toBe("tnt_a");
      },
    },
    {
      name: "a malformed login or a bad sign-in proof is refused before anything is sent",
      async run(p) {
        const before = ctx.inbox.size;
        const t = p.signInProofTarget;
        await expect(
          p.startChallenge({
            tenantId: "tnt_a",
            channel: "sms",
            login: "98123",
            dpopProof: testDevice().proof(t.htm, t.htu),
          }),
        ).rejects.toMatchObject({ code: "IPB-IDN-001", meta: { reason: "login" } });
        await expect(
          p.startChallenge({
            tenantId: "tnt_a",
            channel: "sms",
            login: phone(),
            dpopProof: testDevice().proof("POST", API),
          }),
        ).rejects.toMatchObject({ code: "IPB-IDN-001", meta: { reason: "dpop_htu" } });
        expect(ctx.inbox.size).toBe(before);
      },
    },
  ];
}
