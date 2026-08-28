import { describe, expect, it } from "vitest";
import {
  isToolAllowed,
  listEnabledServers,
  matchesGlob,
  resolveTransport,
  validateServer,
} from "./config.js";

describe("resolveTransport", () => {
  it("infers stdio from command and streamable-http from url", () => {
    expect(resolveTransport({ command: "node" })).toBe("stdio");
    expect(resolveTransport({ url: "https://example.com/mcp" })).toBe("streamable-http");
  });

  it("honours an explicit transport", () => {
    expect(resolveTransport({ url: "https://example.com/mcp", transport: "sse" })).toBe("sse");
  });
});

describe("validateServer", () => {
  it("requires a command for stdio and a url for http transports", () => {
    expect(validateServer("x", { transport: "stdio" })).toMatch(/requires a command/);
    expect(validateServer("x", { transport: "streamable-http" })).toMatch(/requires a url/);
  });

  it("rejects the reserved __proto__ name", () => {
    expect(validateServer("__proto__", { url: "https://example.com" })).toMatch(/reserved/);
  });

  it("accepts a valid definition", () => {
    expect(validateServer("x", { url: "https://example.com/mcp" })).toBeNull();
    expect(validateServer("x", { command: "node", args: ["s.js"] })).toBeNull();
  });
});

describe("matchesGlob", () => {
  it("matches * wildcards and escapes regex metacharacters", () => {
    expect(matchesGlob("read_*", "read_graph")).toBe(true);
    expect(matchesGlob("read_*", "create_entities")).toBe(false);
    expect(matchesGlob("a.b", "axb")).toBe(false);
  });
});

describe("isToolAllowed", () => {
  it("allows everything when no filter is set", () => {
    expect(isToolAllowed("anything", undefined)).toBe(true);
  });

  it("applies include as an allowlist", () => {
    expect(isToolAllowed("read_graph", { include: ["read_*"] })).toBe(true);
    expect(isToolAllowed("create_entities", { include: ["read_*"] })).toBe(false);
  });

  it("lets exclude win over include", () => {
    expect(isToolAllowed("read_graph", { include: ["read_*"], exclude: ["read_graph"] })).toBe(
      false,
    );
  });
});

describe("listEnabledServers", () => {
  it("skips servers explicitly disabled", () => {
    const names = listEnabledServers({
      servers: {
        on: { url: "https://a" },
        off: { url: "https://b", enabled: false },
        implicit: { url: "https://c", enabled: true },
      },
    }).map(([name]) => name);
    expect(names).toEqual(["on", "implicit"]);
  });
});
