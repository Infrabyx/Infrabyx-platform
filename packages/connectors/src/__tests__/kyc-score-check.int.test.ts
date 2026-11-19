// PgKycScoreCheckStore on PostgreSQL 18 with every platform migration applied (Udofin PR-UDF-044,
// R1-D-197; threat model §3.140; connectors/0013): keyed liveness and face-match checks by hash
// under forced RLS, a key scoped to its method, the ledger and the table without the key, a file's
// storage key or SHA-256 (and no image, template or embedding), the conflict rule, the first answer
// kept, expiry, the guard trigger, and the IDfy adapter's retry served on another instance with no
// second vendor call, with the contract's cases and sweep over the answers.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "@infrabyx/crypto";
import { findAadhaarLike } from "@infrabyx/contracts/aadhaar";
import {
  kycContractCases,
  KYC_FAKE_FIXTURES,
  MemoryStorage,
  startIdfyKycStub,
  startPostgres,
  withTenant,
  type IdfyKycStub,
  type KycFixtures,
  type TestDatabase,
} from "@infrabyx/testing";
import type { KycFileRef, ScoreResult } from "@infrabyx/contracts/ports";
import { IdfyKyc } from "../kyc/idfy.js";
import {
  kycScoreKeyHash,
  PgKycScoreCheckStore,
  type KycScoreCheckRequest,
} from "../kyc/score-checks.js";

let db: TestDatabase;
let idfy: IdfyKycStub;
beforeAll(async () => {
  db = await startPostgres();
  idfy = await startIdfyKycStub();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'LD', 'A'), ('tnt_b', 'LD', 'B')",
  );
});
afterAll(async () => {
  await idfy?.close();
  await db?.end();
});

const store = (ttlHours?: number) =>
  new PgKycScoreCheckStore({
    kernel: db.kernel,
    audit: db.audit,
    context: (t) => withTenant(t, ["ORG_ADMIN"], { principal: { id: "svc_kyc", type: "service" } }),
    ...(ttlHours !== undefined ? { ttlHours } : {}),
  });

const FRAME_KEY = "tenant/tnt_a/kyc/01JA00000000000000000000F1.jpg";
const FRAME_SHA = sha256Hex("frame-one");
const frame: KycFileRef = { storageKey: FRAME_KEY, sha256: FRAME_SHA };
const req = (over: Partial<KycScoreCheckRequest> = {}): KycScoreCheckRequest => ({
  tenantId: "tnt_a",
  adapter: "idfy-kyc",
  method: "liveness",
  idempotencyKey: "score-key-1",
  files: [frame],
  mode: "passive",
  ...over,
});

const result = (): ScoreResult => ({
  vendorRef: "REQ0000000001",
  adapter: "idfy-kyc",
  modelVersion: "liveness-stub-1",
  checkedAt: "2026-11-19T00:00:00.000Z",
  score: 0.91,
  passed: true,
  threshold: 0.8,
  mode: "passive",
});

const ledger = async (tenant = "tnt_a") =>
  (
    await db.admin.query(
      "select * from audit.ledger where tenant_id = $1 and action like 'connectors.kyc_score.%' order by seq",
      [tenant],
    )
  ).rows;

