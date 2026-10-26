import { describe, expect, it } from "vitest";
import { KMS_PURPOSES } from "@infrabyx/contracts/ports";
import { assertKmsContext, decodeKmsContext, encodeKmsContext } from "./kms-context.js";

describe("C-14 KMS encryption context (PL2-D-50)", () => {
  it("encodes { tenant_id, purpose } canonically and decodes only that exact form", () => {
    const b = encodeKmsContext({ tenant_id: "tnt_a", purpose: "field" });
    expect(new TextDecoder().decode(b)).toBe('{"purpose":"field","tenant_id":"tnt_a"}');
    expect(decodeKmsContext(b)).toEqual({ tenant_id: "tnt_a", purpose: "field" });
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(decodeKmsContext(enc('{"tenant_id":"tnt_a","purpose":"field"}'))).toBeNull(); // not canonical
    expect(decodeKmsContext(enc('{"purpose":"field","tenant_id":"tnt_a","x":"1"}'))).toBeNull();
    expect(decodeKmsContext(enc('{"purpose":"other","tenant_id":"tnt_a"}'))).toBeNull();
    expect(decodeKmsContext(undefined)).toBeNull();
    expect(() => assertKmsContext(enc("tnt_a"))).toThrow(
      expect.objectContaining({ code: "IPB-PORT-003" }),
    );
  });

  it("the purpose registry holds fixed identifiers only", () => {
    for (const p of KMS_PURPOSES) expect(p).toMatch(/^[a-z][a-z0-9_-]{1,31}$/);
  });
});
