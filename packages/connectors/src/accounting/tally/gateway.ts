// `TallyAgentGateway`: the agent API (PR-FBX-46, R1-D-137, R1-D-178; threat model §3.121), as a
// framework-free handler the product mounts under its own API (IPB-12):
//
//   POST /v1/accounting/agent/enrol               claim an enrolment code with a public key
//   GET  /v1/accounting/agent/jobs                long poll for the next job (one in flight)
//   POST /v1/accounting/agent/jobs/{jobId}/result report a job's result, once
//
// Enrolment needs the one-time code only; every other call carries
// `Authorization: IPB-Agent <detached JWS>` and `IPB-Agent-Seq: <n>`. The proof's `kid` names
// `<tenant>/<agent>`; the agent must be active, its tenant must have `int.accounting.tally.enabled`
// on, and the proof must verify under the agent's stored key (`verifyAgentRequest`, the C-22
// profile) with a `seq` above its last one, stored in the same statement as `svc_tally_poll`.
// Refusals answer a problem document that does not say which check failed.
import { PortError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel } from "@infrabyx/contracts/kernel";
import {
  AgentEnrolRequest,
  AgentJobResult,
  TALLY_AGENT_API,
  TALLY_AGENT_AUTH_SCHEME,
  TALLY_AGENT_ID_REGEX,
  TALLY_AGENT_LEASE_MINUTES,
  TALLY_AGENT_MAX_BODY_BYTES,
  TALLY_AGENT_ROLE,
  TALLY_ENROL_MAX_FAILURES,
  TALLY_POLL_TIMEOUT_SECONDS,
  TALLY_READ_ID_REGEX,
  parseEnrolCode,
  type AgentJob,
  type AgentJobResult as AgentJobResultT,
  type JournalBatch,
} from "@infrabyx/contracts/ports";
import { TENANT_ID_REGEX } from "@infrabyx/contracts/ids";
import {
  agentRequestKid,
  jwkThumbprint,
  sha256Matches,
  verifyAgentRequest,
  type AgentJwk,
} from "@infrabyx/crypto";
import type { PoolLike } from "@infrabyx/tenancy";
import { AGENT_COLUMNS, keyExpiresAt, type TallyAgentRow } from "./agents.js";
import { ADAPTER, PORT, q } from "./shared.js";

/** The database role of the poll path (connectors/0007). */
export const TALLY_POLL_DB_ROLE = "svc_tally_poll";
const ENROL_MAX_BYTES = 8 * 1024;
const RESULT_PATH = /^\/v1\/accounting\/agent\/jobs\/([A-Za-z0-9_.:-]{8,128})\/result$/;
const SEQ = /^[1-9][0-9]{0,15}$/;

export interface AgentHttpRequest {
  method: string;
  /** The path as received, without the query. */
  path: string;
  /** Header names in lower case. */
  headers: Readonly<Record<string, string | undefined>>;
  body: Uint8Array;
  /** Aborts a long poll when the client goes away. */
  signal?: AbortSignal;
}

export interface AgentHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface TallyAgentGatewayOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  /** The pool the kernel uses; the poll path runs on it as `svc_tally_poll`. */
  pool: PoolLike;
  /** The tenant's `int.accounting.tally.enabled` (off by default). */
  enabled: (tenantId: string) => Promise<boolean> | boolean;
  /** `int.accounting.tally.poll_timeout_seconds` (default 25). */
  pollTimeoutSeconds?: () => Promise<number> | number;
  /** How often a long poll looks for work, in milliseconds (default 1000). */
  pollIntervalMs?: number;
  now?: () => Date;
}

const json = (status: number, body: unknown): AgentHttpResponse => ({
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
  body: JSON.stringify(body),
});
const problem = (status: number, title: string, detail?: string): AgentHttpResponse => ({
  status,
  headers: { "content-type": "application/problem+json", "cache-control": "no-store" },
  body: JSON.stringify({ type: "about:blank", title, status, ...(detail ? { detail } : {}) }),
});

/**
 * What an agent whose key expired is told (owner answer #139 (1)): plainly, how to re-enrol. Only
 * an agent whose proof verified gets it, so it reveals nothing to anyone else.
 */
