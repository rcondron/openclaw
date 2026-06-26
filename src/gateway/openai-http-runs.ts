import { abortEmbeddedPiRun } from "../agents/pi-embedded.js";

export type OpenAiHttpRunEntry = {
  abortController: AbortController;
  sessionKey: string;
  sessionId: string;
  startedAtMs: number;
};

const activeRuns = new Map<string, OpenAiHttpRunEntry>();

export function registerOpenAiHttpRun(runId: string, entry: OpenAiHttpRunEntry): void {
  activeRuns.set(runId, entry);
}

export function unregisterOpenAiHttpRun(runId: string): void {
  activeRuns.delete(runId);
}

export function getOpenAiHttpRun(runId: string): OpenAiHttpRunEntry | undefined {
  return activeRuns.get(runId);
}

export function abortOpenAiHttpRun(runId: string): { aborted: boolean } {
  const entry = activeRuns.get(runId);
  if (!entry) {
    return { aborted: false };
  }
  entry.abortController.abort();
  if (entry.sessionId) {
    abortEmbeddedPiRun(entry.sessionId);
  }
  activeRuns.delete(runId);
  return { aborted: true };
}

export function abortOpenAiHttpRunsForSessionKey(sessionKey: string): {
  aborted: boolean;
  runIds: string[];
} {
  const runIds: string[] = [];
  for (const [runId, entry] of activeRuns) {
    if (entry.sessionKey !== sessionKey) {
      continue;
    }
    const res = abortOpenAiHttpRun(runId);
    if (res.aborted) {
      runIds.push(runId);
    }
  }
  return { aborted: runIds.length > 0, runIds };
}

export function listOpenAiHttpRunIdsForTests(): string[] {
  return [...activeRuns.keys()];
}

export function clearOpenAiHttpRunsForTests(): void {
  activeRuns.clear();
}
