---
name: tabhr-extension
description: Control a manager-shared Chrome tab through the TabHR extension on port 9220. Use for shared-tab work — authenticated sessions, HR portals, internal tools — not general browsing. Read with snapshot, act on what it returns; screenshot only when the page cannot be read.
---

# TabHR Extension (shared Chrome tab)

When a manager shares a Chrome tab, control flows through the **extension-tab-gateway** on port **9220** — `profile="chrome"` in the `browser` tool.

A shared tab is the person's own browser, already signed in as them. That is the whole point of it, and also the reason to be careful: everything you do is visible on their screen and done as them.

## How to drive it

Everything goes through the debugger now, so a page's Content Security Policy no longer decides whether you can act — sign-in pages included.

1. **`snapshot`** — read the page: text and the interactive elements on it.
2. **`act`** — click, type, press, select, on an element the snapshot gave you.
3. **`snapshot`** again to confirm what changed.
4. **`screenshot`** only when the page genuinely cannot be read as text.

**You cannot run your own JavaScript.** There is no `evaluate` and no `runScript`. This is deliberate: injected scripts had to parse, had to be right about a DOM you cannot see, and failed with messages that said nothing useful — while `act` does the same work as real input. If you find yourself wanting to write a selector, take a snapshot and use what it names instead.

**`action="task"` cannot be used here.** It hands the job to a hosted agent that opens a browser of its own, so it would work somewhere the person cannot see while their shared tab sat untouched — and anything it signed into or filled in would be in the wrong browser. On a shared tab, do the work yourself with `snapshot` and `act`.

## When to use this

- The manager has shared a specific tab, or mentions the TabHR extension, a shared tab, or port 9220.
- **Not** for general browsing — use your own browser (`profile` omitted, or `"browserless"`).

## Prerequisites

- The extension is connected: `GET http://127.0.0.1:9220/status` returns `connectionIds`.
- `targetId` is a **connection UUID** from `status`/`tabs` — not a CDP target id, and not a Playwright ref.

## Workflow

### 1. Find the shared tabs

```json
{ "action": "tabs", "profile": "chrome" }
```

### 2. Read the page

```json
{ "action": "snapshot", "profile": "chrome", "targetId": "<connection-uuid>" }
```

Returns the page text and `interactiveElements` — buttons, links and inputs with the hints you need to name them.

### 3. Act on it

`act` takes a nested **`request`** object. Do not put `kind` at the top level.

```json
{
  "action": "act",
  "profile": "chrome",
  "request": { "kind": "click", "targetId": "<connection-uuid>", "ref": "<from the snapshot>" }
}
```

Typing works the same way with `{ "kind": "type", "text": "..." }`, and `{ "kind": "press", "key": "Enter" }` submits. Click the field before typing — text goes wherever the caret is.

### 4. Navigate, if you must

Navigating a shared tab takes the person away from whatever they were looking at, and can lose a session. Prefer clicking a link the page already offers.

```json
{ "action": "navigate", "profile": "chrome", "targetId": "<uuid>", "targetUrl": "https://..." }
```

Note it is `targetUrl`, never `url`.

### 5. Screenshot

```json
{ "action": "screenshot", "profile": "chrome", "targetId": "<uuid>" }
```

For a canvas, a chart, an image — something with no text to read. After looking at one, still act through `snapshot` + `act`; do not guess coordinates.

## Rules

- Pass the same `targetId` through snapshot → act → screenshot.
- Take a fresh snapshot after anything that changes the page. Refs from an old snapshot may name something else by now.
- Chrome shows "TabHR is debugging this browser" on the tab while you are attached. That is expected; it is what makes this work.
- Do not do anything irreversible on someone's own browser without being asked to — sending a message, submitting a payment, accepting terms.

## Gateway API (direct curl)

Rarely needed; the `browser` tool covers all of it.

```bash
# Which tabs are shared
curl -s http://127.0.0.1:9220/status

# Read a page
curl -s -X POST "http://127.0.0.1:9220/connection/<uuid>/command" \
  -H 'Content-Type: application/json' \
  -d '{"endpoint":"extractPage","maxHtmlChars":50000}'
```
