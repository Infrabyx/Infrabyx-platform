// Retention of customer sign-in state (owner answer #86, R1-D-22, R1-D-23). A scheduled job runs
// per tenant through `TenantSweep` and deletes, each deletion ledgered in the same transaction:
// a challenge 24 hours after it expired, a guard row once its lockout window has ended, and a device
// 12 months after its last use. Each period is a setting. A device the customer unbinds, or every
// device of a closed account, is deleted at once by the IDENTITY adapter, not by this job. Sign-in
// events stay in the audit ledger and telemetry under their own rules. PostgreSQL enforces floors
// below the settings (migration `connectors/0005`).
import type { TenantRunResult, TenantSweep } from "@infrabyx/tenancy";
import {
  readCustomerIdentitySettings,
  type CustomerAuthStore,
  type CustomerPurgeCounts,
} from "./customer.js";

export interface CustomerRetentionSettings {
  /** Hours after its expiry that a challenge is deleted. */
  challengeHours: number;
  /** Seconds after its lockout window ends that a guard row is deleted. */
  guardGraceSeconds: number;
  /** Days after its last use that a device is deleted. */
  deviceUnusedDays: number;
}

export const CUSTOMER_RETENTION_SETTINGS: Readonly<
  Record<
    keyof CustomerRetentionSettings,
    { key: string; default: number; min: number; max: number }
  >
> = Object.freeze({
  challengeHours: {
    key: "int.identity.customer.retention.challenge_hours",
    default: 24,
    min: 1,
    max: 720,
  },
  guardGraceSeconds: {
    key: "int.identity.customer.retention.guard_grace_seconds",
    default: 0,
    min: 0,
    max: 86400,
  },
  deviceUnusedDays: {
    key: "int.identity.customer.retention.device_unused_days",
    default: 365,
    min: 30,
    max: 730,
  },
});

/** Complete and check retention settings; a value outside its bounds is a RangeError. */
export function customerRetentionSettings(
  over: Partial<CustomerRetentionSettings> = {},
): CustomerRetentionSettings {
  const s = {
    ...(Object.fromEntries(
      Object.entries(CUSTOMER_RETENTION_SETTINGS).map(([k, v]) => [k, v.default]),
    ) as unknown as CustomerRetentionSettings),
    ...over,
  };
  for (const [k, b] of Object.entries(CUSTOMER_RETENTION_SETTINGS)) {
    const v = s[k as keyof CustomerRetentionSettings];
    if (!Number.isInteger(v) || v < b.min || v > b.max)
      throw new RangeError(`${b.key} must be an integer from ${b.min} to ${b.max}`);
  }
  return s;
}

/** Read the retention settings through a settings getter (platform tier). */
export async function readCustomerRetentionSettings(
  get: (key: string) => Promise<unknown>,
): Promise<CustomerRetentionSettings> {
  const out: Partial<CustomerRetentionSettings> = {};
  for (const [k, b] of Object.entries(CUSTOMER_RETENTION_SETTINGS)) {
    const v = await get(b.key);
    if (typeof v === "number") out[k as keyof CustomerRetentionSettings] = v;
  }
  return customerRetentionSettings(out);
}

export interface CustomerSignInRetentionOptions {
  store: CustomerAuthStore;
  /** Reads `int.identity.customer.*` (platform tier); the defaults apply to keys it lacks. */
  settings?: (key: string) => Promise<unknown>;
  /** Rows per table per transaction (default 500, at most 1000). */
  batch?: number;
  now?: () => number;
}

const HOUR = 3_600_000;

export class CustomerSignInRetention {
  private readonly batch: number;
  private readonly now: () => number;
  constructor(private readonly o: CustomerSignInRetentionOptions) {
    this.batch = Math.min(o.batch ?? 500, 1000);
    if (this.batch < 1) throw new RangeError("the batch holds at least one row");
    this.now = o.now ?? Date.now;
  }

  /** Delete what is due for one tenant, batch after batch, and say how much went. */
  async purgeTenant(tenantId: string): Promise<CustomerPurgeCounts> {
    const get = this.o.settings ?? (async () => undefined);
    const r = await readCustomerRetentionSettings(get);
    const s = await readCustomerIdentitySettings(get);
    const now = this.now();
    const cutoffs = {
      challengesExpiredBefore: now - r.challengeHours * HOUR,
      devicesUnusedSince: now - r.deviceUnusedDays * 24 * HOUR,
      guardsEndedBefore: now - r.guardGraceSeconds * 1000,
      sendWindowMs: s.sendWindowSeconds * 1000,
      lockoutMs: s.lockoutSeconds * 1000,
    };
    const total: CustomerPurgeCounts = { challenges: 0, guards: 0, devices: 0 };
    for (;;) {
      const n = await this.o.store.purge(tenantId, cutoffs, this.batch);
      total.challenges += n.challenges;
      total.guards += n.guards;
      total.devices += n.devices;
      if (Math.max(n.challenges, n.guards, n.devices) < this.batch) return total;
    }
  }

  /** The scheduled job (daily, one worker): every tenant in turn, failures reported per tenant. */
  sweep(sweep: Pick<TenantSweep, "run">): Promise<TenantRunResult<CustomerPurgeCounts>[]> {
    return sweep.run((ctx) => this.purgeTenant(ctx.tenantId));
  }
}
