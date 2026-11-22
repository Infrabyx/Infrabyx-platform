import { describe, expect, it } from "vitest";
import {
  ERROR_CATALOGUE,
  IpbError,
  PortError,
  Problem,
  problemHeaders,
  toProblem,
} from "./errors.js";

describe("error catalogue", () => {
  it("uses IPB-AREA-NNN codes with a status for every entry", () => {
    for (const [code, def] of Object.entries(ERROR_CATALOGUE)) {
      expect(code).toMatch(/^IPB-[A-Z][A-Z0-9]{1,5}-\d{3}$/);
      expect(def.title.length).toBeGreaterThan(5);
      if (typeof def.status === "number") expect(def.status).toBeGreaterThanOrEqual(100);
    }
  });

  it("applies PL1-D-03 meanings for IPB-ENV-001/002/011", () => {
    expect(ERROR_CATALOGUE["IPB-ENV-001"].title).toMatch(/seed profile refused/i);
    expect(ERROR_CATALOGUE["IPB-ENV-002"].title).toMatch(/disallowed engine or host/i);
    expect(ERROR_CATALOGUE["IPB-ENV-011"].title).toMatch(/schema validation/i);
    expect(ERROR_CATALOGUE["IPB-ENV-008"].title).toMatch(/region/i);
  });

  it("carries the retired-code rule: IPB-LLM-* is absent (IPB-01 §01.6.3)", () => {
    expect(Object.keys(ERROR_CATALOGUE).some((c) => c.startsWith("IPB-LLM"))).toBe(false);
  });
});

describe("RFC 9457 problems (IPB-10-04)", () => {
  it("renders code, help_key, trace_id and status", () => {
    const p = toProblem(
      new IpbError("IPB-PORT-003", { detail: "REGULATED payload to GLOBAL adapter" }),
      {
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        instance: "/v1/llm/complete",
      },
    );
    expect(Problem.parse(p)).toEqual(p);
    expect(p).toMatchObject({
      status: 422,
      code: "IPB-PORT-003",
      help_key: "hlp.int.residency_blocked",
    });
    expect(p.type).toMatch(/IPB-PORT-003$/);
  });

  it("re-exports under a product prefix without changing numbers", () => {
    expect(toProblem(new IpbError("IPB-PORT-001"), { productPrefix: "LDC" }).code).toBe(
      "LDC-PORT-001",
    );
  });

  it("never leaks internals of unknown errors", () => {
    const p = toProblem(new Error("SELECT * FROM secrets WHERE password='x'"));
    expect(p.status).toBe(500);
    expect(JSON.stringify(p)).not.toMatch(/SELECT|password/);
  });

  it("maps non-HTTP codes to 500 and keeps port metadata", () => {
    const e = new PortError("IPB-PORT-005", "STORAGE", { adapter: "s3" });
    expect(e.httpStatus).toBe(500);
    expect(e.port).toBe("STORAGE");
    expect(e.message).toContain("IPB-PORT-005");
  });
});

describe("reason and retry_after_seconds (PR-UDF-038)", () => {
  it("carries a fixed refusal label and drops anything that is not one", () => {
    const p = toProblem(new IpbError("IPB-PORT-002", { meta: { reason: "hash_mismatch" } }));
    expect(p.reason).toBe("hash_mismatch");
    expect(Problem.parse(p)).toEqual(p);
    for (const reason of ["Has Space", "x".repeat(65), "1digit", "a@b.c", "123456789012", 7])
      expect(toProblem(new IpbError("IPB-PORT-002", { meta: { reason } })).reason).toBeUndefined();
    expect(toProblem(new IpbError("IPB-PORT-002")).reason).toBeUndefined();
    // PR-UDF-080 (R1-D-269): a STORAGE integrity refusal keeps the label under its own code.
    expect(
      toProblem(new IpbError("IPB-STOR-005", { meta: { reason: "hash_mismatch" } })),
    ).toMatchObject({ code: "IPB-STOR-005", status: 500, reason: "hash_mismatch" });
  });

  it("carries the wait on a 429 or 503 only, as whole seconds from 1 to 86400, with Retry-After", () => {
    const p = toProblem(new IpbError("IPB-SEC-019", { meta: { retryAfterSeconds: 30 } }));
    expect(p.status).toBe(429);
    expect(p.retry_after_seconds).toBe(30);
    expect(problemHeaders(p)).toEqual({ "Retry-After": "30" });
    expect(
      toProblem(new IpbError("IPB-SEC-019", { meta: { retry_after_seconds: 5 } }))
        .retry_after_seconds,
    ).toBe(5);
    for (const v of [0, -1, 1.5, 86_401, "30", Number.NaN])
      expect(
        toProblem(new IpbError("IPB-SEC-019", { meta: { retryAfterSeconds: v } }))
          .retry_after_seconds,
      ).toBeUndefined();
    const notRetry = toProblem(new IpbError("IPB-SEC-007", { meta: { retryAfterSeconds: 30 } }));
    expect(notRetry.status).toBe(409);
    expect(notRetry.retry_after_seconds).toBeUndefined();
    expect(problemHeaders(notRetry)).toEqual({});
  });

  it("leaves other meta and unknown errors unchanged", () => {
    const p = toProblem(new IpbError("IPB-SEC-019", { meta: { principal: "usr_secret" } }));
    expect(JSON.stringify(p)).not.toContain("usr_secret");
    expect(toProblem(new Error("x"))).not.toHaveProperty("reason");
  });
});
