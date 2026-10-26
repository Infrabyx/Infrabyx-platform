import { describe, expect, it } from "vitest";
import { ERROR_CATALOGUE, IpbError, PortError, Problem, toProblem } from "./errors.js";

describe("error catalogue", () => {
  it("uses IPB-AREA-NNN codes with a status for every entry", () => {
    for (const [code, def] of Object.entries(ERROR_CATALOGUE)) {
      expect(code).toMatch(/^IPB-[A-Z]{2,6}-\d{3}$/);
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