export function keyExpiredDetail(expiredAt: Date): string {
  return (
    `This agent's key expired on ${expiredAt.toISOString().slice(0, 10)}, 90 days after it was ` +
    "enrolled, so the platform refuses it. To re-enrol: (1) an administrator of your " +
    "organisation asks for a new TallyPrime agent in the product, and a second person approves " +
    "it; (2) the administrator issues a one-time enrolment code, valid for 30 minutes; (3) put " +
    "the code in the file enrol-code in this agent's state directory. The agent enrols again by " +
    "itself, without a restart, and the old key is revoked. Postings wait until then. See the " +
    "TallyPrime agent runbook, section 3."
  );
}
const UNAUTHORISED = () => problem(401, "agent request not authenticated");

interface Authed {
  ctx: KernelContext;
  agent: TallyAgentRow;
}

/** The service context an agent's calls run under in its own tenant. */
export function agentContext(tenantId: string, agentId: string): KernelContext {
  return {
    tenantId,
    principal: { id: agentId, type: "service", roles: [TALLY_AGENT_ROLE] },
  };
}

export class TallyAgentGateway {
  constructor(private readonly o: TallyAgentGatewayOptions) {}

  private now(): Date {
    return this.o.now?.() ?? new Date();
  }

  private async pollTimeout(): Promise<number> {
    const v = Math.trunc(
      Number((await this.o.pollTimeoutSeconds?.()) ?? TALLY_POLL_TIMEOUT_SECONDS.default),
    );
    return Math.min(Math.max(v, TALLY_POLL_TIMEOUT_SECONDS.min), TALLY_POLL_TIMEOUT_SECONDS.max);
  }

  async handle(req: AgentHttpRequest): Promise<AgentHttpResponse> {
    try {
      if (req.path === TALLY_AGENT_API.enrol) {
        if (req.method !== "POST") return problem(405, "method not allowed");
        return await this.enrol(req);
      }
      if (req.path === TALLY_AGENT_API.jobs) {
        if (req.method !== "GET") return problem(405, "method not allowed");
        const a = await this.authenticate(req);
        if ("status" in a) return a;
        return await this.nextJob(a, req.signal);
      }
      const m = RESULT_PATH.exec(req.path);
      if (m) {
        if (req.method !== "POST") return problem(405, "method not allowed");
        if (req.body.byteLength > TALLY_AGENT_MAX_BODY_BYTES) return problem(413, "too large");
        const a = await this.authenticate(req);
        if ("status" in a) return a;
        return await this.result(a, m[1]!, req.body);
      }
      return problem(404, "not found");
    } catch (e) {
      if (e instanceof SyntaxError) return problem(400, "malformed request");
      throw e;
    }
  }

  // ---- enrolment ---------------------------------------------------------------------------

