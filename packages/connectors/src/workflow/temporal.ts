// WORKFLOW reference `temporal` (self-hosted) and alternative `temporal-cloud` (Mumbai namespace,
// PL2-D-16) — one TypeScript SDK client (PL2 plan §6.9).
// - Every payload goes through the C-16 codec and failures through `failureConverter`.
// - A workflow type's input class is checked before the call: `temporal` takes up to
//   CONFIDENTIAL, `temporal-cloud` up to INTERNAL until PL6, so CONFIDENTIAL inputs there must be
//   STORAGE references (IPB-PORT-003 otherwise).
// - Inputs over 32 KB are written to STORAGE and passed as `{ $ipbRef }` (resolveInput reads them).
// - The workflow id is the idempotency key: a start with a running id returns that execution.
// - Ids and task queues are identifiers and are checked not to look like personal data.
import {
  Client,
  Connection,
  WorkflowNotFoundError,
  type WorkflowExecutionInfo,
} from "@temporalio/client";
import { atLeast, type DataClass } from "@infrabyx/contracts/data-class";
import { PortError } from "@infrabyx/contracts/errors";
import {
  storageKey,
  WORKFLOW_INLINE_INPUT_MAX_BYTES,
  type AdapterDescriptor,
  type PortHealth,
  type StartWorkflowOptions,
  type StoragePort,
  type WorkflowExecution,
  type WorkflowPort,
} from "@infrabyx/contracts/ports";
import { ulid } from "@infrabyx/crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EncryptionCodec, type CodecOptions } from "./codec.js";
import { failureConverter } from "./failure-converter.js";

/** Path of the failure converter module, for workers (`dataConverter.failureConverterPath`). */
export const FAILURE_CONVERTER_PATH = ((js) => (existsSync(js) ? js : js.replace(/\.js$/, ".ts")))(
  fileURLToPath(new URL("./failure-converter.js", import.meta.url)),
);

const IDENT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const LOOKS_PERSONAL = /@|\+?\d{10,}|[A-Z]{5}\d{4}[A-Z]/;

export type TemporalAuth =
  | { kind: "none" }
  | { kind: "mtls"; cert: Uint8Array; key: Uint8Array; serverNameOverride?: string }
  | { kind: "api_key"; apiKey: string | (() => string) };

export interface TemporalWorkflowOptions {
  /** `WORKFLOW_TEMPORAL_ADDRESS`, host:port. */
  address: string;
  namespace: string;
  /** Codec key (C-16): the namespace's KMS key and the field envelope. */
  codec: Omit<CodecOptions, "namespace">;
  auth?: TemporalAuth;
  /** `int.workflow.task_queue_prefix`; task queues outside it are refused. */
  taskQueuePrefix?: string;
  /** Where inputs over 32 KB go (by reference), and the tenant they belong to. */
  storage?: { port: StoragePort; tenantId: () => string };
}

export interface StoredInputRef {
  $ipbRef: string;
  bytes: number;
}

const STATUS: Record<string, WorkflowExecution["status"]> = {
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
  TERMINATED: "terminated",
  TIMED_OUT: "timed_out",
  CONTINUED_AS_NEW: "completed",
};

export class TemporalWorkflow implements WorkflowPort {
  readonly descriptor: AdapterDescriptor;
  private client: Promise<Client> | null = null;
  private connection: Connection | null = null;
  readonly codec: EncryptionCodec;

  constructor(
    private readonly o: TemporalWorkflowOptions,
    adapter: "temporal" | "temporal-cloud" = "temporal",
  ) {
    this.descriptor = {
      port: "WORKFLOW",
      adapter,
      residency: "IN",
      // PL2-D-16: Temporal Cloud takes INTERNAL until PL6; self-hosted takes CONFIDENTIAL.
      maxDataClass: adapter === "temporal-cloud" ? "INTERNAL" : "CONFIDENTIAL",
    };
    if (adapter === "temporal-cloud" && (o.auth?.kind ?? "none") === "none")
      throw new PortError("IPB-PORT-005", "WORKFLOW", {
        adapter,
        detail: "temporal-cloud needs mTLS or an API key",
      });
    this.codec = new EncryptionCodec({ ...o.codec, namespace: o.namespace });
  }

