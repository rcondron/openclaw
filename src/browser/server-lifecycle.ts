import type { ResolvedBrowserConfig } from "./config.js";
import { resolveProfile } from "./config.js";
import {
  type BrowserServerState,
  createBrowserRouteContext,
  listKnownProfileNames,
} from "./server-context.js";

/** TabHR uses direct CDP on port 9220; no extension relay is started. */
export async function ensureExtensionRelayForProfiles(_params: {
  resolved: ResolvedBrowserConfig;
  onWarn: (message: string) => void;
}) {
  for (const name of Object.keys(_params.resolved.profiles)) {
    const profile = resolveProfile(_params.resolved, name);
    if (!profile || profile.driver !== "extension") {
      continue;
    }
    // TabHR browser extension exposes CDP directly at profile.cdpUrl (e.g. :9220); no relay.
  }
}

export async function stopKnownBrowserProfiles(params: {
  getState: () => BrowserServerState | null;
  onWarn: (message: string) => void;
}) {
  const current = params.getState();
  if (!current) {
    return;
  }
  const ctx = createBrowserRouteContext({
    getState: params.getState,
    refreshConfigFromDisk: true,
  });
  try {
    for (const name of listKnownProfileNames(current)) {
      try {
        await ctx.forProfile(name).stopRunningBrowser();
      } catch {
        // ignore
      }
    }
  } catch (err) {
    params.onWarn(`openclaw browser stop failed: ${String(err)}`);
  }
}
