// The security event kind `connector.retrieval.host_refused` (Udofin PR-UDF-072; R1-D-262; threat
// model §3.181): a strict detail of the partner tenant, the document id and version and a bare
// host name, so a URL, its query or a credential can never be recorded.
import { describe, expect, it } from "vitest";
import {
  RETRIEVAL_HOST_PATTERN,
  RETRIEVAL_HOST_REFUSED_EVENT,
  RetrievalHostRefusedDetail,
  SECURITY_EVENT_DETAIL_KEY,
  SECURITY_EVENT_DETAIL_VALUE,
  SECURITY_EVENT_KINDS,
  SECURITY_EVENT_SHAPES,
  retrievalHostOf,
  retrievalHostRefusedEvent,
  securityEventShapeProblem,
  type SecurityEventInput,
} from "./kernel.js";

const valid = {
  partner_tenant_id: "tnt_lender01",
  document_id: "doc_01JDOC0000000000000000000",
  version: 3,
  host: "docs.partner.example",
};

describe("connector.retrieval.host_refused (PR-UDF-072)", () => {
  it("is a security event kind with a typed shape", () => {
    expect(SECURITY_EVENT_KINDS).toContain(RETRIEVAL_HOST_REFUSED_EVENT);
    expect(SECURITY_EVENT_KINDS).toContain("rules.reveal.refused");
    expect(SECURITY_EVENT_SHAPES[RETRIEVAL_HOST_REFUSED_EVENT]).toMatchObject({
      resourceType: "document",
      resourceIdField: "document_id",
    });
    expect(SECURITY_EVENT_SHAPES["rules.reveal.refused"]).toBeUndefined();
    expect(Object.isFrozen(SECURITY_EVENT_SHAPES)).toBe(true);
  });

  it("accepts the valid shape, whose keys and values fit the generic detail rule", () => {
    expect(RetrievalHostRefusedDetail.parse(valid)).toEqual(valid);
    for (const [k, v] of Object.entries(valid)) {
      expect(SECURITY_EVENT_DETAIL_KEY.test(k)).toBe(true);
      if (typeof v === "string") expect(SECURITY_EVENT_DETAIL_VALUE.test(v)).toBe(true);
    }
    for (const host of [
      "localhost",
      "a.b",
      "10.0.0.1",
      "xn--h1aax.example",
      "s3.ap-south-1.amazonaws.com",
      `${"a".repeat(63)}.example`,
    ])
      expect(RetrievalHostRefusedDetail.safeParse({ ...valid, host }).success).toBe(true);
  });

  it.each([
    ["a URL", "https://docs.partner.example/v1/doc"],
    ["a scheme", "https://docs.partner.example"],
    ["a query", "docs.partner.example?sig=abc"],
    ["a path", "docs.partner.example/doc"],
    ["a port", "docs.partner.example:8443"],
    ["credentials", "user:pass@docs.partner.example"],
    ["a user", "user@docs.partner.example"],
    ["a fragment", "docs.partner.example#x"],
    ["upper case", "Docs.Partner.Example"],
    ["a trailing dot", "docs.partner.example."],
    ["an empty label", "docs..example"],
    ["a leading hyphen", "-docs.example"],
    ["a trailing hyphen", "docs-.example"],
    ["an underscore", "do_cs.example"],
    ["an IPv6 literal", "[::1]"],
    ["a space", "docs partner.example"],
    ["a 64-character label", `${"a".repeat(64)}.example`],
    ["more than 128 characters", `${"a".repeat(60)}.${"b".repeat(60)}.example`],
    ["nothing", ""],
  ])("rejects a host with %s", (_why, host) => {
    expect(RETRIEVAL_HOST_PATTERN.test(host)).toBe(false);
    expect(RetrievalHostRefusedDetail.safeParse({ ...valid, host }).success).toBe(false);
  });

  it("rejects extra or missing fields and bad ids", () => {
    const bad: unknown[] = [
      { ...valid, url: "https://docs.partner.example/x" },
      { ...valid, query: "sig=abc" },
      { ...valid, extra: 1 },
      { partner_tenant_id: valid.partner_tenant_id, document_id: valid.document_id, version: 3 },
      { ...valid, partner_tenant_id: "lender01" },
      { ...valid, partner_tenant_id: "tnt_Lender_01" },
      { ...valid, document_id: "d" },
      { ...valid, document_id: "doc 1" },
      { ...valid, document_id: "doc/1" },
      { ...valid, version: 0 },
      { ...valid, version: 1.5 },
      { ...valid, version: "3" },
      { ...valid, host: 42 },
    ];
    for (const d of bad) expect(RetrievalHostRefusedDetail.safeParse(d).success).toBe(false);
  });

  it("builds the event, targeting the document", () => {
    const e = retrievalHostRefusedEvent(valid);
    expect(e).toEqual({
      kind: "connector.retrieval.host_refused",
      resourceType: "document",
      resourceId: valid.document_id,
      detail: valid,
    });
    expect(Object.isFrozen(e.detail)).toBe(true);
    expect(securityEventShapeProblem(e)).toBeNull();
  });

  it("refuses a bad detail naming the field, never its value", () => {
    const leaky = "https://user:hunter2@docs.partner.example/x?sig=abc";
    let message = "";
    try {
      retrievalHostRefusedEvent({ ...valid, host: leaky });
    } catch (e) {
      expect(e).toBeInstanceOf(RangeError);
      message = (e as Error).message;
    }
    expect(message).toContain("host");
    expect(message).not.toContain("hunter2");
    expect(message).not.toContain("sig=");
    expect(() => retrievalHostRefusedEvent({ ...valid, url: leaky } as never)).toThrow(/url/);
    expect(() => retrievalHostRefusedEvent(null as never)).toThrow(RangeError);
  });

  it("refuses an event whose resource is not the detail's document", () => {
    const base: SecurityEventInput = retrievalHostRefusedEvent(valid);
    expect(securityEventShapeProblem({ ...base, resourceType: "decision" })).toMatch(
      /resource type document/,
    );
    expect(securityEventShapeProblem({ ...base, resourceId: "doc_other" })).toMatch(/document_id/);
    expect(securityEventShapeProblem({ ...base, resourceId: null })).toMatch(/document_id/);
    // A kind without a typed shape keeps the generic rule only.
    expect(
      securityEventShapeProblem({
        kind: "rules.reveal.refused",
        resourceType: "decision",
        resourceId: null,
        detail: { reason: "rule_refused" },
      }),
    ).toBeNull();
  });

  it("takes the bare host of a refused URL, dropping credentials, port, path and query", () => {
    expect(retrievalHostOf("https://user:pw@Docs.Partner.EXAMPLE:8443/v1/d?sig=abc#f")).toBe(
      "docs.partner.example",
    );
    expect(retrievalHostOf("https://docs.partner.example./x")).toBe("docs.partner.example");
    expect(retrievalHostOf("http://10.0.0.1/x")).toBe("10.0.0.1");
    expect(retrievalHostOf("https://bücher.example/")).toBe("xn--bcher-kva.example");
    expect(retrievalHostOf("https://[::1]/x")).toBeNull();
    expect(retrievalHostOf("not a url")).toBeNull();
    expect(retrievalHostOf("file:///etc/hosts")).toBeNull();
    expect(retrievalHostOf(`https://${"a".repeat(60)}.${"b".repeat(60)}.example/`)).toBeNull();
    expect(retrievalHostOf(42 as never)).toBeNull();
    const host = retrievalHostOf("https://docs.partner.example/x?X-Amz-Signature=abc");
    expect(retrievalHostRefusedEvent({ ...valid, host: host! }).detail.host).toBe(
      "docs.partner.example",
    );
  });
});
