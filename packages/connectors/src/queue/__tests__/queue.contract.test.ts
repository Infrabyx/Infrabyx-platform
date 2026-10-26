// QUEUE contract legs (PL2 plan §6.8). Hermetic: BullMQ on Redis 7.4 and on Valkey 8.1, and
// pg-boss on PostgreSQL 18 with every platform migration applied (connectors 0003 creates the
// pg-boss schema) and a login role that holds only app_rw's DML and EXECUTE grants, so the
// adapter proves it needs no DDL at runtime. One case list runs on all three.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConsumedJob, QueuePort } from "@infrabyx/contracts/ports";
import { randomBytes, toHex } from "@infrabyx/crypto";
import {
  defineContractSuite,
  startPostgres,
  startService,
  type StartedService,
  type TestDatabase,
} from "@infrabyx/testing";
import { BullmqQueue } from "../bullmq.js";
import { PgBossQueue } from "../pg-boss.js";

let redis: StartedService;
let valkey: StartedService;
let db: TestDatabase;
let queueUrl = "";
const open: Array<{ close(): Promise<void> }> = [];

beforeAll(async () => {
  [redis, valkey, db] = await Promise.all([
    startService("redis", { ports: [6379], readyLog: /Ready to accept connections/ }),
    startService("valkey", { ports: [6379], readyLog: /Ready to accept connections/ }),
    startPostgres(),
  ]);
  const role = `ipb_queue_${toHex(randomBytes(4))}`;
  const pw = toHex(randomBytes(16));
  await db.admin.query(`create role ${role} login password '${pw}' in role app_rw`);
  const u = new URL(db.url);
  u.username = role;
  u.password = pw;
  queueUrl = u.toString();
});
afterAll(async () => {
  await Promise.all(open.map((q) => q.close()));
  await Promise.all([redis?.stop(), valkey?.stop(), db?.end()]);
});

const track = <T extends { close(): Promise<void> }>(q: T) => (open.push(q), q);
const bull = (s: () => StartedService) => () =>
  track(
    new BullmqQueue({
      url: `redis://${s().host}:${s().ports[6379]}`,
      backoffMs: 100,
      prefix: `ipb${toHex(randomBytes(3))}`,
    }),
  );
const boss = () =>
  track(new PgBossQueue({ connectionString: queueUrl, backoffMs: 1000, attempts: 3 }));

const q = () => `q${toHex(randomBytes(4))}`;
const waitFor = async (cond: () => boolean | Promise<boolean>, ms = 15_000) => {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
};

