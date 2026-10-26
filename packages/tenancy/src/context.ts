// Request context (IPB-02-13): built only from verified token claims, never from a header,
// query parameter or body. Carried on AsyncLocalStorage for code that has no explicit ctx.
import { AsyncLocalStorage } from "node:async_hooks";
import { IpbError } from "@infrabyx/contracts/errors";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import { VerifiedClaims } from "@infrabyx/contracts/ports";
import { isAgentRole, isPlatformRole } from "@infrabyx/contracts/roles";

export type TenantContext = KernelContext;

const storage = new AsyncLocalStorage<TenantContext>();

export interface ContextExtras {
  traceId?: string;
  ip?: string;
  userAgent?: string;
  /** Request a platform context; honoured only for PLT_* principals (see assertValidContext). */
  scope?: "tenant" | "platform";
}

/** Build the context from claims the IDENTITY adapter has already verified. */
export function contextFromClaims(
  claims: VerifiedClaims,
  extras: ContextExtras = {},
): TenantContext {
  const c = VerifiedClaims.parse(claims);
  const ctx: TenantContext = {
    tenantId: c.tid,
    principal: {
      id: c.sub,
      type: c.typ,
      roles: c.roles,
      ...(c.product_scope ? { productScope: c.product_scope } : {}),
    },
    ...(c.ent ? { entityId: c.ent } : {}),
    ...(c.act ? { act: { sub: c.act.sub, sessionId: c.act.sid } } : {}),
    ...(c.bg ? { breakGlassGrantId: c.bg } : {}),
    ...(extras.scope ? { scope: extras.scope } : {}),
    ...(extras.traceId ? { traceId: extras.traceId } : {}),
    ...(extras.ip ? { ip: extras.ip } : {}),
    ...(extras.userAgent ? { userAgent: extras.userAgent } : {}),
  };
  assertValidContext(ctx);
  return ctx;
}

export const isAgentPrincipal = (ctx: KernelContext): boolean =>
  ctx.principal.type === "agent" || ctx.principal.roles.some(isAgentRole);

/** Platform scope only for non-agent principals holding a PLT_* role (IPB-02-11). */
export function assertValidContext(ctx: KernelContext): void {
  if (!ctx.tenantId) throw new Error("context has no tenant");
  if (
    ctx.scope === "platform" &&
    (isAgentPrincipal(ctx) || !ctx.principal.roles.some(isPlatformRole))
  ) {
    throw new IpbError("IPB-SEC-005", { detail: "a platform context needs a PLT_* role" });
  }
}

export { PLATFORM_TENANT_ID };

export function runWithContext<T>(ctx: TenantContext, fn: () => T): T {
  assertValidContext(ctx);
  return storage.run(ctx, fn);
}

export function currentContext(): TenantContext | undefined {
  return storage.getStore();
}

export function requireContext(): TenantContext {
  const c = storage.getStore();
  if (!c)
    throw new Error("no tenant context: build it from verified claims with contextFromClaims()");
  return c;
}
