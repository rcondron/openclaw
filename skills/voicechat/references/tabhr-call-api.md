# TabHR Call-Initiation API (Outbound Voice + SMS)

Use this when the agent runs in a **TabHR** container. Outbound calls (and optionally SMS) go through the TabHR API; the agent must **not** use Twilio credentials. TabHR holds Twilio credentials and creates the call server-side.

---

## Initiate outbound call

**Method:** `POST`  
**URL:** `{TABHR_API_BASE_URL}/api/employees/{TABHR_EMPLOYEE_ID}/twilio/call`

**Headers:**
- `Content-Type: application/json`
- `X-TabHR-Agent-Key: {TABHR_API_KEY}`

**Request body (JSON):**
```json
{
  "to": "+1XXXXXXXXXX"
}
```
- `to` (required): Destination number in E.164 format (e.g. `+17276340938`). Normalize to E.164 (e.g. US: `+1` + 10 digits) before sending.

**Success (200):**
```json
{
  "sid": "CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "status": "queued"
}
```
Treat as call initiated; the call goes through the TabHR voice bridge (OpenAI Realtime + persona). Optionally surface `sid` or `status` to the user.

**Error responses:**
- `401`: Missing or invalid `X-TabHR-Agent-Key`
- `400`: Missing `to` or invalid body (e.g. `"to (E.164 number) is required"`)
- `400` / `502`: Twilio error (body includes `error`, optionally `code`)
- `503`: `"Twilio is not configured."`
- `400`: `"No Twilio phone number assigned to this employee."`

On 4xx/5xx, surface the JSON `error` (and `code` if present) so the agent or user knows why the call failed.

---

## Send SMS (optional)

**Method:** `POST`  
**URL:** `{TABHR_API_BASE_URL}/api/employees/{TABHR_EMPLOYEE_ID}/twilio/sms`

**Headers:** Same as call (Content-Type, X-TabHR-Agent-Key).

**Request body (JSON):**
```json
{
  "to": "+1XXXXXXXXXX",
  "body": "message text"
}
```

---

## Environment variables (TabHR agent container)

Set by TabHR; do not hardcode:
- **TABHR_API_BASE_URL** – e.g. `http://host.docker.internal:3000`
- **TABHR_EMPLOYEE_ID** – employee UUID
- **TABHR_API_KEY** – agent API key (use as `X-TabHR-Agent-Key`)

---

## Summary

| Action        | Endpoint (POST)                                                    | Body                              |
|---------------|--------------------------------------------------------------------|-----------------------------------|
| Initiate call | `{BASE}/api/employees/{EMPLOYEE_ID}/twilio/call`                   | `{"to": "+1..."}`                 |
| Send SMS      | `{BASE}/api/employees/{EMPLOYEE_ID}/twilio/sms`                   | `{"to": "+1...", "body": "..."}`  |

Always set header: `X-TabHR-Agent-Key: {TABHR_API_KEY}`.

**No Twilio credentials in the skill:** The agent must not read or use Twilio Account SID, Auth Token, or voice webhook URL from MEMORY.md or env. All outbound call (and optionally SMS) actions use the TabHR endpoints above.