const cases = [
  {
    name: "enqueue and consume: the canary round-trip takes at most 5 s",
    async run(p: QueuePort) {
      const name = q();
      const seen: ConsumedJob[] = [];
      const sub = await p.consume(name, async (j) => void seen.push(j));
      const t0 = Date.now();
      const { id } = await p.enqueue(name, { name: "canary", data: { tenant: "tnt_a", n: 1 } });
      await waitFor(() => seen.length === 1, 5_000);
      expect(Date.now() - t0).toBeLessThanOrEqual(5_000);
      expect(seen[0]).toMatchObject({
        id,
        name: "canary",
        data: { tenant: "tnt_a", n: 1 },
        attempt: 1,
      });
      await sub.close();
    },
  },
  {
    name: "the same idempotency key enqueues once and returns the same id",
    async run(p: QueuePort) {
      const name = q();
      const a = await p.enqueue(
        name,
        { name: "once", data: { id: "x" } },
        { idempotencyKey: "k-1" },
      );
      const b = await p.enqueue(
        name,
        { name: "once", data: { id: "x" } },
        { idempotencyKey: "k-1" },
      );
      expect(b.id).toBe(a.id);
      expect((await p.stats(name)).waiting).toBe(1);
    },
  },
  {
    name: "delayed jobs wait; failing jobs retry with backoff, then go to the DLQ; replay re-enqueues",
    async run(p: QueuePort) {
      const name = q();
      await p.enqueue(name, { name: "later", data: {} }, { delayMs: 60_000 });
      expect((await p.stats(name)).delayed).toBe(1);
      const attempts: number[] = [];
      let fail = true;
      const sub = await p.consume(name, async (j) => {
        if (j.name !== "flaky") return;
        attempts.push(j.attempt);
        if (fail) throw new Error("boom");
      });
      await p.enqueue(name, { name: "flaky", data: { id: "f1" } }, { attempts: 3 });
      await waitFor(async () => (await p.stats(name)).dlq === 1, 30_000);
      expect(attempts).toEqual([1, 2, 3]);
      fail = false;
      expect(await p.replay(name, { name: "flaky" })).toEqual({ replayed: 1 });
      await waitFor(() => attempts.length === 4, 15_000);
      expect((await p.stats(name)).dlq).toBe(0);
      await sub.close();
    },
  },
  {
    name: "moveToDLQ takes a waiting job out of the queue; an unknown id is IPB-PORT-001",
    async run(p: QueuePort) {
      const name = q();
      const { id } = await p.enqueue(name, { name: "stuck", data: { id: "s1" } });
      await p.moveToDLQ(name, id, "operator");
      const s = await p.stats(name);
      expect([s.waiting, s.dlq]).toEqual([0, 1]);
      await expect(p.moveToDLQ(name, id, "again")).rejects.toMatchObject({ code: "IPB-PORT-001" });
    },
  },
  {
    name: "a cron schedule is accepted and is idempotent by job name",
    async run(p: QueuePort) {
      const name = q();
      const a = await p.schedule(name, "0 3 * * *", { name: "nightly", data: {} });
      const b = await p.schedule(name, "0 3 * * *", { name: "nightly", data: {} });
      expect(b.id).toBe(a.id);
    },
  },
  {
    name: "payloads above INTERNAL shapes and non-identifier names are refused before I/O (IPB-PORT-003)",
    async run(p: QueuePort) {
      const name = q();
      await expect(
        p.enqueue(name, { name: "x", data: { nested: { pan: "ABCDE1234F" } } as never }),
      ).rejects.toMatchObject({ code: "IPB-PORT-003" });
      await expect(p.enqueue("Has Space", { name: "x", data: {} })).rejects.toMatchObject({
        code: "IPB-PORT-003",
      });
      await expect(p.enqueue(name, { name: "user@example.com", data: {} })).rejects.toMatchObject({
        code: "IPB-PORT-003",
      });
    },
  },
  {
    name: "health is up",
    async run(p: QueuePort) {
      expect((await p.health()).status).toBe("up");
    },
  },
];

describe("QUEUE hermetic leg: bullmq on redis 7.4", () => {
  defineContractSuite(
    "QUEUE",
    bull(() => redis),
    cases,
    { leg: "hermetic" },
  );
});

describe("QUEUE hermetic leg: bullmq on valkey 8.1", () => {
  defineContractSuite(
    "QUEUE",
    bull(() => valkey),
    cases,
    { leg: "hermetic" },
  );
});

describe("QUEUE hermetic leg: pg-boss on PostgreSQL 18 (no DDL at runtime)", () => {
  defineContractSuite("QUEUE", boss, cases, { leg: "hermetic" });

  it("the runtime role cannot create tables in the pg-boss schema", async () => {
    const u = new URL(queueUrl);
    const { default: pg } = await import("pg");
    const c = new pg.Client({ connectionString: u.toString() });
    await c.connect();
    await expect(c.query("create table pgboss.intruder (id int)")).rejects.toThrow(
      /permission denied/,
    );
    await c.end();
  });
});

it("an unreachable Redis reports down", async () => {
  const p = track(new BullmqQueue({ url: "redis://127.0.0.1:9" }));
  expect((await p.health()).status).toBe("down");
});
