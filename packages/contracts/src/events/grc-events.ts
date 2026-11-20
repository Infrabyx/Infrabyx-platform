// The Compliance and GRC events of Ecosystem Specification §6.15 that had no schema yet (Finbyx
// PR-FBX-51; R1-D-220; plan `docs/phases/R1-finbyx-grc-plan.md`): `ControlTestResultPublished`,
// `ComplianceIssueRaised`, `ReturnStatusUpdated`, `PolicyAttested` and `SecurityIncidentNotified`,
// beside the two already published in `spec-events.ts` (`EvidenceSubmitted`, `ObligationPublished`),
// which `GRC_EVENTS` lists with them. The field names are the Specification's key payload fields
// (§6.15) and §9.2 resource fields in snake case; unknown fields pass through, as for the other
// Ecosystem schemas, and are checked against the registry schemas when they are published ([VERIFY]).
//
// §9.2: a GRC system holds references and hashes, aggregate counts and masked sample ids, never raw
// personal data. So every id is a reference (`[A-Za-z0-9_.:-]`, never a name or an e-mail), people
// travel as `user_ref` or an owner role, and each schema refuses an Aadhaar-like number
// (`findAadhaarLike`) or a PAN-shaped value anywhere in the data, unknown fields included.
// Times are RFC 3339 with an offset; dates `YYYY-MM-DD` (IST).
import { z } from "zod";
import { findAadhaarLike } from "../aadhaar.js";
import { REGULATED_MESSAGE_EVENTS } from "./regulated.js";
import {
  EVIDENCE_SUBMITTED_TYPE,
  EvidenceSubmittedData,
  OBLIGATION_PUBLISHED_TYPE,
  ObligationPublishedData,
  PROVIDER_INCIDENT_SEVERITIES,
} from "./spec-events.js";

/** The schema version every type below starts at (the envelope's `schemaver`). */
export const GRC_SCHEMA_VERSION = "1.0.0";

const PAN_LIKE = /(?<![A-Za-z0-9])[A-Z]{5}[0-9]{4}[A-Z](?![A-Za-z0-9])/;

/**
 * The personal data a GRC payload may never hold (§9.2), as a list of problems (empty when clean):
 * an Aadhaar number or VID (`findAadhaarLike`, letters joining a run so hex digests are not read as
 * numbers) or a PAN-shaped value, anywhere in the serialised data.
 */
export function grcPersonalDataProblems(data: unknown): string[] {
  const text = JSON.stringify(data) ?? "";
  const out: string[] = [];
  if (findAadhaarLike(text, { letters: "join" }).length > 0)
    out.push("an Aadhaar number or VID (a GRC system holds references only, §9.2)");
  if (PAN_LIKE.test(text)) out.push("a PAN (a GRC system holds references only, §9.2)");
  return out;
}

const noPersonalData = (d: unknown, ctx: z.RefinementCtx) => {
  for (const message of grcPersonalDataProblems(d)) ctx.addIssue({ code: "custom", message });
};

const ref = z.string().regex(/^[A-Za-z0-9_.:-]{3,128}$/, "a reference, never a name");
const code = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const at = z.iso.datetime({ offset: true });
const date = z.iso.date();
const count = z.number().int().min(0).max(1e12);

/**
 * A masked sample id (§9.2 "masked sample ids"): an optional prefix, at least four `X` or `*`, then
 * at most four characters left visible, e.g. `ln_XXXXXXXX4821`. Never an id in clear.
 */
export const GRC_MASKED_ID = /^[A-Za-z0-9_.:-]{0,64}[X*]{4,}[A-Za-z0-9]{0,4}$/;

/** An evidence reference: a `storage:` key or https URI with its SHA-256, never the file. */
const EvidenceRef = z
  .object({
    evidence_id: ref.optional(),
    uri: z
      .string()
      .max(2048)
      .regex(/^(https:\/\/|storage:)/, "an https URI or a storage: key"),
    sha256,
  })
  .strict();

const Period = z
  .object({ from: date, to: date })
  .strict()
  .refine((p) => p.from <= p.to, "period.from is after period.to");

