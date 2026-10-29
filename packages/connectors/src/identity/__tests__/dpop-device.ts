// Test-only customer device: an ES256 key pair and the DPoP proofs (RFC 9449) a mobile app makes
// with it. The platform only verifies proofs (@infrabyx/crypto `verifyDpopProof`); signing them is
// the device's job, so this file plays the device against the adapters.
// eslint-disable-next-line ipb/no-direct-crypto
import { generateKeyPairSync, sign } from "node:crypto";
import { accessTokenHash, randomBytes, toBase64Url } from "@infrabyx/crypto";

export interface TestDevice {
  jwk: { kty: "EC"; crv: "P-256"; x: string; y: string };
  /** A proof for one request; `accessToken` adds `ath`. */
  proof(htm: string, htu: string, o?: { accessToken?: string; iat?: number }): string;
}

const b64json = (o: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(o)));

export function testDevice(): TestDevice {
  const k = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const j = k.publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const jwk = { kty: "EC" as const, crv: "P-256" as const, x: j.x, y: j.y };
  return {
    jwk,
    proof(htm, htu, o = {}) {
      const h = b64json({ typ: "dpop+jwt", alg: "ES256", jwk });
      const p = b64json({
        jti: toBase64Url(randomBytes(16)),
        htm,
        htu,
        iat: o.iat ?? Math.floor(Date.now() / 1000),
        ...(o.accessToken ? { ath: accessTokenHash(o.accessToken) } : {}),
      });
      const sig = sign("sha256", Buffer.from(`${h}.${p}`), {
        key: k.privateKey,
        dsaEncoding: "ieee-p1363",
      });
      return `${h}.${p}.${toBase64Url(new Uint8Array(sig))}`;
    },
  };
}

/** A sender that keeps the last code per login, as the customer's phone would. */
export function capturingSender() {
  const inbox = new Map<string, string>();
  const sent: Array<{ channel: string; idempotencyKey: string }> = [];
  return {
    inbox,
    sent,
    sender: {
      async send(m: { to: string; code: string; channel: string; idempotencyKey: string }) {
        inbox.set(m.to, m.code);
        sent.push({ channel: m.channel, idempotencyKey: m.idempotencyKey });
      },
    },
  };
}
