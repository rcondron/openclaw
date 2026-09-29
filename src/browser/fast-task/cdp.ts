/**
 * A small CDP client for the fast loop.
 *
 * It talks to the same browser the employee's agent uses, through the same
 * bridge, so the fast loop and the agent are always looking at one page rather
 * than two. Only the handful of commands the loop needs are here; anything
 * richer belongs to the agent's own browser tool.
 *
 * Input goes through the Input domain rather than synthetic DOM events. Real
 * events are what a site's framework listens for: a dispatched MouseEvent is
 * flagged untrusted and React ignores it, and setting .value directly does not
 * register with a controlled input at all.
 */
import WebSocket from "ws";

const CALL_TIMEOUT_MS = 15_000;
/**
 * Input is dispatched against whatever the page is doing at that moment, so a
 * click landing as a navigation starts can simply never be acknowledged. Fail
 * it quickly and let the loop look again rather than stalling the whole task.
 */
const INPUT_TIMEOUT_MS = 8_000;

interface Pending {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class BrowserSession {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private sessionId: string | null = null;

  private constructor(private readonly url: string) {}

  static async open(url: string): Promise<BrowserSession> {
    const session = new BrowserSession(url);
    await session.connect();
    await session.attachToPage();
    return session;
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const failed = (err: Error) => reject(err);
      ws.once("open", () => {
        ws.off("error", failed);
        resolve();
      });
      ws.once("error", failed);
      ws.on("message", (raw) => this.onMessage(raw.toString()));
      ws.on("close", () => {
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error("browser connection closed"));
        }
        this.pending.clear();
      });
    });
  }

  private onMessage(raw: string): void {
    let msg: { id?: number; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg.id !== "number") return; // events are not used by the loop
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error.message || "CDP error"));
    else p.resolve(msg.result);
  }

  private call<T = any>(method: string, params: object = {}, useSession = true): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("browser not connected"));
    }
    const id = this.nextId++;
    const timeoutMs = method.startsWith("Input.") ? INPUT_TIMEOUT_MS : CALL_TIMEOUT_MS;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(useSession && this.sessionId ? { sessionId: this.sessionId } : {}),
        })
      );
    });
  }

  /** Attaches to the page the person would be looking at, or opens one. */
  private async attachToPage(): Promise<void> {
    const { targetInfos } = await this.call<{ targetInfos: any[] }>(
      "Target.getTargets",
      {},
      false
    );
    let page = targetInfos.find((t) => t.type === "page" && !t.url.startsWith("devtools://"));
    if (!page) {
      const { targetId } = await this.call<{ targetId: string }>(
        "Target.createTarget",
        { url: "about:blank" },
        false
      );
      const info = await this.call<{ targetInfo: any }>("Target.getTargetInfo", { targetId }, false);
      page = info.targetInfo;
    }
    const { sessionId } = await this.call<{ sessionId: string }>(
      "Target.attachToTarget",
      { targetId: page.targetId, flatten: true },
      false
    );
    this.sessionId = sessionId;
    await this.call("Page.enable").catch(() => {});
    await this.call("Runtime.enable").catch(() => {});
  }

  /** Evaluates an expression and returns its value. */
  async evaluate<T = unknown>(expression: string): Promise<T> {
    const res = await this.call<{ result: { value?: T }; exceptionDetails?: any }>(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true }
    );
    if (res.exceptionDetails) {
      // `text` is usually just "Uncaught"; the description is the actual error.
      const detail =
        res.exceptionDetails.exception?.description ||
        res.exceptionDetails.exception?.value ||
        res.exceptionDetails.text ||
        "evaluate failed";
      throw new Error(String(detail).split("\n")[0]);
    }
    return res.result?.value as T;
  }

  async navigate(url: string): Promise<void> {
    await this.call("Page.navigate", { url });
  }

  async click(x: number, y: number): Promise<void> {
    const base = { x, y, button: "left", clickCount: 1 };
    await this.call("Input.dispatchMouseEvent", { ...base, type: "mousePressed" });
    await this.call("Input.dispatchMouseEvent", { ...base, type: "mouseReleased" });
  }

  /**
   * Types into whatever has focus. Click the field first: focus is what decides
   * where the text lands, not the coordinates.
   */
  async type(text: string): Promise<void> {
    await this.call("Input.insertText", { text });
  }

  async pressKey(key: string, code: string, keyCode: number): Promise<void> {
    await this.call("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode });
    await this.call("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
  }

  async clearFocusedField(): Promise<void> {
    // Select all, then type over it: the field may already hold a draft.
    await this.call("Input.dispatchKeyEvent", {
      type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2,
    });
    await this.call("Input.dispatchKeyEvent", {
      type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2,
    });
  }

  async scrollBy(dy: number): Promise<void> {
    await this.call("Input.dispatchMouseEvent", {
      type: "mouseWheel", x: 10, y: 10, deltaX: 0, deltaY: dy,
    });
  }

  close(): void {
    try {
      this.ws?.close();
    } catch {
      /* already gone */
    }
  }
}
