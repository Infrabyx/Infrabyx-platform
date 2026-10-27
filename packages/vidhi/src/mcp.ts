// MCP (IPB-03-75, 03-76, §03.4.12; PL4 plan §8.7). Spec baseline MCP 2026-07-28 (stateless: no
// `initialize` handshake and no session; `server/discover`; `MCP-Protocol-Version`, `Mcp-Method`
// and `Mcp-Name` headers). No MCP SDK: the server is a transport-agnostic JSON-RPC 2.0 handler and
// the client a small JSON-RPC caller over an injected egress `fetch` (PL4-D-10).
//
// Server (`McpServer`): products mount `handle` on `/mcp` in `apps/api` (Streamable HTTP, OAuth
// 2.1 with PKCE through IDENTITY, resource indicator `urn:infrabyx:<product>:mcp`; the tenant comes
// from the token), after `checkMcpHeaders`. It is off per tenant until `ai.mcp.server_enabled`.
// - `tools/list` offers one tool per skill tool of skills listing the `mcp` surface, filtered by the
//   caller's permissions (the product's Cerbos check), plus `vidhi.task_status`.
// - `tools/call` runs a read tool as a Vidhi task for the caller and returns its result.
// - A write (or locked) tool never executes from MCP: the task waits for a human in the product UI
//   and the call returns `{status: "needs_approval", approval_url, tsk_id}`, at any autonomy level.
//   A client asking to execute it directly is refused with `IPB-VID-040`. MCP clients never approve.
// - Calls are rate limited per caller and tool, and every call is ledgered.
//
// Client (`McpClient`): Vidhi calls external MCP servers only from `vidhi.mcp.client_allowlist`
// (the platform list; a tenant list can only narrow it). Each server has a data-class ceiling, a
// tool allow-list and a rate limit. A server off the list is `IPB-VID-041`; every call is ledgered;
// results come back as data blocks (IPB-03-34), never as instructions.
import { z } from "zod";
import { IpbError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel } from "@infrabyx/contracts/kernel";
import type { DataBlock, DataClass } from "@infrabyx/contracts";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import { VIDHI_AGENT_ROLE } from "@infrabyx/contracts/roles";
import type { SettingsReader } from "@infrabyx/ai";
import type { SkillRegistry } from "./skills.js";
import type { TaskRuntime } from "./tasks.js";

export const MCP_PROTOCOL_VERSION = "2026-07-28";
/** Versions the server answers; 2025-11-25 clients still send `initialize`. */
export const MCP_SUPPORTED_VERSIONS = ["2026-07-28", "2025-11-25"] as const;
export const TASK_STATUS_TOOL = "vidhi.task_status";
/** The agent principal MCP calls run as, for the person whose token made the call. */
export const MCP_AGENT_ID = "agt_vidhi_mcp";

const CLASS_RANK: Record<string, number> = {
  PUBLIC: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
  REGULATED: 3,
  SECRET: 4,
};

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: Record<string, unknown> };
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean };
  skillKey: string;
  toolName: string;
  /** Write or locked: never executed from MCP without the product UI's approval. */
  needsApproval: boolean;
}

/** Per-tool schemas and descriptions a product supplies (its `@McpTool` annotations). */
export type McpToolSchemas = Readonly<
  Record<
    string,
    { input?: Record<string, unknown>; output?: Record<string, unknown>; description?: string }
  >
>;

const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

/** The MCP tools of every loaded skill that lists the `mcp` surface (§03.4.12). */
export class McpToolRegistry {
  readonly tools = new Map<string, McpTool>();
  constructor(skills: SkillRegistry, schemas: McpToolSchemas = {}) {
    for (const key of skills.keys()) {
      const skill = skills.get(key)!;
      if (!skill.manifest.surfaces.includes("mcp")) continue;
      for (const p of skill.tools.values()) {
        const name = `${key}.${p.tool.name}`;
        if (!TOOL_NAME.test(name)) throw new Error(`MCP tool name ${name} is not valid`);
        const s = schemas[p.tool.name] ?? {};
        const needsApproval = p.tool.write || Boolean(p.locked);
        this.tools.set(name, {
          name,
          title: `${skill.manifest.display_name.en}: ${p.tool.name}`,
          description:
            s.description ??
            `${skill.manifest.description}${needsApproval ? " Needs a person's approval in the product before it runs." : ""}`,
          inputSchema: s.input ?? { type: "object" },
          ...(s.output ? { outputSchema: s.output } : {}),
          annotations: {
            readOnlyHint: !needsApproval,
            destructiveHint: needsApproval,
            openWorldHint: false,
          },
          skillKey: key,
          toolName: p.tool.name,
          needsApproval,
        });
      }
    }
  }
}

