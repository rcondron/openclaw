/**
 * The decision model.
 *
 * Jev answers several questions about one piece of state in a single request:
 * here, what to do and which control to do it to. Both answers come back
 * together, so a step costs one round trip rather than a conversation.
 *
 * It lives on Venice directly. Mordiem proxies chat completions only and
 * refuses /decisions ("Path /api/v1/decisions is not available through this
 * proxy"), so this is the one call in the loop that does not go through it.
 *
 * Nothing it returns is executable. An answer is a key from a list this side
 * built — never a selector, a coordinate or a line of script — so a wrong
 * answer is a wrong click, not arbitrary code.
 */

const VENICE_URL = () =>
  (process.env.VENICE_BASE_URL?.trim() || "https://api.venice.ai/api/v1") + "/decisions";
const JEV_MODEL = () => process.env.JEV_MODEL?.trim() || "jev-latest";
const TIMEOUT_MS = () => Number(process.env.JEV_TIMEOUT_MS || 15_000);

export type Operation =
  | "CLICK"
  | "TYPE_TEXT"
  | "SELECT"
  | "SCROLL"
  | "WAIT"
  | "DONE"
  | "BLOCKED";

/** What each operation means, in the words the model is given. */
export const OPERATIONS: Record<Operation, string> = {
  CLICK: "click the chosen control",
  TYPE_TEXT: "type text into the chosen control (it must be a text field)",
  SELECT: "choose an option in the chosen dropdown",
  SCROLL: "scroll further down the page to see more",
  WAIT: "the page is still loading or changing; wait and look again",
  DONE: "the goal has been achieved; nothing further is needed",
  BLOCKED: "the goal cannot be achieved here (a login wall, a captcha, a missing control)",
};

export interface Decision {
  operation: Operation;
  operationConfidence: number;
  /** Index into the snapshot's control list, or null for page-level operations. */
  target: number | null;
  targetConfidence: number;
  ms: number;
}

interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities?: Record<string, number>;
  confidence?: number;
}

/**
 * Asks for the next step.
 *
 * `allowed` narrows the operations offered to the ones that make sense for this
 * page — there is no point offering TYPE_TEXT on a page with no text field, and
 * an option that was never offered cannot be chosen by mistake.
 */
export async function decide(opts: {
  state: string;
  controls: { i: number; role: string; name: string }[];
  allowed: Operation[];
  apiKey: string;
}): Promise<Decision> {
  const started = Date.now();

  const operationCriteria: Record<string, string> = {};
  for (const op of opts.allowed) operationCriteria[op] = OPERATIONS[op];

  const targetCriteria: Record<string, string> = {};
  for (const c of opts.controls) {
    targetCriteria[String(c.i)] = `${c.role} "${c.name}"`.slice(0, 200);
  }
  // A page-level operation still needs somewhere to point.
  targetCriteria.none = "no particular control; the operation is about the whole page";

  const body = {
    model: JEV_MODEL(),
    state: opts.state,
    questions: {
      operation: {
        type: "choice",
        instructions: "What is the single next step towards the goal?",
        criteria: operationCriteria,
      },
      target: {
        type: "choice",
        instructions:
          "Which control should that step act on? Answer 'none' if the step is not about one control.",
        criteria: targetCriteria,
      },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS());
  let res: Response;
  try {
    res = await fetch(VENICE_URL(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`jev ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    answers?: { operation?: ChoiceAnswer; target?: ChoiceAnswer };
  };
  const op = json.answers?.operation;
  const target = json.answers?.target;
  if (!op?.choice) throw new Error("jev returned no operation");

  const operation = (opts.allowed.includes(op.choice as Operation) ? op.choice : "BLOCKED") as Operation;
  const targetIndex =
    target?.choice && target.choice !== "none" && /^\d+$/.test(target.choice)
      ? Number(target.choice)
      : null;

  return {
    operation,
    operationConfidence: op.confidence ?? 0,
    target: targetIndex,
    targetConfidence: target?.confidence ?? 0,
    ms: Date.now() - started,
  };
}