// ---- ControlTestResultPublished ------------------------------------------------------------------

export const CONTROL_TEST_RESULT_PUBLISHED_TYPE = "in.infrabyx.grc.ControlTestResultPublished.v1";
/** The outcome of a control test run ([ASSUMED – owner review] #159; the Specification names none). */
export const CONTROL_TEST_RESULTS = ["PASS", "FAIL", "INCONCLUSIVE"] as const;

/**
 * Idempotency key (control_id, run_id). Aggregate counts and masked sample ids only (§9.2); the
 * evidence by reference and SHA-256.
 */
export const ControlTestResultPublishedData = z
  .object({
    control_id: ref,
    run_id: ref,
    period: Period.optional(),
    result: z.enum(CONTROL_TEST_RESULTS),
    population_count: count,
    sample_count: count,
    exception_count: count,
    masked_sample_ids: z
      .array(z.string().regex(GRC_MASKED_ID, "a masked id (prefix, at least XXXX, ≤ 4 visible)"))
      .max(100),
    evidence: z.array(EvidenceRef).max(100),
    automated: z.boolean().optional(),
    tested_at: at,
  })
  .loose()
  .superRefine((d, ctx) => {
    if (d.sample_count > d.population_count)
      ctx.addIssue({ code: "custom", path: ["sample_count"], message: "more than the population" });
    if (d.exception_count > d.population_count)
      ctx.addIssue({
        code: "custom",
        path: ["exception_count"],
        message: "more than the population",
      });
    if (d.masked_sample_ids.length > d.sample_count)
      ctx.addIssue({
        code: "custom",
        path: ["masked_sample_ids"],
        message: "more sample ids than the sample",
      });
    if (d.result === "PASS" && d.exception_count > 0)
      ctx.addIssue({ code: "custom", path: ["result"], message: "PASS with exceptions" });
    noPersonalData(d, ctx);
  });
export type ControlTestResultPublishedData = z.infer<typeof ControlTestResultPublishedData>;

// ---- ComplianceIssueRaised -----------------------------------------------------------------------

export const COMPLIANCE_ISSUE_RAISED_TYPE = "in.infrabyx.grc.ComplianceIssueRaised.v1";
/** §9.2 `Issue.source`. */
export const COMPLIANCE_ISSUE_SOURCES = ["TEST", "AUDIT", "RBI", "INCIDENT"] as const;
/**
 * The owner's SEV1 (most severe) to SEV4 scale, as for `ProviderIncident` (owner answer #131);
 * §6.15's "≤ 15 min (severity 1)" SLA is `SEV1` ([ASSUMED – owner review] #159).
 */
export const COMPLIANCE_ISSUE_SEVERITIES = PROVIDER_INCIDENT_SEVERITIES;

/** Idempotency key `issue_id`. The owner is a role code and, optionally, a reference; never a name. */
export const ComplianceIssueRaisedData = z
  .object({
    issue_id: ref,
    source: z.enum(COMPLIANCE_ISSUE_SOURCES),
    /** The test run, audit, RBI observation or incident the issue came from, by reference. */
    source_ref: ref.optional(),
    control_id: ref.optional(),
    severity: z.enum(COMPLIANCE_ISSUE_SEVERITIES),
    owner: z.object({ role: code, ref: ref.optional() }).strict(),
    due: date,
    raised_at: at,
  })
  .loose()
  .superRefine(noPersonalData);
export type ComplianceIssueRaisedData = z.infer<typeof ComplianceIssueRaisedData>;

// ---- ReturnStatusUpdated -------------------------------------------------------------------------

export const RETURN_STATUS_UPDATED_TYPE = "in.infrabyx.grc.ReturnStatusUpdated.v1";
/** The return's status (§6.15: generated, validated, filed, acknowledged; and rejected). */
export const RETURN_STATUSES = [
  "GENERATED",
  "VALIDATED",
  "FILED",
  "ACKNOWLEDGED",
  "REJECTED",
] as const;
/**
 * A reporting period: a day `YYYY-MM-DD`, a month `YYYY-MM`, a quarter `YYYY-Qn`, a half `YYYY-Hn`,
 * a calendar year `YYYY` or a financial year `FYYYYY-YY`.
 */
