// Customer sign-in contracts (R1-D-19): the login each channel proves; the step-up policies a
// product declares per sensitive action (PR-UDF-056; R1-D-244).
import { describe, expect, it } from "vitest";
import {
  CUSTOMER_ACR_VALUES,
  CUSTOMER_OTP_CHANNELS,
  CUSTOMER_STEP_UP_DEFAULT,
  customerLogin,
  CustomerStepUpPolicy,
  customerStepUpPolicies,
} from "./identity.js";

describe("customer logins (R1-D-19)", () => {
  it("SMS and WhatsApp prove an E.164 mobile number, email an address", () => {
    expect(CUSTOMER_OTP_CHANNELS).toEqual(["sms", "whatsapp", "email"]);
    expect(customerLogin("sms", " +919812345678 ")).toBe("+919812345678");
    expect(customerLogin("whatsapp", "+14155550100")).toBe("+14155550100");
    expect(customerLogin("email", " Asha.R@Example.TEST ")).toBe("asha.r@example.test");
    expect(() => customerLogin("sms", "9812345678")).toThrow();
    expect(() => customerLogin("sms", "asha@example.test")).toThrow();
    expect(() => customerLogin("email", "+919812345678")).toThrow();
  });
});

describe("customer step-up policies (PR-UDF-056; R1-D-244)", () => {
  it("default to a fresh one-time code within 300 s, bounded 60 to 3600 s", () => {
    expect(CUSTOMER_ACR_VALUES).toEqual(["otp"]);
    expect(CUSTOMER_STEP_UP_DEFAULT).toEqual({ acr: "otp", maxAgeSeconds: 300 });
    expect(Object.isFrozen(CUSTOMER_STEP_UP_DEFAULT)).toBe(true);
    expect(CustomerStepUpPolicy.parse({})).toEqual(CUSTOMER_STEP_UP_DEFAULT);
    expect(CustomerStepUpPolicy.parse({ maxAgeSeconds: 60 }).maxAgeSeconds).toBe(60);
    for (const bad of [
      { maxAgeSeconds: 59 },
      { maxAgeSeconds: 3601 },
      { maxAgeSeconds: 120.5 },
      { acr: "pwd" },
      { acr: "otp", extra: true },
    ])
      expect(CustomerStepUpPolicy.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it("a product's table is validated and frozen at boot", () => {
    const t = customerStepUpPolicies({
      "document.original.download": {},
      "loan.agreement.view": { maxAgeSeconds: 900 },
    });
    expect(t["document.original.download"]).toEqual({ acr: "otp", maxAgeSeconds: 300 });
    expect(t["loan.agreement.view"]).toEqual({ acr: "otp", maxAgeSeconds: 900 });
    expect(Object.isFrozen(t)).toBe(true);
    expect(Object.isFrozen(t["loan.agreement.view"])).toBe(true);
    expect(() => customerStepUpPolicies({ "Document Download": {} })).toThrow(TypeError);
    expect(() => customerStepUpPolicies({ "document.download": { maxAgeSeconds: 10 } })).toThrow(
      /maxAgeSeconds/,
    );
  });
});
