# MCP Client (OpenClaw plugin)

Connects OpenClaw agents to Model Context Protocol servers over **stdio**, **Streamable HTTP**,
or **SSE**.

Upstream OpenClaw ships a native MCP client under `mcp.servers`. This fork predates that work
(it diverged around Feb 2026, upstream added MCP in March 2026), so this plugin provides the
same capability using only APIs this fork already has.

## Why a router, not one tool per MCP tool

`src/plugins/loader.ts` calls a plugin's `register()` synchronously and explicitly ignores a
returned promise. MCP tool discovery is an async network call, so a server's catalog cannot be
expanded into individual agent tools at registration time. Instead the plugin registers three
tools and discovers on demand:

| Tool | Purpose |
| --- | --- |
| `mcp_list_servers` | List configured servers and transports |
| `mcp_list_tools` | List one server's tools with input schemas (connects on first use) |
| `mcp_call` | Invoke a tool on a server |

This also keeps large MCP JSON schemas out of every prompt.

## Configuration

Config is read from `mcp` in `openclaw.json`, falling back to this plugin's own config block.
The shape mirrors upstream so a later migration to the built-in client is a config move:

```json5
{
  mcp: {
    servers: {
      docs: {
        url: "https://mcp.example.com/mcp",
        transport: "streamable-http",
        headers: { Authorization: "Bearer ..." },
        toolFilter: { include: ["search", "read_*"] },
      },
      local: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-memory"],
      },
    },
  },
}
```

`enabled: false` keeps a definition without connecting it. Connections are lazy and cached for
the process lifetime; a failed connection is dropped so the next call retries.

## Not implemented

OAuth (`auth: "oauth"`) is not handled here — pass a bearer token via `headers` instead.
Upstream's `openclaw mcp login` flow has no equivalent in this fork.
