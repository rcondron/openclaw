/**
 * Runtime glue for HyDE system-prompt pruning: reads config/env, extracts the
 * latest user message + recent history from the live session, and invokes the
 * pruning pipeline. Gated (off by default) and fully fail-safe — any problem
 * returns `null` and the caller keeps the original system prompt.
 */
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { OpenClawConfig } from "../../config/config.js";
import type { SystemPromptPruningConfig } from "../../config/types.agent-defaults.js";
import { type HydePruneResult, pruneSystemPromptWithHyde } from "./hyde-system-prompt-prune.js";

/** Extract plain text from an AgentMessage's content (string or block array). */
function messageText(msg: AgentMessage): string {
  const content = (msg as { content?: unknown }).content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object") {
      const b = block as { type?: unknown; text?: unknown };
      if (b.type === "text" && typeof b.text === "string") {
        parts.push(b.text);
      }
    }
  }
  return parts.join(" ").trim();
}

/**
 * Pull the latest user message and a compact transcript of the turns leading up
 * to it. Newest history line last; capped by turns and characters.
 */
export function extractMessageAndHistory(
  messages: AgentMessage[],
  opts: { historyTurns?: number; historyCharCap?: number } = {},
): { userMessage: string; historyText: string } {
  const historyTurns = opts.historyTurns ?? 6;
  const historyCharCap = opts.historyCharCap ?? 1500;

  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user" && messageText(messages[i])) {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) {
    return { userMessage: "", historyText: "" };
  }
  const userMessage = messageText(messages[lastUserIdx]);

  const picked: string[] = [];
  for (let i = lastUserIdx - 1; i >= 0 && picked.length < historyTurns; i--) {
    const m = messages[i];
    if (m?.role !== "user" && m?.role !== "assistant") {
      continue;
    }
    const txt = messageText(m);
    if (txt) {
      picked.push(`${m.role}: ${txt}`);
    }
  }
  picked.reverse();
  const historyText = picked.join("\n").slice(-historyCharCap);
  return { userMessage, historyText };
}

function isEnvTruthy(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

type ResolvedHydePruneConfig = {
  apiKey: string;
  baseUrl?: string;
  hydeModel?: string;
  judgeModel?: string;
  minOptionalUnits?: number;
  maxOptionalTokens?: number;
  historyTurns?: number;
  timeoutMs?: number;
};

/**
 * Resolve the effective pruning config, or `null` when disabled/unavailable.
 * Enabled when `agents.defaults.systemPromptPruning.enabled` is true OR the
 * `OPENCLAW_HYDE_PRUNE` env flag is set. Requires `MORDIEM_API_KEY`.
 */
export function resolveHydePruneConfig(
  config?: OpenClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedHydePruneConfig | null {
  const cfg: SystemPromptPruningConfig | undefined = config?.agents?.defaults?.systemPromptPruning;
  const enabled = cfg?.enabled === true || isEnvTruthy(env.OPENCLAW_HYDE_PRUNE);
  if (!enabled) {
    return null;
  }
  const apiKey = env.MORDIEM_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }
  return {
    apiKey,
    baseUrl: cfg?.baseUrl ?? env.MORDIEM_BASE_URL?.trim() ?? undefined,
    hydeModel: cfg?.hydeModel ?? env.OPENCLAW_HYDE_MODEL?.trim() ?? undefined,
    judgeModel: cfg?.judgeModel ?? undefined,
    minOptionalUnits: cfg?.minOptionalUnits,
    maxOptionalTokens: cfg?.maxOptionalTokens,
    historyTurns: cfg?.historyTurns,
    timeoutMs: cfg?.timeoutMs,
  };
}

/**
 * Prune the system prompt for this turn if enabled. Returns the result (with the
 * pruned prompt) or `null` when disabled or on any failure. Never throws.
 */
export async function maybePruneSystemPromptWithHyde(params: {
  systemPromptText: string;
  messages: AgentMessage[];
  config?: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
  logger?: (message: string) => void;
}): Promise<HydePruneResult | null> {
  try {
    const resolved = resolveHydePruneConfig(params.config, params.env ?? process.env);
    if (!resolved) {
      return null;
    }
    const { userMessage, historyText } = extractMessageAndHistory(params.messages, {
      historyTurns: resolved.historyTurns,
    });
    if (!userMessage) {
      return null;
    }
    return await pruneSystemPromptWithHyde({
      systemPrompt: params.systemPromptText,
      userMessage,
      historyText,
      options: {
        apiKey: resolved.apiKey,
        baseUrl: resolved.baseUrl,
        hydeModel: resolved.hydeModel,
        judgeModel: resolved.judgeModel,
        minOptionalUnits: resolved.minOptionalUnits,
        maxOptionalTokens: resolved.maxOptionalTokens,
        timeoutMs: resolved.timeoutMs,
        logger: params.logger,
      },
    });
  } catch (err) {
    params.logger?.(`[hyde-prune] unexpected error: ${(err as Error).message}`);
    return null;
  }
}
