import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { resolveAgentBrowserProfile } from "./agent-scope.js";

const cfg: OpenClawConfig = {
  agents: {
    list: [
      { id: "javier", workspace: "~/javier", browserProfile: "javier" },
      { id: "sofia", workspace: "~/sofia", browserProfile: "sofia" },
      { id: "no-profile", workspace: "~/other" },
    ],
  },
};

describe("resolveAgentBrowserProfile", () => {
  it("gives each agent the profile pinned to it", () => {
    expect(resolveAgentBrowserProfile({ sessionKey: "agent:javier:chat", config: cfg })).toBe(
      "javier",
    );
    expect(resolveAgentBrowserProfile({ sessionKey: "agent:sofia:chat", config: cfg })).toBe(
      "sofia",
    );
  });

  it("returns nothing when the agent has no profile of its own", () => {
    expect(
      resolveAgentBrowserProfile({ sessionKey: "agent:no-profile:chat", config: cfg }),
    ).toBeUndefined();
  });

  it("returns nothing for an unknown agent, rather than someone else's profile", () => {
    expect(resolveAgentBrowserProfile({ sessionKey: "agent:stranger:chat", config: cfg })).toBe(
      undefined,
    );
  });

  it("returns nothing without a config", () => {
    expect(resolveAgentBrowserProfile({ sessionKey: "agent:javier:chat" })).toBeUndefined();
  });
});
