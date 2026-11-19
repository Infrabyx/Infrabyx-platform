// Work Inbox (IPB-07-15, §07.4.9; PL3 plan §5.3). `InboxService` implements the `HumanQueue` that
// rules, notify and connectors raise items through, so none of them imports this package. An item
// is visible to its user, or to every holder of its role, except the principal it excludes (the
// maker of an approval request, or of the request behind an UNDETERMINED rule decision). Items
// resolve when the underlying record changes. An item raised with `escalateAfterHours` that is
// still open then is escalated once to ORG_ADMIN by an `inbox.escalate` timer, as approval
// requests are (OWNER-QUESTIONS #21, PL3-D-21); escalation notifies and never resolves.
//
// Snooze (LawDocsComply PR-LDC-46, R1-D-206; workflow/0005): a person who can see an item (the same
// rule as `markRead` and `resolve`) may hide it from themselves until a time, at most
// `INBOX_SNOOZE_MAX_DAYS` ahead and never past its due time. Every read compares the time with
// now(), so the item reappears at its time with no timer, and a read treats a snooze as over once
// the item is escalated or past due. An escalation is never snoozable. Snooze and unsnooze are
// ledgered; `list` also orders by due time or severity and lists one module or record.
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
import { APPROVAL_ESCALATION_ROLE, ConflictError, NotFoundError } from "@infrabyx/tenancy";
import type { WorkflowTimers } from "./timers.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The longest snooze (also a CHECK on `workflow.inbox_snooze`). */
export const INBOX_SNOOZE_MAX_DAYS = 30;
/** The help key of the item `escalate` raises for ORG_ADMIN; such an item is never snoozable. */
export const INBOX_ESCALATED_HELP_KEY = "hlp.inbox.escalated";

/** `list` orders: newest first (default), soonest due first, or most severe first. */
export type InboxOrder = "newest" | "due" | "severity";
export const INBOX_ORDERS: readonly InboxOrder[] = ["newest", "due", "severity"];
/** Whether `list` leaves out the caller's snoozed items (default), adds them, or shows only them. */
export type InboxSnoozedFilter = "exclude" | "include" | "only";

export interface InboxListFilter {
  type?: InboxItemType;
  includeResolved?: boolean;
  limit?: number;
  /** Only items raised by this module (IPB-07-15's module filter). */
  productModule?: string;
  /** Only items about this record. */
  recordRef?: string;
  orderBy?: InboxOrder;
  snoozed?: InboxSnoozedFilter;
}

/** Refuse a snooze time before any database call: a valid Date, in the future, at most 30 days ahead. */
export function assertSnoozeUntil(until: unknown, now = Date.now()): asserts until is Date {
  if (!(until instanceof Date) || Number.isNaN(until.getTime()))
    throw new RangeError("a snooze needs a valid Date");
  if (until.getTime() <= now) throw new RangeError("a snooze ends in the future");
  if (until.getTime() - now > INBOX_SNOOZE_MAX_DAYS * DAY)
    throw new RangeError(`a snooze lasts at most ${INBOX_SNOOZE_MAX_DAYS} days`);
}

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
  /** The caller's own active snooze, or null (none, cleared, over, or the item escalated or past due). */
  snoozedUntil: Date | null;
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
  snoozed_until?: Date | null;
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
  snoozedUntil: r.snoozed_until ?? null,
});

/** Visible to the principal: their own items or their roles', never one that excludes them. */
const VISIBLE = `((assignee_kind = 'user' and assignee_id = $1) or (assignee_kind = 'role' and assignee_id = any($2::text[])))
  and (exclude_principal is null or exclude_principal <> $1)`;

/**
 * The caller's ($1) active snooze of the item in scope: none once it is cleared or over, or once the
 * item is escalated or past its due time, so a snooze never hides an escalation or a due item.
 */
const SNOOZED_UNTIL = `case when inbox_item.escalated_at is null
    and (inbox_item.due_at is null or inbox_item.due_at > now())
  then (select s.snoozed_until from workflow.inbox_snooze s
         where s.item_id = inbox_item.id and s.principal_id = $1
           and s.cleared_at is null and s.snoozed_until > now()) end`;

