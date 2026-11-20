import { describe, expect, it } from "vitest";
import { REGULATED_MESSAGE_EVENTS, isRegulatedMessage } from "./regulated.js";

describe("regulated messages (Ecosystem Spec §3.6; G5)", () => {
  it("lists the Spec's 19 + 25 + 11 + 2 + 2 names once each", () => {
    expect(REGULATED_MESSAGE_EVENTS).toHaveLength(59);
    expect(new Set(REGULATED_MESSAGE_EVENTS).size).toBe(59);
  });
  it("R1-D-236 adds v1.6's execution pack and cooling-off exit answer (PR-047, owner-approved)", () => {
    expect(REGULATED_MESSAGE_EVENTS.slice(-2)).toEqual([
      "ExecutionPackIssued",
      "CoolingOffExitAnswered",
    ]);
    expect(isRegulatedMessage("in.infrabyx.origination.ExecutionPackIssued.v1")).toBe(true);
    expect(isRegulatedMessage("in.infrabyx.servicing.CoolingOffExitAnswered.v1")).toBe(true);
    expect(isRegulatedMessage("in.infrabyx.servicing.CoolingOffExitRequested.v1")).toBe(false);
  });
  it("R1-D-70 adds v1.3's provisioning request and failure (PR-040, #105)", () => {
    expect(isRegulatedMessage("in.infrabyx.ops.ProvisioningRequested.v1")).toBe(true);
    expect(isRegulatedMessage("in.infrabyx.ops.ProvisioningFailed.v1")).toBe(true);
  });
  it("matches an Ecosystem type by its event name only", () => {
    expect(isRegulatedMessage("in.infrabyx.origination.DecisionMade.v1")).toBe(true);
    expect(isRegulatedMessage("in.infrabyx.platform.ExportCompleted.v2")).toBe(true);
    expect(isRegulatedMessage("in.infrabyx.origination.ApplicationSubmitted.v1")).toBe(false);
    expect(isRegulatedMessage("in.ld.hello.DecisionMade.v1")).toBe(false);
    expect(isRegulatedMessage("DecisionMade")).toBe(false);
  });
});
