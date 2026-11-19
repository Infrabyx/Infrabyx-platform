// KYC port schemas for DigiLocker (PR-UDF-040, R1-D-193): the start request and its return address.
import { describe, expect, it } from "vitest";
import { payloadClass } from "./payload-class.js";
import {
  DIGILOCKER_RETURN_URL_REFUSED,
  DigilockerPull,
  StartDigilocker,
  digilockerReturnUrlAllowed,
} from "./kyc.js";

const hosts = ["kyc.example.com"];

describe("PR-UDF-040: startDigilocker and its return address", () => {
  it("StartDigilocker takes the document types and a return address, nothing else", () => {
    expect(
      StartDigilocker.parse({ docTypes: ["PANCR"], returnUrl: "https://kyc.example.com/done" }),
    ).toEqual({ docTypes: ["PANCR"], returnUrl: "https://kyc.example.com/done" });
    for (const bad of [
      { docTypes: [], returnUrl: "https://kyc.example.com/done" },
      { docTypes: ["XXXXX"], returnUrl: "https://kyc.example.com/done" },
      { docTypes: ["PANCR"] },
      { docTypes: ["PANCR"], returnUrl: "https://kyc.example.com/done", consentSession: "x" },
      { docTypes: ["PANCR"], returnUrl: `https://kyc.example.com/${"a".repeat(2048)}` },
    ])
      expect(StartDigilocker.safeParse(bad).success).toBe(false);
    expect(payloadClass(StartDigilocker).bodyHighest).toBe("CONFIDENTIAL");
    expect(payloadClass(DigilockerPull).bodyHighest).toBe("REGULATED");
  });

  it("a return address is https, without user information or a 12-digit run, on a listed host", () => {
    expect(digilockerReturnUrlAllowed("https://kyc.example.com/done?j=abc", hosts)).toBe(true);
    expect(digilockerReturnUrlAllowed("https://KYC.example.com/done", hosts)).toBe(true);
    expect(digilockerReturnUrlAllowed("https://kyc.example.com:8443/done", hosts)).toBe(true);
    for (const bad of [
      "http://kyc.example.com/done",
      "https://other.example.com/done",
      "https://evil.kyc.example.com/done",
      "https://kyc.example.com.evil.test/done",
      "https://user:pw@kyc.example.com/done",
      "https://user@kyc.example.com/done",
      "https://kyc.example.com/done?ref=234567890123",
      "javascript:alert(1)",
      "not a url",
    ])
      expect(digilockerReturnUrlAllowed(bad, hosts)).toBe(false);
    expect(digilockerReturnUrlAllowed("https://kyc.example.com/done", [])).toBe(false);
    expect(DIGILOCKER_RETURN_URL_REFUSED).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
  });
});
