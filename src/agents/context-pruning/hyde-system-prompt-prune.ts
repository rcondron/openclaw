/**
 * HyDE-based system-prompt relevance pruning (the "A3" approach).
 *
 * OpenClaw sends the FULL system prompt on every message. Most of it (tool
 * definitions, situational policies) is irrelevant to any single message, so it
 * burns context-window tokens on the expensive main model. This module scores
 * the system prompt against the current message and drops the parts the agent
 * does not need for this turn.
 *
 * Pipeline (ported from the `llm-context-approaches` A3 experiment):
 *   1. Split the system prompt into semantic UNITS (a bullet / header / block).
 *   2. Tier each unit CORE (identity, safety, style, tool protocol, headers) or
 *      OPTIONAL. CORE is ALWAYS kept and never scored.
 *   3. HyDE — ask a cheap LLM to write "what an assistant would need to know" to
 *      handle the latest message. This document-register text surfaces the right
 *      units even when the raw message is thin (e.g. "ping").
 *   4. Precision — a single cheap-LLM judge reads the HyDE text + framing +
 *      recent history + the latest message together with the numbered OPTIONAL
 *      units and returns which units are actually needed, ordered by importance.
 *   5. Assemble CORE + kept OPTIONAL (original order) up to a token budget.
 *
 * The original experiment used a local bi-encoder for recall and a local
 * cross-encoder for precision. This port folds both into a single LLM judge
 * (system prompts are only a few thousand tokens, so every OPTIONAL unit fits in
 * one judge call) which reads prompt and unit jointly — the same property that
 * made the cross-encoder better than cosine — and is served by Mordiem so no new
 * ML dependency is needed. HyDE remains the defining ingredient: it is fed to the
 * judge to expand thin prompts.
 *
 * Everything here is FAIL-SAFE: any error, timeout, or unparseable model reply
 * returns the ORIGINAL system prompt unchanged. Pruning must never break a run.
 */

export const MORDIEM_DEFAULT_BASE_URL = "https://api.mordiem.com/api/v1";
/**
 * Default model for HyDE generation and the relevance judge. gpt-4o-mini via
 * Mordiem is fast (~2s), cheap, and returns clean JSON — the right profile for a
 * per-message hook. Heavy reasoning models (e.g. glm-5-2) are far too slow here.
 */
export const HYDE_DEFAULT_MODEL = "openai-gpt-4o-mini-2024-07-18";

/** Sections whose units are CORE (always kept, never pruned). */
export const DEFAULT_CORE_SECTION_KEYWORDS = [
  "safety",
  "tool call style",
  "style",
  "communication",
  "identity",
  "persona",
  "output",
  "tooling",
];

/**
 * Fixed framing that orients the judge toward "what an agent needs". Mirrors the
 * FRAMING constant from the A3 experiment.
 */
const FRAMING =
  "What does an assistant with access to a computer and tools need to know from " +
  "its instructions to correctly handle this request?";

export type SystemPromptUnit = {
  /** Verbatim text of the unit as it appeared in the prompt. */
  text: string;
  /** Section header this unit falls under. */
  section: string;
  /** CORE units are always kept; OPTIONAL units are candidates for pruning. */
  tier: "CORE" | "OPTIONAL";
  /** True when the unit is a markdown header line. */
  isHeader: boolean;
};

export type HydePruneOptions = {
  /** Mordiem API key (required). */
  apiKey: string;
  /** OpenAI-compatible base URL. Default: {@link MORDIEM_DEFAULT_BASE_URL}. */
  baseUrl?: string;
  /** Model used for the HyDE generation. Default: {@link HYDE_DEFAULT_MODEL}. */
  hydeModel?: string;
  /** Model used for the relevance judge. Default: same as {@link hydeModel}. */
  judgeModel?: string;
  /** Skip pruning when there are fewer OPTIONAL units than this. Default: 8. */
  minOptionalUnits?: number;
  /** Token budget for kept OPTIONAL units (CORE is always kept on top). Default: 1200. */
  maxOptionalTokens?: number;
  /** Max tokens for the HyDE completion. Default: 512. */
  hydeMaxTokens?: number;
  /** Max tokens for the judge completion. Default: 700. */
  judgeMaxTokens?: number;
  /** Per-request network timeout in ms. Default: 30000. */
  timeoutMs?: number;
  /** Override the CORE section keyword list. */
  coreSectionKeywords?: string[];
  /** Injected fetch (for testing). Default: global fetch. */
  fetchImpl?: typeof fetch;
  /** Optional logger for progress/diagnostics. */
  logger?: (message: string) => void;
};

