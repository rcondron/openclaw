# Microsoft Teams Voice Adapter Template (Bot Calling)

## Overview
Teams real-time voice requires a bot that can join calls/meetings and access media.
Your architecture:
Teams <-> Teams Bot Service (your HTTPS endpoints) <-> Media Bridge <-> OpenAI Realtime

## Core components
- Bot registration (Azure)
- Permissions/consent for calling/media
- Webhook endpoints to receive call events
- Media stack/gateway to access audio frames (implementation-dependent)

## Session types
1) Join a meeting by URL (meeting bot)
2) Receive inbound call to bot (call bot)
3) Call a Teams user (outbound calling bot)

## Adapter Contract (recommended)
The Teams adapter should expose:
- connect_to_meeting(meeting_join_url, display_name)
- accept_inbound_call(call_id)
- send_audio(frame)
- on_audio(callback)
- disconnect()

## Event Webhook Endpoint
POST {VOICECHAT_PUBLIC_BASE_URL}/teams/events

Handle:
- call created / updated / terminated
- participant join/leave
- media negotiation status

## Media Handling
Implementation details vary by stack. The adapter’s job:
- provide PCM16 frames to the orchestrator
- accept PCM16 frames from orchestrator for playback
- signal barge-in (user speech detected)

## Identity + Context injection
At connect:
- participant list (names/ids if available)
- meeting topic (if available)
- tenant/app context

Inject initial briefing:
- "You are joining a Teams meeting about {topic}..."
- "Your role is {persona.role}..."

## Common UX pattern
- Agent joins muted, listens for 1–2 seconds, then greets with purpose.
- If multiple participants, confirm who you’re speaking with early.

## Retrieval context keys
- meeting id / thread id
- tenant id
- organizer id
- meeting subject
- participant ids