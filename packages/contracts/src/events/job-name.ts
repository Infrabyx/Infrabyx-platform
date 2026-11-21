// The queue job name of a CloudEvents event type (Finbyx PR-FBX-53; R1-D-266). An event type has
// capitals (`in.fbx.cms.ContentPublished.v1`), and the platform's job name rule is lower case
// (`QUEUE_JOB_NAME_REGEX`, which every QUEUE adapter and fixture enforces), so an outbox relay that
// used the type as the job name was refused by every real queue. The one mapping:
//
//   in.<product>.<module>.<Event>.v<n>     → in.<product>.<module>.<event-in-kebab-case>.v<n>
//   in.infrabyx.<domain>.<Event>.v<major>  → in.infrabyx.<domain>.<event-in-kebab-case>.v<major>
//
// Only the PascalCase event segment changes: every capital becomes `-` plus its lower-case letter
// (none before the first), and digits and lower-case letters stay as they are. So
// `ContentPublished` → `content-published`, `KFSIssued` → `k-f-s-issued`, `ESignCompleted` →
// `e-sign-completed`, `Step2Done` → `step2-done`. Every part of the kebab segment then starts with
// a letter that was a capital, so the way back (capitalise the first letter of each part, drop the
// `-`) is exact: the mapping is a bijection between valid event types and valid event job names.
// Acronyms are spelt letter by letter on purpose: `kfs-issued` could not tell `KFSIssued` from
// `KfsIssued`. A job name has at most 100 characters (`QUEUE_JOB_NAME_MAX`); a longer result is
// refused. Keep the full type in the job data as well (the platform relay's `outboxEventJob` does).
import { PortError } from "../errors.js";
import { QUEUE_JOB_NAME_MAX, QUEUE_JOB_NAME_REGEX } from "../ports/queue.js";
import { isEcosystemType, isInternalType } from "./envelope.js";

/** The fixed reasons `eventJobName` and `eventTypeOfJobName` refuse with (`meta.reason`). */
export const EVENT_JOB_NAME_REFUSALS = [
  "not_event_type",
  "job_name_too_long",
  "not_event_job_name",
] as const;
export type EventJobNameRefusal = (typeof EVENT_JOB_NAME_REFUSALS)[number];

const KEBAB_EVENT = /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*$/;

const refuse = (reason: EventJobNameRefusal, detail: string): PortError =>
  new PortError("IPB-PORT-003", "QUEUE", { detail, meta: { reason } });

const isEventType = (t: unknown): t is string =>
  typeof t === "string" && (isInternalType(t) || isEcosystemType(t));

const kebab = (event: string): string =>
  event.replace(/[A-Z]/g, (c: string, at: number) => (at ? "-" : "") + c.toLowerCase());

const pascal = (event: string): string =>
  event
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");

/**
 * The queue job name of an internal or Ecosystem event type. Refused `IPB-PORT-003` (`meta.reason`
 * `not_event_type` or `job_name_too_long`) for anything else, before any I/O.
 */
export function eventJobName(type: string): string {
  if (!isEventType(type))
    throw refuse("not_event_type", "a job name is mapped from a CloudEvents event type");
  const parts = type.split(".");
  parts[3] = kebab(parts[3]!);
  const name = parts.join(".");
  if (name.length > QUEUE_JOB_NAME_MAX)
    throw refuse(
      "job_name_too_long",
      `the event type's job name has more than ${QUEUE_JOB_NAME_MAX} characters`,
    );
  // Unreachable by the event-type grammar; kept so no other name can ever leave this function.
  if (!QUEUE_JOB_NAME_REGEX.test(name))
    throw refuse("not_event_type", "the event type does not map to a job name");
  return name;
}

/** The event type an event job name was mapped from; refused `not_event_job_name` otherwise. */
export function eventTypeOfJobName(name: string): string {
  const parts = typeof name === "string" && QUEUE_JOB_NAME_REGEX.test(name) ? name.split(".") : [];
  if (parts.length === 5 && KEBAB_EVENT.test(parts[3]!)) {
    parts[3] = pascal(parts[3]!);
    const type = parts.join(".");
    if (isEventType(type) && eventJobName(type) === name) return type;
  }
  throw refuse("not_event_job_name", "not the job name of an event type");
}

/** True when `name` is the job name of an event type (`eventTypeOfJobName` answers). */
export function isEventJobName(name: unknown): name is string {
  try {
    return typeof name === "string" && eventTypeOfJobName(name) !== "";
  } catch {
    return false;
  }
}
