// Customer sign-in through the IDENTITY port (OWNER-QUESTIONS #84 (b), R1-D-19), the part shared by
// the Keycloak and Zitadel adapters:
//   * settings (`int.identity.customer.*`, registered in @infrabyx/config) with the IPB-02 bounds;
//   * the guard: per-account send limits, a resend interval, exponential back-off after
//     consecutive wrong codes and a timed lockout (IPB-02 §02.4.6.2 `auth.otp`), enforced before the
//     IdP is called, so a refused request costs the IdP nothing;
//   * challenges bound to the device key that asked for the code, with attempts per code;
//   * devices: the DPoP key of each signed-in device, its IdP session and a hash of its current
//     refresh token. A refresh is accepted only with a proof by the same key and the current
//     token; a request only with a proof by an active device key of the token's user (and, where
//     the IdP binds natively, by the key in the token's `cnf.jkt`);
//   * DPoP proofs verified by `verifyDpopProof` (R1-D-18) with a replay store shared by replicas.
// Codes are delivered by the `CustomerOtpSender` (NOTIFY) and never stored or logged here.
import { IpbError, PortError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel } from "@infrabyx/contracts/kernel";
import {
  customerLogin,
  isPlatformRole,
  isTenantRole,
  type AdapterDescriptor,
  type CustomerChallenge,
  type CustomerDevice,
  type CustomerIdentityPort,
  type CustomerOtpChannel,
  type CustomerOtpSender,
  type CustomerSession,
  type DpopTarget,
  type PortHealth,
  type VerifiedClaims,
  type VerifiedCustomerClaims,
} from "@infrabyx/contracts";
import {
  newId,
  randomBytes,
  sha256Hex,
  toBase64Url,
  verifyDpopProof,
  type ReplayStore,
} from "@infrabyx/crypto";
import type { RevocationStore, TokenVerifier } from "./common.js";

// ---- settings -----------------------------------------------------------------------------------

export interface CustomerIdentitySettings {
  codeTtlSeconds: number;
  attemptsPerCode: number;
  maxSends: number;
  sendWindowSeconds: number;
  resendIntervalSeconds: number;
  backoffAfterFailures: number;
  backoffBaseSeconds: number;
  lockoutAfterFailures: number;
  lockoutSeconds: number;
  sessionIdleSeconds: number;
  sessionMaxSeconds: number;
  dpopMaxAgeSeconds: number;
  dpopMaxSkewSeconds: number;
}

/** Setting key, default and bounds of each value (the registry in @infrabyx/config holds the same). */
export const CUSTOMER_IDENTITY_SETTINGS: Readonly<
  Record<keyof CustomerIdentitySettings, { key: string; default: number; min: number; max: number }>
> = Object.freeze({
  codeTtlSeconds: {
    key: "int.identity.customer.otp.code_ttl_seconds",
    default: 300,
    min: 60,
    max: 600,
  },
  attemptsPerCode: {
    key: "int.identity.customer.otp.attempts_per_code",
    default: 5,
    min: 1,
    max: 5,
  },
  maxSends: { key: "int.identity.customer.otp.max_sends", default: 10, min: 1, max: 10 },
  sendWindowSeconds: {
    key: "int.identity.customer.otp.send_window_seconds",
    default: 600,
    min: 600,
    max: 3600,
  },
  resendIntervalSeconds: {
    key: "int.identity.customer.otp.resend_interval_seconds",
    default: 30,
    min: 30,
    max: 300,
  },
  backoffAfterFailures: {
    key: "int.identity.customer.otp.backoff_after_failures",
    default: 5,
    min: 1,
    max: 5,
  },
  backoffBaseSeconds: {
    key: "int.identity.customer.otp.backoff_base_seconds",
    default: 30,
    min: 30,
    max: 300,
  },
  lockoutAfterFailures: {
    key: "int.identity.customer.otp.lockout_after_failures",
    default: 10,
    min: 3,
    max: 10,
  },
  lockoutSeconds: {
    key: "int.identity.customer.otp.lockout_seconds",
    default: 900,
    min: 900,
    max: 86_400,
  },
  sessionIdleSeconds: {
    key: "int.identity.customer.session.idle_seconds",
    default: 1800,
    min: 300,
    max: 1800,
  },
  sessionMaxSeconds: {
    key: "int.identity.customer.session.max_seconds",
    default: 43_200,
    min: 3600,
    max: 43_200,
  },
  dpopMaxAgeSeconds: {
    key: "int.identity.customer.dpop.max_age_seconds",
    default: 60,
    min: 10,
    max: 300,
  },
  dpopMaxSkewSeconds: {
    key: "int.identity.customer.dpop.max_skew_seconds",
    default: 30,
    min: 0,
    max: 60,
  },
});

export const CUSTOMER_IDENTITY_DEFAULTS: Readonly<CustomerIdentitySettings> = Object.freeze(
  Object.fromEntries(
    Object.entries(CUSTOMER_IDENTITY_SETTINGS).map(([k, v]) => [k, v.default]),
  ) as unknown as CustomerIdentitySettings,
);

/** Complete and check settings; a value outside its bounds is a RangeError (never clamped). */
export function customerIdentitySettings(
  over: Partial<CustomerIdentitySettings> = {},
): CustomerIdentitySettings {
  const s = { ...CUSTOMER_IDENTITY_DEFAULTS, ...over };
  for (const [k, b] of Object.entries(CUSTOMER_IDENTITY_SETTINGS)) {
    const v = s[k as keyof CustomerIdentitySettings];
    if (!Number.isInteger(v) || v < b.min || v > b.max)
      throw new RangeError(`${b.key} must be an integer from ${b.min} to ${b.max}`);
  }
  if (s.lockoutAfterFailures <= s.backoffAfterFailures)
    throw new RangeError("the lockout comes after the back-off starts");
  return s;
}

/** Read the settings through a settings getter (e.g. `(k) => settings.get(ctx, k)`). */
export async function readCustomerIdentitySettings(
  get: (key: string) => Promise<unknown>,
): Promise<CustomerIdentitySettings> {
  const out: Partial<CustomerIdentitySettings> = {};
  for (const [k, b] of Object.entries(CUSTOMER_IDENTITY_SETTINGS)) {
    const v = await get(b.key);
    if (typeof v === "number") out[k as keyof CustomerIdentitySettings] = v;
  }
  return customerIdentitySettings(out);
}