/**
 * Streamable HTTP header checks for MCP 2026-07-28: a supported `MCP-Protocol-Version`, and
 * `Mcp-Method` / `Mcp-Name` agreeing with the body. Returns the reason to refuse (HTTP 400), or null.
 */
export function checkMcpHeaders(
  headers: Readonly<Record<string, string | undefined>>,
  body: JsonRpcRequest,
): string | null {
  const h = (n: string) => Object.entries(headers).find(([k]) => k.toLowerCase() === n)?.[1];
  const version = h("mcp-protocol-version");
  if (!version || !(MCP_SUPPORTED_VERSIONS as readonly string[]).includes(version))
    return `unsupported MCP-Protocol-Version ${version ?? "(none)"}`;
  if (version === MCP_PROTOCOL_VERSION) {
    if (h("mcp-method") !== body.method) return "Mcp-Method does not match the request";
    const name = typeof body.params?.name === "string" ? body.params.name : undefined;
    if (name !== undefined && h("mcp-name") !== name) return "Mcp-Name does not match the request";
  }
  return null;
}

/** A fixed-window limiter per key, in process (like the routing breaker, A-05). */
class Limiter {
  private readonly hits = new Map<string, { start: number; n: number }>();
  allow(key: string, perMinute: number, now = Date.now()): boolean {
    const w = this.hits.get(key);
    if (!w || now - w.start >= 60_000) {
      this.hits.set(key, { start: now, n: 1 });
      return true;
    }
    if (w.n >= perMinute) return false;
    w.n++;
    return true;
  }
}

export interface McpServerOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  product: string;
  registry: McpToolRegistry;
  runtime: TaskRuntime;
  settings: SettingsReader;
  /** Where the person approves a waiting task in the product UI. */
  approvalUrl: (taskId: string) => string;
  /** The product's permission check (Cerbos) for the caller and tool; default: allowed. */
  authorize?: (ctx: KernelContext, tool: McpTool) => Promise<boolean>;
  /** Calls per caller and tool per minute (default 60). */
  ratePerMinute?: number;
  serverVersion?: string;
}

const rpcError = (
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
  data?: Record<string, unknown>,
): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message, ...(data ? { data } : {}) },
});

const ipbError = (id: JsonRpcRequest["id"], e: IpbError): JsonRpcResponse =>
  rpcError(id, -32000, e.message, { code: e.code });

/** Keys a client might use to ask for execution without the product UI's approval. */
const EXECUTE_HINTS = ["confirm", "confirmed", "approve", "approved", "execute", "force"];

export class McpServer {
  private readonly limiter = new Limiter();
  constructor(private readonly o: McpServerOptions) {}

  /** The agent context a call runs in: Vidhi, acting for the caller (who owns the task). */
  private agent(ctx: KernelContext): KernelContext {
    return {
      tenantId: ctx.tenantId,
      principal: { id: MCP_AGENT_ID, type: "agent", roles: [VIDHI_AGENT_ROLE] },
    };
  }

  private async visible(ctx: KernelContext): Promise<McpTool[]> {
    const out: McpTool[] = [];
    for (const t of this.o.registry.tools.values())
      if (!this.o.authorize || (await this.o.authorize(ctx, t))) out.push(t);
    return out;
  }