export const RETURN_PERIOD =
  /^(?:\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?|-Q[1-4]|-H[12])?|FY\d{4}-\d{2})$/;

/** Idempotency key (return_code, period, status). `ack_ref` with ACKNOWLEDGED, and only then or REJECTED. */
export const ReturnStatusUpdatedData = z
  .object({
    return_code: z.string().regex(/^[A-Z0-9][A-Z0-9_.-]{1,63}$/),
    period: z.string().regex(RETURN_PERIOD, "a reporting period (see RETURN_PERIOD)"),
    status: z.enum(RETURN_STATUSES),
    /** The regulator's acknowledgement (or rejection) reference. */
    ack_ref: ref.optional(),
    reason_code: code.optional(),
    status_at: at,
  })
  .loose()
  .superRefine((d, ctx) => {
    if (d.status === "ACKNOWLEDGED" && d.ack_ref === undefined)
      ctx.addIssue({ code: "custom", path: ["ack_ref"], message: "ACKNOWLEDGED needs ack_ref" });
    if (d.ack_ref !== undefined && d.status !== "ACKNOWLEDGED" && d.status !== "REJECTED")
      ctx.addIssue({
        code: "custom",
        path: ["ack_ref"],
        message: "ack_ref only when ACKNOWLEDGED or REJECTED",
      });
    noPersonalData(d, ctx);
  });
export type ReturnStatusUpdatedData = z.infer<typeof ReturnStatusUpdatedData>;

// ---- PolicyAttested ------------------------------------------------------------------------------

export const POLICY_ATTESTED_TYPE = "in.infrabyx.grc.PolicyAttested.v1";

/** Idempotency key (policy_id, version, user_ref). The user is a reference, never a name or e-mail. */
export const PolicyAttestedData = z
  .object({
    policy_id: ref,
    version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/),
    user_ref: ref,
    attested_at: at,
    /** The date the Board approved this policy version (§9.2 `PolicyAttestation`). */
    board_approved_on: date.optional(),
  })
  .loose()
  .superRefine(noPersonalData);
export type PolicyAttestedData = z.infer<typeof PolicyAttestedData>;

// ---- SecurityIncidentNotified --------------------------------------------------------------------

export const SECURITY_INCIDENT_NOTIFIED_TYPE = "in.infrabyx.grc.SecurityIncidentNotified.v1";
/** The incident's class ([ASSUMED – owner review] #159; the Specification names none). */
export const SECURITY_INCIDENT_CLASSES = [
  "DATA_BREACH",
  "UNAUTHORISED_ACCESS",
  "MALWARE",
  "DENIAL_OF_SERVICE",
  "PHISHING",
  "SERVICE_DISRUPTION",
  "OTHER",
] as const;
/** The incident's status ([ASSUMED – owner review] #159). */
export const SECURITY_INCIDENT_STATUSES = ["OPEN", "CONTAINED", "RESOLVED", "CLOSED"] as const;

/**
 * Idempotency key (incident_id, update_seq); a consumer applies updates in `update_seq` order and
 * never a lower one over a higher. The affected data are category codes (e.g. `CONTACT_DETAILS`,
 * `KYC_RECORDS`, `CREDENTIALS`), never the data. The clocks: the provider's notice to the RE
 * (`notified_re_at`) and the RE's report to RBI (`rbi_reported_at`, within 6 h of detection, OUT
 * para 61), neither before `detected_at`.
 */
export const SecurityIncidentNotifiedData = z
  .object({
    incident_id: ref,
    update_seq: z.number().int().min(1),
    detected_at: at,
    class: z.enum(SECURITY_INCIDENT_CLASSES),
    affected_data_categories: z
      .array(code)
      .max(32)
      .refine((c) => new Set(c).size === c.length, "categories must not repeat"),
    status: z.enum(SECURITY_INCIDENT_STATUSES),
    notified_re_at: at.optional(),
    rbi_reported_at: at.optional(),
  })
  .loose()
  .superRefine((d, ctx) => {
    const t = Date.parse(d.detected_at);
    for (const k of ["notified_re_at", "rbi_reported_at"] as const)
      if (d[k] !== undefined && Date.parse(d[k]) < t)
        ctx.addIssue({ code: "custom", path: [k], message: `${k} is before detected_at` });
    noPersonalData(d, ctx);
  });
