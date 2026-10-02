import crypto from "node:crypto";
import {
  browserAct,
  browserArmDialog,
  browserArmFileChooser,
  browserConsoleMessages,
  browserNavigate,
  browserPdfSave,
  browserScreenshotAction,
} from "../../browser/client-actions.js";
import {
  browserCloseTab,
  browserFocusTab,
  browserOpenTab,
  browserProfiles,
  browserSnapshot,
  browserStart,
  browserStatus,
  browserStop,
  browserTabs,
} from "../../browser/client.js";
import { resolveBrowserConfig, resolveProfile } from "../../browser/config.js";
import { runHostedBrowserTask } from "../../browser/bu-ultrafast.js";
import { DEFAULT_AI_SNAPSHOT_MAX_CHARS } from "../../browser/constants.js";
import { DEFAULT_UPLOAD_DIR, resolveExistingPathsWithinRoot } from "../../browser/paths.js";
import { applyBrowserProxyPaths, persistBrowserProxyFiles } from "../../browser/proxy-files.js";
import { loadConfig } from "../../config/config.js";
import { wrapExternalContent } from "../../security/external-content.js";
import { BrowserToolSchema } from "./browser-tool.schema.js";
import { type AnyAgentTool, imageResultFromFile, jsonResult, readStringParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";
import { listNodes, resolveNodeIdFromList, type NodeListNode } from "./nodes-utils.js";

function wrapBrowserExternalJson(params: {
  kind: "snapshot" | "console" | "tabs";
  payload: unknown;
  includeWarning?: boolean;
}): { wrappedText: string; safeDetails: Record<string, unknown> } {
  const extractedText = JSON.stringify(params.payload, null, 2);
  const wrappedText = wrapExternalContent(extractedText, {
    source: "browser",
    includeWarning: params.includeWarning ?? true,
  });
  return {
    wrappedText,
    safeDetails: {
      ok: true,
      externalContent: {
        untrusted: true,
        source: "browser",
        kind: params.kind,
        wrapped: true,
      },
    },
  };
}

type BrowserProxyFile = {
  path: string;
  base64: string;
  mimeType?: string;
};

type BrowserProxyResult = {
  result: unknown;
  files?: BrowserProxyFile[];
};

const DEFAULT_BROWSER_PROXY_TIMEOUT_MS = 20_000;

type BrowserNodeTarget = {
  nodeId: string;
  label?: string;
};

function isBrowserNode(node: NodeListNode) {
  const caps = Array.isArray(node.caps) ? node.caps : [];
  const commands = Array.isArray(node.commands) ? node.commands : [];
  return caps.includes("browser") || commands.includes("browser.proxy");
}

async function resolveBrowserNodeTarget(params: {
  requestedNode?: string;
  target?: "sandbox" | "host" | "node";
  sandboxBridgeUrl?: string;
}): Promise<BrowserNodeTarget | null> {
  const cfg = loadConfig();
  const policy = cfg.gateway?.nodes?.browser;
  const mode = policy?.mode ?? "auto";
  if (mode === "off") {
    if (params.target === "node" || params.requestedNode) {
      throw new Error("Node browser proxy is disabled (gateway.nodes.browser.mode=off).");
    }
    return null;
  }
  if (params.sandboxBridgeUrl?.trim() && params.target !== "node" && !params.requestedNode) {
    return null;
  }
  if (params.target && params.target !== "node") {
    return null;
  }
  if (mode === "manual" && params.target !== "node" && !params.requestedNode) {
    return null;
  }

  const nodes = await listNodes({});
  const browserNodes = nodes.filter((node) => node.connected && isBrowserNode(node));
  if (browserNodes.length === 0) {
    if (params.target === "node" || params.requestedNode) {
      throw new Error("No connected browser-capable nodes.");
    }
    return null;
  }

  const requested = params.requestedNode?.trim() || policy?.node?.trim();
  if (requested) {
    const nodeId = resolveNodeIdFromList(browserNodes, requested, false);
    const node = browserNodes.find((entry) => entry.nodeId === nodeId);
    return { nodeId, label: node?.displayName ?? node?.remoteIp ?? nodeId };
  }

  if (params.target === "node") {
    if (browserNodes.length === 1) {
      const node = browserNodes[0];
      return { nodeId: node.nodeId, label: node.displayName ?? node.remoteIp ?? node.nodeId };
    }
    throw new Error(
      `Multiple browser-capable nodes connected (${browserNodes.length}). Set gateway.nodes.browser.node or pass node=<id>.`,
    );
  }

  if (mode === "manual") {
    return null;
  }

  if (browserNodes.length === 1) {
    const node = browserNodes[0];
    return { nodeId: node.nodeId, label: node.displayName ?? node.remoteIp ?? node.nodeId };
  }
  return null;
}

async function callBrowserProxy(params: {
  nodeId: string;
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
  profile?: string;
}): Promise<BrowserProxyResult> {
  const gatewayTimeoutMs =
    typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
      ? Math.max(1, Math.floor(params.timeoutMs))
      : DEFAULT_BROWSER_PROXY_TIMEOUT_MS;
  const payload = await callGatewayTool<{ payloadJSON?: string; payload?: string }>(
    "node.invoke",
    { timeoutMs: gatewayTimeoutMs },
    {
      nodeId: params.nodeId,
      command: "browser.proxy",
      params: {
        method: params.method,
        path: params.path,
        query: params.query,
        body: params.body,
        timeoutMs: params.timeoutMs,
        profile: params.profile,
      },
      idempotencyKey: crypto.randomUUID(),
    },
  );
  const parsed =
    payload?.payload ??
    (typeof payload?.payloadJSON === "string" && payload.payloadJSON
      ? (JSON.parse(payload.payloadJSON) as BrowserProxyResult)
      : null);
  if (!parsed || typeof parsed !== "object" || !("result" in parsed)) {
    throw new Error("browser proxy failed");
  }
  return parsed;
}

async function persistProxyFiles(files: BrowserProxyFile[] | undefined) {
  return await persistBrowserProxyFiles(files);
}

function applyProxyPaths(result: unknown, mapping: Map<string, string>) {
  applyBrowserProxyPaths(result, mapping);
}

function resolveBrowserBaseUrl(params: {
  target?: "sandbox" | "host";
  sandboxBridgeUrl?: string;
  allowHostControl?: boolean;
}): string | undefined {
  const cfg = loadConfig();
  const resolved = resolveBrowserConfig(cfg.browser, cfg);
  const normalizedSandbox = params.sandboxBridgeUrl?.trim() ?? "";
  const target = params.target ?? (normalizedSandbox ? "sandbox" : "host");

  if (target === "sandbox") {
    if (!normalizedSandbox) {
      throw new Error(
        'Sandbox browser is unavailable. Enable agents.defaults.sandbox.browser.enabled or use target="host" if allowed.',
      );
    }
    return normalizedSandbox.replace(/\/$/, "");
  }

  if (params.allowHostControl === false) {
    throw new Error("Host browser control is disabled by sandbox policy.");
  }
  if (!resolved.enabled) {
    throw new Error(
      "Browser control is disabled. Set browser.enabled=true in ~/.openclaw/openclaw.json.",
    );
  }
  return undefined;
}

/**
 * The profile this call should actually use.
 *
 * Agents ask for "browserless" by name because that is what the docs and this
 * tool's own description have always called the remote browser. In a company
 * gateway that name means the container-wide session shared by every employee,
 * while each agent also has its own — and under a provider that rents one
 * browser per employee the shared one has no browser behind it at all, so the
 * call fails with "target closed" however healthy the agent's own browser is.
 *
 * So a request for the shared session is read as "the remote browser", and the
 * agent's own is what it gets. Naming any other profile is left alone: that is
 * someone asking for a specific browser on purpose.
 */
const SHARED_PROFILE_NAMES = new Set(["browserless", "openclaw"]);

function preferOwnProfile(requested: string | undefined, own: string | undefined): string | undefined {
  if (!own || own === requested) return requested;
  if (!requested) return own;
  return SHARED_PROFILE_NAMES.has(requested) ? own : requested;
}

/**
 * The CDP address the fast loop should attach to, as a WebSocket.
 *
 * It uses the same profile every other browser action in this call would, so
 * the loop and the agent are always driving one browser. Returns null rather
 * than throwing: a missing profile means "do it the slow way", not "fail".
 */
function resolveFastTaskCdpUrl(profileName?: string): string | null {
  try {
    const cfg = loadConfig();
    const resolved = resolveBrowserConfig(cfg.browser, cfg);
    const name = profileName ?? resolved.defaultProfile;
    const profile = name ? resolveProfile(resolved, name) : null;
    // resolveProfile already turns a port-only profile into a full address, so
    // there is nothing left to fall back to if it found none.
    const httpUrl = profile?.cdpUrl;
    if (!httpUrl) return null;
    const ws = httpUrl.replace(/^http/, "ws").replace(/\/$/, "");
    // A shared Chrome tab is reached through the extension-tab gateway, which
    // serves the browser-level endpoint on a path rather than at the root. The
    // employee's own browser answers at the root.
    return profile?.driver === "extension" ? `${ws}/cdp` : ws;
  } catch {
    return null;
  }
}

export function createBrowserTool(opts?: {
  sandboxBridgeUrl?: string;
  allowHostControl?: boolean;
  /** Used when a call names no profile, so each agent lands in its own browser session. */
  defaultProfile?: string;
  /** Who this agent is, for runs TabHR executes on its behalf. */
  agentId?: string;
}): AnyAgentTool {
  const targetDefault = opts?.sandboxBridgeUrl ? "sandbox" : "host";
  const hostHint =
    opts?.allowHostControl === false ? "Host target blocked by policy." : "Host target allowed.";
  return {
    label: "Browser",
    name: "browser",
    description: [
      'START HERE for any web task: action="task" with goal="<the whole job in one sentence>" (and startUrl if you know where to begin). It reads the page as a list of controls and decides each step in about half a second, so it finishes in seconds what costs minutes step by step. It drives the same browser as every other action here, so whatever it leaves on screen is where you continue.',
      'It works on a shared Chrome tab too: pass profile="chrome" and omit startUrl, since the tab is already where the person left it.',
      'The reply says what to do next: done=true means the task is finished — stop, do not redo it to check. fallback=true means it stopped early; read reason and steps, then finish the job yourself with snapshot/act FROM WHERE IT LEFT OFF, not from the beginning.',
      'Do not use action="task" for a step that cannot be taken back (sending a message, submitting a payment, accepting terms) — do those yourself, one action at a time.',
      "Everything else: control the browser step by step via the browser control server (status/start/stop/profiles/tabs/open/snapshot/screenshot/actions).",
      'Profiles: use profile="chrome" for TabHR browser extension (shared tab gateway on port 9220). Use profile="browserless" for remote Browserless.io (CDP/WebSocket via Playwright; legacy name: openclaw).',
      'If the user mentions the TabHR extension, shared tab, or browser on port 9220, use profile="chrome" and read the tabhr-extension skill.',
      'There is no way to run your own JavaScript in a page, by design: use snapshot to read it and act to change it, or action="task" for a whole job. Both are real input and work where a page forbids scripts.',
      'When a node-hosted browser proxy is available, the tool may auto-route to it. Pin a node with node=<id|name> or target="node".',
      "TabHR profile (chrome) uses GET /status and POST /connection/:id/command at http://127.0.0.1:9220. targetId is the connection UUID from tabs/status — not a CDP target id.",
      "When using refs from snapshot (e.g. e12), keep the same tab: prefer passing targetId from the snapshot response into subsequent actions (act/click/type/etc).",
      'For stable, self-resolving refs across calls, use snapshot with refs="aria" (Playwright aria-ref ids). Default refs="role" are role+name-based.',
      "Use snapshot+act for UI automation. Avoid act:wait by default; use only in exceptional cases when no reliable UI state exists.",
      `target selects browser location (sandbox|host|node). Default: ${targetDefault}.`,
      hostHint,
    ].join(" "),
    parameters: BrowserToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const requestedProfile = readStringParam(params, "profile") ?? undefined;
      const profile = preferOwnProfile(requestedProfile, opts?.defaultProfile);
      if (requestedProfile && profile !== requestedProfile) {
        console.log(
          `[browser] profile "${requestedProfile}" is the container-wide session; using this agent's own "${profile}" instead`,
        );
      }
      const requestedNode = readStringParam(params, "node");
      let target = readStringParam(params, "target") as "sandbox" | "host" | "node" | undefined;

      if (requestedNode && target && target !== "node") {
        throw new Error('node is only supported with target="node".');
      }

      if (!target && !requestedNode && profile === "chrome") {
        // Chrome extension relay takeover is a host Chrome feature; prefer host unless explicitly targeting a node.
        target = "host";
      }

      const nodeTarget = await resolveBrowserNodeTarget({
        requestedNode: requestedNode ?? undefined,
        target,
        sandboxBridgeUrl: opts?.sandboxBridgeUrl,
      });

      const resolvedTarget = target === "node" ? undefined : target;
      const baseUrl = nodeTarget
        ? undefined
        : resolveBrowserBaseUrl({
            target: resolvedTarget,
            sandboxBridgeUrl: opts?.sandboxBridgeUrl,
            allowHostControl: opts?.allowHostControl,
          });

      const proxyRequest = nodeTarget
        ? async (opts: {
            method: string;
            path: string;
            query?: Record<string, string | number | boolean | undefined>;
            body?: unknown;
            timeoutMs?: number;
            profile?: string;
          }) => {
            const proxy = await callBrowserProxy({
              nodeId: nodeTarget.nodeId,
              method: opts.method,
              path: opts.path,
              query: opts.query,
              body: opts.body,
              timeoutMs: opts.timeoutMs,
              profile: opts.profile,
            });
            const mapping = await persistProxyFiles(proxy.files);
            applyProxyPaths(proxy.result, mapping);
            return proxy.result;
          }
        : null;

      switch (action) {
        case "status":
          if (proxyRequest) {
            return jsonResult(
              await proxyRequest({
                method: "GET",
                path: "/",
                profile,
              }),
            );
          }
          return jsonResult(await browserStatus(baseUrl, { profile }));
        case "start":
          if (proxyRequest) {
            await proxyRequest({
              method: "POST",
              path: "/start",
              profile,
            });
            return jsonResult(
              await proxyRequest({
                method: "GET",
                path: "/",
                profile,
              }),
            );
          }
          await browserStart(baseUrl, { profile });
          return jsonResult(await browserStatus(baseUrl, { profile }));
        case "stop":
          if (proxyRequest) {
            await proxyRequest({
              method: "POST",
              path: "/stop",
              profile,
            });
            return jsonResult(
              await proxyRequest({
                method: "GET",
                path: "/",
                profile,
              }),
            );
          }
          await browserStop(baseUrl, { profile });
          return jsonResult(await browserStatus(baseUrl, { profile }));
        case "profiles":
          if (proxyRequest) {
            const result = await proxyRequest({
              method: "GET",
              path: "/profiles",
            });
            return jsonResult(result);
          }
          return jsonResult({ profiles: await browserProfiles(baseUrl) });
        case "tabs":
          if (proxyRequest) {
            const result = await proxyRequest({
              method: "GET",
              path: "/tabs",
              profile,
            });
            const tabs = (result as { tabs?: unknown[] }).tabs ?? [];
            const wrapped = wrapBrowserExternalJson({
              kind: "tabs",
              payload: { tabs },
              includeWarning: false,
            });
            return {
              content: [{ type: "text", text: wrapped.wrappedText }],
              details: { ...wrapped.safeDetails, tabCount: tabs.length },
            };
          }
          {
            const tabs = await browserTabs(baseUrl, { profile });
            const wrapped = wrapBrowserExternalJson({
              kind: "tabs",
              payload: { tabs },
              includeWarning: false,
            });
            return {
              content: [{ type: "text", text: wrapped.wrappedText }],
              details: { ...wrapped.safeDetails, tabCount: tabs.length },
            };
          }
        case "open": {
          const targetUrl = readStringParam(params, "targetUrl", {
            required: true,
          });
          if (proxyRequest) {
            const result = await proxyRequest({
              method: "POST",
              path: "/tabs/open",
              profile,
              body: { url: targetUrl },
            });
            return jsonResult(result);
          }
          return jsonResult(await browserOpenTab(baseUrl, targetUrl, { profile }));
        }
        case "focus": {
          const targetId = readStringParam(params, "targetId", {
            required: true,
          });
          if (proxyRequest) {
            const result = await proxyRequest({
              method: "POST",
              path: "/tabs/focus",
              profile,
              body: { targetId },
            });
            return jsonResult(result);
          }
          await browserFocusTab(baseUrl, targetId, { profile });
          return jsonResult({ ok: true });
        }
        case "close": {
          const targetId = readStringParam(params, "targetId");
          if (proxyRequest) {
            const result = targetId
              ? await proxyRequest({
                  method: "DELETE",
                  path: `/tabs/${encodeURIComponent(targetId)}`,
                  profile,
                })
              : await proxyRequest({
                  method: "POST",
                  path: "/act",
                  profile,
                  body: { kind: "close" },
                });
            return jsonResult(result);
          }
          if (targetId) {
            await browserCloseTab(baseUrl, targetId, { profile });
          } else {
            await browserAct(baseUrl, { kind: "close" }, { profile });
          }
          return jsonResult({ ok: true });
        }
        case "snapshot": {
          const snapshotDefaults = loadConfig().browser?.snapshotDefaults;
          const format =
            params.snapshotFormat === "ai" || params.snapshotFormat === "aria"
              ? params.snapshotFormat
              : "ai";
          const mode =
            params.mode === "efficient"
              ? "efficient"
              : format === "ai" && snapshotDefaults?.mode === "efficient"
                ? "efficient"
                : undefined;
          const labels = typeof params.labels === "boolean" ? params.labels : undefined;
          const refs = params.refs === "aria" || params.refs === "role" ? params.refs : undefined;
          const hasMaxChars = Object.hasOwn(params, "maxChars");
          const targetId = typeof params.targetId === "string" ? params.targetId.trim() : undefined;
          const limit =
            typeof params.limit === "number" && Number.isFinite(params.limit)
              ? params.limit
              : undefined;
          const maxChars =
            typeof params.maxChars === "number" &&
            Number.isFinite(params.maxChars) &&
            params.maxChars > 0
              ? Math.floor(params.maxChars)
              : undefined;
          const resolvedMaxChars =
            format === "ai"
              ? hasMaxChars
                ? maxChars
                : mode === "efficient"
                  ? undefined
                  : DEFAULT_AI_SNAPSHOT_MAX_CHARS
              : undefined;
          const interactive =
            typeof params.interactive === "boolean" ? params.interactive : undefined;
          const compact = typeof params.compact === "boolean" ? params.compact : undefined;
          const depth =
            typeof params.depth === "number" && Number.isFinite(params.depth)
              ? params.depth
              : undefined;
          const selector = typeof params.selector === "string" ? params.selector.trim() : undefined;
          const frame = typeof params.frame === "string" ? params.frame.trim() : undefined;
          const snapshot = proxyRequest
            ? ((await proxyRequest({
                method: "GET",
                path: "/snapshot",
                profile,
                query: {
                  format,
                  targetId,
                  limit,
                  ...(typeof resolvedMaxChars === "number" ? { maxChars: resolvedMaxChars } : {}),
                  refs,
                  interactive,
                  compact,
                  depth,
                  selector,
                  frame,
                  labels,
                  mode,
                },
              })) as Awaited<ReturnType<typeof browserSnapshot>>)
            : await browserSnapshot(baseUrl, {
                format,
                targetId,
                limit,
                ...(typeof resolvedMaxChars === "number" ? { maxChars: resolvedMaxChars } : {}),
                refs,
                interactive,
                compact,
                depth,
                selector,
                frame,
                labels,
                mode,
                profile,
              });
          if (snapshot.format === "ai") {
            const extractedText = snapshot.snapshot ?? "";
            const wrappedSnapshot = wrapExternalContent(extractedText, {
              source: "browser",
              includeWarning: true,
            });
            const safeDetails = {
              ok: true,
              format: snapshot.format,
              targetId: snapshot.targetId,
              url: snapshot.url,
              truncated: snapshot.truncated,
              stats: snapshot.stats,
              refs: snapshot.refs ? Object.keys(snapshot.refs).length : undefined,
              labels: snapshot.labels,
              labelsCount: snapshot.labelsCount,
              labelsSkipped: snapshot.labelsSkipped,
              imagePath: snapshot.imagePath,
              imageType: snapshot.imageType,
              externalContent: {
                untrusted: true,
                source: "browser",
                kind: "snapshot",
                format: "ai",
                wrapped: true,
              },
            };
            if (labels && snapshot.imagePath) {
              return await imageResultFromFile({
                label: "browser:snapshot",
                path: snapshot.imagePath,
                extraText: wrappedSnapshot,
                details: safeDetails,
              });
            }
            return {
              content: [{ type: "text", text: wrappedSnapshot }],
              details: safeDetails,
            };
          }
          {
            const wrapped = wrapBrowserExternalJson({
              kind: "snapshot",
              payload: snapshot,
            });
            return {
              content: [{ type: "text", text: wrapped.wrappedText }],
              details: {
                ...wrapped.safeDetails,
                format: "aria",
                targetId: snapshot.targetId,
                url: snapshot.url,
                nodeCount: snapshot.nodes.length,
                externalContent: {
                  untrusted: true,
                  source: "browser",
                  kind: "snapshot",
                  format: "aria",
                  wrapped: true,
                },
              },
            };
          }
        }
        case "screenshot": {
          const targetId = readStringParam(params, "targetId");
          const fullPage = Boolean(params.fullPage);
          const ref = readStringParam(params, "ref");
          const element = readStringParam(params, "element");
          const type = params.type === "jpeg" ? "jpeg" : "png";
          const result = proxyRequest
            ? ((await proxyRequest({
                method: "POST",
                path: "/screenshot",
                profile,
                body: {
                  targetId,
                  fullPage,
                  ref,
                  element,
                  type,
                },
              })) as Awaited<ReturnType<typeof browserScreenshotAction>>)
            : await browserScreenshotAction(baseUrl, {
                targetId,
                fullPage,
                ref,
                element,
                type,
                profile,
              });
          return await imageResultFromFile({
            label: "browser:screenshot",
            path: result.path,
            details: result,
          });
        }
        case "navigate": {
          const targetUrl = readStringParam(params, "targetUrl", {
            required: true,
          });
          const targetId = readStringParam(params, "targetId");
          if (proxyRequest) {
            const result = await proxyRequest({
              method: "POST",
              path: "/navigate",
              profile,
              body: {
                url: targetUrl,
                targetId,
              },
            });
            return jsonResult(result);
          }
          return jsonResult(
            await browserNavigate(baseUrl, {
              url: targetUrl,
              targetId,
              profile,
            }),
          );
        }
        case "console": {
          const level = typeof params.level === "string" ? params.level.trim() : undefined;
          const targetId = typeof params.targetId === "string" ? params.targetId.trim() : undefined;
          if (proxyRequest) {
            const result = (await proxyRequest({
              method: "GET",
              path: "/console",
              profile,
              query: {
                level,
                targetId,
              },
            })) as { ok?: boolean; targetId?: string; messages?: unknown[] };
            const wrapped = wrapBrowserExternalJson({
              kind: "console",
              payload: result,
              includeWarning: false,
            });
            return {
              content: [{ type: "text", text: wrapped.wrappedText }],
              details: {
                ...wrapped.safeDetails,
                targetId: typeof result.targetId === "string" ? result.targetId : undefined,
                messageCount: Array.isArray(result.messages) ? result.messages.length : undefined,
              },
            };
          }
          {
            const result = await browserConsoleMessages(baseUrl, { level, targetId, profile });
            const wrapped = wrapBrowserExternalJson({
              kind: "console",
              payload: result,
              includeWarning: false,
            });
            return {
              content: [{ type: "text", text: wrapped.wrappedText }],
              details: {
                ...wrapped.safeDetails,
                targetId: result.targetId,
                messageCount: result.messages.length,
              },
            };
          }
        }
        case "pdf": {
          const targetId = typeof params.targetId === "string" ? params.targetId.trim() : undefined;
          const result = proxyRequest
            ? ((await proxyRequest({
                method: "POST",
                path: "/pdf",
                profile,
                body: { targetId },
              })) as Awaited<ReturnType<typeof browserPdfSave>>)
            : await browserPdfSave(baseUrl, { targetId, profile });
          return {
            content: [{ type: "text", text: `FILE:${result.path}` }],
            details: result,
          };
        }
        case "upload": {
          const paths = Array.isArray(params.paths) ? params.paths.map((p) => String(p)) : [];
          if (paths.length === 0) {
            throw new Error("paths required");
          }
          const uploadPathsResult = await resolveExistingPathsWithinRoot({
            rootDir: DEFAULT_UPLOAD_DIR,
            requestedPaths: paths,
            scopeLabel: `uploads directory (${DEFAULT_UPLOAD_DIR})`,
          });
          if (!uploadPathsResult.ok) {
            throw new Error(uploadPathsResult.error);
          }
          const normalizedPaths = uploadPathsResult.paths;
          const ref = readStringParam(params, "ref");
          const inputRef = readStringParam(params, "inputRef");
          const element = readStringParam(params, "element");
          const targetId = typeof params.targetId === "string" ? params.targetId.trim() : undefined;
          const timeoutMs =
            typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
              ? params.timeoutMs
              : undefined;
          if (proxyRequest) {
            const result = await proxyRequest({
              method: "POST",
              path: "/hooks/file-chooser",
              profile,
              body: {
                paths: normalizedPaths,
                ref,
                inputRef,
                element,
                targetId,
                timeoutMs,
              },
            });
            return jsonResult(result);
          }
          return jsonResult(
            await browserArmFileChooser(baseUrl, {
              paths: normalizedPaths,
              ref,
              inputRef,
              element,
              targetId,
              timeoutMs,
              profile,
            }),
          );
        }
        case "dialog": {
          const accept = Boolean(params.accept);
          const promptText = typeof params.promptText === "string" ? params.promptText : undefined;
          const targetId = typeof params.targetId === "string" ? params.targetId.trim() : undefined;
          const timeoutMs =
            typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
              ? params.timeoutMs
              : undefined;
          if (proxyRequest) {
            const result = await proxyRequest({
              method: "POST",
              path: "/hooks/dialog",
              profile,
              body: {
                accept,
                promptText,
                targetId,
                timeoutMs,
              },
            });
            return jsonResult(result);
          }
          return jsonResult(
            await browserArmDialog(baseUrl, {
              accept,
              promptText,
              targetId,
              timeoutMs,
              profile,
            }),
          );
        }
        case "task": {
          const goal = readStringParam(params, "goal", { required: true })!;
          const startUrl = readStringParam(params, "startUrl") ?? undefined;
          if (startUrl && !/^https?:\/\//i.test(startUrl)) {
            throw new Error("startUrl must be http(s)");
          }

          // The whole task runs on Browser Use's hosted agent. We do not drive
          // the browser for it, and neither does the loop in fast-task/ — it
          // happens on their side, in this employee's own browser profile.
          console.log(`[bu-ultrafast] action=task requested (agent=${opts?.agentId ?? "unknown"})`);
          const outcome = await runHostedBrowserTask({
            agentId: opts?.agentId ?? "",
            goal,
            startUrl,
          });

          // A run that did not finish says only that.
          //
          // This used to hand back the step list, the reason and the final url.
          // An agent given eleven steps with labels like "Where from?" reads
          // them as progress and says so — one run reported "it set LAX to PHX
          // and picked a departure date" when the loop had in fact put Phoenix
          // in both fields and never reached a date, then produced a full list
          // of flights from four seconds of browser work. So there is nothing
          // here to narrate from: the agent already has the goal, and carries
          // on with the step-by-step actions instead.
          return jsonResult(outcome);
        }

        case "act": {
          const request = params.request as Record<string, unknown> | undefined;
          if (!request || typeof request !== "object") {
            throw new Error("request required");
          }
          try {
            const result = proxyRequest
              ? await proxyRequest({
                  method: "POST",
                  path: "/act",
                  profile,
                  body: request,
                })
              : await browserAct(baseUrl, request as Parameters<typeof browserAct>[1], {
                  profile,
                });
            return jsonResult(result);
          } catch (err) {
            const msg = String(err);
            if (msg.includes("404:") && msg.includes("tab not found") && profile === "chrome") {
              const tabs = proxyRequest
                ? ((
                    (await proxyRequest({
                      method: "GET",
                      path: "/tabs",
                      profile,
                    })) as { tabs?: unknown[] }
                  ).tabs ?? [])
                : await browserTabs(baseUrl, { profile }).catch(() => []);
              if (!tabs.length) {
                throw new Error(
                  "No tabs available via TabHR browser (port 9220). Ensure the TabHR extension is running and open a tab, then retry.",
                  { cause: err },
                );
              }
              throw new Error(
                `Tab not found (stale targetId?). Run action=tabs profile="chrome" and use one of the returned targetIds.`,
                { cause: err },
              );
            }
            throw err;
          }
        }
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  };
}
