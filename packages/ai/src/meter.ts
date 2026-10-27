// Cost metering and caps (IPB-03-45, 03-46; PL4 plan §4.8). Cost comes from the registry price
// (per million tokens, in the currency's major unit); a model without a price records a null cost
// and the caps fall back to token caps (PL4-D-01 A-07). Usage is summed from `ai.run`, so the
// metering total always equals the sum of runs. Days and months are UTC.
import { IpbError } from "@infrabyx/contracts/errors";
import type { KernelContext, Tx } from "@infrabyx/contracts/kernel";
import type { LlmUsage } from "@infrabyx/contracts";
import { keySegment, type SettingsReader } from "./kill.js";
import type { ModelRecord } from "./registry.js";

/** Minor units per major unit; every currency the registry accepts uses 2 decimals today. */
const MINOR = 100;

export function costOf(
  m: Pick<ModelRecord, "priceInPerMtok" | "priceOutPerMtok" | "currency">,
  u: LlmUsage,
): { minorUnits: number; currency: string } | null {
  if (m.priceInPerMtok === null || m.priceOutPerMtok === null || !m.currency) return null;
  const major = (u.inputTokens * m.priceInPerMtok + u.outputTokens * m.priceOutPerMtok) / 1_000_000;
  return { minorUnits: Math.round(major * MINOR), currency: m.currency };
}

export interface CapUse {
  scope: string;
  cap: number;
  used: number;
  unit: "minor" | "tokens";
}

const num = async (s: SettingsReader, ctx: KernelContext, key: string): Promise<number | null> => {
  try {
    const v = await s.get(ctx, key);
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
};

/** The caps that apply to a tenant and feature, with what was used so far this day/month. */
export async function capUse(
  tx: Tx,
  settings: SettingsReader,
  ctx: KernelContext,
  featureKey: string,
): Promise<CapUse[]> {
  const f = keySegment(featureKey);
  const [dayMinor, dayTokens, monthMinor, monthTokens] = await Promise.all([
    num(settings, ctx, "ai.cost.tenant_daily_cap"),
    num(settings, ctx, "ai.cost.tenant_daily_token_cap"),
    num(settings, ctx, `ai.cost.feature_monthly_cap.${f}`),
    num(settings, ctx, `ai.cost.feature_monthly_token_cap.${f}`),
  ]);
  const r = await tx.query<{
    day_minor: string;
    day_tokens: string;
    month_minor: string;
    month_tokens: string;
  }>(
    `select
       coalesce(sum(cost_minor_units) filter (where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'), 0) as day_minor,
       coalesce(sum(tokens_in + tokens_out) filter (where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'), 0) as day_tokens,
       coalesce(sum(cost_minor_units) filter (where feature_key = $1), 0) as month_minor,
       coalesce(sum(tokens_in + tokens_out) filter (where feature_key = $1), 0) as month_tokens
     from ai.run
     where created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'`,
    [featureKey],
  );
  const u = r.rows[0] ?? { day_minor: "0", day_tokens: "0", month_minor: "0", month_tokens: "0" };
  const out: CapUse[] = [];
  if (dayMinor !== null)
    out.push({ scope: "tenant_daily", cap: dayMinor, used: Number(u.day_minor), unit: "minor" });
  if (dayTokens !== null)
    out.push({
      scope: "tenant_daily_tokens",
      cap: dayTokens,
      used: Number(u.day_tokens),
      unit: "tokens",
    });
  if (monthMinor !== null)
    out.push({
      scope: `feature_monthly:${f}`,
      cap: monthMinor,
      used: Number(u.month_minor),
      unit: "minor",
    });
  if (monthTokens !== null)
    out.push({
      scope: `feature_monthly_tokens:${f}`,
      cap: monthTokens,
      used: Number(u.month_tokens),
      unit: "tokens",
    });
  return out;
}

/** IPB-AI-022 when any cap is already reached (IPB-03-46). */
export function assertUnderCaps(caps: readonly CapUse[]): void {
  const hit = caps.find((c) => c.used >= c.cap);
  if (hit)
    throw new IpbError("IPB-AI-022", {
      detail: `AI usage cap ${hit.scope} reached`,
      meta: { scope: hit.scope, cap: hit.cap, used: hit.used },
    });
}

/** Caps this run pushed across 80 % or 100 % (one CostCapReached each). */
export function crossings(
  before: readonly CapUse[],
  add: { minor: number | null; tokens: number },
): Array<CapUse & { level: "warning" | "blocked"; after: number }> {
  const out: Array<CapUse & { level: "warning" | "blocked"; after: number }> = [];
  for (const c of before) {
    const delta = c.unit === "tokens" ? add.tokens : (add.minor ?? 0);
    const after = c.used + delta;
    if (c.used < c.cap && after >= c.cap) out.push({ ...c, level: "blocked", after });
    else if (c.used < 0.8 * c.cap && after >= 0.8 * c.cap)
      out.push({ ...c, level: "warning", after });
  }
  return out;
}
