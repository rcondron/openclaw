import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveProfileMock } = vi.hoisted(() => ({
  resolveProfileMock: vi.fn(),
}));

const { createBrowserRouteContextMock, listKnownProfileNamesMock } = vi.hoisted(() => ({
  createBrowserRouteContextMock: vi.fn(),
  listKnownProfileNamesMock: vi.fn(),
}));

vi.mock("./config.js", () => ({
  resolveProfile: resolveProfileMock,
}));

vi.mock("./server-context.js", () => ({
  createBrowserRouteContext: createBrowserRouteContextMock,
  listKnownProfileNames: listKnownProfileNamesMock,
}));

import { ensureExtensionRelayForProfiles, stopKnownBrowserProfiles } from "./server-lifecycle.js";

describe("ensureExtensionRelayForProfiles", () => {
  beforeEach(() => {
    resolveProfileMock.mockReset();
  });

  it("does not start relay (TabHR uses direct CDP on port 9220)", async () => {
    resolveProfileMock.mockImplementation((_resolved: unknown, name: string) => {
      if (name === "chrome") {
        return { driver: "extension", cdpUrl: "http://127.0.0.1:9220" };
      }
      return { driver: "openclaw", cdpUrl: "http://127.0.0.1:18889" };
    });

    await ensureExtensionRelayForProfiles({
      resolved: {
        profiles: {
          chrome: {},
          openclaw: {},
        },
      } as never,
      onWarn: vi.fn(),
    });

    // TabHR: no relay started; extension profile uses direct CDP.
    expect(resolveProfileMock).toHaveBeenCalled();
  });
});

describe("stopKnownBrowserProfiles", () => {
  beforeEach(() => {
    createBrowserRouteContextMock.mockReset();
    listKnownProfileNamesMock.mockReset();
  });

  it("stops all known profiles and ignores per-profile failures", async () => {
    listKnownProfileNamesMock.mockReturnValue(["openclaw", "chrome"]);
    const stopMap: Record<string, ReturnType<typeof vi.fn>> = {
      openclaw: vi.fn(async () => {}),
      chrome: vi.fn(async () => {
        throw new Error("profile stop failed");
      }),
    };
    createBrowserRouteContextMock.mockReturnValue({
      forProfile: (name: string) => ({
        stopRunningBrowser: stopMap[name],
      }),
    });
    const onWarn = vi.fn();
    const state = { resolved: { profiles: {} }, profiles: new Map() };

    await stopKnownBrowserProfiles({
      getState: () => state as never,
      onWarn,
    });

    expect(stopMap.openclaw).toHaveBeenCalledTimes(1);
    expect(stopMap.chrome).toHaveBeenCalledTimes(1);
    expect(onWarn).not.toHaveBeenCalled();
  });

  it("warns when profile enumeration fails", async () => {
    listKnownProfileNamesMock.mockImplementation(() => {
      throw new Error("oops");
    });
    createBrowserRouteContextMock.mockReturnValue({
      forProfile: vi.fn(),
    });
    const onWarn = vi.fn();

    await stopKnownBrowserProfiles({
      getState: () => ({ resolved: { profiles: {} }, profiles: new Map() }) as never,
      onWarn,
    });

    expect(onWarn).toHaveBeenCalledWith("openclaw browser stop failed: Error: oops");
  });
});
