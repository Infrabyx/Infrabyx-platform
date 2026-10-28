import { describe, expect, it } from "vitest";
import { REGULATED_MESSAGE_EVENTS, isRegulatedMessage } from "./regulated.js";

describe("regulated messages (Ecosystem Spec §3.6; G5)", () => {
  it("lists the Spec's 19 + 25 + 11 names once each", () => {
    expect(REGULATED_MESSAGE_EVENTS).toHaveLength(55);
    expect(new Set(REGULATED_MESSAGE_EVENTS).size).toBe(55);
  });
  it("matches an Ecosystem type by its event name only", () => {
    expect(isRegulatedMessage("in.infrabyx.origination.DecisionMade.v1")).toBe(true);
    expect(isRegulatedMessage("in.infrabyx.platform.ExportCompleted.v2")).toBe(true);
    expect(isRegulatedMessage("in.infrabyx.origination.ApplicationSubmitted.v1")).toBe(false);
    expect(isRegulatedMessage("in.ld.hello.DecisionMade.v1")).toBe(false);
    expect(isRegulatedMessage("DecisionMade")).toBe(false);
  });
});
