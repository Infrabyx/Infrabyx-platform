// `TallyAgentService`: enrolling, listing and revoking a tenant's TallyPrime agents (PR-FBX-46,
// R1-D-137, R1-D-178; threat model §3.121).
//
//   * `requestEnrolment` raises the R3 request `accounting.agent.enrol` through the tenancy
//     approvals engine (maker ≠ checker; ORG_CHECKER, ORG_ADMIN or ORG_OWNER check unless the
//     tenant's `mc.*` narrows it; an agent may not make it). Its executor creates the agent
//     `approved`, with no key and no code.
//   * `issueCode` gives an admin the one-time enrolment code once
//     (`tac1.<tenant>.<agent>.<secret>`, 256 random bits); the platform keeps its SHA-256 and a
//     30-minute expiry only. Issuing again replaces the earlier code. The ledger never sees a code.
//   * The agent claims the code through `TallyAgentGateway` (activation), which revokes the
//     tenant's previous active agent in the same transaction: one active agent per tenant, keys
//     rotated by enrolling again.
//   * `revoke` (a tenant admin, or `PLT_SECURITY_OFFICER` in the tenant under break-glass): the
//     agent's next call is refused. `revoked` is final (database trigger).
//   * `sendKeyNotices` (a per-tenant scheduled job, owner answer #139 (1); R1-D-186): on day 80
//     and again on day 85 of an active agent's key, the tenant's administrators are notified
//     (`accounting.agent_key_expiring`), once each, in the transaction that records it.
import { IpbError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import {
  TALLY_AGENT_ENROL_ACTION,
  TALLY_AGENT_ID_REGEX,
  TALLY_AGENT_KEY_MAX_DAYS,
  TALLY_AGENT_KEY_NOTICE_CLASS,
  TALLY_AGENT_KEY_NOTICE_DAYS,
  TALLY_AGENT_KEY_WARN_DAYS,
  TALLY_ENROL_CODE_MINUTES,
  TallyCompany,
  type TallyAgentKeyNoticeDay,
  type TallyAgentState,
  type TallyAgentView,
  type TallyKeyProtection,
} from "@infrabyx/contracts/ports";
import { newId, randomBytes, sha256Hex, toBase64Url } from "@infrabyx/crypto";
import type { ApprovalRecord, ApprovalsEngine } from "@infrabyx/tenancy";
import { assertTenantCaller, iso, q } from "./shared.js";

const NAME = /^[\x20-\x7E]{1,80}$/;
const REASON = /^[\x20-\x7E]{1,200}$/;
/** Roles that may issue codes and revoke by default. */
export const TALLY_AGENT_ADMIN_ROLES = ["ORG_ADMIN", "ORG_OWNER"] as const;
const SECURITY_OFFICER = "PLT_SECURITY_OFFICER";
/** Most recipients of one notification (`NotificationRequest.to`). */
const MAX_RECIPIENTS = 1000;

/** The part of NOTIFY the key notices need (`NotifyService.enqueue`, in the caller's transaction). */
export interface TallyKeyNotify {
  enqueue(
    tx: Tx,
    n: {
      class: string;
      to: { ref: string }[];
      vars: Record<string, string>;
      deepLink: string;
      idempotencyKey: string;
    },
  ): Promise<unknown>;
}

export interface TallyAgentServiceOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  /** The tenancy approvals engine; the service registers `accounting.agent.enrol` on it. */
  approvals: ApprovalsEngine;
  /** Roles that may issue codes and revoke (default ORG_ADMIN, ORG_OWNER). */
  adminRoles?: readonly string[];
  /** Roles that may check the enrolment (default: the engine's tenant checkers). */
  checkerRoles?: readonly string[];
  /** NOTIFY, for the day-80 and day-85 key notices (`sendKeyNotices` needs it). */
  notify?: TallyKeyNotify;
  /** The product's deep link to an agent in its console (default `/settings/accounting/agents/{id}`). */
  agentLink?: (agentId: string) => string;
  now?: () => Date;
}