  private async enrol(req: AgentHttpRequest): Promise<AgentHttpResponse> {
    if (req.body.byteLength > ENROL_MAX_BYTES) return problem(413, "too large");
    const parsed = AgentEnrolRequest.safeParse(JSON.parse(new TextDecoder().decode(req.body)));
    if (!parsed.success) return problem(400, "malformed request");
    const code = parseEnrolCode(parsed.data.code)!;
    const ctx = agentContext(code.tenantId, code.agentId);
    const jwk = parsed.data.jwk as AgentJwk;
    const jkt = jwkThumbprint(jwk);
    const keyProtection = parsed.data.keyProtection ?? "file";
    const out = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await q(tx).query<TallyAgentRow>(
          `select ${AGENT_COLUMNS} from connectors.tally_agent where id = $1 for update`,
          [code.agentId],
        );
        const a = r.rows[0];
        const live =
          a?.state === "approved" &&
          a.code_sha256 !== null &&
          a.code_expires_at !== null &&
          new Date(a.code_expires_at).getTime() > this.now().getTime() &&
          a.code_failures < TALLY_ENROL_MAX_FAILURES;
        if (!a || !live) {
          // Nothing to change, but the attempt is still on the record.
          await this.o.audit.record(tx, {
            action: "connectors.accounting.agent.enrol_refused",
            resourceType: "connectors.tally_agent",
            resourceId: code.agentId,
            after: { reason: !a ? "unknown" : a.state !== "approved" ? "state" : "code" },
          });
          return null;
        }
        if (!sha256Matches(parsed.data.code, a.code_sha256!)) {
          await q(tx).query(
            "update connectors.tally_agent set code_failures = code_failures + 1 where id = $1",
            [a.id],
          );
          await this.o.audit.record(tx, {
            action: "connectors.accounting.agent.enrol_refused",
            resourceType: "connectors.tally_agent",
            resourceId: a.id,
            after: { reason: "code", failures: a.code_failures + 1 },
          });
          return null;
        }
        const prev = await q(tx).query<{ id: string }>(
          `update connectors.tally_agent
              set state = 'revoked', revoked_at = now(), revoked_by = $1,
                  revoke_reason = 'replaced by a new enrolment'
            where state = 'active' and id <> $1 returning id`,
          [a.id],
        );
        await q(tx).query(
          `update connectors.tally_agent
              set state = 'active', public_jwk = $2::jsonb, jkt = $3, enrolled_at = now(),
                  agent_version = $4, code_sha256 = null, code_expires_at = null, last_seq = 0,
                  key_protection = $5
            where id = $1`,
          [a.id, JSON.stringify(jwk), jkt, parsed.data.agentVersion, keyProtection],
        );
        await this.o.audit.record(tx, {
          action: "connectors.accounting.agent.activate",
          resourceType: "connectors.tally_agent",
          resourceId: a.id,
          before: { state: "approved" },
          after: {
            state: "active",
            key_thumbprint: jkt,
            agent_version: parsed.data.agentVersion,
            // #136 (4): a key kept in a plain file is on the record as a warning.
            key_protection: keyProtection,
            ...(keyProtection === "file" ? { warning: "key_unencrypted" } : {}),
            replaced: prev.rows.map((x) => x.id),
          },
        });
        return { company: a.company };
      },
      { action: "connectors.accounting.agent.activate" },
    );
    if (!out) return UNAUTHORISED();
    return json(200, {
      agentId: code.agentId,
      tenantId: code.tenantId,
      company: out.company,
      pollTimeoutSeconds: await this.pollTimeout(),
    });
  }

  // ---- authentication ----------------------------------------------------------------------

  private async authenticate(req: AgentHttpRequest): Promise<Authed | AgentHttpResponse> {
    const auth = req.headers.authorization ?? "";
    const seqHeader = req.headers["ipb-agent-seq"] ?? "";
    const prefix = `${TALLY_AGENT_AUTH_SCHEME} `;
    if (!auth.startsWith(prefix) || !SEQ.test(seqHeader)) return UNAUTHORISED();
    const jws = auth.slice(prefix.length).trim();
    const seq = Number(seqHeader);
    if (!Number.isSafeInteger(seq)) return UNAUTHORISED();
    const kid = agentRequestKid(jws);
    const [tenantId, agentId, extra] = (kid ?? "").split("/");
    if (
      extra !== undefined ||
      !tenantId ||
      !agentId ||
      !TENANT_ID_REGEX.test(tenantId) ||
      !TALLY_AGENT_ID_REGEX.test(agentId)
    )
      return UNAUTHORISED();
    const ctx = agentContext(tenantId, agentId);
    const r = await this.o.kernel.read(ctx, (tx) =>
      q(tx).query<TallyAgentRow>(
        `select ${AGENT_COLUMNS} from connectors.tally_agent where id = $1`,
        [agentId],
      ),
    );
    const agent = r.rows[0];
    if (!agent || agent.state === "approved" || !agent.public_jwk) return UNAUTHORISED();
    const v = await verifyAgentRequest(
      jws,
      { tenant: tenantId, agent: agentId, method: req.method, path: req.path, body: req.body },
      {
        key: agent.public_jwk,
        expectedKid: `${tenantId}/${agentId}`,
        seq,
        now: this.now(),
        // The `jti` is single-use because `seq` only grows: the claim stores `seq` and refuses
        // one at or below the agent's last (one running copy per enrolment).
        // A revoked agent's row is final: its proof is still verified (so the answer reveals
        // nothing to a forger) but its `seq` is not stored.
        replay: {
          claim: () =>
            agent.state === "revoked"
              ? Promise.resolve(true)
              : this.claimSeq(tenantId, agentId, seq),
        },
      },
    );
    if (!v.ok) return UNAUTHORISED();
    if (agent.state === "revoked") return problem(403, "agent revoked");
    // #136 (4): a key lives 90 days from its enrolment; then the agent must be enrolled again.
    if (agent.enrolled_at && this.now() >= keyExpiresAt(agent.enrolled_at))
      return problem(
        403,
        "agent key expired: enrol the agent again",
        keyExpiredDetail(keyExpiresAt(agent.enrolled_at)),
      );
    if (!(await this.o.enabled(tenantId))) return problem(403, "TallyPrime is off for this tenant");
    return { ctx, agent };
  }

  /** Stores `seq` (and the poll time) if it is above the agent's last; the replay check. */
  private async claimSeq(tenantId: string, agentId: string, seq: number): Promise<boolean> {
    const client = await this.o.pool.connect();
    try {
      await client.query("begin");
      await client.query(`set local role ${TALLY_POLL_DB_ROLE}`);
      await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
      const r = await client.query(
        `update connectors.tally_agent set last_seq = $2, last_poll_at = now()
          where id = $1 and state = 'active' and last_seq < $2`,
        [agentId, seq],
      );
      await client.query("commit");
      return (r.rowCount ?? 0) === 1;
    } catch (e) {
      await client.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  // ---- jobs --------------------------------------------------------------------------------

  private async nextJob(a: Authed, signal?: AbortSignal): Promise<AgentHttpResponse> {
    const deadline = this.now().getTime() + (await this.pollTimeout()) * 1000;
    const interval = Math.max(this.o.pollIntervalMs ?? 1000, 10);
    for (;;) {
      const job = await this.claim(a);
      if (job) return json(200, { job });
      if (signal?.aborted || this.now().getTime() + interval > deadline)
        return json(200, { job: null });
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  /**
   * The job the agent holds (a restart lost it), else the oldest trial-balance read, else the
   * oldest pending posting whose lease is free, claimed for 10 minutes. One in flight per agent.
   */
  private async claim(a: Authed): Promise<AgentJob | null> {
    const company = a.agent.company;
    const held = await this.o.kernel.read(a.ctx, async (tx) => {
      const j = await q(tx).query<JournalRow>(
        `select journal_id, batch, attempts, claimed_attempt from connectors.tally_journal
          where state = 'PENDING' and claimed_by = $1 and lease_until > now()
          order by queued_at limit 1`,
        [a.agent.id],
      );
      if (j.rows[0]) return j.rows[0];
      return null;
    });
    if (held) return postJob(held, company, held.claimed_attempt ?? held.attempts);
    const heldRead = await this.o.kernel.read(a.ctx, (tx) =>
      q(tx).query<ReadRow>(
        `select id, as_of::text as as_of, attempt from connectors.tally_read
          where state = 'claimed' and claimed_by = $1 and lease_until > now() limit 1`,
        [a.agent.id],
      ),
    );
    if (heldRead.rows[0]) return readJob(heldRead.rows[0], company);
    // Look before claiming, so a poll that finds nothing opens no mutation (and writes no
    // ledger row); a claim lost to another poll in between is ledgered as such.
    const waiting = await this.o.kernel.read(a.ctx, (tx) =>
      q(tx).query<{ n: number }>(
        `select ((select count(*) from (select 1 from connectors.tally_read
                    where state = 'queued' or (state = 'claimed' and lease_until <= now()) limit 1) r)
               + (select count(*) from (select 1 from connectors.tally_journal
                    where state = 'PENDING' and (claimed_by is null or lease_until <= now()) limit 1) j))::int as n`,
      ),
    );
    if (!waiting.rows[0]?.n) return null;
    const lease = `${TALLY_AGENT_LEASE_MINUTES} minutes`;
    return this.o.kernel.mutate(
      a.ctx,
      async (tx) => {
        const read = await q(tx).query<ReadRow>(
          `update connectors.tally_read r set state = 'claimed', claimed_by = $1,
                  lease_until = now() + $2::interval,
                  attempt = case when r.state = 'claimed' then r.attempt + 1 else r.attempt end
            where id = (select id from connectors.tally_read
                         where state = 'queued' or (state = 'claimed' and lease_until <= now())
                         order by created_at limit 1 for update skip locked)
            returning id, as_of::text as as_of, attempt`,
          [a.agent.id, lease],
        );
        if (read.rows[0]) {
          await this.o.audit.record(tx, {
            action: "connectors.accounting.read_claim",
            resourceType: "connectors.tally_read",
            resourceId: read.rows[0].id,
            after: { agent: a.agent.id, as_of: read.rows[0].as_of },
          });
          return readJob(read.rows[0], company);
        }
        const j = await q(tx).query<JournalRow>(
          `update connectors.tally_journal t set claimed_by = $1, claimed_attempt = t.attempts,
                  lease_until = now() + $2::interval
            where (t.tenant_id, t.journal_id) = (
                    select tenant_id, journal_id from connectors.tally_journal
                     where state = 'PENDING' and (claimed_by is null or lease_until <= now())
                     order by queued_at limit 1 for update skip locked)
            returning journal_id, batch, attempts, claimed_attempt`,
          [a.agent.id, lease],
        );
        const row = j.rows[0];
        if (!row) {
          await this.o.audit.record(tx, {
            action: "connectors.accounting.claim_lost",
            resourceType: "connectors.tally_agent",
            resourceId: a.agent.id,
            after: { reason: "another poll claimed the job first" },
          });
          return null;
        }
        await this.o.audit.record(tx, {
          action: "connectors.accounting.claim",
          resourceType: "connectors.tally_journal",
          resourceId: row.journal_id,
          after: { agent: a.agent.id, attempt: row.attempts },
        });
        return postJob(row, company, row.attempts);
      },
      { action: "connectors.accounting.claim" },
    );
  }

  private async result(a: Authed, jobId: string, body: Uint8Array): Promise<AgentHttpResponse> {
    const parsed = AgentJobResult.safeParse(JSON.parse(new TextDecoder().decode(body)));
    if (!parsed.success) return problem(400, "malformed result");
    const res = parsed.data;
    if (res.kind === "trial_balance") {
      if (!TALLY_READ_ID_REGEX.test(jobId)) return problem(400, "malformed result");
      return this.readResult(a, jobId, res);
    }
    if (TALLY_READ_ID_REGEX.test(jobId)) return problem(400, "malformed result");
    const ok = await this.o.kernel.mutate(
      a.ctx,
      async (tx) => {
        const r = await q(tx).query<JournalRow & { state: string; claimed_by: string | null }>(
          `select journal_id, batch, attempts, claimed_attempt, state, claimed_by
             from connectors.tally_journal where journal_id = $1 for update`,
          [jobId],
        );
        const j = r.rows[0];
        const refuse = async (reason: string, out: false | "bad") => {
          await this.o.audit.record(tx, {
            action: "connectors.accounting.result_refused",
            resourceType: "connectors.tally_journal",
            resourceId: jobId,
            after: { agent: a.agent.id, attempt: res.attempt, reason },
          });
          return out;
        };
        if (
          !j ||
          j.state !== "PENDING" ||
          j.claimed_by !== a.agent.id ||
          j.claimed_attempt !== res.attempt ||
          j.attempts !== res.attempt
        )
          return refuse("not_held", false);
        if (res.outcome === "acknowledged") {
          const refs = (j.batch as JournalBatch).entries.map((e) => e.reference).sort();
          const got = Object.keys(res.ledgerRefs).sort();
          if (refs.length !== got.length || refs.some((x, i) => x !== got[i]))
            return refuse("references", "bad");
          await q(tx).query(
            `update connectors.tally_journal
                set state = 'ACKNOWLEDGED', ledger_refs = $2::jsonb, reason_code = null,
                    reason = null, claimed_by = null, claimed_attempt = null, lease_until = null
              where journal_id = $1`,
            [jobId, JSON.stringify(res.ledgerRefs)],
          );
        } else {
          await q(tx).query(
            `update connectors.tally_journal
                set state = 'REJECTED', reason_code = $2, reason = $3, ledger_refs = null,
                    claimed_by = null, claimed_attempt = null, lease_until = null
              where journal_id = $1`,
            [jobId, res.reasonCode, res.reason],
          );
        }
        await this.o.audit.record(tx, {
          action: "connectors.accounting.result",
          resourceType: "connectors.tally_journal",
          resourceId: jobId,
          before: { state: "PENDING" },
          after: {
            state: res.outcome === "acknowledged" ? "ACKNOWLEDGED" : "REJECTED",
            agent: a.agent.id,
            attempt: res.attempt,
            ...(res.outcome === "acknowledged"
              ? { vouchers: Object.keys(res.ledgerRefs).length }
              : { reason_code: res.reasonCode }),
          },
        });
        return true;
      },
      { action: "connectors.accounting.result" },
    );
    if (ok === "bad") return problem(400, "the result does not name every voucher of the batch");
    if (!ok) return problem(409, "not the job this agent holds");
    return json(200, { accepted: true });
  }

  private async readResult(
    a: Authed,
    id: string,
    res: Extract<AgentJobResultT, { kind: "trial_balance" }>,
  ): Promise<AgentHttpResponse> {
    let debit = 0;
    let credit = 0;
    if (res.outcome === "done")
      for (const l of res.lines) {
        debit += l.debitPaise;
        credit += l.creditPaise;
      }
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit))
      return problem(400, "malformed result");
    const ok = await this.o.kernel.mutate(
      a.ctx,
      async (tx) => {
        const r = await q(tx).query<{ state: string; claimed_by: string | null; attempt: number }>(
          "select state, claimed_by, attempt from connectors.tally_read where id = $1 for update",
          [id],
        );
        const row = r.rows[0];
        if (
          !row ||
          row.state !== "claimed" ||
          row.claimed_by !== a.agent.id ||
          row.attempt !== res.attempt
        ) {
          await this.o.audit.record(tx, {
            action: "connectors.accounting.read_result_refused",
            resourceType: "connectors.tally_read",
            resourceId: id,
            after: { agent: a.agent.id, attempt: res.attempt, reason: "not_held" },
          });
          return false;
        }
        if (res.outcome === "done")
          await q(tx).query(
            `update connectors.tally_read
                set state = 'done', lines = $2::jsonb, total_debit = $3, total_credit = $4,
                    completed_at = now(), lease_until = null
              where id = $1`,
            [id, JSON.stringify(res.lines), debit, credit],
          );
        else
          await q(tx).query(
            `update connectors.tally_read
                set state = 'failed', reason_code = $2, completed_at = now(), lease_until = null
              where id = $1`,
            [id, res.reasonCode],
          );
        await this.o.audit.record(tx, {
          action: "connectors.accounting.read_result",
          resourceType: "connectors.tally_read",
          resourceId: id,
          after: {
            state: res.outcome,
            agent: a.agent.id,
            ...(res.outcome === "done"
              ? { ledgers: res.lines.length }
              : { reason_code: res.reasonCode }),
          },
        });
        return true;
      },
      { action: "connectors.accounting.read_result" },
    );
    if (!ok) return problem(409, "not the job this agent holds");
    return json(200, { accepted: true });
  }
}

interface JournalRow {
  journal_id: string;
  batch: unknown;
  attempts: number;
  claimed_attempt: number | null;
}
interface ReadRow {
  id: string;
  as_of: string;
  attempt: number;
}

const postJob = (j: JournalRow, company: string, attempt: number): AgentJob => ({
  kind: "post",
  jobId: j.journal_id,
  attempt,
  company,
  batch: j.batch as JournalBatch,
});
const readJob = (r: ReadRow, company: string): AgentJob => ({
  kind: "trial_balance",
  jobId: r.id,
  attempt: r.attempt,
  company,
  asOf: r.as_of,
});

/** Refuses a call the port cannot serve (used by the sink). */
export const portOff = (detail: string) =>
  new PortError("IPB-PORT-001", PORT, { adapter: ADAPTER, detail });
