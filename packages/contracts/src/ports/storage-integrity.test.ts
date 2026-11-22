// PR-UDF-080 (R1-D-269): a STORAGE integrity refusal has its own code, apart from an outage.
import { describe, expect, it } from "vitest";
import { ERROR_CATALOGUE, IpbError, PortError, Problem, toProblem } from "../errors.js";
import {
  STORAGE_HASH_MISMATCH,
  STORAGE_INTEGRITY_ERROR,
  isStorageIntegrityError,
} from "./storage.js";

const tampered = () =>
  new PortError(STORAGE_INTEGRITY_ERROR, "STORAGE", {
    adapter: "s3",
    detail: "object body does not match its stored SHA-256",
    meta: { reason: STORAGE_HASH_MISMATCH },
  });

describe("PR-UDF-080: the STORAGE integrity code", () => {
  it("is IPB-STOR-005: a 500 with its own title and help key, apart from IPB-PORT-002's 503", () => {
    expect(STORAGE_INTEGRITY_ERROR).toBe("IPB-STOR-005");
    const def = ERROR_CATALOGUE[STORAGE_INTEGRITY_ERROR];
    expect(def).toMatchObject({ status: 500, helpKey: "hlp.int.storage_integrity" });
    expect(def.source).toMatch(/R1-D-269/);
    expect(def.title).not.toBe(ERROR_CATALOGUE["IPB-PORT-002"].title);
    expect(ERROR_CATALOGUE["IPB-PORT-002"].status).toBe(503);
    expect(tampered().httpStatus).toBe(500);
  });

  it("renders as an RFC 9457 problem with the hash_mismatch label and no retry hint", () => {
    const p = toProblem(tampered(), { productPrefix: "UDF" });
    expect(Problem.parse(p)).toEqual(p);
    expect(p).toMatchObject({
      status: 500,
      code: "UDF-STOR-005",
      help_key: "hlp.int.storage_integrity",
      reason: "hash_mismatch",
    });
    expect(p.type).toMatch(/IPB-STOR-005$/);
    expect(p.retry_after_seconds).toBeUndefined();
    const withWait = new IpbError(STORAGE_INTEGRITY_ERROR, {
      meta: { reason: STORAGE_HASH_MISMATCH, retryAfterSeconds: 30 },
    });
    expect(toProblem(withWait).retry_after_seconds).toBeUndefined();
  });

  it("isStorageIntegrityError tells a tamper from an outage", () => {
    expect(isStorageIntegrityError(tampered())).toBe(true);
    expect(isStorageIntegrityError(new IpbError(STORAGE_INTEGRITY_ERROR))).toBe(true);
    for (const other of [
      new PortError("IPB-PORT-002", "STORAGE", { meta: { reason: "hash_mismatch" } }),
      new IpbError("IPB-STOR-001"),
      new Error("Checksum mismatch"),
      null,
      undefined,
      "IPB-STOR-005",
    ])
      expect(isStorageIntegrityError(other)).toBe(false);
  });
});
