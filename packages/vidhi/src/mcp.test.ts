// MCP 2026-07-28 Streamable HTTP header checks (PL4 plan §8.7).
import { describe, expect, it } from "vitest";
import { checkMcpHeaders, McpServerEntry } from "./mcp.js";

const call = {
  jsonrpc: "2.0" as const,
  id: 1,
  method: "tools/call",
  params: { name: "oh.x.tickets.list" },
};

describe("checkMcpHeaders", () => {
  it("accepts matching 2026-07-28 headers, case-insensitively", () => {
    expect(
      checkMcpHeaders(
        {
          "mcp-protocol-version": "2026-07-28",
          "Mcp-Method": "tools/call",
          "MCP-NAME": "oh.x.tickets.list",
        },
        call,
      ),
    ).toBeNull();
  });

  it("refuses a missing or unknown version, and headers that disagree with the body", () => {
    expect(checkMcpHeaders({}, call)).toMatch(/unsupported/);
    expect(checkMcpHeaders({ "MCP-Protocol-Version": "2024-11-05" }, call)).toMatch(/unsupported/);
    expect(
      checkMcpHeaders(
        {
          "MCP-Protocol-Version": "2026-07-28",
          "Mcp-Method": "tools/list",
          "Mcp-Name": "oh.x.tickets.list",
        },
        call,
      ),
    ).toMatch(/Mcp-Method/);
    expect(
      checkMcpHeaders(
        { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/call", "Mcp-Name": "other" },
        call,
      ),
    ).toMatch(/Mcp-Name/);
  });

  it("lets 2025-11-25 clients through without the new headers", () => {
    expect(checkMcpHeaders({ "MCP-Protocol-Version": "2025-11-25" }, call)).toBeNull();
  });
});

describe("McpServerEntry", () => {
  it("needs https, a tool allow-list and a rate limit", () => {
    const ok = {
      id: "rbi_feed",
      url: "https://mcp.example.org/rbi",
      data_class_max: "PUBLIC",
      tools: ["circulars.search"],
      rate_per_minute: 10,
    };
    expect(McpServerEntry.safeParse(ok).success).toBe(true);
    expect(McpServerEntry.safeParse({ ...ok, url: "http://mcp.example.org" }).success).toBe(false);
    expect(McpServerEntry.safeParse({ ...ok, tools: [] }).success).toBe(false);
    expect(McpServerEntry.safeParse({ ...ok, data_class_max: "SECRET" }).success).toBe(false);
  });
});
