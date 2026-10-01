/**
 * The loop, ported from browser-use/jev-ultrafast (MIT, © 2026 Browser Use):
 * `jev_ultrafast/agent.py`.
 *
 * Observe the page, ask once what to do and to what, do that one thing, observe
 * again. Their tick/predict/act steps are one function here because nothing in
 * this setting drives the loop from outside.
 *
 * Their stopping rules are kept as they are, and they matter more than they
 * look: a decision is consumed before anything is executed so a retry cannot
 * click twice, freshness is rechecked after text generation because writing
 * takes long enough for the page to move, and three consecutive actions that
 * change nothing end the run instead of grinding through the step budget.
 */
import { Browser, StalePage } from "./browser.js";
import { choose, fieldContext, fieldText, ModelError, type HistoryEntry } from "./model.js";
import { MAX_STEPS } from "./questions.js";
import type { PageState, SnapshotAction } from "./snapshot.js";

export type Outcome = "done" | "blocked" | "error";

export interface Step {
  step: number;
  action: string;
  kind: string;
  operation: string;
  text: string | null;
  confidence: number;
  decisionMs: number;
  textMs: number;
  pageChanged: boolean | null;
  url: string;
}

export interface LoopResult {
  outcome: Outcome;
  reason: string;
  steps: Step[];
  finalUrl: string;
  totalMs: number;
}

const log = (message: string) => console.log(`[fast-task] ${message}`);

/** Longest repeating pattern worth looking for: next/previous is two, a tab dance three or four. */
const MAX_CYCLE_LENGTH = 6;

/**
 * Finds a cycle the run has fallen into, if there is one.
 *
 * Withdrawing a single repeated action was not enough: the model simply found a
 * pair. One run alternated next month, previous month, next month, previous
 * month — each choice different from the one before it, each one undoing it, and
 * the page changing every time so nothing looked stuck.
 *
 * So look at the shape of the sequence rather than at single actions. The last
 * 2L (or 3L for a single action, since choosing the same thing twice can be
 * legitimate) choices repeating the same L actions is a loop, however sensible
 * each individual choice looked. The whole cycle is withdrawn: leaving any part
 * of it offered invites the model straight back in.
 */
function findCycle(sequence: string[]): string[] | null {
  for (let length = 1; length <= MAX_CYCLE_LENGTH; length++) {
    const repeats = length === 1 ? 3 : 2;
    const needed = length * repeats;
    if (sequence.length < needed) continue;
    const tail = sequence.slice(-needed);
    const pattern = tail.slice(0, length);
    let looping = true;
    for (let i = length; i < tail.length && looping; i++) {
      if (tail[i] !== pattern[i % length]) looping = false;
    }
    if (looping) return [...new Set(pattern)];
  }
  return null;
}

