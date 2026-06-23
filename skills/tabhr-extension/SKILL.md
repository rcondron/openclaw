---
name: tabhr-extension
description: Control a manager-shared Chrome tab via the TabHR extension on port 9220. Use for shared-tab workflows (not general web browsing). DOM-first — extractPage, plan JS, runScript; screenshot only as fallback.
---

# TabHR Extension (shared Chrome tab)

When a manager shares a Chrome tab with the agent, control flows through the **extension-tab-gateway** on port **9220** (`profile="chrome"` in the `browser` tool).

**Do not use CDP.** Automation is **DOM-first**:

1. **extractPage** — HTML (truncated), visible text, interactive element list
2. Plan minimal JavaScript for the task
3. **runScript** — inject via `chrome.scripting.executeScript` in **MAIN** world
4. Re-extract or verify with another **runScript**
5. **Screenshot + vision** only when DOM/script cannot resolve the task

## When to Use

- Manager has shared a specific browser tab (HR portals, internal tools, authenticated sessions)
- User mentions TabHR extension, shared tab, or port 9220
- **Not** for general browsing — use `profile="browserless"` instead

## Prerequisites

- TabHR extension connected to gateway (`GET http://127.0.0.1:9220/status` returns `connectionIds`)
- Use `targetId` = a **connection UUID** from status/tabs (not a CDP target id)

## Workflow

### 1. List connections

```json
{ "action": "tabs", "profile": "chrome" }
```

Or curl: `curl -s http://127.0.0.1:9220/status`

### 2. Snapshot (DOM extract — preferred)

```json
{ "action": "snapshot", "profile": "chrome", "targetId": "<connection-uuid>" }
```

Returns `html`, `text`, `interactiveElements` (buttons, links, inputs with selector hints).

### 3. Run JavaScript

The `act` action requires a nested **`request`** object (do not put `kind`/`fn` at the top level):

```json
{
  "action": "act",
  "profile": "chrome",
  "request": {
    "kind": "evaluate",
    "targetId": "<connection-uuid>",
    "fn": "document.querySelector('#submit')?.click(); return document.title;"
  }
}
```

Scripts run in **MAIN** world by default (page JS context). Use short, focused snippets; re-snapshot after mutations.

### 4. Navigate / type / click (fallback primitives)

Prefer DOM scripts over navigate (may lose session). Navigate uses **`targetUrl`** (not `url`):

```json
{
  "action": "navigate",
  "profile": "chrome",
  "targetId": "<uuid>",
  "targetUrl": "https://..."
}
```

Coordinate click and raw type via `act` with `request: { kind: "click", ... }` or curl endpoints; prefer **evaluate/runScript** for reliable DOM interaction.

### 5. Screenshot (last resort)

```json
{ "action": "screenshot", "profile": "chrome", "targetId": "<uuid>" }
```

After interpreting a screenshot, still prefer **runScript** for the actual action.

## Rules

- Always pass the same `targetId` (connection UUID) across snapshot → act → screenshot
- Prefer `extractPage` data over screenshots for reading page content
- Never assume CDP refs (`e12`) — extension snapshots expose `interactiveElements`, not Playwright refs
- Keep scripts idempotent where possible; verify with a follow-up snapshot or small probe script
- **`act`**: always nest `{ kind, targetId, fn, ... }` inside `"request"`
- **`navigate`**: use `"targetUrl"`, never `"url"`

## Gateway API (direct curl)

```bash
# Status
curl -s http://127.0.0.1:9220/status

# Extract page
curl -s -X POST "http://127.0.0.1:9220/connection/<uuid>/command" \
  -H 'Content-Type: application/json' \
  -d '{"endpoint":"extractPage","maxHtmlChars":50000}'

# Run script
curl -s -X POST "http://127.0.0.1:9220/connection/<uuid>/command" \
  -H 'Content-Type: application/json' \
  -d '{"endpoint":"runScript","script":"return document.title;"}'
```
