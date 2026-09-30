/**
 * Observing and acting, ported from browser-use/jev-ultrafast (MIT, © 2026
 * Browser Use): `jev_ultrafast/browser.py`.
 *
 * Two things here are the whole reason the original holds up on real pages.
 *
 * Freshness is per-element, not geometric. For a click or a select it compares
 * the page key plus that element's guard against what was recorded when the
 * decision was made. Nothing compares old coordinates to new ones, because a
 * page that merely reflowed has not invalidated the decision.
 *
 * Coordinates are resolved at the moment of input. The element is found again
 * through the identity map, re-checked for being connected, enabled, visible,
 * on screen and not covered, and only then is its current centre clicked.
 *
 * This talks CDP over the browser bridge rather than through a local harness,
 * which is the one structural difference from the original.
 */
import WebSocket from "ws";
import { MARKER_JS, SNAPSHOT_JS, fingerprint, type PageState, type SnapshotAction } from "./snapshot.js";

const CALL_TIMEOUT_MS = 20_000;

export class StalePage extends Error {}

interface Pending {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class Browser {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private sessionId: string | null = null;
  private afterInput: SnapshotAction | null = null;
  /** Page targets seen so far, so a tab that opens mid-task can be spotted. */
  private knownPages = new Set<string>();
  private currentTargetId: string | null = null;

  private constructor(private readonly url: string) {}

