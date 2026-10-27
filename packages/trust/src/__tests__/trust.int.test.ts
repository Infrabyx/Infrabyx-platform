// The vendor-assurance mirror, the tenant room, the sweep and the purge on PostgreSQL (PL5 plan §7.2).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgOutbox } from "@infrabyx/tenancy";
import {
  FakeOhDesk,
  FakeTrustFeed,
  fixtureTrustDocuments,
  platformContext,
  startPostgres,
  withTenant,
  type TestDatabase,
} from "@infrabyx/testing";
import type { VadDocument } from "@infrabyx/contracts/ports";
import { publicationDigest, TrustMirror, TrustRoom, TrustSweep } from "../index.js";

let db: TestDatabase;
let feed: FakeTrustFeed;
let desk: FakeOhDesk;
let mirror: TrustMirror;
let room: TrustRoom;
const T1 = "tnt_01JB0000000000000000000TR1";
const T2 = "tnt_01JB0000000000000000000TR2";
const admin1 = withTenant(T1, ["ORG_ADMIN"], {
  principal: { id: "usr_01JB00000000000000000ADM1" },
});
const owner1 = withTenant(T1, ["ORG_OWNER"], {
  principal: { id: "usr_01JB00000000000000000OWN1" },
});
const member1 = withTenant(T1, ["ORG_MEMBER"], {
  principal: { id: "usr_01JB00000000000000000MEM1" },
});
const admin2 = withTenant(T2, ["ORG_ADMIN"], {
  principal: { id: "usr_01JB00000000000000000ADM2" },
});
const [SUBP, A11Y, SOC2] = fixtureTrustDocuments().map((d) => d.vad_id) as [string, string, string];
const settings = {
  get: async (_: unknown, key: string) =>
    ({ "trust.gating.nda_version": "2026.1" })[key as "trust.gating.nda_version"],
};
const published = (d: VadDocument, eventId = `evt_${d.vad_id}_${d.version}`) => ({
  eventId,
  data: Object.fromEntries(
    Object.entries(d).filter(([k]) => !["type_key", "state", "issuer_name"].includes(k)),
  ),
});
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string }) => e.code ?? String(e),
  );
const count = async (sql: string, params: unknown[] = []) =>
  Number((await db.admin.query(`select count(*)::int as n from ${sql}`, params)).rows[0].n);

const build = (d: TestDatabase, f: FakeTrustFeed) =>
  new TrustMirror({
    kernel: d.kernel,
    audit: d.audit,
    product: "OH",
    trust: f,
    outbox: new PgOutbox(),
  });

beforeAll(async () => {
  db = await startPostgres();
  feed = new FakeTrustFeed();
  desk = new FakeOhDesk();
  mirror = build(db, feed);
  room = new TrustRoom({
    kernel: db.kernel,
    audit: db.audit,
    product: "OH",
    mirror,
    trust: feed,
    support: desk,
    outbox: new PgOutbox(),
    settings,
  });
});
afterAll(async () => {
  await db?.end();
});

