// TELEPHONY port (Finbyx PR-FBX-38; ADR-0007; R1-D-97): click-to-call from a staff member's
// phone or softphone to a customer, the call's outcome, and its recording, stored in the tenant's
// own STORAGE with a retention. Interfaces, the in-memory fake and the contract cases only; an
// adapter waits for a tenant's vendor choice and the owner's word (an external account and a
// recurring cost). The rules every adapter keeps:
//   * a call is placed by a person (or the product's service on a person's behalf), never an agent;
//   * a call is idempotent on its key: the same request again is the same call; another request
//     under the key is refused (IPB-PORT-004);
//   * a call is recorded only with a disclosure: the request names the disclosure (its id and
//     version, played to both parties before recording starts), and a recording is stored only if
//     the adapter reports that the disclosure was played; otherwise nothing is kept;
//   * a stored recording goes to the tenant's STORAGE under the request's output prefix, with the
//     request's retention; the vendor keeps no copy once it is stored (`providerRetention: none`).
import { z } from "zod";
import type { Port, PortCall } from "./common.js";
import { DocFileRef, OutputPrefix } from "./doc-file.js";
import { classed } from "./payload-class.js";
import { E164 } from "./sms.js";

const internal = <T extends z.ZodType>(s: T): T => classed(s, "INTERNAL");
const confidential = <T extends z.ZodType>(s: T): T => classed(s, "CONFIDENTIAL");

export const CALL_STATES = [
  "queued",
  "ringing",
  "in_progress",
  "completed",
  "no_answer",
  "busy",
  "failed",
  "cancelled",
] as const;
export type CallState = (typeof CALL_STATES)[number];
/** States a call never leaves. */
export const FINAL_CALL_STATES: readonly CallState[] = [
  "completed",
  "no_answer",
  "busy",
  "failed",
  "cancelled",
];

export const CallRecording = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(false) }).strict(),
  z
    .object({
      enabled: z.literal(true),
      /** The disclosure played before recording starts: its id and version (e.g. `rec_notice@3`). */
      disclosureId: internal(z.string().regex(/^[a-z][a-z0-9_.-]{2,79}@\d{1,6}$/)),
      /** Days the stored recording is kept; the tenant's retention schedule decides the value. */
      retentionDays: internal(z.number().int().min(1).max(3650)),
      /** Where the recording is stored: under the tenant's own STORAGE prefix. */
      outputPrefix: internal(OutputPrefix),
    })
    .strict(),
]);
export type CallRecording = z.infer<typeof CallRecording>;

export const ClickToCallRequest = z
  .object({
    /** Who places the call: a staff member, or the product's service on their behalf. */
    initiatedBy: internal(
      z.object({ type: z.enum(["user", "service"]), id: z.string().min(3).max(120) }).strict(),
    ),
    /** The staff member's line as the adapter knows it (an extension or a registered number). */
    agentLine: internal(z.string().min(2).max(64)),
    /** The customer's number (personal data). */
    to: confidential(E164),
    /** The tenant's registered caller id, when the adapter needs one. */
    callerId: internal(E164.optional()),
    /** Why the call is made, e.g. `collections.reminder`; kept with the call. */
    purpose: internal(z.string().regex(/^[a-z][a-z0-9_.]{2,79}$/)),
    /** The product's reference of the person or case called. */
    subjectRef: confidential(z.string().min(3).max(120)),
    recording: CallRecording,
    /** The longest the call may last. */
    maxMinutes: internal(z.number().int().min(1).max(120)),
    idempotencyKey: internal(z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)),
  })
  .strict();
export type ClickToCallRequest = z.infer<typeof ClickToCallRequest>;

export interface CallHandle {
  callId: string;
  state: CallState;
  idempotencyKey: string;
}

export interface CallOutcome {
  callId: string;
  state: CallState;
  purpose: string;
  /** ISO 8601 instants, when known. */
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  /** Seconds from answer to end (0 when never answered). */
  talkSeconds: number;
  hangupBy: "agent" | "customer" | "system" | null;
  recording: null | {
    state: "pending" | "available" | "stored" | "not_kept";
    /** Whether the adapter played the disclosure before recording started. */
    disclosurePlayed: boolean;
    disclosureId: string;
  };
}

export interface StoredRecording {
  callId: string;
  file: DocFileRef;
  contentType: string;
  durationSeconds: number;
  disclosureId: string;
  retentionDays: number;
  /** When the tenant's STORAGE may delete it (stored time plus the retention). */
  deleteAfter: string;
}

export interface TelephonyPort extends Port {
  /** Place a click-to-call; idempotent on `idempotencyKey`. */
  clickToCall(req: ClickToCallRequest, call?: PortCall): Promise<CallHandle>;
  /** The call's outcome so far. */
  callOutcome(callId: string, call?: PortCall): Promise<CallOutcome>;
  /**
   * Store a finished call's recording in the tenant's STORAGE and drop the vendor's copy. Refused
   * (`IPB-PORT-003`) when the call was not recorded, its disclosure was not played, or it is not
   * finished; a second call returns the same stored recording.
   */
  storeRecording(callId: string, call?: PortCall): Promise<StoredRecording>;
  /** Cancel a call that has not been answered. */
  cancel(callId: string, call?: PortCall): Promise<CallHandle>;
}
