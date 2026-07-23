/**
 * Demo/eval: run HyDE system-prompt pruning against real request payloads via
 * the Mordiem API and report how much of the system prompt each message needs.
 *
 * Usage:
 *   MORDIEM_API_KEY=... node --import tsx scripts/hyde-prune-demo.ts [payloads.jsonl] [maxRequests]
 *
 * Input is a JSONL log where request lines have `stage: "request"` with
 * `systemPrompt`, `prompt`, and optional `historyMessages`. Defaults to
 * ~/Downloads/llm-payloads.jsonl (the recovered experiment payloads).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pruneSystemPromptWithHyde } from "../src/agents/context-pruning/hyde-system-prompt-prune.js";

const apiKey = process.env.MORDIEM_API_KEY?.trim();
if (!apiKey) {
  console.error("MORDIEM_API_KEY is required. Re-run with MORDIEM_API_KEY=... set.");
  process.exit(1);
}

const inputPath = process.argv[2] ?? join(homedir(), "Downloads", "llm-payloads.jsonl");
const maxRequests = Number.parseInt(process.argv[3] ?? "2", 10);
const outDir = join(homedir(), "Downloads", "llm-context-approaches", "openclaw-hyde");

function blockText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b && typeof b === "object" && (b as { type?: string }).type === "text"
          ? String((b as { text?: string }).text ?? "")
          : "",
      )
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function historyText(history: unknown): string {
  if (!Array.isArray(history)) {
    return "";
  }
  const picked: string[] = [];
  for (const msg of history.slice(-6)) {
    if (!msg || typeof msg !== "object") {
      continue;
    }
    const role = (msg as { role?: string }).role;
    if (role !== "user" && role !== "assistant") {
      continue;
    }
    const txt = blockText((msg as { content?: unknown }).content).trim();
    if (txt) {
      picked.push(`${role}: ${txt}`);
    }
  }
  return picked.join("\n").slice(-1500);
}

const lines = readFileSync(inputPath, "utf-8")
  .split("\n")
  .filter((l) => l.trim());
const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const requests: Array<{ lineNo: number; system: string; prompt: string; history: unknown }> = [];
for (const [lineNo, raw] of lines.entries()) {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw);
  } catch {
    continue;
  }
  if (obj.stage === "request" && obj.systemPrompt) {
    requests.push({
      lineNo,
      system: asString(obj.systemPrompt),
      prompt: asString(obj.prompt),
      history: obj.historyMessages,
    });
  }
  if (requests.length >= maxRequests) {
    break;
  }
}

if (requests.length === 0) {
  console.error(`No request lines found in ${inputPath}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
console.log(`HyDE prune demo · ${requests.length} request(s) from ${inputPath}\n`);

for (const req of requests) {
  const promptPreview = req.prompt.replace(/\s+/g, " ").slice(0, 70);
  console.log(
    `── line ${req.lineNo} · prompt: "${promptPreview}${req.prompt.length > 70 ? "…" : ""}"`,
  );
  const result = await pruneSystemPromptWithHyde({
    systemPrompt: req.system,
    userMessage: req.prompt || "(empty)",
    historyText: historyText(req.history),
    options: {
      apiKey,
      baseUrl: process.env.MORDIEM_BASE_URL,
      hydeModel: process.env.OPENCLAW_HYDE_MODEL,
      minOptionalUnits: 4,
      logger: (m) => console.log(`    ${m}`),
    },
  });
  const s = result.stats;
  const pct = s.estOriginalTokens
    ? Math.round((1 - s.estPrunedTokens / s.estOriginalTokens) * 100)
    : 0;
  console.log(
    `    → optional kept ${s.keptOptional}/${s.optionalUnits} · ` +
      `~${s.estOriginalTokens}→${s.estPrunedTokens} tok (−${pct}%) · ` +
      `${s.elapsedMs}ms${s.skippedReason ? ` · skipped: ${s.skippedReason}` : ""}`,
  );
  const stem = `request_line${req.lineNo}`;
  writeFileSync(join(outDir, `${stem}.pruned.txt`), result.prunedPrompt);
  writeFileSync(
    join(outDir, `${stem}.report.json`),
    JSON.stringify({ prompt: req.prompt, hyde: result.hyde, stats: s }, null, 2),
  );
  console.log(`    wrote ${join(outDir, stem)}.{pruned.txt,report.json}\n`);
}

console.log("Done.");