  private async ledger(
    ctx: KernelContext,
    tool: string,
    outcome: "executed" | "needs_approval" | "refused" | "failed",
    after: Record<string, unknown> = {},
  ): Promise<void> {
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await this.o.audit.record(tx, {
          action: "vidhi.mcp.call",
          resourceType: "mcp_tool",
          resourceId: tool,
          after: { outcome, ...after },
        });
      },
      { action: "vidhi.mcp.call" },
    );
  }

  /** Handle one JSON-RPC message from an authenticated caller. Notifications return null. */
  async handle(ctx: KernelContext, req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    if (req?.jsonrpc !== "2.0" || typeof req.method !== "string")
      return rpcError(req?.id, -32600, "invalid request");
    if (req.id === undefined) return null;
    let enabled = false;
    try {
      enabled = (await this.o.settings.get(ctx, "ai.mcp.server_enabled")) === true;
    } catch {
      enabled = false;
    }
    if (!enabled)
      return rpcError(req.id, -32001, "the Vidhi MCP server is not enabled for this organisation");
    switch (req.method) {
      case "server/discover":
      case "initialize": {
        const asked =
          typeof req.params?.protocolVersion === "string"
            ? req.params.protocolVersion
            : MCP_PROTOCOL_VERSION;
        return {
          jsonrpc: "2.0",
          id: req.id ?? null,
          result: {
            protocolVersion: (MCP_SUPPORTED_VERSIONS as readonly string[]).includes(asked)
              ? asked
              : MCP_PROTOCOL_VERSION,
            supportedVersions: [...MCP_SUPPORTED_VERSIONS],
            capabilities: { tools: { listChanged: false } },
            serverInfo: {
              name: `infrabyx-${this.o.product.toLowerCase()}-vidhi`,
              version: this.o.serverVersion ?? "0.x",
            },
          },
        };
      }
      case "ping":
        return { jsonrpc: "2.0", id: req.id ?? null, result: {} };
      case "tools/list": {
        const tools = (await this.visible(ctx)).map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
          annotations: t.annotations,
        }));
        tools.push({
          name: TASK_STATUS_TOOL,
          title: "Vidhi task status",
          description:
            "The state of a Vidhi task you started, for example one waiting for approval.",
          inputSchema: {
            type: "object",
            properties: { tsk_id: { type: "string" } },
            required: ["tsk_id"],
          },
          annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        });
        return { jsonrpc: "2.0", id: req.id ?? null, result: { tools } };
      }
      case "tools/call":
        return this.call(ctx, req);
      default:
        return rpcError(req.id, -32601, `method ${req.method} is not supported`);
    }
  }

  private async call(ctx: KernelContext, req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const name = typeof req.params?.name === "string" ? req.params.name : "";
    const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
    if (typeof args !== "object" || Array.isArray(args) || args === null)
      return rpcError(req.id, -32602, "arguments must be an object");
    if (
      !this.limiter.allow(`${ctx.tenantId}|${ctx.principal.id}|${name}`, this.o.ratePerMinute ?? 60)
    ) {
      await this.ledger(ctx, name, "refused", { code: "IPB-SEC-019" });
      return ipbError(req.id, new IpbError("IPB-SEC-019", { detail: `${name}: too many calls` }));
    }
    if (name === TASK_STATUS_TOOL) {
      const s = await this.o.runtime.status(ctx, String(args.tsk_id ?? ""));
      if (!s || s.owner_id !== ctx.principal.id) return rpcError(req.id, -32602, "unknown task");
      const out = {
        tsk_id: s.id,
        state: s.state,
        ...(s.error_code ? { error_code: s.error_code } : {}),
      };
      return {
        jsonrpc: "2.0",
        id: req.id ?? null,
        result: { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out },
      };
    }
    const tool = this.o.registry.tools.get(name);
    if (!tool || (this.o.authorize && !(await this.o.authorize(ctx, tool))))
      return rpcError(req.id, -32602, `unknown tool ${name}`);
    const meta = (req.params?._meta ?? {}) as Record<string, unknown>;
    if (
      tool.needsApproval &&
      (meta["io.infrabyx/execute"] === true || EXECUTE_HINTS.some((k) => k in args))
    ) {
      await this.ledger(ctx, name, "refused", { code: "IPB-VID-040" });
      return ipbError(
        req.id,
        new IpbError("IPB-VID-040", {
          detail: `${name} runs only after a person approves it in the product`,
        }),
      );
    }
    const agent = this.agent(ctx);
    let taskId = "";
    try {
      ({ taskId } = await this.o.runtime.create(agent, {
        skillKey: tool.skillKey,
        ownerId: ctx.principal.id,
        ownerRoles: ctx.principal.roles,
      }));
      await this.o.runtime.start(agent, taskId);
      const r = await this.o.runtime.callTool(agent, taskId, {
        tool: tool.toolName,
        args,
        ...(typeof meta["io.infrabyx/idempotencyKey"] === "string"
          ? { idempotencyKey: meta["io.infrabyx/idempotencyKey"] }
          : {}),
        forceApproval: tool.needsApproval,
      });
      if (r.state === "NEEDS_APPROVAL") {
        await this.ledger(ctx, name, "needs_approval", {
          task_id: taskId,
          approval_id: r.approvalId,
        });
        const out = {
          status: "needs_approval",
          approval_url: this.o.approvalUrl(taskId),
          tsk_id: taskId,
        };
        return {
          jsonrpc: "2.0",
          id: req.id ?? null,
          result: {
            content: [
              {
                type: "text",
                text: `Waiting for a person to approve it in the product: ${out.approval_url}`,
              },
            ],
            structuredContent: out,
          },
        };
      }
      await this.o.runtime.complete(agent, taskId);
      await this.ledger(ctx, name, "executed", { task_id: taskId });
      const value = r.result ?? null;
      return {
        jsonrpc: "2.0",
        id: req.id ?? null,
        result: {
          content: [{ type: "text", text: JSON.stringify(value) }],
          structuredContent: value,
        },
      };
    } catch (e) {
      await this.ledger(ctx, name, "failed", {
        task_id: taskId || null,
        code: (e as { code?: string }).code ?? "error",
      });
      if (e instanceof IpbError)
        return {
          jsonrpc: "2.0",
          id: req.id ?? null,
          result: { isError: true, content: [{ type: "text", text: `${e.code}: ${e.message}` }] },
        };
      throw e;
    }
  }
}

