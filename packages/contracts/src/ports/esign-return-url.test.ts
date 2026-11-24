// PR-UDF-086 (R1-D-287): the return URL an ESIGN adapter passes to the ESP's hosted signing page.
// https only, a host, no query string (the vendor appends its own parameters on return), no
// fragment, no user info or `@`; at most 2,048 printable ASCII characters.
import { describe, expect, it } from "vitest";
import { ESIGN_RETURN_URL_MAX, returnUrlProblem, Signer } from "./esign.js";

const page = "https://app.example.test/loans/01JD3K7Q9M2X4B6C8D0E1F2G3H/sign/return";

describe("@IPB-01-15 ESIGN returnUrlProblem (PR-UDF-086)", () => {
  it("admits an https page named by an opaque id", () => {
    expect(returnUrlProblem(page)).toBeNull();
    expect(returnUrlProblem("https://app.example.test:8443/r")).toBeNull();
    expect(returnUrlProblem(`https://a.test/${"x".repeat(ESIGN_RETURN_URL_MAX - 15)}`)).toBeNull();
  });

  it("refuses a URL whose query string carries anything but the vendor's own parameters", () => {
    for (const q of [
      "?loan=01JD3K7Q9M2X4B6C8D0E1F2G3H",
      "?name=Asha%20Rao&mobile=9876543210",
      "?redirect_url=https://evil.test/",
      "?status=success",
      "?",
    ])
      expect(returnUrlProblem(`${page}${q}`)).toBe("query");
  });

  it("refuses anything but https, and user info, fragments, odd characters and over-long URLs", () => {
    const cases: Array<[unknown, string]> = [
      ["http://app.example.test/r", "scheme"],
      ["javascript:alert(1)", "scheme"],
      ["//app.example.test/r", "scheme"],
      ["ftp://app.example.test/r", "scheme"],
      ["https://", "unparsable"],
      ["https://user:pw@app.example.test/r", "userinfo"],
      ["https://app.example.test/r/asha@example.test", "userinfo"],
      [`${page}#done`, "fragment"],
      ["https://app.example.test/a b", "characters"],
      ["https://app.example.test/é", "characters"],
      [`https://a.test/${"x".repeat(ESIGN_RETURN_URL_MAX)}`, "length"],
      ["", "length"],
      [42, "length"],
      [undefined, "length"],
    ];
    for (const [u, why] of cases) expect([u, returnUrlProblem(u)]).toEqual([u, why]);
  });

  it("is an optional field of a signer, checked by the schema", () => {
    const s = { ref: "usr_signer_1", name: "Signer 1", method: "AADHAAR_OTP_ESIGN" } as const;
    expect(Signer.safeParse(s).success).toBe(true);
    expect(Signer.safeParse({ ...s, returnUrl: page }).success).toBe(true);
    expect(Signer.safeParse({ ...s, returnUrl: `${page}?loan=1` }).success).toBe(false);
    expect(Signer.safeParse({ ...s, returnUrl: "http://app.example.test/r" }).success).toBe(false);
  });
});
