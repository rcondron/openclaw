/**
 * Lazy MCP connection manager.
 *
 * OpenClaw's plugin loader invokes `register()` synchronously and ignores a
 * returned promise (src/plugins/loader.ts), so servers cannot be probed during
 * registration. Connections are therefore established on first use and cached
 * for the lifetime of the process.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  type McpServerConfig,
  resolveTransport,
  validateServer,
} from "./config.js";

export type McpLogger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

const CLIENT_INFO = { name: "openclaw-mcp-plugin", version: "2026.8.28" };

function buildTransport(name: string, server: McpServerConfig) {
  const transport = resolveTransport(server);
  if (transport === "stdio") {
    return new StdioClientTransport({
      command: server.command as string,
      args: server.args ?? [],
      cwd: server.cwd,
      env: { ...(process.env as Record<string, string>), ...(server.env ?? {}) },
    });
  }

  const url = new URL(server.url as string);
  const requestInit = server.headers ? { headers: server.headers } : undefined;
  if (transport === "sse") {
    return new SSEClientTransport(url, { requestInit });
  }
  return new StreamableHTTPClientTransport(url, { requestInit });
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export class McpManager {
  private readonly clients = new Map<string, Promise<Client>>();

  constructor(private readonly logger: McpLogger) {}

  /** Connects (or returns the cached connection) for a named server. */
  async getClient(name: string, server: McpServerConfig): Promise<Client> {
    const cached = this.clients.get(name);
    if (cached) {
      return await cached;
    }

    const invalid = validateServer(name, server);
    if (invalid) {
      throw new Error(invalid);
    }

    const connecting = (async () => {
      const client = new Client(CLIENT_INFO, { capabilities: {} });
      const transport = buildTransport(name, server);
      const timeoutMs = server.connectionTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
      await withTimeout(client.connect(transport), timeoutMs, `mcp:${name} connect`);
      this.logger.info(`mcp: connected to "${name}" (${resolveTransport(server)})`);
      return client;
    })();

    this.clients.set(name, connecting);
    try {
      return await connecting;
    } catch (err) {
      // Drop the failed attempt so a later call can retry.
      this.clients.delete(name);
      throw err;
    }
  }

  /** Closes every cached connection; used on shutdown. */
  async closeAll(): Promise<void> {
    const entries = [...this.clients.values()];
    this.clients.clear();
    await Promise.allSettled(
      entries.map(async (pending) => {
        const client = await pending;
        await client.close();
      }),
    );
  }
}
