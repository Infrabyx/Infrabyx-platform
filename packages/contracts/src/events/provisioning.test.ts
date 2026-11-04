// Spec v1.3 §6.29 provisioning payloads (PR-040, OWNER-QUESTIONS #105; R1-plan M38; R1-D-70).
import { describe, expect, it } from "vitest";
import {
  PROVISIONING_FAILURE_REASONS,
  ProvisioningFailedData,
  ProvisioningRequestedData,
  RETRYABLE_PROVISIONING_FAILURES,
} from "./provisioning.js";

const request = {
  provisioning_request_id: "01934f6e-2a3b-7c4d-8e5f-0a1b2c3d4e5f",
  provisional_tenant_id: "tnt_01JBQ0000000000000000000PV",
  product: "LAWDOCSCOMPLY",
  environment: "UAT",
  plan_id: "pln_trial",
  modules: ["grc"],
  home_cell: "in-mum-1",
  org_name: "Acme Advisory LLP",
  consent_ref: "cns_terms_1",
  first_admin_email: "admin@acme.example",
  requested_at: "2026-11-04T10:00:00+05:30",
};
const failure = {
  provisioning_request_id: request.provisioning_request_id,
  provisional_tenant_id: request.provisional_tenant_id,
  product: "LAWDOCSCOMPLY",
  environment: "UAT",
  reason_code: "KYB_FAILED",
  retryable: false,
  failed_at: "2026-11-05T10:00:00+05:30",
};

describe("R1-D-70 ProvisioningRequested and ProvisioningFailed (Spec v1.3 §6.29)", () => {
  it("takes a request with a UUIDv7 id and a provisional tenant id, and no unknown fields", () => {
    expect(ProvisioningRequestedData.parse(request)).toEqual(request);
    expect(
      ProvisioningRequestedData.safeParse({ ...request, provisioning_request_id: "req_1" }).success,
    ).toBe(false);
    expect(ProvisioningRequestedData.safeParse({ ...request, password: "x" }).success).toBe(false);
  });

  it("holds `retryable` to the code table: true only for the four retryable reasons", () => {
    expect([...RETRYABLE_PROVISIONING_FAILURES].sort()).toEqual(
      ["EXPIRED", "PLAN_UNAVAILABLE", "PRODUCT_FAILED", "RESIDENCY_UNAVAILABLE"].sort(),
    );
    for (const reason_code of PROVISIONING_FAILURE_REASONS) {
      const retryable = RETRYABLE_PROVISIONING_FAILURES.has(reason_code);
      expect(ProvisioningFailedData.safeParse({ ...failure, reason_code, retryable }).success).toBe(
        true,
      );
      expect(
        ProvisioningFailedData.safeParse({ ...failure, reason_code, retryable: !retryable })
          .success,
      ).toBe(false);
    }
    expect(ProvisioningFailedData.safeParse({ ...failure, detail: "x".repeat(501) }).success).toBe(
      false,
    );
  });
});
