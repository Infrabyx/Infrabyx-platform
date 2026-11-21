// Kernel interfaces shared by config, tenancy, audit and seed. They live here so the packages can
// depend on interfaces, not on each other (tenancy implements MutationKernel; audit implements
// AuditSink). See docs/phases/PL1-plan.md §3.2.
import { z } from "zod";
import type { PrincipalType } from "./roles.js";
import type { DataClass } from "./data-class.js";
import { TENANT_ID_REGEX } from "./ids.js";

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
  /**
   * The caller's organisation units, outermost first (an organisation unit, then a department or
   * function), from the product's own organisation model, for setting resolution at the UNIT tier
   * (IPB-07-38 as amended for PR-042). At most 8 ids of 1 to 64 of [A-Za-z0-9_-].
   */
  unitIds?: readonly string[];
  principal: Principal;
  /** RFC 8693 actor during impersonation; any mutation is refused while present (IPB-02-09). */
  act?: { sub: string; sessionId: string };
  /** Break-glass grant id when the token carries `bg:true` (IPB-02-06). */
  breakGlassGrantId?: string;
  /**
   * The external grant (`xgr_…`) an `external` principal reads under (R1-D-29); required for that
   * principal type and refused on any other. The kernel checks it is active, the principal's own
   * and in this tenant on every transaction.
   */
  externalGrantId?: string;
  /** Platform scope: only for PLT_* principals in the platform tenant. */
  scope?: "tenant" | "platform";
  traceId?: string;
  ip?: string;
  userAgent?: string;
  /**
   * The branch the change is made in (Finbyx PR-FBX-10 item 1; R1-D-26), recorded in the ledger and
   * the statutory capture. It must be one of `branchIds` unless `allBranches` is set.
   */
  branchId?: string;
  /** Branches whose rows the principal may see; `tenancy.branch_allowed()` refuses any other. */
  branchIds?: readonly string[];
  /** Every branch of the tenant (for example head office); takes the place of `branchIds`. */
  allBranches?: boolean;
  /**
   * The tenant is a sandbox (LawDocsComply PR-LDC-29; R1-D-87): ports record and never send, and
   * the AI gateway refuses data above INTERNAL. **Set by the kernel only**: inside every read and
   * mutate transaction `tx.ctx.sandbox` is read from `tenancy.tenant.sandbox`, overwriting
   * whatever the caller passed, so only `tx.ctx` is to be trusted, never a request's context.
   * Absent means the kernel could not read it (no tenant row, a kernel that does not set it); the
   * ports then fail closed and treat the tenant as a sandbox (`isSandboxed`).
   */
  sandbox?: boolean;
}

/**
 * Whether ports must behave as in a sandbox for this transaction's context: true unless the kernel
 * has read the tenant's flag as false (fail closed, R1-D-87). Pass `tx.ctx`, never a caller's.
 */
export const isSandboxed = (ctx: Pick<KernelContext, "sandbox">): boolean => ctx.sandbox !== false;

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
  /**
   * A kernel-owned nested unit (Finbyx PR-FBX-30, R1-D-41): the kernel opens a savepoint, runs
   * `fn`, and releases it, or rolls back to it when `fn` throws, so one failed item of a batch rolls
   * back alone (its ledger entries and outbox rows with it) and the transaction carries on. Units
   * nest. The kernel's own transactions provide it; a handle without it cannot run units.
   */
  unit?<T>(fn: (tx: Tx) => Promise<T>): Promise<UnitOutcome<T>>;
}

/** The outcome of `Tx.unit`: the value, or the error after its savepoint was rolled back. */
export type UnitOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

export interface MutateOptions {
  /** Action verb checked against agent-forbidden verbs (IPB-02-10), e.g. "approvals.request.approve". */
  action?: string;
  /** Set only for jobs that write no tenant data and are allowed to skip the ledger (none in PL1). */
  allowWithoutAudit?: false;
  /**
   * Why the change is made (1 to 500 characters), e.g. a correction's justification. The kernel sets
   * it, with `action`, for the transaction, so the statutory capture records it (R1-D-25).
   */
  reason?: string;
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
  /**
   * Business ids the entry concerns (LawDocsComply PR-LDC-30, R1-D-125): 1 to 16 distinct ids of
   * 1 to 128 characters of `A-Z a-z 0-9 _ . : @ / + = -`, such as an obligation or matter id. Ids
   * only, never personal data (no names, PAN, Aadhaar or account numbers). Covered by the entry's
   * hash when present; read back with `AuditService.history(ctx, businessId)`.
   */
  businessIds?: readonly string[];
}

