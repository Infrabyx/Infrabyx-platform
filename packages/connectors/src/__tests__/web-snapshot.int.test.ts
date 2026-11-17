// PlatformWebSnapshot on PostgreSQL 18 with every platform migration applied (PR-LDC-40,
// R1-D-176; threat model §3.125; connectors/0006): the row and its ledger entry in one transaction,
// RLS across tenants, the immutability trigger, the scan states and rescan, `open` refusing a
// quarantined, rejected or altered copy, the type and signature checks, the rate limit, the
// write-once path, the refused callers and the off switch.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localBlindIndexRoot } from "@infrabyx/crypto";
import type { EgressFetchOptions, EgressFetchResult, EgressPort } from "@infrabyx/contracts/ports";
import { RateLimiter } from "@infrabyx/tenancy";
import {
  agentContext,
  defineWebSnapshotContract,
  EICAR,
  FakeFileScan,
  MemoryStorage,
  platformContext,
  startPostgres,
  withTenant,
  type TestDatabase,
} from "@infrabyx/testing";
import { PlatformWebSnapshot } from "../web-snapshot/service.js";

let db: TestDatabase;
beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'LD', 'A'), ('tnt_b', 'LD', 'B'), ('tnt_c', 'LD', 'C')",
  );
});
afterAll(async () => db?.end());

const enc = (s: string) => new TextEncoder().encode(s);
const PDF = enc("%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF\n");

class StubEgress implements EgressPort {
  readonly descriptor = {
    port: "EGRESS",
    adapter: "stub",
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
  } as const;
  readonly calls: { url: string; o: EgressFetchOptions | undefined }[] = [];
  pages = new Map<string, Partial<EgressFetchResult>>();
  async health() {
    return { status: "up" as const, latency_ms: 0, checked_at: new Date().toISOString() };
  }
  async fetch(url: string, o?: EgressFetchOptions): Promise<EgressFetchResult> {
    this.calls.push({ url, o });
    const p = this.pages.get(url);
    if (!p) throw new Error(`no stub page for ${url}`);
    return {
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: enc("<p>x</p>"),
      finalUrl: url,
      redirects: [],
      contentEncoding: "identity",
      ...p,
    };
  }
}

function setup(over: { enabled?: boolean; perHour?: number } = {}) {
  const storage = new MemoryStorage();
  const av = new FakeFileScan(storage);
  const egress = new StubEgress();
  const svc = new PlatformWebSnapshot({
    kernel: db.kernel,
    audit: db.audit,
    egress,
    storage,
    av,
    rateLimiter: new RateLimiter({ pool: db.pool, product: "ldc", root: localBlindIndexRoot() }),
    enabled: () => over.enabled ?? true,
    allowHosts: (t) => (t === "tnt_a" ? ["rbi.example.in", "*.gov.example"] : ["other.example"]),
    perHour: () => over.perHour ?? 60,
  });
  return { svc, storage, av, egress };
}
const A = withTenant("tnt_a", ["ORG_ADMIN"], { principal: { id: "usr_maker" } });
const B = withTenant("tnt_b");
const req = (url: string, extra: Record<string, unknown> = {}) => ({
  url,
  outputPrefix: "tenant/tnt_a/evidence",
  reference: "obl_01JXYZ",
  ...extra,
});

