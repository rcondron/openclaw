/**
 * The decision model and the text helper, ported from browser-use/jev-ultrafast
 * (MIT, © 2026 Browser Use): `jev_ultrafast/model.py`.
 *
 * The shape is theirs and it is the reason the thing works. One request carries
 * the observed state and several questions: which operation to perform, and —
 * one head per operation — which element that operation would act on. Only the
 * head belonging to the chosen operation is read, so the heads that were not
 * chosen cannot cause an action.
 *
 * An answer is always a key from a table this side built. It never becomes a
 * selector, a coordinate or a line of script.
 *
 * Two deliberate differences from the original:
 *  - the endpoint is Venice rather than TypeSafe direct, because that is the
 *    account we have;
 *  - Venice requires each `criteria` value to be a string, so the per-element
 *    descriptions are serialised. Same content, same keys, one JSON.stringify.
 */
import { NEXT_ACTION, TARGET, TEXT_VALUE } from "./questions.js";
import type { PageState, SnapshotAction } from "./snapshot.js";

/**
 * Where the decision comes from.
 *
 * Two models answer the same request body. Jev is hosted and costs a network
 * round trip — 400ms to a second. laya-browser is 322M parameters on whatever
 * GPU is to hand and answers in under 20ms, because it ships a `systemone`
 * method that speaks jev's own protocol. Nothing else in the loop can tell them
 * apart.
 *
 * Set LAYA_URL to use the local one; without it, Venice.
 */
const LAYA_URL = () => process.env.LAYA_URL?.trim().replace(/\/$/, "") || null;

export const usingLocalDecisionModel = () => LAYA_URL() !== null;

const DECISIONS_URL = () => {
  const laya = LAYA_URL();
  if (laya) return `${laya}/decisions`;
  return (
    (process.env.VENICE_BASE_URL?.trim() || "https://api.venice.ai/api/v1").replace(/\/$/, "") +
    "/decisions"
  );
};
const JEV_MODEL = () => (LAYA_URL() ? "laya-browser" : process.env.JEV_MODEL?.trim() || "jev-latest");

const TEXT_BASE = () =>
  (process.env.FAST_TASK_TEXT_BASE_URL?.trim() ||
    process.env.MORDIEM_BASE_URL?.trim() ||
    "https://api.mordiem.com/api/v1").replace(/\/$/, "");
const TEXT_MODEL = () => process.env.FAST_TASK_TEXT_MODEL?.trim() || "qwen3-5-35b-a3b";

export class ModelError extends Error {}

/** Retries the two statuses worth retrying, then gives up rather than guessing. */
async function postJson(url: string, key: string, body: unknown): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25_000),
      });
    } catch {
      throw new ModelError("Model connection failed; no action executed.");
    }
    if ([429, 529, 503].includes(response.status) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    if (!response.ok) {
      throw new ModelError(
        `Model provider returned HTTP ${response.status}; no action executed.`,
      );
    }
    return await response.json();
  }
  throw new ModelError("Model unavailable");
}

interface ChoiceAnswer {
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

/**
 * Refuses an answer that is not a well-formed distribution over the offered
 * keys. A malformed reply must not become a click.
 */
function validateChoice(answer: any, ids: Record<string, unknown>): ChoiceAnswer {
  let valid = false;
  try {
    const probabilities = answer.probabilities as Record<string, number>;
    const numbers = [...Object.values(probabilities), answer.confidence];
    const total = Object.values(probabilities).reduce((a, b) => a + b, 0);
    valid =
      answer.choice in ids &&
      Object.keys(probabilities).length === Object.keys(ids).length &&
      Object.keys(probabilities).every((key) => key in ids) &&
      numbers.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1) &&
      Math.abs(total - 1) < 0.02 &&
      probabilities[answer.choice] >= Math.max(...Object.values(probabilities)) - 1e-6;
  } catch {
    valid = false;
  }
  if (!valid) throw new ModelError("Invalid decision response; no action executed.");
  return answer as ChoiceAnswer;
}

export interface ElementView {
  index: string;
  label: string;
  operations: string[];
  role?: string;
  value?: string;
  checked?: string;
  selected?: string;
  expanded?: string;
  options?: { index: string; label: string; value: string }[];
}

const OPERATION_OF_KIND: Record<string, string> = {
  click: "CLICK",
  fill: "TYPE_TEXT",
  select: "SELECT",
};

/** One index per observed element; each operation has its own valid target choices. */
export function actionSpace(actions: SnapshotAction[]): {
  elements: ElementView[];
  targets: Record<string, Record<string, SnapshotAction>>;
  controls: Record<string, SnapshotAction>;
} {
  const elements: ElementView[] = [];
  const indices = new Map<number, string>();
  const targets: Record<string, Record<string, SnapshotAction>> = {};
  const controls: Record<string, SnapshotAction> = {};

  for (const action of actions) {
    const operation = OPERATION_OF_KIND[action.kind];
    if (!operation) {
      controls[action.id.toUpperCase()] = action;
      continue;
    }
    const node = action.node as number;
    if (!indices.has(node)) {
      const index = String(elements.length + 1);
      indices.set(node, index);
      const view: ElementView = {
        index,
        label: action.label.split(" → ")[0],
        operations: [],
      };
      for (const key of ["role", "value", "checked", "selected", "expanded"] as const) {
        if (action[key] !== undefined) (view as any)[key] = action[key];
      }
      if (action.kind === "select") {
        view.value = action.current_value ?? "";
        view.options = [];
      }
      elements.push(view);
    }
    const index = indices.get(node)!;
    const element = elements[Number(index) - 1];
    if (!element.operations.includes(operation)) element.operations.push(operation);

    let target = index;
    if (action.kind === "select") {
      target = `${index}:${(element.options?.length ?? 0) + 1}`;
      element.options?.push({ index: target, label: action.label, value: action.value ?? "" });
    }
    (targets[operation] ??= {})[target] = action;
  }
  return { elements, targets, controls };
}

