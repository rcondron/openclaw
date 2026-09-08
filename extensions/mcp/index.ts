import type { AnyAgentTool, OpenClawPluginApi } from "../../src/plugins/types.js";
import { listEnabledServers, type McpPluginConfig, validateServer } from "./src/config.js";
import { McpManager } from "./src/manager.js";
import { createMcpTools } from "./src/tools.js";

export default function register(api: OpenClawPluginApi) {
  const config = ((api.config as Record<string, unknown> | undefined)?.mcp ??
    api.pluginConfig ??
    {}) as McpPluginConfig;

  const enabled = listEnabledServers(config);
  if (enabled.length === 0) {
    api.logger.debug?.("mcp: no servers configured; tools still registered for discovery");
  }

  for (const [name, server] of enabled) {
    const invalid = validateServer(name, server);
    if (invalid) {
      api.logger.warn(`mcp: ${invalid}`);
    }
  }

  const manager = new McpManager(api.logger);
  for (const tool of createMcpTools({ config, manager })) {
    api.registerTool(tool as unknown as AnyAgentTool, { name: tool.name, optional: true });
  }
}