/** One allow-listed external MCP server (`vidhi.mcp.client_allowlist`). */
export const McpServerEntry = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
    url: z
      .string()
      .url()
      .refine((u) => u.startsWith("https://"), "must be https"),
    data_class_max: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "REGULATED"]),
    tools: z.array(z.string().regex(TOOL_NAME)).min(1),
    rate_per_minute: z.number().int().min(1).max(600),
  })
  .strict();
export type McpServerEntry = z.infer<typeof McpServerEntry>;

/** The egress fetch the client uses (`connectors` egress rules; injected by the product). */
export type McpFetch = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string },
) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface McpClientOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  settings: SettingsReader;
  fetch: McpFetch;
  clientVersion?: string;
  /** Largest text kept from one result (characters). */
  maxResultChars?: number;
}

const parseList = (v: unknown): McpServerEntry[] =>
  (Array.isArray(v) ? v : []).flatMap((e) => {
    const r = McpServerEntry.safeParse(e);
    return r.success ? [r.data] : [];
  });

export class McpClient {
  private readonly limiter = new Limiter();
  private seq = 0;
  constructor(private readonly o: McpClientOptions) {}

  /**
   * The servers this tenant may call: the platform list, narrowed by the tenant's own list when it
   * has one (a tenant entry can only lower the class ceiling, remove tools and lower the rate).
   */
  async allowlist(ctx: KernelContext): Promise<McpServerEntry[]> {
    const read = async (c: KernelContext) => {
      try {
        return await this.o.settings.get(c, "vidhi.mcp.client_allowlist");
      } catch {
        return [];
      }
    };
    const platform = parseList(
      await read({ tenantId: PLATFORM_TENANT_ID, scope: "platform", principal: ctx.principal }),
    );
    const tenantRaw = await read(ctx);
    if (!Array.isArray(tenantRaw) || !tenantRaw.length) return platform;
    const tenant = new Map(parseList(tenantRaw).map((e) => [e.id, e]));
    return platform.flatMap((p) => {
      const t = tenant.get(p.id);
      if (!t || t.url !== p.url) return [];
      return [
        {
          ...p,
          data_class_max:
            CLASS_RANK[t.data_class_max]! < CLASS_RANK[p.data_class_max]!
              ? t.data_class_max
              : p.data_class_max,
          tools: p.tools.filter((x) => t.tools.includes(x)),
          rate_per_minute: Math.min(p.rate_per_minute, t.rate_per_minute),
        },
      ];
    });
  }

