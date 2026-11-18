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
import { IpbError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import {
  TALLY_AGENT_ENROL_ACTION,
  TALLY_AGENT_ID_REGEX,
  TALLY_ENROL_CODE_MINUTES,
  TallyCompany,
  type TallyAgentState,
  type TallyAgentView,
} from "@infrabyx/contracts/ports";
import { newId, randomBytes, sha256Hex, toBase64Url } from "@infrabyx/crypto";
import type { ApprovalRecord, ApprovalsEngine } from "@infrabyx/tenancy";
import { assertTenantCaller, iso, q } from "./shared.js";

const NAME = /^[\x20-\x7E]{1,80}$/;
const REASON = /^[\x20-\x7E]{1,200}$/;
/** Roles that may issue codes and revoke by default. */
export const TALLY_AGENT_ADMIN_ROLES = ["ORG_ADMIN", "ORG_OWNER"] as const;
const SECURITY_OFFICER = "PLT_SECURITY_OFFICER";

export interface TallyAgentServiceOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  /** The tenancy approvals engine; the service registers `accounting.agent.enrol` on it. */
  approvals: ApprovalsEngine;
  /** Roles that may issue codes and revoke (default ORG_ADMIN, ORG_OWNER). */
  adminRoles?: readonly string[];
  /** Roles that may check the enrolment (default: the engine's tenant checkers). */
  checkerRoles?: readonly string[];
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
}

export const AGENT_COLUMNS = `id, tenant_id, name, company, state, approval_id, requested_by,
  code_sha256, code_expires_at, code_failures, public_jwk, jkt, last_seq, last_poll_at,
  agent_version, enrolled_at, revoked_at`;

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
