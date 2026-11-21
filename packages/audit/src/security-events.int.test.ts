// `audit/0013` and the security event kind `connector.retrieval.host_refused` (Udofin PR-UDF-072;
// R1-D-262; threat model §3.181): the kind check is widened on a database that already holds
// `rules.reveal.refused` rows (kept), the new kind is written by `PgSecurityEvents` under the
// tenant's RLS with exactly its typed detail, and any other kind is still refused by the table.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { retrievalHostOf, retrievalHostRefusedEvent } from "@infrabyx/contracts/kernel";
import { newId } from "@infrabyx/crypto";
import { PgSecurityEvents } from "./security-events.js";
import { freshDb } from "./__tests__/db.js";

let db: Awaited<ReturnType<typeof freshDb>>;
const T = "tnt_udofin";
const ctx = {
  tenantId: T,
  principal: { id: "svc_udf_documents", type: "service" as const, roles: [] },
  traceId: "trace-hr",
};

beforeAll(async () => {
  db = await freshDb({ auditUpTo: "0012" });
});
afterAll(async () => {
  await db?.end();
});

describe("connector.retrieval.host_refused (PR-UDF-072, audit/0013)", () => {
  it("keeps the earlier rows and records the new kind after the upgrade", async () => {
    const sink = new PgSecurityEvents({ pool: db.pool });
    const before = await sink.record(ctx, {
      kind: "rules.reveal.refused",
      resourceType: "decision",
      resourceId: null,
      detail: { reason: "rule_refused" },
    });
    const event = retrievalHostRefusedEvent({
      partner_tenant_id: "tnt_lender01",
      document_id: "doc_01JDOC0000000000000000000",
      version: 4,
      host: retrievalHostOf("https://u:p@Files.Partner.EXAMPLE:8443/d/1?X-Amz-Signature=abc")!,
    });
    // Before 0013 the table refuses the kind.
    await expect(sink.record(ctx, event)).rejects.toMatchObject({ code: "23514" });
    await db.migrateRest();
    const { id } = await sink.record(ctx, event);
    const rows = (
      await db.admin.query(
        "select id, kind, resource_type, resource_id, detail, tenant_id, actor_id from audit.security_event where tenant_id = $1 order by occurred_at, id",
        [T],
      )
    ).rows;
    expect(rows.map((r) => r.id)).toEqual([before.id, id]);
    expect(rows[1]).toEqual({
      id,
      kind: "connector.retrieval.host_refused",
      resource_type: "document",
      resource_id: "doc_01JDOC0000000000000000000",
      detail: {
        partner_tenant_id: "tnt_lender01",
        document_id: "doc_01JDOC0000000000000000000",
        version: 4,
        host: "files.partner.example",
      },
      tenant_id: T,
      actor_id: "svc_udf_documents",
    });
    const text = JSON.stringify(rows);
    expect(text).not.toContain("Signature");
    expect(text).not.toContain("8443");
    expect(text).not.toContain("u:p");
  });

  it("still refuses an unknown kind at the table", async () => {
    // The same insert with a known kind passes, so the refusal below is the kind check's.
    const insert = (kind: string) =>
      db.admin.query(
        `insert into audit.security_event (id, tenant_id, actor_id, actor_type, kind, resource_type)
         values ($2, $1, 'usr_x', 'user', $3, 'document')`,
        [T, newId("sev"), kind],
      );
    await insert("connector.retrieval.host_refused");
    await expect(insert("connector.other")).rejects.toMatchObject({ code: "23514" });
  });
});
