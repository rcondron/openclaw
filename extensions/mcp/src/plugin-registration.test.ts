import { describe, expect, it } from "vitest";
import { resolvePluginTools } from "../../../src/plugins/tools.js";

const config = {
  plugins: {
    enabled: true,
    entries: {
      mcp: {
        enabled: true,
        config: {
          servers: {
            memory: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] },
          },
        },
      },
    },
  },
} as never;

function resolve() {
  return resolvePluginTools({
    context: { config, workspaceDir: process.cwd() },
    // Tools register as optional; the plugin id enables them.
    toolAllowlist: ["mcp"],
  });
}

describe("mcp plugin registration (real OpenClaw loader)", () => {
  it("registers its three tools through resolvePluginTools", () => {
    const names = resolve().map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["mcp_list_servers", "mcp_list_tools", "mcp_call"]));
  });

  it("exposes configured servers via mcp_list_servers", async () => {
    const tool = resolve().find((t) => t.name === "mcp_list_servers");
    expect(tool).toBeDefined();
    const res = (await (tool as never as { execute: (a?: unknown, b?: unknown) => Promise<{ details: { servers: { name: string; transport: string }[] } }> }).execute("c1", {})).details;
    expect(res.servers).toEqual([{ name: "memory", transport: "stdio", target: "npx" }]);
  });

  it("omits optional tools when nothing allowlists them", () => {
    const names = resolvePluginTools({ context: { config, workspaceDir: process.cwd() } }).map((t) => t.name);
    expect(names).not.toContain("mcp_call");
  });
});
