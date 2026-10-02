/**
 * Hand a whole web task to Browser Use's hosted agent.
 *
 * Nothing here drives a browser. TabHR starts a run on Browser Use's
 * `bu-ultrafast` — their own build of the jev loop, which is a good deal more
 * robust than the port next door in fast-task/ — and this waits for the answer.
 * The Browser Use key stays on the TabHR host, the same way the Browserless
 * token does; the container only ever gets to ask.
 *
 * The run loads the employee's own browser profile, so it is signed in to
 * whatever they are signed in to.
 */

/** Long enough for a real task, short enough that a stuck run does not hang the agent. */
const DEFAULT_DEADLINE_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 3_000;

export type UltrafastOutcome =
  | { done: true; result: string; costUsd?: number | null }
  /** The agent should carry on with the step-by-step actions instead. */
  | { done: false; fallback: true };

const FALLBACK: UltrafastOutcome = { done: false, fallback: true };

function tabhrBaseUrl(): string | null {
  return process.env.TABHR_API_BASE_URL?.trim().replace(/\/+$/, "") || null;
}

function gatewayToken(): string | null {
  return process.env.OPENCLAW_GATEWAY_TOKEN?.trim() || null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runHostedBrowserTask(opts: {
  agentId: string;
  goal: string;
  startUrl?: string;
  deadlineMs?: number;
}): Promise<UltrafastOutcome> {
  const base = tabhrBaseUrl();
  const token = gatewayToken();
  if (!base || !token) {
    console.log(
      "[bu-ultrafast] cannot run: TABHR_API_BASE_URL and OPENCLAW_GATEWAY_TOKEN must both be set in this container",
    );
    return FALLBACK;
  }
  if (!opts.agentId) {
    console.log("[bu-ultrafast] cannot run: this agent has no id to run as");
    return FALLBACK;
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  let runId: string;
  try {
    const res = await fetch(`${base}/api/agent/browser-run`, {
      method: "POST",
      headers,
      body: JSON.stringify({ agentId: opts.agentId, task: opts.goal, startUrl: opts.startUrl }),
      signal: AbortSignal.timeout(90_000),
    });
    const text = await res.text();
    if (!res.ok) {
      console.log(`[bu-ultrafast] could not start a run: ${res.status} ${text.slice(0, 200)}`);
      return FALLBACK;
    }
    runId = (JSON.parse(text) as { runId: string }).runId;
    console.log(`[bu-ultrafast] run ${runId} started`);
  } catch (err) {
    console.log(`[bu-ultrafast] could not reach TabHR: ${(err as Error).message}`);
    return FALLBACK;
  }

  const deadline = Date.now() + (opts.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const statusUrl =
    `${base}/api/agent/browser-run/${encodeURIComponent(runId)}` +
    `?agentId=${encodeURIComponent(opts.agentId)}`;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let state: {
      done?: boolean;
      status?: string;
      result?: string | null;
      error?: string | null;
      costUsd?: number | null;
    };
    try {
      const res = await fetch(statusUrl, { headers, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        // A blip while the run is still going is not a reason to give up on it.
        console.log(`[bu-ultrafast] poll returned ${res.status}`);
        continue;
      }
      state = await res.json();
    } catch (err) {
      console.log(`[bu-ultrafast] poll failed: ${(err as Error).message}`);
      continue;
    }

    if (!state.done) continue;

    if (state.status === "completed" && state.result) {
      console.log(`[bu-ultrafast] run ${runId} completed (cost $${state.costUsd ?? "?"})`);
      return { done: true, result: state.result, costUsd: state.costUsd };
    }

    // Finished without an answer: failed, stopped, or completed saying nothing.
    // Why is ours to read in the log, not the agent's to narrate.
    console.log(
      `[bu-ultrafast] run ${runId} ended as ${state.status}: ${state.error ?? "no result"}`,
    );
    return FALLBACK;
  }

  console.log(`[bu-ultrafast] run ${runId} outlasted the deadline; cancelling`);
  await fetch(statusUrl, { method: "DELETE", headers, signal: AbortSignal.timeout(30_000) }).catch(
    () => {},
  );
  return FALLBACK;
}
