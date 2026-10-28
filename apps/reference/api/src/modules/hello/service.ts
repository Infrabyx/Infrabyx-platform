// The hello module's service (PL6 plan §8.1): every write goes through `kernel.mutate` with the
// ledger entry and the outbox event in the same transaction (IPB-02-51, IPB-01 §01.4.3.3); the
// message length comes from the registered setting; retracting is an R2 maker-checker action
// through the tenancy approvals engine; deleting ends in a locked verb, so an agent can never do
// it (IPB-02-10) and only an owner may (AUTHZ, checked by the HTTP layer).
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import { IpbError } from "@infrabyx/contracts/errors";
import { internalEvent } from "@infrabyx/config/events";
import { newId } from "@infrabyx/crypto";
import { NotFoundError, type ApprovalsEngine } from "@infrabyx/tenancy";
import { HELLO_EVENTS, HELLO_MAX_LENGTH_KEY, HELLO_SCHEMA } from "./manifest.js";

export const HELLO_ACTIONS = {
  create: "hello.greeting.create",
  retract: "hello.greeting.retract",
  delete: "hello.greeting.delete",
} as const;

/** Settings the service reads (registered in `@infrabyx/config`'s settings tree). */
export interface SettingsReader {
  get(ctx: KernelContext, key: typeof HELLO_MAX_LENGTH_KEY): Promise<unknown>;
}

export interface Greeting {
  id: string;
  message: string;
  createdBy: string;
  createdAt: string;
  retractedAt: string | null;
  retractReason: string | null;
}

interface Row {
  id: string;
  message: string;
  created_by: string;
  created_at: Date;
  retracted_at: Date | null;
  retract_reason: string | null;
}

const toGreeting = (r: Row): Greeting => ({
  id: r.id,
  message: r.message,
  createdBy: r.created_by,
  createdAt: r.created_at.toISOString(),
  retractedAt: r.retracted_at?.toISOString() ?? null,
  retractReason: r.retract_reason,
});

/** The platform ceiling of a greeting; the setting can only lower it. */
export const HELLO_MESSAGE_CEILING = 2000;

/** Length rules every caller shares (the HTTP layer and the seed). */
export function checkMessage(message: string, maxLength: number): string {
  const m = message.trim();
  if (m.length === 0) throw new IpbError("IPB-UX-003", { detail: "the greeting is empty" });
  const max = Math.min(maxLength, HELLO_MESSAGE_CEILING);
  if (m.length > max)
    throw new IpbError("IPB-UX-003", {
      detail: `the greeting is longer than ${max} characters`,
      meta: { max, length: m.length },
    });
  return m;
}

export interface HelloServiceOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  outbox: OutboxWriter;
  settings: SettingsReader;
  /** The product the events carry (`in.<product>.hello.<Event>.v1`). */
  product: string;
  /** Registers the retract action; without it a retraction cannot be requested. */
  approvals?: ApprovalsEngine;
  now?: () => Date;
}

export class HelloService {
  constructor(private readonly o: HelloServiceOptions) {
    o.approvals?.register(HELLO_ACTIONS.retract, {
      checkerRoles: ["ORG_CHECKER", "ORG_ADMIN", "ORG_OWNER"],
      execute: (tx, payload) => this.retractApproved(tx, payload),
    });
  }

  private async emit(
    tx: Tx,
    name: (typeof HELLO_EVENTS)[keyof typeof HELLO_EVENTS],
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.o.outbox.publish(tx, HELLO_SCHEMA, {
      envelope: internalEvent({
        product: this.o.product,
        event: { module: "hello", name },
        tenantId: tx.ctx.tenantId,
        data,
        ...(tx.ctx.traceId ? { traceId: tx.ctx.traceId } : {}),
        time: this.o.now?.() ?? new Date(),
      }) as unknown as Record<string, unknown>,
    });
  }

  private async load(tx: Tx, id: string): Promise<Row> {
    const r = await tx.query<Row>(
      `select id, message, created_by, created_at, retracted_at, retract_reason
         from hello.greeting where id = $1 and deleted_at is null`,
      [id],
    );
    const row = r.rows[0];
    if (!row) throw new NotFoundError(`greeting ${id}`);
    return row;
  }

  /** The tenant's longest allowed greeting (the setting, under the platform ceiling). */
  async maxLength(ctx: KernelContext): Promise<number> {
    const v = await this.o.settings.get(ctx, HELLO_MAX_LENGTH_KEY);
    return typeof v === "number" ? Math.min(v, HELLO_MESSAGE_CEILING) : HELLO_MESSAGE_CEILING;
  }

  async create(ctx: KernelContext, input: { message: string }): Promise<Greeting> {
    const message = checkMessage(input.message, await this.maxLength(ctx));
    return this.o.kernel.mutate(ctx, (tx) => this.createIn(tx, message), {
      action: HELLO_ACTIONS.create,
    });
  }

