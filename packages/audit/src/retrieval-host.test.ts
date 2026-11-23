// The never-null refused-retrieval host (Udofin PR-UDF-082; R1-D-279; threat model §3.185): every
// input gets a recordable host, a URL's userinfo, port, path, query and fragment never appear,
// and the event built from it passes the kind's strict detail and the sink's generic rule.
import { describe, expect, it } from "vitest";
import {
  RETRIEVAL_HOST_DIGEST_PATTERN,
  RETRIEVAL_URL_MAX_LENGTH,
  RetrievalHostRefusedDetail,
  SECURITY_EVENT_DETAIL_VALUE,
  retrievalHostOf,
  securityEventShapeProblem,
} from "@infrabyx/contracts/kernel";
import { sha256Hex } from "@infrabyx/crypto";
import {
  RETRIEVAL_HOST_UNPARSABLE,
  retrievalHostRecord,
  retrievalHostRefusedEventOf,
} from "./retrieval-host.js";

const ids = {
  partner_tenant_id: "tnt_lender01",
  document_id: "doc_01JDOC0000000000000000000",
  version: 5,
};
// 200 characters: three 63-character labels and an 8-character one.
const LONG = `${`${"a".repeat(63)}.`.repeat(3)}${"b".repeat(8)}`;
const LONG_SHA256 = "df9e72f40159d567b0ea05e9ac49242b63dfecaf829e37711b41cf0d5c0c03e7";

function recordable(r: { host: string; host_length?: number }): void {
  expect(RetrievalHostRefusedDetail.safeParse({ ...ids, ...r }).success).toBe(true);
  expect(SECURITY_EVENT_DETAIL_VALUE.test(r.host)).toBe(true);
}