  private get adapter(): string {
    return this.descriptor.adapter;
  }

  /** Client options shared with workers (same codec and failure converter). */
  get dataConverter() {
    return { payloadCodecs: [this.codec], failureConverter };
  }

  private async c(): Promise<Client> {
    this.client ??= (async () => {
      const a = this.o.auth ?? { kind: "none" };
      this.connection = await Connection.connect({
        address: this.o.address,
        ...(a.kind === "mtls"
          ? {
              tls: {
                clientCertPair: { crt: Buffer.from(a.cert), key: Buffer.from(a.key) },
                ...(a.serverNameOverride ? { serverNameOverride: a.serverNameOverride } : {}),
              },
            }
          : {}),
        ...(a.kind === "api_key" ? { tls: true, apiKey: a.apiKey } : {}),
        connectTimeout: 5_000,
      });
      return new Client({
        connection: this.connection,
        namespace: this.o.namespace,
        dataConverter: this.dataConverter,
      });
    })().catch((e: unknown) => {
      this.client = null;
      throw new PortError("IPB-PORT-002", "WORKFLOW", {
        adapter: this.adapter,
        detail: `${this.adapter} unreachable`,
        cause: e,
      });
    });
    return this.client;
  }

  private ident(what: string, v: string): void {
    if (!IDENT.test(v) || LOOKS_PERSONAL.test(v))
      throw new PortError("IPB-PORT-003", "WORKFLOW", {
        adapter: this.adapter,
        detail: `${what} must be an identifier without personal data (C-16)`,
      });
  }

  private map(
    info: Pick<
      WorkflowExecutionInfo,
      "workflowId" | "runId" | "type" | "status" | "startTime" | "closeTime"
    >,
  ): WorkflowExecution {
    return {
      id: info.workflowId,
      runId: info.runId,
      type: info.type,
      status: STATUS[info.status.name] ?? "running",
      startedAt: info.startTime.toISOString(),
      ...(info.closeTime ? { closedAt: info.closeTime.toISOString() } : {}),
    };
  }

  private notFound(): never {
    throw new PortError("IPB-PORT-001", "WORKFLOW", {
      adapter: this.adapter,
      detail: "no such workflow",
      meta: { reason: "not_found" },
    });
  }

  async startWorkflow(
    type: string,
    input: unknown,
    opts: StartWorkflowOptions,
  ): Promise<WorkflowExecution> {
    this.ident("workflow type", type);
    this.ident("workflow id", opts.id);
    this.ident("task queue", opts.taskQueue);
    if (this.o.taskQueuePrefix && !opts.taskQueue.startsWith(this.o.taskQueuePrefix))
      throw new PortError("IPB-PORT-003", "WORKFLOW", {
        adapter: this.adapter,
        detail: "task queue outside int.workflow.task_queue_prefix",
      });
    const cls: DataClass = opts.inputClass ?? "INTERNAL";
    let arg = input;
    const bytes = new TextEncoder().encode(JSON.stringify(input ?? null)).byteLength;
    if (bytes > WORKFLOW_INLINE_INPUT_MAX_BYTES) {
      if (!this.o.storage)
        throw new PortError("IPB-PORT-003", "WORKFLOW", {
          adapter: this.adapter,
          detail: "inputs over 32 KB need STORAGE for the reference path",
        });
      const key = storageKey(this.o.storage.tenantId(), "workflow", ulid(), "json");
      await this.o.storage.port.put(key, new TextEncoder().encode(JSON.stringify(input)), {
        bucketClass: atLeast(cls, "REGULATED")
          ? "REGULATED"
          : atLeast(cls, "CONFIDENTIAL")
            ? "CONFIDENTIAL"
            : "GENERAL",
        contentType: "application/json",
      });
      arg = { $ipbRef: key, bytes } satisfies StoredInputRef;
    } else if (!atLeast(this.descriptor.maxDataClass, cls))
      throw new PortError("IPB-PORT-003", "WORKFLOW", {
        adapter: this.adapter,
        detail: `${cls} inputs go to ${this.adapter} only as STORAGE references (PL2-D-16)`,
      });
    const client = await this.c();
    const handle = await client.workflow
      .start(type, {
        args: [arg],
        taskQueue: opts.taskQueue,
        workflowId: opts.id,
        workflowIdConflictPolicy: "USE_EXISTING",
      })
      .catch((e: unknown) => {
        throw new PortError("IPB-PORT-002", "WORKFLOW", {
          adapter: this.adapter,
          detail: "start failed",
          cause: e,
        });
      });
    return this.map(await handle.describe());
  }

