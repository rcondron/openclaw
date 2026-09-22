import { describe, expect, it } from "vitest";
import { chooseBrowserProfile, createBrowserTool } from "./browser-tool.js";

describe("chooseBrowserProfile", () => {
  it("uses the agent's own profile when the call names none", () => {
    expect(chooseBrowserProfile(undefined, "employee-1")).toBe("employee-1");
  });

  it("keeps the agent's own profile when the call asks for the shared one", () => {
    expect(chooseBrowserProfile("browserless", "employee-1")).toBe("employee-1");
    expect(chooseBrowserProfile("openclaw", "employee-1")).toBe("employee-1");
  });

  it("honours a different profile asked for by name", () => {
    expect(chooseBrowserProfile("chrome", "employee-1")).toBe("chrome");
  });

  it("leaves agents without a profile of their own alone", () => {
    expect(chooseBrowserProfile("browserless", undefined)).toBe("browserless");
    expect(chooseBrowserProfile(undefined, undefined)).toBeUndefined();
  });
});

describe("browser tool description", () => {
  it("stops telling an agent with its own session to ask for the shared profile", () => {
    expect(createBrowserTool({ defaultProfile: "employee-1" }).description).not.toContain(
      'profile="browserless"',
    );
    expect(createBrowserTool({}).description).toContain('profile="browserless"');
  });
});
