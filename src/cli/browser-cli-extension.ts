import type { Command } from "commander";
import { defaultRuntime } from "../runtime.js";
import { theme } from "../terminal/theme.js";
import { copyToClipboard } from "../infra/clipboard.js";
import { info } from "../globals.js";
import { TABHR_CDP_PORT } from "../config/port-defaults.js";

/** TabHR CDP URL (browser extension exposes CDP directly on this port). */
export const TABHR_CDP_URL = `http://127.0.0.1:${TABHR_CDP_PORT}`;

export function registerBrowserExtensionCommands(
  browser: Command,
  parentOpts: (cmd: Command) => { json?: boolean },
) {
  const ext = browser.command("extension").description("TabHR browser extension (CDP on port 9220)");

  ext
    .command("url")
    .description("Print the TabHR browser CDP URL (default profile uses this)")
    .action(async (_opts, cmd) => {
      const parent = parentOpts(cmd);
      if (parent?.json) {
        defaultRuntime.log(JSON.stringify({ url: TABHR_CDP_URL, port: TABHR_CDP_PORT }, null, 2));
        return;
      }
      defaultRuntime.log(TABHR_CDP_URL);
      const copied = await Promise.resolve(copyToClipboard(TABHR_CDP_URL)).catch(() => false);
      if (copied) {
        defaultRuntime.error(info("Copied to clipboard."));
      }
    });

  ext
    .command("info")
    .description("Show TabHR extension connection info")
    .action(async (_opts, cmd) => {
      const parent = parentOpts(cmd);
      if (parent?.json) {
        defaultRuntime.log(
          JSON.stringify(
            {
              url: TABHR_CDP_URL,
              port: TABHR_CDP_PORT,
              profile: "chrome",
              note: "Default browser profile 'chrome' uses this CDP URL. Ensure TabHR extension (or browser with --remote-debugging-port=9220) is running.",
            },
            null,
            2,
          ),
        );
        return;
      }
      defaultRuntime.error(
        info(
          [
            `${theme.muted("TabHR browser extension")} CDP URL: ${TABHR_CDP_URL}`,
            `Profile "chrome" uses this URL. Ensure the TabHR extension is running on port ${TABHR_CDP_PORT}.`,
          ].join("\n"),
        ),
      );
    });
}
