import { afterEach, describe, expect, it, vi } from "vitest";
import { withFetchPreconnect } from "../test-utils/fetch-mock.js";
import type { BrowserServerState } from "./server-context.js";
import { createBrowserRouteContext } from "./server-context.js";
import "./server-context.chrome-test-harness.js";
import * as tabhrClient from "./tabhr-client.js";

function makeBrowserState(): BrowserServerState {
  return {
    // oxlint-disable-next-line typescript/no-explicit-any
    server: null as any,
    port: 0,
    resolved: {
      enabled: true,
      controlPort: 18791,
      cdpProtocol: "http",
      cdpHost: "127.0.0.1",
      cdpIsLoopback: true,
      evaluateEnabled: false,
      remoteCdpTimeoutMs: 1500,
      remoteCdpHandshakeTimeoutMs: 3000,
      extraArgs: [],
      color: "#FF4500",
      headless: true,
      noSandbox: false,
      attachOnly: false,
      defaultProfile: "browserless",
      profiles: {
        browserless: {
          cdpUrl: "http://127.0.0.1:18792",
          cdpPort: 18792,
          color: "#FF4500",
        },
      },
    },
    profiles: new Map(),
  };
}

function makeExtensionChromeState(): BrowserServerState {
  return {
    // oxlint-disable-next-line typescript/no-explicit-any
    server: null as any,
    port: 0,
    resolved: {
      enabled: true,
      controlPort: 18791,
      cdpProtocol: "http",
      cdpHost: "127.0.0.1",
      cdpIsLoopback: true,
      evaluateEnabled: false,
      remoteCdpTimeoutMs: 1500,
      remoteCdpHandshakeTimeoutMs: 3000,
      extraArgs: [],
      color: "#FF4500",
      headless: true,
      noSandbox: false,
      attachOnly: false,
      defaultProfile: "chrome",
      profiles: {
        chrome: {
          driver: "extension",
          cdpUrl: "http://127.0.0.1:18792",
          cdpPort: 18792,
          color: "#00AA00",
        },
      },
    },
    profiles: new Map(),
  };
}

function stubChromeJsonList(responses: unknown[]) {
  const fetchMock = vi.fn();
  const queue = [...responses];

  fetchMock.mockImplementation(async (url: unknown) => {
    const u = String(url);
    if (!u.includes("/json/list")) {
      throw new Error(`unexpected fetch: ${u}`);
    }
    const next = queue.shift();
    if (!next) {
      throw new Error("no more responses");
    }
    return {
      ok: true,
      json: async () => next,
    } as unknown as Response;
  });

  global.fetch = withFetchPreconnect(fetchMock);
  return fetchMock;
}

describe("browser server-context ensureTabAvailable", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sticks to the last selected target when targetId is omitted", async () => {
    // 1st call (snapshot): stable ordering A then B (twice)
    // 2nd call (act): reversed ordering B then A (twice)
    const responses = [
      [
        { id: "A", type: "page", url: "https://a.example", webSocketDebuggerUrl: "ws://x/a" },
        { id: "B", type: "page", url: "https://b.example", webSocketDebuggerUrl: "ws://x/b" },
      ],
      [
        { id: "A", type: "page", url: "https://a.example", webSocketDebuggerUrl: "ws://x/a" },
        { id: "B", type: "page", url: "https://b.example", webSocketDebuggerUrl: "ws://x/b" },
      ],
      [
        { id: "B", type: "page", url: "https://b.example", webSocketDebuggerUrl: "ws://x/b" },
        { id: "A", type: "page", url: "https://a.example", webSocketDebuggerUrl: "ws://x/a" },
      ],
      [
        { id: "B", type: "page", url: "https://b.example", webSocketDebuggerUrl: "ws://x/b" },
        { id: "A", type: "page", url: "https://a.example", webSocketDebuggerUrl: "ws://x/a" },
      ],
    ];
    stubChromeJsonList(responses);
    const state = makeBrowserState();

    const ctx = createBrowserRouteContext({
      getState: () => state,
    });

    const browserless = ctx.forProfile("browserless");
    const first = await browserless.ensureTabAvailable();
    expect(first.targetId).toBe("A");
    const second = await browserless.ensureTabAvailable();
    expect(second.targetId).toBe("A");
  });

  it("falls back to the only attached tab when an invalid targetId is provided (extension)", async () => {
    const connectionId = "550e8400-e29b-41d4-a716-446655440000";
    vi.spyOn(tabhrClient, "isTabhrReachable").mockResolvedValue(true);
    vi.spyOn(tabhrClient, "createTabhrClient").mockReturnValue({
      gatewayStatus: vi.fn().mockResolvedValue({
        running: true,
        connections: 1,
        connectionIds: [connectionId],
        connectionMetas: { [connectionId]: { url: "https://a.example", title: "t" } },
      }),
      resolveConnectionId: vi.fn().mockResolvedValue(connectionId),
      status: vi.fn(),
      extractPage: vi.fn(),
      runScript: vi.fn(),
      navigate: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      keypress: vi.fn(),
      scroll: vi.fn(),
      resize: vi.fn(),
      screenshot: vi.fn(),
      evaluate: vi.fn(),
      click: vi.fn(),
      type: vi.fn(),
    } as ReturnType<typeof tabhrClient.createTabhrClient>);

    const state = makeExtensionChromeState();
    const ctx = createBrowserRouteContext({ getState: () => state });
    const chrome = ctx.forProfile("chrome");
    const chosen = await chrome.ensureTabAvailable("NOT_A_TAB");
    expect(chosen.targetId).toBe(connectionId);
  });

  it("fails when the tab list is empty and opening about:blank cannot complete", async () => {
    const responses = [[]];
    stubChromeJsonList(responses);
    const state = makeBrowserState();

    const ctx = createBrowserRouteContext({ getState: () => state });
    const browserless = ctx.forProfile("browserless");
    await expect(browserless.ensureTabAvailable()).rejects.toThrow(/unexpected fetch/i);
  });
});
