// Kernel interfaces shared by config, tenancy, audit and seed. They live here so the packages can
// depend on interfaces, not on each other (tenancy implements MutationKernel; audit implements
// AuditSink). See docs/phases/PL1-plan.md §3.2.
import type { PrincipalType } from "./roles.js";
import type { DataClass } from "./data-class.js";

export interface Principal {
  /** usr_…, or a service/agent identity id. */
  id: string;
  type: PrincipalType;
  roles: readonly string[];
  /** Product scope for group staff (IPB-D-12). */
  productScope?: readonly string[];
}

/** Request context. Built only from a verified token, never from headers or bodies (IPB-02-13). */
export interface KernelContext {
  tenantId: string;
  entityId?: string;
  principal: Principal;
  /** RFC 8693 actor during impersonation; any mutation is refused while present (IPB-02-09). */
  act?: { sub: string; sessionId: string };
  /** Break-glass grant id when the token carries `bg:true` (IPB-02-06). */
  breakGlassGrantId?: string;
  /** Platform scope: only for PLT_* principals in the platform tenant. */
  scope?: "tenant" | "platform";
  traceId?: string;
  ip?: string;
  userAgent?: string;
}

export interface QueryResult<R> {
  rows: R[];
  rowCount: number | null;
}

/** A database transaction handle with the tenant context applied via SET LOCAL. */
export interface Tx {
  readonly ctx: KernelContext;
  query<R = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<R>>;
  /** Called by the audit sink after it writes a ledger row in this transaction. */
  markAudited(): void;
  readonly audited: boolean;
}

export interface MutateOptions {
  /** Action verb checked against agent-forbidden verbs (IPB-02-10), e.g. "approvals.request.approve". */
  action?: string;
  /** Set only for jobs that write no tenant data and are allowed to skip the ledger (none in PL1). */
  allowWithoutAudit?: false;
}

export interface MutationKernel {
  mutate<T>(ctx: KernelContext, fn: (tx: Tx) => Promise<T>, opts?: MutateOptions): Promise<T>;
  /**
   * Read-only transaction. `snapshot: true` makes every statement see one snapshot (REPEATABLE
   * READ), for readers that reconcile counts against rows (the export snapshot, PL3-D-22).
   */
  read<T>(ctx: KernelContext, fn: (tx: Tx) => Promise<T>, opts?: ReadOptions): Promise<T>;
}

export interface ReadOptions {
  snapshot?: boolean;
}

export interface AuditEntryInput {
  /** Dotted action, e.g. "settings.setting.change". */
  action: string;
  resourceType: string;
  resourceId: string;
  before?: unknown;
  after?: unknown;
  /** Ledger id being corrected (correction entries, IPB-02 NN-02). */
  correctsId?: string;
}

/** Writes the hash-chained ledger inside the caller's transaction (IPB-02-51). */
export interface AuditSink {
  record(tx: Tx, entry: AuditEntryInput): Promise<{ id: string }>;
}

export interface OutboxEvent {
  /** Internal or ecosystem envelope; validated by the writer. */
  envelope: Record<string, unknown>;
}

export interface OutboxWriter {
  publish(tx: Tx, schema: string, event: OutboxEvent): Promise<void>;
}

export interface ApprovalRequestInput {
  action: string;
  riskClass: "R2" | "R3" | "R4" | "R5";
  payload: Record<string, unknown>;
  payloadDataClass?: DataClass;
  summary?: string;
  /**
   * What the change does, for the checker (IPB-07-15, 07-39). Stored as given when the payload is
   * PUBLIC or INTERNAL; above that only the changed field names are kept (PL3 plan §5.2).
   */
  diff?: { before: Record<string, unknown> | null; after: Record<string, unknown> };
}

/** Maker-checker gateway used by config for settings that require approval (IPB-07-39). */
export interface ApprovalGateway {
  request(tx: Tx, input: ApprovalRequestInput): Promise<{ id: string }>;
}

/** Work Inbox item types (IPB-07 §07.4.9). */
export const INBOX_ITEM_TYPES = [
  "task",
  "approval",
  "mention",
  "suggestion",
  "due",
  "job_failed",
] as const;
export type InboxItemType = (typeof INBOX_ITEM_TYPES)[number];

export interface InboxItemInput {
  type: InboxItemType;
  /** Raising module, e.g. "rules", "notify", "payments". */
  productModule: string;
  /** Id of the record the item is about (`dcs_…`, `dlv_…`, `apr_…`). */
  recordRef: string;
  /** INTERNAL text only; no personal data (IPB-07 §07.4.9). */
  title: string;
  /** A user id or a role name. */
  assignee: { kind: "user" | "role"; id: string };
  severity?: "info" | "warning" | "critical";
  /** Machine hint for the screen, e.g. "confirm_resend", "review_undetermined". */
  actionHint?: string;
  deepLink: string;
  helpKey: string;
  dueAt?: string;
  /** Set for Vidhi suggestions, so the item is labelled AI (PL4). */
  fromAgent?: boolean;
  /** A principal who may not see or resolve the item (the maker whose request produced it). */
  excludePrincipal?: string;
  /**
   * Escalate to the tenant's ORG_ADMIN role if still open after this many hours, as approval
   * requests are (48 h for UNDETERMINED rule decisions, OWNER-QUESTIONS #21).
   */
  escalateAfterHours?: number;
}

/**
 * Raises a Work Inbox item inside the caller's transaction (PL3 plan §5.3). `workflow` implements it;
 * `notify`, `rules` and `connectors` depend only on this interface, so no package imports `workflow`.
 */
export interface HumanQueue {
  raise(tx: Tx, item: InboxItemInput): Promise<{ id: string }>;
}
