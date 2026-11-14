// EvidenceSubmitted (§6.15) and ProviderIncident (§6.16) payloads (PR-LDC-45, PR-LDC-51; R1-D-138).
import { describe, expect, it } from "vitest";
import {
  EvidenceSubmittedData,
  OBLIGATION_PUBLISHED_TYPE,
  ObligationPublishedData,
  obligationPublishedProblems,
  PROVIDER_INCIDENT_SEVERITIES,
  ProviderIncidentData,
} from "./spec-events.js";

const evidence = {
  evidence_id: "evd_01JAZ",
  control_id: "ctl.access_review",
  artefacts: [{ uri: "storage:tenant/tnt_a/evidence/review.pdf", sha256: "a".repeat(64) }],
  signer: { type: "user", id: "usr_reviewer" },
  collected_at: "2026-11-12T10:00:00+05:30",
};
const incident = {
  incident_id: "inc_01JAZ",
  product: "ldc",
  port: "EMAIL",
  adapter: "ses",
  residency: "IN",
  severity: "SEV2",
  started_at: "2026-11-12T10:00:00Z",
  status: "OPEN",
  affected_capabilities: ["notify.email.send"],
};

describe("spec events", () => {
  it("EvidenceSubmitted takes references and hashes, never files or names", () => {
    expect(EvidenceSubmittedData.safeParse(evidence).success).toBe(true);
    expect(
      EvidenceSubmittedData.safeParse({
        ...evidence,
        artefacts: [{ uri: "http://x", sha256: "a".repeat(64) }],
      }).success,
    ).toBe(false);
    expect(EvidenceSubmittedData.safeParse({ ...evidence, artefacts: [] }).success).toBe(false);
    expect(
      EvidenceSubmittedData.safeParse({
        ...evidence,
        period: { from: "2026-12-01", to: "2026-11-01" },
      }).success,
    ).toBe(false);
  });
  it("ProviderIncident is INTERNAL and never carries tenant ids", () => {
    expect(ProviderIncidentData.safeParse(incident).success).toBe(true);
    expect(ProviderIncidentData.safeParse({ ...incident, extra: 1 }).success).toBe(true);
    for (const k of ["tenant_id", "tenant_ids", "tenantid"])
      expect(ProviderIncidentData.safeParse({ ...incident, [k]: ["tnt_a"] }).success, k).toBe(
        false,
      );
    expect(ProviderIncidentData.safeParse({ ...incident, status: "CLOSED" }).success).toBe(false);
  });
  it("ProviderIncident severity is the owner's SEV1 (most severe) to SEV4 scale (#131)", () => {
    expect(PROVIDER_INCIDENT_SEVERITIES).toEqual(["SEV1", "SEV2", "SEV3", "SEV4"]);
    for (const severity of PROVIDER_INCIDENT_SEVERITIES)
      expect(ProviderIncidentData.safeParse({ ...incident, severity }).success, severity).toBe(
        true,
      );
    for (const severity of ["CRITICAL", "HIGH", "S1", "SEV0", "SEV5", "sev1"])
      expect(ProviderIncidentData.safeParse({ ...incident, severity }).success, severity).toBe(
        false,
      );
  });
});

describe("ObligationPublished (spec v1.5 §6.15; certification test 'Obligation feed (v1.5)')", () => {
  const data = {
    obligation_ref: "obl_01JCZ3V9K2Q7M8N4P5R6S7T8V9",
    business_id: "OBL-2026-0042",
    version: 2,
    change_type: "AMENDED",
    instrument_ref: "Notification G.S.R. 123(E)",
    authority: "MCA",
    family: "companies.board",
    effective_from: "2026-12-01",
    release_id: "2026.11.2",
    applicability_keys: ["entity:private_company", "activity:board_meeting"],
  };
  const event = (d: unknown, over: Record<string, unknown> = {}) => ({
    type: OBLIGATION_PUBLISHED_TYPE,
    subject: data.obligation_ref,
    dataclass: "INTERNAL",
    data: d,
    ...over,
  });
  it("accepts ids and keys only", () => {
    expect(ObligationPublishedData.safeParse(data).success).toBe(true);
    expect(obligationPublishedProblems(event(data))).toEqual([]);
  });
  it("refuses text, free-text applicability, unknown fields and bad dates", () => {
    for (const bad of [
      { ...data, text: "The board shall meet at least four times a year." },
      { ...data, applicability_keys: ["All private companies with paid-up capital"] },
      { ...data, owner: "usr_a" },
      { ...data, change_type: "REPEALED" },
      { ...data, effective_to: "2026-11-30" },
      { ...data, version: 0 },
      { ...data, obligation_ref: "OBL-1" },
      { ...data, applicability_keys: ["a.b", "a.b"] },
    ])
      expect(ObligationPublishedData.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(
      ObligationPublishedData.safeParse({
        ...data,
        change_type: "REPEALED",
        effective_to: "2027-03-31",
      }).success,
    ).toBe(true);
  });
  it("refuses a dataclass other than INTERNAL and a subject that is not the obligation", () => {
    expect(obligationPublishedProblems(event(data, { dataclass: "CONFIDENTIAL" }))).toContain(
      "dataclass must be INTERNAL",
    );
    expect(obligationPublishedProblems(event(data, { subject: "obl_other" }))).toContain(
      "subject must be the obligation_ref",
    );
    expect(obligationPublishedProblems(event({ ...data, text: "x" })).length).toBeGreaterThan(0);
  });
});
