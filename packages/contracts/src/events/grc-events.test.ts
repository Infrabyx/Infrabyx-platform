// PR-FBX-51 (R1-D-220): the §6.15 GRC event schemas. Every Aadhaar-like number here is made at run
// time from a fixed stem and its Verhoeff check digit; the PAN is a made-up test value.
import { describe, expect, it } from "vitest";
import { findAadhaarLike, verhoeffValid } from "../aadhaar.js";
import { ECOSYSTEM_TYPE_REGEX } from "./envelope.js";
import {
  ComplianceIssueRaisedData,
  ControlTestResultPublishedData,
  GRC_EVENTS,
  GRC_MASKED_ID,
  PolicyAttestedData,
  RETURN_PERIOD,
  ReturnStatusUpdatedData,
  SecurityIncidentNotifiedData,
  grcIdempotencyKey,
  grcPersonalDataProblems,
  securityIncidentClockCopy,
} from "./grc-events.js";
import { PROVIDER_INCIDENT_SEVERITIES } from "./spec-events.js";

const H = "a".repeat(64);
const T = "2026-11-20T10:00:00+05:30";
const withCheck = (stem: string): string => {
  for (let d = 0; d < 10; d++) if (verhoeffValid(`${stem}${d}`)) return `${stem}${d}`;
  throw new RangeError("no check digit");
};
const UID = withCheck("23456789012");
const PAN = "ABCPE1234F";

const ctr = {
  control_id: "ctl_kfs_before_execution",
  run_id: "run_2026_11_20",
  period: { from: "2026-11-01", to: "2026-11-19" },
  result: "FAIL",
  population_count: 1200,
  sample_count: 25,
  exception_count: 2,
  masked_sample_ids: ["ln_XXXXXXXX4821", "ln_XXXXXXXX0097"],
  evidence: [{ uri: "storage:tenant/tnt_fbx/grc/01JA0000000000000000000001.json", sha256: H }],
  automated: true,
  tested_at: T,
};
const issue = {
  issue_id: "iss_01",
  source: "TEST",
  source_ref: "run_2026_11_20",
  control_id: "ctl_kfs_before_execution",
  severity: "SEV2",
  owner: { role: "COMPLIANCE_OFFICER", ref: "usr_01JA" },
  due: "2026-12-01",
  raised_at: T,
};
const ret = {
  return_code: "DNBS10",
  period: "2026-Q3",
  status: "ACKNOWLEDGED",
  ack_ref: "ACK-2026-000123",
  status_at: T,
};
const att = {
  policy_id: "pol_fair_practices",
  version: "3.1",
  user_ref: "usr_01JA",
  attested_at: T,
};
const inc = {
  incident_id: "inc_01",
  update_seq: 1,
  detected_at: T,
  class: "UNAUTHORISED_ACCESS",
  affected_data_categories: ["CONTACT_DETAILS"],
  status: "OPEN",
  notified_re_at: "2026-11-20T11:00:00+05:30",
};

