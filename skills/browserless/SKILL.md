---
name: browserless
description: Browse the web via Browserless.io using OpenClaw's browser tool over CDP/WebSocket (Playwright). Use for protected sites, containerized browsing, or when a remote managed browser is configured. Do not use BrowserQL/BQL — use profile="browserless" with the browser tool.
---

# Browserless (CDP / WebSocket)

OpenClaw connects to [Browserless.io](https://browserless.io) over **Chrome DevTools Protocol (CDP) via WebSocket**. Playwright attaches with `connectOverCDP` — the same path as the built-in `browser` tool. **Do not use BrowserQL (BQL) or GraphQL mutations.**

## How It Works

1. `openclaw.json` sets `browser.cdpUrl` (or `browser.profiles.browserless.cdpUrl`) to a Browserless HTTP endpoint, e.g. `https://chrome.browserless.io?token=YOUR_TOKEN`
2. OpenClaw upgrades that to **WSS** and drives the browser through Playwright
3. The agent uses the **`browser` tool** with `profile="browserless"` (TabHR default)

TabHR containers typically ship with `attachOnly: true` and a preconfigured remote `cdpUrl` — no local Chrome launch.

## When to Use

- Remote / headless browsing in Docker (no local browser)
- Browserless-managed Chrome with token auth
- Sites that need a real browser session (navigation, forms, snapshots, screenshots)
- When `profile="chrome"` (TabHR extension on :9220) is not available or not appropriate

## Configuration

| Setting                               | Purpose                                                           |
| ------------------------------------- | ----------------------------------------------------------------- |
| `browser.enabled`                     | Enable browser control (default true in TabHR)                    |
| `browser.attachOnly`                  | Attach to remote CDP only; do not launch local Chrome             |
| `browser.cdpUrl`                      | Browserless HTTP URL with `?token=` (converted to WSS internally) |
| `browser.defaultProfile`              | Usually `"browserless"` in TabHR                                  |
| `browser.profiles.browserless.cdpUrl` | Per-profile override (same format)                                |

Token can live in the CDP URL query string (`?token=...`). `BROWSERLESS_API_TOKEN` is optional if the token is already in `cdpUrl`.

## Quick Reference — Use the `browser` Tool

**Always use the built-in `browser` tool.** Never run BQL scripts or GraphQL against Browserless.

### Check connection

```json
{ "action": "status", "profile": "browserless" }
```

### Open a tab / navigate

```json
{ "action": "open", "profile": "browserless", "url": "https://example.com" }
```

```json
{ "action": "navigate", "profile": "browserless", "url": "https://example.com" }
```

### Snapshot page (for reading / automation refs)

```json
{ "action": "snapshot", "profile": "browserless", "refs": "aria" }
```

Use `refs="aria"` for stable Playwright aria-ref ids across `act` calls.

### Click / type (after snapshot)

```json
{
  "action": "act",
  "profile": "browserless",
  "kind": "click",
  "ref": "e12",
  "targetId": "<from snapshot>"
}
```

### Screenshot

```json
{ "action": "screenshot", "profile": "browserless", "fullPage": true }
```

## Profiles

| Profile       | Use when                                                         |
| ------------- | ---------------------------------------------------------------- |
| `browserless` | Remote Browserless CDP (WebSocket) — default in TabHR containers |
| `chrome`      | TabHR browser extension relay on `http://127.0.0.1:9220`         |

## Do Not Use

- BrowserQL / BQL GraphQL mutations (`/chromium/bql`, `/stealth/bql`)
- Custom fetch scripts to Browserless GraphQL endpoints
- `pdftoppm`-style workarounds for browser tasks — use `browser` snapshot/screenshot instead

## Troubleshooting

- **`browser` status fails / timeout:** Check `browser.cdpUrl` token and network reachability to Browserless
- **Empty tabs:** Run `action: "open"` with a URL first
- **Refs not found:** Re-run `snapshot` on the same tab; pass `targetId` from the snapshot into subsequent `act` calls

## Under the Hood

OpenClaw core: `src/browser/pw-*.ts` (Playwright over CDP), `src/browser/cdp.ts` (HTTP → WSS normalization for remote hosts like `*.browserless.io`).
