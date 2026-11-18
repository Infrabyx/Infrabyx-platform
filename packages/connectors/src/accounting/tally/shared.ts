// Shared pieces of the TallyPrime adapter (PR-FBX-46, R1-D-137, R1-D-178).
import { PortError } from "@infrabyx/contracts/errors";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import { isAgentRole } from "@infrabyx/contracts/roles";

export const PORT = "ACCOUNTING";
export const ADAPTER = "tallyprime";

export type Q = {
  query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
};
export const q = (tx: unknown): Q => tx as Q;

export const refused = (
  code: "IPB-SEC-003" | "IPB-SEC-004" | "IPB-PORT-001",
  detail: string,
  reason: string,
) => new PortError(code, PORT, { adapter: ADAPTER, detail, meta: { reason } });

/**
 * Enrolling, issuing codes and posting are people's (or the product service's) acts in their own
 * tenant: an agent principal, an external principal and a platform context are `IPB-SEC-004`,
 * impersonation `IPB-SEC-003`. Break-glass is refused unless `allowBreakGlass` (revocation only).
 */
export function assertTenantCaller(
  ctx: KernelContext,
  what: string,
  o: { allowBreakGlass?: boolean; allowService?: boolean } = {},
): void {
  const p = ctx.principal;
  if (ctx.act) throw refused("IPB-SEC-003", `not during impersonation: ${what}`, "impersonation");
  const breakGlass = p.type === "breakglass" || ctx.breakGlassGrantId !== undefined;
  const reason =
    p.type === "agent" || p.roles.some(isAgentRole)
      ? "agent"
      : p.type === "external"
        ? "external"
        : breakGlass && !o.allowBreakGlass
          ? "break_glass"
          : ctx.scope === "platform"
            ? "platform"
            : p.type === "service" && !o.allowService
              ? "service"
              : null;
  if (reason) throw refused("IPB-SEC-004", `this caller may not ${what}`, reason);
}

export const iso = (d: Date | string | null): string | null =>
  d === null ? null : new Date(d).toISOString();
