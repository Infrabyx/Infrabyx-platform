// `PgSecurityEvents` and the typed kind `connector.retrieval.host_refused` (PR-UDF-072; R1-D-262;
// threat model §3.181), without a database: a detail outside the kind's strict shape is refused
// before a connection is taken, so a URL, a query or a credential never reaches the table.
import { describe, expect, it } from "vitest";
import { retrievalHostRefusedEvent, type SecurityEventInput } from "@infrabyx/contracts/kernel";
import { PgSecurityEvents } from "./security-events.js";

function fakePool() {
  const queries: { text: string; params?: readonly unknown[] }[] = [];
  let connects = 0;
  const pool = {
    connect: async () => {
      connects++;
      return {
        query: async (text: string, params?: readonly unknown[]) => {
          queries.push({ text, ...(params ? { params } : {}) });
          return { rows: [] };
        },
        release: () => undefined,
      };
    },
  };
  return { pool, queries, connects: () => connects };
}

const ctx = {
  tenantId: "tnt_udofin",
  principal: { id: "svc_udf_documents", type: "service" as const, roles: [] },
  traceId: "trace-1",
};
const detail = {
  partner_tenant_id: "tnt_lender01",
  document_id: "doc_01JDOC0000000000000000000",
  version: 2,
  host: "docs.partner.example",
};

describe("PgSecurityEvents with connector.retrieval.host_refused (PR-UDF-072)", () => {
  it("records the event in its own transaction as svc_security_event", async () => {
    const f = fakePool();
    const { id } = await new PgSecurityEvents({ pool: f.pool }).record(
      ctx,
      retrievalHostRefusedEvent(detail),
    );
    expect(id).toMatch(/^sev_/);
    expect(f.queries.map((q) => q.text.trim().split(/\s+/)[0])).toEqual([
      "begin",
      "set",
      "select",
      "insert",
      "commit",
    ]);
    expect(f.queries[1]!.text).toBe("set local role svc_security_event");
    const insert = f.queries[3]!;
    expect(insert.params).toEqual([
      id,
      "svc_udf_documents",
      "service",
      "connector.retrieval.host_refused",
      "document",
      detail.document_id,
      JSON.stringify(detail),
      "trace-1",
    ]);
  });

  it.each([
    ["a URL as the host", { ...detail, host: "https://docs.partner.example/x" }],
    ["a query in the host", { ...detail, host: "docs.partner.example?sig=abc" }],
    ["credentials in the host", { ...detail, host: "user:pw@docs.partner.example" }],
    ["a port in the host", { ...detail, host: "docs.partner.example:443" }],
    ["an extra field", { ...detail, url: "https://docs.partner.example/x" }],
    ["a missing field", { partner_tenant_id: "tnt_lender01", document_id: "doc_1x", version: 1 }],
    ["a bad partner tenant", { ...detail, partner_tenant_id: "lender" }],
    ["a bad version", { ...detail, version: 0 }],
  ])("refuses %s before touching the database", async (_why, d) => {
    const f = fakePool();
    const event: SecurityEventInput = {
      kind: "connector.retrieval.host_refused",
      resourceType: "document",
      resourceId: "document_id" in d ? d.document_id : null,
      detail: d,
    };
    await expect(new PgSecurityEvents({ pool: f.pool }).record(ctx, event)).rejects.toBeInstanceOf(
      RangeError,
    );
    expect(f.connects()).toBe(0);
  });

  it("refuses an event that targets anything but the detail's document", async () => {
    const f = fakePool();
    const sink = new PgSecurityEvents({ pool: f.pool });
    const e = retrievalHostRefusedEvent(detail);
    await expect(sink.record(ctx, { ...e, resourceType: "decision" })).rejects.toThrow(
      /resource type document/,
    );
    await expect(sink.record(ctx, { ...e, resourceId: "doc_other" })).rejects.toThrow(
      /document_id/,
    );
    expect(f.connects()).toBe(0);
  });

  it("keeps the generic rule alone for rules.reveal.refused", async () => {
    const f = fakePool();
    await new PgSecurityEvents({ pool: f.pool }).record(ctx, {
      kind: "rules.reveal.refused",
      resourceType: "decision",
      resourceId: null,
      detail: { reason: "rule_refused", input: "score" },
    });
    expect(f.connects()).toBe(1);
  });
});
