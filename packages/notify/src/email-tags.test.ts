// NOTIFY's email tags must pass the SES adapter's tag rule (names and values [A-Za-z0-9_-],
// `ipb_` reserved for the adapter): the earlier `ipb_class` tag with a dotted class id was refused.
import { describe, expect, it } from "vitest";
import { emailTags } from "./service.js";

const SES_TAG = /^[A-Za-z0-9_-]{1,256}$/;

describe("emailTags", () => {
  it("names the class outside the reserved prefix with an SES-safe value", () => {
    for (const id of ["approval.requested", "auth.otp", "vidhi.schedule.paused", "digest.daily"]) {
      const tags = emailTags(id);
      for (const [name, value] of Object.entries(tags)) {
        expect(name.startsWith("ipb_")).toBe(false);
        expect(name).toMatch(SES_TAG);
        expect(value).toMatch(SES_TAG);
      }
    }
    expect(emailTags("approval.requested")).toEqual({ notify_class: "approval-requested" });
  });
});
