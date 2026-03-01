# Zoom Voice Adapter Template (Meeting Bot)

## Overview
Zoom voice uses a bot/app that can join meetings and access audio.
Architecture:
Zoom Meeting <-> Zoom App/Webhooks <-> Your Bot Service <-> Media Bridge <-> OpenAI Realtime

## Core components
- Zoom app registration
- Webhook endpoint to receive meeting events
- Bot join flow (join meeting via SDK or bot framework)
- Media gateway to extract/insert audio (implementation-dependent)

## Event Webhook Endpoint
POST {VOICECHAT_PUBLIC_BASE_URL}/zoom/webhook

Handle:
- meeting.started / meeting.ended
- participant.joined / participant.left
- bot join confirmation
- (optional) recording/transcript events if you use them

## Adapter Contract (recommended)
- join_meeting(meeting_id or join_url, passcode, display_name)
- leave_meeting()
- send_audio(frame)
- on_audio(callback)
- on_participants(callback)

## Media notes
Zoom media injection/extraction depends on your chosen approach:
- native SDK integration
- media gateway/SFU approach

Regardless, normalize audio to:
- PCM16 mono
- fixed sample rate
- fixed frame duration

## Identity + Context injection
On join:
- meeting topic (if available)
- host name/id
- participant roster snapshot

Initial briefing injection:
- who you are
- why you’re present
- what you’ll do (e.g., “I’ll answer questions about X”)

## Retrieval context keys
- meeting uuid
- host id
- scheduled agenda
- last meeting summary (if recurring)