---
name: voicechat
description: Real-time natural voice conversations across platforms using OpenAI voice-to-voice (Realtime). Handles persona + voice style injection and retrieval-based context briefing during the call.
version: 0.1.0
tags:
  - voice
  - realtime
  - twilio
  - teams
  - zoom
  - whatsapp
  - rag
---

# VoiceChat Skill (Real-time Voice)

Use this skill whenever a user or workflow requires **live, low-latency, natural voice conversation** on any supported platform.

Supported platforms (via adapters):
- **Twilio Voice (PSTN)**: inbound/outbound calls with media streaming
- **WhatsApp**: text + voice notes (not real-time “phone call” voice); can hand off to voice call
- **Microsoft Teams**: bot-based real-time voice/media
- **Zoom**: meeting bot-based voice/media

This skill assumes a **voice bridge service** exists (or will be built) to connect platform audio streams to **OpenAI Realtime speech-to-speech** and back.

---

## What this skill does

1) Starts or accepts a platform voice session (call / meeting / media channel)
2) Creates an **OpenAI Realtime** session for speech-to-speech
3) Injects:
   - the agent’s **persona** (identity, role, rules)
   - the agent’s **voice style** (tone, pacing, brevity)
   - an initial **call briefing card** (why we’re here; who is on the call)
4) Keeps conversation natural:
   - handles barge-in (interruptions)
   - keeps latency low (short context injections)
5) Serves context during the call:
   - runs retrieval (vector store / RAG) on key triggers
   - injects **short, structured briefing cards** (never long docs)

---

## When to use

Use `voicechat` when:
- You need the agent to **talk** to someone live.
- You need real-time back-and-forth (barge-in, natural pacing).
- You need the agent to “know who it is and why it’s calling” immediately.

Do NOT use `voicechat` for:
- asynchronous chat-only workflows
- long document reading on the call (summarize & inject only the needed bullets)

---

## Preconditions

To use this skill successfully:
- A platform adapter must be configured (Twilio / Teams / Zoom / WhatsApp). **In TabHR:** outbound calls use the TabHR API (references/tabhr-call-api.md); the agent must not use Twilio credentials.
- The voice bridge must support:
  - inbound audio frames from the platform
  - outbound audio frames back to the platform
  - OpenAI Realtime session lifecycle
- A retriever must be available if contextual memory is required.

---

## Required behavior: persona + mission injection

At the start of every voice session you MUST inject:

### A) Stable “Session Instructions”
- identity: name, role, org, responsibilities
- voice style: warm, concise, confident, short sentences
- safety/rules: do not invent sensitive facts; verify identity before private info

### B) Initial “Call Briefing Card”
- direction: inbound/outbound
- call purpose: explicit reason
- known participant data: phone number / meeting user id
- next 1–2 actions (what the agent should do first)

This prevents the agent from sounding confused at the beginning.

---

## Context during the call (RAG / vector retrieval)

Retrieval should be event-driven (not constant):
- on connect (lookup by caller id / meeting id)
- after first user utterance (intent-based retrieval)
- on topic shift or explicit “last time / my account / order” request
- before quoting numbers/dates/policies

When injecting context, send ONLY a **briefing card** (max 5 key facts).

---

## Briefing card format (strict)

Use this structure:

BRIEFING (timestamp)
- Who I am: <1 line>
- Why we’re here: <1 line>
- Participant: <name/id + confidence>
- Key facts: (max 5 bullets, <= 12 words each)
- Open questions: (max 3 bullets)
- Do/Don’t: (max 2 bullets)
- Sources: <ids/refs, not raw text>

Never inject raw policies or long docs into the realtime voice session.

---

## Session lifecycle

### Start / Accept
- **Outbound calls:** When running in TabHR, initiate calls via the **TabHR call API** (POST to TabHR; see references/tabhr-call-api.md). Do not use Twilio credentials or Twilio REST API; TabHR holds Twilio and creates the call. Use `TABHR_API_BASE_URL`, `TABHR_EMPLOYEE_ID`, and `TABHR_API_KEY` from the container env.
- **Inbound calls:** Accept via platform webhooks (e.g. Twilio Voice URL).
- Immediately inject persona + voice style + initial briefing card.

### Run
- Stream audio both directions.
- Support barge-in: cancel speech when user speaks.
- Trigger retrieval sparingly; inject short briefing updates only when needed.

### End
- Stop streaming, close realtime session, close platform media.
- Store a short call summary for future retrieval:
  - purpose
  - key facts confirmed
  - outcomes / next steps
  - open items

---

## Reference templates

Use these templates when implementing adapters:
- references/tabhr-call-api.md (TabHR: outbound call + SMS; no Twilio credentials in agent)
- references/twilio.md
- references/whatsapp.md
- references/teams.md
- references/zoom.md
- references/briefing-cards.md
- references/env.md