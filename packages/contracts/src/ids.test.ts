import { describe, expect, it } from "vitest";
import { idSchema, prefixOf, AnyId, TenantId } from "./ids.js";

describe("ids (IPB-01 §01.4.6)", () => {
  it("accepts prefix + ULID and the reserved tenants", () => {
    expect(TenantId.safeParse("tnt_01J9ZC9Q2K7M8N3P4R5S6T7V8W").success).toBe(true);
    expect(TenantId.safeParse("tnt_platform").success).toBe(true);
    expect(TenantId.safeParse("tnt_sandbox").success).toBe(true);
    expect(AnyId.safeParse("tnt_platform").success).toBe(true);
  });

  it("rejects malformed IDs", () => {
    expect(TenantId.safeParse("tnt_01j9zc9q2k7m8n3p4r5s6t7v8w").success).toBe(false); // lower case
    expect(TenantId.safeParse("usr_01J9ZC9Q2K7M8N3P4R5S6T7V8W").success).toBe(false); // wrong prefix
    expect(TenantId.safeParse("tnt_81J9ZC9Q2K7M8N3P4R5S6T7V8W").success).toBe(false); // ULID overflow
    expect(TenantId.safeParse("tnt_01J9ZC9Q2K7M8N3P4R5S6T7V8I").success).toBe(false); // I not Crockford
    expect(() => idSchema("Bad")).toThrow();
  });

  it("extracts the prefix", () => {
    expect(prefixOf("led_01J9ZC9Q2K7M8N3P4R5S6T7V8W")).toBe("led");
    expect(prefixOf("nounderscore")).toBe("");
  });
});
