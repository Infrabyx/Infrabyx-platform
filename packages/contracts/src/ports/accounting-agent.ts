// The TallyPrime agent's wire contract (Finbyx PR-FBX-46; R1-D-137 design, R1-D-178 build; plan
// `docs/phases/R1-tallyprime-plan.md`; threat model §3.121). TallyPrime runs on the tenant's own
// machines and answers XML on a local port only, so an outbound-only agent at the tenant long-polls
// the platform over HTTPS for jobs, runs each against TallyPrime on its own network, and posts the
// result. These are the messages both halves exchange; the platform half lives in
// `@infrabyx/connectors` (`TallyAccountingSink`, `TallyAgentService`, `TallyAgentGateway`), the
// agent in `apps/tally-agent`.
//
//   * An agent is enrolled under maker-checker (`accounting.agent.enrol`, R3) and claims its
//     enrolment once with a one-time code (`tac1.<tenant>.<agent>.<secret>`, 30 minutes), sending
//     the public half of a P-256 key it generated itself. The platform keeps the public key only.
//   * Every later call carries `Authorization: IPB-Agent <detached JWS>` (the C-22 profile with its
//     own `typ`, `@infrabyx/crypto` `signAgentRequest`), bound to the tenant, the agent, a strictly
//     increasing `seq`, the method, the path and the body digest.
//   * One job is in flight per agent; a job and a result are at most 2 MiB; a voucher is created
//     in TallyPrime only after its `REMOTEID` was looked up and found absent, and is acknowledged
//     only when exactly one voucher reads back with the same content (R1-D-178).
import { z } from "zod";
import { idSchema, TENANT_ID_REGEX } from "../ids.js";
import { ACCOUNTING_MAX_ENTRIES, ACCOUNTING_MAX_PAISE, JournalBatch } from "./accounting.js";
import { classed } from "./payload-class.js";

const internal = <T extends z.ZodType>(s: T): T => classed(s, "INTERNAL");
const confidential = <T extends z.ZodType>(s: T): T => classed(s, "CONFIDENTIAL");

/** The agent API, mounted by the product under its own API (IPB-12). */
export const TALLY_AGENT_API = {
  enrol: "/v1/accounting/agent/enrol",
  jobs: "/v1/accounting/agent/jobs",
  /** `POST`; `{jobId}` is the journal id of a posting or the `tbr_` id of a trial-balance read. */
  result: "/v1/accounting/agent/jobs/{jobId}/result",
} as const;

/** The `Authorization` scheme of an agent call. */
export const TALLY_AGENT_AUTH_SCHEME = "IPB-Agent";
/** The approval action that enrols an agent (R3). */
export const TALLY_AGENT_ENROL_ACTION = "accounting.agent.enrol";
/** The service role an agent's calls run under in its tenant. */
export const TALLY_AGENT_ROLE = "SVC_TALLY_AGENT";

/** Largest job or result body, in bytes (canonical JSON). */
export const TALLY_AGENT_MAX_BODY_BYTES = 2 * 1024 * 1024;
/** Most vouchers one job carries (one batch). */
export const TALLY_AGENT_MAX_VOUCHERS = ACCOUNTING_MAX_ENTRIES;
/** How long a one-time enrolment code is valid. */
export const TALLY_ENROL_CODE_MINUTES = 30;
/** Wrong codes after which the agent's code stops working until a new one is issued. */
export const TALLY_ENROL_MAX_FAILURES = 5;
/** A claimed job is the agent's for this long; after it, it may be claimed again. */
export const TALLY_AGENT_LEASE_MINUTES = 10;
/** Health thresholds by the age of the last poll. */
export const TALLY_AGENT_DEGRADED_MINUTES = 15;
export const TALLY_AGENT_DOWN_HOURS = 24;
/** A trial balance read is answered from a result this fresh. */
export const TALLY_TRIAL_BALANCE_CACHE_MINUTES = 10;
/** The long poll, in seconds (`int.accounting.tally.poll_timeout_seconds`: default and bounds). */
export const TALLY_POLL_TIMEOUT_SECONDS = { default: 25, min: 1, max: 55 } as const;
/** Days a posting may wait unclaimed (`int.accounting.tally.job_expiry_days`). */
export const TALLY_JOB_EXPIRY_DAYS = { default: 7, min: 1, max: 30 } as const;
/**
 * An agent's key is valid for this many days from its enrolment; after that its requests are
 * refused and it must be enrolled again (owner answer #136 (4), R1-D-184).
 */
