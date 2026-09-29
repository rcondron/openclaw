/**
 * The only place a language model writes anything.
 *
 * Most steps in a browser task are navigation — click this, scroll that — and
 * none of them need prose. A model is called only when the decision was
 * TYPE_TEXT, and it is asked for the field's contents and nothing else. That
 * keeps the expensive call off the critical path of every other step.
 *
 * This one does go through Mordiem, like every other chat model here.
 */

const BASE = () => process.env.MORDIEM_BASE_URL?.trim() || "https://api.mordiem.com/api/v1";
/**
 * Mercury is faster but has been seen narrating its reasoning straight into the
 * field ("laser cuttingThe user wants to fill in..."), ignoring the
 * thinking-off flag. Qwen respects it, and a field filled correctly at 1.5s
 * beats one filled wrongly at 1.2s.
 */
const MODEL = () => process.env.FAST_BROWSER_TEXT_MODEL?.trim() || "qwen3-5-35b-a3b";
const TIMEOUT_MS = () => Number(process.env.FAST_BROWSER_TEXT_TIMEOUT_MS || 15_000);

export interface TextRequest {
  goal: string;
  fieldName: string;
  fieldRole: string;
  pageTitle: string;
  pageText: string;
  history: string[];
  apiKey: string;
}

/** Returns exactly what to type, with nothing around it. */
export async function writeFieldText(req: TextRequest): Promise<{ text: string; ms: number }> {
  const started = Date.now();

  const prompt = [
    `You are filling in one field on a web page. Reply with the field's contents and nothing else: no quotes, no explanation, no label.`,
    "",
    `TASK: ${req.goal}`,
    `PAGE: ${req.pageTitle}`,
    `FIELD: ${req.fieldRole} "${req.fieldName}"`,
    req.history.length ? `ALREADY DONE:\n${req.history.slice(-6).join("\n")}` : "",
    "",
    `PAGE TEXT (for context):`,
    req.pageText.slice(0, 1200),
  ]
    .filter(Boolean)
    .join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS());
  let res: Response;
  try {
    res = await fetch(`${BASE()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${req.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL(),
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0,
        // Thinking is dead weight for "what goes in this box", and every
        // model here defaults to it unless told otherwise.
        venice_parameters: { disable_thinking: true, strip_thinking_response: true },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`text model ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = json.choices?.[0]?.message?.content ?? "";
  const text = clean(raw);

  return { text: looksLikeReasoning(text) ? salvage(text) : text, ms: Date.now() - started };
}

/**
 * Some models narrate before answering, whatever the prompt and the
 * thinking-off flag say, and the narration arrives with no separator: the field
 * would get "laser cuttingThe user wants to fill in a field...laser cutting".
 * Cheaper to notice than to police with a second request.
 */
const REASONING_TELLS =
  /\b(the user wants|we need to|the task|the field should|likely the|so we|i should|let'?s)\b/i;

function looksLikeReasoning(text: string): boolean {
  return text.length > 120 && REASONING_TELLS.test(text);
}

/**
 * Pulls the answer out of narration. A model that thinks out loud puts the
 * value last, so the tail after the final sentence break is the best guess —
 * and if there is nothing plausible there, better to return nothing and let the
 * caller hand over than to type an essay into a search box.
 */
function salvage(text: string): string {
  const tail = text.split(/(?<=[.!?])\s*/).pop()?.trim() ?? "";
  if (tail && tail.length <= 120 && !REASONING_TELLS.test(tail)) return tail;
  return "";
}

/**
 * Models like to wrap an answer in a code fence or quotes however firmly they
 * are told not to. What reaches the page is the bare value.
 */
function clean(raw: string): string {
  let text = raw.trim();
  const fence = /^```[a-z]*\n([\s\S]*?)\n?```$/i.exec(text);
  if (fence) text = fence[1].trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1);
  }
  return text.trim();
}
