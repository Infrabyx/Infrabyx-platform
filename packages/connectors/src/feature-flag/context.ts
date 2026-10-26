// Flag evaluation contexts carry C-21 hashes only (PL2 plan §6.4): a raw tenant or user ID is refused.
import { PortError } from "@infrabyx/contracts/errors";
import type { FlagEvaluationContext } from "@infrabyx/contracts/ports";

const HASHED = /^[0-9a-f]{32}$/;

export function assertHashedContext(adapter: string, ctx?: FlagEvaluationContext): void {
  for (const k of ["tenantKey", "userKey"] as const) {
    const v = ctx?.[k];
    if (v !== undefined && !HASHED.test(v))
      throw new PortError("IPB-PORT-003", "FEATURE_FLAG", {
        adapter,
        detail: `${k} must be a C-21 telemetry hash (32 hex), never a raw identifier`,
      });
  }
}