  private async ledger(
    ctx: KernelContext,
    server: string,
    after: Record<string, unknown>,
  ): Promise<void> {
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await this.o.audit.record(tx, {
          action: "vidhi.mcp.client_call",
          resourceType: "mcp_server",
          resourceId: server,
          after,
        });
      },
      { action: "vidhi.mcp.client_call" },
    );
  }

  /**
   * Call `tool` on an allow-listed server. `dataClass` is the class of what the arguments carry; it
   * must not exceed the server's ceiling. The result is a `tool_result` data block at the server's
   * ceiling, for the gateway to wrap as data.
   */
  async callTool(
    ctx: KernelContext,
    serverId: string,
    tool: string,
    args: Record<string, unknown>,
    o: { dataClass: DataClass },
  ): Promise<DataBlock> {
    const server = (await this.allowlist(ctx)).find((s) => s.id === serverId);
    if (!server) {
      await this.ledger(ctx, serverId, { tool, outcome: "refused", code: "IPB-VID-041" });
      throw new IpbError("IPB-VID-041", { detail: `${serverId} is not on the MCP allow-list` });
    }
    if (!server.tools.includes(tool)) {
      await this.ledger(ctx, serverId, { tool, outcome: "refused", code: "IPB-AI-040" });
      throw new IpbError("IPB-AI-040", { detail: `${tool} is not allowed on ${serverId}` });
    }
    if ((CLASS_RANK[o.dataClass] ?? 9) > CLASS_RANK[server.data_class_max]!) {
      await this.ledger(ctx, serverId, {
        tool,
        outcome: "refused",
        code: "IPB-VID-041",
        data_class: o.dataClass,
      });
      throw new IpbError("IPB-VID-041", {
        detail: `${serverId} accepts data up to ${server.data_class_max}, not ${o.dataClass}`,
      });
    }
    if (!this.limiter.allow(`${ctx.tenantId}|${serverId}`, server.rate_per_minute)) {
      await this.ledger(ctx, serverId, { tool, outcome: "refused", code: "IPB-SEC-019" });
      throw new IpbError("IPB-SEC-019", { detail: `${serverId}: too many calls` });
    }
    const id = ++this.seq;
    let outcome = "failed";
    let text = "";
    try {
      const res = await this.o.fetch(server.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
          "Mcp-Method": "tools/call",
          "Mcp-Name": tool,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: {
            name: tool,
            arguments: args,
            _meta: {
              "io.modelcontextprotocol/clientInfo": {
                name: "infrabyx-vidhi",
                version: this.o.clientVersion ?? "0.x",
              },
            },
          },
        }),
      });
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as JsonRpcResponse;
      if (body.error) throw new Error(`MCP error ${body.error.code}`);
      const r = (body.result ?? {}) as {
        content?: { type: string; text?: string }[];
        structuredContent?: unknown;
        isError?: boolean;
      };
      const parts = (r.content ?? []).filter(
        (c) => c.type === "text" && typeof c.text === "string",
      );
      text = parts.length
        ? parts.map((c) => c.text).join("\n")
        : r.structuredContent !== undefined
          ? JSON.stringify(r.structuredContent)
          : "";
      text = text.slice(0, this.o.maxResultChars ?? 100_000);
      outcome = r.isError ? "tool_error" : "ok";
    } finally {
      await this.ledger(ctx, serverId, {
        tool,
        outcome,
        chars: text.length,
        data_class: o.dataClass,
      });
    }
    return {
      kind: "tool_result",
      sourceId: `mcp:${serverId}:${tool}:${id}`,
      resourceRef: `mcp:${serverId}/${tool}`,
      dataClass: server.data_class_max,
      text,
    };
  }
}