describe("retrievalHostRecord (PR-UDF-082)", () => {
  it("records a DNS name or an IPv6 literal in clear, exactly as retrievalHostOf", () => {
    for (const [url, host] of [
      ["https://user:pw@Docs.Partner.EXAMPLE:8443/v1/d?sig=abc#f", "docs.partner.example"],
      ["https://docs.partner.example./x", "docs.partner.example"],
      ["https://bücher.example/", "xn--bcher-kva.example"],
      ["http://10.0.0.1/x", "10.0.0.1"],
      ["http://[2001:0DB8:0:0::1]/", "[2001:db8::1]"],
      ["https://u:p@[::ffff:1.2.3.4]:8443/d?X-Amz-Signature=abc", "[::ffff:102:304]"],
      ["https://[::1]/x", "[::1]"],
    ] as const) {
      const r = retrievalHostRecord(url);
      expect(r).toEqual({ host });
      expect(retrievalHostOf(url)).toBe(host);
      recordable(r);
    }
  });

  it("records a name over 128 characters as its SHA-256 with its length", () => {
    expect(LONG).toHaveLength(200);
    const r = retrievalHostRecord(`https://user:secret@${LONG}:8443/path?X-Amz-Signature=abc#f`);
    expect(r).toEqual({ host: `sha256:${LONG_SHA256}`, host_length: 200 });
    expect(r.host).toBe(`sha256:${sha256Hex(LONG)}`);
    expect(r.host).toMatch(RETRIEVAL_HOST_DIGEST_PATTERN);
    recordable(r);
    // Upper case and one trailing dot are removed before hashing, as the parser serialises it.
    expect(retrievalHostRecord(`https://${LONG.toUpperCase()}./x`)).toEqual(r);
    // 128 characters stays in clear; 129 is hashed.
    const n128 = `${"c".repeat(63)}.${"c".repeat(62)}.c`;
    expect(n128).toHaveLength(128);
    expect(retrievalHostRecord(`https://${n128}/`)).toEqual({ host: n128 });
    const r129 = retrievalHostRecord(`https://${n128}c/`);
    expect(r129).toEqual({ host: `sha256:${sha256Hex(`${n128}c`)}`, host_length: 129 });
    recordable(r129);
  });

  it("hashes the punycode form of a long IDN, which can outgrow the URL", () => {
    const idn = Array.from({ length: 40 }, () => "ü").join(".");
    const url = `https://${idn}/`;
    const serialised = new URL(url).hostname;
    expect(serialised.startsWith("xn--tda.")).toBe(true);
    expect(serialised.length).toBeGreaterThan(url.length);
    const r = retrievalHostRecord(url);
    expect(r).toEqual({
      host: `sha256:${sha256Hex(serialised)}`,
      host_length: serialised.length,
    });
    recordable(r);
  });

  it("hashes a short host outside the DNS pattern rather than drop it", () => {
    for (const host of ["do_cs.partner.example", `${"a".repeat(64)}.example`, "-x.example"]) {
      expect(retrievalHostOf(`https://${host}/`)).toBeNull();
      const r = retrievalHostRecord(`https://${host}/`);
      expect(r).toEqual({ host: `sha256:${sha256Hex(host)}`, host_length: host.length });
      recordable(r);
    }
    // An opaque host of another scheme, as the parser writes it (case kept, non-ASCII encoded).
    expect(retrievalHostRecord("foo://Bar/x")).toEqual({
      host: `sha256:${sha256Hex("Bar")}`,
      host_length: 3,
    });
  });

  it.each([
    ["text that is not a URL", "not a url"],
    ["a mailto URL", "mailto:ops@partner.example"],
    ["a file URL with no host", "file:///etc/hosts"],
    ["an empty host", "foo:///x"],
    ["only a dot", "http://./"],
    ["a zone id", "https://[fe80::1%25eth0]/"],
    ["nothing", ""],
    ["9000 characters", `https://docs.partner.example/${"x".repeat(9000)}`],
    ["one over the cap", `https://docs.partner.example/${"x".repeat(RETRIEVAL_URL_MAX_LENGTH)}`],
  ])("records the unparsable marker for %s", (_why, url) => {
    const r = retrievalHostRecord(url);
    expect(r).toEqual({ host: RETRIEVAL_HOST_UNPARSABLE });
    expect(r.host).toBe("unparsable.invalid");
    recordable(r);
  });

  it("never throws, whatever it is given", () => {
    for (const v of [undefined, null, 42, {}, [], Symbol("x"), () => "https://a.example/"])
      expect(retrievalHostRecord(v as never)).toEqual({ host: RETRIEVAL_HOST_UNPARSABLE });
  });

  it("never lets userinfo, a port, a path, a query or a fragment through", () => {
    const secrets = ["hunter2", "8443", "X-Amz-Signature", "s3cr3t", "frag"];
    for (const host of ["docs.partner.example", "[2001:db8::1]", LONG, "do_cs.example"]) {
      const url = `https://admin:hunter2@${host}:8443/s3cr3t/doc?X-Amz-Signature=abc#frag`;
      const text = JSON.stringify(retrievalHostRefusedEventOf({ ...ids, url }));
      for (const s of secrets) expect(text).not.toContain(s);
    }
  });
});

describe("retrievalHostRefusedEventOf (PR-UDF-082)", () => {
  it("builds the checked event for every refused URL", () => {
    for (const url of [
      "https://docs.partner.example/x",
      "https://[2001:db8::1]/x",
      `https://${LONG}/x`,
      "mailto:ops@partner.example",
      "not a url",
    ]) {
      const e = retrievalHostRefusedEventOf({ ...ids, url });
      expect(e).toEqual({
        kind: "connector.retrieval.host_refused",
        resourceType: "document",
        resourceId: ids.document_id,
        detail: { ...ids, ...retrievalHostRecord(url) },
      });
      expect(Object.isFrozen(e.detail)).toBe(true);
      expect(securityEventShapeProblem(e)).toBeNull();
    }
  });

  it("refuses a bad id or version by field name, never because of the URL", () => {
    const url = "https://admin:hunter2@docs.partner.example/x";
    expect(() => retrievalHostRefusedEventOf({ ...ids, partner_tenant_id: "lender", url })).toThrow(
      new RangeError("connector.retrieval.host_refused detail is not valid (partner_tenant_id)"),
    );
    expect(() => retrievalHostRefusedEventOf({ ...ids, version: 0, url })).toThrow(/\(version\)$/);
    expect(() => retrievalHostRefusedEventOf({ ...ids, document_id: "d", url })).toThrow(
      /\(document_id\)$/,
    );
  });
});