describe("PlatformWebSnapshot (connectors/0006)", () => {
  it("archives a page: stored as received, scanned, recorded with its ledger entry in one transaction", async () => {
    const { svc, storage, egress } = setup();
    const url = "https://rbi.example.in/circular?id=12";
    egress.pages.set(url, {
      body: enc("<html>circular 12</html>"),
      finalUrl: "https://www.gov.example/c/12",
      redirects: ["https://www.gov.example/c/12"],
      contentEncoding: "gzip",
    });
    const s = await svc.archive(A, req(url));
    expect(s).toMatchObject({
      tenantId: "tnt_a",
      requestedUrl: url,
      finalUrl: "https://www.gov.example/c/12",
      redirects: ["https://www.gov.example/c/12"],
      httpStatus: 200,
      contentType: "text/html",
      charset: "utf-8",
      contentEncoding: "gzip",
      bytes: 24,
      state: "RELEASED",
      reference: "obl_01JXYZ",
      requestedBy: "usr_maker",
      bucketClass: "CONFIDENTIAL",
      retainUntil: null,
    });
    expect(s.id).toMatch(/^wsn_/);
    expect(s.file.storageKey).toBe(`tenant/tnt_a/evidence/${s.id.slice(4)}.html`);
    expect(egress.calls[0]!.o).toMatchObject({
      maxRedirects: 5,
      allowHosts: ["rbi.example.in", "*.gov.example"],
      maxBytes: 10 * 1024 * 1024,
      timeoutMs: 20_000,
    });
    expect(storage.objects.get(s.file.storageKey)?.meta).toMatchObject({
      sha256: s.sha256,
      bucketClass: "CONFIDENTIAL",
      contentType: "text/html",
    });
    const led = await db.admin.query<{
      action: string;
      actor_id: string;
      business_ids: string[] | null;
    }>("select action, actor_id, business_ids from audit.ledger where resource_id = $1", [s.id]);
    expect(led.rows).toEqual([
      {
        action: "connectors.web_snapshot.archive",
        actor_id: "usr_maker",
        business_ids: ["obl_01JXYZ"],
      },
    ]);
    const opened = await svc.open(A, s.id);
    expect(new TextDecoder().decode(opened.body)).toBe("<html>circular 12</html>");
    expect(opened.headers).toMatchObject({
      "Content-Disposition": `attachment; filename="${s.id}.html"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Content-Type": "text/html; charset=utf-8",
    });
    expect(await svc.get(B, s.id)).toBeNull();
    await expect(svc.open(B, s.id)).rejects.toMatchObject({ code: "IPB-STOR-001" });
  });

  it("the trigger keeps what was fetched; a final state is final; there is no delete", async () => {
    const { svc, egress } = setup();
    egress.pages.set("https://rbi.example.in/t", {});
    const s = await svc.archive(A, req("https://rbi.example.in/t"));
    await expect(
      db.admin.query("update connectors.web_snapshot set sha256 = repeat('0', 64) where id = $1", [
        s.id,
      ]),
    ).rejects.toThrow(/keeps what was fetched/);
    await expect(
      db.admin.query(
        "update connectors.web_snapshot set final_url = 'https://x.example/' where id = $1",
        [s.id],
      ),
    ).rejects.toThrow(/keeps what was fetched/);
    await expect(
      db.admin.query("update connectors.web_snapshot set state = 'QUARANTINED' where id = $1", [
        s.id,
      ]),
    ).rejects.toThrow(/is final/);
    const grants = await db.admin.query<{ privilege_type: string }>(
      "select privilege_type from information_schema.role_table_grants where table_schema = 'connectors' and table_name = 'web_snapshot' and grantee = 'app_rw' order by 1",
    );
    expect(grants.rows.map((r) => r.privilege_type)).toEqual(["INSERT", "SELECT", "UPDATE"]);
  });

  it("an ERROR scan quarantines the copy until a rescan; an infected copy is rejected; open refuses both", async () => {
    const { svc, egress, av } = setup();
    egress.pages.set("https://rbi.example.in/q", { contentType: "application/pdf", body: PDF });
    av.mode = "timeout";
    const q = await svc.archive(A, req("https://rbi.example.in/q"));
    expect(q).toMatchObject({
      state: "QUARANTINED",
      contentType: "application/pdf",
      scan: { verdict: "ERROR", reason: "timeout" },
    });
    await expect(svc.open(A, q.id)).rejects.toMatchObject({
      code: "IPB-SEC-015",
      meta: { reason: "quarantined" },
    });
    expect((await svc.rescan(A, q.id)).state).toBe("QUARANTINED");
    av.mode = null;
    const r = await svc.rescan(A, q.id);
    expect(r).toMatchObject({ state: "RELEASED", scan: { verdict: "CLEAN" } });
    expect((await svc.open(A, r.id)).headers["Content-Disposition"]).toBe(
      `attachment; filename="${r.id}.pdf"`,
    );
    const actions = await db.admin.query<{ action: string }>(
      "select action from audit.ledger where resource_id = $1 order by seq",
      [q.id],
    );
    expect(actions.rows.map((x) => x.action)).toEqual([
      "connectors.web_snapshot.archive",
      "connectors.web_snapshot.rescan",
    ]);
    // A released copy is not scanned again.
    expect((await svc.rescan(A, r.id)).state).toBe("RELEASED");

    egress.pages.set("https://rbi.example.in/eicar", { contentType: "text/plain", body: EICAR });
    const x = await svc.archive(A, req("https://rbi.example.in/eicar"));
    expect(x).toMatchObject({ state: "REJECTED", scan: { verdict: "INFECTED" } });
    await expect(svc.open(A, x.id)).rejects.toMatchObject({ code: "IPB-SEC-011" });
  });

  it("open refuses bytes that no longer hash to the record", async () => {
    const { svc, egress, storage } = setup();
    egress.pages.set("https://rbi.example.in/alt", {});
    const s = await svc.archive(A, req("https://rbi.example.in/alt"));
    const o = storage.objects.get(s.file.storageKey)!;
    storage.objects.set(s.file.storageKey, { ...o, body: enc("<p>y</p>") });
    await expect(svc.open(A, s.id)).rejects.toMatchObject({
      code: "IPB-SEC-015",
      meta: { reason: "hash_mismatch" },
    });
  });

  it("refuses a status other than 200, a type off the list, and bytes that are not their type", async () => {
    const { svc, egress, storage } = setup();
    egress.pages.set("https://rbi.example.in/404", { status: 404 });
    egress.pages.set("https://rbi.example.in/svg", {
      contentType: "image/svg+xml",
      body: enc("<svg/>"),
    });
    egress.pages.set("https://rbi.example.in/js", { contentType: "application/javascript" });
    egress.pages.set("https://rbi.example.in/fake.pdf", {
      contentType: "application/pdf",
      body: enc("<html>not a pdf</html>"),
    });
    egress.pages.set("https://rbi.example.in/fake.png", {
      contentType: "image/png",
      body: enc("GIF89a...."),
    });
    await expect(svc.archive(A, req("https://rbi.example.in/404"))).rejects.toMatchObject({
      code: "IPB-PORT-002",
      meta: { reason: "status" },
    });
    await expect(svc.archive(A, req("https://rbi.example.in/svg"))).rejects.toMatchObject({
      code: "IPB-SEC-010",
      meta: { reason: "content_type" },
    });
    await expect(svc.archive(A, req("https://rbi.example.in/js"))).rejects.toMatchObject({
      code: "IPB-SEC-010",
    });
    await expect(svc.archive(A, req("https://rbi.example.in/fake.pdf"))).rejects.toMatchObject({
      code: "IPB-SEC-010",
      meta: { reason: "signature" },
    });
    await expect(svc.archive(A, req("https://rbi.example.in/fake.png"))).rejects.toMatchObject({
      code: "IPB-SEC-010",
      meta: { reason: "signature" },
    });
    expect(storage.objects.size).toBe(0);
  });

  it("refuses another tenant's prefix, a nested prefix, an http URL and a past retention date", async () => {
    const { svc, egress } = setup();
    egress.pages.set("https://rbi.example.in/p", {});
    await expect(
      svc.archive(A, req("https://rbi.example.in/p", { outputPrefix: "tenant/tnt_b/evidence" })),
    ).rejects.toMatchObject({ code: "IPB-SEC-018", meta: { reason: "prefix" } });
    await expect(
      svc.archive(
        A,
        req("https://rbi.example.in/p", { outputPrefix: "tenant/tnt_a/evidence/web" }),
      ),
    ).rejects.toMatchObject({ meta: { reason: "prefix" } });
    await expect(svc.archive(A, req("http://rbi.example.in/p"))).rejects.toThrow();
    await expect(
      svc.archive(A, req("https://rbi.example.in/p", { retainUntil: "2020-01-01T00:00:00Z" })),
    ).rejects.toThrow(RangeError);
    expect(egress.calls).toEqual([]);
  });

  it("a retention date takes the write-once path", async () => {
    const { svc, egress, storage } = setup();
    egress.pages.set("https://rbi.example.in/keep", {});
    const until = new Date(Date.now() + 86_400_000 * 30).toISOString();
    const s = await svc.archive(
      A,
      req("https://rbi.example.in/keep", { retainUntil: until, bucketClass: "REGULATED" }),
    );
    expect(s.retainUntil).toBe(until);
    expect(s.bucketClass).toBe("REGULATED");
    expect((await storage.retentionOf!(s.file.storageKey)).mode).toBe("COMPLIANCE");
  });

  it("the tenant's rate limit holds across instances (IPB-SEC-019)", async () => {
    const C = withTenant("tnt_c");
    const one = setup({ perHour: 2 });
    const two = setup({ perHour: 2 });
    for (const x of [one, two]) x.egress.pages.set("https://other.example/r", {});
    const reqC = { url: "https://other.example/r", outputPrefix: "tenant/tnt_c/evidence" };
    await one.svc.archive(C, reqC);
    await two.svc.archive(C, reqC);
    await expect(one.svc.archive(C, reqC)).rejects.toMatchObject({ code: "IPB-SEC-019" });
    expect(two.egress.calls).toHaveLength(1);
  });

  it("refuses agents, external principals, break-glass, impersonation, platform staff, and is off by default", async () => {
    const { svc, egress } = setup();
    egress.pages.set("https://rbi.example.in/who", {});
    const r = req("https://rbi.example.in/who");
    await expect(svc.archive(agentContext("tnt_a"), r)).rejects.toMatchObject({
      code: "IPB-SEC-004",
      meta: { reason: "agent" },
    });
    await expect(
      svc.archive(withTenant("tnt_a", [], { principal: { type: "external" } }), r),
    ).rejects.toMatchObject({ meta: { reason: "external" } });
    await expect(
      svc.archive(withTenant("tnt_a", ["ORG_ADMIN"], { breakGlassGrantId: "bgr_1" }), r),
    ).rejects.toMatchObject({ meta: { reason: "break_glass" } });
    await expect(
      svc.archive(
        withTenant("tnt_a", ["ORG_ADMIN"], { act: { sub: "usr_staff", sessionId: "s1" } }),
        r,
      ),
    ).rejects.toMatchObject({ code: "IPB-SEC-003" });
    await expect(svc.archive(withTenant("tnt_a", ["PLT_SUPPORT"]), r)).rejects.toMatchObject({
      meta: { reason: "platform" },
    });
    await expect(
      svc.archive(platformContext(["PLT_SUPER_ADMIN"], "tnt_a"), r),
    ).rejects.toMatchObject({ meta: { reason: "platform" } });
    const off = setup({ enabled: false });
    await expect(off.svc.archive(A, r)).rejects.toMatchObject({ code: "IPB-PORT-001" });
    expect(egress.calls).toEqual([]);
  });
});

defineWebSnapshotContract("PlatformWebSnapshot on PostgreSQL", async () => {
  const { svc, egress, storage } = setup();
  return {
    port: svc,
    ctx: A,
    prefix: "tenant/tnt_a/evidence",
    otherTenant: B,
    base: "https://rbi.example.in",
    serve: (url, page) =>
      egress.pages.set(url, {
        status: page.status ?? 200,
        contentType: page.contentType,
        body: page.body,
      }),
    corrupt: async (s) => {
      const o = storage.objects.get(s.file.storageKey)!;
      storage.objects.set(s.file.storageKey, { ...o, body: enc("altered") });
    },
  };
});
