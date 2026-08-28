/**
 * Config types for the MCP client plugin.
 *
 * The shape intentionally mirrors upstream OpenClaw's `mcp.servers` so that a
 * later move to the built-in implementation is a config relocation, not a rewrite.
 */

export type McpToolFilter = {
  include?: string[];
  exclude?: string[];
};

export type McpTransport = "stdio" | "streamable-http" | "sse";

export type McpServerConfig = {
  enabled?: boolean;
  /** stdio transport */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** http transports */
  url?: string;
  transport?: McpTransport;
  headers?: Record<string, string>;
  connectionTimeoutMs?: number;
  requestTimeoutMs?: number;
  toolFilter?: McpToolFilter;
};

export type McpPluginConfig = {
  servers?: Record<string, McpServerConfig>;
};

export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/** Resolves the transport, inferring it from which fields are set when absent. */
export function resolveTransport(server: McpServerConfig): McpTransport {
  if (server.transport) {
    return server.transport;
  }
  return server.command ? "stdio" : "streamable-http";
}

/** An enabled server needs either a command (stdio) or a url (http transports). */
export function validateServer(name: string, server: McpServerConfig): string | null {
  if (name === "__proto__") {
    return `server name "__proto__" is reserved`;
  }
  const transport = resolveTransport(server);
  if (transport === "stdio") {
    return server.command?.trim() ? null : `server "${name}": stdio transport requires a command`;
  }
  return server.url?.trim() ? null : `server "${name}": ${transport} transport requires a url`;
}

/** Simple `*` glob match used by toolFilter include/exclude entries. */
export function matchesGlob(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

export function isToolAllowed(toolName: string, filter: McpToolFilter | undefined): boolean {
  if (!filter) {
    return true;
  }
  if (filter.exclude?.some((p) => matchesGlob(p, toolName))) {
    return false;
  }
  if (filter.include && filter.include.length > 0) {
    return filter.include.some((p) => matchesGlob(p, toolName));
  }
  return true;
}

export function listEnabledServers(config: McpPluginConfig): [string, McpServerConfig][] {
  return Object.entries(config.servers ?? {}).filter(([, s]) => s.enabled !== false);
}
