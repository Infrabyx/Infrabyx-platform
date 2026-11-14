// `PdfPort.extractText` contracts (PR-LDC-39, R1-D-160): the AV precondition and the capped limits.
import { describe, expect, it } from "vitest";
import { payloadClass } from "./payload-class.js";
import { assertScannedClean } from "./file-scan.js";
import {
  PDF_TEXT_LIMIT_DEFAULTS,
  PDF_TEXT_LIMIT_MAXIMA,
  PdfTextRequest,
  resolvePdfTextLimits,
} from "./pdf-text.js";

const sha = "a".repeat(64);
const file = { storageKey: "tenant/tnt_a/uploads/01JA0000000000000000000000.pdf", sha256: sha };

describe("PR-LDC-39: PdfPort.extractText contracts", () => {
  it("only a CLEAN scan of the same SHA-256 passes; the rest map as scanDecision does", () => {
    expect(() => assertScannedClean({ verdict: "CLEAN", file }, sha, "PDF")).not.toThrow();
    const code = (verdict: string, h = sha) => {
      try {
        assertScannedClean({ verdict, file }, h, "PDF", "x");
      } catch (e) {
        return (e as { code: string; meta: { reason: string } }).code;
      }
      return "passed";
    };
    expect(code("INFECTED")).toBe("IPB-SEC-011");
    expect(code("ERROR")).toBe("IPB-SEC-015");
    expect(code("clean")).toBe("IPB-SEC-015");
    expect(code("CLEAN", "b".repeat(64))).toBe("IPB-SEC-015");
  });

  it("limits default, and a larger limit is capped at the platform maximum", () => {
    expect(resolvePdfTextLimits()).toEqual(PDF_TEXT_LIMIT_DEFAULTS);
    const r = resolvePdfTextLimits({ maxPages: 1_000_000, timeoutMs: 5_000, maxRatio: 10 });
    expect(r.maxPages).toBe(PDF_TEXT_LIMIT_MAXIMA.maxPages);
    expect(r.timeoutMs).toBe(5_000);
    expect(r.maxRatio).toBe(10);
    for (const [k, v] of Object.entries(PDF_TEXT_LIMIT_DEFAULTS))
      expect(v).toBeLessThanOrEqual(PDF_TEXT_LIMIT_MAXIMA[k as keyof typeof PDF_TEXT_LIMIT_MAXIMA]);
  });

  it("the request needs the file and its scan, keeps the scan's other fields, refuses the rest", () => {
    const scan = { verdict: "CLEAN", file, threat: null, adapter: "clamav" };
    expect(PdfTextRequest.parse({ file, scan }).scan).toMatchObject({ adapter: "clamav" });
    expect(() => PdfTextRequest.parse({ file })).toThrow();
    expect(() => PdfTextRequest.parse({ file, scan, body: "x" })).toThrow();
    expect(() => PdfTextRequest.parse({ file, scan, limits: { maxPages: 0 } })).toThrow();
    expect(() => PdfTextRequest.parse({ file, scan, limits: { maxCpu: 1 } })).toThrow();
    expect(payloadClass(PdfTextRequest).complete).toBe(true);
  });
});
