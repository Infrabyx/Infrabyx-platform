// The agent's loop (PR-FBX-46, R1-D-137, R1-D-178; threat model §3.121): enrol once, then
// long-poll the platform for one job at a time, run it against TallyPrime, report the result.
//
// Posting one batch, voucher by voucher, in order:
//   1. look its `REMOTEID` (`ipb:<journal>:<reference>`) up in TallyPrime;
//   2. two or more found: `remote_duplicate`; one found: acknowledged if it is the same voucher
//      (date, type, every ledger, side and amount), else `remote_mismatch`; none: create it;
//   3. after a create, or a create whose answer was lost, read it back: exactly one and the same
//      voucher, or the batch is rejected. TallyPrime's own refusals map to reason codes.
// Nothing is ever altered or deleted in TallyPrime; a rejected batch is replayed by the product
// and the vouchers already in TallyPrime are found and acknowledged, never created twice.
import {
  AgentEnrolResponse,
  AgentJobsResponse,
  TALLY_AGENT_API,
  TALLY_AGENT_AUTH_SCHEME,
  type AgentJob,
  type AgentJobResult,
  type AgentPostJob,
  type AgentPostResult,
  type AgentTrialBalanceJob,
  type AgentTrialBalanceResult,
} from "@infrabyx/contracts/ports";
import {
  exportAgentPrivateKey,
  generateAgentKeyPair,
  importAgentPrivateKey,
  signAgentRequest,
  type AgentPrivateKey,
} from "@infrabyx/crypto";
import {
  TallyClient,
  TallyUnavailable,
  reasonText,
  remoteIdOf,
  sameVoucher,
  type TallyVoucher,
} from "./tally.js";
import type { DpapiKeyGuard, KeyProtection } from "./keyguard.js";

/** DPAPI entropy for the agent's key blob: binds the blob to this use (#136 (4)). */
export const KEY_ENTROPY = "infrabyx-tally-agent/key/v1";

export const AGENT_VERSION = "1.1.0";

/** What the agent keeps between runs (the state file, mode 0600). */
export interface AgentState {
  tenantId: string;
  agentId: string;
  company: string;
  /**
   * The agent's P-256 key, which never leaves the tenant's machine: a DPAPI blob (Windows) or,
   * as the fallback, its PKCS #8 PEM. Exactly one of the two (#136 (4)).
   */
  privateKeyDpapi?: string;
  privateKeyPem?: string;
  /** What the agent reported at enrolment. */
  keyProtection?: KeyProtection;
  lastSeq: number;
  pollTimeoutSeconds: number;
}

export interface AgentStateStore {
  load(): Promise<AgentState | null>;
  save(s: AgentState): Promise<void>;
}

export class MemoryStateStore implements AgentStateStore {
  state: AgentState | null = null;
  async load() {
    return this.state ? { ...this.state } : null;
  }
  async save(s: AgentState) {
    this.state = { ...s };
  }
}

export type PlatformFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: Uint8Array;
    signal: AbortSignal;
  },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface TallyAgentOptions {
  /** The product's API origin, `https://…` (the agent API paths are appended). */
  platformUrl: string;
  tally: TallyClient;
  state: AgentStateStore;
  fetch?: PlatformFetch;
  now?: () => Date;
  /**
   * DPAPI on Windows (#136 (4)); null or absent keeps the key in the 0600 state file, which the
   * agent reports at enrolment so the platform's record carries a warning.
   */
  keyGuard?: DpapiKeyGuard | null;
  /** Called after each loop turn (the heartbeat). */
  onTurn?: () => void | Promise<void>;
  log?: (line: string) => void;
}

export class PlatformRefused extends Error {
  constructor(readonly status: number) {
    super(`the platform answered HTTP ${status}`);
  }
}

export class TallyAgent {
  private readonly fetch: PlatformFetch;
  private key: AgentPrivateKey | null = null;
  constructor(private readonly o: TallyAgentOptions) {
    this.fetch = o.fetch ?? (globalThis.fetch as unknown as PlatformFetch);
  }

  private log(line: string): void {
    this.o.log?.(line);
  }

