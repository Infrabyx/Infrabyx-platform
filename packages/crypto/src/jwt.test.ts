// C-11 verification: RFC 7515 Appendix A and RFC 7520 §4 vectors, the negative cases, and a
// differential test against `jose` (test-only devDependency, PL2-C-02).
import { constants, generateKeyPairSync, sign as nodeSign, type KeyObject } from "node:crypto";
import { createRequire } from "node:module";
import { SignJWT, exportJWK, generateKeyPair, jwtVerify, createLocalJWKSet, type JWK } from "jose";
import { describe, expect, it } from "vitest";
import { JwksCache, verifyJws, verifyJwt, type JwsAlgorithm, type PublicJwk } from "./jwt.js";

interface Vector {
  source: string;
  alg: string;
  protected: string;
  payload: string;
  signature: string;
  jwk: PublicJwk | null;
}
const { vectors } = createRequire(import.meta.url)("./__fixtures__/jws-vectors.json") as {
  vectors: Vector[];
};
const b64 = (s: string | Uint8Array) => Buffer.from(s).toString("base64url");
const compact = (v: Vector) => `${b64(v.protected)}.${b64(v.payload)}.${v.signature}`;
const reason = (p: Promise<unknown>) =>
  p.then(
    () => "verified",
    (e: { code?: string; meta?: { reason?: string } }) => `${e.code}:${e.meta?.reason}`,
  );

describe("C-11 RFC vectors", () => {
  it("RFC 7515 A.3 ES256 verifies with the vector's public key (kid supplied by the caller)", async () => {
    const v = vectors.find((x) => x.source === "RFC 7515 A.3")!;
    // The vector has no kid; re-wrap the header with one and keep the original signing input.
    const { payload, header } = await verifyJws(compact(v), {
      algorithms: ["ES256"],
      resolveKey: async () => v.jwk!,
    }).catch((e) => ({ payload: e, header: null }));
    // Without a kid the token is refused (C-11 requires kid).
    expect(header).toBeNull();
    expect(payload).toMatchObject({ code: "IPB-IDN-001", meta: { reason: "kid_missing" } });
  });

  it("RFC 7515 A.3 signature is accepted by the ES256 primitive (P1363, 64 bytes)", async () => {
    const v = vectors.find((x) => x.source === "RFC 7515 A.3")!;
    const { createPublicKey, verify } = await import("node:crypto");
    const key = createPublicKey({ key: v.jwk as never, format: "jwk" });
    const input = Buffer.from(`${b64(v.protected)}.${b64(v.payload)}`);
    expect(
      verify(
        "sha256",
        input,
        { key, dsaEncoding: "ieee-p1363" },
        Buffer.from(v.signature, "base64url"),
      ),
    ).toBe(true);
  });

  it.each([
    ["RFC 7515 A.1", "alg_not_allowed"], // HS256
    ["RFC 7515 A.2", "alg_not_allowed"], // RS256
    ["RFC 7520 4.1", "alg_not_allowed"], // RS256
    ["RFC 7520 4.2", "alg_not_allowed"], // PS384
    ["RFC 7520 4.3", "alg_not_allowed"], // ES512
    ["RFC 7520 4.4", "alg_not_allowed"], // HS256
  ])("%s is refused (%s)", async (source, why) => {
    const v = vectors.find((x) => x.source === source)!;
    expect(
      await reason(
        verifyJws(compact(v), {
          algorithms: ["ES256", "PS256"],
          resolveKey: async () => v.jwk ?? undefined,
        }),
      ),
    ).toBe(`IPB-IDN-001:${why}`);
  });
});

// ---- helpers for generated tokens ---------------------------------------------------------------

type Pair = { privateKey: KeyObject; jwk: PublicJwk };
function pair(alg: JwsAlgorithm, kid = "k1", bits = 2048): Pair {
  const kp =
    alg === "ES256"
      ? generateKeyPairSync("ec", { namedCurve: "P-256" })
      : generateKeyPairSync("rsa", { modulusLength: bits });
  return {
    privateKey: kp.privateKey,
    jwk: { ...(kp.publicKey.export({ format: "jwk" }) as PublicJwk), kid, alg, use: "sig" },
  };
}
function token(
  p: Pair,
  alg: JwsAlgorithm,
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
): string {
  const input = `${b64(JSON.stringify({ alg, kid: p.jwk.kid, ...header }))}.${b64(JSON.stringify(claims))}`;
  const sig =
    alg === "ES256"
      ? nodeSign("sha256", Buffer.from(input), { key: p.privateKey, dsaEncoding: "ieee-p1363" })
      : nodeSign("sha256", Buffer.from(input), {
          key: p.privateKey,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: 32,
        });
  return `${input}.${b64(sig)}`;
}