export interface TallyAgentRow {
  id: string;
  tenant_id: string;
  name: string;
  company: string;
  state: TallyAgentState;
  approval_id: string;
  requested_by: string;
  code_sha256: string | null;
  code_expires_at: Date | null;
  code_failures: number;
  public_jwk: { kty: "EC"; crv: "P-256"; x: string; y: string } | null;
  jkt: string | null;
  last_seq: string | number;
  last_poll_at: Date | null;
  agent_version: string | null;
  enrolled_at: Date | null;
  revoked_at: Date | null;
  key_protection: TallyKeyProtection | null;
  key_notice_day: number;
}

const DAY_MS = 86_400_000;
/** When an agent's key stops working (#136 (4)): enrolment plus `TALLY_AGENT_KEY_MAX_DAYS`. */
export const keyExpiresAt = (enrolledAt: Date | string): Date =>
  new Date(new Date(enrolledAt).getTime() + TALLY_AGENT_KEY_MAX_DAYS * DAY_MS);

/**
 * The key notice due for a key enrolled at `enrolledAt` when `sent` is the latest one sent: the
 * latest notice day reached and not yet sent, or null (none due, or the key has expired).
 */
export function keyNoticeDue(
  enrolledAt: Date | string,
  sent: number,
  now: Date,
): TallyAgentKeyNoticeDay | null {
  const age = now.getTime() - new Date(enrolledAt).getTime();
  if (age >= TALLY_AGENT_KEY_MAX_DAYS * DAY_MS) return null;
  let due: TallyAgentKeyNoticeDay | null = null;
  for (const d of TALLY_AGENT_KEY_NOTICE_DAYS) if (age >= d * DAY_MS && d > sent) due = d;
  return due;
}

/** Rolls back a key-notice transaction that found nothing due (a mutation must ledger). */
class NothingDue extends Error {}

const DEFAULT_AGENT_LINK = (agentId: string) => `/settings/accounting/agents/${agentId}`;

export const AGENT_COLUMNS = `id, tenant_id, name, company, state, approval_id, requested_by,
  code_sha256, code_expires_at, code_failures, public_jwk, jkt, last_seq, last_poll_at,
  agent_version, enrolled_at, revoked_at, key_protection, key_notice_day`;

export function toAgentView(r: TallyAgentRow, now: Date): TallyAgentView {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    company: r.company,
    state: r.state,
    keyThumbprint: r.jkt,
    lastPollAt: iso(r.last_poll_at),
    agentVersion: r.agent_version,
    enrolledAt: iso(r.enrolled_at),
    revokedAt: iso(r.revoked_at),
    keyProtection: r.enrolled_at ? (r.key_protection ?? "file") : null,
    keyExpiresAt: r.enrolled_at ? iso(keyExpiresAt(r.enrolled_at)) : null,
    rotationDue:
      r.state === "active" &&
      r.enrolled_at !== null &&
      now.getTime() >= new Date(r.enrolled_at).getTime() + TALLY_AGENT_KEY_WARN_DAYS * DAY_MS,
    keyNoticeDay: (TALLY_AGENT_KEY_NOTICE_DAYS as readonly number[]).includes(r.key_notice_day)
      ? (r.key_notice_day as TallyAgentKeyNoticeDay)
      : null,
    warnings: [
      ...(r.enrolled_at && (r.key_protection ?? "file") === "file"
        ? (["key_unencrypted"] as const)
        : []),
      ...(r.state === "active" && r.enrolled_at && now >= keyExpiresAt(r.enrolled_at)
        ? (["key_expired"] as const)
        : []),
    ],
    codeOutstanding:
      r.state === "approved" &&
      r.code_sha256 !== null &&
      r.code_expires_at !== null &&
      new Date(r.code_expires_at).getTime() > now.getTime(),
  };
}

