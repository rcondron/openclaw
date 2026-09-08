/**
 * Agent-facing MCP tools.
 *
 * A router surface (list servers / list tools / call tool) rather than one agent
 * tool per MCP tool. Registration is synchronous in OpenClaw, and eagerly
 * expanding every server's catalog would also push large JSON schemas into every
 * prompt. Discovery happens on demand instead.
 */
import { Type } from "@sinclair/typebox";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  isToolAllowed,
  listEnabledServers,
  type McpPluginConfig,
  type McpServerConfig,
  resolveTransport,
} from "./config.js";
import type { McpManager } from "./manager.js";

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

function failure(err: unknown) {
  return json({ error: err instanceof Error ? err.message : String(err) });
}

function requireServer(
  config: McpPluginConfig,
  name: string,
): { name: string; server: McpServerConfig } {
  const server = config.servers?.[name];
  if (!server) {
    const known = Object.keys(config.servers ?? {}).join(", ") || "(none configured)";
    throw new Error(`Unknown MCP server "${name}". Configured servers: ${known}`);
  }
  if (server.enabled === false) {
    throw new Error(`MCP server "${name}" is disabled`);
  }
  return { name, server };
}

const ListToolsSchema = Type.Object({
  server: Type.String({ description: "Name of a configured MCP server." }),
});

const CallSchema = Type.Object({
  server: Type.String({ description: "Name of a configured MCP server." }),
  tool: Type.String({ description: "Tool name as reported by mcp_list_tools." }),
  args: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description: "Arguments object matching the tool's input schema.",
    }),
  ),
});

export function createMcpTools(params: { config: McpPluginConfig; manager: McpManager }) {
  const { config, manager } = params;

  const listServers = {
    name: "mcp_list_servers",
    label: "MCP List Servers",
    description:
      "List configured MCP servers and their transports. Use this first to discover what is available.",
    parameters: Type.Object({}),
    async execute() {
      const servers = listEnabledServers(config).map(([name, server]) => ({
        name,
        transport: resolveTransport(server),
        target: server.command ?? server.url ?? null,
      }));
      return json({ servers });
    },
  };

  const listTools = {
    name: "mcp_list_tools",
    label: "MCP List Tools",
    description:
      "List the tools a configured MCP server exposes, with their input schemas. Connects on first use.",
    parameters: ListToolsSchema,
    async execute(_toolCallId: string, rawParams: unknown) {
      const { server: serverName } = rawParams as { server: string };
      try {
        const { server } = requireServer(config, serverName);
        const client = await manager.getClient(serverName, server);
        const result = await client.listTools();
        const tools = (result.tools ?? [])
          .filter((tool) => isToolAllowed(tool.name, server.toolFilter))
          .map((tool) => ({
            name: tool.name,
            description: tool.description ?? "",
            inputSchema: tool.inputSchema,
          }));
        return json({ server: serverName, count: tools.length, tools });
      } catch (err) {
        return failure(err);
      }
    },
  };

  const callTool = {
    name: "mcp_call",
    label: "MCP Call Tool",
    description:
      "Invoke a tool on a configured MCP server. Check mcp_list_tools first for the tool's input schema.",
    parameters: CallSchema,
    async execute(_toolCallId: string, rawParams: unknown) {
      const {
        server: serverName,
        tool,
        args,
      } = rawParams as { server: string; tool: string; args?: Record<string, unknown> };
      try {
        const { server } = requireServer(config, serverName);
        if (!isToolAllowed(tool, server.toolFilter)) {
          throw new Error(`Tool "${tool}" is excluded by the toolFilter for server "${serverName}"`);
        }
        const client = await manager.getClient(serverName, server);
        const result = await client.callTool(
          { name: tool, arguments: args ?? {} },
          undefined,
          { timeout: server.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS },
        );
        if (result.isError) {
          return json({ server: serverName, tool, isError: true, content: result.content });
        }
        return json({ server: serverName, tool, content: result.content });
      } catch (err) {
        return failure(err);
      }
    },
  };

  return [listServers, listTools, callTool];
}
