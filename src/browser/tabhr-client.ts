/**
 * TabHR browser extension API client (port 9220).
 * Uses JSON envelope format: { requestId, endpoint, ...params }; response: { success, data?, error?, requestId }.
 * Not CDP; no debugging mode.
 */

let requestIdCounter = 0;

function nextRequestId(): string {
  requestIdCounter += 1;
  return `tabhr-${requestIdCounter}`;
}

export type TabhrEnvelopeRequest = {
  requestId?: string | number;
  endpoint: string;
  [k: string]: unknown;
};

export type TabhrEnvelopeResponse =
  | { success: true; data: unknown; requestId?: string | number }
  | { success: false; error: string; requestId?: string | number };

const DEFAULT_TIMEOUT_MS = 8000;

async function fetchTabhr(
  baseUrl: string,
  envelope: TabhrEnvelopeRequest,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<TabhrEnvelopeResponse> {
  const requestId = envelope.requestId ?? nextRequestId();
  const body = { ...envelope, requestId };
  const url = baseUrl.replace(/\/$/, "");
  const ctrl = new AbortController();
  const t = setTimeout(ctrl.abort.bind(ctrl), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`TabHR HTTP ${res.status}`);
    }
    const json = (await res.json()) as TabhrEnvelopeResponse;
    return json;
  } finally {
    clearTimeout(t);
  }
}

async function sendCommand<T = unknown>(
  baseUrl: string,
  endpoint: string,
  params: Record<string, unknown> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const resp = await fetchTabhr(baseUrl, { endpoint, ...params }, timeoutMs);
  if (!resp.success) {
    throw new Error(resp.error ?? "TabHR command failed");
  }
  return resp.data as T;
}

export type TabhrStatusData = { url?: string; title?: string };

export function createTabhrClient(baseUrl: string) {
  return {
    /** Check extension is reachable and get current page url/title. */
    async status(timeoutMs?: number): Promise<TabhrStatusData> {
      return sendCommand<TabhrStatusData>(baseUrl, "status", {}, timeoutMs);
    },

    async navigate(url: string, timeoutMs?: number): Promise<TabhrStatusData> {
      return sendCommand<TabhrStatusData>(baseUrl, "navigate", { url }, timeoutMs);
    },

    async back(timeoutMs?: number): Promise<TabhrStatusData> {
      return sendCommand<TabhrStatusData>(baseUrl, "back", {}, timeoutMs);
    },

    async forward(timeoutMs?: number): Promise<TabhrStatusData> {
      return sendCommand<TabhrStatusData>(baseUrl, "forward", {}, timeoutMs);
    },

    async reload(timeoutMs?: number): Promise<TabhrStatusData> {
      return sendCommand<TabhrStatusData>(baseUrl, "reload", {}, timeoutMs);
    },

    async click(x = 0, y = 0, timeoutMs?: number): Promise<{ ack: boolean; command: string }> {
      return sendCommand(baseUrl, "click", { x, y }, timeoutMs);
    },

    async type(text: string, timeoutMs?: number): Promise<{ ack: boolean; command: string }> {
      return sendCommand(baseUrl, "type", { text }, timeoutMs);
    },

    async keypress(key: string, timeoutMs?: number): Promise<{ ack: boolean; command: string }> {
      return sendCommand(baseUrl, "keypress", { key }, timeoutMs);
    },

    async scroll(
      deltaX = 0,
      deltaY = 0,
      timeoutMs?: number,
    ): Promise<{ ack: boolean; command: string }> {
      return sendCommand(baseUrl, "scroll", { deltaX, deltaY }, timeoutMs);
    },

    async resize(
      width: number,
      height: number,
      timeoutMs?: number,
    ): Promise<{ ack: boolean; command: string }> {
      return sendCommand(baseUrl, "resize", { width, height }, timeoutMs);
    },

    /** Returns { data: "data:image/jpeg;base64,..." } */
    async screenshot(timeoutMs?: number): Promise<{ data: string }> {
      return sendCommand<{ data: string }>(baseUrl, "screenshot", {}, timeoutMs);
    },

    /** Returns { result: <value> }. Use expression or script. */
    async evaluate(
      expression: string,
      opts?: { script?: string },
      timeoutMs?: number,
    ): Promise<{ result: unknown }> {
      const params = opts?.script != null ? { script: opts.script } : { expression };
      return sendCommand<{ result: unknown }>(baseUrl, "evaluate", params, timeoutMs);
    },
  };
}

export type TabhrClient = ReturnType<typeof createTabhrClient>;

/** Single logical tab id for TabHR (extension has one page). */
export const TABHR_TARGET_ID = "tabhr";

/** Returns true if the TabHR extension at baseUrl responds to the status command. */
export async function isTabhrReachable(baseUrl: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const client = createTabhrClient(baseUrl);
    await client.status(timeoutMs);
    return true;
  } catch {
    return false;
  }
}
