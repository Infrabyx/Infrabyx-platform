// WORKFLOW contract leg (PL2 plan §6.9). Hermetic: the Temporal CLI dev server (CLI 1.9.1,
// server 1.32.0) and an in-process worker with the platform data converter. Covers
// start/signal/query/cancel/describe/listOpen, idempotent ids, deterministic replay, the 32 KB
// reference path, the C-16 codec (raw history unreadable without the key, failure messages
// included) and the input-class rule for `temporal-cloud`. The Temporal Cloud connection itself
// (mTLS or API key to the Mumbai namespace) is the sandbox leg (D-06).
import { fileURLToPath } from "node:url";
import { Client, Connection } from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkflowPort } from "@infrabyx/contracts/ports";
import { FieldEnvelope, LocalKms, toHex, randomBytes } from "@infrabyx/crypto";
import {
  MemoryStorage,
  defineContractSuite,
  startService,
  type StartedService,
} from "@infrabyx/testing";
import { ENCRYPTED_ENCODING } from "../codec.js";
import { resolveInput, TemporalCloudWorkflow, TemporalWorkflow } from "../temporal.js";
import { createIpbWorker } from "../worker.js";

const NS = "default";
const TQ = "ipb-contract";
const KEY = "local:platform";
let temporal: StartedService;
let address = "";
let worker: Worker;
let running: Promise<void>;
let native: NativeConnection;
const storage = new MemoryStorage();
const kms = new LocalKms();
const envelope = new FieldEnvelope(kms);

const adapter = () =>
  new TemporalWorkflow({
    address,
    namespace: NS,
    codec: { envelope, keyId: KEY },
    taskQueuePrefix: "ipb-",
    storage: { port: storage, tenantId: () => "tnt_a" },
  });

