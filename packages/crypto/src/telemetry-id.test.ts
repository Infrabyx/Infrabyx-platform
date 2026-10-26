import { hkdfSync, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SecretKey } from "./keys.js";
import { pseudonymise, telemetryIdHasher, TELEMETRY_ID_LABEL } from "./hmac.js";

const material = new Uint8Array(32).map((_, i) => i + 1);
const key = new SecretKey("obs-hash", "hmac-sha-256", material);

describe("C-21 telemetry identifiers (PL2-C-04)", () => {
  it("are HMAC-SHA-256 under the HKDF-derived key, truncated to 32 hex", () => {
    const sub = hkdfSync("sha256", material, new Uint8Array(0), TELEMETRY_ID_LABEL, 32);
    const expected = createHmac("sha256", Buffer.from(sub))
      .update("tnt_a")
      .digest("hex")
      .slice(0, 32);
    expect(telemetryIdHasher(key)("tnt_a")).toBe(expected);
    expect(telemetryIdHasher(key)("tnt_a")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("cannot be joined to the ledger's pseudonyms under the same PL1 key", () => {
    const h = telemetryIdHasher(key)("usr_1");
    expect(pseudonymise(key, "usr_1").startsWith(h)).toBe(false);
  });
});
