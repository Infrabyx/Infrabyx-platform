// The test authorities' PEM writer (follow-up of R1-D-250's `mtls-test` fix; R1-D-275).
import { describe, expect, it } from "vitest";
import { pemCertificate } from "./pem-armour.js";

describe("pemCertificate", () => {
  it("never writes a blank line, at a 48-byte multiple or not", () => {
    for (const n of [1, 47, 48, 49, 96, 480, 481]) {
      const der = Buffer.alloc(n, 0x5a);
      const text = pemCertificate(der);
      expect(text, String(n)).not.toMatch(/\n\n/);
      const body = text.split("\n").slice(1, -2);
      expect(
        body.every((l) => l.length > 0 && l.length <= 64),
        String(n),
      ).toBe(true);
      expect(Buffer.from(body.join(""), "base64").equals(der), String(n)).toBe(true);
    }
  });
});
