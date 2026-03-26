# BrowserQL Schema Reference

Full docs: https://docs.browserless.io/bql-schema/operations/mutations/

## Endpoints

| Route | Use |
|---|---|
| `/chromium/bql` | Standard BQL |
| `/stealth/bql` | Stealth mode (fingerprint mitigations, recommended for protected sites) |

Regions: `production-sfo.browserless.io`, `production-lon.browserless.io`, `production-ams.browserless.io`

## Core Mutations

### goto(url, waitUntil?, timeout?)
Navigate to a URL. `waitUntil`: `load`, `domContentLoaded`, `networkIdle`, `firstMeaningfulPaint`.
```graphql
goto(url: "https://example.com", waitUntil: firstMeaningfulPaint) { status time }
```

### click(selector, scroll?, timeout?, visible?, wait?)
Click an element. Supports CSS selectors, JS expressions, and Browserless deep queries (prefix `<`).
```graphql
click(selector: "button.submit") { time x y }
# Deep query into iframe:
click(selector: "< *google.com/recaptcha* #recaptcha-anchor") { time }
```

### type(text, selector, delay?, scroll?, timeout?)
Type text into an element with human-like keystroke delays. `delay` is `[min, max]` ms range (default `[50, 200]`).
```graphql
type(text: "hello", selector: "input[name='q']") { time }
```

### text(selector?, timeout?, clean?)
Extract text content from page or selector.
```graphql
fullPage: text { text }
heading: text(selector: "h1") { text }
```

### html(selector?, timeout?, clean?)
Extract HTML. Use `clean` to strip attributes/non-text nodes (saves ~1000x payload for LLMs).
```graphql
html(clean: { removeAttributes: true, removeNonTextNodes: true }) { html }
```

### screenshot(fullPage?, selector?, type?, quality?, timeout?, waitForImages?)
Capture screenshot. Returns `base64`. Types: `png`, `jpeg`, `webp`.
```graphql
screenshot(fullPage: true, type: jpeg, quality: 80) { base64 }
```

### solve(type?, timeout?, wait?)
Solve CAPTCHAs. Auto-detects type or specify: `recaptcha`, `hcaptcha`, `cloudflare`, `turnstile`.
```graphql
solve { found solved time token }
solve(type: cloudflare) { found solved time }
```

### scroll(selector?, x?, y?, timeout?)
Scroll page or to element.

### hover(selector, timeout?)
Hover over an element.

### select(selector, values, timeout?)
Select option(s) in a `<select>` element.

### checkbox(selector, checked?, timeout?)
Toggle a checkbox.

### evaluate(expression, args?)
Execute JavaScript in page context. Return value via `expression`.

### waitForSelector(selector, timeout?, visible?)
Wait for element to appear in DOM.

### waitForNavigation(timeout?, waitUntil?)
Wait for navigation to complete.

### waitForTimeout(time)
Wait a fixed number of milliseconds.

### waitForRequest(url, timeout?)
Wait for a network request matching URL pattern.

### waitForResponse(url, timeout?)
Wait for a network response matching URL pattern.

### cookies(name?, domain?, url?)
Get cookies.

### content(html)
Set page HTML content.

### pdf(format?, landscape?, margin?, scale?)
Generate PDF. Returns `base64`.

### url
Get current URL.

### title
Get page title.

### back / forward / reload
Navigation history.

### proxy(server, username?, password?)
Set proxy for session.

### userAgent(value)
Override user agent.

### viewport(width, height, deviceScaleFactor?)
Set viewport size.

### setExtraHTTPHeaders(headers)
Set custom HTTP headers.

### request / response / reject
Intercept network requests/responses.

### reconnect(timeout?)
Reconnect to browser session.

### mapSelector(selector, action)
Map over multiple matching elements.

### querySelector / querySelectorAll
Low-level DOM queries.

### if(selector) / ifNot(selector)
Conditional execution based on element presence.

### switchToWindow(index)
Switch between browser windows/tabs.

### liveUrl
Get a live URL for interactive debugging.

## Directives

- `@export(as: "varName")` — Export a field value as a variable for later use
- `@include(if: $condition)` — Conditionally include field
- `@skip(if: $condition)` — Conditionally skip field

## Common Patterns

### Scrape with stealth + captcha solving
```graphql
mutation ScrapeSite {
  goto(url: "https://protected-site.com", waitUntil: firstMeaningfulPaint) { status }
  solve { found solved }
  text(selector: ".content") { text }
}
```

### Fill form and submit
```graphql
mutation FillForm {
  goto(url: "https://example.com/form", waitUntil: networkIdle) { status }
  type(text: "John Doe", selector: "#name") { time }
  type(text: "john@example.com", selector: "#email") { time }
  click(selector: "button[type='submit']") { time }
  waitForNavigation { status }
  text(selector: ".confirmation") { text }
}
```

### Screenshot with clean text extraction
```graphql
mutation PageInfo {
  goto(url: "https://example.com", waitUntil: firstMeaningfulPaint) { status }
  screenshot(type: jpeg, quality: 70) { base64 }
  html(clean: { removeAttributes: true, removeNonTextNodes: true }) { html }
}
```
