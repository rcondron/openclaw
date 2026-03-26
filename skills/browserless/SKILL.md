---
name: browserless
description: Browse the web via Browserless.io BrowserQL — stealth browser automation with CAPTCHA solving, residential proxies, and bot-detection bypass. Use when navigating protected sites, scraping data from sites that block bots, solving CAPTCHAs (Cloudflare, reCAPTCHA, hCaptcha), or when the built-in browser tool gets blocked or flagged. Also use for headless/containerized environments without a local browser.
---

# Browserless BQL

Execute BrowserQL (GraphQL) mutations against Browserless.io's managed stealth browsers.

## Setup

Requires `BROWSERLESS_API_TOKEN` env var. Get token from https://browserless.io/account/

## Quick Start

Run BQL queries via the helper script:

```bash
node skills/browserless-bql/scripts/bql.js 'mutation { goto(url: "https://example.com", waitUntil: firstMeaningfulPaint) { status } text { text } }' --stealth
```

### Options

- `--stealth` — Use `/stealth/bql` endpoint (recommended for protected sites)
- `--endpoint sfo|lon|ams` — Regional endpoint (default: sfo)
- `--vars '{"key":"val"}'` — GraphQL variables
- `--save screenshot.png` — Save screenshot base64 to file

## Key Mutations

| Mutation | Purpose |
|---|---|
| `goto(url)` | Navigate to URL |
| `click(selector)` | Click element |
| `type(text, selector)` | Type into input |
| `text(selector?)` | Extract text |
| `html(selector?, clean?)` | Extract HTML (use `clean` for LLM-friendly output) |
| `screenshot(fullPage?)` | Capture screenshot (returns base64) |
| `solve(type?)` | Auto-solve CAPTCHAs |
| `waitForSelector(selector)` | Wait for element |
| `evaluate(expression)` | Run JavaScript |

## When to Use Stealth

Always use `--stealth` for:
- Sites with Cloudflare protection
- LinkedIn, Indeed, Google, Amazon
- Any site that serves CAPTCHAs
- Rate-limited APIs accessed via browser

## CAPTCHA Solving

```graphql
mutation SolveAndScrape {
  goto(url: "https://protected-site.com", waitUntil: firstMeaningfulPaint) { status }
  solve { found solved time }
  text(selector: ".content") { text }
}
```

`solve` auto-detects CAPTCHA type. Force type with `solve(type: cloudflare)`.

## Clean HTML for LLMs

Strip markup to minimize tokens:

```graphql
html(clean: { removeAttributes: true, removeNonTextNodes: true }) { html }
```

## Full BQL Schema

For all mutations, arguments, and patterns: read `references/bql-schema.md`
