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

      let decision;
      try {
        decision = await choose(page, opts.goal, history, opts.veniceApiKey);
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

      if (decision.choice === "DONE" || decision.choice === "BLOCKED") {
        if (!(await browser.fresh(page))) {
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
          log(`step ${history.length + 1}: page moved, observing again`);
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
