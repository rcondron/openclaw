# WhatsApp Adapter Template

## Key point
WhatsApp is not a real-time duplex "phone call" channel in the same way as PSTN.
You typically handle:
- text messages
- voice notes (recorded audio clips)
- media attachments

So for "real-time natural conversation", WhatsApp is best used as:
1) ASYNC voice-note chat (close to real time, but not duplex), OR
2) A HANDOFF channel that escalates to a real voice call (Twilio Voice) or meeting (Teams/Zoom).

## Recommended v1 approach
Implement WhatsApp via Twilio WhatsApp:
- inbound webhook receives WhatsApp messages
- if a voice-note is received:
  - transcribe
  - respond with short text + optional TTS audio note
- offer a “Tap to call” / “Reply CALL to start a live call” escalation

## Inbound Message Webhook (template)
POST {VOICECHAT_PUBLIC_BASE_URL}/twilio/whatsapp/inbound

Handle:
- Body (text)
- MediaUrl0 (voice note audio)
- From (whatsapp:+...)
- To (whatsapp:+...)

## Voice Note Handling
- Download MediaUrl0
- Run STT (fast)
- Route text into agent brain
- Respond:
  - text reply (fastest)
  - optional audio reply:
    - TTS response -> upload/attach media back

## Live Call Handoff Pattern
If the user sends:
- "CALL" or "talk to me" or presses a quick-reply button
Then:
- Start Twilio Voice outbound call to their phone number (if you have it) OR
- Ask them for a phone number (E.164)
- Create voicechat Twilio session and call them.

## UX copy template
"Want to talk live? Reply CALL and I’ll ring you now."

## Retrieval context keys
- WhatsApp user id (From)
- linked phone number (if known)
- last 10 message summaries (store + embed)