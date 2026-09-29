/**
 * The fast browser loop.
 *
 * Look at the page as a numbered list, ask one question, do one thing, repeat.
 * No screenshots, one decision call per step, and a writing model only when
 * something actually has to be typed.
 *
 * It is deliberately narrow. When it cannot see a way forward it stops and says
 * so, and the caller falls back to the employee's ordinary browser tool, which
 * is slower but can reason its way around the unexpected. Being quick is only
 * worth having if giving up is cheap.
 */
import { SNAPSHOT_JS, renderState, type Control, type PageSnapshot } from "./snapshot.js";
import { decide, type Operation } from "./jev.js";
import { writeFieldText } from "./text.js";
import { BrowserSession } from "./cdp.js";

const MAX_STEPS = () => Number(process.env.FAST_BROWSER_MAX_STEPS || 25);
/** A dropdown needs longer to paint than a keystroke does. */
const SETTLE_AFTER_CLICK_MS = 200;
const SETTLE_AFTER_TYPE_MS = 50;
const WAIT_MS = 1_000;
/** Below this the model is guessing, and a guess is worth less than a handover. */
const MIN_CONFIDENCE = () => Number(process.env.FAST_BROWSER_MIN_CONFIDENCE || 0.35);

export type Outcome = "done" | "blocked" | "exhausted" | "error";

export interface Step {
  n: number;
  operation: Operation;
  target: string | null;
  text?: string;
  note: string;
  decisionMs: number;
  textMs?: number;
  totalMs: number;
}

export interface LoopResult {
  outcome: Outcome;
  reason: string;
  steps: Step[];
  finalUrl: string;
  totalMs: number;
}

export async function runFastBrowserTask(opts: {
  cdpUrl: string;
  goal: string;
  startUrl?: string;
  veniceApiKey: string;
  mordiemApiKey: string;
  maxSteps?: number;
}): Promise<LoopResult> {
  const startedAt = Date.now();
  const steps: Step[] = [];
  const history: string[] = [];
  const limit = opts.maxSteps ?? MAX_STEPS();

  let session: BrowserSession | null = null;
  let finalUrl = "";
  /**
   * A step can fail because the page moved, not because the task is impossible:
   * a click dispatched as a navigation begins is never acknowledged. One of
   * those is noise. Three in a row means the loop is not in control of this
   * page and should hand over.
   */
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;

  const finish = (outcome: Outcome, reason: string): LoopResult => ({
    outcome,
    reason,
    steps,
    finalUrl,
    totalMs: Date.now() - startedAt,
  });

  try {
    session = await BrowserSession.open(opts.cdpUrl);
    if (opts.startUrl) {
      await session.navigate(opts.startUrl);
      await sleep(1_500);
    }

    for (let n = 1; n <= limit; n++) {
      const stepStarted = Date.now();
      const snap = await readPage(session);
      finalUrl = snap.url;

      const allowed = allowedOperations(snap);
      const decision = await decide({
        state: renderState(snap, opts.goal, history),
        controls: snap.controls,
        allowed,
        apiKey: opts.veniceApiKey,
      });

      if (decision.operation === "DONE") {
        steps.push(step(n, decision, null, "reported the goal complete", stepStarted));
        return finish("done", "the loop reported the goal complete");
      }
      if (decision.operation === "BLOCKED") {
        steps.push(step(n, decision, null, "reported it cannot proceed", stepStarted));
        return finish("blocked", "the loop cannot proceed on this page");
      }

      // A page-level operation needs no control; everything else does.
      const needsTarget = decision.operation !== "SCROLL" && decision.operation !== "WAIT";
      const control =
        decision.target !== null ? snap.controls.find((c) => c.i === decision.target) : undefined;

      if (needsTarget && !control) {
        return finish("blocked", `chose ${decision.operation} but named no control on the page`);
      }
      if (needsTarget && decision.targetConfidence < MIN_CONFIDENCE()) {
        return finish(
          "blocked",
          `not confident which control to use (${decision.targetConfidence.toFixed(2)})`
        );
      }

      try {
      switch (decision.operation) {
        case "CLICK": {
          if (!(await stillThere(session, control!))) {
            return finish("blocked", "the page changed under the decision; handing over");
          }
          await session.click(control!.x, control!.y);
          await sleep(SETTLE_AFTER_CLICK_MS);
          history.push(`Clicked ${describe(control!)}.`);
          steps.push(step(n, decision, control!, `clicked ${describe(control!)}`, stepStarted));
          break;
        }

        case "TYPE_TEXT": {
          if (!(await stillThere(session, control!))) {
            return finish("blocked", "the page changed under the decision; handing over");
          }
          const written = await writeFieldText({
            goal: opts.goal,
            fieldName: control!.name,
            fieldRole: control!.role,
            pageTitle: snap.title,
            pageText: snap.text,
            history,
            apiKey: opts.mordiemApiKey,
          });
          if (!written.text) {
            return finish("blocked", `nothing to type into "${control!.name}"`);
          }
          // Focus first: Input.insertText goes wherever the caret is.
          await session.click(control!.x, control!.y);
          await sleep(SETTLE_AFTER_TYPE_MS);
          if (control!.value) await session.clearFocusedField();
          await session.type(written.text);
          await sleep(SETTLE_AFTER_TYPE_MS);
          history.push(`Typed "${written.text}" into ${describe(control!)}.`);
          steps.push({
            ...step(n, decision, control!, `typed into ${describe(control!)}`, stepStarted),
            text: written.text,
            textMs: written.ms,
          });
          break;
        }

        case "SELECT": {
          await session.click(control!.x, control!.y);
          await sleep(SETTLE_AFTER_CLICK_MS);
          history.push(`Opened ${describe(control!)}.`);
          steps.push({
            ...step(n, decision, control!, `opened ${describe(control!)}`, stepStarted),
          });
          break;
        }

        case "SCROLL": {
          await session.scrollBy(Math.round(snap.viewportHeight * 0.8));
          await sleep(SETTLE_AFTER_CLICK_MS);
          history.push("Scrolled down.");
          steps.push(step(n, decision, null, "scrolled down", stepStarted));
          break;
        }

        case "WAIT": {
          await sleep(WAIT_MS);
          history.push("Waited for the page.");
          steps.push(step(n, decision, null, "waited", stepStarted));
          break;
        }
      }
      consecutiveFailures = 0;
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        consecutiveFailures += 1;
        steps.push(step(n, decision, control ?? null, `failed: ${why}`, stepStarted));
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          return finish("blocked", `three steps in a row failed; last was "${why}"`);
        }
        // Let whatever the page is doing finish before looking again.
        await sleep(1_000);
      }
    }

    return finish("exhausted", `stopped after ${limit} steps without finishing`);
  } catch (err) {
    return finish("error", err instanceof Error ? err.message : String(err));
  } finally {
    session?.close();
  }
}

