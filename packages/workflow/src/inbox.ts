// Work Inbox (IPB-07-15, §07.4.9; PL3 plan §5.3). `InboxService` implements the `HumanQueue` that
// rules, notify and connectors raise items through, so none of them imports this package. An item
// is visible to its user, or to every holder of its role, except the principal it excludes (the
// maker of an approval request). Items resolve when the underlying record changes.
import type {
  AuditSink,
  HumanQueue,
  InboxItemInput,
  InboxItemType,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import { INBOX_ITEM_TYPES } from "@infrabyx/contracts/kernel";
import { internalEvent } from "@infrabyx/config/events";
import { newId, type SecretKey } from "@infrabyx/crypto";
import { NotFoundError } from "@infrabyx/tenancy";

export interface InboxItem {
  id: string;
  type: InboxItemType;
  productModule: string;
  recordRef: string;
  title: string;
  assignee: { kind: "user" | "role"; id: string };
  severity: "info" | "warning" | "critical";
  actionHint: string | null;
  deepLink: string;
  helpKey: string;
  dueAt: Date | null;
  /** True for a Vidhi suggestion: the screen labels it "AI suggestion" (IPB-07-AT-10). */
  fromAgent: boolean;
  createdAt: Date;
  readAt: Date | null;
  resolvedAt: Date | null;
}

export interface InboxServiceOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  product: string;
  outbox?: OutboxWriter;
  pseudonymKey?: SecretKey;
}

export interface RaiseOptions {
  /** A principal who must not see the item (the maker of an approval request). */
  excludePrincipal?: string;
  /** Agent or user id that produced the item (suggestions). */
  fromId?: string;
}

interface Row {
  id: string;
  type: InboxItemType;
  product_module: string;
  record_ref: string;
  title: string;
  assignee_kind: "user" | "role";
  assignee_id: string;
  severity: InboxItem["severity"];
  action_hint: string | null;
  deep_link: string;
  help_key: string;
  due_at: Date | null;
  from_agent: boolean;
  created_at: Date;
  read_at: Date | null;
  resolved_at: Date | null;
}

const toItem = (r: Row): InboxItem => ({
  id: r.id,
  type: r.type,
  productModule: r.product_module,
  recordRef: r.record_ref,
  title: r.title,
  assignee: { kind: r.assignee_kind, id: r.assignee_id },
  severity: r.severity,
  actionHint: r.action_hint,
  deepLink: r.deep_link,
  helpKey: r.help_key,
  dueAt: r.due_at,
  fromAgent: r.from_agent,
  createdAt: r.created_at,
  readAt: r.read_at,
  resolvedAt: r.resolved_at,
});

/** Visible to the principal: their own items or their roles', never one that excludes them. */
const VISIBLE = `((assignee_kind = 'user' and assignee_id = $1) or (assignee_kind = 'role' and assignee_id = any($2::text[])))
  and (exclude_principal is null or exclude_principal <> $1)`;

export class InboxService implements HumanQueue {
  constructor(private readonly o: InboxServiceOptions) {}