export interface HistoryEntry {
  action?: string;
  kind?: string;
  text?: string | null;
  page_changed?: boolean | null;
}

export interface Decision {
  choice: string;
  operation: string;
  target: string | null;
  confidence: number;
  probabilities: Record<string, number>;
  latencyMs: number;
}

const OPERATION_LABELS: Record<string, string> = {
  CLICK: "Click an element, button, menu option, autocomplete suggestion, or calendar day.",
  TYPE_TEXT:
    "Enter or replace text in an editable field. A small LLM will supply the value from the goal.",
  SELECT: "Select an observed dropdown value.",
};

export async function choose(
  state: PageState,
  goal: string,
  history: HistoryEntry[],
  apiKey: string,
): Promise<Decision> {
  const { elements, targets, controls } = actionSpace(state.actions);

  const operations: Record<string, string> = {};
  for (const key of Object.keys(targets)) operations[key] = OPERATION_LABELS[key];
  for (const [key, value] of Object.entries(controls)) operations[key] = value.label;
  operations.DONE = "Every requirement is visibly satisfied.";
  operations.BLOCKED = "No supported operation can progress.";

  const questions: Record<string, unknown> = {
    operation: {
      type: "choice",
      criteria: operations,
      instructions: { goal, rules: NEXT_ACTION },
    },
  };
  for (const [operation, candidates] of Object.entries(targets)) {
    const criteria: Record<string, string> = {};
    for (const [index, a] of Object.entries(candidates)) {
      const described: Record<string, unknown> = {
        element: `[${index}] ${a.label}`,
        current_value: a.current_value ?? a.value ?? "",
      };
      for (const key of ["role", "checked", "selected", "expanded"] as const) {
        if (a[key] !== undefined) described[key] = a[key];
      }
      // Venice takes criteria values as strings; the content is unchanged.
      criteria[index] = JSON.stringify(described);
    }
    questions[`${operation.toLowerCase()}_target`] = {
      type: "choice",
      criteria,
      instructions: { goal, operation, rules: [NEXT_ACTION, TARGET] },
    };
  }

  const body = {
    model: JEV_MODEL(),
    state: {
      page: { url: state.url, title: state.title, text: state.text },
      elements,
      recent_actions: history.slice(-10).map((h) => ({
        action: h.action,
        kind: h.kind,
        text: h.text,
        page_changed: h.page_changed,
      })),
    },
    questions,
  };

  const started = Date.now();
  const result = await postJson(DECISIONS_URL(), apiKey, body);
  const operationAnswer = validateChoice(result?.answers?.operation ?? {}, operations);
  const operation = operationAnswer.choice;

  let target: string | null = null;
  let choice = operation;
  let probabilities: Record<string, number> = {};

  if (operation in targets) {
    // Unused target heads cannot cause an action. Validate the head the operation selected.
    const targetAnswer = validateChoice(
      result?.answers?.[`${operation.toLowerCase()}_target`] ?? {},
      targets[operation],
    );
    target = targetAnswer.choice;
    choice = targets[operation][target].id;
    for (const [index, a] of Object.entries(targets[operation])) {
      probabilities[a.id] = targetAnswer.probabilities[index];
    }
  } else if (operation in controls) {
    choice = controls[operation].id;
    probabilities[choice] = operationAnswer.probabilities[operation];
  } else {
    probabilities[choice] = operationAnswer.probabilities[operation];
  }

  return {
    choice,
    operation,
    target,
    confidence: operationAnswer.confidence,
    probabilities,
    latencyMs: Date.now() - started,
  };
}

export function fieldContext(
  goal: string,
  action: SnapshotAction,
  page: PageState,
  history: HistoryEntry[],
): unknown {
  return {
    goal,
    field: { label: action.label, role: action.role, value: action.value },
    page: { title: page.title, text: page.text.slice(0, 6000) },
    recent_actions: history.slice(-6).map((h) => ({ action: h.action, text: h.text })),
  };
}

/**
 * The only call that writes anything, and only when the operation is TYPE_TEXT.
 *
 * It must answer with `{"text": "..."}` and nothing else. A reply that is not
 * that is rejected rather than typed — a model narrating its reasoning into a
 * search box is worse than a field left empty.
 */
export async function fieldText(
  context: unknown,
  apiKey: string,
): Promise<{ text: string; model: string; latencyMs: number }> {
  const started = Date.now();
  const result = await postJson(`${TEXT_BASE()}/chat/completions`, apiKey, {
    model: TEXT_MODEL(),
    max_tokens: 1024,
    response_format: { type: "json_object" },
    temperature: 0,
    venice_parameters: { disable_thinking: true, strip_thinking_response: true },
    messages: [
      { role: "system", content: TEXT_VALUE },
      { role: "user", content: JSON.stringify(context) },
    ],
  });

  let value: unknown;
  try {
    const output = JSON.parse(result?.choices?.[0]?.message?.content ?? "");
    const keys = Object.keys(output);
    value = output.text;
    if (keys.length !== 1 || keys[0] !== "text") throw new Error();
    if (typeof value !== "string" || !value.trim() || value.length > 2000) throw new Error();
  } catch {
    throw new ModelError("Text helper returned no valid field value; nothing typed.");
  }
  return { text: value as string, model: TEXT_MODEL(), latencyMs: Date.now() - started };
}