  /**
   * Insert a greeting in a transaction the caller owns (the Vidhi tool runs in the task's). The
   * message is already checked against the tenant's limit.
   */
  async createIn(tx: Tx, message: string): Promise<Greeting> {
    const id = newId("grt");
    const r = await tx.query<Row>(
      `insert into hello.greeting (id, tenant_id, message, created_by)
       values ($1, $2, $3, $4)
       returning id, message, created_by, created_at, retracted_at, retract_reason`,
      [id, tx.ctx.tenantId, message, tx.ctx.principal.id],
    );
    await this.o.audit.record(tx, {
      action: HELLO_ACTIONS.create,
      resourceType: "hello_greeting",
      resourceId: id,
      after: { message },
    });
    await this.emit(tx, HELLO_EVENTS.created, { greeting_id: id, length: message.length });
    return toGreeting(r.rows[0]!);
  }

  async list(ctx: KernelContext, limit = 50): Promise<Greeting[]> {
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<Row>(
        `select id, message, created_by, created_at, retracted_at, retract_reason
           from hello.greeting where deleted_at is null
          order by created_at desc, id desc limit $1`,
        [Math.min(Math.max(limit, 1), 200)],
      );
      return r.rows.map(toGreeting);
    });
  }

  async get(ctx: KernelContext, id: string): Promise<Greeting> {
    return this.o.kernel.read(ctx, async (tx) => toGreeting(await this.load(tx, id)));
  }

  /**
   * Ask to retract a greeting: an R2 request for a checker of the tenant (IPB-02 §02.4.6.1). The
   * greeting stays visible until the request is approved and executed.
   */
  async requestRetract(
    ctx: KernelContext,
    id: string,
    reason: string,
  ): Promise<{ approvalId: string }> {
    const approvals = this.o.approvals;
    if (!approvals) throw new IpbError("IPB-SEC-005", { detail: "no approvals engine" });
    const why = reason.trim();
    if (why.length === 0 || why.length > 500)
      throw new IpbError("IPB-UX-003", { detail: "a reason of 1 to 500 characters is needed" });
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const row = await this.load(tx, id);
        if (row.retracted_at)
          throw new IpbError("IPB-UX-005", { detail: "the greeting is already retracted" });
        const { id: approvalId } = await approvals.request(tx, {
          action: HELLO_ACTIONS.retract,
          riskClass: "R2",
          payload: { greeting_id: id, reason: why },
          payloadDataClass: "INTERNAL",
          summary: `Retract greeting ${id}`,
          diff: { before: { retracted: false }, after: { retracted: true, reason: why } },
        });
        await this.o.audit.record(tx, {
          action: `${HELLO_ACTIONS.retract}.request`,
          resourceType: "hello_greeting",
          resourceId: id,
          after: { approval_id: approvalId },
        });
        return { approvalId };
      },
      { action: `${HELLO_ACTIONS.retract}.request` },
    );
  }

  /**
   * Runs inside the approvals engine's execution transaction after a checker approved. A greeting
   * deleted or already retracted while the request waited leaves nothing to do; the engine's own
   * ledger entry records the executed decision.
   */
  private async retractApproved(tx: Tx, payload: Record<string, unknown>): Promise<void> {
    const id = String(payload.greeting_id ?? "");
    const reason = String(payload.reason ?? "");
    const row = await this.load(tx, id).catch((e: unknown) => {
      if (e instanceof NotFoundError) return undefined;
      throw e;
    });
    if (!row || row.retracted_at) return;
    await tx.query(
      `update hello.greeting set retracted_at = now(), retract_reason = $2 where id = $1`,
      [id, reason],
    );
    await this.o.audit.record(tx, {
      action: HELLO_ACTIONS.retract,
      resourceType: "hello_greeting",
      resourceId: id,
      before: { retracted: false },
      after: { retracted: true, reason },
    });
    await this.emit(tx, HELLO_EVENTS.retracted, { greeting_id: id });
  }

  /** Soft delete by an owner. The action ends in `delete`, which the kernel refuses to agents. */
  async remove(ctx: KernelContext, id: string): Promise<void> {
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await this.load(tx, id);
        await tx.query(`update hello.greeting set deleted_at = now() where id = $1`, [id]);
        await this.o.audit.record(tx, {
          action: HELLO_ACTIONS.delete,
          resourceType: "hello_greeting",
          resourceId: id,
          before: { deleted: false },
          after: { deleted: true },
        });
        await this.emit(tx, HELLO_EVENTS.deleted, { greeting_id: id });
      },
      { action: HELLO_ACTIONS.delete },
    );
  }
}
