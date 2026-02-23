import path from "node:path";
import { Command } from "commander";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const copyToClipboard = vi.fn();
const runtime = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(),
};

vi.mock("../infra/clipboard.js", () => ({
  copyToClipboard: (...args: unknown[]) => copyToClipboard(...args),
}));

vi.mock("../runtime.js", () => ({
  defaultRuntime: runtime,
}));

let registerBrowserExtensionCommands: typeof import("./browser-cli-extension.js").registerBrowserExtensionCommands;
let TABHR_CDP_URL: string;

beforeAll(async () => {
  const mod = await import("./browser-cli-extension.js");
  registerBrowserExtensionCommands = mod.registerBrowserExtensionCommands;
  TABHR_CDP_URL = mod.TABHR_CDP_URL;
});

beforeEach(() => {
  copyToClipboard.mockReset();
  runtime.log.mockReset();
  runtime.error.mockReset();
  runtime.exit.mockReset();
});

describe("browser extension (TabHR)", () => {
  it("url command prints TabHR CDP URL", async () => {
    const program = new Command();
    const browser = program.command("browser").option("--json", "JSON output", false);
    registerBrowserExtensionCommands(browser, (cmd) => cmd.parent?.opts?.() as { json?: boolean });

    await program.parseAsync(["browser", "extension", "url"], { from: "user" });

    expect(runtime.log).toHaveBeenCalledWith(TABHR_CDP_URL);
    expect(TABHR_CDP_URL).toBe("http://127.0.0.1:9220");
  });

  it("url --json outputs JSON with url and port", async () => {
    const program = new Command();
    const browser = program.command("browser").option("--json", "JSON output", false);
    // parentOpts: in real CLI, --json is on browser so we simulate json from parent
    registerBrowserExtensionCommands(browser, () => ({ json: true }));

    await program.parseAsync(["browser", "extension", "url"], { from: "user" });

    expect(runtime.log).toHaveBeenCalledWith(
      JSON.stringify({ url: "http://127.0.0.1:9220", port: 9220 }, null, 2),
    );
  });

  it("info command runs without error", async () => {
    const program = new Command();
    const browser = program.command("browser").option("--json", "JSON output", false);
    registerBrowserExtensionCommands(browser, (cmd) => cmd.parent?.opts?.() as { json?: boolean });

    await program.parseAsync(["browser", "extension", "info"], { from: "user" });

    expect(runtime.error).toHaveBeenCalled();
    const msg = (runtime.error.mock.calls[0] as unknown[])[0] as string;
    expect(msg).toContain("9220");
    expect(msg).toContain("TabHR");
  });
});