export const TALLY_AGENT_KEY_MAX_DAYS = 90;
/** From this day of a key's life the agent's view carries `rotationDue` (the console warns). */
export const TALLY_AGENT_KEY_WARN_DAYS = 80;
/**
 * How the agent keeps its private key on the tenant's machine (#136 (4)): `dpapi`, under Windows
 * DPAPI for the agent's own account; `file`, a mode-0600 file (other systems, or DPAPI was not
 * available), which the enrolment record carries as a warning.
 */
export const TALLY_KEY_PROTECTIONS = ["dpapi", "file"] as const;
export type TallyKeyProtection = (typeof TALLY_KEY_PROTECTIONS)[number];

export const TALLY_AGENT_ID_REGEX = /^tga_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
export const TALLY_READ_ID_REGEX = /^tbr_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
export const TallyAgentId = idSchema("tga");
export const TallyReadId = idSchema("tbr");

/** Why TallyPrime, the agent or the platform refused or could not finish a job. */
export const TALLY_REASON_CODES = [
  "ledger_unknown",
  "voucher_type_unknown",
  "period_closed",
  "company_not_open",
  "duplicate_voucher",
  "remote_mismatch",
  "remote_duplicate",
  "tally_unreachable",
  "tally_error",
  "agent_unreachable",
  "too_large",
] as const;
export type TallyReasonCode = (typeof TALLY_REASON_CODES)[number];
const ReasonCode = internal(z.enum(TALLY_REASON_CODES));
/** A short reason for people, never a TallyPrime response copied whole. */
const ReasonText = internal(
  z
    .string()
    .min(1)
    .max(300)
    // eslint-disable-next-line no-control-regex
    .regex(/^[^\u0000-\u001f\u007f]+$/),
);

/** A TallyPrime company name as the agent opens it. */
export const TallyCompany = internal(
  z
    .string()
    .min(1)
    .max(120)
    // eslint-disable-next-line no-control-regex
    .regex(/^[^\u0000-\u001f\u007f]+$/, "no control characters"),
);

/** The public half of the agent's P-256 key: exactly the four public members. */
export const AgentPublicJwk = internal(
  z
    .object({
      kty: z.literal("EC"),
      crv: z.literal("P-256"),
      x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      y: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    })
    .strict(),
);
export type AgentPublicJwk = z.infer<typeof AgentPublicJwk>;

/** `tac1.<tenant id>.<agent id>.<secret>`: 256 random bits, base64url. */
export const TALLY_ENROL_CODE_REGEX = new RegExp(
  `^tac1\\.(${TENANT_ID_REGEX.source.slice(1, -1)})\\.(tga_[0-7][0-9A-HJKMNP-TV-Z]{25})\\.([A-Za-z0-9_-]{43})$`,
);

/** Splits an enrolment code; null when it is not one. */
export function parseEnrolCode(
  code: string,
): { tenantId: string; agentId: string; secret: string } | null {
  const m = TALLY_ENROL_CODE_REGEX.exec(code);
  return m ? { tenantId: m[1]!, agentId: m[2]!, secret: m[3]! } : null;
}

const AgentVersion = internal(z.string().regex(/^[0-9A-Za-z.+-]{1,40}$/));

export const AgentEnrolRequest = z
  .object({
    code: internal(z.string().regex(TALLY_ENROL_CODE_REGEX)),
    jwk: AgentPublicJwk,
    agentVersion: AgentVersion,
    /** Omitted by agents before 1.1.0: read as `file`. */
    keyProtection: internal(z.enum(TALLY_KEY_PROTECTIONS)).optional(),
  })
  .strict();
export type AgentEnrolRequest = z.infer<typeof AgentEnrolRequest>;

export const AgentEnrolResponse = z
  .object({
    agentId: internal(z.string().regex(TALLY_AGENT_ID_REGEX)),
    tenantId: internal(z.string().regex(TENANT_ID_REGEX)),
    company: TallyCompany,
    pollTimeoutSeconds: internal(
      z.number().int().min(TALLY_POLL_TIMEOUT_SECONDS.min).max(TALLY_POLL_TIMEOUT_SECONDS.max),
    ),
  })
  .strict();
export type AgentEnrolResponse = z.infer<typeof AgentEnrolResponse>;

const isoDate = internal(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));
const Attempt = internal(z.number().int().min(1).max(1_000));