export type SecurityIncidentNotifiedData = z.infer<typeof SecurityIncidentNotifiedData>;

/**
 * The copy §6.15 routes to OH13 for clock tracking, "without personal data": the schema's own
 * fields only, so nothing a producer added beside them travels.
 */
export function securityIncidentClockCopy(
  d: SecurityIncidentNotifiedData,
): SecurityIncidentNotifiedData {
  const p = SecurityIncidentNotifiedData.parse(d);
  return {
    incident_id: p.incident_id,
    update_seq: p.update_seq,
    detected_at: p.detected_at,
    class: p.class,
    affected_data_categories: [...p.affected_data_categories],
    status: p.status,
    ...(p.notified_re_at !== undefined ? { notified_re_at: p.notified_re_at } : {}),
    ...(p.rbi_reported_at !== undefined ? { rbi_reported_at: p.rbi_reported_at } : {}),
  };
}

// ---- The registry --------------------------------------------------------------------------------

export interface GrcEventSpec {
  /** The Ecosystem type, `in.infrabyx.grc.<Event>.v1`. */
  type: string;
  schema: z.ZodType;
  /** The fields of the Specification's idempotency key, in its order. */
  idempotency: readonly string[];
  /** A regulated message (§3.6): none of the GRC events is. */
  regulated: boolean;
  /** Product → GRC system (LDC or the RE's), or the obligation catalogue → products. */
  direction: "TO_GRC" | "FROM_GRC";
}

const spec = (
  name: string,
  type: string,
  schema: z.ZodType,
  idempotency: readonly string[],
  direction: GrcEventSpec["direction"] = "TO_GRC",
): GrcEventSpec => ({
  type,
  schema,
  idempotency,
  regulated: (REGULATED_MESSAGE_EVENTS as readonly string[]).includes(name),
  direction,
});

/** Every §6.15 GRC event with a schema, by its Specification name. */
export const GRC_EVENTS = Object.freeze({
  ObligationPublished: spec(
    "ObligationPublished",
    OBLIGATION_PUBLISHED_TYPE,
    ObligationPublishedData,
    ["obligation_ref", "version"],
    "FROM_GRC",
  ),
  ControlTestResultPublished: spec(
    "ControlTestResultPublished",
    CONTROL_TEST_RESULT_PUBLISHED_TYPE,
    ControlTestResultPublishedData,
    ["control_id", "run_id"],
  ),
  EvidenceSubmitted: spec("EvidenceSubmitted", EVIDENCE_SUBMITTED_TYPE, EvidenceSubmittedData, [
    "evidence_id",
  ]),
  ComplianceIssueRaised: spec(
    "ComplianceIssueRaised",
    COMPLIANCE_ISSUE_RAISED_TYPE,
    ComplianceIssueRaisedData,
    ["issue_id"],
  ),
  ReturnStatusUpdated: spec(
    "ReturnStatusUpdated",
    RETURN_STATUS_UPDATED_TYPE,
    ReturnStatusUpdatedData,
    ["return_code", "period", "status"],
  ),
  PolicyAttested: spec("PolicyAttested", POLICY_ATTESTED_TYPE, PolicyAttestedData, [
    "policy_id",
    "version",
    "user_ref",
  ]),
  SecurityIncidentNotified: spec(
    "SecurityIncidentNotified",
    SECURITY_INCIDENT_NOTIFIED_TYPE,
    SecurityIncidentNotifiedData,
    ["incident_id", "update_seq"],
  ),
});
export type GrcEventName = keyof typeof GRC_EVENTS;

/** The idempotency key of one event's data, as `field=value` pairs joined by `|`. */
export function grcIdempotencyKey(name: GrcEventName, data: Record<string, unknown>): string {
  return GRC_EVENTS[name].idempotency.map((f) => `${f}=${String(data[f])}`).join("|");
}
