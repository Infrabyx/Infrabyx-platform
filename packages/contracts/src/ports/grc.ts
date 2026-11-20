// GRC port (Finbyx PR-FBX-51, R1-D-220, ADR-0013; IPB-01 §01.4.4.0): a product's link to a GRC
// system of record on the Ecosystem Specification's generic connector contract (§9.2): LawDocsComply
// (§9.3), Finbyx's embedded module, or a regulated entity's own tool through a certified adapter
// (§9.1 compliance modes). REST with JSON Schema 2020-12 bodies, cursor pagination, and an
// `Idempotency-Key` on every POST. The port pulls obligations (`GET /v1/grc/obligations?updated_since=`,
// §6.15) and pushes the §6.15 events' data as the §9.2 resources: control test results, evidence,
// issues, incidents, return statuses and policy attestations, each body one of the event schemas in
// `@infrabyx/contracts/events` (`GRC_EVENTS`).
//
// §9.2's rules every adapter keeps: a GRC system holds references and hashes, aggregate counts and
// masked sample ids, never raw personal data (every body is swept for an Aadhaar-like number or a
// PAN before any call, `IPB-PORT-003` `personal_data`); evidence stays in India in the producing
// product, the GRC system holding its reference and SHA-256; the port is `IN` and carries at most
// CONFIDENTIAL. A POST's idempotency key is the caller's `call.idempotencyKey`, else the event's own
// Specification key (`grcIdempotencyKey`), so a resend is always keyed: the same key and body answer
// the same receipt, the key with another body is `IPB-PORT-004`. Incident updates are taken in
// `update_seq` order: an update at or below one already taken (with another body) is `out_of_order`.
// No vendor is chosen: the reference adapter `generic-grc` speaks the contract to one configured
// counterparty, off and unproven until a counterparty sandbox exists; the fake in @infrabyx/fakes and
// the contract cases in @infrabyx/testing define the behaviour. OSCAL export (§9.4) is not built.
import { z } from "zod";
import { atLeast } from "../data-class.js";
import { PortError, type IpbErrorCode } from "../errors.js";
import {
  ComplianceIssueRaisedData,
  ControlTestResultPublishedData,
  PolicyAttestedData,
  ReturnStatusUpdatedData,
  SecurityIncidentNotifiedData,
  grcIdempotencyKey,
  grcPersonalDataProblems,
  type GrcEventName,
} from "../events/grc-events.js";
import { EvidenceSubmittedData } from "../events/spec-events.js";
import type { Port, PortCall } from "./common.js";
import { effectiveDataClass } from "./payload-class.js";

const PORT = "GRC";

/** The §9.2 resources this port reads or writes (Control, OutsourcingArrangement, KRI are pulled by products directly when needed). */
export const GRC_RESOURCES = [
  "Obligation",
  "ControlTestResult",
  "Evidence",
  "Issue",
  "Incident",
  "RegulatoryReturn",
  "PolicyAttestation",
] as const;
export type GrcResource = (typeof GRC_RESOURCES)[number];

/** The obligations pull §6.15 names. */
export const GRC_OBLIGATIONS_PATH = "/v1/grc/obligations";

/**
 * Each POST method: the §6.15 event whose data it carries, the §9.2 resource and its path. The paths
 * other than the obligations pull are STUB-SHAPED ([VERIFY] against the first counterparty).
 */
export const GRC_POST_METHODS = {
  publishControlTestResult: {
    event: "ControlTestResultPublished",
    resource: "ControlTestResult",
    path: "/v1/grc/control-test-results",
  },
  submitEvidence: { event: "EvidenceSubmitted", resource: "Evidence", path: "/v1/grc/evidence" },
  raiseIssue: { event: "ComplianceIssueRaised", resource: "Issue", path: "/v1/grc/issues" },
  notifyIncident: {
    event: "SecurityIncidentNotified",
    resource: "Incident",
    path: "/v1/grc/incidents",
  },
  updateReturnStatus: {
    event: "ReturnStatusUpdated",
    resource: "RegulatoryReturn",
    path: "/v1/grc/returns",
  },
  recordPolicyAttestation: {
    event: "PolicyAttested",
    resource: "PolicyAttestation",
    path: "/v1/grc/policy-attestations",
  },
} as const satisfies Record<
  string,
  { event: GrcEventName; resource: GrcResource; path: `/v1/grc/${string}` }
