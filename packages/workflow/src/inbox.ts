// Work Inbox (IPB-07-15, §07.4.9; PL3 plan §5.3). `InboxService` implements the `HumanQueue` that
// rules, notify and connectors raise items through, so none of them imports this package. An item
// is visible to its user, or to every holder of its role, except the principal it excludes (the
// maker of an approval request, or of the request behind an UNDETERMINED rule decision). Items
// resolve when the underlying record changes. An item raised with `escalateAfterHours` that is
// still open then is escalated once to ORG_ADMIN by an `inbox.escalate` timer, as approval
// requests are (OWNER-QUESTIONS #21, PL3-D-21); escalation notifies and never resolves.
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
import { APPROVAL_ESCALATION_ROLE, NotFoundError } from "@infrabyx/tenancy";
import type { WorkflowTimers } from "./timers.js";

const HOUR = 3_600_000;

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
  /** Sends the mandatory `inbox.escalated` class when an item is escalated (NOTIFY). */
  onEscalated?: (
    tx: Tx,
    item: InboxItem,
    role: string,
    excludePrincipal: string | null,
  ) => Promise<void>;
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
  exclude_principal: string | null;
  escalated_at: Date | null;
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
  private timers: WorkflowTimers | null = null;
  constructor(private readonly o: InboxServiceOptions) {}

  /** Connect the timers that escalate items raised with `escalateAfterHours` (`createWorkflow`). */
  useTimers(timers: WorkflowTimers): this {
    this.timers = timers;
    timers.on("inbox.escalate", (ctx, t) => this.escalate(ctx, t.ref));
    return this;
  }

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
        item.excludePrincipal ?? opts.excludePrincipal ?? null,
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
    if (item.escalateAfterHours !== undefined) {
      if (!this.timers)
        throw new Error("InboxService.useTimers was not called (escalateAfterHours)");
      if (!(item.escalateAfterHours > 0)) throw new Error("escalateAfterHours must be positive");
      await this.timers.schedule(
        tx,
        "inbox.escalate",
        id,
        new Date(Date.now() + item.escalateAfterHours * HOUR),
      );
    }
    return { id };
  }

  /**
   * Escalate an item still open at its deadline (timer): one `due` item for ORG_ADMIN, never shown
   * to the excluded principal, and the `inbox.escalated` notification. Stale once resolved.
   */
  async escalate(ctx: KernelContext, id: string): Promise<"done" | "stale"> {
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query<Row>(
          `update workflow.inbox_item set escalated_at = now()
            where id = $1 and resolved_at is null and escalated_at is null returning *`,
          [id],
        );
        const row = r.rows[0];
        if (!row) {
          await this.o.audit.record(tx, {
            action: "inbox.item.escalate",
            resourceType: "inbox_item",
            resourceId: id,
            after: { stale: true },
          });
          return "stale" as const;
        }
        const role = APPROVAL_ESCALATION_ROLE;
        const hours = Math.round((Date.now() - row.created_at.getTime()) / HOUR);
        await this.o.audit.record(tx, {
          action: "inbox.item.escalate",
          resourceType: "inbox_item",
          resourceId: id,
          after: { role, hours, product_module: row.product_module, record_ref: row.record_ref },
        });
        await this.raise(tx, {
          type: "due",
          productModule: row.product_module,
          recordRef: row.record_ref,
          title: `Escalated: ${row.title}`.slice(0, 200),
          assignee: { kind: "role", id: role },
          severity: "warning",
          actionHint: "follow_up",
          deepLink: row.deep_link,
          helpKey: "hlp.inbox.escalated",
          ...(row.exclude_principal ? { excludePrincipal: row.exclude_principal } : {}),
        });
        await this.o.onEscalated?.(tx, toItem(row), role, row.exclude_principal);
        return "done" as const;
      },
      { action: "inbox.item.escalate" },
    );
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
        await this.timers?.cancel(tx, row.id, ["inbox.escalate"]);
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
    if (r.rows.length && this.timers)
      for (const row of r.rows) await this.timers.cancel(tx, row.id, ["inbox.escalate"]);
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
