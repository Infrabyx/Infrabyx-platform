// Customer sign-in contracts (R1-D-19): the login each channel proves.
import { describe, expect, it } from "vitest";
import { CUSTOMER_OTP_CHANNELS, customerLogin } from "./identity.js";

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
