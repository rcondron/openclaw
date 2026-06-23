/**
 * TabHR browser extension gateway client (port 9220).
 * Uses extension-tab-gateway HTTP API:
 *   GET  /status
 *   POST /connection/:connectionId/command  { requestId, endpoint, ...params }
 */

let requestIdCounter = 0;

function nextRequestId(): string {
  requestIdCounter += 1;
  return `tabhr-${requestIdCounter}`;
}

export type TabhrConnectionMeta = {
  url: string;
  title: string;
};

export type TabhrGatewayStatus = {
  running: boolean;
  connections: number;
  connectionIds: string[];
  connectionMetas: Record<string, TabhrConnectionMeta>;
};

export type TabhrInteractiveElement = {
  index: number;
  tag: string;
  type: string | null;
  id: string | null;
  name: string | null;
  placeholder: string | null;
  ariaLabel: string | null;
  text: string | null;
  href: string | null;
  value: string | null;
  disabled: boolean;
  visible: boolean;
  selectorHint: string;
};

export type TabhrExtractPageData = {
  url: string;
  title: string;
  html: string;
  htmlTruncated: boolean;
  text: string;
  textTruncated: boolean;
  interactiveElements: TabhrInteractiveElement[];
  metadata: {
    forms: number;
    links: number;
    inputs: number;
  };
};

export type TabhrRunScriptResult = {
  ok: boolean;
  result: unknown;
  error: string | null;
};

type GatewayCommandResponse = { success: true; data: unknown } | { success: false; error: string };

const DEFAULT_TIMEOUT_MS = 8000;

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getGatewayStatus(
  baseUrl: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<TabhrGatewayStatus> {
  const url = `${normalizeBaseUrl(baseUrl)}/status`;
  const res = await fetchWithTimeout(url, { method: "GET" }, timeoutMs);
  if (!res.ok) {
    throw new Error(`TabHR HTTP ${res.status}`);
  }
  return (await res.json()) as TabhrGatewayStatus;
}

async function postConnectionCommand(
  baseUrl: string,
  connectionId: string,
  endpoint: string,
  params: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const requestId = nextRequestId();
  const url = `${normalizeBaseUrl(baseUrl)}/connection/${encodeURIComponent(connectionId)}/command`;
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, endpoint, ...params }),
    },
    timeoutMs,
  );
  if (!res.ok) {
    throw new Error(`TabHR HTTP ${res.status}`);
  }
  const json = (await res.json()) as GatewayCommandResponse;
  if (!json.success) {
    throw new Error(json.error ?? "TabHR command failed");
  }
  return json.data;
}