// ---- errors -------------------------------------------------------------------------------------

export const customerRefused = (reason: string, detail: string): IpbError =>
  new IpbError("IPB-IDN-001", { detail, meta: { reason } });
const limited = (reason: string, retryAfterMs: number): IpbError =>
  new IpbError("IPB-SEC-019", {
    detail: "too many sign-in codes or wrong codes for this account; try again later",
    meta: { reason, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) },
  });

// ---- the guard (pure) ---------------------------------------------------------------------------

export interface GuardState {
  windowStart: number;
  sends: number;
  lastSendAt?: number;
  failures: number;
  lastFailureAt?: number;
  lockedUntil?: number;
}

export const freshGuard = (now: number): GuardState => ({
  windowStart: now,
  sends: 0,
  failures: 0,
});

/** Admit one more code for the account, or say how long to wait. */
export function admitSend(
  g: GuardState,
  s: CustomerIdentitySettings,
  now: number,
):
  | { ok: true; next: GuardState; resendAfter: number }
  | { ok: false; reason: string; retryAfterMs: number } {
  if (g.lockedUntil !== undefined && g.lockedUntil > now)
    return { ok: false, reason: "locked", retryAfterMs: g.lockedUntil - now };
  if (g.lastSendAt !== undefined && g.lastSendAt + s.resendIntervalSeconds * 1000 > now)
    return {
      ok: false,
      reason: "resend_interval",
      retryAfterMs: g.lastSendAt + s.resendIntervalSeconds * 1000 - now,
    };
  const windowOpen = now - g.windowStart < s.sendWindowSeconds * 1000;
  const base = windowOpen ? g : { ...g, windowStart: now, sends: 0 };
  if (base.sends >= s.maxSends)
    return {
      ok: false,
      reason: "max_sends",
      retryAfterMs: base.windowStart + s.sendWindowSeconds * 1000 - now,
    };
  const next = { ...base, sends: base.sends + 1, lastSendAt: now };
  return { ok: true, next, resendAfter: now + s.resendIntervalSeconds * 1000 };
}

/** Admit one more try at a code: refused while locked, or inside the back-off after failures. */
export function admitAttempt(
  g: GuardState,
  s: CustomerIdentitySettings,
  now: number,
): { ok: true } | { ok: false; reason: string; retryAfterMs: number } {
  if (g.lockedUntil !== undefined && g.lockedUntil > now)
    return { ok: false, reason: "locked", retryAfterMs: g.lockedUntil - now };
  if (g.failures >= s.backoffAfterFailures && g.lastFailureAt !== undefined) {
    const wait = s.backoffBaseSeconds * 1000 * 2 ** (g.failures - s.backoffAfterFailures);
    if (g.lastFailureAt + wait > now)
      return { ok: false, reason: "backoff", retryAfterMs: g.lastFailureAt + wait - now };
  }
  return { ok: true };
}

/** A wrong code: one more failure; at the lockout threshold the account locks and the count resets. */
export function afterFailure(g: GuardState, s: CustomerIdentitySettings, now: number): GuardState {
  const failures = g.failures + 1;
  if (failures >= s.lockoutAfterFailures)
    return { ...g, failures: 0, lastFailureAt: now, lockedUntil: now + s.lockoutSeconds * 1000 };
  return { ...g, failures, lastFailureAt: now };
}

export const afterSuccess = (g: GuardState): GuardState => {
  const { lastFailureAt: _l, ...rest } = g;
  return { ...rest, failures: 0 };
};

// ---- records and the store ----------------------------------------------------------------------

export interface ChallengeRecord {
  id: string;
  tenantId: string;
  userId: string;
  channel: CustomerOtpChannel;
  jkt: string;
  /** The IdP's handle on the code (Keycloak challenge id; Zitadel session). Never the code. */
  idpRef: Record<string, string>;
  attempts: number;
  expiresAt: number;
  consumedAt?: number;
}

export interface DeviceRecord {
  id: string;
  tenantId: string;
  userId: string;
  jkt: string;
  idpSession: string;
  refreshHash: string;
  label?: string;
  createdAt: number;
  lastUsedAt: number;
  revokedAt?: number;
  revokedReason?: DeviceRevocationReason;
}

export type DeviceRevocationReason = "sign_out" | "revoked" | "key_mismatch" | "security";
/** Why a device is deleted at once, not by retention (owner answer #86, R1-D-23). */
export type DeviceDeletionReason = "unbound" | "account_closed";

/** What the retention job deletes (owner answer #86, R1-D-23); times in epoch milliseconds. */
export interface CustomerRetentionCutoffs {
  /** Challenges that expired before this. */
  challengesExpiredBefore: number;
  /** Devices last used before this. */
  devicesUnusedSince: number;
  /** Guard rows whose lock, send window and failure window all ended before this. */
  guardsEndedBefore: number;
  /** The guard's send window and lockout (`int.identity.customer.otp.*`), which end a guard row. */
  sendWindowMs: number;
  lockoutMs: number;
}
export interface CustomerPurgeCounts {
  challenges: number;
  guards: number;
  devices: number;
}

/** A guard row is done once its lock, its send window and a lockout after its last failure ended. */
export const guardEnded = (g: GuardState, c: CustomerRetentionCutoffs): boolean =>
  (g.lockedUntil ?? 0) < c.guardsEndedBefore &&
  g.windowStart + c.sendWindowMs < c.guardsEndedBefore &&
  (g.lastFailureAt === undefined || g.lastFailureAt + c.lockoutMs < c.guardsEndedBefore);