beforeAll(async () => {
  temporal = await startService("temporal", {
    ports: [7233],
    command: ["server", "start-dev", "--ip", "0.0.0.0", "--headless"],
  });
  address = `${temporal.host}:${temporal.ports[7233]}`;
  for (let i = 0; i < 60; i++) {
    const h = await adapter().health();
    if (h.status === "up") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  native = await NativeConnection.connect({ address });
  worker = await createIpbWorker({
    adapter: adapter(),
    address,
    namespace: NS,
    taskQueue: TQ,
    connection: native,
    workflowsPath: fileURLToPath(new URL("./fixtures/workflows.ts", import.meta.url)),
  });
  running = worker.run();
}, 240_000);
afterAll(async () => {
  worker?.shutdown();
  await running?.catch(() => undefined);
  await native?.close();
  await temporal?.stop();
});

// Letters only, so a random suffix can never read as a phone number token.
const id = (p: string) =>
  `${p}-${toHex(randomBytes(6)).replace(/\d/g, (d) => "ghijklmnop"[Number(d)] as string)}`;
const raw = async () =>
  new Client({ connection: await Connection.connect({ address }), namespace: NS });

const cases = [
  {
    name: "start, query, signal and describe; the workflow completes",
    async run(p: WorkflowPort) {
      const wid = id("appr");
      const ex = await p.startWorkflow("approval", { docId: "doc_1" }, { id: wid, taskQueue: TQ });
      expect(ex).toMatchObject({ id: wid, type: "approval", status: "running" });
      expect(await p.query(wid, "state")).toEqual({ input: { docId: "doc_1" } });
      expect((await p.listOpen({ type: "approval" })).map((w) => w.id)).toContain(wid);
      await p.signal(wid, "approve", "usr_checker");
      for (let i = 0; i < 50 && (await p.describe(wid)).status === "running"; i++)
        await new Promise((r) => setTimeout(r, 200));
      expect((await p.describe(wid)).status).toBe("completed");
    },
  },
  {
    name: "the workflow id is the idempotency key: a second start returns the running execution",
    async run(p: WorkflowPort) {
      const wid = id("idem");
      const a = await p.startWorkflow("approval", {}, { id: wid, taskQueue: TQ });
      const b = await p.startWorkflow("approval", {}, { id: wid, taskQueue: TQ });
      expect(b.runId).toBe(a.runId);
      await p.cancel(wid, "test");
      for (let i = 0; i < 50 && (await p.describe(wid)).status === "running"; i++)
        await new Promise((r) => setTimeout(r, 200));
      expect((await p.describe(wid)).status).toBe("cancelled");
    },
  },
  {
    name: "C-16: payloads and failure messages are unreadable in the stored history",
    async run(p: WorkflowPort) {
      const marker = `marker${toHex(randomBytes(6))}`;
      const wid = id("codec");
      await p.startWorkflow("failing", marker, { id: wid, taskQueue: TQ });
      for (let i = 0; i < 50 && (await p.describe(wid)).status === "running"; i++)
        await new Promise((r) => setTimeout(r, 200));
      expect((await p.describe(wid)).status).toBe("failed");
      const history = await (await raw()).workflow.getHandle(wid).fetchHistory();
      const json = JSON.stringify(history);
      expect(json).not.toContain(marker);
      const started = history.events?.[0]?.workflowExecutionStartedEventAttributes;
      const enc = started?.input?.payloads?.[0]?.metadata?.encoding;
      expect(new TextDecoder().decode(enc as Uint8Array)).toBe(ENCRYPTED_ENCODING);
    },
  },
  {
    name: "deterministic replay: a completed history replays without non-determinism",
    async run(p: WorkflowPort) {
      const wid = id("replay");
      await p.startWorkflow("approval", { n: 1 }, { id: wid, taskQueue: TQ });
      await p.signal(wid, "approve", "usr_x");
      for (let i = 0; i < 50 && (await p.describe(wid)).status === "running"; i++)
        await new Promise((r) => setTimeout(r, 200));
      const history = await (await raw()).workflow.getHandle(wid).fetchHistory();
      await Worker.runReplayHistory(
        {
          workflowsPath: fileURLToPath(new URL("./fixtures/workflows.ts", import.meta.url)),
          dataConverter: { payloadCodecs: [(p as TemporalWorkflow).codec] },
        },
        history,
        wid,
      );
    },
  },
  {
    name: "inputs over 32 KB travel as STORAGE references",
    async run(p: WorkflowPort) {
      const wid = id("big");
      const big = { blob: "x".repeat(40_000) };
      await p.startWorkflow("approval", big, { id: wid, taskQueue: TQ });
      const st = await p.query<{ input: { $ipbRef: string; bytes: number } }>(wid, "state");
      expect(st.input.$ipbRef).toMatch(/^tenant\/tnt_a\/workflow\//);
      expect(await resolveInput(storage, st.input)).toEqual(big);
      await p.cancel(wid, "test");
    },
  },
  {
    name: "ids, names and task queues that look like personal data or sit outside the prefix are refused",
    async run(p: WorkflowPort) {
      await expect(
        p.startWorkflow("approval", {}, { id: "user@example.com", taskQueue: TQ }),
      ).rejects.toMatchObject({ code: "IPB-PORT-003" });
      for (const bad of ["kyc-9812345678", "pan:ABCDE1234F", "user.abcde1234f"])
        await expect(
          p.startWorkflow("approval", {}, { id: bad, taskQueue: TQ }),
        ).rejects.toMatchObject({ code: "IPB-PORT-003" });
      await expect(
        p.startWorkflow("approval", {}, { id: id("ok"), taskQueue: "other-queue" }),
      ).rejects.toMatchObject({ code: "IPB-PORT-003" });
      // A ULID that happens to contain a PAN-shaped or long digit run is an identifier, not data.
      const ulidLike = `approval-01JABCDE1234F${Date.now()}9`;
      await p.startWorkflow("approval", {}, { id: ulidLike, taskQueue: TQ });
      await p.cancel(ulidLike, "test");
      await expect(p.describe(id("missing"))).rejects.toMatchObject({ code: "IPB-PORT-001" });
    },
  },
  {
    name: "health is up",
    async run(p: WorkflowPort) {
      expect((await p.health()).status).toBe("up");
    },
  },
];

describe("WORKFLOW hermetic leg: temporal dev server (CLI 1.9.1, server 1.32.0)", () => {
  defineContractSuite("WORKFLOW", adapter, cases, { leg: "hermetic" });

  it("temporal-cloud takes INTERNAL inputs only; CONFIDENTIAL must be a STORAGE reference (PL2-D-16)", async () => {
    const cloud = new TemporalCloudWorkflow({
      address,
      namespace: NS,
      codec: { envelope, keyId: KEY },
      auth: { kind: "api_key", apiKey: "unused" },
    });
    expect(cloud.descriptor).toMatchObject({
      adapter: "temporal-cloud",
      residency: "IN",
      maxDataClass: "INTERNAL",
    });
    await expect(
      cloud.startWorkflow(
        "approval",
        { x: 1 },
        { id: id("cl"), taskQueue: TQ, inputClass: "CONFIDENTIAL" },
      ),
    ).rejects.toMatchObject({ code: "IPB-PORT-003" });
    expect(
      () =>
        new TemporalCloudWorkflow({
          address,
          namespace: NS,
          codec: { envelope, keyId: KEY },
          auth: { kind: "none" } as never,
        }),
    ).toThrow(expect.objectContaining({ code: "IPB-PORT-005" }));
  });

  it("the codec refuses a payload that is not encrypted", async () => {
    await expect(
      adapter().codec.decode([
        {
          metadata: { encoding: new TextEncoder().encode("json/plain") },
          data: new TextEncoder().encode("{}"),
        },
      ]),
    ).rejects.toMatchObject({ code: "IPB-KMS-001" });
  });

  it("an unreachable server reports down", async () => {
    const p = new TemporalWorkflow({
      address: "127.0.0.1:9",
      namespace: NS,
      codec: { envelope, keyId: KEY },
    });
    expect((await p.health()).status).toBe("down");
  });
});
