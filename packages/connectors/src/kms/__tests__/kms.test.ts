import { describe, expect, it } from "vitest";
import { checkDeletionDays, kmsContext, toEncryptionContext } from "../common.js";

describe("C-14 encryption context", () => {
  it("a canonical { tenant_id, purpose } map becomes the AWS encryption context", () => {
    expect(toEncryptionContext(kmsContext({ tenant_id: "tnt_a", purpose: "field" }))).toEqual({
      purpose: "field",
      tenant_id: "tnt_a",
    });
  });

  it("any other AAD is bound under ipb:aad, so it is never dropped", () => {
    const raw = new TextEncoder().encode("tnt_a\u001fcases.party\u001fpan\u001fpty_1");
    expect(toEncryptionContext(raw)).toEqual({ "ipb:aad": Buffer.from(raw).toString("base64url") });
    // Non-canonical JSON and non-string values are not treated as a context map.
    expect(
      Object.keys(toEncryptionContext(new TextEncoder().encode('{"b":"1","a":"2"}'))!),
    ).toEqual(["ipb:aad"]);
    expect(Object.keys(toEncryptionContext(new TextEncoder().encode('{"a":1}'))!)).toEqual([
      "ipb:aad",
    ]);
    expect(toEncryptionContext(new Uint8Array())).toBeUndefined();
    expect(toEncryptionContext()).toBeUndefined();
  });

  it("key deletion only with exactly 30 days (C-15)", () => {
    expect(() => checkDeletionDays("x", 30)).not.toThrow();
    for (const d of [0, 7, 29, 31])
      expect(() => checkDeletionDays("x", d)).toThrow(
        expect.objectContaining({ code: "IPB-PORT-003" }),
      );
  });
});
