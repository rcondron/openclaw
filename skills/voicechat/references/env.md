# voicechat: Environment Variables

## TabHR (outbound call / SMS via TabHR API)

When the agent runs in a TabHR container, use these for placing outbound calls and sending SMS. Do not use Twilio credentials in the agent; TabHR holds them.

- **TABHR_API_BASE_URL** – e.g. `http://host.docker.internal:3000`
- **TABHR_EMPLOYEE_ID** – employee UUID
- **TABHR_API_KEY** – agent API key (send as header `X-TabHR-Agent-Key`)

See references/tabhr-call-api.md for endpoints and request format.

## OpenAI Realtime
- OPENAI_API_KEY
- OPENAI_REALTIME_MODEL (e.g., "gpt-realtime" / your chosen Realtime model id)
- OPENAI_REALTIME_VOICE (voice id/name, optional)
- OPENAI_REALTIME_AUDIO_IN_FORMAT (e.g., "pcm16")
- OPENAI_REALTIME_AUDIO_OUT_FORMAT (e.g., "pcm16")
- OPENAI_REALTIME_SAMPLE_RATE (e.g., 16000)

## Retrieval / Vector Store
- VOICECHAT_VECTOR_PROVIDER (e.g., "pinecone" | "weaviate" | "qdrant" | "pgvector" | "milvus")
- VOICECHAT_VECTOR_URL
- VOICECHAT_VECTOR_API_KEY
- VOICECHAT_VECTOR_NAMESPACE (optional)
- VOICECHAT_RAG_TOP_K (default 5)
- VOICECHAT_RAG_MAX_FACTS (default 5)
- VOICECHAT_RAG_SUMMARY_MAX_TOKENS (keep small; default 250-400)

## Twilio (Voice + WhatsApp)

When **not** using TabHR for outbound: credentials and webhook URLs for direct Twilio integration. When using **TabHR**, the agent must not read or use these; outbound calls and SMS go through the TabHR API (references/tabhr-call-api.md).

- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- TWILIO_PHONE_NUMBER (E.164)
- TWILIO_WHATSAPP_NUMBER (e.g., "whatsapp:+14155238886")
- TWILIO_VOICE_WEBHOOK_BASE_URL (public HTTPS base)
- TWILIO_MEDIA_STREAM_WSS_URL (public wss:// for Media Streams)
- TWILIO_STATUS_CALLBACK_URL (optional)
- VOICECHAT_WEBHOOK_PORT (optional; default **3334** — port the webhook server listens on for Twilio HTTP POSTs; use with OpenClaw voice-call plugin)

## Microsoft Teams
- TEAMS_TENANT_ID
- TEAMS_CLIENT_ID
- TEAMS_CLIENT_SECRET
- TEAMS_BOT_APP_ID (often same as client id)
- TEAMS_BOT_ENDPOINT (public HTTPS)
- TEAMS_CALLING_ENABLED=true

## Zoom
- ZOOM_CLIENT_ID
- ZOOM_CLIENT_SECRET
- ZOOM_WEBHOOK_SECRET
- ZOOM_APP_TYPE (e.g., "server-to-server-oauth" or "oauth")
- ZOOM_REDIRECT_URL (if OAuth)
- ZOOM_BOT_DISPLAY_NAME (optional)
- ZOOM_MEDIA_GATEWAY_URL (your media bridge/sfu endpoint)

## General
- VOICECHAT_PUBLIC_BASE_URL (public HTTPS base)
- VOICECHAT_LOG_LEVEL (info|debug)
- VOICECHAT_METRICS_ENABLED=true