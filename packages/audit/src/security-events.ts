// Security audit events (owner answer #132 (5); R1-D-187; `audit/0012`; threat model §3.130).
// Kinds: `rules.reveal.refused`, and `connector.retrieval.host_refused` (PR-UDF-072; R1-D-262;
// `audit/0013`; §3.181), whose detail is typed (`SECURITY_EVENT_SHAPES` in contracts/kernel).
//
// `PgSecurityEvents.record(ctx, event)` keeps one refused attempt (who, when, what, why) in
// `audit.security_event`, in its own short transaction as `svc_security_event`, a role that may
// only insert into that table under the tenant's RLS. So a refusal is kept although the refused
// act rolls back, and it writes no row in the hash-chained business ledger (IPB-02-51 unchanged)
// nor in a tenant's business history. `detail` takes ids, names and codes only: keys of
// [a-z0-9_], strings of printable ASCII up to 128 characters, numbers and booleans, 2 KiB in all;
// anything else is refused before the database is touched, so a value cannot slip in.
import { TENANT_ID_REGEX } from "@infrabyx/contracts/ids";
import {
  SECURITY_EVENT_DETAIL_KEY,
  SECURITY_EVENT_DETAIL_VALUE,
  SECURITY_EVENT_KINDS,
  securityEventShapeProblem,
  type KernelContext,
  type SecurityEventInput,
  type SecurityEventSink,
} from "@infrabyx/contracts/kernel";
import { newId } from "@infrabyx/crypto";

/** The database role a security event is written as (audit/0012). */
export const SECURITY_EVENT_DB_ROLE = "svc_security_event";

const ACTOR = /^[A-Za-z0-9_.:@/+=-]{1,255}$/;
const RESOURCE_TYPE = /^[a-z][a-z0-9_.]{0,63}$/;
const RESOURCE_ID = ACTOR;
const TRACE = /^[A-Za-z0-9-]{1,64}$/;
const ACTOR_TYPES = ["user", "service", "agent", "breakglass", "external"];
const MAX_DETAIL_BYTES = 2048;
const MAX_DETAIL_KEYS = 16;

interface Client {
  query(text: string, params?: readonly unknown[]): Promise<unknown>;
  release(): void;
}

export interface PgSecurityEventsOptions {
  /** The kernel's pool; its login may `set role svc_security_event` (granted to app_rw). */
  pool: { connect(): Promise<Client> };
}

function checkDetail(
  detail: SecurityEventInput["detail"],
): Record<string, string | number | boolean> {
  if (typeof detail !== "object" || detail === null || Array.isArray(detail))
    throw new RangeError("a security event's detail is an object");
  const out: Record<string, string | number | boolean> = {};
  const keys = Object.keys(detail);
  if (keys.length > MAX_DETAIL_KEYS)
    throw new RangeError(`a security event's detail has at most ${MAX_DETAIL_KEYS} keys`);
  for (const k of keys) {
    if (!SECURITY_EVENT_DETAIL_KEY.test(k))
      throw new RangeError(`security event detail key ${JSON.stringify(k)} is not allowed`);
    const v = detail[k];
    if (typeof v === "string") {
      if (!SECURITY_EVENT_DETAIL_VALUE.test(v))
        throw new RangeError(`security event detail ${k} is not a short printable id or code`);
    } else if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new RangeError(`security event detail ${k} is not finite`);
    } else if (typeof v !== "boolean")
      throw new RangeError(`security event detail ${k} is not a string, number or boolean`);
    out[k] = v;
  }
  if (Buffer.byteLength(JSON.stringify(out)) > MAX_DETAIL_BYTES)
    throw new RangeError(`a security event's detail is at most ${MAX_DETAIL_BYTES} bytes`);
  return out;
}

export class PgSecurityEvents implements SecurityEventSink {
  constructor(private readonly o: PgSecurityEventsOptions) {}

  async record(
    ctx: Pick<KernelContext, "tenantId" | "principal" | "traceId">,
    event: SecurityEventInput,
  ): Promise<{ id: string }> {
    if (!TENANT_ID_REGEX.test(ctx.tenantId)) throw new RangeError("invalid tenant id");
    if (!ACTOR.test(ctx.principal.id)) throw new RangeError("invalid principal id");
    if (!ACTOR_TYPES.includes(ctx.principal.type)) throw new RangeError("invalid principal type");
    if (!(SECURITY_EVENT_KINDS as readonly string[]).includes(event.kind))
      throw new RangeError(`unknown security event kind ${event.kind}`);
    if (!RESOURCE_TYPE.test(event.resourceType)) throw new RangeError("invalid resource type");
    if (event.resourceId !== null && !RESOURCE_ID.test(event.resourceId))
      throw new RangeError("invalid resource id");
    const detail = checkDetail(event.detail);
    // A kind with a typed detail (PR-UDF-072, `connector.retrieval.host_refused`) takes exactly
    // its schema's fields, and targets the resource its shape names.
    const problem = securityEventShapeProblem({ ...event, detail });
    if (problem) throw new RangeError(problem);
    const traceId = ctx.traceId !== undefined && TRACE.test(ctx.traceId) ? ctx.traceId : null;
    const id = newId("sev");
    const client = await this.o.pool.connect();
    let done = false;
    try {
      await client.query("begin");
      await client.query(`set local role ${SECURITY_EVENT_DB_ROLE}`);
      await client.query("select set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      await client.query(
        `insert into audit.security_event
           (id, tenant_id, actor_id, actor_type, kind, resource_type, resource_id, detail, trace_id)
         values ($1, current_setting('app.tenant_id', true), $2, $3, $4, $5, $6, $7::jsonb, $8)`,
        [
          id,
          ctx.principal.id,
          ctx.principal.type,
          event.kind,
          event.resourceType,
          event.resourceId,
          JSON.stringify(detail),
          traceId,
        ],
      );
      await client.query("commit");
      done = true;
      return { id };
    } finally {
      if (!done) await client.query("rollback").catch(() => undefined);
      client.release();
    }
  }
}