>;
export type GrcPostMethod = keyof typeof GRC_POST_METHODS;

const POST_SCHEMAS: Readonly<Record<GrcPostMethod, z.ZodType>> = {
  publishControlTestResult: ControlTestResultPublishedData,
  submitEvidence: EvidenceSubmittedData,
  raiseIssue: ComplianceIssueRaisedData,
  notifyIncident: SecurityIncidentNotifiedData,
  updateReturnStatus: ReturnStatusUpdatedData,
  recordPolicyAttestation: PolicyAttestedData,
};

/**
 * The fixed `meta.reason` labels an adapter refuses with: `adapter_disabled` and
 * `adapter_unconfigured` (`IPB-PORT-001`), `data_class` and `personal_data` (`IPB-PORT-003`: a call
 * class above CONFIDENTIAL or below the port default, or a body holding personal data),
 * `idempotency_conflict` (`IPB-PORT-004`), `out_of_order` (an incident update at or below one
 * already taken), `invalid_cursor` and `unsupported` (`IPB-PORT-001`).
 */
export const GRC_REFUSALS = [
  "adapter_disabled",
  "adapter_unconfigured",
  "data_class",
  "personal_data",
  "idempotency_conflict",
  "out_of_order",
  "invalid_cursor",
  "unsupported",
] as const;
export type GrcRefusal = (typeof GRC_REFUSALS)[number];

/** At most this many obligations in one page. */
export const GRC_MAX_PAGE = 200;

const at = z.iso.datetime({ offset: true });
/** An opaque cursor as the GRC system gave it (URL-safe). */
const cursor = z.string().regex(/^[A-Za-z0-9_.~=-]{1,512}$/, "an opaque URL-safe cursor");
/** An Idempotency-Key header value (printable ASCII, no quote or backslash). */
export const GRC_IDEMPOTENCY_KEY = /^[\x21\x23-\x5B\x5D-\x7E][\x20\x21\x23-\x5B\x5D-\x7E]{0,254}$/;

export const GrcObligationQuery = z
  .object({
    /** Only obligations changed at or after this time. */
    updatedSince: at.optional(),
    /** The `nextCursor` of the previous page; the query's other fields stay the same. */
    cursor: cursor.optional(),
    limit: z.number().int().min(1).max(GRC_MAX_PAGE).optional(),
  })
  .strict();
export type GrcObligationQuery = z.input<typeof GrcObligationQuery>;

export const GRC_OBLIGATION_STATUSES = ["ACTIVE", "REPEALED"] as const;

/**
 * §9.2 `Obligation`, as the port returns it: references, the text's hash and dates, never the text
 * (a product that shows it fetches it from the GRC system's own UI or API). Fields beyond these are
 * dropped.
 */
export const GrcObligation = z.object({
  obligation_ref: z.string().regex(/^obl_[0-9A-HJKMNP-TV-Z]{26}$/, "obl_ + ULID"),
  version: z.number().int().min(1),
  /** The instrument's paragraph, e.g. `CF para 13(1)`. */
  paragraph: z
    .string()
    .regex(/^[\x20-\x7E]{1,128}$/)
    .optional(),
  text_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  applicability_keys: z.array(z.string().regex(/^[a-z0-9_.:]{2,64}$/)).max(64),
  effective_from: z.iso.date(),
  effective_to: z.iso.date().optional(),
  /** The owning role's code, never a person. */
  owner_role: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{1,63}$/)
    .optional(),
  status: z.enum(GRC_OBLIGATION_STATUSES),
  updated_at: at,
});
export type GrcObligation = z.infer<typeof GrcObligation>;

export interface GrcObligationPage {
  items: GrcObligation[];
  /** Present when more obligations follow; pass it as `cursor` with the same query. */
  nextCursor?: string;
}

/** What the GRC system answered a POST with. */
export interface GrcReceipt {
  resource: GrcResource;
  /** The GRC system's own reference for the record. */
  ref: string;
  /** The key the POST carried (`call.idempotencyKey`, else the event's Specification key). */
  idempotencyKey: string;
  adapter: string;
  receivedAt: string;
}

export const GrcReceiptSchema = z
  .object({
    resource: z.enum(GRC_RESOURCES),
    ref: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
    idempotencyKey: z.string().regex(GRC_IDEMPOTENCY_KEY),
    adapter: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
    receivedAt: at,
  })
  .strict();