/** The pattern of one business id on a ledger entry (PR-LDC-30). */
export const BUSINESS_ID_PATTERN = /^[A-Za-z0-9_.:@/+=-]{1,128}$/;
/** The most business ids one ledger entry carries (PR-LDC-30). */
export const MAX_BUSINESS_IDS = 16;

/** Writes the hash-chained ledger inside the caller's transaction (IPB-02-51). */
export interface AuditSink {
  record(tx: Tx, entry: AuditEntryInput): Promise<{ id: string }>;
}

/**
 * Security audit events (owner answer #132 (5); R1-D-187): attempts the platform refused for
 * security reasons, kept in `audit.security_event`, outside the hash-chained business ledger and a
 * tenant's business history. `detail` holds ids, names and codes only, never a value, a free-text
 * purpose or personal data (each string at most 128 characters; 2 KiB in all).
 */
export const SECURITY_EVENT_KINDS = [
  "rules.reveal.refused",
  "connector.retrieval.host_refused",
] as const;
export type SecurityEventKind = (typeof SECURITY_EVENT_KINDS)[number];
/** Keys and string values of a security event's `detail`. */
export const SECURITY_EVENT_DETAIL_KEY = /^[a-z][a-z0-9_]{0,31}$/;
export const SECURITY_EVENT_DETAIL_VALUE = /^[\x20-\x7E]{0,128}$/;

export interface SecurityEventInput {
  kind: SecurityEventKind;
  /** What was targeted, e.g. `decision` and its id; null when the target was not a valid id. */
  resourceType: string;
  resourceId: string | null;
  detail: Readonly<Record<string, string | number | boolean>>;
}

/**
 * A refused document-retrieval host (Udofin PR-UDF-072; R1-D-262; threat model §3.181): a
 * product refused to fetch a document's bytes because the retrieval URL a partner answered
 * (`DocumentRetrieval.url`, Ecosystem Specification §6.13) names a host outside its allow-list.
 */
export const RETRIEVAL_HOST_REFUSED_EVENT = "connector.retrieval.host_refused" as const;

/**
 * A refused host as it is recorded: a bare DNS name, lower case, labels of letters, digits and
 * hyphens (1 to 63, no hyphen at either end) joined by dots, no trailing dot, 1 to 128 characters
 * in all (the detail value limit). No scheme, userinfo, port, path, query or fragment can match,
 * so a URL, its query or a credential is never recorded. An IPv4 address matches; an IPv6
 * literal does not.
 */