export const AgentPostJob = z
  .object({
    kind: z.literal("post"),
    /** The journal id. */
    jobId: internal(z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/)),
    attempt: Attempt,
    company: TallyCompany,
    batch: JournalBatch,
  })
  .strict();
export const AgentTrialBalanceJob = z
  .object({
    kind: z.literal("trial_balance"),
    jobId: internal(z.string().regex(TALLY_READ_ID_REGEX)),
    attempt: Attempt,
    company: TallyCompany,
    asOf: isoDate,
  })
  .strict();
export const AgentJob = z.discriminatedUnion("kind", [AgentPostJob, AgentTrialBalanceJob]);
export type AgentJob = z.infer<typeof AgentJob>;
export type AgentPostJob = z.infer<typeof AgentPostJob>;
export type AgentTrialBalanceJob = z.infer<typeof AgentTrialBalanceJob>;

/** What the jobs endpoint answers: one job, or none when the long poll ran out. */
export const AgentJobsResponse = z.object({ job: AgentJob.nullable() }).strict();
export type AgentJobsResponse = z.infer<typeof AgentJobsResponse>;

const LedgerRef = internal(z.string().regex(/^[\x20-\x7e]{1,200}$/));

export const AgentPostResult = z.discriminatedUnion("outcome", [
  z
    .object({
      kind: z.literal("post"),
      attempt: Attempt,
      outcome: z.literal("acknowledged"),
      /** TallyPrime's GUID (and voucher number) by the product's voucher reference. */
      ledgerRefs: z.record(z.string().regex(/^[A-Za-z0-9_./:-]{1,64}$/), LedgerRef),
    })
    .strict(),
  z
    .object({
      kind: z.literal("post"),
      attempt: Attempt,
      outcome: z.literal("rejected"),
      reasonCode: ReasonCode,
      reason: ReasonText,
      /** The voucher reference TallyPrime refused, when one did. */
      reference: internal(z.string().regex(/^[A-Za-z0-9_./:-]{1,64}$/)).optional(),
    })
    .strict(),
]);
export type AgentPostResult = z.infer<typeof AgentPostResult>;

const Paise = confidential(z.number().int().min(0).max(ACCOUNTING_MAX_PAISE));

export const AgentTrialBalanceResult = z.discriminatedUnion("outcome", [
  z
    .object({
      kind: z.literal("trial_balance"),
      attempt: Attempt,
      outcome: z.literal("done"),
      lines: z
        .array(
          z
            .object({
              ledger: internal(
                z
                  .string()
                  .min(1)
                  .max(120)
                  // eslint-disable-next-line no-control-regex
                  .regex(/^[^\u0000-\u001f\u007f]+$/),
              ),
              debitPaise: Paise,
              creditPaise: Paise,
            })
            .strict(),
        )
        .max(20_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("trial_balance"),
      attempt: Attempt,
      outcome: z.literal("failed"),
      reasonCode: ReasonCode,
      reason: ReasonText,
    })
    .strict(),
]);
export type AgentTrialBalanceResult = z.infer<typeof AgentTrialBalanceResult>;

export const AgentJobResult = z.union([AgentPostResult, AgentTrialBalanceResult]);
export type AgentJobResult = z.infer<typeof AgentJobResult>;

/** The states of an enrolled agent. */
export const TALLY_AGENT_STATES = ["approved", "active", "revoked"] as const;
export type TallyAgentState = (typeof TALLY_AGENT_STATES)[number];

/** An agent as the tenant's admins see it: never its key or its code. */
export interface TallyAgentView {
  id: string;
  tenantId: string;
  name: string;
  company: string;
  state: TallyAgentState;
  /** RFC 7638 thumbprint of its key, once active. */
  keyThumbprint: string | null;
  lastPollAt: string | null;
  agentVersion: string | null;
  enrolledAt: string | null;
  revokedAt: string | null;
  /** How the agent keeps its key; `file` is a warning (#136 (4)). Null before enrolment. */
  keyProtection: TallyKeyProtection | null;
  /** When the key stops working (enrolment + `TALLY_AGENT_KEY_MAX_DAYS`). */
  keyExpiresAt: string | null;
  /** Day `TALLY_AGENT_KEY_WARN_DAYS` or later of an active key: enrol a new agent. */
  rotationDue: boolean;
  /** Warnings the console shows: `key_unencrypted`, `key_expired`. */
  warnings: readonly ("key_unencrypted" | "key_expired")[];
  /** Whether an unused, unexpired enrolment code exists. */
  codeOutstanding: boolean;
}
