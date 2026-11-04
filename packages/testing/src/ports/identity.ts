// IDENTITY contract cases and fakes for the 1.x additions to the workforce port (LawDocsComply).
// The refresh-token grant with rotation and reuse detection (PR-LDC-03, R1-D-77): every adapter
// passes the same cases against something that can sign a user in. The fake signs in itself;
// Keycloak and Zitadel run them in their hermetic legs (CI) after a real login.
import { expect } from "vitest";
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  AdapterDescriptor,
  IdentitySessionRefresh,
  PortHealth,
  RefreshedTokens,
  VerifiedClaims,
} from "@infrabyx/contracts/ports";
import { randomBytes, sha256Hex, toHex } from "@infrabyx/crypto";
import type { ContractCase } from "../contract.js";

// ---- refresh-token grant ------------------------------------------------------------------------

/** Signs a user in and returns the session's first refresh token. */
export interface IdentityRefreshFixtures {
  signIn(): Promise<{ refreshToken: string }>;
}

export interface IdentityRefreshCaseOptions {
  /**
   * Pause between issuing a token and presenting the next one. IdPs compare token issue times in
   * whole seconds (Keycloak's stale-token rule), so hermetic legs pass about 1 100 ms; 0 for fakes.
   */
  pauseMs?: number;
}

const refused = (reason: string, detail: string) =>
  new IpbError("IPB-IDN-001", { detail, meta: { reason } });

/**
 * In-memory refresh grant with rotation: tokens are random and remembered by SHA-256 only; a
 * spent token presented again revokes its session (its access tokens and current refresh token).
 */
export class FakeIdentitySessions implements IdentitySessionRefresh, IdentityRefreshFixtures {
  readonly descriptor: AdapterDescriptor = {
    port: "IDENTITY",
    adapter: "fake-identity",
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
  };
  private readonly refresh = new Map<string, { sid: string; spent: boolean }>();
  private readonly access = new Map<string, { sid: string; iat: number }>();
  private readonly sessions = new Map<
    string,
    { tenantId: string; userId: string; revoked: boolean }
  >();
  down = false;

  constructor(private readonly now: () => number = Date.now) {}

  private mint(sid: string): RefreshedTokens {
    const refreshToken = `fake-rt.${toHex(randomBytes(24))}`;
    const accessToken = `fake-at.${toHex(randomBytes(24))}`;
    this.refresh.set(sha256Hex(refreshToken), { sid, spent: false });
    this.access.set(accessToken, { sid, iat: Math.floor(this.now() / 1000) });
    return { accessToken, refreshToken, expiresIn: 300 };
  }

  async signIn(o: { tenantId?: string; userId?: string } = {}): Promise<RefreshedTokens> {
    const sid = `sid-${toHex(randomBytes(8))}`;
    this.sessions.set(sid, {
      tenantId: o.tenantId ?? "tnt_fake",
      userId: o.userId ?? `usr-${toHex(randomBytes(6))}`,
      revoked: false,
    });
    return this.mint(sid);
  }

  /** Whether a session has been revoked (test assertions). */
  isRevoked(sid: string): boolean {
    return this.sessions.get(sid)?.revoked ?? false;
  }

  async health(): Promise<PortHealth> {
    return {
      status: this.down ? "down" : "up",
      latency_ms: 0,
      checked_at: new Date().toISOString(),
    };
  }

  async refreshSession(req: { refreshToken: string }): Promise<RefreshedTokens> {
    if (this.down)
      throw new IpbError("IPB-IDN-002", { detail: "identity provider unavailable for refresh" });
    const t = req.refreshToken ? this.refresh.get(sha256Hex(req.refreshToken)) : undefined;
    const s = t && this.sessions.get(t.sid);
    if (!t || !s || s.revoked) throw refused("refresh_invalid", "the refresh token was refused");
    if (t.spent) {
      s.revoked = true;
      throw refused(
        "refresh_reused",
        "a spent refresh token was presented again; the session is revoked",
      );
    }
    t.spent = true;
    return this.mint(t.sid);
  }

