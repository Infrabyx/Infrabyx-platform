// KYC port schemas for DigiLocker (PR-UDF-040, R1-D-193): the start request and its return address;
// and for Aadhaar OTP e-KYC (PR-UDF-041, R1-D-194): the number check and the two requests.
import { describe, expect, it } from "vitest";
import { payloadClass } from "./payload-class.js";
import { verhoeffValid } from "../search-refusal.js";
import {
  AADHAAR_OTP_REFUSALS,
  AadhaarOtpRequest,
  AadhaarOtpVerify,
  KYC_METHODS,
  aadhaarUidValid,
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

/** A test number: `body` with its Verhoeff check digit appended (no real number is committed). */
const withCheck = (body: string): string => {
  for (let d = 0; d < 10; d++) if (verhoeffValid(`${body}${d}`)) return `${body}${d}`;
  throw new Error("no check digit");
};
/** The same number with its last digit changed: the Verhoeff check then fails. */
const badCheck = (n: string): string => `${n.slice(0, -1)}${(Number(n.at(-1)) + 1) % 10}`;

describe("PR-UDF-041: Aadhaar OTP e-KYC schemas and the number check", () => {
  const uid = withCheck("99990000011");
  const vid = withCheck("919900000000001");

  it("an Aadhaar number is 12 digits, first 2 to 9, Verhoeff-valid", () => {
    expect(aadhaarUidValid(uid, "AADHAAR")).toBe(true);
    expect(aadhaarUidValid(badCheck(uid), "AADHAAR")).toBe(false);
    for (const first of ["0", "1"]) {
      const n = withCheck(`${first}9990000011`);
      expect(verhoeffValid(n)).toBe(true);
      expect(aadhaarUidValid(n, "AADHAAR")).toBe(false);
    }
    expect(aadhaarUidValid(withCheck("9999000001"), "AADHAAR")).toBe(false);
    expect(aadhaarUidValid(withCheck("999900000111"), "AADHAAR")).toBe(false);
    // A VID is not an Aadhaar number, nor the reverse.
    expect(aadhaarUidValid(vid, "AADHAAR")).toBe(false);
    expect(aadhaarUidValid(uid, "VID")).toBe(false);
  });

  it("a VID is 16 digits, Verhoeff-valid, any first digit", () => {
    expect(aadhaarUidValid(vid, "VID")).toBe(true);
    expect(aadhaarUidValid(withCheck("019900000000001"), "VID")).toBe(true);
    expect(aadhaarUidValid(badCheck(vid), "VID")).toBe(false);
    expect(aadhaarUidValid(withCheck("91990000000001"), "VID")).toBe(false);
  });

  it("grouped, padded or non-digit forms are refused, not normalised", () => {
    const grouped = [
      `${uid.slice(0, 4)} ${uid.slice(4, 8)} ${uid.slice(8)}`,
      `${uid.slice(0, 4)}-${uid.slice(4, 8)}-${uid.slice(8)}`,
      ` ${uid}`,
      `${uid}\n`,
      uid.replace(/^9/, "\uff19"),
      "",
    ];
    for (const g of grouped) expect(aadhaarUidValid(g, "AADHAAR")).toBe(false);
    expect(
      aadhaarUidValid(
        `${vid.slice(0, 4)} ${vid.slice(4, 8)} ${vid.slice(8, 12)} ${vid.slice(12)}`,
        "VID",
      ),
    ).toBe(false);
  });

  it("the request carries the number, its kind and the consent; nothing else", () => {
    const consent = { version: "1.0", textHash: "a".repeat(64), at: "2026-11-19T05:00:00Z" };
    expect(AadhaarOtpRequest.parse({ uid, uidKind: "AADHAAR", consent })).toEqual({
      uid,
      uidKind: "AADHAAR",
      consent,
    });
    for (const bad of [
      { uid, uidKind: "PAN", consent },
      { uid, uidKind: "AADHAAR" },
      { uid, uidKind: "AADHAAR", consent: { ...consent, textHash: "x" } },
      { uid, uidKind: "AADHAAR", consent: { ...consent, at: "yesterday" } },
      { uid, uidKind: "AADHAAR", consent: { ...consent, extra: 1 } },
      { uid, uidKind: "AADHAAR", consent, mobile: "9999999999" },
      { uid: 1, uidKind: "AADHAAR", consent },
    ])
      expect(AadhaarOtpRequest.safeParse(bad).success).toBe(false);
    // A Zod refusal never carries the number.
    const r = AadhaarOtpRequest.safeParse({
      uid: `${uid}${"9".repeat(60)}`,
      uidKind: "AADHAAR",
      consent,
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).not.toContain(uid);
    expect(payloadClass(AadhaarOtpRequest).bodyHighest).toBe("REGULATED");
    expect(payloadClass(AadhaarOtpRequest).complete).toBe(true);
  });

  it("the verify takes the transaction and a six-digit code", () => {
    expect(AadhaarOtpVerify.parse({ txn: "AOT0000000001", otp: "123456" })).toEqual({
      txn: "AOT0000000001",
      otp: "123456",
    });
    for (const otp of ["12345", "1234567", "12345a", " 123456"])
      expect(AadhaarOtpVerify.safeParse({ txn: "AOT0000000001", otp }).success).toBe(false);
    expect(AadhaarOtpVerify.safeParse({ txn: "short", otp: "123456" }).success).toBe(false);
    expect(payloadClass(AadhaarOtpVerify).bodyHighest).toBe("REGULATED");
  });

  it("the refusal labels are fixed and the method is routable", () => {
    expect([...AADHAAR_OTP_REFUSALS]).toEqual([
      "uid_invalid",
      "mobile_not_linked",
      "otp_invalid",
      "otp_expired",
      "not_configured",
    ]);
    for (const r of AADHAAR_OTP_REFUSALS) expect(r).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
    expect(KYC_METHODS).toContain("aadhaar_otp");
  });
});
