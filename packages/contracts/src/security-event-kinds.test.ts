// The security event kind `connector.retrieval.host_refused` (Udofin PR-UDF-072; R1-D-262; threat
// model §3.181): a strict detail of the partner tenant, the document id and version and a bare
// host name, so a URL, its query or a credential can never be recorded. PR-UDF-082 (R1-D-279;
// §3.185): the host may also be an IPv6 literal as the WHATWG parser writes it, or a SHA-256
// digest with the host's length, so every refused host is recordable.
import { describe, expect, it } from "vitest";
import {
  RETRIEVAL_HOST_DIGEST_PATTERN,
  RETRIEVAL_HOST_IPV6_PATTERN,
  RETRIEVAL_HOST_LENGTH_MAX,
  RETRIEVAL_HOST_PATTERN,
  RETRIEVAL_HOST_REFUSED_EVENT,
  RETRIEVAL_URL_MAX_LENGTH,
  isRetrievalHostIpv6Literal,
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
    ["an unbracketed IPv6 address", "::1"],
    ["an uncompressed IPv6 literal", "[0:0:0:0:0:0:0:1]"],
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
    expect(retrievalHostOf("https://[::1]/x")).toBe("[::1]");
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

describe("every refused host is recordable (PR-UDF-082; R1-D-279)", () => {
  const digest = `sha256:${"0123456789abcdef".repeat(4)}`;

  it.each([
    "[::1]",
    "[::]",
    "[2001:db8::1]",
    "[::ffff:102:304]",
    "[fe80::1]",
    "[2001:db8:0:1:1:1:1:1]",
    "[1:0:0:2::3]",
    "[ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]",
  ])("accepts the IPv6 literal %s as the WHATWG parser writes it", (host) => {
    expect(RETRIEVAL_HOST_IPV6_PATTERN.test(host)).toBe(true);
    expect(isRetrievalHostIpv6Literal(host)).toBe(true);
    expect(RETRIEVAL_HOST_PATTERN.test(host)).toBe(false);
    expect(SECURITY_EVENT_DETAIL_VALUE.test(host)).toBe(true);
    expect(RetrievalHostRefusedDetail.parse({ ...valid, host })).toEqual({ ...valid, host });
  });

  it.each([
    ["upper case", "[2001:DB8::1]"],
    ["leading zeros", "[2001:0db8::1]"],
    ["no compression", "[2001:db8:0:0:0:0:0:1]"],
    ["a single zero group compressed", "[2001:db8::1:1:1:1:1]"],
    ["the shorter zero run compressed", "[1::2:0:0:0:3]"],
    ["two compressions", "[1::2::3]"],
    ["too many groups", "[1:2:3:4:5:6:7:8:9]"],
    ["a group of five digits", "[12345::1]"],
    ["a dotted IPv4 tail", "[::ffff:1.2.3.4]"],
    ["a zone id", "[fe80::1%eth0]"],
    ["an encoded zone id", "[fe80::1%25eth0]"],
    ["no brackets", "2001:db8::1"],
    ["one bracket", "[2001:db8::1"],
    ["a port", "[::1]:443"],
    ["a path", "[::1]/x"],
    ["credentials", "u:p@[::1]"],
    ["empty brackets", "[]"],
    ["not hex", "[::g]"],
  ])("refuses an IPv6 literal with %s", (_why, host) => {
    expect(isRetrievalHostIpv6Literal(host)).toBe(false);
    expect(RetrievalHostRefusedDetail.safeParse({ ...valid, host }).success).toBe(false);
    expect(isRetrievalHostIpv6Literal(42 as never)).toBe(false);
  });

  it("accepts a digest host with its length, and only with it", () => {
    expect(RETRIEVAL_HOST_DIGEST_PATTERN.test(digest)).toBe(true);
    expect(digest).toHaveLength(71);
    expect(SECURITY_EVENT_DETAIL_VALUE.test(digest)).toBe(true);
    for (const host_length of [1, 128, 129, 200, 8192, 8193, RETRIEVAL_HOST_LENGTH_MAX]) {
      const d = { ...valid, host: digest, host_length };
      expect(RetrievalHostRefusedDetail.parse(d)).toEqual(d);
      expect(retrievalHostRefusedEvent(d).detail).toEqual(d);
    }
    expect(RETRIEVAL_HOST_LENGTH_MAX).toBe(1_048_576);
    expect(RETRIEVAL_URL_MAX_LENGTH).toBe(8192);
  });

  it.each([
    ["no host_length", { host: digest }],
    ["host_length undefined", { host: digest, host_length: undefined }],
    ["host_length 0", { host: digest, host_length: 0 }],
    ["host_length over the maximum", { host: digest, host_length: RETRIEVAL_HOST_LENGTH_MAX + 1 }],
    ["a fractional host_length", { host: digest, host_length: 200.5 }],
    ["a string host_length", { host: digest, host_length: "200" }],
    ["a DNS name with host_length", { host: "docs.partner.example", host_length: 200 }],
    ["an IPv6 literal with host_length", { host: "[2001:db8::1]", host_length: 200 }],
    ["upper-case hex", { host: `sha256:${"0123456789ABCDEF".repeat(4)}`, host_length: 200 }],
    ["63 hex digits", { host: digest.slice(0, -1), host_length: 200 }],
    ["65 hex digits", { host: `${digest}0`, host_length: 200 }],
    ["another prefix", { host: digest.replace("sha256:", "sha-256:"), host_length: 200 }],
    ["an upper-case prefix", { host: digest.replace("sha256", "SHA256"), host_length: 200 }],
    ["the bare hex", { host: digest.slice(7), host_length: 200 }],
  ])("refuses %s, naming the field only", (_why, extra) => {
    const d = { ...valid, ...extra };
    expect(RetrievalHostRefusedDetail.safeParse(d).success).toBe(false);
    const problem = securityEventShapeProblem({
      kind: RETRIEVAL_HOST_REFUSED_EVENT,
      resourceType: "document",
      resourceId: valid.document_id,
      detail: d as never,
    });
    expect(problem).toMatch(/ \((host|host_length|host, host_length)\)$/);
    expect(problem).not.toContain("0123456789");
    expect(problem).not.toContain("200");
  });

  it("names host_length, never a value, when the length and the form disagree", () => {
    const missing = { ...valid, host: digest };
    expect(() => retrievalHostRefusedEvent(missing as never)).toThrow(
      new RangeError("connector.retrieval.host_refused detail is not valid (host_length)"),
    );
    let message = "";
    try {
      retrievalHostRefusedEvent({ ...valid, host: "[2001:db8::1]", host_length: 4242 });
    } catch (e) {
      expect(e).toBeInstanceOf(RangeError);
      message = (e as Error).message;
    }
    expect(message).toBe("connector.retrieval.host_refused detail is not valid (host_length)");
    expect(message).not.toContain("4242");
    expect(message).not.toContain("2001");
  });

  it("takes an IPv6 literal from a refused URL as the parser writes it", () => {
    expect(retrievalHostOf("http://[2001:0DB8:0:0::1]/")).toBe("[2001:db8::1]");
    expect(retrievalHostOf("https://u:p@[::ffff:1.2.3.4]:8443/d?sig=abc#f")).toBe(
      "[::ffff:102:304]",
    );
    expect(retrievalHostOf("https://[fe80::1%25eth0]/")).toBeNull();
    const host = retrievalHostOf("https://[2001:db8::7]/x?X-Amz-Signature=abc")!;
    expect(host).toBe("[2001:db8::7]");
    expect(retrievalHostRefusedEvent({ ...valid, host }).detail).toEqual({ ...valid, host });
  });

  it("still answers null for a host it cannot record in clear (contracts never hash)", () => {
    expect(retrievalHostOf("https://do_cs.partner.example/")).toBeNull();
    expect(retrievalHostOf(`https://${"a".repeat(64)}.example/`)).toBeNull();
    expect(retrievalHostOf(`https://${"a".repeat(129)}/`)).toBeNull();
    const long = `https://docs.partner.example/${"x".repeat(RETRIEVAL_URL_MAX_LENGTH)}`;
    expect(retrievalHostOf(long)).toBeNull();
    expect(retrievalHostOf(long.slice(0, RETRIEVAL_URL_MAX_LENGTH))).toBe("docs.partner.example");
  });
});
