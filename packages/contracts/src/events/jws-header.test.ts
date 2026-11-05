// Ecosystem Spec v1.4 §3.6: the X-Infrabyx-JWS header (PR-043, #116; M61).
import { describe, expect, it } from "vitest";
import { REGULATED_JWS_HEADER, regulatedJwsFromHeaders } from "./envelope.js";

const JWS = "eyJhbGciOiJFUzI1NiJ9..c2lnbmF0dXJl";

describe("regulatedJwsFromHeaders (Spec v1.4)", () => {
  it("reads exactly one compact detached JWS from the header, in any case", () => {
    expect(REGULATED_JWS_HEADER).toBe("X-Infrabyx-JWS");
    expect(regulatedJwsFromHeaders({ "x-infrabyx-jws": JWS })).toEqual({ ok: true, jws: JWS });
    expect(regulatedJwsFromHeaders(new Headers({ "X-Infrabyx-JWS": JWS }))).toEqual({
      ok: true,
      jws: JWS,
    });
  });
  it("refuses a missing, repeated, comma-joined, malformed or over-long header", () => {
    const r = (h: Record<string, string | string[]> | Headers) => {
      const x = regulatedJwsFromHeaders(h);
      return x.ok ? "ok" : x.reason;
    };
    expect(r({})).toBe("missing");
    expect(r({ "x-infrabyx-jws": [JWS, JWS] })).toBe("repeated");
    expect(r({ "X-Infrabyx-JWS": JWS, "x-infrabyx-jws": JWS })).toBe("repeated");
    expect(r({ "X-Infrabyx-JWS": `${JWS}, ${JWS}` })).toBe("repeated");
    const joined = new Headers();
    joined.append("X-Infrabyx-JWS", JWS);
    joined.append("X-Infrabyx-JWS", JWS);
    expect(r(joined)).toBe("repeated");
    expect(r({ "X-Infrabyx-JWS": `${JWS} ` })).toBe("malformed");
    expect(r({ "X-Infrabyx-JWS": "eyJ.attached.payload" })).toBe("malformed");
    expect(r({ "X-Infrabyx-JWS": `a..${"b".repeat(1100)}` })).toBe("too_long");
  });
});
