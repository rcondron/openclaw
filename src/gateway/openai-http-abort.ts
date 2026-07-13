import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveSession } from "../commands/agent/session.js";
import { loadConfig } from "../config/config.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import { sendJson } from "./http-common.js";
import { handleGatewayPostJsonEndpoint } from "./http-endpoint-helpers.js";
import { resolveAgentIdForRequest, resolveSessionKey } from "./http-utils.js";
import { abortOpenAiHttpRun, abortOpenAiHttpRunsForSessionKey } from "./openai-http-runs.js";

type OpenAiAbortRequest = {
  run_id?: unknown;
  runId?: unknown;
  user?: unknown;
  session_key?: unknown;
  sessionKey?: unknown;
};

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveAbortSessionKey(params: {
  req: IncomingMessage;
  agentId: string;
  user?: string;
  sessionKey?: string;
}): string | null {
  const explicitSessionKey = params.sessionKey?.trim();
  if (explicitSessionKey) {
    return explicitSessionKey;
  }
  const user = params.user?.trim();
  if (!user) {
    return null;
  }
  return resolveSessionKey({
    req: params.req,
    agentId: params.agentId,
    user,
    prefix: "openai",
  });
}

export async function handleOpenAiAbortHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const handled = await handleGatewayPostJsonEndpoint(req, res, {
    pathname: "/v1/chat/completions/abort",
    auth: opts.auth,
    trustedProxies: opts.trustedProxies,
    allowRealIpFallback: opts.allowRealIpFallback,
    rateLimiter: opts.rateLimiter,
    maxBodyBytes: 16_384,
  });
  if (handled === false) {
    return false;
  }
  if (!handled) {
    return true;
  }

  const payload = handled.body as OpenAiAbortRequest;
  const runId = readString(payload.run_id) || readString(payload.runId);
  const agentId = resolveAgentIdForRequest({ req, model: undefined });
  const sessionKey = resolveAbortSessionKey({
    req,
    agentId,
    user: readString(payload.user) || undefined,
    sessionKey: readString(payload.session_key) || readString(payload.sessionKey) || undefined,
  });

  if (runId) {
    const result = abortOpenAiHttpRun(runId);
    sendJson(res, 200, {
      aborted: result.aborted,
      run_ids: result.aborted ? [runId] : [],
    });
    return true;
  }

  if (sessionKey) {
    const result = abortOpenAiHttpRunsForSessionKey(sessionKey);
    sendJson(res, 200, {
      aborted: result.aborted,
      run_ids: result.runIds,
    });
    return true;
  }

  sendJson(res, 400, {
    error: {
      message: "Provide run_id or user/session_key to abort an OpenAI chat completion run.",
      type: "invalid_request_error",
    },
  });
  return true;
}

export function resolveOpenAiSessionIdForKey(sessionKey: string, agentId: string): string {
  const cfg = loadConfig();
  const { sessionId } = resolveSession({
    cfg,
    sessionKey,
    agentId,
  });
  return sessionId;
}