const SEVERITY_RANK = "case severity when 'critical' then 0 when 'warning' then 1 else 2 end";
const ORDER_SQL: Record<InboxOrder, string> = {
  newest: "created_at desc, id desc",
  due: `due_at asc nulls last, ${SEVERITY_RANK}, created_at desc, id desc`,
  severity: `${SEVERITY_RANK}, due_at asc nulls last, created_at desc, id desc`,
};

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
          helpKey: INBOX_ESCALATED_HELP_KEY,
          ...(row.exclude_principal ? { excludePrincipal: row.exclude_principal } : {}),
        });
        await this.o.onEscalated?.(tx, toItem(row), role, row.exclude_principal);
        return "done" as const;
      },
      { action: "inbox.item.escalate" },
    );
  }

  /**
   * Items visible to the caller: open ones unless `includeResolved`, without the caller's snoozed
   * ones unless `snoozed` says otherwise, optionally of one module or record, newest first unless
   * `orderBy` says otherwise (ties end on the id, so pages are stable).
   */
  async list(ctx: KernelContext, filter: InboxListFilter = {}): Promise<InboxItem[]> {
    const order = filter.orderBy ?? "newest";
    if (!INBOX_ORDERS.includes(order)) throw new RangeError(`unknown inbox order ${String(order)}`);
    const snoozed = filter.snoozed ?? "exclude";
    if (!["exclude", "include", "only"].includes(snoozed))
      throw new RangeError(`unknown snoozed filter ${String(snoozed)}`);
    return this.o.kernel.read(ctx, async (tx) => {
      const params: unknown[] = [ctx.principal.id, [...ctx.principal.roles]];
      let where = VISIBLE;
      if (!filter.includeResolved) where += " and resolved_at is null";
      for (const [col, v] of [
        ["type", filter.type],
        ["product_module", filter.productModule],
        ["record_ref", filter.recordRef],
      ] as const)
        if (v !== undefined) {
          params.push(v);
          where += ` and ${col} = $${params.length}`;
        }
      const outer =
        snoozed === "exclude"
          ? "where snoozed_until is null"
          : snoozed === "only"
            ? "where snoozed_until is not null"
            : "";
      params.push(Math.min(filter.limit ?? 100, 500));
      const r = await tx.query<Row>(
        `select * from (select inbox_item.*, ${SNOOZED_UNTIL} as snoozed_until
            from workflow.inbox_item where ${where}) i ${outer}
          order by ${ORDER_SQL[order]} limit $${params.length}`,
        params,
      );
      return r.rows.map(toItem);
    });
  }

  /** The shell badge: open items visible to the caller and not snoozed by them. */
  async badgeCount(ctx: KernelContext): Promise<number> {
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<{ n: number }>(
        `select count(*)::int as n from workflow.inbox_item
          where ${VISIBLE} and resolved_at is null and (${SNOOZED_UNTIL}) is null`,
        [ctx.principal.id, [...ctx.principal.roles]],
      );
      return r.rows[0]?.n ?? 0;
    });
  }

  /**
   * Hide an open item from the caller (only) until `until`. The caller must see it (their own item
   * or their role's, never one that excludes them: the rule `markRead` and `resolve` use), else
   * `NotFoundError`. `RangeError` for a time not ahead, over `INBOX_SNOOZE_MAX_DAYS`, or after the
   * item's due time; `ConflictError` for an item escalated, an escalation, or past due. Snoozing
   * again replaces the time. Ledgered `inbox.item.snooze`.
   */
  async snooze(ctx: KernelContext, id: string, until: Date): Promise<{ snoozedUntil: Date }> {
    assertSnoozeUntil(until);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query<Row & { past_due: boolean }>(
          `select *, (due_at is not null and due_at <= now()) as past_due from workflow.inbox_item
            where id = $3 and resolved_at is null and ${VISIBLE} for update`,
          [ctx.principal.id, [...ctx.principal.roles], id],
        );
        const row = r.rows[0];
        if (!row) throw new NotFoundError("inbox item");
        if (row.escalated_at !== null || row.help_key === INBOX_ESCALATED_HELP_KEY)
          throw new ConflictError("an escalated inbox item or an escalation cannot be snoozed");
        if (row.past_due)
          throw new ConflictError("an inbox item past its due time cannot be snoozed");
        if (row.due_at !== null && until.getTime() > row.due_at.getTime())
          throw new RangeError("a snooze ends no later than the item's due time");
        await tx.query(
          `insert into workflow.inbox_snooze (tenant_id, item_id, principal_id, snoozed_until)
           values ($1, $2, $3, $4)
           on conflict (tenant_id, item_id, principal_id) do update
             set snoozed_until = excluded.snoozed_until, cleared_at = null, updated_at = now()`,
          [tx.ctx.tenantId, id, ctx.principal.id, until],
        );
        await this.o.audit.record(tx, {
          action: "inbox.item.snooze",
          resourceType: "inbox_item",
          resourceId: id,
          after: { snoozed_until: until.toISOString() },
        });
        return { snoozedUntil: until };
      },
      { action: "inbox.item.snooze" },
    );
  }

  /** Clear the caller's snooze of an item they can see (`NotFoundError` otherwise). Ledgered. */
  async unsnooze(ctx: KernelContext, id: string): Promise<void> {
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const seen = await tx.query(
          `select id from workflow.inbox_item where id = $3 and ${VISIBLE}`,
          [ctx.principal.id, [...ctx.principal.roles], id],
        );
        if (!seen.rowCount) throw new NotFoundError("inbox item");
        const r = await tx.query(
          `update workflow.inbox_snooze set cleared_at = now(), updated_at = now()
            where item_id = $1 and principal_id = $2 and cleared_at is null
              and snoozed_until > now() returning item_id`,
          [id, ctx.principal.id],
        );
        await this.o.audit.record(tx, {
          action: "inbox.item.unsnooze",
          resourceType: "inbox_item",
          resourceId: id,
          after: { cleared: (r.rowCount ?? 0) > 0 },
        });
      },
      { action: "inbox.item.unsnooze" },
    );
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
