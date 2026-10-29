// Request context (IPB-02-13): built only from verified token claims, never from a header,
// query parameter or body. Carried on AsyncLocalStorage for code that has no explicit ctx.
import { AsyncLocalStorage } from "node:async_hooks";
import { IpbError } from "@infrabyx/contracts/errors";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import { VerifiedClaims } from "@infrabyx/contracts/ports";
import {
  SERVICE_READER_ROLES,
  isAgentRole,
  isPlatformRole,
  isServiceReaderRole,
  type ServiceReaderRole,
} from "@infrabyx/contracts/roles";

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
  if (c.roles.some(isServiceReaderRole))
    throw new IpbError("IPB-SEC-005", {
      detail: "service reader roles are in-process identities and never come from a token",
    });
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

/** The service reader role a context carries (OWNER-QUESTIONS #22), if any. */
export function serviceReaderRole(ctx: KernelContext): ServiceReaderRole | undefined {
  return ctx.principal.roles.find(isServiceReaderRole);
}

/**
 * Platform scope only for non-agent principals holding a PLT_* role (IPB-02-11), or for a service
 * principal holding exactly one service reader role and nothing that widens it (PL3-D-21). A
 * service reader never impersonates and never uses break-glass, in any scope.
 */
const BRANCH_ID = /^[A-Za-z0-9_.:-]{1,64}$/;

/** A branch context is well formed and names its current branch among those it may see. */
function assertBranchContext(ctx: KernelContext): void {
  const ids = ctx.branchIds ?? [];
  if (ids.length > 1000) throw new RangeError("a context lists at most 1000 branches");
  for (const b of [...ids, ...(ctx.branchId ? [ctx.branchId] : [])])
    if (!BRANCH_ID.test(b)) throw new RangeError(`invalid branch id ${JSON.stringify(b)}`);
  if (ctx.branchId && !ctx.allBranches && !ids.includes(ctx.branchId))
    throw new IpbError("IPB-SEC-005", {
      detail: "the context's branch is not one of the branches it may see",
    });
}

export function assertValidContext(ctx: KernelContext): void {
  if (!ctx.tenantId) throw new Error("context has no tenant");
  assertBranchContext(ctx);
  const reader = serviceReaderRole(ctx);
  if (reader) {
    const readers = ctx.principal.roles.filter(isServiceReaderRole);
    if (
      ctx.principal.type !== "service" ||
      readers.length !== 1 ||
      ctx.principal.roles.some(isPlatformRole) ||
      ctx.act ||
      ctx.breakGlassGrantId
    )
      throw new IpbError("IPB-SEC-005", {
        detail: `${reader} is a single-purpose service reader: no other platform role, impersonation or break-glass`,
      });
    return;
  }
  if (
    ctx.scope === "platform" &&
    (isAgentPrincipal(ctx) || !ctx.principal.roles.some(isPlatformRole))
  ) {
    throw new IpbError("IPB-SEC-005", { detail: "a platform context needs a PLT_* role" });
  }
}

/** The read-only platform context of a service reader (PL3-D-21). */
export function serviceReaderContext(role: ServiceReaderRole, principalId: string): KernelContext {
  if (!(role in SERVICE_READER_ROLES)) throw new Error(`unknown service reader role ${role}`);
  return {
    tenantId: PLATFORM_TENANT_ID,
    scope: "platform",
    principal: { id: principalId, type: "service", roles: [role] },
  };
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

/** Whether any member of the transaction's tenant holds `role` (tenancy.membership, RLS-scoped). */
export async function tenantHasRoleHolder(
  tx: { query<R>(text: string, params?: readonly unknown[]): Promise<{ rows: R[] }> },
  role: string,
): Promise<boolean> {
  const r = await tx.query<{ ok: boolean }>(
    "select exists (select 1 from tenancy.membership where $1 = any(roles)) as ok",
    [role],
  );
  return r.rows[0]?.ok === true;
}

/**
 * A member of the transaction's tenant as a background job re-checks them (IPB-03-65): whether the
 * user is active and the roles they hold now. Null when they are no longer a member.
 */
export async function memberStatus(
  tx: { query<R>(text: string, params?: readonly unknown[]): Promise<{ rows: R[] }> },
  userId: string,
): Promise<{ active: boolean; roles: string[] } | null> {
  const r = await tx.query<{ status: string; roles: string[] }>(
    `select u.status, m.roles from tenancy.membership m
       join tenancy.user u on u.id = m.user_id
      where m.user_id = $1`,
    [userId],
  );
  const row = r.rows[0];
  return row ? { active: row.status === "active", roles: row.roles } : null;
}
