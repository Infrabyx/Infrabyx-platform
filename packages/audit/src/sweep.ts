// The scheduled ledger jobs of IPB-02-51 for every tenant (Udofin platform request PR-UDF-013;
// R1-D-12): the weekly chain verification and the daily anchor. A product's worker schedules them
// and passes a per-tenant runner, `TenantSweep` from @infrabyx/tenancy, which lists the tenants
// as SVC_TENANT_SWEEP (a ledgered read) and runs each job in the tenant's own context under RLS.
// A break raises `LedgerChainBroken` through `AuditService.verify`, as for one tenant.
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { VerifyResult } from "./chain.js";
import type { AnchorFile, AuditService } from "./service.js";

/** The shape of `TenantSweep.run`: one result per tenant, failures included. */
export interface TenantRunner {
  run<T>(
    job: (ctx: KernelContext) => Promise<T>,
  ): Promise<{ tenantId: string; ok: boolean; value?: T; error?: string }[]>;
}

export interface SweepSummary<T> {
  tenants: number;
  /** Tenants whose job failed (`error` is a code, never a message). */
  failed: { tenantId: string; error: string }[];
  results: { tenantId: string; value: T }[];
}

function summarise<T>(
  rows: { tenantId: string; ok: boolean; value?: T; error?: string }[],
): SweepSummary<T> {
  return {
    tenants: rows.length,
    failed: rows
      .filter((r) => !r.ok)
      .map((r) => ({ tenantId: r.tenantId, error: r.error ?? "error" })),
    results: rows.filter((r) => r.ok).map((r) => ({ tenantId: r.tenantId, value: r.value as T })),
  };
}

export class AuditSweep {
  constructor(private readonly o: { service: AuditService; tenants: TenantRunner }) {}

  /** Weekly: verify every tenant's chain; `broken` names the tenants whose chain broke. */
  async verifyAll(): Promise<SweepSummary<VerifyResult> & { broken: string[] }> {
    const s = summarise(await this.o.tenants.run((ctx) => this.o.service.verify(ctx)));
    return { ...s, broken: s.results.filter((r) => !r.value.ok).map((r) => r.tenantId) };
  }

  /** Daily: sign and store every tenant's anchor for `date` (YYYY-MM-DD, UTC). */
  async anchorAll(date: string, now = new Date()): Promise<SweepSummary<AnchorFile>> {
    return summarise(await this.o.tenants.run((ctx) => this.o.service.writeAnchor(ctx, date, now)));
  }
}