export class TallyAgentService {
  constructor(private readonly o: TallyAgentServiceOptions) {
    o.approvals.register(TALLY_AGENT_ENROL_ACTION, {
      ...(o.checkerRoles ? { checkerRoles: o.checkerRoles } : {}),
      execute: (tx, payload, request) => this.executeEnrolment(tx, payload, request),
    });
  }

  private now(): Date {
    return this.o.now?.() ?? new Date();
  }

  private assertAdmin(ctx: KernelContext, what: string, o: { allowOfficer?: boolean } = {}): void {
    const officer = o.allowOfficer === true && ctx.principal.roles.includes(SECURITY_OFFICER);
    assertTenantCaller(ctx, what, { allowBreakGlass: officer });
    const roles = this.o.adminRoles ?? TALLY_AGENT_ADMIN_ROLES;
    if (!officer && !ctx.principal.roles.some((r) => roles.includes(r)))
      throw new IpbError("IPB-UX-011", {
        detail: `${what} needs one of ${roles.join(", ")}`,
        meta: { reason: "role" },
      });
  }

  /** Raise the R3 enrolment request; the agent exists once a checker approves it. */
  async requestEnrolment(
    ctx: KernelContext,
    input: { name: string; company: string },
  ): Promise<{ approvalId: string; agentId: string }> {
    assertTenantCaller(ctx, "enrol a TallyPrime agent");
    if (!NAME.test(input.name))
      throw new IpbError("IPB-UX-004", { detail: "an agent name is 1 to 80 printable characters" });
    const company = TallyCompany.safeParse(input.company);
    if (!company.success)
      throw new IpbError("IPB-UX-004", { detail: "a company is 1 to 120 characters, no controls" });
    const agentId = newId("tga");
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const { id } = await this.o.approvals.request(tx, {
          action: TALLY_AGENT_ENROL_ACTION,
          riskClass: "R3",
          payload: { agentId, name: input.name, company: company.data },
          payloadDataClass: "INTERNAL",
          summary: `Enrol TallyPrime agent "${input.name}" for company "${company.data}"`,
          diff: { before: null, after: { name: input.name, company: company.data } },
        });
        return { approvalId: id, agentId };
      },
      { action: TALLY_AGENT_ENROL_ACTION },
    );
  }

  private async executeEnrolment(
    tx: Tx,
    payload: Record<string, unknown>,
    request: ApprovalRecord,
  ): Promise<void> {
    const agentId = String(payload.agentId);
    const name = String(payload.name);
    const company = String(payload.company);
    if (!TALLY_AGENT_ID_REGEX.test(agentId) || !NAME.test(name))
      throw new IpbError("IPB-UX-004", { detail: "the enrolment payload is malformed" });
    await q(tx).query(
      `insert into connectors.tally_agent (id, tenant_id, name, company, approval_id, requested_by)
       values ($1, $2, $3, $4, $5, $6)`,
      [agentId, tx.ctx.tenantId, name, company, request.id, request.makerId],
    );
    await this.o.audit.record(tx, {
      action: "connectors.accounting.agent.enrol",
      resourceType: "connectors.tally_agent",
      resourceId: agentId,
      after: { state: "approved", name, company, approval_id: request.id },
    });
  }

  /** The one-time enrolment code, shown once (an `approved` agent only). */
  async issueCode(
    ctx: KernelContext,
    agentId: string,
  ): Promise<{ code: string; expiresAt: string }> {
    this.assertAdmin(ctx, "issue an agent enrolment code");
    if (!TALLY_AGENT_ID_REGEX.test(agentId))
      throw new IpbError("IPB-UX-004", { detail: "not an agent id" });
    const code = `tac1.${ctx.tenantId}.${agentId}.${toBase64Url(randomBytes(32))}`;
    const expiresAt = new Date(this.now().getTime() + TALLY_ENROL_CODE_MINUTES * 60_000);
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await q(tx).query<{ state: TallyAgentState }>(
          "select state from connectors.tally_agent where id = $1 for update",
          [agentId],
        );
        const state = r.rows[0]?.state;
        if (!state) throw new IpbError("IPB-UX-004", { detail: `no agent ${agentId}` });
        if (state !== "approved")
          throw new IpbError("IPB-UX-004", {
            detail: `a code is issued only to an approved agent; this one is ${state}`,
            meta: { reason: "state" },
          });
        await q(tx).query(
          `update connectors.tally_agent
              set code_sha256 = $2, code_expires_at = $3, code_failures = 0, code_issued_by = $4
            where id = $1`,
          [agentId, sha256Hex(code), expiresAt.toISOString(), ctx.principal.id],
        );
        await this.o.audit.record(tx, {
          action: "connectors.accounting.agent.code",
          resourceType: "connectors.tally_agent",
          resourceId: agentId,
          after: { expires_at: expiresAt.toISOString() },
        });
      },
      { action: "connectors.accounting.agent.code" },
    );
    return { code, expiresAt: expiresAt.toISOString() };
  }

  /** Revoke an agent: its next call is refused; final. */
  async revoke(ctx: KernelContext, agentId: string, reason: string): Promise<TallyAgentView> {
    this.assertAdmin(ctx, "revoke a TallyPrime agent", { allowOfficer: true });
    if (!TALLY_AGENT_ID_REGEX.test(agentId))
      throw new IpbError("IPB-UX-004", { detail: "not an agent id" });
    if (!REASON.test(reason))
      throw new IpbError("IPB-UX-004", { detail: "a reason is 1 to 200 printable characters" });
    const row = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await q(tx).query<TallyAgentRow>(
          `select ${AGENT_COLUMNS} from connectors.tally_agent where id = $1 for update`,
          [agentId],
        );
        const a = r.rows[0];
        if (!a) throw new IpbError("IPB-UX-004", { detail: `no agent ${agentId}` });
        if (a.state === "revoked")
          throw new IpbError("IPB-UX-004", {
            detail: "the agent is already revoked",
            meta: { reason: "state" },
          });
        const u = await q(tx).query<TallyAgentRow>(
          `update connectors.tally_agent
              set state = 'revoked', revoked_at = now(), revoked_by = $2, revoke_reason = $3,
                  code_sha256 = null, code_expires_at = null
            where id = $1 returning ${AGENT_COLUMNS}`,
          [agentId, ctx.principal.id, reason],
        );
        await this.o.audit.record(tx, {
          action: "connectors.accounting.agent.revoke",
          resourceType: "connectors.tally_agent",
          resourceId: agentId,
          before: { state: a.state },
          after: { state: "revoked", reason },
        });
        return u.rows[0]!;
      },
      { action: "connectors.accounting.agent.revoke" },
    );
    return toAgentView(row, this.now());
  }

  /**
   * The key notices of one tenant (owner answer #139 (1)): run it daily or more often per tenant,
   * for example through `TenantSweep.run` from `@infrabyx/tenancy`, as the job's own service
   * principal. For each active agent whose key reached day 80 or 85 and has not had that notice,
   * the tenant's active administrators (`adminRoles`) are notified once, the notice is recorded
   * on the agent and ledgered in the same transaction; a tenant with nothing due writes nothing.
   */
  async sendKeyNotices(ctx: KernelContext): Promise<{ notified: number }> {
    assertTenantCaller(ctx, "send TallyPrime agent key notices", { allowService: true });
    const notify = this.o.notify;
    if (!notify)
      throw new IpbError("IPB-UX-004", {
        detail: "TallyAgentService needs `notify` to send key notices",
        meta: { reason: "notify_missing" },
      });
    const now = this.now();
    const candidates = await this.o.kernel.read(ctx, (tx) =>
      q(tx).query<{ id: string; enrolled_at: Date; key_notice_day: number }>(
        `select id, enrolled_at, key_notice_day from connectors.tally_agent
          where state = 'active' and enrolled_at is not null and enrolled_at <= $1
            and key_notice_day < $2
          order by enrolled_at limit 200`,
        [
          new Date(now.getTime() - TALLY_AGENT_KEY_NOTICE_DAYS[0] * DAY_MS).toISOString(),
          TALLY_AGENT_KEY_NOTICE_DAYS[TALLY_AGENT_KEY_NOTICE_DAYS.length - 1],
        ],
      ),
    );
    const roles = [...(this.o.adminRoles ?? TALLY_AGENT_ADMIN_ROLES)];
    const link = this.o.agentLink ?? DEFAULT_AGENT_LINK;
    let notified = 0;
    for (const c of candidates.rows) {
      if (keyNoticeDue(c.enrolled_at, c.key_notice_day, now) === null) continue;
      const sent = await this.o.kernel
        .mutate(
          ctx,
          async (tx) => {
            const r = await q(tx).query<TallyAgentRow>(
              `select ${AGENT_COLUMNS} from connectors.tally_agent where id = $1 for update`,
              [c.id],
            );
            const a = r.rows[0];
            const day =
              a && a.state === "active" && a.enrolled_at
                ? keyNoticeDue(a.enrolled_at, a.key_notice_day, now)
                : null;
            if (!a || day === null) throw new NothingDue();
            const admins = await q(tx).query<{ user_id: string }>(
              `select m.user_id from tenancy.membership m
               join tenancy.user u on u.id = m.user_id
              where u.status = 'active' and m.roles && $1::text[]
              order by m.user_id limit ${MAX_RECIPIENTS}`,
              [roles],
            );
            const expires = keyExpiresAt(a.enrolled_at!).toISOString();
            if (admins.rows.length > 0)
              await notify.enqueue(tx, {
                class: TALLY_AGENT_KEY_NOTICE_CLASS,
                to: admins.rows.map((x) => ({ ref: x.user_id })),
                vars: {
                  id: a.id,
                  name: a.name,
                  day: String(day),
                  expires_on: expires.slice(0, 10),
                },
                deepLink: link(a.id),
                idempotencyKey: `${TALLY_AGENT_KEY_NOTICE_CLASS}:${a.id}:${day}`,
              });
            await q(tx).query(
              "update connectors.tally_agent set key_notice_day = $2 where id = $1",
              [a.id, day],
            );
            await this.o.audit.record(tx, {
              action: "connectors.accounting.agent.key_notice",
              resourceType: "connectors.tally_agent",
              resourceId: a.id,
              before: { key_notice_day: a.key_notice_day },
              after: {
                key_notice_day: day,
                recipients: admins.rows.length,
                key_expires_at: expires,
              },
            });
            return true;
          },
          { action: "connectors.accounting.agent.key_notice" },
        )
        .catch((e: unknown) => {
          if (e instanceof NothingDue) return false;
          throw e;
        });
      if (sent) notified += 1;
    }
    return { notified };
  }

  async list(ctx: KernelContext): Promise<TallyAgentView[]> {
    const r = await this.o.kernel.read(ctx, (tx) =>
      q(tx).query<TallyAgentRow>(
        `select ${AGENT_COLUMNS} from connectors.tally_agent order by created_at desc limit 200`,
      ),
    );
    const now = this.now();
    return r.rows.map((x) => toAgentView(x, now));
  }

  async get(ctx: KernelContext, agentId: string): Promise<TallyAgentView | null> {
    if (!TALLY_AGENT_ID_REGEX.test(agentId)) return null;
    const r = await this.o.kernel.read(ctx, (tx) =>
      q(tx).query<TallyAgentRow>(
        `select ${AGENT_COLUMNS} from connectors.tally_agent where id = $1`,
        [agentId],
      ),
    );
    return r.rows[0] ? toAgentView(r.rows[0], this.now()) : null;
  }
}
