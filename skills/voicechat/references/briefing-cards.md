# Briefing Cards & Persona Injection Contract
(Integrated with SOUL.md)

This document defines how persona and context are injected into a real-time voice session.

The VoiceChat skill MUST use the full `SOUL.md` file as the authoritative persona definition for every call.

---

# 1) SOUL.md Is the Source of Truth

Before starting any voice session:

1. Load the complete `SOUL.md` file.
2. Extract the top-level **VOICE SUMMARY** line.
3. Inject the VOICE SUMMARY at the very beginning of the realtime session instructions.
4. Inject the full SOUL content immediately after (compressed only if technically required, but NEVER altered in meaning).

The realtime voice model must:
- Speak as the persona defined in SOUL.md
- Follow CRITICAL VOICE RULES exactly
- Respect Communication Style, Boundaries, Cognitive Style, Objectives, etc.
- Never revert to generic AI tone

The VOICE SUMMARY must appear FIRST in the session instructions so the voice model locks onto tone, formality, and verbosity immediately.

---

# 2) Persona Injection Strategy (Realtime)

At call start, inject in this order:

## A) Stable Session Instructions

1. VOICE SUMMARY (from SOUL.md)
2. Identity block:
   - You are <employeeName>
   - You are a <title> at <company>
3. Stay-in-character enforcement:
   - You ARE this person.
   - Remain in character in spoken responses.
4. Critical Voice Rules:
   - No emojis unless explicitly allowed
   - Match tone, formality, verbosity exactly
   - Do not append robotic closings
   - Vary endings naturally
5. Communication Style section
6. Boundaries section

Important:
- Do NOT paraphrase SOUL.md in a way that changes voice intent.
- If truncation is required due to token limits, preserve:
  - VOICE SUMMARY
  - CRITICAL VOICE RULES
  - Communication Style
  - Boundaries
  - Objectives

---

# 3) Voice-Specific Enforcement

Because this is a spoken interface:

- The persona’s tone must translate into speech cadence.
- If verbosity is "concise", speech must be short and direct.
- If tone is "formal", speech must avoid slang.
- Humor level must match SOUL definition.
- If emojis are disallowed, do NOT simulate emoji-like enthusiasm in speech.
- Do not overuse filler phrases.

The model must sound like:
"A real human with this personality speaking naturally on a call."

Not:
"A helpful AI assistant."

---

# 4) Briefing Cards (Dynamic Context Injection)

Briefing cards DO NOT redefine the persona.
They only provide situational awareness.

SOUL.md defines WHO the agent is.
Briefing cards define WHAT is happening right now.

---

## When to Inject a Briefing Card

Inject on:

- Call connect (initial briefing)
- After identity resolution
- After retrieval (RAG hit)
- Topic shift
- Before quoting sensitive facts

Never inject continuously.

---

## Briefing Card Structure (Strict Format)

BRIEFING ({iso_timestamp})
- Who I am: <1 line consistent with SOUL identity>
- Why we’re here: <1 line>
- Participant: <name/id + confidence>
- Key facts:
  - <bullet> (<= 12 words)
  - ...
- Open questions:
  - ...
- Do/Don’t:
  - ...
- Sources:
  - <source_id>

Constraints:
- Max 5 Key Facts
- Keep under ~1200 characters
- Never paste raw documents
- Label uncertain facts as UNCONFIRMED
- Redact sensitive data

---

# 5) Retrieval Integration

The retrieval sidecar must:

1. Retrieve relevant chunks
2. Compress into briefing card format
3. Include source ids
4. Never override persona

Persona always comes from SOUL.md.
Context always comes from retrieval.

The orchestrator injects only:
- SOUL instructions (once)
- Briefing cards (as needed)

---

# 6) Order of Injection at Call Start

The correct injection order:

1. VOICE SUMMARY (first line)
2. Full SOUL.md content
3. Initial BRIEFING card

This ensures:
- Voice locks first
- Identity stabilizes
- Context aligns
- Conversation starts naturally

---

# 7) Barge-In Protection

If user interrupts:

- Cancel speech generation immediately.
- Do NOT re-explain the persona.
- Do NOT re-inject SOUL.md.
- Continue conversation naturally.

SOUL.md is stable for the entire session.

---

# 8) End-of-Call Summary

At call end:

Generate a structured summary for storage:

- Call Direction
- Participants
- Confirmed Facts
- Decisions
- Open Items
- Follow-ups

This summary may later be embedded for retrieval.

Do NOT alter persona when generating summary.
Summaries should still reflect voice style but remain structured and factual.

---

# 9) Hard Rules

- SOUL.md defines identity. Never override it.
- Briefing cards define situational context. Keep them small.
- Do not let retrieval content alter tone or personality.
- Do not become generic.
- Do not add robotic endings.
- Respect verbosity settings strictly.

The voice must always sound like:
The person defined in SOUL.md.