// PR-UDF-050 (R1-D-204): the AA consent request's FIU and consent reference, the FIU check and the
// approval link check.
import { describe, expect, it } from "vitest";
import { verhoeffValid } from "../aadhaar.js";
import {
  AA_APPROVAL_URL_REFUSED,
  AA_FIU_MISMATCH,
  AaConsentRequest,
  aaApprovalUrlAllowed,
  aaFiuMismatch,
  isRfc9562Uuid,
} from "./account-aggregator.js";

const now = Date.parse("2026-11-19T00:00:00Z");
const req = (over: Record<string, unknown> = {}) => ({
  customerHandle: "asha.rao@setu",
  subjectRef: "cus:1",
  consentRef: "cpr_01JA0000000000000000000000",
  purposeCode: "101",
  fiTypes: ["DEPOSIT"],
  fetchType: "ONETIME",
  dataRange: {
    from: new Date(now - 86_400_000).toISOString(),
    to: new Date(now).toISOString(),
  },
  dataLife: { unit: "MONTH", value: 1 },
  consentStart: new Date(now).toISOString(),
  consentExpiry: new Date(now + 86_400_000).toISOString(),
  ...over,
});

const aadhaarLike = (): string => {
  const head = "2" + "3456789034";
  for (let d = 0; d < 10; d++) if (verhoeffValid(head + d)) return head + d;
  throw new Error("unreachable");
};

describe("AA_FIU consent request (PR-UDF-050)", () => {
  it("keeps the old request working and takes a FIU and a product artefact", () => {
    expect(AaConsentRequest.safeParse(req()).success).toBe(true);
    const r = AaConsentRequest.parse(
      req({
        fiuId: "udofin-re.fiu-1",
        consentArtefact: { kind: "udf.purpose_consent", id: "pcn-1" },
      }),
    );
    expect(r.fiuId).toBe("udofin-re.fiu-1");
    expect(r.consentRef).toBe("cpr_01JA0000000000000000000000");
    expect(r.consentArtefact).toEqual({ kind: "udf.purpose_consent", id: "pcn-1" });
  });

  it("refuses a malformed FIU id, consent reference or consent artefact", () => {
    for (const fiuId of ["x", "-fiu", "fiu-", "fiu id", "fiu@aa", "f".repeat(101), 7])
      expect(AaConsentRequest.safeParse(req({ fiuId })).success, String(fiuId)).toBe(false);
    for (const consentRef of ["pcn-1", { kind: "udf.consent", id: "pcn-1" }])
      expect(AaConsentRequest.safeParse(req({ consentRef })).success).toBe(false);
    for (const consentArtefact of [
      "pcn-1",
      { kind: "cpr", id: "pcn-1" },
      { kind: "udf.consent", id: `pcn-${aadhaarLike()}` },
    ])
      expect(AaConsentRequest.safeParse(req({ consentArtefact })).success).toBe(false);
  });
});

describe("the FIU check (PR-UDF-050)", () => {
  it("refuses another FIU or none when one was asked for, and compares nothing otherwise", () => {
    expect(aaFiuMismatch("fiu-a", "fiu-a")).toBe(false);
    expect(aaFiuMismatch("fiu-a", "fiu-b")).toBe(true);
    expect(aaFiuMismatch("fiu-a", "FIU-A")).toBe(true);
    expect(aaFiuMismatch("fiu-a", undefined)).toBe(true);
    expect(aaFiuMismatch(undefined, "fiu-b")).toBe(false);
    expect(aaFiuMismatch(undefined, undefined)).toBe(false);
    expect(AA_FIU_MISMATCH).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
    expect(AA_APPROVAL_URL_REFUSED).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
  });
});