export interface CustomerAuthStore {
  /** Count one code for the account (guard), or throw IPB-SEC-019. */
  reserveSend(
    tenantId: string,
    userId: string,
    s: CustomerIdentitySettings,
    now: number,
  ): Promise<{ resendAfter: number }>;
  saveChallenge(c: ChallengeRecord): Promise<void>;
  getChallenge(tenantId: string, id: string): Promise<ChallengeRecord | undefined>;
  /**
   * Count one try at the challenge's code: refused (IPB-SEC-019) while the account is locked or
   * backing off, and (IPB-IDN-001) when the challenge is used, expired or out of tries.
   */
  attempt(
    tenantId: string,
    id: string,
    s: CustomerIdentitySettings,
    now: number,
  ): Promise<ChallengeRecord>;
  /** The IdP's answer: a success consumes the challenge and clears failures; a failure counts. */
  settle(
    tenantId: string,
    id: string,
    ok: boolean,
    s: CustomerIdentitySettings,
    now: number,
  ): Promise<void>;
  createDevice(d: DeviceRecord): Promise<void>;
  deviceByRefresh(tenantId: string, refreshHash: string): Promise<DeviceRecord | undefined>;
  /** Compare-and-set of the refresh hash; false if another refresh won. */
  rotateRefresh(
    tenantId: string,
    deviceId: string,
    from: string,
    to: string,
    now: number,
  ): Promise<boolean>;
  activeDevice(tenantId: string, userId: string, jkt: string): Promise<DeviceRecord | undefined>;
  listDevices(tenantId: string, userId: string): Promise<DeviceRecord[]>;
  revokeDevice(
    tenantId: string,
    deviceId: string,
    reason: DeviceRevocationReason,
    now: number,
  ): Promise<DeviceRecord | undefined>;
  /** Delete a revoked device at once (unbound, or the account closed); false if none. Ledgered. */
  deleteDevice(tenantId: string, deviceId: string, reason: DeviceDeletionReason): Promise<boolean>;
  /** Delete what the cut-offs make due, at most `limit` rows per table; each deletion ledgered. */
  purge(tenantId: string, c: CustomerRetentionCutoffs, limit: number): Promise<CustomerPurgeCounts>;
}

const accountHash = (userId: string) => sha256Hex(`customer:${userId}`);
/** Thrown inside a purge transaction that found nothing due, so it rolls back unledgered. */
const NOTHING_DUE = Symbol("nothing due");

function attemptChecks(
  c: ChallengeRecord | undefined,
  g: GuardState,
  s: CustomerIdentitySettings,
  now: number,
): ChallengeRecord {
  if (!c || c.consumedAt !== undefined || c.expiresAt <= now)
    throw customerRefused(
      "challenge",
      "the sign-in code has expired or was used; ask for a new one",
    );
  const admit = admitAttempt(g, s, now);
  if (!admit.ok) throw limited(admit.reason, admit.retryAfterMs);
  if (c.attempts >= s.attemptsPerCode)
    throw customerRefused("challenge", "too many tries for this code; ask for a new one");
  return { ...c, attempts: c.attempts + 1 };
}

/** Single-process store for tests and local development. */
export class MemoryCustomerAuthStore implements CustomerAuthStore {
  private readonly guards = new Map<string, GuardState>();
  private readonly challenges = new Map<string, ChallengeRecord>();
  private readonly devices = new Map<string, DeviceRecord>();

  private guard(tenantId: string, userId: string, now: number): GuardState {
    return this.guards.get(`${tenantId}|${accountHash(userId)}`) ?? freshGuard(now);
  }
  private setGuard(tenantId: string, userId: string, g: GuardState): void {
    this.guards.set(`${tenantId}|${accountHash(userId)}`, g);
  }

  async reserveSend(tenantId: string, userId: string, s: CustomerIdentitySettings, now: number) {
    const r = admitSend(this.guard(tenantId, userId, now), s, now);
    if (!r.ok) throw limited(r.reason, r.retryAfterMs);
    this.setGuard(tenantId, userId, r.next);
    return { resendAfter: r.resendAfter };
  }
  async saveChallenge(c: ChallengeRecord) {
    this.challenges.set(`${c.tenantId}|${c.id}`, { ...c });
  }
  async getChallenge(tenantId: string, id: string) {
    const c = this.challenges.get(`${tenantId}|${id}`);
    return c ? { ...c } : undefined;
  }
  async attempt(tenantId: string, id: string, s: CustomerIdentitySettings, now: number) {
    const c = this.challenges.get(`${tenantId}|${id}`);
    const next = attemptChecks(c, this.guard(tenantId, c?.userId ?? "", now), s, now);
    this.challenges.set(`${tenantId}|${id}`, next);
    return { ...next };
  }
  async settle(
    tenantId: string,
    id: string,
    ok: boolean,
    s: CustomerIdentitySettings,
    now: number,
  ) {
    const c = this.challenges.get(`${tenantId}|${id}`);
    if (!c) return;
    const g = this.guard(tenantId, c.userId, now);
    if (ok) {
      this.challenges.set(`${tenantId}|${id}`, { ...c, consumedAt: now });
      this.setGuard(tenantId, c.userId, afterSuccess(g));
    } else {
      if (c.attempts >= s.attemptsPerCode)
        this.challenges.set(`${tenantId}|${id}`, { ...c, consumedAt: now });
      this.setGuard(tenantId, c.userId, afterFailure(g, s, now));
    }
  }
  async createDevice(d: DeviceRecord) {
    this.devices.set(d.id, { ...d });
  }
  async deviceByRefresh(tenantId: string, refreshHash: string) {
    for (const d of this.devices.values())
      if (d.tenantId === tenantId && d.refreshHash === refreshHash) return { ...d };
    return undefined;
  }
  async rotateRefresh(tenantId: string, deviceId: string, from: string, to: string, now: number) {
    const d = this.devices.get(deviceId);
    if (!d || d.tenantId !== tenantId || d.refreshHash !== from || d.revokedAt !== undefined)
      return false;
    this.devices.set(deviceId, { ...d, refreshHash: to, lastUsedAt: now });
    return true;
  }
  async activeDevice(tenantId: string, userId: string, jkt: string) {
    for (const d of this.devices.values())
      if (
        d.tenantId === tenantId &&
        d.userId === userId &&
        d.jkt === jkt &&
        d.revokedAt === undefined
      )
        return { ...d };
    return undefined;
  }
  async listDevices(tenantId: string, userId: string) {
    return [...this.devices.values()]
      .filter((d) => d.tenantId === tenantId && d.userId === userId)
      .map((d) => ({ ...d }));
  }
  async revokeDevice(
    tenantId: string,
    deviceId: string,
    reason: DeviceRevocationReason,
    now: number,
  ) {
    const d = this.devices.get(deviceId);
    if (!d || d.tenantId !== tenantId) return undefined;
    const next = d.revokedAt === undefined ? { ...d, revokedAt: now, revokedReason: reason } : d;
    this.devices.set(deviceId, next);
    return { ...next };
  }
  async deleteDevice(tenantId: string, deviceId: string) {
    const d = this.devices.get(deviceId);
    if (!d || d.tenantId !== tenantId || d.revokedAt === undefined) return false;
    return this.devices.delete(deviceId);
  }
  async purge(tenantId: string, c: CustomerRetentionCutoffs, limit: number) {
    const take = <V>(m: Map<string, V>, due: (k: string, v: V) => boolean): number => {
      let n = 0;
      for (const [k, v] of m)
        if (n < limit && due(k, v)) {
          m.delete(k);
          n++;
        }
      return n;
    };
    return {
      challenges: take(
        this.challenges,
        (_k, x) => x.tenantId === tenantId && x.expiresAt < c.challengesExpiredBefore,
      ),
      guards: take(this.guards, (k, g) => k.startsWith(`${tenantId}|`) && guardEnded(g, c)),
      devices: take(
        this.devices,
        (_k, d) => d.tenantId === tenantId && d.lastUsedAt < c.devicesUnusedSince,
      ),
    };
  }
}

export interface PgCustomerAuthStoreOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  /** Service context for a tenant (every read and write runs under that tenant's RLS). */
  context(tenantId: string): KernelContext;
  /** Active-device cache; at most 15 s so a revoked device is refused within 60 s (default 15 s). */
  deviceCacheMs?: number;
  now?: () => number;
}

interface GuardRow {
  window_start: Date;
  sends: number;
  last_send_at: Date | null;
  failures: number;
  last_failure_at: Date | null;
  locked_until: Date | null;
}
interface ChallengeRow {
  id: string;
  tenant_id: string;
  user_id: string;
  channel: CustomerOtpChannel;
  jkt: string;
  idp_ref: Record<string, string>;
  attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
}
interface DeviceRow {
  id: string;
  tenant_id: string;
  user_id: string;
  jkt: string;
  idp_session: string;
  refresh_hash: string;
  label: string | null;
  created_at: Date;
  last_used_at: Date;
  revoked_at: Date | null;
  revoked_reason: DeviceRevocationReason | null;
}

const ms = (d: Date | null | undefined) => (d ? new Date(d).getTime() : undefined);
const iso = (n: number | undefined) => (n === undefined ? null : new Date(n).toISOString());
const toGuard = (r: GuardRow | undefined, now: number): GuardState =>
  r
    ? {
        windowStart: ms(r.window_start)!,
        sends: r.sends,
        failures: r.failures,
        ...(r.last_send_at ? { lastSendAt: ms(r.last_send_at)! } : {}),
        ...(r.last_failure_at ? { lastFailureAt: ms(r.last_failure_at)! } : {}),
        ...(r.locked_until ? { lockedUntil: ms(r.locked_until)! } : {}),
      }
    : freshGuard(now);
const toChallenge = (r: ChallengeRow): ChallengeRecord => ({
  id: r.id,
  tenantId: r.tenant_id,
  userId: r.user_id,
  channel: r.channel,
  jkt: r.jkt,
  idpRef: r.idp_ref,
  attempts: r.attempts,
  expiresAt: ms(r.expires_at)!,
  ...(r.consumed_at ? { consumedAt: ms(r.consumed_at)! } : {}),
});
const toDevice = (r: DeviceRow): DeviceRecord => ({
  id: r.id,
  tenantId: r.tenant_id,
  userId: r.user_id,
  jkt: r.jkt,
  idpSession: r.idp_session,
  refreshHash: r.refresh_hash,
  ...(r.label ? { label: r.label } : {}),
  createdAt: ms(r.created_at)!,
  lastUsedAt: ms(r.last_used_at)!,
  ...(r.revoked_at ? { revokedAt: ms(r.revoked_at)! } : {}),
  ...(r.revoked_reason ? { revokedReason: r.revoked_reason } : {}),
});

type Q = { query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> };

/** PostgreSQL store on the `connectors/0004` tables; every mutation is ledgered (no codes, no logins). */
export class PgCustomerAuthStore implements CustomerAuthStore {
  private readonly cache = new Map<string, { at: number; d: DeviceRecord }>();
  private readonly now: () => number;

  constructor(private readonly o: PgCustomerAuthStoreOptions) {
    if ((o.deviceCacheMs ?? 15_000) > 15_000)
      throw new RangeError("the device cache refreshes at least every 15 s");
    this.now = o.now ?? Date.now;
  }

  private mutate<T>(tenantId: string, action: string, fn: (tx: Q) => Promise<T>): Promise<T> {
    return this.o.kernel.mutate(this.o.context(tenantId), (tx) => fn(tx as unknown as Q), {
      action,
    });
  }

  private async lockGuard(tx: Q, tenantId: string, hash: string, now: number): Promise<GuardState> {
    await tx.query(
      `insert into connectors.customer_otp_guard (tenant_id, account_hash, window_start)
       values ($1, $2, $3) on conflict do nothing`,
      [tenantId, hash, iso(now)],
    );
    const r = await tx.query<GuardRow>(
      `select window_start, sends, last_send_at, failures, last_failure_at, locked_until
         from connectors.customer_otp_guard where tenant_id = $1 and account_hash = $2 for update`,
      [tenantId, hash],
    );
    return toGuard(r.rows[0], now);
  }

  private async writeGuard(tx: Q, tenantId: string, hash: string, g: GuardState): Promise<void> {
    await tx.query(
      `update connectors.customer_otp_guard
          set window_start = $3, sends = $4, last_send_at = $5, failures = $6, last_failure_at = $7,
              locked_until = $8, updated_at = now()
        where tenant_id = $1 and account_hash = $2`,
      [
        tenantId,
        hash,
        iso(g.windowStart),
        g.sends,
        iso(g.lastSendAt),
        g.failures,
        iso(g.lastFailureAt),
        iso(g.lockedUntil),
      ],
    );
  }

  async reserveSend(tenantId: string, userId: string, s: CustomerIdentitySettings, now: number) {
    const hash = accountHash(userId);
    const r = await this.mutate(tenantId, "identity.customer.otp.reserve", async (tx) => {
      const out = admitSend(await this.lockGuard(tx, tenantId, hash, now), s, now);
      if (out.ok) await this.writeGuard(tx, tenantId, hash, out.next);
      await this.o.audit.record(tx as never, {
        action: "identity.customer.otp.reserve",
        resourceType: "identity.customer_account",
        resourceId: hash,
        after: out.ok ? { admitted: true } : { admitted: false, reason: out.reason },
      });
      return out;
    });
    if (!r.ok) throw limited(r.reason, r.retryAfterMs);
    return { resendAfter: r.resendAfter };
  }