/**
 * Reads the page, retrying briefly.
 *
 * A click that starts a navigation destroys the context the next read would run
 * in, so the first attempt after acting routinely fails. That is the page
 * working, not the loop breaking: wait for the new document and ask again.
 */
async function readPage(session: BrowserSession, attempts = 3): Promise<PageSnapshot> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const raw = await session.evaluate<string>(SNAPSHOT_JS);
      if (raw) return JSON.parse(raw) as PageSnapshot;
      lastErr = new Error("the page returned no snapshot");
    } catch (err) {
      lastErr = err;
    }
    await sleep(600);
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Offers only what this page supports. An operation that was never offered
 * cannot be chosen, which is cheaper than validating it afterwards.
 */
function allowedOperations(snap: PageSnapshot): Operation[] {
  const ops: Operation[] = ["CLICK", "DONE", "BLOCKED", "WAIT"];
  if (snap.controls.some(isTextField)) ops.push("TYPE_TEXT");
  if (snap.controls.some((c) => c.tag === "select" || c.role.includes("combobox"))) ops.push("SELECT");
  if (snap.scrollY + snap.viewportHeight < snap.scrollHeight - 20) ops.push("SCROLL");
  return ops;
}

const isTextField = (c: Control) =>
  c.tag === "textarea" ||
  c.role.includes("textbox") ||
  c.role.includes("searchbox") ||
  /^input:(text|email|search|tel|url|password|number)$/.test(c.role);

/**
 * Confirms the control is still the one that was chosen, and still where it
 * was. A decision is made against a snapshot; by the time it is acted on the
 * page may have moved, and clicking the old coordinates would hit whatever
 * slid into that spot.
 */
async function stillThere(session: BrowserSession, control: Control): Promise<boolean> {
  try {
    const snap = await readPage(session, 1);
    const now = snap.controls.find((c) => c.i === control.i);
    if (!now) return false;
    if (now.sig !== control.sig) return false;
    // Allow a few pixels of drift; anything more is a different layout.
    return Math.abs(now.x - control.x) <= 6 && Math.abs(now.y - control.y) <= 6;
  } catch {
    return false;
  }
}

const describe = (c: Control) => `${c.role} "${c.name}"`;

function step(
  n: number,
  decision: { operation: Operation; decisionMs?: number; ms: number },
  control: Control | null,
  note: string,
  startedAt: number
): Step {
  return {
    n,
    operation: decision.operation,
    target: control ? describe(control) : null,
    note,
    decisionMs: decision.ms,
    totalMs: Date.now() - startedAt,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