export type HydePruneStats = {
  totalUnits: number;
  coreUnits: number;
  optionalUnits: number;
  keptOptional: number;
  droppedOptional: number;
  originalChars: number;
  prunedChars: number;
  estOriginalTokens: number;
  estPrunedTokens: number;
  hydeModel: string;
  judgeModel: string;
  elapsedMs: number;
  /** Set when pruning was skipped or fell back to the original prompt. */
  skippedReason?: string;
};

export type HydePruneResult = {
  /** The system prompt to actually send (pruned, or original on fallback). */
  prunedPrompt: string;
  /** True only when the prompt was actually shortened. */
  changed: boolean;
  /** The generated HyDE "what's needed" text, when available. */
  hyde?: string;
  stats: HydePruneStats;
};

function estTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Split a system prompt into semantic units. A markdown header (`#`) or a
 * bullet (`- `) is its own unit; runs of plain lines between them group into a
 * single unit. Units are then tiered CORE vs OPTIONAL. Ported from `unit_chunks`
 * in the A3 experiment, with headers forced to CORE so structure is preserved
 * and never orphaned.
 */
export function parseSystemPromptUnits(
  system: string,
  coreKeywords: string[] = DEFAULT_CORE_SECTION_KEYWORDS,
): SystemPromptUnit[] {
  const units: Array<Omit<SystemPromptUnit, "tier">> = [];
  let section = "(preamble)";
  let buf: string[] = [];

  const flush = () => {
    const text = buf.join(" ").trim();
    if (text) {
      units.push({ text, section, isHeader: false });
    }
    buf = [];
  };

  for (const raw of system.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      flush();
      section = trimmed.replace(/^#+/, "").trim() || section;
      units.push({ text: trimmed, section, isHeader: true });
    } else if (trimmed.startsWith("- ")) {
      flush();
      units.push({ text: trimmed, section, isHeader: false });
    } else {
      buf.push(trimmed);
    }
  }
  flush();

  const keywords = coreKeywords.map((k) => k.toLowerCase());
  return units.map((u) => {
    const sect = u.section.toLowerCase();
    const isPreamble = u.section === "(preamble)";
    // The identity preamble and any section whose name matches a CORE keyword is
    // CORE; everything else is OPTIONAL. Header tier follows its section (an
    // OPTIONAL section's header is prunable), matching the A3 experiment.
    const isCore = isPreamble || keywords.some((k) => sect.includes(k));
    return { ...u, tier: isCore ? "CORE" : "OPTIONAL" };
  });
}

