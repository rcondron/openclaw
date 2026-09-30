import { Type } from "@sinclair/typebox";
import { optionalStringEnum, stringEnum } from "../schema/typebox.js";

/**
 * "evaluate" is deliberately absent.
 *
 * Running the model's own JavaScript in the page was the worst way to drive it.
 * The code has to parse, and when it does not the failure says nothing useful —
 * one agent retried "Unexpected token 'const'" every five seconds for ten
 * minutes. It also has to be correct about a DOM it cannot see, when the actions
 * below already do the same work through real input.
 *
 * Everything it was used for has a better route now: read the page with
 * `snapshot`, act on what it returns, and let `action="task"` handle a whole
 * job. On a shared Chrome tab those go through the debugger, so a page's
 * Content Security Policy no longer decides whether the agent can act.
 */
const BROWSER_ACT_KINDS = [
  "click",
  "type",
  "press",
  "hover",
  "drag",
  "select",
  "fill",
  "resize",
  "wait",
  "close",
] as const;

const BROWSER_TOOL_ACTIONS = [
  // First in the list because it is the first thing to try: one call that does
  // a whole web task, falling back to the step-by-step actions below.
  "task",
  "status",
  "start",
  "stop",
  "profiles",
  "tabs",
  "open",
  "focus",
  "close",
  "snapshot",
  "screenshot",
  "navigate",
  "console",
  "pdf",
  "upload",
  "dialog",
  "act",
] as const;

const BROWSER_TARGETS = ["sandbox", "host", "node"] as const;

const BROWSER_SNAPSHOT_FORMATS = ["aria", "ai"] as const;
const BROWSER_SNAPSHOT_MODES = ["efficient"] as const;
const BROWSER_SNAPSHOT_REFS = ["role", "aria"] as const;

const BROWSER_IMAGE_TYPES = ["png", "jpeg"] as const;

// NOTE: Using a flattened object schema instead of Type.Union([Type.Object(...), ...])
// because Claude API on Vertex AI rejects nested anyOf schemas as invalid JSON Schema.
// The discriminator (kind) determines which properties are relevant; runtime validates.
const BrowserActSchema = Type.Object({
  kind: stringEnum(BROWSER_ACT_KINDS),
  // Common fields
  targetId: Type.Optional(Type.String()),
  ref: Type.Optional(Type.String()),
  // click
  doubleClick: Type.Optional(Type.Boolean()),
  button: Type.Optional(Type.String()),
  modifiers: Type.Optional(Type.Array(Type.String())),
  // type
  text: Type.Optional(Type.String()),
  submit: Type.Optional(Type.Boolean()),
  slowly: Type.Optional(Type.Boolean()),
  // press
  key: Type.Optional(Type.String()),
  // drag
  startRef: Type.Optional(Type.String()),
  endRef: Type.Optional(Type.String()),
  // select
  values: Type.Optional(Type.Array(Type.String())),
  // fill - use permissive array of objects
  fields: Type.Optional(Type.Array(Type.Object({}, { additionalProperties: true }))),
  // resize
  width: Type.Optional(Type.Number()),
  height: Type.Optional(Type.Number()),
  // wait
  timeMs: Type.Optional(Type.Number()),
  textGone: Type.Optional(Type.String()),
  // evaluate
  fn: Type.Optional(Type.String()),
});

// IMPORTANT: OpenAI function tool schemas must have a top-level `type: "object"`.
// A root-level `Type.Union([...])` compiles to `{ anyOf: [...] }` (no `type`),
// which OpenAI rejects ("Invalid schema ... type: None"). Keep this schema an object.
export const BrowserToolSchema = Type.Object({
  action: stringEnum(BROWSER_TOOL_ACTIONS),
  target: optionalStringEnum(BROWSER_TARGETS),
  node: Type.Optional(Type.String()),
  profile: Type.Optional(Type.String()),
  targetUrl: Type.Optional(Type.String()),
  targetId: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number()),
  maxChars: Type.Optional(Type.Number()),
  mode: optionalStringEnum(BROWSER_SNAPSHOT_MODES),
  snapshotFormat: optionalStringEnum(BROWSER_SNAPSHOT_FORMATS),
  refs: optionalStringEnum(BROWSER_SNAPSHOT_REFS),
  interactive: Type.Optional(Type.Boolean()),
  compact: Type.Optional(Type.Boolean()),
  depth: Type.Optional(Type.Number()),
  selector: Type.Optional(Type.String()),
  frame: Type.Optional(Type.String()),
  labels: Type.Optional(Type.Boolean()),
  fullPage: Type.Optional(Type.Boolean()),
  ref: Type.Optional(Type.String()),
  element: Type.Optional(Type.String()),
  type: optionalStringEnum(BROWSER_IMAGE_TYPES),
  level: Type.Optional(Type.String()),
  paths: Type.Optional(Type.Array(Type.String())),
  inputRef: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
  accept: Type.Optional(Type.Boolean()),
  promptText: Type.Optional(Type.String()),
  request: Type.Optional(BrowserActSchema),
  /** action="task": the whole job in one sentence, e.g. "find flights from Zurich to London on 4 October". */
  goal: Type.Optional(Type.String()),
  /** action="task": page to start on. Omit to work with whatever is already open. */
  startUrl: Type.Optional(Type.String()),
  /** action="task": give up after this many steps (default 25). */
  maxSteps: Type.Optional(Type.Number()),
});
