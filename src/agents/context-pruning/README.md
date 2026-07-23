# HyDE system-prompt pruning

OpenClaw sends the **full system prompt on every message**. Most of it (tool
definitions, situational policies, CLI references) is irrelevant to any single
turn and just burns context-window tokens on the expensive main model. This
module scores the system prompt against the current message and drops the parts
the agent does not need for that turn — the "A3" HyDE approach from the
`llm-context-approaches` experiment.

## Pipeline

1. **Units** — split the system prompt into semantic units (bullet / header /
   block).
2. **Tiering** — `CORE` (identity, safety, style, tool protocol, `Tooling` tool
   defs) is **always kept and never scored**; everything else is `OPTIONAL`.
3. **HyDE** — a cheap LLM writes "what an assistant would need to know" to handle
   the message. This document-register text surfaces the right units even for a
   thin prompt like `ping`.
4. **Judge** — a single cheap-LLM call reads the HyDE hint + framing + recent
   history + the message together with the numbered OPTIONAL units and returns
   which are needed, ordered by importance.
5. **Assemble** — CORE + kept OPTIONAL (original order) up to a token budget.
   Headers are re-added for any section that keeps content, so nothing is
   orphaned.

Both LLM calls go to **Mordiem** (OpenAI-compatible). The default model is
`openai-gpt-4o-mini-2024-07-18` — fast (~2s), cheap, and returns clean JSON,
which is what a per-message hook needs. Heavy reasoning models (e.g. `glm-5-2`)
are far too slow here.

Everything is **fail-safe**: any error, timeout, or unparseable reply returns the
original system prompt unchanged. Pruning never breaks a run.

## Enabling

Off by default. Requires `MORDIEM_API_KEY`. Enable via config:

```jsonc
// openclaw config
{
  "agents": {
    "defaults": {
      "systemPromptPruning": {
        "enabled": true,
        "hydeModel": "openai-gpt-4o-mini-2024-07-18", // optional
        "judgeModel": "openai-gpt-4o-mini-2024-07-18", // optional, defaults to hydeModel
        "maxOptionalTokens": 1200, // token budget for kept OPTIONAL units
        "minOptionalUnits": 8, // skip pruning below this many OPTIONAL units
        "historyTurns": 6,
        "timeoutMs": 30000,
      },
    },
  },
}
```

Or without touching config, via env flags:

```bash
export OPENCLAW_HYDE_PRUNE=1
export MORDIEM_API_KEY=mr_sk_...
export OPENCLAW_HYDE_MODEL=openai-gpt-4o-mini-2024-07-18   # optional
```

The hook lives in `pi-embedded-runner/run/attempt.ts`: right after the agent
session is created, `maybePruneSystemPromptWithHyde` runs and — when it shortens
the prompt — re-applies the pruned version before the model call, logging e.g.:

```
[hyde-prune] optional 3/91 kept · ~5916→1351 tok · 3997ms · openai-gpt-4o-mini-2024-07-18
```

## Trying it

Run the pipeline live against Mordiem over recorded request payloads:

```bash
MORDIEM_API_KEY=... node --import tsx scripts/hyde-prune-demo.ts [payloads.jsonl] [maxRequests]
```

It writes `<stem>.pruned.txt` and `<stem>.report.json` (prompt, HyDE text, stats)
per request and prints the token reduction. On the recovered experiment payloads
this prunes ~74–77% of the OPTIONAL context while keeping all CORE sections.