/** Strip ```` ```json ```` fences and pull the first JSON object out of a reply. */
function extractJsonObject(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

type MordiemMessage = { role: "system" | "user"; content: string };

async function mordiemChat(
  messages: MordiemMessage[],
  opts: {
    apiKey: string;
    baseUrl: string;
    model: string;
    maxTokens: number;
    timeoutMs: number;
    fetchImpl: typeof fetch;
  },
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await opts.fetchImpl(`${opts.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        messages,
        max_tokens: opts.maxTokens,
        temperature: 0.3,
        // Don't inject the upstream provider's own system rules.
        venice_parameters: { include_venice_system_prompt: false },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`mordiem HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
    };
    const msg = data.choices?.[0]?.message;
    // Reasoning models put output in reasoning_content when content is empty.
    return (msg?.content || msg?.reasoning_content || "").trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * HyDE generator: ask the LLM to describe, in document register, what the
 * assistant needs from its instructions to handle the latest message.
 */
async function generateHypothetical(
  userMessage: string,
  historyText: string,
  opts: {
    apiKey: string;
    baseUrl: string;
    model: string;
    maxTokens: number;
    timeoutMs: number;
    fetchImpl: typeof fetch;
  },
): Promise<string> {
  const system =
    "You help an AI assistant figure out what context it needs. Given a " +
    "conversation and the latest message, write 2-3 sentences describing the " +
    "specific tools, capabilities, and rules the assistant would need from its " +
    "system instructions to handle the request well. Be concrete — name tool " +
    "types, action types, and relevant constraints. Do not answer the user's " +
    "message; only describe what the assistant needs to know.";
  const user = `Conversation so far:\n${historyText || "(none)"}\n\nLatest message: ${userMessage}`;
  return mordiemChat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    opts,
  );
}

/**
 * Precision judge: given the HyDE hint, framing, history and message, decide
 * which OPTIONAL units are needed. Returns kept indices ordered by importance.
 */
async function judgeOptionalUnits(
  optionalUnits: SystemPromptUnit[],
  ctx: {
    userMessage: string;
    historyText: string;
    hyde: string;
  },
  opts: {
    apiKey: string;
    baseUrl: string;
    model: string;
    maxTokens: number;
    timeoutMs: number;
    fetchImpl: typeof fetch;
  },
): Promise<number[]> {
  const catalogue = optionalUnits
    .map((u, i) => {
      const label = `${u.section}: ${u.text}`.replace(/\s+/g, " ").trim();
      return `[${i}] ${label.slice(0, 320)}`;
    })
    .join("\n");

  const system =
    "You decide which of an AI assistant's optional instruction units are " +
    "actually needed to handle the current request. Core identity, safety and " +
    "style rules are handled separately — you only see OPTIONAL units (specific " +
    "tool definitions and situational policies). Most optional units are NOT " +
    "needed for any single message; keep only the ones relevant to the latest " +
    "message and conversation. When a unit might plausibly be needed to act on " +
    "the request (e.g. a tool the assistant would call), keep it. " +
    'Reply with ONLY a JSON object: {"keep":[<indices>]}, listing the indices ' +
    "of units to keep, ordered from most to least important. No prose.";
  const user =
    `${FRAMING}\n\n` +
    `Recent conversation:\n${ctx.historyText || "(none)"}\n\n` +
    `Latest message: ${ctx.userMessage}\n\n` +
    `What the assistant likely needs (hint): ${ctx.hyde || "(none)"}\n\n` +
    `OPTIONAL instruction units:\n${catalogue}`;

  const reply = await mordiemChat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    opts,
  );
  const parsed = extractJsonObject(reply) as { keep?: unknown } | null;
  const keep = parsed?.keep;
  if (!Array.isArray(keep)) {
    throw new Error("judge reply had no `keep` array");
  }
  const seen = new Set<number>();
  const out: number[] = [];
  for (const raw of keep) {
    const idx = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
    if (Number.isInteger(idx) && idx >= 0 && idx < optionalUnits.length && !seen.has(idx)) {
      seen.add(idx);
      out.push(idx);
    }
  }
  return out;
}

function buildStats(args: {
  units: SystemPromptUnit[];
  optionalCount: number;
  keptOptionalCount: number;
  original: string;
  pruned: string;
  hydeModel: string;
  judgeModel: string;
  elapsedMs: number;
  skippedReason?: string;
}): HydePruneStats {
  const coreUnits = args.units.filter((u) => u.tier === "CORE").length;
  return {
    totalUnits: args.units.length,
    coreUnits,
    optionalUnits: args.optionalCount,
    keptOptional: args.keptOptionalCount,
    droppedOptional: args.optionalCount - args.keptOptionalCount,
    originalChars: args.original.length,
    prunedChars: args.pruned.length,
    estOriginalTokens: estTokens(args.original),
    estPrunedTokens: estTokens(args.pruned),
    hydeModel: args.hydeModel,
    judgeModel: args.judgeModel,
    elapsedMs: args.elapsedMs,
    skippedReason: args.skippedReason,
  };
}

/**
 * Prune a system prompt with the HyDE + judge pipeline. Never throws — returns
 * the original prompt (with a `skippedReason`) on any failure.
 */