describe("§6.15 GRC events (PR-FBX-51)", () => {
  it("names every type as an Ecosystem grc type, v1, keyed by the Specification's fields", () => {
    for (const [name, s] of Object.entries(GRC_EVENTS)) {
      expect(s.type).toMatch(ECOSYSTEM_TYPE_REGEX);
      expect(s.type).toBe(`in.infrabyx.grc.${name}.v1`);
      expect(s.regulated).toBe(false);
    }
    expect(GRC_EVENTS.ControlTestResultPublished.idempotency).toEqual(["control_id", "run_id"]);
    expect(GRC_EVENTS.ReturnStatusUpdated.idempotency).toEqual(["return_code", "period", "status"]);
    expect(GRC_EVENTS.SecurityIncidentNotified.idempotency).toEqual(["incident_id", "update_seq"]);
    expect(GRC_EVENTS.ObligationPublished.direction).toBe("FROM_GRC");
    expect(grcIdempotencyKey("PolicyAttested", att)).toBe(
      "policy_id=pol_fair_practices|version=3.1|user_ref=usr_01JA",
    );
  });

  it("takes the Specification's fields", () => {
    expect(ControlTestResultPublishedData.safeParse(ctr).success).toBe(true);
    expect(ComplianceIssueRaisedData.safeParse(issue).success).toBe(true);
    expect(ReturnStatusUpdatedData.safeParse(ret).success).toBe(true);
    expect(PolicyAttestedData.safeParse(att).success).toBe(true);
    expect(SecurityIncidentNotifiedData.safeParse(inc).success).toBe(true);
    // Unknown fields pass, as for the other Ecosystem schemas.
    expect(PolicyAttestedData.safeParse({ ...att, channel: "WEB" }).success).toBe(true);
  });

  it("refuses wrong types, bad enums and inconsistent counts", () => {
    const bad: Array<[{ safeParse(v: unknown): { success: boolean } }, unknown]> = [
      [ControlTestResultPublishedData, { ...ctr, result: "PASSED" }],
      [ControlTestResultPublishedData, { ...ctr, population_count: 1.5 }],
      [ControlTestResultPublishedData, { ...ctr, sample_count: 1300 }],
      [ControlTestResultPublishedData, { ...ctr, result: "PASS" }],
      [ControlTestResultPublishedData, { ...ctr, masked_sample_ids: ["ln_01JA4821"] }],
      [ControlTestResultPublishedData, { ...ctr, evidence: [{ uri: "ftp://x", sha256: H }] }],
      [ControlTestResultPublishedData, { ...ctr, evidence: [{ uri: "storage:x", sha256: "X" }] }],
      [ControlTestResultPublishedData, { ...ctr, tested_at: "2026-11-20T10:00:00" }],
      [ComplianceIssueRaisedData, { ...issue, source: "WHISTLEBLOWER" }],
      [ComplianceIssueRaisedData, { ...issue, severity: "1" }],
      [ComplianceIssueRaisedData, { ...issue, owner: { role: "Asha Rao" } }],
      [ComplianceIssueRaisedData, { ...issue, due: "1 Dec 2026" }],
      [ReturnStatusUpdatedData, { ...ret, status: "SUBMITTED" }],
      [ReturnStatusUpdatedData, { ...ret, ack_ref: undefined }],
      [ReturnStatusUpdatedData, { ...ret, status: "FILED" }],
      [ReturnStatusUpdatedData, { ...ret, period: "Q3 2026" }],
      [PolicyAttestedData, { ...att, user_ref: "asha@example.in" }],
      [PolicyAttestedData, { ...att, user_ref: "Asha Rao" }],
      [PolicyAttestedData, { ...att, version: 3 }],
      [SecurityIncidentNotifiedData, { ...inc, update_seq: 0 }],
      [SecurityIncidentNotifiedData, { ...inc, class: "BREACH" }],
      [SecurityIncidentNotifiedData, { ...inc, status: "DETECTED" }],
      [SecurityIncidentNotifiedData, { ...inc, affected_data_categories: ["email addresses"] }],
      [SecurityIncidentNotifiedData, { ...inc, notified_re_at: "2026-11-20T09:00:00+05:30" }],
    ];
    for (const [schema, v] of bad)
      expect(schema.safeParse(v).success, JSON.stringify(v)).toBe(false);
    expect(PROVIDER_INCIDENT_SEVERITIES).toContain(issue.severity);
    for (const p of ["2026", "2026-11", "2026-11-20", "2026-Q4", "2026-H1", "FY2026-27"])
      expect(RETURN_PERIOD.test(p), p).toBe(true);
    expect(GRC_MASKED_ID.test("XXXX")).toBe(true);
    expect(GRC_MASKED_ID.test("ln_01JA0000004821")).toBe(false);
  });

  it("refuses an Aadhaar-like number or a PAN anywhere in the data, unknown fields included", () => {
    expect(findAadhaarLike(UID)).toHaveLength(1);
    const cases: Array<[{ safeParse(v: unknown): { success: boolean } }, unknown]> = [
      [ControlTestResultPublishedData, { ...ctr, run_id: `run_${UID}` }],
      [ControlTestResultPublishedData, { ...ctr, note: `customer ${UID}` }],
      [ComplianceIssueRaisedData, { ...issue, source_ref: PAN }],
      [ComplianceIssueRaisedData, { ...issue, owner: { role: "CRO", ref: `pan:${PAN}` } }],
      [ReturnStatusUpdatedData, { ...ret, ack_ref: `ACK-${UID}` }],
      [PolicyAttestedData, { ...att, user_ref: `usr_${UID}` }],
      [PolicyAttestedData, { ...att, extra: { pan: PAN } }],
      [SecurityIncidentNotifiedData, { ...inc, incident_id: `inc-${UID}` }],
      [SecurityIncidentNotifiedData, { ...inc, sample: [UID.replace(/(\d{4})(?=\d)/g, "$1 ")] }],
    ];
    for (const [schema, v] of cases)
      expect(schema.safeParse(v).success, JSON.stringify(v)).toBe(false);
    expect(grcPersonalDataProblems(ctr)).toEqual([]);
    expect(grcPersonalDataProblems({ x: PAN, y: UID })).toHaveLength(2);
    // Hex digests are not read as numbers.
    expect(grcPersonalDataProblems({ sha256: `ab${UID}cd${"0".repeat(48)}` })).toEqual([]);
  });

  it("copies an incident to OH13 with the schema's fields only", () => {
    const copy = securityIncidentClockCopy({ ...inc, analyst_note: "see ticket" } as never);
    expect(copy).toEqual(inc);
    expect("analyst_note" in copy).toBe(false);
  });
});
