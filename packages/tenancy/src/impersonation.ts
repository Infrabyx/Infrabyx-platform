// Impersonation, "view as user" (IPB-02-09): read-only, ticket reference required, ≤ 60 minutes,
// and ledgered in the target tenant so its ORG_OWNER sees actor, ticket and duration. Tokens
// issued for the session carry the RFC 8693 `act` claim; the kernel refuses every mutation.
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import { internalEvent } from "@infrabyx/config/events";
import { newId, type SecretKey } from "@infrabyx/crypto";
import { ConflictError, NotFoundError } from "./errors.js";

export const IMPERSONATION_MAX_MINUTES = 60;
const STARTER_ROLES = ["PLT_SUPER_ADMIN"];

export interface ImpersonationSession {
  id: string;
  tenantId: string;
  actorId: string;
  targetUserId: string;
  ticketRef: string;
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
}

export interface ImpersonationOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  product: string;
  outbox?: OutboxWriter;
  pseudonymKey?: SecretKey;
  /** Ceiling from settings (trust.impersonation.max_minutes); never above 60. */
  maxMinutes?: number;
  starterRoles?: readonly string[];
}

interface Row {
  id: string;
  tenant_id: string;
  actor_id: string;
  target_user_id: string;
  ticket_ref: string;
  started_at: Date;
  expires_at: Date;
  ended_at: Date | null;
}
const toSession = (r: Row): ImpersonationSession => ({
  id: r.id,
  tenantId: r.tenant_id,
  actorId: r.actor_id,
  targetUserId: r.target_user_id,
  ticketRef: r.ticket_ref,
  startedAt: r.started_at,
  expiresAt: r.expires_at,
  endedAt: r.ended_at,
});

export class Impersonation {
  constructor(private readonly o: ImpersonationOptions) {}

  /** `ctx` is the staff member's platform context aimed at the target tenant (`tenantId` = target). */
  async start(
    ctx: KernelContext,
    targetUserId: string,
    ticketRef: string,
    minutes = IMPERSONATION_MAX_MINUTES,
  ): Promise<ImpersonationSession> {
    const roles = this.o.starterRoles ?? STARTER_ROLES;
    if (
      ctx.scope !== "platform" ||
      ctx.principal.type !== "user" ||
      !ctx.principal.roles.some((r) => roles.includes(r))
    ) {
      throw new IpbError("IPB-UX-011", {
        detail: `impersonation needs ${roles.join(" or ")} in a platform context`,
      });
    }
    const max = Math.min(this.o.maxMinutes ?? IMPERSONATION_MAX_MINUTES, IMPERSONATION_MAX_MINUTES);
    if (!(minutes >= 1 && minutes <= max))
      throw new RangeError(`impersonation lasts 1–${max} minutes`);
    if (!ticketRef.trim()) throw new RangeError("a ticket reference is required");
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const id = newId("imp");
        const r = await tx.query<Row>(
          `insert into tenancy.impersonation_session (id, tenant_id, actor_id, target_user_id, ticket_ref, expires_at)
         values ($1, $2, $3, $4, $5, now() + make_interval(mins => $6)) returning *`,
          [id, ctx.tenantId, ctx.principal.id, targetUserId, ticketRef, minutes],
        );
        const s = toSession(r.rows[0] as Row);
        await this.o.audit.record(tx, {
          action: "security.impersonation.start",
          resourceType: "impersonation_session",
          resourceId: id,
          after: {
            actor_id: s.actorId,
            target_user_id: targetUserId,
            ticket_ref: ticketRef,
            expires_at: s.expiresAt.toISOString(),
          },
        });
        await this.emit(tx, "ImpersonationStarted", {
          session_id: id,
          actor_id: s.actorId,
          target_user_id: targetUserId,
          ticket_ref: ticketRef,
          expires_at: s.expiresAt.toISOString(),
        });
        return s;
      },
      { action: "security.impersonation.start" },
    );
  }

  async end(ctx: KernelContext, id: string): Promise<ImpersonationSession> {
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const cur = await tx.query<Row>(
          "select * from tenancy.impersonation_session where id = $1 for update",
          [id],
        );
        const row = cur.rows[0];
        if (!row) throw new NotFoundError("impersonation session");
        if (row.actor_id !== ctx.principal.id)
          throw new IpbError("IPB-UX-011", {
            detail: "only the impersonating actor ends the session",
          });
        if (row.ended_at) throw new ConflictError("session already ended");
        const r = await tx.query<Row>(
          "update tenancy.impersonation_session set ended_at = least(now(), expires_at) where id = $1 returning *",
          [id],
        );
        const s = toSession(r.rows[0] as Row);
        const seconds = Math.round(((s.endedAt as Date).getTime() - s.startedAt.getTime()) / 1000);
        await this.o.audit.record(tx, {
          action: "security.impersonation.end",
          resourceType: "impersonation_session",
          resourceId: id,
          after: { duration_s: seconds },
        });
        await this.emit(tx, "ImpersonationEnded", { session_id: id, duration_s: seconds });
        return s;
      },
      { action: "security.impersonation.end" },
    );
  }

  /** Sessions visible to the target tenant (ORG_OWNER audit view). */
  async list(ctx: KernelContext): Promise<ImpersonationSession[]> {
    if (ctx.scope !== "platform" && !ctx.principal.roles.includes("ORG_OWNER")) {
      throw new IpbError("IPB-UX-011", { detail: "visible to ORG_OWNER" });
    }
    return this.o.kernel.read(ctx, async (tx) =>
      (
        await tx.query<Row>("select * from tenancy.impersonation_session order by started_at desc")
      ).rows.map(toSession),
    );
  }

  /** Whether a session is live; the IDENTITY adapter calls this before issuing an `act` token. */
  async isActive(ctx: KernelContext, id: string): Promise<boolean> {
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query(
        "select 1 from tenancy.impersonation_session where id = $1 and ended_at is null and expires_at > now()",
        [id],
      );
      return r.rows.length > 0;
    });
  }

  private async emit(
    tx: Tx,
    event: "ImpersonationStarted" | "ImpersonationEnded",
    data: Record<string, unknown>,
  ): Promise<void> {
    if (!this.o.outbox) return;
    const envelope = internalEvent({
      product: this.o.product,
      event,
      tenantId: tx.ctx.tenantId,
      data,
      actorId: tx.ctx.principal.id,
      ...(this.o.pseudonymKey ? { pseudonymKey: this.o.pseudonymKey } : {}),
    });
    await this.o.outbox.publish(tx, "tenancy", { envelope });
  }
}