export async function pruneSystemPromptWithHyde(input: {
  systemPrompt: string;
  userMessage: string;
  historyText?: string;
  options: HydePruneOptions;
  now?: () => number;
}): Promise<HydePruneResult> {
  const { systemPrompt, userMessage, options } = input;
  const historyText = input.historyText ?? "";
  const now = input.now ?? (() => Date.now());
  const started = now();

  const baseUrl = options.baseUrl ?? MORDIEM_DEFAULT_BASE_URL;
  const hydeModel = options.hydeModel ?? HYDE_DEFAULT_MODEL;
  const judgeModel = options.judgeModel ?? hydeModel;
  const minOptionalUnits = options.minOptionalUnits ?? 8;
  const maxOptionalTokens = options.maxOptionalTokens ?? 1200;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.logger ?? (() => {});

  const units = parseSystemPromptUnits(systemPrompt, options.coreSectionKeywords);
  // The judge only decides on OPTIONAL *content* units. Headers are re-added
  // afterwards for any section that keeps content, so nothing is orphaned.
  const optionalContent = units.filter((u) => u.tier === "OPTIONAL" && !u.isHeader);

  const fallback = (skippedReason: string): HydePruneResult => ({
    prunedPrompt: systemPrompt,
    changed: false,
    stats: buildStats({
      units,
      optionalCount: optionalContent.length,
      keptOptionalCount: optionalContent.length,
      original: systemPrompt,
      pruned: systemPrompt,
      hydeModel,
      judgeModel,
      elapsedMs: now() - started,
      skippedReason,
    }),
  });

  if (!options.apiKey) {
    return fallback("no-api-key");
  }
  if (optionalContent.length < minOptionalUnits) {
    return fallback("too-few-optional-units");
  }

  const chatOpts = { apiKey: options.apiKey, baseUrl, timeoutMs, fetchImpl };

  let hyde = "";
  try {
    hyde = await generateHypothetical(userMessage, historyText, {
      ...chatOpts,
      model: hydeModel,
      maxTokens: options.hydeMaxTokens ?? 512,
    });
    log(`[hyde] ${hyde.slice(0, 160)}${hyde.length > 160 ? "…" : ""}`);
  } catch (err) {
    log(`[hyde] generation failed: ${(err as Error).message}`);
    return fallback("hyde-failed");
  }

  let keepOrder: number[];
  try {
    keepOrder = await judgeOptionalUnits(
      optionalContent,
      { userMessage, historyText, hyde },
      { ...chatOpts, model: judgeModel, maxTokens: options.judgeMaxTokens ?? 700 },
    );
  } catch (err) {
    log(`[judge] failed: ${(err as Error).message}`);
    return fallback("judge-failed");
  }

  // Enforce the token budget by walking the judge's importance order.
  const keptIdx = new Set<number>();
  let optTokens = 0;
  for (const idx of keepOrder) {
    const t = estTokens(optionalContent[idx].text);
    if (optTokens + t > maxOptionalTokens && keptIdx.size > 0) {
      continue;
    }
    keptIdx.add(idx);
    optTokens += t;
  }

  // Sections that retain content (CORE or a kept OPTIONAL unit) keep their header.
  const survivingSections = new Set<string>();
  let cursor = 0;
  for (const u of units) {
    if (u.isHeader) {
      continue;
    }
    if (u.tier === "CORE") {
      survivingSections.add(u.section);
    } else {
      if (keptIdx.has(cursor)) {
        survivingSections.add(u.section);
      }
      cursor += 1;
    }
  }

  // Reassemble in original document order: CORE always; OPTIONAL content if the
  // judge kept it; OPTIONAL headers only when their section retains content.
  let optionalCursor = 0;
  const keptLines: string[] = [];
  for (const u of units) {
    if (u.tier === "CORE") {
      keptLines.push(u.text);
    } else if (u.isHeader) {
      if (survivingSections.has(u.section)) {
        keptLines.push(u.text);
      }
    } else {
      if (keptIdx.has(optionalCursor)) {
        keptLines.push(u.text);
      }
      optionalCursor += 1;
    }
  }
  const pruned = keptLines.join("\n").trim();

  // Guard: never emit an empty/degenerate prompt.
  if (!pruned || pruned.length < Math.min(200, systemPrompt.length)) {
    return fallback("degenerate-output");
  }

  const changed = pruned.length < systemPrompt.length;
  return {
    prunedPrompt: changed ? pruned : systemPrompt,
    changed,
    hyde,
    stats: buildStats({
      units,
      optionalCount: optionalContent.length,
      keptOptionalCount: keptIdx.size,
      original: systemPrompt,
      pruned: changed ? pruned : systemPrompt,
      hydeModel,
      judgeModel,
      elapsedMs: now() - started,
      skippedReason: changed ? undefined : "no-reduction",
    }),
  };
}