  async saveChallenge(c: ChallengeRecord) {
    await this.mutate(c.tenantId, "identity.customer.challenge.create", async (tx) => {
      await tx.query(
        `insert into connectors.customer_otp_challenge (id, tenant_id, user_id, channel, jkt, idp_ref, attempts, expires_at)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
        [
          c.id,
          c.tenantId,
          c.userId,
          c.channel,
          c.jkt,
          JSON.stringify(c.idpRef),
          c.attempts,
          iso(c.expiresAt),
        ],
      );
      await this.o.audit.record(tx as never, {
        action: "identity.customer.challenge.create",
        resourceType: "identity.customer_challenge",
        resourceId: c.id,
        after: { channel: c.channel, account: accountHash(c.userId) },
      });
    });
  }

  async getChallenge(tenantId: string, id: string) {
    const r = await this.o.kernel.read(this.o.context(tenantId), (tx) =>
      (tx as unknown as Q).query<ChallengeRow>(
        "select * from connectors.customer_otp_challenge where id = $1",
        [id],
      ),
    );
    return r.rows[0] ? toChallenge(r.rows[0]) : undefined;
  }

  async attempt(tenantId: string, id: string, s: CustomerIdentitySettings, now: number) {
    // The refusals are decided inside the transaction and thrown after it, so the ledger keeps them.
    const out = await this.mutate(tenantId, "identity.customer.challenge.attempt", async (tx) => {
      const row = (
        await tx.query<ChallengeRow>(
          "select * from connectors.customer_otp_challenge where id = $1 for update",
          [id],
        )
      ).rows[0];
      const c = row ? toChallenge(row) : undefined;
      const g = c
        ? await this.lockGuard(tx, tenantId, accountHash(c.userId), now)
        : freshGuard(now);
      let result: { ok: true; c: ChallengeRecord } | { ok: false; e: unknown };
      try {
        result = { ok: true, c: attemptChecks(c, g, s, now) };
      } catch (e) {
        result = { ok: false, e };
      }
      if (result.ok)
        await tx.query("update connectors.customer_otp_challenge set attempts = $2 where id = $1", [
          id,
          result.c.attempts,
        ]);
      await this.o.audit.record(tx as never, {
        action: "identity.customer.challenge.attempt",
        resourceType: "identity.customer_challenge",
        resourceId: id,
        after: result.ok
          ? { attempts: result.c.attempts }
          : { refused: (result.e as IpbError).code, reason: (result.e as IpbError).meta?.reason },
      });
      return result;
    });
    if (!out.ok) throw out.e;
    return out.c;
  }

  async settle(
    tenantId: string,
    id: string,
    ok: boolean,
    s: CustomerIdentitySettings,
    now: number,
  ) {
    await this.mutate(
      tenantId,
      `identity.customer.challenge.${ok ? "verified" : "failed"}`,
      async (tx) => {
        const row = (
          await tx.query<ChallengeRow>(
            "select * from connectors.customer_otp_challenge where id = $1 for update",
            [id],
          )
        ).rows[0];
        if (!row) return;
        const hash = accountHash(row.user_id);
        const g = await this.lockGuard(tx, tenantId, hash, now);
        const next = ok ? afterSuccess(g) : afterFailure(g, s, now);
        await this.writeGuard(tx, tenantId, hash, next);
        if (ok || row.attempts >= s.attemptsPerCode)
          await tx.query(
            "update connectors.customer_otp_challenge set consumed_at = $2 where id = $1 and consumed_at is null",
            [id, iso(now)],
          );
        await this.o.audit.record(tx as never, {
          action: `identity.customer.challenge.${ok ? "verified" : "failed"}`,
          resourceType: "identity.customer_challenge",
          resourceId: id,
          after: ok
            ? { verified: true }
            : {
                failures: next.failures,
                locked: next.lockedUntil !== undefined && next.lockedUntil > now,
              },
        });
      },
    );
  }

  async createDevice(d: DeviceRecord) {
    await this.mutate(d.tenantId, "identity.customer.device.create", async (tx) => {
      await tx.query(
        `insert into connectors.customer_device (id, tenant_id, user_id, jkt, idp_session, refresh_hash, label, created_at, last_used_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [
          d.id,
          d.tenantId,
          d.userId,
          d.jkt,
          d.idpSession,
          d.refreshHash,
          d.label ?? null,
          iso(d.createdAt),
        ],
      );
      await this.o.audit.record(tx as never, {
        action: "identity.customer.device.create",
        resourceType: "identity.customer_device",
        resourceId: d.id,
        after: { jkt: d.jkt, account: accountHash(d.userId) },
      });
    });
  }

  async deviceByRefresh(tenantId: string, refreshHash: string) {
    const r = await this.o.kernel.read(this.o.context(tenantId), (tx) =>
      (tx as unknown as Q).query<DeviceRow>(
        "select * from connectors.customer_device where refresh_hash = $1",
        [refreshHash],
      ),
    );
    return r.rows[0] ? toDevice(r.rows[0]) : undefined;
  }

  async rotateRefresh(tenantId: string, deviceId: string, from: string, to: string, now: number) {
    return this.mutate(tenantId, "identity.customer.device.refresh", async (tx) => {
      const r = await tx.query<{ id: string }>(
        `update connectors.customer_device set refresh_hash = $3, last_used_at = $4
          where id = $1 and refresh_hash = $2 and revoked_at is null returning id`,
        [deviceId, from, to, iso(now)],
      );
      await this.o.audit.record(tx as never, {
        action: "identity.customer.device.refresh",
        resourceType: "identity.customer_device",
        resourceId: deviceId,
        after: { rotated: r.rows.length === 1 },
      });
      return r.rows.length === 1;
    });
  }

  async activeDevice(tenantId: string, userId: string, jkt: string) {
    const k = `${tenantId}|${userId}|${jkt}`;
    const c = this.cache.get(k);
    if (c && this.now() - c.at < (this.o.deviceCacheMs ?? 15_000)) return { ...c.d };
    const r = await this.o.kernel.read(this.o.context(tenantId), (tx) =>
      (tx as unknown as Q).query<DeviceRow>(
        `select * from connectors.customer_device
          where user_id = $1 and jkt = $2 and revoked_at is null order by created_at desc limit 1`,
        [userId, jkt],
      ),
    );
    const d = r.rows[0] ? toDevice(r.rows[0]) : undefined;
    if (d) this.cache.set(k, { at: this.now(), d });
    else this.cache.delete(k);
    return d;
  }

  async listDevices(tenantId: string, userId: string) {
    const r = await this.o.kernel.read(this.o.context(tenantId), (tx) =>
      (tx as unknown as Q).query<DeviceRow>(
        "select * from connectors.customer_device where user_id = $1 order by created_at",
        [userId],
      ),
    );
    return r.rows.map(toDevice);
  }

  async revokeDevice(
    tenantId: string,
    deviceId: string,
    reason: DeviceRevocationReason,
    now: number,
  ) {
    const d = await this.mutate(tenantId, "identity.customer.device.revoke", async (tx) => {
      const r = await tx.query<DeviceRow>(
        `update connectors.customer_device set revoked_at = coalesce(revoked_at, $2),
                revoked_reason = coalesce(revoked_reason, $3)
          where id = $1 returning *`,
        [deviceId, iso(now), reason],
      );
      await this.o.audit.record(tx as never, {
        action: "identity.customer.device.revoke",
        resourceType: "identity.customer_device",
        resourceId: deviceId,
        after: { reason, found: r.rows.length === 1 },
      });
      return r.rows[0] ? toDevice(r.rows[0]) : undefined;
    });
    if (d) this.cache.delete(`${tenantId}|${d.userId}|${d.jkt}`);
    return d;
  }

  async deleteDevice(tenantId: string, deviceId: string, reason: DeviceDeletionReason) {
    const gone = await this.mutate(tenantId, "identity.customer.device.delete", async (tx) => {
      // Only a revoked device (connectors/0005's policy refuses any other before 30 days unused).
      const r = await tx.query<{ user_id: string; jkt: string }>(
        `delete from connectors.customer_device where id = $1 and revoked_at is not null
         returning user_id, jkt`,
        [deviceId],
      );
      await this.o.audit.record(tx as never, {
        action: "identity.customer.device.delete",
        resourceType: "identity.customer_device",
        resourceId: deviceId,
        after: { reason, found: r.rows.length === 1 },
      });
      return r.rows[0];
    });
    if (gone) this.cache.delete(`${tenantId}|${gone.user_id}|${gone.jkt}`);
    return gone !== undefined;
  }

  async purge(tenantId: string, c: CustomerRetentionCutoffs, limit: number) {
    try {
      return await this.mutate(tenantId, "identity.customer.purge", async (tx) => {
        const challenges = await tx.query<{ id: string }>(
          `delete from connectors.customer_otp_challenge where id in (
             select id from connectors.customer_otp_challenge where expires_at < $1
              order by expires_at, id limit $2)
           returning id`,
          [iso(c.challengesExpiredBefore), limit],
        );
        const guards = await tx.query<{ id: string }>(
          `delete from connectors.customer_otp_guard where account_hash in (
             select account_hash from connectors.customer_otp_guard
              where (locked_until is null or locked_until < $1)
                and window_start + make_interval(secs => $2) < $1
                and (last_failure_at is null or last_failure_at + make_interval(secs => $3) < $1)
              order by window_start, account_hash limit $4)
           returning account_hash as id`,
          [iso(c.guardsEndedBefore), c.sendWindowMs / 1000, c.lockoutMs / 1000, limit],
        );
        const devices = await tx.query<{ id: string; user_id: string; jkt: string }>(
          `delete from connectors.customer_device where id in (
             select id from connectors.customer_device where last_used_at < $1
              order by last_used_at, id limit $2)
           returning id, user_id, jkt`,
          [iso(c.devicesUnusedSince), limit],
        );
        const all = [
          ...challenges.rows.map((x) => ["identity.customer_otp_challenge", x.id] as const),
          ...guards.rows.map((x) => ["identity.customer_otp_guard", x.id] as const),
          ...devices.rows.map((x) => ["identity.customer_device", x.id] as const),
        ];
        // Nothing due: roll back and ledger nothing.
        if (!all.length) throw NOTHING_DUE;
        for (const [resourceType, resourceId] of all)
          await this.o.audit.record(tx as never, {
            action: "identity.customer.purge",
            resourceType,
            resourceId,
            after: { reason: "retention" },
          });
        for (const d of devices.rows) this.cache.delete(`${tenantId}|${d.user_id}|${d.jkt}`);
        return {
          challenges: challenges.rows.length,
          guards: guards.rows.length,
          devices: devices.rows.length,
        };
      });
    } catch (e) {
      if (e === NOTHING_DUE) return { challenges: 0, guards: 0, devices: 0 };
      throw e;
    }
  }
}

// ---- replay store shared by replicas ------------------------------------------------------------

/** The slice of an ioredis client the replay store uses (`SET key value PX ms NX`). */
export interface RedisSetNx {
  set(key: string, value: string, px: "PX", ttlMs: number, nx: "NX"): Promise<"OK" | null>;
}

/** DPoP `jti`s claimed in Redis, so a proof replayed to another replica is refused too. */
export class RedisReplayStore implements ReplayStore {
  constructor(
    private readonly redis: RedisSetNx,
    private readonly prefix = "ipb:dpop:",
    private readonly now: () => number = Date.now,
  ) {}
  async claim(jti: string, expiresAt: Date): Promise<boolean> {
    const ttl = Math.max(1000, expiresAt.getTime() - this.now());
    return (await this.redis.set(`${this.prefix}${sha256Hex(jti)}`, "1", "PX", ttl, "NX")) === "OK";
  }
}

// ---- the IdP-neutral flow -----------------------------------------------------------------------

/** What an IdP returns for a verified code or a refresh. */
export interface IdpTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  /** The IdP's session for this sign-in, when the token does not name it (`sid`). */
  session?: string;
}

