/**
 * Redact secrets and sensitive information from outbound text.
 *
 * This filter runs on ALL outbound messages before they reach end users.
 * It strips API keys, passwords, tokens, and other credentials that agents
 * might inadvertently include in responses.
 *
 * HARDCODED patterns — not configurable by the agent or end user.
 */

const REDACTED = "[REDACTED]";

// ── Pattern definitions ──────────────────────────────────────────────
// Each entry: [regex, replacement]. Regexes use 'gi' flags.

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // ── API Keys & Tokens (common prefixes) ──
  // OpenAI
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, REDACTED],
  // Anthropic
  [/\bsk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,}\b/g, REDACTED],
  // Grok / x.ai
  [/\bxai-[A-Za-z0-9_-]{20,}\b/g, REDACTED],
  // Stripe
  [/\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,}\b/g, REDACTED],
  [/\bpk_(?:live|test)_[A-Za-z0-9]{20,}\b/g, REDACTED],
  // Twilio
  [/\bSK[0-9a-f]{32}\b/g, REDACTED],
  // Google OAuth client secrets
  [/\bGOCSPX-[A-Za-z0-9_-]{20,}\b/g, REDACTED],
  // Deepgram
  [/\b[0-9a-f]{40}\b/g, REDACTED], // 40-char hex (Deepgram, generic)
  // ElevenLabs
  [/\bsk_[0-9a-f]{40,}\b/g, REDACTED],
  // Browserless
  [/\bBRWSR_[A-Za-z0-9_-]{20,}\b/g, REDACTED],
  // Generic Bearer tokens (long base64-ish strings after "Bearer")
  [/\bBearer\s+[A-Za-z0-9_\-.]{30,}\b/g, `Bearer ${REDACTED}`],
  // Generic "api_" prefixed keys
  [/\bapi_[A-Za-z0-9_+/=-]{20,}\b/g, REDACTED],

  // ── Passwords & Secrets in context ──
  // password=..., password: ..., etc.
  [/(?:password|passwd|secret|token|api[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token)\s*[:=]\s*["']?([^\s"']{8,})["']?/gi,
    (match: string, value: string) => match.replace(value, REDACTED)],

  // ── Connection strings ──
  // PostgreSQL / MySQL / Redis URLs with credentials
  [/(?:postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/[^:]+:[^@]+@/gi,
    (match: string) => match.replace(/:([^:@]+)@/, `:${REDACTED}@`)],

  // ── SSH / Server credentials ──
  // IP + password combos
  [/(?:password|passwd)\s*[:=]\s*["']?(\S{6,})["']?/gi,
    (match: string, value: string) => match.replace(value, REDACTED)],

  // ── Encryption keys ──
  // Base64 keys that look like encryption material (32+ chars, labeled)
  [/(?:ENCRYPTION_MASTER_KEY|NEXTAUTH_SECRET|master[_-]?key|encryption[_-]?key)\s*[:=]\s*["']?([A-Za-z0-9+/=]{20,})["']?/gi,
    (match: string, value: string) => match.replace(value, REDACTED)],

  // ── Private keys ──
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, REDACTED],

  // ── .env file content (full lines) ──
  // KEY="value" or KEY=value patterns for known sensitive var names
  [/(?:(?:API_KEY|SECRET|TOKEN|PASSWORD|AUTH_TOKEN|MASTER_KEY|CLIENT_SECRET)\s*=\s*)["']?[^\s"'\n]{8,}["']?/gi,
    (match: string) => {
      const eqIdx = match.indexOf("=");
      return match.slice(0, eqIdx + 1) + REDACTED;
    }],
];

/**
 * Redact secrets from outbound text.
 * Returns the cleaned text (or original if nothing matched).
 */
export function redactSecrets(text: string): string {
  if (!text) return text;

  let result = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    if (typeof replacement === "string") {
      result = result.replace(pattern, replacement);
    } else {
      result = result.replace(pattern, replacement as (...args: string[]) => string);
    }
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
  }

  return result;
}

/**
 * Check if text contains any potential secrets.
 * Lightweight check before running full redaction.
 */
export function containsSecrets(text: string): boolean {
  if (!text) return false;
  for (const [pattern] of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      pattern.lastIndex = 0;
      return true;
    }
  }
  return false;
}