export function createTabhrClient(baseUrl: string, preferredConnectionId?: string) {
  let cachedConnectionId = preferredConnectionId?.trim() || "";

  async function resolveConnectionId(explicit?: string): Promise<string> {
    const id = explicit?.trim() || cachedConnectionId;
    if (id) {
      return id;
    }
    const status = await getGatewayStatus(baseUrl);
    if (status.connectionIds.length === 0) {
      throw new Error("No TabHR extension connections available");
    }
    cachedConnectionId = status.connectionIds[0] ?? "";
    if (!cachedConnectionId) {
      throw new Error("No TabHR extension connections available");
    }
    return cachedConnectionId;
  }

  async function command<T>(
    endpoint: string,
    params: Record<string, unknown> = {},
    opts?: { connectionId?: string; timeoutMs?: number },
  ): Promise<T> {
    const connectionId = await resolveConnectionId(opts?.connectionId);
    return (await postConnectionCommand(
      baseUrl,
      connectionId,
      endpoint,
      params,
      opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    )) as T;
  }

  return {
    /** Gateway status with all shared-tab connection IDs. */
    async gatewayStatus(timeoutMs?: number): Promise<TabhrGatewayStatus> {
      return await getGatewayStatus(baseUrl, timeoutMs ?? DEFAULT_TIMEOUT_MS);
    },

    async resolveConnectionId(explicit?: string): Promise<string> {
      return await resolveConnectionId(explicit);
    },

    /** Per-connection page url/title. */
    async status(connectionId?: string, timeoutMs?: number): Promise<TabhrConnectionMeta> {
      return await command<TabhrConnectionMeta>("status", {}, { connectionId, timeoutMs });
    },

    async extractPage(
      opts?: {
        maxHtmlChars?: number;
        maxInteractiveElements?: number;
        maxTextChars?: number;
      },
      connectionId?: string,
      timeoutMs?: number,
    ): Promise<TabhrExtractPageData> {
      const data = await command<{ page: TabhrExtractPageData }>(
        "extractPage",
        {
          maxHtmlChars: opts?.maxHtmlChars,
          maxInteractiveElements: opts?.maxInteractiveElements,
          maxTextChars: opts?.maxTextChars,
        },
        { connectionId, timeoutMs: timeoutMs ?? 15_000 },
      );
      if (!data?.page) {
        throw new Error("TabHR extractPage returned no page data");
      }
      return data.page;
    },

    async runScript(
      script: string,
      opts?: { world?: "MAIN" | "ISOLATED" },
      connectionId?: string,
      timeoutMs?: number,
    ): Promise<TabhrRunScriptResult> {
      return await command<TabhrRunScriptResult>(
        "runScript",
        { script, world: opts?.world ?? "MAIN" },
        { connectionId, timeoutMs: timeoutMs ?? 15_000 },
      );
    },

    async navigate(
      url: string,
      connectionId?: string,
      timeoutMs?: number,
    ): Promise<TabhrConnectionMeta> {
      return await command<TabhrConnectionMeta>("navigate", { url }, { connectionId, timeoutMs });
    },

    async back(connectionId?: string, timeoutMs?: number): Promise<TabhrConnectionMeta> {
      return await command<TabhrConnectionMeta>("back", {}, { connectionId, timeoutMs });
    },

    async forward(connectionId?: string, timeoutMs?: number): Promise<TabhrConnectionMeta> {
      return await command<TabhrConnectionMeta>("forward", {}, { connectionId, timeoutMs });
    },

    async reload(connectionId?: string, timeoutMs?: number): Promise<TabhrConnectionMeta> {
      return await command<TabhrConnectionMeta>("reload", {}, { connectionId, timeoutMs });
    },

    async click(
      x = 0,
      y = 0,
      connectionId?: string,
      timeoutMs?: number,
    ): Promise<{ ack: boolean; command: string }> {
      return await command("click", { x, y }, { connectionId, timeoutMs });
    },

    async type(
      text: string,
      connectionId?: string,
      timeoutMs?: number,
    ): Promise<{ ack: boolean; command: string }> {
      return await command("type", { text }, { connectionId, timeoutMs });
    },

    async keypress(
      key: string,
      connectionId?: string,
      timeoutMs?: number,
    ): Promise<{ ack: boolean; command: string }> {
      return await command("keypress", { key }, { connectionId, timeoutMs });
    },

    async scroll(
      deltaX = 0,
      deltaY = 0,
      connectionId?: string,
      timeoutMs?: number,
    ): Promise<{ ack: boolean; command: string }> {
      return await command("scroll", { deltaX, deltaY }, { connectionId, timeoutMs });
    },

    async resize(
      width: number,
      height: number,
      connectionId?: string,
      timeoutMs?: number,
    ): Promise<{ ack: boolean; command: string }> {
      return await command("resize", { width, height }, { connectionId, timeoutMs });
    },

    /** Returns { data: "data:image/jpeg;base64,..." } */
    async screenshot(connectionId?: string, timeoutMs?: number): Promise<{ data: string }> {
      return await command<{ data: string }>("screenshot", {}, { connectionId, timeoutMs });
    },

    /** Legacy alias for runScript with expression wrapping on the extension side. */
    async evaluate(
      expression: string,
      opts?: { script?: string; world?: "MAIN" | "ISOLATED" },
      connectionId?: string,
      timeoutMs?: number,
    ): Promise<TabhrRunScriptResult> {
      const params =
        opts?.script != null
          ? { script: opts.script, world: opts?.world ?? "MAIN" }
          : { expression, world: opts?.world ?? "MAIN" };
      return await command<TabhrRunScriptResult>("evaluate", params, { connectionId, timeoutMs });
    },
  };
}

export type TabhrClient = ReturnType<typeof createTabhrClient>;

/** @deprecated Use connection UUID from GET /status as targetId. */
export const TABHR_TARGET_ID = "tabhr";

/** Returns true if the TabHR gateway at baseUrl responds to GET /status. */
export async function isTabhrReachable(baseUrl: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const status = await getGatewayStatus(baseUrl, timeoutMs);
    return status.running;
  } catch {
    return false;
  }
}