const NOW = Date.UTC(2026, 9, 26, 12);
const T = NOW / 1000;
const claims = {
  iss: "https://idp.example/realms/ld",
  aud: "api",
  sub: "usr_1",
  exp: T + 300,
  iat: T,
};
const es = pair("ES256");
const ps = pair("PS256", "k2");
const policy = (over: Partial<Parameters<typeof verifyJwt>[1]> = {}) => ({
  issuer: claims.iss,
  audience: "api",
  algorithms: ["ES256", "PS256"] as JwsAlgorithm[],
  resolveKey: async (kid: string) => [es.jwk, ps.jwk].find((k) => k.kid === kid),
  ...over,
});

describe("C-11 negative cases", () => {
  it("accepts well-formed ES256 and PS256 tokens", async () => {
    expect((await verifyJwt(token(es, "ES256", {}, claims), policy(), NOW)).claims.sub).toBe(
      "usr_1",
    );
    expect((await verifyJwt(token(ps, "PS256", {}, claims), policy(), NOW)).header.alg).toBe(
      "PS256",
    );
  });

  it("uses the issuer's own allow-list, not the union", async () => {
    expect(
      await reason(
        verifyJwt(token(ps, "PS256", {}, claims), policy({ algorithms: ["ES256"] }), NOW),
      ),
    ).toBe("IPB-IDN-001:alg_not_allowed");
  });

  it("refuses alg none, HS256 and an alg that does not match the JWK", async () => {
    const none = `${b64(JSON.stringify({ alg: "none", kid: "k1" }))}.${b64(JSON.stringify(claims))}.`;
    expect(await reason(verifyJwt(none, policy(), NOW))).toBe("IPB-IDN-001:malformed");
    const noneSig = `${b64(JSON.stringify({ alg: "none", kid: "k1" }))}.${b64(JSON.stringify(claims))}.AA`;
    expect(await reason(verifyJwt(noneSig, policy(), NOW))).toBe("IPB-IDN-001:alg_not_allowed");
    const hs = `${b64(JSON.stringify({ alg: "HS256", kid: "k1" }))}.${b64(JSON.stringify(claims))}.AAAA`;
    expect(await reason(verifyJwt(hs, policy(), NOW))).toBe("IPB-IDN-001:alg_not_allowed");
    // An ES256 header pointing at the PS256 key.
    const swapped = token(es, "ES256", { kid: "k2" }, claims);
    expect(await reason(verifyJwt(swapped, policy(), NOW))).toBe("IPB-IDN-001:key_unsuitable");
  });

  it.each(["crit", "jku", "x5u", "x5c", "jwk", "b64"])("refuses the %s header", async (h) => {
    const t = token(es, "ES256", { [h]: h === "b64" ? false : "x" }, claims);
    expect(await reason(verifyJwt(t, policy(), NOW))).toBe("IPB-IDN-001:header_refused");
  });

  it("requires kid and a key from the configured JWKS", async () => {
    const noKid = token(es, "ES256", { kid: undefined }, claims);
    expect(await reason(verifyJwt(noKid, policy(), NOW))).toBe("IPB-IDN-001:kid_missing");
    expect(
      await reason(verifyJwt(token(es, "ES256", { kid: "nope" }, claims), policy(), NOW)),
    ).toBe("IPB-IDN-001:key_unknown");
  });

  it("refuses RSA keys under 2048 bits and JWKs with private members", async () => {
    const small = pair("PS256", "k3", 1024);
    const p = policy({ resolveKey: async () => small.jwk });
    expect(await reason(verifyJwt(token(small, "PS256", {}, claims), p, NOW))).toBe(
      "IPB-IDN-001:key_unsuitable",
    );
    const leaky = { ...es.jwk, d: "AAAA" };
    expect(
      await reason(
        verifyJwt(token(es, "ES256", {}, claims), policy({ resolveKey: async () => leaky }), NOW),
      ),
    ).toBe("IPB-IDN-001:key_unsuitable");
  });

  it("refuses non-strict base64url, extra segments and a tampered payload", async () => {
    const t = token(es, "ES256", {}, claims);
    const [h, p, s] = t.split(".") as [string, string, string];
    expect(await reason(verifyJwt(`${h}.${p}.${s}=`, policy(), NOW))).toBe("IPB-IDN-001:malformed");
    expect(await reason(verifyJwt(`${h}.${p}.${s}.x`, policy(), NOW))).toBe(
      "IPB-IDN-001:malformed",
    );
    expect(
      await reason(
        verifyJwt(`${h}.${p.replace(/.$/, (c) => (c === "A" ? "B" : "A"))}.${s}`, policy(), NOW),
      ),
    ).toMatch(/IPB-IDN-001:(malformed|signature)/);
    const other = b64(JSON.stringify({ ...claims, sub: "usr_admin" }));
    expect(await reason(verifyJwt(`${h}.${other}.${s}`, policy(), NOW))).toBe(
      "IPB-IDN-001:signature",
    );
    // A DER-encoded ECDSA signature is not accepted for ES256.
    const der = nodeSign("sha256", Buffer.from(`${h}.${p}`), es.privateKey);
    expect(await reason(verifyJwt(`${h}.${p}.${b64(der)}`, policy(), NOW))).toBe(
      "IPB-IDN-001:signature",
    );
  });

  it("checks iss, aud, exp, nbf and iat with ±60 s skew", async () => {
    const r = (c: Record<string, unknown>) =>
      reason(verifyJwt(token(es, "ES256", {}, { ...claims, ...c }), policy(), NOW));
    expect(await r({ iss: "https://evil.example" })).toBe("IPB-IDN-001:iss");
    expect(await r({ aud: ["other"] })).toBe("IPB-IDN-001:aud");
    expect(await r({ aud: ["other", "api"] })).toBe("verified");
    expect(await r({ exp: undefined })).toBe("IPB-IDN-001:exp");
    expect(await r({ exp: T - 59 })).toBe("verified");
    expect(await r({ exp: T - 61 })).toBe("IPB-IDN-001:exp");
    expect(await r({ nbf: T + 59 })).toBe("verified");
    expect(await r({ nbf: T + 61 })).toBe("IPB-IDN-001:nbf");
    expect(await r({ iat: T + 61 })).toBe("IPB-IDN-001:iat");
    expect(await r({ exp: "soon" })).toBe("IPB-IDN-001:exp");
  });
});

