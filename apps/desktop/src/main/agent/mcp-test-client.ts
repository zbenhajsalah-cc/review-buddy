/**
 * For tests: a minimal MCP client connected in memory to the SDK's in-process
 * server, so tests call the tools the way Claude Code does (JSON-RPC, with the
 * server's own input validation). Hand-written on purpose: adding
 * @modelcontextprotocol/sdk here changes how pnpm resolves the plugin's copy,
 * and with it the plugin's committed bundle.
 */
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";

interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: { message: string };
}

export interface ToolCallResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

export interface McpTestClient {
  listTools(): Promise<{ tools: { name: string; inputSchema: Record<string, unknown> }[] }>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult>;
}

export async function connectMcp(server: McpSdkServerConfigWithInstance): Promise<McpTestClient> {
  let nextId = 0;
  const pending = new Map<number, (response: JsonRpcResponse) => void>();
  const transport = {
    onmessage: undefined as ((message: unknown) => void) | undefined,
    onclose: undefined as (() => void) | undefined,
    onerror: undefined as ((error: Error) => void) | undefined,
    async start() {},
    async close() {},
    // Messages from the server: answers to our requests (notifications are ignored).
    async send(message: Partial<JsonRpcResponse>) {
      if (typeof message.id === "number") pending.get(message.id)?.(message as JsonRpcResponse);
    },
  };
  await server.instance.connect(transport as never);

  const request = (method: string, params: Record<string, unknown>) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, (response) => {
        pending.delete(id);
        if (response.error) reject(new Error(response.error.message));
        else resolve(response.result);
      });
      transport.onmessage?.({ jsonrpc: "2.0", id, method, params });
    });

  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  transport.onmessage?.({ jsonrpc: "2.0", method: "notifications/initialized" });

  return {
    listTools: () => request("tools/list", {}) as ReturnType<McpTestClient["listTools"]>,
    callTool: (name, args) =>
      request("tools/call", { name, arguments: args }) as Promise<ToolCallResult>,
  };
}