export interface CustomerIdentityBaseOptions {
  settings?: Partial<CustomerIdentitySettings>;
  store: CustomerAuthStore;
  sender: CustomerOtpSender;
  /** Shared by the API's replicas (`RedisReplayStore`); `MemoryReplayStore` on one process only. */
  replay: ReplayStore;
  revocations: RevocationStore;
  /** Roles a new customer account receives: product roles only (e.g. `UDF_BORROWER`). */
  customerRoles?: readonly string[];
  now?: () => number;
}

const DPOP_SCHEME = /^DPoP\s+([A-Za-z0-9._~+/-]+=*)$/i;

export abstract class CustomerIdentityBase implements CustomerIdentityPort {
  abstract readonly descriptor: AdapterDescriptor;
  abstract readonly signInProofTarget: DpopTarget;
  abstract health(): Promise<PortHealth>;
  protected readonly s: CustomerIdentitySettings;
  /** True when the IdP itself binds access tokens to the proof key (`cnf.jkt`). */
  protected abstract readonly nativeBinding: boolean;
  protected abstract readonly verifier: TokenVerifier;

  constructor(protected readonly base: CustomerIdentityBaseOptions) {
    this.s = customerIdentitySettings(base.settings);
    for (const r of base.customerRoles ?? [])
      if (isPlatformRole(r) || isTenantRole(r) || !/^[A-Z]{2,4}_[A-Z][A-Z0-9_]*$/.test(r))
        throw new RangeError(`customer accounts get product roles only, not ${r}`);
  }