describe("connectors.kyc_score_check (PR-UDF-044, threat model §3.140)", () => {
  it("is tenant-scoped with RLS enabled and forced, granted as its peers, every column classed", async () => {
    const rls = await db.admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "select relrowsecurity, relforcerowsecurity from pg_class where oid = 'connectors.kyc_score_check'::regclass",
    );
    expect(rls.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    const grants = await db.admin.query<{ g: string }>(
      `select grantee || ':' || string_agg(privilege_type, ',' order by privilege_type) as g
         from information_schema.role_table_grants
        where table_schema = 'connectors' and table_name = 'kyc_score_check'
          and grantee in ('app_rw', 'app_ro') group by grantee order by grantee`,
    );
    expect(grants.rows.map((r) => r.g)).toEqual([
      "app_ro:SELECT",
      "app_rw:DELETE,INSERT,SELECT,UPDATE",
    ]);
    const classes = await db.admin.query<{ n: string; c: string | null }>(
      `select attname as n, col_description('connectors.kyc_score_check'::regclass, attnum) as c
         from pg_attribute where attrelid = 'connectors.kyc_score_check'::regclass
          and attnum > 0 and not attisdropped`,
    );
    expect(classes.rows.length).toBe(12);
    for (const r of classes.rows) expect(r.c).toMatch(/^dataclass:[A-Z]+$/);
    expect(classes.rows.find((r) => r.n === "result")?.c).toBe("dataclass:REGULATED");
  });

  it("reserves, completes and replays a keyed check; keeps hashes only, no file reference, image or template", async () => {
    const s = store();
    const r = await s.reserve(req());
    expect(r.kind).toBe("new");
    const id = (r as { id: string }).id;
    expect(await s.reserve(req())).toEqual({ kind: "pending", id });
    expect(await s.complete(req(), id, result())).toEqual(result());
    expect(await s.reserve(req())).toEqual({ kind: "done", result: result() });
    const rows = (await db.admin.query("select * from connectors.kyc_score_check")).rows;
    const text = JSON.stringify(rows);
    for (const v of ["score-key-1", FRAME_KEY, FRAME_SHA]) expect(text).not.toContain(v);
    // No plain digest of the file's reference is anywhere in the row.
    for (const d of [FRAME_KEY, FRAME_SHA, `${FRAME_KEY}${FRAME_SHA}`])
      expect(text).not.toContain(sha256Hex(d));
    expect(rows[0]).toMatchObject({
      key_hash: kycScoreKeyHash("liveness", "score-key-1"),
      method: "liveness",
      mode: "passive",
      state: "done",
    });
    expect(Object.keys(rows[0] as object).sort()).toEqual(
      [
        "adapter",
        "created_at",
        "expires_at",
        "id",
        "key_hash",
        "method",
        "mode",
        "request_hash",
        "result",
        "state",
        "tenant_id",
        "updated_at",
      ].sort(),
    );
    expect(Object.keys((rows[0] as { result: object }).result).sort()).toEqual(
      Object.keys(result()).sort(),
    );
  });

  it("the same key with other frames or another mode is IPB-PORT-004; on faceMatch it is another check; a later finisher does not overwrite", async () => {
    const s = store();
    for (const over of [
      { files: [{ ...frame, sha256: sha256Hex("frame-two") }] },
      { files: [frame, frame] },
      { mode: "active_gesture" as const },
    ])
      await expect(s.reserve(req(over))).rejects.toMatchObject({
        code: "IPB-PORT-004",
        meta: { reason: "idempotency_conflict" },
      });
    const face = req({ method: "face_match", files: [frame, frame] });
    delete face.mode;
    const r = await s.reserve(face);
    expect(r.kind).toBe("new");
    const id = (r as { id: string }).id;
    const faceResult: ScoreResult = { ...result(), modelVersion: "face-compare-stub-1" };
    delete faceResult.mode;
    expect(await s.complete(face, id, faceResult)).toEqual(faceResult);
    expect(await s.complete(face, id, { ...faceResult, score: 0.1, passed: false })).toEqual(
      faceResult,
    );
    // A face match carries no mode, a liveness check always one.
    await expect(
      db.kernel.mutate(withTenant("tnt_a"), (tx) =>
        tx.query(
          `insert into connectors.kyc_score_check
             (id, tenant_id, adapter, method, key_hash, request_hash, mode, state, expires_at)
           values ('ksc_01JA0000000000000000000008', 'tnt_a', 'idfy-kyc', 'face_match', $1, $1,
                   'passive', 'pending', now())`,
          ["c".repeat(64)],
        ),
      ),
    ).rejects.toThrow();
  });

  it("the ledger names the step, the method and the record; never the key or a file's reference", async () => {
    const rows = await ledger();
    expect(rows.map((r) => (r as { action: string }).action)).toEqual([
      "connectors.kyc_score.reserve",
      "connectors.kyc_score.found",
      "connectors.kyc_score.complete",
      "connectors.kyc_score.replay",
      "connectors.kyc_score.reserve",
      "connectors.kyc_score.complete",
      "connectors.kyc_score.replay",
    ]);
    const all = JSON.stringify(rows);
    for (const v of ["score-key-1", FRAME_KEY, FRAME_SHA]) expect(all).not.toContain(v);
    // Hex digests join letters to digits, as the repository sweep reads them (#146).
    expect(findAadhaarLike(all, { letters: "join" })).toEqual([]);
  });

  it("another tenant neither reads the record nor collides with its key", async () => {
    const s = store();
    expect(
      await db.kernel.read(withTenant("tnt_b"), (tx) =>
        tx.query("select * from connectors.kyc_score_check"),
      ),
    ).toMatchObject({ rowCount: 0 });
    expect((await s.reserve(req({ tenantId: "tnt_b" }))).kind).toBe("new");
    await expect(
      db.kernel.mutate(withTenant("tnt_b"), (tx) =>
        tx.query(
          `insert into connectors.kyc_score_check
             (id, tenant_id, adapter, method, key_hash, request_hash, mode, state, expires_at)
           values ('ksc_01JA0000000000000000000009', 'tnt_a', 'idfy-kyc', 'liveness', $1, $1,
                   'passive', 'pending', now())`,
          ["b".repeat(64)],
        ),
      ),
    ).rejects.toThrow();
  });

  it("a final record is not changed, a record keeps its mode; an expired one is forgotten and purged", async () => {
    await expect(
      db.kernel.mutate(withTenant("tnt_a"), (tx) =>
        tx.query(
          "update connectors.kyc_score_check set state = 'pending', result = null where state = 'done'",
        ),
      ),
    ).rejects.toThrow(/final/);
    await expect(
      db.kernel.mutate(withTenant("tnt_b"), (tx) =>
        tx.query("update connectors.kyc_score_check set mode = 'active_voice'"),
      ),
    ).rejects.toThrow(/keeps its key/);
    const short = store(0);
    const r = req({ idempotencyKey: "score-key-exp" });
    expect((await short.reserve(r)).kind).toBe("new");
    expect((await short.reserve(r)).kind).toBe("new");
    expect(await short.purgeExpired("tnt_a")).toBe(1);
  });

  it("the IDfy adapter's keyed retry is served on another instance with no second vendor call; the contract cases and sweep pass", async () => {
    const s = store();
    const storage = new MemoryStorage();
    let n = 0;
    const put = async (body: Buffer): Promise<KycFileRef> => {
      const key = `tenant/tnt_b/kyc/01JA00000000000000000000${String(++n).padStart(2, "0")}.jpg`;
      await storage.put(key, body, { bucketClass: "REGULATED", contentType: "image/jpeg" });
      return { storageKey: key, sha256: sha256Hex(body) };
    };
    const make = () =>
      new IdfyKyc({
        storage,
        scoreChecks: s,
        enabled: () => true,
        accountId: () => idfy.accountId,
        apiKey: () => idfy.apiKey,
        currentTenant: () => "tnt_b",
        baseUrl: idfy.url,
        allowLoopbackHttp: true,
      });
    const frames = await Promise.all(idfy.frames.map(put));
    const faces = {
      a: await put(idfy.faces.a),
      same: await put(idfy.faces.same),
      other: await put(idfy.faces.other),
    };
    const checks = idfy.livenessChecks();
    const first = await make().livenessCheck({ frames }, { idempotencyKey: "score-adapter-1" });
    expect(idfy.livenessChecks()).toBe(checks + frames.length);
    expect(await make().livenessCheck({ frames }, { idempotencyKey: "score-adapter-1" })).toEqual(
      first,
    );
    expect(idfy.livenessChecks()).toBe(checks + frames.length);
    const fx: KycFixtures = {
      ...KYC_FAKE_FIXTURES,
      frames,
      faces,
      scores: {
        configuredMode: "passive",
        modes: ["passive"],
        refusing: () => ({ port: make(), mode: "active_voice", vendorCalls: idfy.livenessChecks }),
        livenessVendorCalls: () => idfy.livenessChecks(),
        faceMatchVendorCalls: () => idfy.faceMatches(),
        offScaleNext: () => idfy.scoreOnce(87),
      },
    };
    const cases = kycContractCases(fx).filter((x) => x.name.includes("(PR-UDF-044)"));
    expect(cases.length).toBe(7);
    for (const c of cases) await c.run(make());
    const rows = JSON.stringify(
      (await db.admin.query("select * from connectors.kyc_score_check")).rows,
    );
    for (const f of [...frames, faces.a, faces.same, faces.other]) {
      expect(rows).not.toContain(f.storageKey);
      expect(rows).not.toContain(f.sha256);
    }
    expect(findAadhaarLike(rows, { letters: "join" })).toEqual([]);
    expect((await ledger("tnt_b")).length).toBeGreaterThan(2);
  });
});