  async verifyToken(jwt: string): Promise<VerifiedClaims> {
    const a = this.access.get(jwt);
    const s = a && this.sessions.get(a.sid);
    if (!a || !s) throw refused("signature", "not a token of this identity provider");
    if (s.revoked) throw refused("revoked", "session or user has been revoked");
    return {
      sub: s.userId,
      tid: s.tenantId,
      typ: "user",
      roles: [],
      sid: a.sid,
      iat: a.iat,
      exp: a.iat + 300,
    };
  }
}

const pause = (ms: number) =>
  ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve();

/** The refusal of a refresh, with what it exposes (code, reason, every text it carries). */
async function refusal(
  p: IdentitySessionRefresh,
  refreshToken: string,
): Promise<{ code: unknown; reason: unknown; text: string }> {
  try {
    await p.refreshSession({ refreshToken });
  } catch (e) {
    const x = e as { code?: unknown; message?: unknown; detail?: unknown; meta?: unknown };
    return {
      code: x.code,
      reason: (x.meta as { reason?: unknown } | undefined)?.reason,
      text: JSON.stringify([x.message, x.detail, x.meta]),
    };
  }
  throw new Error("the refresh was accepted");
}

export function identityRefreshContractCases(
  f: IdentityRefreshFixtures,
  o: IdentityRefreshCaseOptions = {},
): ContractCase<IdentitySessionRefresh>[] {
  const wait = () => pause(o.pauseMs ?? 0);
  return [
    {
      name: "refreshSession rotates: a new refresh token and a verifiable access token (PR-LDC-03)",
      method: "refreshSession",
      invoke: (p) => p.refreshSession({ refreshToken: "not-a-refresh-token" }),
      async run(p) {
        const { refreshToken } = await f.signIn();
        await wait();
        const r1 = await p.refreshSession({ refreshToken });
        expect(r1.refreshToken).toBeTruthy();
        expect(r1.refreshToken).not.toBe(refreshToken);
        expect(r1.expiresIn).toBeGreaterThan(0);
        const c = await p.verifyToken(r1.accessToken);
        expect(c.sub).toBeTruthy();
        await wait();
        // The new token rotates in turn.
        const r2 = await p.refreshSession({ refreshToken: r1.refreshToken });
        expect(r2.refreshToken).not.toBe(r1.refreshToken);
        expect((await p.verifyToken(r2.accessToken)).sub).toBe(c.sub);
      },
    },
    {
      name: "a spent refresh token presented again revokes the session: IPB-IDN-001 refresh_reused; its successor fails too (R1-D-77)",
      method: "refreshSession",
      invoke: (p) => p.refreshSession({ refreshToken: "not-a-refresh-token" }),
      async run(p) {
        const { refreshToken } = await f.signIn();
        await wait();
        const r1 = await p.refreshSession({ refreshToken });
        await p.verifyToken(r1.accessToken);
        await wait();
        const reused = await refusal(p, refreshToken);
        expect(reused).toMatchObject({ code: "IPB-IDN-001", reason: "refresh_reused" });
        // Refresh tokens never travel in an error (nor, therefore, in a log of it).
        expect(reused.text).not.toContain(refreshToken);
        await wait();
        const successor = await refusal(p, r1.refreshToken);
        expect(successor.code).toBe("IPB-IDN-001");
        expect(successor.text).not.toContain(r1.refreshToken);
        // The session's access tokens are refused too (IPB-02-05).
        await expect(p.verifyToken(r1.accessToken)).rejects.toMatchObject({
          code: "IPB-IDN-001",
        });
      },
    },
    {
      name: "an unknown refresh token is refused as refresh_invalid, not as a reuse",
      method: "refreshSession",
      invoke: (p) => p.refreshSession({ refreshToken: "not-a-refresh-token" }),
      async run(p) {
        expect(await refusal(p, "not-a-refresh-token")).toMatchObject({
          code: "IPB-IDN-001",
          reason: "refresh_invalid",
        });
        expect(await refusal(p, "")).toMatchObject({
          code: "IPB-IDN-001",
          reason: "refresh_invalid",
        });
        // An unrelated session is untouched by those refusals.
        const { refreshToken } = await f.signIn();
        await wait();
        const r = await p.refreshSession({ refreshToken });
        await p.verifyToken(r.accessToken);
      },
    },
  ];
}