export interface GrcPort extends Port {
  /** One page of obligations, oldest change first; follow `nextCursor` until it is absent. */
  listObligations(q?: GrcObligationQuery, call?: PortCall): Promise<GrcObligationPage>;
  /** `ControlTestResultPublished` data → `ControlTestResult` (key: control_id, run_id). */
  publishControlTestResult(d: ControlTestResultPublishedData, call?: PortCall): Promise<GrcReceipt>;
  /** `EvidenceSubmitted` data → `Evidence` (key: evidence_id); references and SHA-256s only. */
  submitEvidence(d: EvidenceSubmittedData, call?: PortCall): Promise<GrcReceipt>;
  /** `ComplianceIssueRaised` data → `Issue` (key: issue_id). */
  raiseIssue(d: ComplianceIssueRaisedData, call?: PortCall): Promise<GrcReceipt>;
  /** `SecurityIncidentNotified` data → `Incident` (key: incident_id, update_seq), in `update_seq` order. */
  notifyIncident(d: SecurityIncidentNotifiedData, call?: PortCall): Promise<GrcReceipt>;
  /** `ReturnStatusUpdated` data → `RegulatoryReturn` (key: return_code, period, status). */
  updateReturnStatus(d: ReturnStatusUpdatedData, call?: PortCall): Promise<GrcReceipt>;
  /** `PolicyAttested` data → `PolicyAttestation` (key: policy_id, version, user_ref). */
  recordPolicyAttestation(d: PolicyAttestedData, call?: PortCall): Promise<GrcReceipt>;
}

// ---- shared by every adapter and the fake ------------------------------------------------------

/** A refusal with its fixed label (`meta.reason`), definite: nothing was sent to a GRC system. */
export function grcRefusal(
  code: IpbErrorCode,
  adapter: string,
  reason: GrcRefusal,
  detail: string,
): PortError {
  return new PortError(code, PORT, { adapter, detail, meta: { reason, definite: true } });
}

/**
 * The call's class: at least the port default (a caller may not lower it) and at most CONFIDENTIAL
 * (a GRC system holds no personal data, §9.2). Every adapter checks this first.
 */
export function assertGrcClass(adapter: string, call?: PortCall): void {
  let cls;
  try {
    cls = effectiveDataClass(PORT, call);
  } catch {
    throw grcRefusal("IPB-PORT-003", adapter, "data_class", "a caller may not lower the class");
  }
  if (atLeast(cls, "REGULATED"))
    throw grcRefusal(
      "IPB-PORT-003",
      adapter,
      "data_class",
      `a GRC system holds references and hashes only, never ${cls} data (§9.2)`,
    );
}

/** A POST, checked and keyed: what an adapter sends. */
export interface GrcPost {
  method: GrcPostMethod;
  resource: GrcResource;
  path: string;
  /** The parsed data, unknown fields kept (the Specification's schemas pass them through). */
  data: Record<string, unknown>;
  idempotencyKey: string;
}

/**
 * The checks every adapter makes before a POST, in order: the class; no personal data anywhere in
 * the body (before the schema, so an invalid body holding one is still refused `personal_data`);
 * the event schema (a ZodError); the key (the caller's, else the event's own).
 */
export function prepareGrcPost(
  adapter: string,
  method: GrcPostMethod,
  raw: unknown,
  call?: PortCall,
): GrcPost {
  assertGrcClass(adapter, call);
  const found = grcPersonalDataProblems(raw);
  if (found.length > 0)
    throw grcRefusal("IPB-PORT-003", adapter, "personal_data", found.join("; "));
  const m = GRC_POST_METHODS[method];
  const data = POST_SCHEMAS[method].parse(raw) as Record<string, unknown>;
  const idempotencyKey = call?.idempotencyKey ?? grcIdempotencyKey(m.event, data);
  if (!GRC_IDEMPOTENCY_KEY.test(idempotencyKey))
    throw new PortError("IPB-PORT-001", PORT, {
      adapter,
      detail: "an idempotency key is 1 to 255 printable characters, no quote or backslash",
    });
  return { method, resource: m.resource, path: m.path, data, idempotencyKey };
}

/** The obligation query, checked. */
export function prepareGrcObligationQuery(
  adapter: string,
  q: GrcObligationQuery | undefined,
  call?: PortCall,
): z.output<typeof GrcObligationQuery> {
  assertGrcClass(adapter, call);
  return GrcObligationQuery.parse(q ?? {});
}
