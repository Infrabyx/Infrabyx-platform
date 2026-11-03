// C-26 (R1-D-33): HS256 for LiveKit only, within the owner's limits; and no other HS256 path.
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fromBase64Url, toHex } from "./encoding.js";
import { keyMaterial } from "./keys.js";
import { LOCAL_KMS_KEYS, localDevKey } from "./local-kms.js";
import {
  LiveKitCredentials,
  signLiveKitJoinToken,
  signLiveKitServerToken,
  signLiveKitWebhookForTest,
  verifyLiveKitWebhook,
} from "./livekit-token.js";
import { randomBytes } from "./random.js";
import { generateWebhookSecret } from "./webhook-sig.js";

const SECRET = generateWebhookSecret();
const c = new LiveKitCredentials("APIipbtest", SECRET);
const decode = (t: string) =>
  JSON.parse(new TextDecoder().decode(fromBase64Url(t.split(".")[1] as string))) as Record<
    string,
    unknown
  >;
const join_ = { canPublish: true, canSubscribe: true, canPublishData: false };

describe("C-26 LiveKit tokens (R1-D-33)", () => {
  it("refuses a short, non-random-looking or dev-key secret, and never prints the secret", () => {
    expect(() => new LiveKitCredentials("APIx", "secret")).toThrow(/32 random bytes/);
    expect(() => new LiveKitCredentials("APIx", "a".repeat(20))).toThrow(/32 random bytes/);
    expect(
      () =>
        new LiveKitCredentials("APIx", toHex(keyMaterial(localDevKey(LOCAL_KMS_KEYS.platform)))),
    ).toThrow(/dev key/);
    expect(() => new LiveKitCredentials("API key!", SECRET)).toThrow(/API key/);
    expect(JSON.stringify(c)).not.toContain(SECRET);
    expect(String(c)).not.toContain(SECRET);
  });

  it("signs a join token as LiveKit verifies it: HS256 over the secret string, one room and identity", () => {
    const { token, expiresAt } = signLiveKitJoinToken(c, {
      room: "room_a",
      identity: "cus:1",
      grants: join_,
      now: 1_800_000_000_000,
    });
    const [h, p, s] = token.split(".") as [string, string, string];
    expect(createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")).toBe(s);
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(h)))).toEqual({
      alg: "HS256",
      typ: "JWT",
    });
    const claims = decode(token);
    expect(claims).toMatchObject({
      iss: "APIipbtest",
      sub: "cus:1",
      video: {
        room: "room_a",
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,
      },
    });
    expect((claims.exp as number) - (claims.nbf as number)).toBe(300);
    expect(expiresAt).toBe((claims.exp as number) * 1000);
  });

  it("refuses join tokens longer than 300 s or with any other grant", () => {
    expect(() =>
      signLiveKitJoinToken(c, { room: "r1", identity: "u1", grants: join_, ttlSeconds: 301 }),
    ).toThrow(/1 to 300/);
    expect(() =>
      signLiveKitJoinToken(c, {
        room: "r1",
        identity: "u1",
        grants: { ...join_, roomAdmin: true } as never,
      }),
    ).toThrow(/only the publish/);
    expect(() => signLiveKitJoinToken(c, { room: "*", identity: "u1", grants: join_ })).toThrow(
      /one room/,
    );
  });

  it("signs a server token with exactly one grant for at most 60 s, room-scoped where it must be", () => {
    const t = decode(signLiveKitServerToken(c, { roomAdmin: true, room: "room_a" }));
    expect(t.video).toEqual({ roomAdmin: true, room: "room_a" });
    expect((t.exp as number) - (t.nbf as number)).toBe(60);
    expect(() => signLiveKitServerToken(c, { roomAdmin: true } as never)).toThrow(
      /name their room/,
    );
    expect(() => signLiveKitServerToken(c, { roomCreate: true, roomList: true } as never)).toThrow(
      /exactly one/,
    );
    expect(() => signLiveKitServerToken(c, { roomCreate: true, room: "x" } as never)).toThrow();
    expect(() => signLiveKitServerToken(c, { roomList: true }, { ttlSeconds: 61 })).toThrow(
      /1 to 60/,
    );
  });

  it("verifies webhooks: issuer, expiry with 60 s skew, body hash and signature, HS256 only", () => {
    const body = new TextEncoder().encode('{"event":"room_finished"}');
    const now = 1_800_000_000_000;
    const auth = signLiveKitWebhookForTest(c, body, { now, ttlSeconds: 300 });
    expect(verifyLiveKitWebhook(c, auth, body, { now })).toBeNull();
    expect(verifyLiveKitWebhook(c, auth, new TextEncoder().encode("{}"), { now })).toBe(
      "body_hash",
    );
    expect(verifyLiveKitWebhook(c, auth, body, { now: now + 361_000 })).toBe("expired");
    expect(verifyLiveKitWebhook(c, auth, body, { now: now + 359_000 })).toBeNull();
    const other = new LiveKitCredentials("APIother", SECRET);
    expect(
      verifyLiveKitWebhook(other, signLiveKitWebhookForTest(other, body, { now }), body, { now }),
    ).toBeNull();
    expect(
      verifyLiveKitWebhook(c, signLiveKitWebhookForTest(other, body, { now }), body, { now }),
    ).toBe("issuer");
    const wrong = new LiveKitCredentials("APIipbtest", generateWebhookSecret());
    expect(
      verifyLiveKitWebhook(c, signLiveKitWebhookForTest(wrong, body, { now }), body, { now }),
    ).toBe("signature");
    const [, p, s] = auth.split(".") as [string, string, string];
    const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${p}.${s}`;
    expect(verifyLiveKitWebhook(c, none, body, { now })).toBe("algorithm");
    expect(verifyLiveKitWebhook(c, "garbage", body, { now })).toBe("malformed");
    expect(verifyLiveKitWebhook(c, undefined, body, { now })).toBe("malformed");
    expect(randomBytes(1).byteLength).toBe(1);
  });
});

describe("C-26: no other HS256 path anywhere (R1-D-33)", () => {
  it("names the HS256 algorithm only in livekit-token.ts among the platform's runtime sources", () => {
    const root = join(fileURLToPath(import.meta.url), "../../../..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        if (n === "node_modules" || n === "dist" || n.startsWith(".")) continue;
        const f = join(dir, n);
        if (statSync(f).isDirectory()) walk(f);
        else if (/\.(ts|tsx|mjs|js)$/.test(n) && !/\.test\.tsx?$/.test(n)) {
          const text = readFileSync(f, "utf8");
          // A literal naming the algorithm as a value (not a comment listing what is refused).
          if (/["'`]HS256["'`]/.test(text) && !f.endsWith("crypto/src/livekit-token.ts"))
            hits.push(f);
        }
      }
    };
    for (const top of ["packages", "apps", "scripts"]) walk(join(root, top));
    expect(hits).toEqual([]);
  });
});