  protected get now(): number {
    return this.base.now?.() ?? Date.now();
  }

  /** Find or create the account; returns the IdP user id. */
  protected abstract resolveUser(
    tenantId: string,
    channel: CustomerOtpChannel,
    login: string,
  ): Promise<string>;
  /** Have the IdP issue a code for the user; returns its handle and the code (to deliver, once). */
  protected abstract idpSend(
    a: { tenantId: string; userId: string; login: string; channel: CustomerOtpChannel },
    dpopProof: string,
  ): Promise<{ ref: Record<string, string>; code: string }>;
  /** Have the IdP check the code; `null` when it refused the code. */
  protected abstract idpVerify(
    c: ChallengeRecord,
    code: string,
    dpopProof: string,
  ): Promise<IdpTokens | null>;
  /** Refresh at the IdP; `null` when it refused the refresh token. */
  protected abstract idpRefresh(refreshToken: string, dpopProof: string): Promise<IdpTokens | null>;
  /** End the IdP session of a device (best effort; the platform refusal does not depend on it). */
  protected abstract idpEndSession(userId: string, session: string): Promise<void>;

  private async proof(
    proof: string,
    o: { method: string; url: string; accessToken?: string; jkt?: string },
  ): Promise<string> {
    const r = await verifyDpopProof(proof, {
      ...o,
      replay: this.base.replay,
      now: new Date(this.now),
      maxAgeSeconds: this.s.dpopMaxAgeSeconds,
      maxSkewSeconds: this.s.dpopMaxSkewSeconds,
    });
    if (!r.ok) throw customerRefused(`dpop_${r.reason}`, "the DPoP proof was refused");
    return r.jkt;
  }

  private signInProof(proof: string, jkt?: string): Promise<string> {
    return this.proof(proof, {
      method: this.signInProofTarget.htm,
      url: this.signInProofTarget.htu,
      ...(jkt ? { jkt } : {}),
    });
  }

  /** Verify an IdP token as a customer token: the IdP's signature and claims, product roles only. */
  private async customerToken(
    accessToken: string,
  ): Promise<{ claims: VerifiedClaims; raw: Record<string, unknown> }> {
    const v = await this.verifier.verifyWithRaw(accessToken);
    if (v.claims.roles.some((r) => isPlatformRole(r) || isTenantRole(r)))
      throw customerRefused("claims", "a customer token carries staff roles");
    if (v.claims.typ !== "user") throw customerRefused("claims", "not a customer principal");
    // A one-time code is a single factor (IPB-02-02): a customer session never counts as MFA.
    return { claims: { ...v.claims, mfa: false }, raw: v.raw };
  }

  private boundJkt(raw: Record<string, unknown>): string | undefined {
    const cnf = raw.cnf as { jkt?: unknown } | undefined;
    return cnf && typeof cnf.jkt === "string" ? cnf.jkt : undefined;
  }

  async startChallenge(req: {
    tenantId: string;
    channel: CustomerOtpChannel;
    login: string;
    dpopProof: string;
    locale?: string;
  }): Promise<CustomerChallenge> {
    let login: string;
    try {
      login = customerLogin(req.channel, req.login);
    } catch {
      throw customerRefused(
        "login",
        req.channel === "email" ? "an email address is needed" : "an E.164 mobile number is needed",
      );
    }
    const jkt = await this.signInProof(req.dpopProof);
    const userId = await this.resolveUser(req.tenantId, req.channel, login);
    const { resendAfter } = await this.base.store.reserveSend(
      req.tenantId,
      userId,
      this.s,
      this.now,
    );
    const { ref, code } = await this.idpSend(
      { tenantId: req.tenantId, userId, login, channel: req.channel },
      req.dpopProof,
    );
    const id = toBase64Url(randomBytes(16));
    const expiresAt = this.now + this.s.codeTtlSeconds * 1000;
    await this.base.store.saveChallenge({
      id,
      tenantId: req.tenantId,
      userId,
      channel: req.channel,
      jkt,
      idpRef: ref,
      attempts: 0,
      expiresAt,
    });
    await this.base.sender.send({
      tenantId: req.tenantId,
      userId,
      channel: req.channel,
      to: login,
      code,
      expiresAt: new Date(expiresAt),
      ...(req.locale ? { locale: req.locale } : {}),
      idempotencyKey: `otp:${id}`,
    });
    return {
      challengeId: id,
      expiresAt: new Date(expiresAt).toISOString(),
      resendAfter: new Date(resendAfter).toISOString(),
    };
  }