  /** Raise an item inside the caller's transaction (HumanQueue). */
  async raise(tx: Tx, item: InboxItemInput, opts: RaiseOptions = {}): Promise<{ id: string }> {
    if (!INBOX_ITEM_TYPES.includes(item.type))
      throw new Error(`unknown inbox item type ${item.type}`);
    const id = newId("ibx");
    await tx.query(
      `insert into workflow.inbox_item
         (id, tenant_id, type, product_module, record_ref, title, assignee_kind, assignee_id,
          exclude_principal, severity, action_hint, deep_link, help_key, due_at, from_agent, from_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        id,
        tx.ctx.tenantId,
        item.type,
        item.productModule,
        item.recordRef,
        item.title,
        item.assignee.kind,
        item.assignee.id,
        opts.excludePrincipal ?? null,
        item.severity ?? "info",
        item.actionHint ?? null,
        item.deepLink,
        item.helpKey,
        item.dueAt ?? null,
        item.fromAgent === true,
        opts.fromId ?? null,
      ],
    );
    await this.o.audit.record(tx, {
      action: "inbox.item.create",
      resourceType: "inbox_item",
      resourceId: id,
      after: {
        type: item.type,
        product_module: item.productModule,
        record_ref: item.recordRef,
        assignee_kind: item.assignee.kind,
        assignee: item.assignee.id,
      },
    });
    await this.emit(tx, "ItemCreated", {
      item_id: id,
      type: item.type,
      product_module: item.productModule,
      record_ref: item.recordRef,
      assignee_kind: item.assignee.kind,
      assignee: item.assignee.id,
    });
    return { id };
  }

  /** Open items visible to the caller, newest first. */
  async list(
    ctx: KernelContext,
    filter: { type?: InboxItemType; includeResolved?: boolean; limit?: number } = {},
  ): Promise<InboxItem[]> {
    return this.o.kernel.read(ctx, async (tx) => {
      const params: unknown[] = [ctx.principal.id, [...ctx.principal.roles]];
      let where = VISIBLE;
      if (!filter.includeResolved) where += " and resolved_at is null";
      if (filter.type) {
        params.push(filter.type);
        where += ` and type = $${params.length}`;
      }
      params.push(Math.min(filter.limit ?? 100, 500));
      const r = await tx.query<Row>(
        `select * from workflow.inbox_item where ${where} order by created_at desc, id desc limit $${params.length}`,
        params,
      );
      return r.rows.map(toItem);
    });
  }

  /** The shell badge: open items visible to the caller. */
  async badgeCount(ctx: KernelContext): Promise<number> {
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<{ n: number }>(
        `select count(*)::int as n from workflow.inbox_item where ${VISIBLE} and resolved_at is null`,
        [ctx.principal.id, [...ctx.principal.roles]],
      );
      return r.rows[0]?.n ?? 0;
    });
  }

  async markRead(ctx: KernelContext, id: string): Promise<void> {
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query(
          `update workflow.inbox_item set read_at = coalesce(read_at, now())
            where id = $3 and ${VISIBLE} returning id`,
          [ctx.principal.id, [...ctx.principal.roles], id],
        );
        if (!r.rowCount) throw new NotFoundError("inbox item");
        await this.o.audit.record(tx, {
          action: "inbox.item.read",
          resourceType: "inbox_item",
          resourceId: id,
        });
      },
      { action: "inbox.item.read" },
    );
  }

  /** Resolve one visible item (a person dismissing or completing it). */
  async resolve(ctx: KernelContext, id: string, resolution = "done"): Promise<void> {
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query<Row>(
          `update workflow.inbox_item set resolved_at = now(), resolution = $4
            where id = $3 and resolved_at is null and ${VISIBLE} returning *`,
          [ctx.principal.id, [...ctx.principal.roles], id, resolution],
        );
        const row = r.rows[0];
        if (!row) throw new NotFoundError("inbox item");
        await this.resolved(tx, row, resolution);
      },
      { action: "inbox.item.resolve" },
    );
  }

  /** Resolve every open item about a record, inside the caller's transaction. */
  async resolveFor(
    tx: Tx,
    productModule: string,
    recordRef: string,
    resolution: string,
    types?: readonly InboxItemType[],
  ): Promise<number> {
    const r = await tx.query<Row>(
      `update workflow.inbox_item set resolved_at = now(), resolution = $3
        where product_module = $1 and record_ref = $2 and resolved_at is null
          and ($4::text[] is null or type = any($4::text[]))
        returning *`,
      [productModule, recordRef, resolution, types ? [...types] : null],
    );
    for (const row of r.rows) await this.resolved(tx, row, resolution);
    return r.rows.length;
  }

  private async resolved(tx: Tx, row: Row, resolution: string): Promise<void> {
    await this.o.audit.record(tx, {
      action: "inbox.item.resolve",
      resourceType: "inbox_item",
      resourceId: row.id,
      after: { resolution },
    });
    await this.emit(tx, "ItemResolved", {
      item_id: row.id,
      type: row.type,
      product_module: row.product_module,
      record_ref: row.record_ref,
      assignee_kind: row.assignee_kind,
      assignee: row.assignee_id,
    });
  }

  private async emit(
    tx: Tx,
    event: "ItemCreated" | "ItemResolved",
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
      ...(tx.ctx.traceId ? { traceId: tx.ctx.traceId } : {}),
    });
    await this.o.outbox.publish(tx, "workflow", { envelope });
  }
}
