// Sandbox tenants at the AI gateways (LawDocsComply PR-LDC-29; R1-plan M60; R1-D-87). The kernel
// reads `tenancy.tenant.sandbox` into `tx.ctx.sandbox` in every transaction; the chat and embedding
// gateways take it from their first read and refuse a call above INTERNAL before any prompt is
// rendered or any provider is chosen. A tenant whose flag the kernel could not read is treated as a
// sandbox (fail closed). PUBLIC and INTERNAL calls proceed.
import type { DataClass } from "@infrabyx/contracts/data-class";
import { IpbError } from "@infrabyx/contracts/errors";
import { CLASS_RANK } from "./registry.js";

/** Guard flag recorded on a run refused in a sandbox tenant. */
export const SANDBOX_REFUSED_FLAG = "sandbox_refused";

/**
 * Refuse data above INTERNAL in a sandbox tenant with IPB-PORT-003 (a data-class violation; call
 * refused), adding the run's flag; the gateway then records the run as refused, with its ledger
 * entry, as for its other refusals. `sandbox` is `isSandboxed(tx.ctx)` from a kernel transaction.
 */
export function assertSandboxAllows(sandbox: boolean, dataClass: DataClass, flags: string[]): void {
  if (!sandbox || CLASS_RANK[dataClass] <= CLASS_RANK.INTERNAL) return;
  flags.push(SANDBOX_REFUSED_FLAG);
  throw new IpbError("IPB-PORT-003", {
    detail: `a sandbox tenant sends no ${dataClass} data to a model; only PUBLIC and INTERNAL`,
    meta: { sandbox: true, data_class: dataClass },
  });
}