describe("@IPB-08-AT-01 Operations Hub is the system of record", () => {
  it("lets no principal but the mirror consumer write the mirror", async () => {
    const staff = platformContext(["PLT_SECURITY_OFFICER"]);
    const d = feed.docs[0]!;
    await expect(
      db.kernel.mutate(staff, async (tx) => {
        await tx.query(
          `insert into trust.mirror_document (vad_id, version, title, category, cadence, valid_from, storage_ref, sha256,
             visibility, publication_targets, nda_required, summary, oh_state, mirror_state, source_event_id)
           values ('vad_01JB0000000000000000000NEW', 1, 'x', 'POLICY', 'EVENT', '2026-10-01', 'k', $1, 'PUBLIC', '{OH}',
             false, '', 'PUBLISHED', 'VISIBLE', 'x')`,
          [d.sha256],
        );
        await db.audit.record(tx, { action: "test", resourceType: "vad", resourceId: "x" });
      }),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("mirror state machine (Ecosystem §6.34, IPB-08-27…29)", () => {
  it("takes each announced version to VISIBLE once, and reconciles with OH's digest", async () => {
    for (const d of feed.docs) expect(await mirror.onPublished(published(d))).toBe("VISIBLE");
    expect(await mirror.onPublished(published(feed.docs[0]!))).toBeNull();
    expect(await mirror.reconcile()).toEqual({ reachable: true, announced: 0, digestOk: true });
    expect((await mirror.staleness()).stale).toBe(false);
  });

  it("keeps the verified version visible when a new version's digest does not match (IPB-TRUST-009)", async () => {
    const v1 = feed.docs[0]!;
    const v2: VadDocument = { ...v1, version: 2, sha256: "b".repeat(64), summary: "Updated list" };
    // OH's file for the document still carries v1's digest: the announced v2 does not verify.
    expect(await mirror.onPublished(published(v2))).toBe("FETCHED");
    const rows = (await mirror.rows()).filter((r) => r.vad_id === SUBP);
    expect(rows.map((r) => [r.version, r.mirror_state])).toEqual([
      [1, "VISIBLE"],
      [2, "FETCHED"],
    ]);
    expect(
      await count("trust.outbox where envelope->>'type' = 'in.oh.trust.MirrorDigestMismatch.v1'"),
    ).toBe(1);
    expect(await count("audit.ledger where action = 'trust.mirror.digest_mismatch'")).toBe(1);
  });

  it("supersedes the older version once the new one verifies", async () => {
    const a1 = feed.docs.find((d) => d.vad_id === A11Y)!;
    const a2: VadDocument = { ...a1, version: 2, sha256: "c".repeat(64) };
    feed.docs = feed.docs.map((d) => (d.vad_id === A11Y ? a2 : d));
    expect(await mirror.onPublished(published(a2))).toBe("VISIBLE");
    const rows = (await mirror.rows()).filter((r) => r.vad_id === A11Y);
    expect(rows.map((r) => [r.version, r.mirror_state, r.oh_state])).toEqual([
      [1, "SUPERSEDED", "SUPERSEDED"],
      [2, "VISIBLE", "PUBLISHED"],
    ]);
    await expect(
      db.admin.query("update trust.mirror_document set sha256 = $1 where vad_id = $2", [
        "d".repeat(64),
        A11Y,
      ]),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.admin.query("delete from trust.mirror_document where vad_id = $1", [A11Y]),
    ).rejects.toThrow(/retained/);
  });

  it("hides a withdrawn version at once and shows it again when OH re-publishes it", async () => {
    const changed = (state: string, n: number) => ({
      eventId: `evt_state_${n}`,
      data: {
        vad_id: A11Y,
        version: 2,
        state,
        visibility: "PUBLIC",
        publication_targets: ["OH"],
        reason_code: "ERROR",
        changed_at: new Date().toISOString(),
      },
    });
    expect(await mirror.onStateChanged(changed("WITHDRAWN", 1))).toBe("HIDDEN");
    expect(await mirror.onStateChanged(changed("WITHDRAWN", 1))).toBeNull();
    expect(await mirror.onStateChanged(changed("PUBLISHED", 2))).toBe("VISIBLE");
  });

  it("serves the last verified mirror when OH is unreachable, labelled after the stale window", async () => {
    feed.reachable = false;
    expect((await mirror.reconcile()).reachable).toBe(false);
    feed.reachable = true;
    const later = new TrustMirror({
      kernel: db.kernel,
      audit: db.audit,
      product: "OH",
      trust: feed,
      now: () => new Date(Date.now() + 8 * 86_400_000),
    });
    expect(await later.staleness(60)).toMatchObject({ stale: true, label: true });
  });

  it("rebuilds the same mirror from a replay of the events", async () => {
    const fresh = await startPostgres();
    try {
      const replica = build(fresh, new FakeTrustFeed(structuredClone(feed.docs)));
      for (const d of fixtureTrustDocuments()) await replica.onPublished(published(d));
      const a2 = feed.docs.find((d) => d.vad_id === A11Y)!;
      await replica.onPublished(published(a2));
      const key = (rows: Awaited<ReturnType<TrustMirror["rows"]>>) =>
        rows
          .filter((r) => r.mirror_state === "VISIBLE")
          .map((r) => `${r.vad_id}:${r.version}:${r.sha256}`)
          .sort();
      expect(key(await replica.rows())).toEqual(key(await mirror.rows()));
      expect(
        publicationDigest((await replica.rows()).filter((r) => r.mirror_state === "VISIBLE")),
      ).toBe(publicationDigest((await mirror.rows()).filter((r) => r.mirror_state === "VISIBLE")));
    } finally {
      await fresh.end();
    }
  });
});

describe("tenant view (IPB-08 §08.3.2)", () => {
  it("lists PUBLIC and gated documents to the view roles only", async () => {
    const list = await room.list(admin1);
    expect(list.documents.map((d) => [d.title, d.gating])).toEqual([
      ["Accessibility statement", "public"],
      ["SOC 2 Type II report", "nda"],
      ["Sub-processor list", "public"],
    ]);
    expect(list.ndaAccepted).toBe(false);
    expect(await code(room.list(member1))).toBe("IPB-UX-011");
  });

  it("@IPB-08-AT-06 refuses an NDA-gated download until the NDA is accepted, then still never serves an unwatermarked copy", async () => {
    expect(await code(room.download(admin1, SOC2))).toBe("IPB-TRUST-002");
    expect(await code(room.acceptNda(member1))).toBe("IPB-UX-011");
    const nda = await room.acceptNda(owner1);
    expect(nda.version).toBe("2026.1");
    expect((await room.acceptNda(admin1)).ndaId).toBe(nda.ndaId);
    expect(
      await count(
        "trust.outbox where envelope->>'type' = 'in.oh.trust.NdaAccepted.v1' and tenant_id = $1",
        [T1],
      ),
    ).toBe(1);
    expect(await code(room.download(admin1, SOC2))).toBe("IPB-TRUST-012");
    expect(await count("trust.acknowledgement where vad_id = $1", [SOC2])).toBe(0);
  });

  it("downloads a public document with an acknowledgement that holds the delivered digest", async () => {
    const r = await room.download(admin1, SUBP, {
      purpose: "RBI inspection Nov 2026",
      ipClass: "IN-private",
    });
    expect(r.url).toContain("sig=fixture");
    const ack = (
      await db.admin.query("select * from trust.acknowledgement where id = $1", [
        r.acknowledgementId,
      ])
    ).rows[0];
    expect(ack).toMatchObject({
      tenant_id: T1,
      vad_id: SUBP,
      version: 1,
      action: "DOWNLOADED",
      purpose: "RBI inspection Nov 2026",
      delivered_sha256: r.sha256,
    });
    expect(await code(room.download(admin1, SUBP, { purpose: "call 9876543210" }))).toBe(
      "IPB-CMS-001",
    );
    await expect(
      db.admin.query("update trust.acknowledgement set purpose = 'x' where id = $1", [
        r.acknowledgementId,
      ]),
    ).rejects.toThrow(/evidence/);
  });

  it("@IPB-08-AT-10 never shows another tenant's acknowledgements or an unpublished document", async () => {
    expect((await room.acknowledgements(admin1)).length).toBeGreaterThan(0);
    expect(await room.acknowledgements(admin2)).toEqual([]);
    expect(await code(room.download(admin2, "vad_01JB0000000000000000NOPE1"))).toBe(
      "IPB-TRUST-001",
    );
    expect(await count("trust.acknowledgement where tenant_id = $1", [T2])).toBe(0);
  });

  it("@IPB-08-AT-09 opens a request with the regulator SLA and an OH ticket, and tracks fulfilment", async () => {
    const before = Date.now();
    const r = await room.request(admin1, {
      typeKey: "undertaking_data_localisation",
      description: "Data localisation undertaking",
      purpose: "Regulator inspection",
      regulatorDeadline: "2026-11-15",
    });
    expect(r.synced).toBe(true);
    expect(new Date(r.ackDue).getTime() - before).toBeLessThanOrEqual(24 * 3_600_000 + 5_000);
    expect(Math.round((new Date(r.fulfilDue).getTime() - before) / 86_400_000)).toBe(3);
    expect(desk.tickets.at(-1)?.summary).toContain(r.requestId);
    await room.onRequestProgress(T1, r.requestId, { state: "fulfilled", fulfilledVadId: SUBP });
    expect((await room.requests(admin1)).find((x) => x.id === r.requestId)).toMatchObject({
      state: "fulfilled",
      fulfilledVadId: SUBP,
    });
  });

  it("accepts a request while OH is down and syncs it from the sweep; flags missed SLAs once", async () => {
    const offline = new TrustRoom({
      kernel: db.kernel,
      audit: db.audit,
      product: "OH",
      mirror,
      trust: feed,
      support: {
        ...desk,
        descriptor: desk.descriptor,
        health: desk.health,
        getStatus: desk.getStatus.bind(desk),
        createTicket: async () => {
          throw new Error("OH unreachable");
        },
      },
    });
    const r = await offline.request(admin1, { description: "Business continuity test summary" });
    expect(r.synced).toBe(false);
    const sweepAt = (ms: number) =>
      new TrustSweep({
        kernel: db.kernel,
        audit: db.audit,
        room,
        now: () => new Date(Date.now() + ms),
      });
    expect((await sweepAt(120_000).tick()).synced).toBe(1);
    const late = await sweepAt(11 * 86_400_000).tick();
    expect(late.breaches).toBe(2);
    expect((await sweepAt(12 * 86_400_000).tick()).breaches).toBe(0);
  });

  it("records subscriptions per type or for all types", async () => {
    await room.subscribe(admin1, { typeKey: null, channels: ["email"] });
    await room.subscribe(admin1, { typeKey: null, channels: ["in_app", "email"] });
    await room.subscribe(admin1, { typeKey: "subprocessor_list", channels: ["in_app"] });
    expect(await count("trust.subscription where tenant_id = $1", [T1])).toBe(2);
    await room.unsubscribe(admin1, "subprocessor_list");
    expect(await count("trust.subscription where tenant_id = $1", [T1])).toBe(1);
  });
});

describe("OWNER-QUESTIONS #48: acknowledgements are deleted 10 years after their version ended", () => {
  it("purges only acknowledgements of versions ended over 10 years ago and never under legal hold", async () => {
    const sweep = new TrustSweep({ kernel: db.kernel, audit: db.audit, room });
    // The sub-processor list v1 ended long ago; the accessibility statement v2 is current.
    await room.acknowledge(admin2, A11Y);
    await room.acknowledge(admin2, SUBP);
    await db.admin.query(
      "update trust.mirror_document set oh_state = 'SUPERSEDED', ended_at = now() - interval '10 years 1 day' where vad_id = $1 and version = 1",
      [SUBP],
    );
    const legal = platformContext(["PLT_LEGAL_REVIEWER"], "tnt_platform", "usr_legal");
    expect(
      await code(
        sweep.legalHold(admin1, { tenantId: T1, vadId: SUBP, on: true, reason: "dispute" }),
      ),
    ).toBe("IPB-UX-011");
    expect(
      await sweep.legalHold(legal, {
        tenantId: T1,
        vadId: SUBP,
        on: true,
        reason: "pending dispute",
      }),
    ).toBe(1);
    expect((await sweep.purge()).deleted).toBe(1);
    expect(
      await count("trust.acknowledgement where tenant_id = $1 and vad_id = $2", [T2, SUBP]),
    ).toBe(0);
    expect(
      await count("trust.acknowledgement where tenant_id = $1 and vad_id = $2", [T2, A11Y]),
    ).toBe(1);
    expect(
      await count("trust.acknowledgement where tenant_id = $1 and vad_id = $2", [T1, SUBP]),
    ).toBe(1);
    await sweep.legalHold(legal, {
      tenantId: T1,
      vadId: SUBP,
      on: false,
      reason: "dispute closed",
    });
    expect((await sweep.purge()).deleted).toBe(1);
    expect(await count("audit.ledger where action = 'trust.acknowledgement.purge'")).toBe(2);
  });
});