  async signal(id: string, name: string, payload?: unknown): Promise<void> {
    this.ident("signal name", name);
    const h = (await this.c()).workflow.getHandle(id);
    await h.signal(name, ...(payload === undefined ? [] : [payload])).catch((e: unknown) => {
      if (e instanceof WorkflowNotFoundError) this.notFound();
      throw e;
    });
  }

  async query<T = unknown>(id: string, name: string, args?: unknown): Promise<T> {
    this.ident("query name", name);
    const h = (await this.c()).workflow.getHandle(id);
    return (await h.query(name, ...(args === undefined ? [] : [args])).catch((e: unknown) => {
      if (e instanceof WorkflowNotFoundError) this.notFound();
      throw e;
    })) as T;
  }

  /** Requests cancellation; the reason is the caller's to ledger (Temporal carries none). */
  async cancel(id: string, _reason: string): Promise<void> {
    const h = (await this.c()).workflow.getHandle(id);
    await h.cancel().catch((e: unknown) => {
      if (e instanceof WorkflowNotFoundError) this.notFound();
      throw e;
    });
  }

  async listOpen(filter: { type?: string; taskQueue?: string } = {}): Promise<WorkflowExecution[]> {
    const parts = ['ExecutionStatus="Running"'];
    if (filter.type) {
      this.ident("workflow type", filter.type);
      parts.push(`WorkflowType="${filter.type}"`);
    }
    if (filter.taskQueue) {
      this.ident("task queue", filter.taskQueue);
      parts.push(`TaskQueue="${filter.taskQueue}"`);
    }
    const out: WorkflowExecution[] = [];
    for await (const w of (await this.c()).workflow.list({ query: parts.join(" AND ") }))
      out.push(this.map(w));
    return out;
  }

  async describe(id: string): Promise<WorkflowExecution> {
    const h = (await this.c()).workflow.getHandle(id);
    return this.map(
      await h.describe().catch((e: unknown) => {
        if (e instanceof WorkflowNotFoundError) this.notFound();
        throw e;
      }),
    );
  }

  async health(): Promise<PortHealth> {
    const t0 = Date.now();
    let status: PortHealth["status"] = "up";
    try {
      const c = await this.c();
      await c.connection.workflowService.getSystemInfo({});
    } catch {
      status = "down";
    }
    return { status, latency_ms: Date.now() - t0, checked_at: new Date().toISOString() };
  }

  async close(): Promise<void> {
    await this.connection?.close();
    this.client = null;
    this.connection = null;
  }
}

/** Temporal Cloud (Mumbai): the same adapter with mTLS or an API key and INTERNAL inputs only. */
export class TemporalCloudWorkflow extends TemporalWorkflow {
  constructor(o: TemporalWorkflowOptions & { auth: Exclude<TemporalAuth, { kind: "none" }> }) {
    super(o, "temporal-cloud");
  }
}

/** Read a `{ $ipbRef }` input from STORAGE inside an activity; other inputs pass through. */
export async function resolveInput<T>(storage: StoragePort, input: T | StoredInputRef): Promise<T> {
  if (input && typeof input === "object" && "$ipbRef" in input) {
    const o = await storage.get((input as StoredInputRef).$ipbRef);
    return JSON.parse(new TextDecoder().decode(o.body)) as T;
  }
  return input as T;
}
