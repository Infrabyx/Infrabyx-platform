// `TallyAccountingSink`, the TallyPrime adapter of the ACCOUNTING sink (PR-FBX-46, R1-D-137,
// R1-D-178; threat model §3.121). The adapter never reaches TallyPrime itself: `post` checks the
// batch (`assertBalancedBatch`), stores it with its canonical SHA-256 in
// `connectors.tally_journal` and answers `PENDING`; the tenant's agent claims it through
// `TallyAgentGateway`, posts it on the tenant's own network and reports the result, which
// `status` then answers. A trial balance is read the same way through `connectors.tally_read`,
// answered from a result under 10 minutes old.
//
//   * One batch per journal id: the same batch again answers its row; a changed batch under the
//     same id is `IPB-PORT-004` and never reaches the agent. An acknowledged batch is final.
//   * A posting no agent claims within `int.accounting.tally.job_expiry_days` is `REJECTED`
//     `agent_unreachable` (lazily on `status`, or by `expireStale` from the product's scheduler).
//   * Off unless the tenant's `int.accounting.tally.enabled` is on (`IPB-PORT-001`).
//   * The port's methods take no context: it is the tenancy context (`currentContext`), or the
//     `context` option.
import { IpbError, PortError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel } from "@infrabyx/contracts/kernel";
import {
  assertBalancedBatch,
  TALLY_AGENT_DEGRADED_MINUTES,
  TALLY_AGENT_DOWN_HOURS,
  TALLY_AGENT_MAX_BODY_BYTES,
  TALLY_JOB_EXPIRY_DAYS,
  TALLY_TRIAL_BALANCE_CACHE_MINUTES,
  type AccountingPostResult,
  type AccountingSinkPort,
  type AccountingState,
  type AdapterDescriptor,
  type JournalBatch,
  type PortHealth,
  type TallyReasonCode,
  type TrialBalance,
  type TrialBalanceLine,
} from "@infrabyx/contracts/ports";
import { canonicalDigest, canonicalize, newId } from "@infrabyx/crypto";
import { requireContext } from "@infrabyx/tenancy";
import { ADAPTER, PORT, assertTenantCaller, q, refused } from "./shared.js";

const JOURNAL_ID = /^[A-Za-z0-9_.:-]{8,128}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_WAIT_MS = 30_000;

export interface TallyAccountingSinkOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  /** The tenant's `int.accounting.tally.enabled` (off by default). */
  enabled: (tenantId: string) => Promise<boolean> | boolean;
  /** `int.accounting.tally.job_expiry_days` (default 7). */
  jobExpiryDays?: () => Promise<number> | number;
  /** How long `post` and `replay` wait for the agent's answer (default 0, at most 30 s). */
  awaitResultMs?: number;
  /** How long `trialBalance` waits for a fresh read (default 20 s, at most 30 s). */
  trialBalanceWaitMs?: number;
  /** How often a wait looks again, in milliseconds (default 250). */
  pollIntervalMs?: number;
  /** The caller's context (default: the tenancy context). */
  context?: () => KernelContext;
  now?: () => Date;
}

interface JournalRow {
  journal_id: string;
  digest: string;
  state: AccountingState;
  attempts: number;
  ledger_refs: Record<string, string> | null;
  reason_code: string | null;
  reason: string | null;
  claimed_by: string | null;
  queued_at: Date;
  updated_at: Date;
}
const JOURNAL_COLUMNS = `journal_id, digest, state, attempts, ledger_refs, reason_code, reason,
  claimed_by, queued_at, updated_at`;