  /** Claims an enrolment code with a fresh key; the state is saved before anything else runs. */
  async enrol(code: string): Promise<AgentState> {
    const pair = generateAgentKeyPair();
    const pem = exportAgentPrivateKey(pair.privateKey);
    // DPAPI first (protect, unprotect, compare), so the enrolment says how the key is kept.
    const blob = this.o.keyGuard ? await this.o.keyGuard.selfTest(pem, KEY_ENTROPY) : null;
    const keyProtection: KeyProtection = blob ? "dpapi" : "file";
    if (!blob)
      this.log(
        this.o.keyGuard
          ? "warning: DPAPI is not available for this account; the key is kept in the 0600 state file"
          : "warning: the key is kept in the 0600 state file (no DPAPI on this system)",
      );
    const body = new TextEncoder().encode(
      JSON.stringify({ code, jwk: pair.publicJwk, agentVersion: AGENT_VERSION, keyProtection }),
    );
    const res = await this.fetch(`${this.o.platformUrl}${TALLY_AGENT_API.enrol}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status !== 200) throw new PlatformRefused(res.status);
    const out = AgentEnrolResponse.parse(JSON.parse(await res.text()));
    const state: AgentState = {
      tenantId: out.tenantId,
      agentId: out.agentId,
      company: out.company,
      ...(blob ? { privateKeyDpapi: blob } : { privateKeyPem: pem }),
      keyProtection,
      lastSeq: 0,
      pollTimeoutSeconds: out.pollTimeoutSeconds,
    };
    await this.o.state.save(state);
    this.key = pair.privateKey;
    this.log(`enrolled as ${out.agentId} for company "${out.company}"`);
    return state;
  }

  private async privateKeyPem(s: AgentState): Promise<string> {
    if (s.privateKeyPem) return s.privateKeyPem;
    if (!s.privateKeyDpapi || !this.o.keyGuard)
      throw new Error("the agent's key is under DPAPI, which is not available here");
    return this.o.keyGuard.unprotect(s.privateKeyDpapi, KEY_ENTROPY);
  }

  private async call(
    method: "GET" | "POST",
    path: string,
    body: Uint8Array,
    timeoutMs: number,
  ): Promise<{ status: number; text: string }> {
    const s = await this.o.state.load();
    if (!s) throw new Error("the agent is not enrolled");
    this.key ??= importAgentPrivateKey(await this.privateKeyPem(s));
    // `seq` only grows, across restarts too: it is saved before the request leaves.
    const seq = Math.max(s.lastSeq + 1, (this.o.now?.() ?? new Date()).getTime());
    await this.o.state.save({ ...s, lastSeq: seq });
    const jws = signAgentRequest({
      privateKey: this.key,
      kid: `${s.tenantId}/${s.agentId}`,
      request: { tenant: s.tenantId, agent: s.agentId, method, path, body },
      seq,
      ...(this.o.now ? { now: this.o.now() } : {}),
    });
    const res = await this.fetch(`${this.o.platformUrl}${path}`, {
      method,
      headers: {
        authorization: `${TALLY_AGENT_AUTH_SCHEME} ${jws}`,
        "ipb-agent-seq": String(seq),
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, text: await res.text() };
  }

  /** One turn: poll, and run and report the job if there is one. */
  async runOnce(): Promise<"idle" | "done"> {
    const s = await this.o.state.load();
    if (!s) throw new Error("the agent is not enrolled");
    const poll = await this.call(
      "GET",
      TALLY_AGENT_API.jobs,
      new Uint8Array(),
      (s.pollTimeoutSeconds + 15) * 1000,
    );
    if (poll.status !== 200) throw new PlatformRefused(poll.status);
    const { job } = AgentJobsResponse.parse(JSON.parse(poll.text));
    if (!job) return "idle";
    const result = await this.runJob(job);
    const path = TALLY_AGENT_API.result.replace("{jobId}", job.jobId);
    const res = await this.call(
      "POST",
      path,
      new TextEncoder().encode(JSON.stringify(result)),
      30_000,
    );
    // 409: the job moved on (replayed or re-leased); the next poll brings the current one.
    if (res.status !== 200 && res.status !== 409) throw new PlatformRefused(res.status);
    this.log(`${job.kind} ${job.jobId} attempt ${job.attempt}: ${result.outcome}`);
    return "done";
  }

  async runJob(job: AgentJob): Promise<AgentJobResult> {
    return job.kind === "post" ? postBatch(this.o.tally, job) : readTrialBalance(this.o.tally, job);
  }

  /** Runs until `signal` aborts; errors back off with jitter from 1 s to 5 minutes. */
  async run(signal: AbortSignal): Promise<void> {
    let backoff = 1_000;
    while (!signal.aborted) {
      try {
        await this.runOnce();
        backoff = 1_000;
      } catch (e) {
        if (e instanceof PlatformRefused && (e.status === 401 || e.status === 403))
          this.log(`the platform refused this agent (HTTP ${e.status}); enrol it again if revoked`);
        else this.log(`turn failed: ${e instanceof Error ? e.message : "error"}`);
        const wait = backoff / 2 + Math.floor(Math.random() * (backoff / 2));
        await new Promise((r) => setTimeout(r, wait));
        backoff = Math.min(backoff * 2, 300_000);
      }
      await this.o.onTurn?.();
    }
  }
}

/** Posts one batch to TallyPrime (see the header for the algorithm). */
export async function postBatch(tally: TallyClient, job: AgentPostJob): Promise<AgentPostResult> {
  const refs: Record<string, string> = {};
  const reject = (
    code: Extract<AgentPostResult, { outcome: "rejected" }>["reasonCode"],
    reference?: string,
  ): AgentPostResult => ({
    kind: "post",
    attempt: job.attempt,
    outcome: "rejected",
    reasonCode: code,
    reason: reasonText(code, reference),
    ...(reference ? { reference } : {}),
  });
  try {
    for (const entry of job.batch.entries) {
      const remoteId = remoteIdOf(job.batch.journalId, entry.reference);
      const judge = (found: TallyVoucher[]) =>
        found.length > 1
          ? ("remote_duplicate" as const)
          : found.length === 1
            ? sameVoucher(found[0]!, entry)
              ? found[0]!
              : ("remote_mismatch" as const)
            : null;
      let verdict = judge(await tally.lookup(job.company, remoteId));
      if (verdict === null) {
        const answer = await tally.create(job.company, remoteId, entry);
        if (answer.kind === "refused") return reject(answer.reasonCode, entry.reference);
        verdict = judge(await tally.lookup(job.company, remoteId));
        if (verdict === null) return reject("tally_error", entry.reference);
      }
      if (typeof verdict === "string") return reject(verdict, entry.reference);
      refs[entry.reference] = ledgerRef(verdict, remoteId);
    }
  } catch (e) {
    if (e instanceof TallyUnavailable) return reject(e.reasonCode);
    throw e;
  }
  return { kind: "post", attempt: job.attempt, outcome: "acknowledged", ledgerRefs: refs };
}

/** TallyPrime's GUID, with the voucher number when it has one. */
function ledgerRef(v: TallyVoucher, remoteId: string): string {
  const ref = [v.guid ?? remoteId, v.number].filter(Boolean).join("/");
  return ref.replace(/[^\x20-\x7e]/g, "?").slice(0, 200);
}

export async function readTrialBalance(
  tally: TallyClient,
  job: AgentTrialBalanceJob,
): Promise<AgentTrialBalanceResult> {
  try {
    const lines = await tally.trialBalance(job.company, job.asOf);
    if (lines.length > 20_000)
      return {
        kind: "trial_balance",
        attempt: job.attempt,
        outcome: "failed",
        reasonCode: "too_large",
        reason: reasonText("too_large"),
      };
    return {
      kind: "trial_balance",
      attempt: job.attempt,
      outcome: "done",
      lines: lines.map((l) => ({ ...l, ledger: l.ledger.slice(0, 120) })),
    };
  } catch (e) {
    if (e instanceof TallyUnavailable)
      return {
        kind: "trial_balance",
        attempt: job.attempt,
        outcome: "failed",
        reasonCode: e.reasonCode,
        reason: reasonText(e.reasonCode),
      };
    throw e;
  }
}