export const RETRIEVAL_HOST_PATTERN =
  /^(?=.{1,128}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/**
 * The `detail` of `connector.retrieval.host_refused`, and nothing else (a strict object): the
 * partner's tenant, the document id and version as on `DocumentRetrieval` / `DocumentShared`,
 * and the refused host (`RETRIEVAL_HOST_PATTERN`).
 */
export const RetrievalHostRefusedDetail = z.strictObject({
  /** The partner (producer) tenant whose retrieval answer named the host. */
  partner_tenant_id: z.string().regex(TENANT_ID_REGEX),
  document_id: z.string().regex(/^[A-Za-z0-9_.:-]{3,128}$/),
  version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  host: z.string().regex(RETRIEVAL_HOST_PATTERN),
});
export type RetrievalHostRefusedDetail = z.infer<typeof RetrievalHostRefusedDetail>;

/** The typed shape of a security event kind: its detail schema and what it targets. */
export interface SecurityEventShape {
  detail: z.ZodType<Readonly<Record<string, string | number | boolean>>>;
  /** The event's `resourceType`. */
  resourceType: string;
  /** The detail field the event's `resourceId` equals. */
  resourceIdField: string;
}

/**
 * Kinds with a typed detail (PR-UDF-072): a sink refuses an event of such a kind whose detail
 * fails the schema, or whose resource is not the one the shape names. `rules.reveal.refused`
 * keeps the generic detail rule only.
 */
export const SECURITY_EVENT_SHAPES: Readonly<
  Partial<Record<SecurityEventKind, SecurityEventShape>>
> = Object.freeze({
  [RETRIEVAL_HOST_REFUSED_EVENT]: Object.freeze({
    detail: RetrievalHostRefusedDetail,
    resourceType: "document",
    resourceIdField: "document_id",
  }),
});

/**
 * Why `event` does not fit its kind's typed shape, or null when it fits or its kind has none.
 * The reason names fields only, never a value.
 */
export function securityEventShapeProblem(event: SecurityEventInput): string | null {
  const shape = SECURITY_EVENT_SHAPES[event.kind];
  if (!shape) return null;
  const r = shape.detail.safeParse(event.detail);
  if (!r.success) {
    const named = new Set<string>();
    for (const i of r.error.issues) {
      if (i.code === "unrecognized_keys") for (const k of i.keys) named.add(k);
      else if (i.path.length > 0) named.add(i.path.map(String).join("."));
    }
    const fields = [...named].filter((f) => SECURITY_EVENT_DETAIL_KEY.test(f));
    return `${event.kind} detail is not valid${fields.length > 0 ? ` (${fields.join(", ")})` : ""}`;
  }
  if (event.resourceType !== shape.resourceType)
    return `${event.kind} targets resource type ${shape.resourceType}`;
  if (event.resourceId !== r.data[shape.resourceIdField])
    return `${event.kind} resource id is the detail's ${shape.resourceIdField}`;
  return null;
}

/**
 * The security event for a refused retrieval host (PR-UDF-072), checked: target `document` and
 * the document id, detail exactly `{ partner_tenant_id, document_id, version, host }`. Throws a
 * RangeError naming the bad fields (never their values) when the detail does not fit.
 */
export function retrievalHostRefusedEvent(detail: RetrievalHostRefusedDetail): SecurityEventInput {
  const d: unknown = detail;
  const documentId =
    typeof d === "object" &&
    d !== null &&
    typeof (d as { document_id?: unknown }).document_id === "string"
      ? (d as { document_id: string }).document_id
      : null;
  const event: SecurityEventInput = {
    kind: RETRIEVAL_HOST_REFUSED_EVENT,
    resourceType: "document",
    resourceId: documentId,
    detail,
  };
  const problem = securityEventShapeProblem(event);
  if (problem) throw new RangeError(problem);
  return { ...event, detail: Object.freeze({ ...detail }) };
}

/**
 * The host to record for a refused retrieval URL: the URL's host name as the WHATWG URL parser
 * gives it (lower case, IDNs in punycode; userinfo, port, path, query and fragment dropped), one
 * trailing dot removed. Null when the text is not a URL or its host is not recordable (none, an
 * IPv6 literal, longer than 128 characters): refuse the fetch all the same.
 */
export function retrievalHostOf(url: string): string | null {
  if (typeof url !== "string" || url.length > 8192) return null;
  const u = URL.parse(url);
  if (!u) return null;
  const host = u.hostname.endsWith(".") ? u.hostname.slice(0, -1) : u.hostname;
  return RETRIEVAL_HOST_PATTERN.test(host) ? host : null;
}

/**
 * Records a security event for the context's principal in the context's tenant, in its own short
 * transaction, so a refusal is kept although the refused act rolls back. Writes no ledger row.
 */
export interface SecurityEventSink {
  record(
    ctx: Pick<KernelContext, "tenantId" | "principal" | "traceId">,
    event: SecurityEventInput,
  ): Promise<{ id: string }>;
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
  /**
   * Ordered approval levels (PR-LDC-38, owner answer #125): 1 to 5 levels decided in order. They
   * only tighten the action's rule: level 1's roles must be among the action's checker roles and it
   * needs at least the checkers the risk class asks for; every checker is a different person (never
   * the maker, an earlier checker or an agent); any rejection ends the request; the delay runs from
   * the last level's approval.
   */
  levels?: readonly ApprovalLevelInput[];
}

export interface ApprovalLevelInput {
  /** Roles that may decide at this level (any one); 1 to 16. */
  checkerRoles: readonly string[];
  /** Distinct checkers needed at this level, 1 to 3 (default 1). */
  checkers?: number;
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