export async function runFastBrowserTask(opts: {
  cdpUrl: string;
  goal: string;
  startUrl?: string;
  veniceApiKey: string;
  textApiKey: string;
  maxSteps?: number;
}): Promise<LoopResult> {
  const startedAt = Date.now();
  const limit = Math.min(opts.maxSteps ?? MAX_STEPS, MAX_STEPS);
  const steps: Step[] = [];
  const history: HistoryEntry[] = [];
  let browser: Browser | null = null;
  let finalUrl = "";
  /**
   * Consecutive decisions thrown away because the page moved under them.
   *
   * A page that changes on its own — Google's, minting and discarding inputs for
   * autocomplete — can fail the freshness check every single time. Nothing
   * executes, so the step counter never advances and the step budget never
   * trips: one run sat on "step 3" for minutes, spending a decision every half
   * second. A page that will not hold still long enough to act on is a page to
   * hand over, not to keep asking about.
   */
  let staleInARow = 0;
  const MAX_STALE_IN_A_ROW = 6;

  /**
   * Options withdrawn because choosing them achieved nothing.
   *
   * The model is asked the same question every round, so an action that does not
   * move the task along gets chosen again, and again: one run clicked Google
   * Calendar's "Month" button sixty times at 0.86 confidence until the step
   * budget ended it. The guard against this was "three actions in a row that
   * changed nothing", and it never fired, because Calendar rewrites its DOM on
   * every click — the page always looked different even though nothing had
   * happened.
   *
   * So repetition is judged by what was chosen rather than by what the page did.
   * Three times in a row and the option is withdrawn for the rest of the run; the
   * model has to find another way or say it is blocked.
   */
  const suppressed = new Set<string>();
  /** Every action chosen this run, in order, so a cycle in them can be seen. */
  const chosen: string[] = [];

  const finish = (outcome: Outcome, reason: string): LoopResult => {
    log(
      `${outcome} after ${steps.length} step(s) in ${Date.now() - startedAt}ms — ${reason}` +
        (finalUrl ? ` (${finalUrl})` : ""),
    );
    return { outcome, reason, steps, finalUrl, totalMs: Date.now() - startedAt };
  };

  try {
    log(`start — goal="${opts.goal}"${opts.startUrl ? ` from ${opts.startUrl}` : ""}`);
    browser = await Browser.open(opts.cdpUrl, opts.startUrl);
    let page: PageState = await browser.observe();
    finalUrl = page.url;

    // Survives a stale retry, so an interrupted decision does not pay for the
    // text again with the same context.
    let pendingText: null | { key: string; text: string; model: string; ms: number } = null;

    while (true) {
      if (history.length >= limit) {
        return finish("blocked", `stopped at the ${limit}-action budget`);
      }

      if (!(await browser.fresh(page))) {
        page = await browser.observe();
        finalUrl = page.url;
      }

      if (staleInARow >= MAX_STALE_IN_A_ROW) {
        return finish(
          "blocked",
          `the page changed under ${staleInARow} decisions in a row; it will not hold still long enough to act on`,
        );
      }

      let decision;
      try {
        decision = await choose(page, opts.goal, history, opts.veniceApiKey, suppressed);
      } catch (err) {
        if (err instanceof StalePage) {
          page = await browser.observe();
          continue;
        }
        throw err;
      }

      log(
        `step ${history.length + 1}: ${decision.operation}` +
          (decision.target ? ` -> [${decision.target}]` : "") +
          ` (decide ${decision.latencyMs}ms, confidence ${decision.confidence.toFixed(2)})`,
      );

      if (decision.choice !== "DONE" && decision.choice !== "BLOCKED") {
        chosen.push(decision.choice);
        const cycle = findCycle(chosen);
        if (cycle) {
          const naming = (id: string) =>
            `"${String(page.actions.find((a) => a.id === id)?.label ?? id).slice(0, 36)}"`;
          log(`withdrawing ${cycle.map(naming).join(" -> ")} — going round in circles`);
          for (const id of cycle) suppressed.add(id);
          chosen.length = 0;
          const left = page.actions.filter((a) => !suppressed.has(a.id));
          if (left.length === 0) {
            return finish("blocked", "every option on this page has been tried without progress");
          }
          continue;
        }
      }

      if (decision.choice === "DONE" || decision.choice === "BLOCKED") {
        if (!(await browser.fresh(page))) {
          staleInARow += 1;
          page = await browser.observe();
          continue;
        }
        return decision.choice === "DONE"
          ? finish("done", "every requirement is visibly satisfied")
          : finish("blocked", "no supported operation can make progress here");
      }

      const action = page.actions.find((a) => a.id === decision.choice) as SnapshotAction | undefined;
      if (!action) {
        page = await browser.observe();
        continue;
      }

      let text: string | null = null;
      let textMs = 0;
      try {
        if (action.kind === "fill") {
          if (!(await browser.fresh(page))) {
            page = await browser.observe();
            continue;
          }
          const context = fieldContext(opts.goal, action, page, history);
          const key = JSON.stringify(context);
          if (pendingText !== null && pendingText.key === key) {
            text = pendingText.text;
            textMs = pendingText.ms;
          } else {
            const written = await fieldText(context, opts.textApiKey);
            text = written.text;
            textMs = written.latencyMs;
            pendingText = { key, text: written.text, model: written.model, ms: written.latencyMs };
          }
        }

        // act() rechecks freshness immediately before input, including after
        // text generation.
        await browser.act(action, page, text ?? undefined);
        pendingText = null;
      } catch (err) {
        if (err instanceof StalePage) {
          staleInARow += 1;
          log(
            `step ${history.length + 1}: page moved, observing again (${staleInARow}/${MAX_STALE_IN_A_ROW})`,
          );
          page = await browser.observe();
          finalUrl = page.url;
          continue;
        }
        if (err instanceof ModelError) return finish("blocked", err.message);
        throw err;
      }

      // Record execution before observing: a stale observation must not erase
      // an action that really happened.
      const entry: HistoryEntry & Step = {
        step: history.length + 1,
        action: action.label,
        kind: action.kind,
        operation: decision.operation,
        text,
        confidence: decision.confidence,
        decisionMs: decision.latencyMs,
        textMs,
        pageChanged: null,
        page_changed: null,
        url: page.url,
      };
      staleInARow = 0;
      history.push(entry);
      steps.push(entry);

      const before = page.fingerprint;
      page = await browser.observe();
      finalUrl = page.url;
      entry.pageChanged = page.fingerprint !== before;
      entry.page_changed = entry.pageChanged;
      entry.url = page.url;

      // Three actions in a row that changed nothing is not progress.
      const recent = steps.slice(-3);
      if (recent.length === 3 && recent.every((h) => h.pageChanged === false && h.kind !== "wait")) {
        return finish("blocked", "three actions in a row changed nothing on the page");
      }
    }
  } catch (err) {
    return finish("error", err instanceof Error ? err.message : String(err));
  } finally {
    browser?.close();
  }
}