describe("the approval link check (PR-UDF-050)", () => {
  const hosts = ["fiu.setu.co"];
  it("accepts an https link on a listed host", () => {
    expect(aaApprovalUrlAllowed("https://fiu.setu.co/consents/webview/abc-def", hosts)).toBe(true);
    expect(aaApprovalUrlAllowed("https://FIU.setu.co/c/1", hosts)).toBe(true);
  });

  it("refuses http, user information, other or suffix hosts, a 12-digit run and Aadhaar-like numbers", () => {
    const a = aadhaarLike();
    for (const bad of [
      "http://fiu.setu.co/c/1",
      "https://user:pw@fiu.setu.co/c/1",
      "https://user@fiu.setu.co/c/1",
      "https://evil.example/c/1",
      "https://fiu.setu.co.evil.example/c/1",
      "https://setu.co/c/1",
      "javascript:alert(1)",
      "not a url",
      "https://fiu.setu.co/c/123456789012",
      `https://fiu.setu.co/c/${a.slice(0, 4)}-${a.slice(4, 8)}-${a.slice(8)}`,
      `https://fiu.setu.co/c/${"a".repeat(2048)}`,
    ])
      expect(aaApprovalUrlAllowed(bad, hosts), bad.slice(0, 60)).toBe(false);
    expect(aaApprovalUrlAllowed("https://fiu.setu.co/c/1", [])).toBe(false);
  });

  it("accepts any RFC 9562 UUID in the link, an all-digit last group included (owner answer #154)", () => {
    const a = aadhaarLike();
    for (const ok of [
      "https://fiu.setu.co/consents/webview/3f2c9a1e-7b4d-4e8a-9c1f-123456789012",
      "https://fiu.setu.co/consents/webview/3F2C9A1E-7B4D-4E8A-9C1F-ABCDEF012345",
      "https://fiu.setu.co/c/00000000-0000-0000-0000-000000000000",
      "https://fiu.setu.co/c/ffffffff-ffff-ffff-ffff-ffffffffffff",
      "https://fiu.setu.co/c/12345678-1234-1234-1234-123456789012?ref=90123456-7890-1234-5678-901234567890",
      // The digits are a UUID's last group, not a number standing alone.
      `https://fiu.setu.co/c/3f2c9a1e-7b4d-4e8a-9c1f-${a}`,
      `https://fiu.setu.co/c/3f2c9a1e-7b4d-4e8a-9c1f-123456789012#x`,
    ])
      expect(aaApprovalUrlAllowed(ok, hosts), ok).toBe(true);
  });

  it("still refuses a 12-digit run or an Aadhaar-like number outside a UUID", () => {
    const a = aadhaarLike();
    const uuid = "3f2c9a1e-7b4d-4e8a-9c1f-123456789012";
    for (const bad of [
      `https://fiu.setu.co/c/${uuid}/123456789012`,
      `https://fiu.setu.co/c/${uuid}?n=${a}`,
      `https://fiu.setu.co/c/${uuid}?n=${a.slice(0, 4)}-${a.slice(4, 8)}-${a.slice(8)}`,
      // Not a UUID (a missing group, or joined to more characters): its 12 digits stand alone.
      "https://fiu.setu.co/c/3f2c9a1e-7b4d-9c1f-123456789012",
      `https://fiu.setu.co/c/x${uuid}`,
      `https://fiu.setu.co/c/${uuid}-1`,
      `https://${uuid}.fiu.setu.co/c/1`,
      `http://fiu.setu.co/c/${uuid}`,
    ])
      expect(aaApprovalUrlAllowed(bad, hosts), bad).toBe(false);
  });

  it("reads a UUID by RFC 9562's layout and any hex digits", () => {
    for (const ok of [
      "3f2c9a1e-7b4d-4e8a-9c1f-123456789012",
      "00000000-0000-0000-0000-000000000000",
      "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
      "01937f2a-1c3b-7d4e-8f90-0123456789ab",
    ])
      expect(isRfc9562Uuid(ok), ok).toBe(true);
    for (const bad of [
      "3f2c9a1e7b4d4e8a9c1f123456789012",
      "3f2c9a1e-7b4d-4e8a-9c1f-12345678901",
      "3f2c9a1e-7b4d-4e8a-9c1f-1234567890123",
      "3f2c9a1g-7b4d-4e8a-9c1f-123456789012",
      "{3f2c9a1e-7b4d-4e8a-9c1f-123456789012}",
      " 3f2c9a1e-7b4d-4e8a-9c1f-123456789012",
    ])
      expect(isRfc9562Uuid(bad), bad).toBe(false);
  });
});