const toResult = (r: JournalRow): AccountingPostResult => ({
  journalId: r.journal_id,
  digest: r.digest,
  state: r.state,
  ledgerRefs: r.ledger_refs,
  reasonCode: r.reason_code,
  reason: r.reason,
  attempts: r.attempts,
  updatedAt: new Date(r.updated_at).toISOString(),
});

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(Math.trunc(v), lo), hi);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TallyAccountingSink implements AccountingSinkPort {
  readonly descriptor: AdapterDescriptor = {
    port: PORT,
    adapter: ADAPTER,
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
  };

  constructor(private readonly o: TallyAccountingSinkOptions) {}

  private now(): Date {
    return this.o.now?.() ?? new Date();
  }
  private ctx(): KernelContext {
    return this.o.context?.() ?? requireContext();
  }
  private interval(): number {
    return clamp(this.o.pollIntervalMs ?? 250, 10, 5_000);
  }
  private async expiryDays(): Promise<number> {
    return clamp(
      Number((await this.o.jobExpiryDays?.()) ?? TALLY_JOB_EXPIRY_DAYS.default),
      TALLY_JOB_EXPIRY_DAYS.min,
      TALLY_JOB_EXPIRY_DAYS.max,
    );
  }
  private async assertOn(ctx: KernelContext): Promise<void> {
    if (!(await this.o.enabled(ctx.tenantId)))
      throw refused("IPB-PORT-001", "TallyPrime posting is off for this tenant", "disabled");
  }

  async health(): Promise<PortHealth> {
    const started = Date.now();
    const ctx = this.ctx();
    const r = await this.o.kernel.read(ctx, (tx) =>
      q(tx).query<{ last_poll_at: Date | null }>(
        "select last_poll_at from connectors.tally_agent where state = 'active'",
      ),
    );
    const last = r.rows[0]?.last_poll_at ? new Date(r.rows[0].last_poll_at) : null;
    const age = last ? this.now().getTime() - last.getTime() : Infinity;
    const status =
      age <= TALLY_AGENT_DEGRADED_MINUTES * 60_000
        ? "up"
        : age <= TALLY_AGENT_DOWN_HOURS * 3_600_000
          ? "degraded"
          : "down";
    return {
      status,
      latency_ms: Date.now() - started,
      checked_at: this.now().toISOString(),
      detail: {
        agent: r.rows.length ? "active" : "none",
        last_poll_at: last ? last.toISOString() : null,
      },
    };
  }

  async post(raw: JournalBatch): Promise<AccountingPostResult> {
    const ctx = this.ctx();
    assertTenantCaller(ctx, "post to the books", { allowService: true });
    const batch = assertBalancedBatch(PORT, raw);
    if (Buffer.byteLength(canonicalize(batch)) > TALLY_AGENT_MAX_BODY_BYTES)
      throw new PortError("IPB-UX-004", PORT, {
        adapter: ADAPTER,
        detail: `a TallyPrime batch is at most ${TALLY_AGENT_MAX_BODY_BYTES} bytes`,
      });
    await this.assertOn(ctx);
    const digest = canonicalDigest(batch);
    const row = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const prior = await q(tx).query<JournalRow>(
          `select ${JOURNAL_COLUMNS} from connectors.tally_journal where journal_id = $1 for update`,
          [batch.journalId],
        );
        const p = prior.rows[0];
        if (p) {
          if (p.digest !== digest)
            throw new PortError("IPB-PORT-004", PORT, {
              adapter: ADAPTER,
              detail: `journal ${batch.journalId} was posted with a different batch`,
            });
          // Nothing changes; the read is still on the record.
          await this.o.audit.record(tx, {
            action: "connectors.accounting.post_repeat",
            resourceType: "connectors.tally_journal",
            resourceId: batch.journalId,
            after: { digest, state: p.state },
          });
          return p;
        }
        const r = await q(tx).query<JournalRow>(
          `insert into connectors.tally_journal (tenant_id, journal_id, digest, batch, vouchers,
             state, posted_by)
           values ($1, $2, $3, $4::jsonb, $5, 'PENDING', $6) returning ${JOURNAL_COLUMNS}`,
          [
            ctx.tenantId,
            batch.journalId,
            digest,
            JSON.stringify(batch),
            batch.entries.length,
            `${batch.initiatedBy.type}:${batch.initiatedBy.id}`.slice(0, 200),
          ],
        );
        await this.o.audit.record(tx, {
          action: "connectors.accounting.post",
          resourceType: "connectors.tally_journal",
          resourceId: batch.journalId,
          after: {
            digest,
            vouchers: batch.entries.length,
            initiated_by: batch.initiatedBy.type,
            state: "PENDING",
          },
        });
        return r.rows[0]!;
      },
      { action: "connectors.accounting.post" },
    );
    return this.awaitSettled(ctx, toResult(row));
  }

  async status(journalId: string): Promise<AccountingPostResult> {
    const ctx = this.ctx();
    const row = await this.read(ctx, journalId);
    if (row.state === "PENDING" && !row.claimed_by && (await this.isExpired(row))) {
      await this.expire(ctx, [journalId]);
      return toResult(await this.read(ctx, journalId));
    }
    return toResult(row);
  }

  async replay(journalId: string): Promise<AccountingPostResult> {
    const ctx = this.ctx();
    assertTenantCaller(ctx, "replay a posting", { allowService: true });
    await this.assertOn(ctx);
    const row = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await q(tx).query<JournalRow>(
          `select ${JOURNAL_COLUMNS} from connectors.tally_journal where journal_id = $1 for update`,
          [journalId],
        );
        const j = r.rows[0];
        if (!j)
          throw new PortError("IPB-UX-004", PORT, {
            adapter: ADAPTER,
            detail: `no journal ${journalId}`,
          });
        if (j.state === "ACKNOWLEDGED")
          throw new PortError("IPB-PORT-003", PORT, {
            adapter: ADAPTER,
            detail: "an acknowledged batch is final and is never replayed",
          });
        const u = await q(tx).query<JournalRow>(
          `update connectors.tally_journal
              set state = 'PENDING', attempts = attempts + 1, reason_code = null, reason = null,
                  claimed_by = null, claimed_attempt = null, lease_until = null, queued_at = now()
            where journal_id = $1 returning ${JOURNAL_COLUMNS}`,
          [journalId],
        );
        await this.o.audit.record(tx, {
          action: "connectors.accounting.replay",
          resourceType: "connectors.tally_journal",
          resourceId: journalId,
          before: { state: j.state, attempts: j.attempts, reason_code: j.reason_code },
          after: { state: "PENDING", attempts: j.attempts + 1 },
        });
        return u.rows[0]!;
      },
      { action: "connectors.accounting.replay" },
    );
    return this.awaitSettled(ctx, toResult(row));
  }

  async trialBalance(asOf: string): Promise<TrialBalance> {
    const ctx = this.ctx();
    if (!ISO_DATE.test(asOf) || new Date(`${asOf}T00:00:00Z`).toISOString().slice(0, 10) !== asOf)
      throw new IpbError("IPB-UX-004", { detail: "asOf is a calendar date, YYYY-MM-DD" });
    await this.assertOn(ctx);
    const fresh = await this.freshRead(ctx, asOf);
    if (fresh) return fresh;
    const id = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const open = await q(tx).query<{ id: string }>(
          `select id from connectors.tally_read where as_of = $1 and state in ('queued', 'claimed')
            order by created_at limit 1`,
          [asOf],
        );
        if (open.rows[0]) {
          await this.o.audit.record(tx, {
            action: "connectors.accounting.read_repeat",
            resourceType: "connectors.tally_read",
            resourceId: open.rows[0].id,
            after: { as_of: asOf },
          });
          return open.rows[0].id;
        }
        const nid = newId("tbr");
        await q(tx).query(
          `insert into connectors.tally_read (id, tenant_id, as_of, requested_by)
           values ($1, $2, $3, $4)`,
          [nid, ctx.tenantId, asOf, ctx.principal.id],
        );
        await this.o.audit.record(tx, {
          action: "connectors.accounting.read",
          resourceType: "connectors.tally_read",
          resourceId: nid,
          after: { as_of: asOf, state: "queued" },
        });
        return nid;
      },
      { action: "connectors.accounting.read" },
    );
    const deadline =
      this.now().getTime() + clamp(this.o.trialBalanceWaitMs ?? 20_000, 0, MAX_WAIT_MS);
    for (;;) {
      const r = await this.o.kernel.read(ctx, (tx) =>
        q(tx).query<ReadRow>(`select ${READ_COLUMNS} from connectors.tally_read where id = $1`, [
          id,
        ]),
      );
      const row = r.rows[0];
      if (row?.state === "done") return toTrialBalance(row);
      if (row?.state === "failed")
        throw new PortError("IPB-PORT-002", PORT, {
          adapter: ADAPTER,
          detail: `the agent could not read the trial balance (${row.reason_code ?? "tally_error"})`,
        });
      if (this.now().getTime() + this.interval() > deadline)
        throw new PortError("IPB-PORT-002", PORT, {
          adapter: ADAPTER,
          detail: "no fresh trial balance from the agent within the wait",
        });
      await sleep(this.interval());
    }
  }

  /** Rejects `agent_unreachable` every posting no agent claimed within the expiry. */
  async expireStale(ctx: KernelContext): Promise<number> {
    const days = await this.expiryDays();
    const r = await this.o.kernel.read(ctx, (tx) =>
      q(tx).query<{ journal_id: string }>(
        `select journal_id from connectors.tally_journal
          where state = 'PENDING' and claimed_by is null
            and queued_at <= now() - make_interval(days => $1) order by queued_at limit 1000`,
        [days],
      ),
    );
    if (!r.rows.length) return 0;
    return this.expire(
      ctx,
      r.rows.map((x) => x.journal_id),
    );
  }

  // ---- internals -----------------------------------------------------------------------------

  private async read(ctx: KernelContext, journalId: string): Promise<JournalRow> {
    const r = JOURNAL_ID.test(journalId)
      ? await this.o.kernel.read(ctx, (tx) =>
          q(tx).query<JournalRow>(
            `select ${JOURNAL_COLUMNS} from connectors.tally_journal where journal_id = $1`,
            [journalId],
          ),
        )
      : { rows: [] };
    const row = r.rows[0];
    if (!row)
      throw new PortError("IPB-UX-004", PORT, {
        adapter: ADAPTER,
        detail: `no journal ${journalId}`,
      });
    return row;
  }

  private async isExpired(row: JournalRow): Promise<boolean> {
    const days = await this.expiryDays();
    return this.now().getTime() - new Date(row.queued_at).getTime() >= days * 86_400_000;
  }

  private async expire(ctx: KernelContext, ids: readonly string[]): Promise<number> {
    const days = await this.expiryDays();
    const reason: TallyReasonCode = "agent_unreachable";
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const u = await q(tx).query<{ journal_id: string }>(
          `update connectors.tally_journal
              set state = 'REJECTED', reason_code = $2,
                  reason = 'no agent took the batch before it expired'
            where journal_id = any($1::text[]) and state = 'PENDING' and claimed_by is null
              and queued_at <= now() - make_interval(days => $3)
            returning journal_id`,
          [ids, reason, days],
        );
        for (const r of u.rows)
          await this.o.audit.record(tx, {
            action: "connectors.accounting.expire",
            resourceType: "connectors.tally_journal",
            resourceId: r.journal_id,
            before: { state: "PENDING" },
            after: { state: "REJECTED", reason_code: reason, expiry_days: days },
          });
        if (!u.rows.length)
          await this.o.audit.record(tx, {
            action: "connectors.accounting.expire",
            resourceType: "connectors.tally_journal",
            resourceId: ids[0] ?? "none",
            after: { expired: 0 },
          });
        return u.rows.length;
      },
      { action: "connectors.accounting.expire" },
    );
  }

  private async awaitSettled(
    ctx: KernelContext,
    r: AccountingPostResult,
  ): Promise<AccountingPostResult> {
    const wait = clamp(this.o.awaitResultMs ?? 0, 0, MAX_WAIT_MS);
    if (r.state !== "PENDING" || wait === 0) return r;
    const deadline = this.now().getTime() + wait;
    for (;;) {
      if (this.now().getTime() + this.interval() > deadline) return r;
      await sleep(this.interval());
      const row = toResult(await this.read(ctx, r.journalId));
      if (row.state !== "PENDING" || row.attempts !== r.attempts) return row;
    }
  }

  private async freshRead(ctx: KernelContext, asOf: string): Promise<TrialBalance | null> {
    const r = await this.o.kernel.read(ctx, (tx) =>
      q(tx).query<ReadRow>(
        `select ${READ_COLUMNS} from connectors.tally_read
          where as_of = $1 and state = 'done' and completed_at > now() - make_interval(mins => $2)
            -- a posting acknowledged after the read makes it stale
            and completed_at > coalesce((select max(updated_at) from connectors.tally_journal
                                          where state = 'ACKNOWLEDGED'), '-infinity'::timestamptz)
          order by completed_at desc limit 1`,
        [asOf, TALLY_TRIAL_BALANCE_CACHE_MINUTES],
      ),
    );
    return r.rows[0] ? toTrialBalance(r.rows[0]) : null;
  }
}

interface ReadRow {
  id: string;
  as_of: string;
  state: "queued" | "claimed" | "done" | "failed";
  lines: TrialBalanceLine[] | null;
  total_debit: string | number | null;
  total_credit: string | number | null;
  reason_code: string | null;
}
const READ_COLUMNS =
  "id, as_of::text as as_of, state, lines, total_debit, total_credit, reason_code";

const toTrialBalance = (r: ReadRow): TrialBalance => ({
  asOf: r.as_of,
  lines: r.lines ?? [],
  totalDebitPaise: Number(r.total_debit ?? 0),
  totalCreditPaise: Number(r.total_credit ?? 0),
});
