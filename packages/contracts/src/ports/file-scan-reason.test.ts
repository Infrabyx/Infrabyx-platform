// The AV scan reason of a failed STORAGE read (R1-D-269, R1-D-276): a tampered object, a key the
// scanner may not use and an outage each read differently; every one is still an `ERROR`.
import { describe, expect, it } from "vitest";
import { IpbError } from "../errors.js";
import { SCAN_ERROR_REASONS, scanReasonOfReadError } from "./file-scan.js";

describe("scanReasonOfReadError", () => {
  it("maps IPB-STOR-005, IPB-KMS-001 and anything else", () => {
    expect(scanReasonOfReadError(new IpbError("IPB-STOR-005"))).toBe("hash_mismatch");
    expect(scanReasonOfReadError(new IpbError("IPB-KMS-001"))).toBe("storage_key_unavailable");
    expect(scanReasonOfReadError(new IpbError("IPB-PORT-002"))).toBe("unavailable");
    expect(scanReasonOfReadError(new Error("x"))).toBe("unavailable");
    expect(scanReasonOfReadError(undefined)).toBe("unavailable");
    expect(SCAN_ERROR_REASONS).toContain("storage_key_unavailable");
  });
});