  async verifyChallenge(req: {
    tenantId: string;
    challengeId: string;
    code: string;
    dpopProof: string;
    deviceLabel?: string;
  }): Promise<CustomerSession> {
    const pending = await this.base.store.getChallenge(req.tenantId, req.challengeId);
    if (!pending || pending.consumedAt !== undefined || pending.expiresAt <= this.now)
      throw customerRefused(
        "challenge",
        "the sign-in code has expired or was used; ask for a new one",
      );
    // The key that asked for the code is the only one that may use it.
    const jkt = await this.signInProof(req.dpopProof, pending.jkt);
    const c = await this.base.store.attempt(req.tenantId, req.challengeId, this.s, this.now);
    const tokens = /^[0-9]{6}$/.test(req.code)
      ? await this.idpVerify(c, req.code, req.dpopProof)
      : null;
    await this.base.store.settle(req.tenantId, c.id, tokens !== null, this.s, this.now);
    if (!tokens) throw customerRefused("code", "the sign-in code is wrong");
    const { claims, raw } = await this.customerToken(tokens.accessToken);
    if (claims.sub !== c.userId || claims.tid !== req.tenantId)
      throw customerRefused("claims", "the token names another account");
    if (this.nativeBinding && this.boundJkt(raw) !== jkt)
      throw customerRefused("dpop_jkt", "the token is not bound to the device key");
    const session = tokens.session ?? claims.sid;
    if (!session) throw customerRefused("claims", "the IdP named no session");
    const device: DeviceRecord = {
      id: newId("dev"),
      tenantId: req.tenantId,
      userId: c.userId,
      jkt,
      idpSession: session,
      refreshHash: sha256Hex(tokens.refreshToken),
      ...(req.deviceLabel ? { label: req.deviceLabel.slice(0, 80) } : {}),
      createdAt: this.now,
      lastUsedAt: this.now,
    };
    await this.base.store.createDevice(device);
    return this.session(tokens, device);
  }

  async refreshSession(req: {
    tenantId: string;
    refreshToken: string;
    dpopProof: string;
  }): Promise<CustomerSession> {
    const jkt = await this.signInProof(req.dpopProof);
    const from = sha256Hex(req.refreshToken);
    const device = await this.base.store.deviceByRefresh(req.tenantId, from);
    if (!device || device.revokedAt !== undefined)
      throw customerRefused("refresh", "the refresh token is not current");
    if (device.jkt !== jkt) {
      // A current refresh token with another key: the token has left its device.
      await this.revoke(device, "key_mismatch");
      throw customerRefused("dpop_jkt", "the proof is not by the device key");
    }
    const tokens = await this.idpRefresh(req.refreshToken, req.dpopProof);
    if (!tokens) throw customerRefused("refresh", "the identity provider refused the refresh");
    const { claims, raw } = await this.customerToken(tokens.accessToken);
    if (claims.sub !== device.userId || claims.tid !== req.tenantId)
      throw customerRefused("claims", "the token names another account");
    if (this.nativeBinding && this.boundJkt(raw) !== jkt)
      throw customerRefused("dpop_jkt", "the token is not bound to the device key");
    const to = sha256Hex(tokens.refreshToken);
    if (!(await this.base.store.rotateRefresh(req.tenantId, device.id, from, to, this.now)))
      throw customerRefused("refresh", "the refresh token is not current");
    return this.session(tokens, { ...device, refreshHash: to, lastUsedAt: this.now });
  }

  async verifyRequest(req: {
    authorization: string;
    dpopProof: string;
    method: string;
    url: string;
  }): Promise<VerifiedCustomerClaims> {
    const m = DPOP_SCHEME.exec(req.authorization ?? "");
    if (!m) throw customerRefused("scheme", "a customer request carries Authorization: DPoP");
    const token = m[1]!;
    const { claims, raw } = await this.customerToken(token);
    const bound = this.boundJkt(raw);
    if (this.nativeBinding && !bound)
      throw customerRefused("dpop_jkt", "the token is not DPoP-bound");
    const jkt = await this.proof(req.dpopProof, {
      method: req.method,
      url: req.url,
      accessToken: token,
      ...(bound ? { jkt: bound } : {}),
    });
    const device = await this.base.store.activeDevice(claims.tid, claims.sub, jkt);
    if (!device) throw customerRefused("device", "the device is signed out");
    return { ...claims, jkt, deviceId: device.id };
  }

  async listDevices(tenantId: string, userId: string): Promise<CustomerDevice[]> {
    return (await this.base.store.listDevices(tenantId, userId)).map((d) => this.publicDevice(d));
  }

  async revokeDevice(tenantId: string, userId: string, deviceId: string): Promise<void> {
    const d = (await this.base.store.listDevices(tenantId, userId)).find((x) => x.id === deviceId);
    if (!d)
      throw new PortError("IPB-PORT-001", "IDENTITY", {
        adapter: this.descriptor.adapter,
        detail: "no such device for this customer",
        meta: { reason: "not_found", definite: true },
      });
    await this.revoke(d, "sign_out");
    // Unbinding forgets the device at once (owner answer #86, R1-D-23).
    await this.base.store.deleteDevice(d.tenantId, d.id, "unbound");
  }

  async forgetDevices(tenantId: string, userId: string): Promise<void> {
    for (const d of await this.base.store.listDevices(tenantId, userId)) {
      if (d.revokedAt === undefined) await this.revoke(d, "revoked");
      await this.base.store.deleteDevice(tenantId, d.id, "account_closed");
    }
  }

  private async revoke(d: DeviceRecord, reason: DeviceRevocationReason): Promise<void> {
    await this.base.store.revokeDevice(d.tenantId, d.id, reason, this.now);
    // Tokens naming the session are refused by the verifier as well (IPB-02-05).
    await this.base.revocations.revoke(
      d.tenantId,
      "session",
      d.idpSession,
      new Date(this.now),
      reason === "key_mismatch" ? "security" : "logout",
    );
    await this.idpEndSession(d.userId, d.idpSession).catch(() => undefined);
  }

  private publicDevice(d: DeviceRecord): CustomerDevice {
    return {
      id: d.id,
      jkt: d.jkt,
      ...(d.label ? { label: d.label } : {}),
      createdAt: new Date(d.createdAt).toISOString(),
      lastUsedAt: new Date(d.lastUsedAt).toISOString(),
      ...(d.revokedAt !== undefined ? { revokedAt: new Date(d.revokedAt).toISOString() } : {}),
    };
  }

  private session(t: IdpTokens, d: DeviceRecord): CustomerSession {
    return {
      tokenType: "DPoP",
      accessToken: t.accessToken,
      refreshToken: t.refreshToken,
      expiresIn: t.expiresIn,
      device: this.publicDevice(d),
    };
  }
}