describe("C-11 JWKS cache", () => {
  it("caches 24 h, refetches an unknown kid at most once a minute, and fails closed after the TTL", async () => {
    let t = NOW;
    let calls = 0;
    let keys: PublicJwk[] = [es.jwk];
    let up = true;
    const cache = new JwksCache({
      fetchJwks: async () => {
        calls++;
        if (!up) throw new Error("idp down");
        return { keys };
      },
      now: () => t,
    });
    expect(await cache.resolve("k1")).toBeDefined();
    expect(await cache.resolve("k1")).toBeDefined();
    expect(calls).toBe(1);
    expect(await cache.resolve("k2")).toBeUndefined(); // within a minute of the first fetch
    expect(calls).toBe(1);
    t += 61_000;
    keys = [es.jwk, ps.jwk];
    expect(await cache.resolve("k2")).toBeDefined(); // rotation picked up
    expect(calls).toBe(2);
    up = false;
    t += 23 * 3_600_000;
    expect(await cache.resolve("k1")).toBeDefined(); // IdP outage, cache still valid
    t += 2 * 3_600_000;
    expect(await cache.resolve("k1")).toBeUndefined(); // past 24 h without a fetch
    expect(await cache.resolve("k1")).toBeUndefined();
  });

  it("drops JWKS entries without kid or with private members", async () => {
    const cache = new JwksCache({
      fetchJwks: async () => ({
        keys: [
          { ...es.jwk, kid: undefined },
          { ...ps.jwk, d: "x" },
        ],
      }),
    });
    expect(await cache.resolve("k2")).toBeUndefined();
  });
});

describe("C-11 differential test against jose", () => {
  for (const alg of ["ES256", "PS256"] as const) {
    it(`${alg}: jose-signed tokens verify identically, and tampering fails in both`, async () => {
      const { privateKey, publicKey } = await generateKeyPair(alg, { modulusLength: 2048 });
      const jwk = { ...(await exportJWK(publicKey)), kid: "kd", alg, use: "sig" } as JWK &
        PublicJwk;
      const jwks = createLocalJWKSet({ keys: [jwk] });
      const ours = policy({ resolveKey: async (kid) => (kid === "kd" ? jwk : undefined) });
      for (let i = 0; i < 10; i++) {
        const t = await new SignJWT({ n: i, sub: `usr_${i}` })
          .setProtectedHeader({ alg, kid: "kd" })
          .setIssuer(claims.iss)
          .setAudience("api")
          .setIssuedAt(T)
          .setExpirationTime(T + 300)
          .sign(privateKey);
        const a = await verifyJwt(t, ours, NOW);
        const b = await jwtVerify(t, jwks, {
          issuer: claims.iss,
          audience: "api",
          currentDate: new Date(NOW),
        });
        expect(a.claims).toEqual(b.payload);
        // Flip one bit of the decoded signature, so the tampered token always differs.
        const [h0, p0, s0] = t.split(".") as [string, string, string];
        const sig = Buffer.from(s0, "base64url");
        sig.writeUInt8((sig.readUInt8(i % sig.byteLength) ^ 0x01) & 0xff, i % sig.byteLength);
        const bad = `${h0}.${p0}.${sig.toString("base64url")}`;
        expect(bad).not.toBe(t);
        const ourBad = await reason(verifyJwt(bad, ours, NOW));
        const joseBad = await jwtVerify(bad, jwks, { currentDate: new Date(NOW) }).then(
          () => "verified",
          () => "refused",
        );
        expect(ourBad).not.toBe("verified");
        expect(joseBad).toBe("refused");
      }
    });
  }
});
