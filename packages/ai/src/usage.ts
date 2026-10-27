// AI usage totals for a period (IPB-03-45, 03-83): the run count, tokens and cost of a tenant's
// runs, or of one principal's, read from `ai.run` inside the `ai` module so that other modules
// (the Vidhi digest) never read the table themselves. Runs hold metadata only.
import type { KernelContext, MutationKernel } from "@infrabyx/contracts/kernel";

export interface UsageSummary {
  runs: number;
  tokens: number;
  /** Cost by currency, in minor units; runs without a price are counted in `unpriced`. */
  cost: Record<string, number>;
  unpriced: number;
  blocked: number;
}

export async function usageSummary(
  kernel: MutationKernel,
  ctx: KernelContext,
  o: { from: Date; to: Date; principalId?: string },
): Promise<UsageSummary> {
  return kernel.read(ctx, async (tx) => {
    const r = await tx.query<{
      currency: string | null;
      runs: string;
      tokens: string;
      cost: string | null;
      unpriced: string;
      blocked: string;
    }>(
      `select currency, count(*) as runs, coalesce(sum(tokens_in + tokens_out), 0) as tokens,
              sum(cost_minor_units) as cost,
              count(*) filter (where cost_minor_units is null) as unpriced,
              count(*) filter (where outcome = 'blocked') as blocked
         from ai.run
        where created_at >= $1 and created_at < $2 and ($3::text is null or principal_id = $3)
        group by currency`,
      [o.from, o.to, o.principalId ?? null],
    );
    const out: UsageSummary = { runs: 0, tokens: 0, cost: {}, unpriced: 0, blocked: 0 };
    for (const row of r.rows) {
      out.runs += Number(row.runs);
      out.tokens += Number(row.tokens);
      out.unpriced += Number(row.unpriced);
      out.blocked += Number(row.blocked);
      if (row.currency && row.cost !== null)
        out.cost[row.currency] = (out.cost[row.currency] ?? 0) + Number(row.cost);
    }
    return out;
  });
}
