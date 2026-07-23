import { describe, expect, it, vi } from "vitest";
import { extractMessageAndHistory } from "./apply-hyde-prune.js";
import { parseSystemPromptUnits, pruneSystemPromptWithHyde } from "./hyde-system-prompt-prune.js";

const SAMPLE_PROMPT = [
  "You are a personal assistant running inside OpenClaw.",
  "## Tooling",
  "- read: Read file contents",
  "- write: Create or overwrite files",
  "## Safety",
  "Refuse clearly harmful requests.",
  "## OpenClaw CLI Quick Reference",
  "- openclaw gateway status",
  "- openclaw gateway restart",
  "If unsure, ask the user to run `openclaw help`.",
  "## Skills (mandatory)",
  "- For voice-related tasks (calls, Twilio), use the voice skill.",
  "- For document or PDF analysis, use the document reader.",
  "- For image analysis, use the image skill.",
  "## Workspace",
  "Your working directory is the agent workspace.",
  "Bootstrap files may be injected here.",
  "## Self-Update",
  "Get Updates is ONLY allowed when the user explicitly asks.",
].join("\n");

describe("parseSystemPromptUnits", () => {
  it("tiers preamble/tooling/safety as CORE and other sections as OPTIONAL", () => {
    const units = parseSystemPromptUnits(SAMPLE_PROMPT);
    const preamble = units.find((u) => u.text.startsWith("You are a personal"));
    expect(preamble?.tier).toBe("CORE");

    // Tooling section matches a CORE keyword — tool defs are always kept.
    const readTool = units.find((u) => u.text.startsWith("- read:"));
    expect(readTool?.tier).toBe("CORE");
    expect(readTool?.section).toBe("Tooling");

    // Safety bullet is CORE (section keyword match).
    const safetyLine = units.find((u) => u.text.startsWith("Refuse clearly"));
    expect(safetyLine?.tier).toBe("CORE");

    // Non-core sections and their content are OPTIONAL (prunable).
    const cliBullet = units.find((u) => u.text.startsWith("- openclaw gateway status"));
    expect(cliBullet?.tier).toBe("OPTIONAL");
    const cliHeader = units.find((u) => u.text === "## OpenClaw CLI Quick Reference");
    expect(cliHeader?.tier).toBe("OPTIONAL");
    expect(cliHeader?.isHeader).toBe(true);
  });
});

describe("extractMessageAndHistory", () => {
  it("pulls the latest user message and prior turns from block content", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: [{ type: "text", text: "hi there" }] },
      { role: "user", content: "send a file to the team" },
    ] as never;
    const { userMessage, historyText } = extractMessageAndHistory(messages);
    expect(userMessage).toBe("send a file to the team");
    expect(historyText).toContain("user: hello");
    expect(historyText).toContain("assistant: hi there");
  });
});

/** Build a fake Mordiem OpenAI-compatible fetch returning a fixed content string. */
function fakeFetch(bodyFor: (payload: { model: string; messages: unknown[] }) => string) {
  const fn = vi.fn(async (_url: string, init?: { body?: string }) => {
    const payload = JSON.parse(init?.body ?? "{}");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: bodyFor(payload) } }],
      }),
      text: async () => "",
    } as unknown as Response;
  });
  return fn as unknown as typeof fetch & typeof fn;
}

describe("pruneSystemPromptWithHyde", () => {
  it("keeps CORE + judged OPTIONAL content, re-adds surviving headers, drops the rest", async () => {
    // OPTIONAL content order: [0] CLI status, [1] CLI restart, [2] CLI "If unsure",
    // [3] voice skill, [4] document reader, [5] image skill, [6] Workspace block,
    // [7] Self-Update. Judge keeps only the document reader (index 4).
    const fetchImpl = fakeFetch((payload) => {
      const isJudge = JSON.stringify(payload.messages).includes("OPTIONAL instruction units");
      if (isJudge) {
        return '```json\n{"keep":[4]}\n```';
      }
      return "The assistant needs the document/PDF reader skill.";
    });

    const result = await pruneSystemPromptWithHyde({
      systemPrompt: SAMPLE_PROMPT,
      userMessage: "read this PDF and summarize it",
      historyText: "",
      options: { apiKey: "test", fetchImpl, minOptionalUnits: 4 },
      now: (() => {
        let t = 0;
        return () => (t += 5);
      })(),
    });

    expect(result.changed).toBe(true);
    // CORE always preserved (identity, tool defs, safety)
    expect(result.prunedPrompt).toContain("You are a personal assistant");
    expect(result.prunedPrompt).toContain("## Tooling");
    expect(result.prunedPrompt).toContain("- read: Read file contents");
    expect(result.prunedPrompt).toContain("## Safety");
    // kept optional content + its section header re-added
    expect(result.prunedPrompt).toContain("## Skills (mandatory)");
    expect(result.prunedPrompt).toContain("- For document or PDF analysis");
    // dropped optional content AND their now-empty section headers
    expect(result.prunedPrompt).not.toContain("- For voice-related tasks");
    expect(result.prunedPrompt).not.toContain("## OpenClaw CLI Quick Reference");
    expect(result.prunedPrompt).not.toContain("## Workspace");
    expect(result.prunedPrompt).not.toContain("## Self-Update");
    expect(result.stats.keptOptional).toBe(1);
    expect(result.stats.droppedOptional).toBeGreaterThan(0);
    expect(result.stats.estPrunedTokens).toBeLessThan(result.stats.estOriginalTokens);
  });

  it("falls back to the original prompt when the judge reply is unparseable", async () => {
    const fetchImpl = fakeFetch(() => "not json at all");
    const result = await pruneSystemPromptWithHyde({
      systemPrompt: SAMPLE_PROMPT,
      userMessage: "ping",
      options: { apiKey: "test", fetchImpl, minOptionalUnits: 4 },
    });
    expect(result.changed).toBe(false);
    expect(result.prunedPrompt).toBe(SAMPLE_PROMPT);
    expect(result.stats.skippedReason).toBe("judge-failed");
  });

  it("skips when there are too few OPTIONAL units", async () => {
    const fetchImpl = fakeFetch(() => '{"keep":[]}');
    const result = await pruneSystemPromptWithHyde({
      systemPrompt: "You are an assistant.\n## Tooling\n- read: Read file contents",
      userMessage: "ping",
      options: { apiKey: "test", fetchImpl, minOptionalUnits: 8 },
    });
    expect(result.changed).toBe(false);
    expect(result.stats.skippedReason).toBe("too-few-optional-units");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns original with no-api-key when key is missing", async () => {
    const result = await pruneSystemPromptWithHyde({
      systemPrompt: SAMPLE_PROMPT,
      userMessage: "ping",
      options: { apiKey: "", minOptionalUnits: 4 },
    });
    expect(result.changed).toBe(false);
    expect(result.stats.skippedReason).toBe("no-api-key");
  });
});