  /** Attaches to the browser and, when given a url, waits for it to finish loading. */
  static async open(cdpWsUrl: string, startUrl?: string): Promise<Browser> {
    const browser = new Browser(cdpWsUrl);
    await browser.connect();
    await browser.attach();
    if (startUrl) {
      await browser.call("Page.navigate", { url: startUrl });
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const ready = await browser.evaluate<string>("document.readyState").catch(() => null);
        if (ready === "complete") break;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    return browser;
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
    if (typeof msg.id !== "number") return;
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
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(useSession && this.sessionId ? { sessionId: this.sessionId } : {}),
        }),
      );
    });
  }

  /** Works in the page the person would be looking at, or opens one. */
  private async attach(): Promise<void> {
    const { targetInfos } = await this.call<{ targetInfos: any[] }>("Target.getTargets", {}, false);
    let page = targetInfos.find((t) => t.type === "page" && !String(t.url).startsWith("devtools://"));
    if (!page) {
      const { targetId } = await this.call<{ targetId: string }>(
        "Target.createTarget",
        { url: "about:blank" },
        false,
      );
      page = (
        await this.call<{ targetInfo: any }>("Target.getTargetInfo", { targetId }, false)
      ).targetInfo;
    }
    for (const t of targetInfos) {
      if (t.type === "page") this.knownPages.add(t.targetId);
    }
    await this.attachToPage(page.targetId);
  }

  /** Points this session at one page target. */
  private async attachToPage(targetId: string): Promise<void> {
    const { sessionId } = await this.call<{ sessionId: string }>(
      "Target.attachToTarget",
      { targetId, flatten: true },
      false,
    );
    this.sessionId = sessionId;
    this.currentTargetId = targetId;
    this.knownPages.add(targetId);
    await this.call("Page.enable").catch(() => {});
    await this.call("Runtime.enable").catch(() => {});
    await this.call("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  }

  /**
   * Moves to a tab that opened since the last look, the way a person's attention
   * would.
   *
   * A link with target="_blank" — a Sign in button, most login flows — does its
   * work in a new tab. Watching only the tab we started in, that click looks
   * like it achieved nothing: the page is unchanged, so the same click gets
   * chosen again, and each one opens another tab. Google's calendar page
   * produced four identical sign-in tabs that way, and the login form was in
   * every one of them, never in the page being read.
   *
   * Also covers our own tab being closed under us, which is the same problem
   * seen from the other side.
   */
  private async followNewestTab(): Promise<void> {
    let pages: { targetId: string; url: string }[];
    try {
      const { targetInfos } = await this.call<{ targetInfos: any[] }>("Target.getTargets", {}, false);
      pages = targetInfos.filter(
        (t) => t.type === "page" && !String(t.url).startsWith("devtools://"),
      );
    } catch {
      return; // the browser will be reported unreachable by the caller
    }
    if (pages.length === 0) return;

    const opened = pages.filter((p) => !this.knownPages.has(p.targetId));
    for (const p of pages) this.knownPages.add(p.targetId);

    const stillThere = pages.some((p) => p.targetId === this.currentTargetId);
    // A tab that just opened wins; otherwise only move if ours has gone.
    const pick = opened.length ? opened[opened.length - 1] : stillThere ? null : pages[pages.length - 1];
    if (!pick || pick.targetId === this.currentTargetId) return;

    console.log(
      `[fast-task] following ${opened.length ? "a newly opened tab" : "the remaining tab"}: ${pick.url.slice(0, 80)}`,
    );
    await this.attachToPage(pick.targetId);
  }

  private async evaluate<T = unknown>(expression: string, awaitPromise = false): Promise<T> {
    const res = await this.call<{ result?: { value?: T }; exceptionDetails?: unknown }>(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise },
    );
    if (res.exceptionDetails) throw new StalePage("Document changed during evaluation");
    return res.result?.value as T;
  }

  /**
   * Reads the page. Retries: an evaluation that lands mid-navigation throws, and
   * that is the page working rather than the loop breaking.
   */
  async observe(): Promise<PageState> {
    await this.followNewestTab();
    if (this.afterInput) {
      const action = this.afterInput;
      this.afterInput = null;
      // Read-only, and already logged as executed: a navigation interrupting it
      // must not look like a failed action.
      await this.call("Runtime.evaluate", {
        expression:
          `(action => new Promise(resolve => {
            const field=window.__jevFast?.nodes.get(action.node);
            const autocomplete=action.kind==='fill' && field?.getAttribute('role')==='combobox';
            let frames=0, stopped=false;
            const finish=()=>{stopped=true;resolve()};
            setTimeout(finish,autocomplete ? 200 : 50);
            const ready=()=>{
              if (stopped) return;
              const ids=(field?.getAttribute('aria-controls')||field?.getAttribute('aria-owns')||'')
                .split(/\\s+/).filter(Boolean);
              const roots=ids.length ? ids.map(id=>document.getElementById(id)).filter(Boolean) : [document];
              const options=roots.flatMap(root=>[...root.querySelectorAll('[role="option"]')]);
              if (++frames>=2 && (!autocomplete || options.some(e=>{
                const r=e.getBoundingClientRect();
                return r.width && r.height && r.bottom>0 && r.top<innerHeight &&
                  e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
              }))) finish();
              else requestAnimationFrame(ready);
            };
            requestAnimationFrame(ready);
          }))(` + JSON.stringify(action) + ")",
        awaitPromise: true,
        returnByValue: true,
      }).catch(() => {});
    }

    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const state = await this.evaluate<PageState | null>(SNAPSHOT_JS);
        if (state === null) throw new StalePage("Document is navigating");
        state.fingerprint = fingerprint(state);
        return state;
      } catch (err) {
        if (attempt === 9) throw err;
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    throw new StalePage("Page did not settle");
  }

  /**
   * Whether a decision still refers to the page it was made from.
   *
   * For a click or a select, the element's own guard is what matters: identity,
   * role, name, value and surrounding text. For anything else the page-wide
   * marker is enough.
   */
  async fresh(page: PageState, action?: SnapshotAction): Promise<boolean> {
    if (action && (action.kind === "click" || action.kind === "select")) {
      const node = action.node;
      if (typeof node !== "number") return false;
      const current = await this.evaluate<unknown>(
        `(() => { const c=window.__jevFast; return c ? [c.pageKey(),c.guard(c.nodes.get(${node}))] : null; })()`,
      ).catch(() => null);
      return (
        JSON.stringify(current) === JSON.stringify([page.page_key, page.guards[String(node)]])
      );
    }
    const marker = await this.evaluate<unknown>(MARKER_JS).catch(() => null);
    return JSON.stringify(marker) === JSON.stringify(page.marker);
  }

  /** Performs one observed action, re-checking the page immediately beforehand. */
  async act(action: SnapshotAction, page: PageState, text?: string): Promise<void> {
    if (!(await this.fresh(page, action))) {
      throw new StalePage("Page changed since this decision. Observe again.");
    }
    if (action.kind === "wait") {
      await new Promise((r) => setTimeout(r, 100));
      this.afterInput = null;
      return;
    }
    if (action.kind === "scroll") {
      await this.call("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: 550,
        y: 650,
        deltaX: 0,
        deltaY: action.delta ?? 0,
      });
      this.afterInput = action;
      return;
    }
    if (typeof action.node !== "number") throw new Error("Invalid observed node");

    // Code-owned node ids refer to actual observed elements, never model-generated selectors.
    const target = await this.evaluate<{ x: number; y: number } | null>(
      `(action => {
        const e=window.__jevFast?.nodes.get(action.node);
        if (!e?.isConnected || e.matches(':disabled') || e.closest('[aria-disabled="true"],[inert]') ||
            !e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) return null;
        if (action.kind==='fill' && (e.readOnly || e.getAttribute('aria-readonly')==='true')) return null;
        const r=e.getBoundingClientRect(), x=r.x+r.width/2, y=r.y+r.height/2;
        if (!r.width || !r.height || x<0 || y<0 || x>=innerWidth || y>=innerHeight) return null;
        if (!e.contains(document.elementFromPoint(x,y))) return null;
        if (action.kind==='select') {
          if (e.tagName!=='SELECT' || ![...e.options].some(o=>o.value===action.value &&
              !o.disabled && !o.closest('optgroup[disabled]'))) return null;
          e.value=action.value;
          e.dispatchEvent(new Event('input',{bubbles:true}));
          e.dispatchEvent(new Event('change',{bubbles:true}));
        }
        return {x,y};
      })(` + JSON.stringify(action) + ")",
    );

    if (target === null) {
      if (action.kind === "select") {
        throw new Error("Dropdown execution was not confirmed; inspect before retrying.");
      }
      throw new StalePage("Target changed or is covered. Observe again.");
    }

    if (action.kind !== "select") {
      for (const type of ["mousePressed", "mouseReleased"]) {
        await this.call("Input.dispatchMouseEvent", {
          type,
          x: target.x,
          y: target.y,
          button: "left",
          clickCount: 1,
        });
      }
      if (action.kind === "fill") {
        await this.call("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "a",
          code: "KeyA",
          modifiers: 2,
          commands: ["selectAll"],
        });
        await this.call("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "a",
          code: "KeyA",
          modifiers: 2,
        });
        await this.call("Input.insertText", { text: text ?? "" });
      }
    }
    this.afterInput = action;
  }

  close(): void {
    try {
      this.ws?.close();
    } catch {
      /* already gone */
    }
  }
}
