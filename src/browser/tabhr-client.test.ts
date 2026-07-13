import { afterEach, describe, expect, it, vi } from "vitest";
import { createTabhrClient, isTabhrReachable } from "./tabhr-client.js";

describe("tabhr-client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads gateway status from GET /status", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/status") && (!init?.method || init.method === "GET")) {
        return {
          ok: true,
          json: async () => ({
            running: true,
            connections: 1,
            connectionIds: ["conn-abc"],
            connectionMetas: { "conn-abc": { url: "https://example.com", title: "Example" } },
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createTabhrClient("http://127.0.0.1:9220");
    const status = await client.gatewayStatus();
    expect(status.connectionIds).toEqual(["conn-abc"]);
    expect(status.connectionMetas["conn-abc"]?.title).toBe("Example");
  });

  it("posts extractPage to /connection/:id/command", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/status")) {
        return {
          ok: true,
          json: async () => ({
            running: true,
            connections: 1,
            connectionIds: ["conn-abc"],
            connectionMetas: {},
          }),
        } as Response;
      }
      if (url.includes("/connection/conn-abc/command") && init?.method === "POST") {
        const rawBody = init?.body;
        const bodyText =
          typeof rawBody === "string" ? rawBody : rawBody != null ? JSON.stringify(rawBody) : "";
        const body = JSON.parse(bodyText) as { endpoint: string };
        expect(body.endpoint).toBe("extractPage");
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              page: {
                url: "https://example.com",
                title: "Example",
                html: "<html></html>",
                htmlTruncated: false,
                text: "Hello",
                textTruncated: false,
                interactiveElements: [],
                metadata: { forms: 0, links: 1, inputs: 0 },
              },
            },
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createTabhrClient("http://127.0.0.1:9220");
    const page = await client.extractPage({}, "conn-abc");
    expect(page.text).toBe("Hello");
  });

  it("isTabhrReachable returns true when gateway responds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          running: true,
          connections: 0,
          connectionIds: [],
          connectionMetas: {},
        }),
      })) as typeof fetch,
    );
    await expect(isTabhrReachable("http://127.0.0.1:9220")).resolves.toBe(true);
  });
});
