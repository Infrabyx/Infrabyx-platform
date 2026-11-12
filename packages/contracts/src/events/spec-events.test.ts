// EvidenceSubmitted (§6.15) and ProviderIncident (§6.16) payloads (PR-LDC-45, PR-LDC-51; R1-D-138).
import { describe, expect, it } from "vitest";
import { EvidenceSubmittedData, ProviderIncidentData } from "./spec-events.js";

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
});
