# Twilio Voice Adapter Template (PSTN)

## Overview
Twilio handles phone calls (PSTN). Your service must:
1) Receive Twilio webhooks for inbound calls (Voice URL).
2) Return TwiML that starts a Media Stream to your WSS endpoint.
3) Accept audio frames via WebSocket (Twilio -> you).
4) Forward audio to OpenAI Realtime session.
5) Stream OpenAI audio back to Twilio over the same stream.

## Webhook server (OpenClaw voice-call plugin)
The voicechat Twilio webhook server **listens on port 3334** by default for incoming HTTP POSTs. Override with `VOICECHAT_WEBHOOK_PORT` (see references/env.md). Path: `/voice/webhook`. Configure Twilio’s Voice URL to your public base (e.g. ngrok/tunnel exposing 3334) plus `/voice/webhook`.

## Inbound Call Flow (template)
1) Twilio hits:
   POST {VOICECHAT_PUBLIC_BASE_URL}/twilio/voice/inbound

2) Your handler responds with TwiML:
- Say a short greeting (optional) OR immediate streaming
- Start Stream:
  - url="wss://{VOICECHAT_PUBLIC_BASE_URL}/twilio/stream/{callSid}"
  - track="inbound_track" (and enable bidirectional if supported in your implementation)

### TwiML skeleton (conceptual)
<Response>
  <Connect>
    <Stream url="wss://YOUR_HOST/twilio/stream/CALL_SID" />
  </Connect>
</Response>

## Outbound Call Flow

**When the agent runs in TabHR:** Do not use Twilio REST API or credentials. Initiate outbound calls via the TabHR API: `POST {TABHR_API_BASE_URL}/api/employees/{TABHR_EMPLOYEE_ID}/twilio/call` with body `{"to": "+1..."}` and header `X-TabHR-Agent-Key: {TABHR_API_KEY}`. See references/tabhr-call-api.md.

**When not using TabHR (standalone voice bridge):**
1) Your backend calls Twilio REST API:
- to = target E.164
- from = TWILIO_PHONE_NUMBER
- url = {VOICECHAT_PUBLIC_BASE_URL}/twilio/voice/outbound_twiML?session_id=...

2) That URL returns TwiML with <Connect><Stream>...

## WebSocket Stream Endpoint
WSS: /twilio/stream/{callSid}

### Responsibilities
- Verify Twilio signature / auth (recommended)
- Start/attach Call Session in voicechat orchestrator:
  - platform="twilio"
  - direction=inbound/outbound
  - callSid, from, to
- Begin forwarding frames to Realtime session
- Handle hangup events and close resources

## Audio Handling Notes
- Normalize incoming audio to PCM16 mono at your chosen sample rate
- Twilio payloads are delivered as events (start/media/stop)
- Use jitter buffer if needed
- Support barge-in:
  - if user speaking begins while agent speaking, cancel generation

## Status callbacks (optional)
Expose:
- /twilio/status
to receive call status events for analytics and cleanup.

## Minimum metadata to capture for retrieval
- caller phone: From
- callee phone: To
- callSid
- direction
- timestamp