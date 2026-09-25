/**
 * Core shared types for the JARVIS TypeScript brain (Android edition).
 *
 * These mirror the shapes the Python backend passes around:
 *  - chat messages (the conversation the model sees),
 *  - tool declarations (the palette advertised to the model),
 *  - action specs (the single internal command shape every tool lowers to),
 *  - tool results (what the dispatcher returns; the spoken reply is built from it).
 *
 * Reference: `reference/python-backend-spec/llm/live_tools.py` and the dicts that
 * `actions/__init__.py:run_action` consumes.
 */

/** A single turn in the conversation the model is given. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** For role:"tool" — which tool call this is the result of. */
  toolCallId?: string;
  /** For role:"tool" — function name (Gemini functionResponse needs it). */
  toolName?: string;
  /** For role:"assistant" — tool calls the model requested this turn. */
  toolCalls?: ToolCall[];
  /** For multimodal input — array of base64 JPEG images. */
  images?: string[];
}

/** A function/tool call emitted by the model. */
export interface ToolCall {
  id: string;
  name: string;
  /** Parsed arguments object (already JSON-decoded). */
  args: Record<string, unknown>;
  /**
   * Gemini 2.5+ "thinking" models attach this to functionCall parts; it must be
   * echoed back verbatim on the same part when the call is replayed in a later
   * turn's history, or Vertex/Gemini reject the request with a 400 ("missing a
   * thought_signature"). Absent for models that don't use extended thinking.
   */
  thoughtSignature?: string;
}

/**
 * One entry in the tool palette advertised to the model. Provider-neutral: the
 * Gemini `functionDeclarations` shape and the OpenAI/Groq `tools` shape are both
 * derived from this (see registry.ts), exactly as `live_tools.py` does.
 */
export interface ToolDeclaration {
  name: string;
  description: string;
  /** JSON-Schema-ish parameter object; types are lower-case ("string"/"integer"…). */
  parameters?: {
    type: "object";
    properties: Record<string, ToolParam>;
    required?: string[];
  };
}

export interface ToolParam {
  type: "string" | "integer" | "number" | "boolean";
  description: string;
  enum?: string[];
}

/**
 * The single internal command shape. EVERY tool call — whether it arrived as a
 * native function call or a text `[ACTION]` tag — is lowered to one of these, then
 * handed to the dispatcher. Mirrors the `{"type": ..., ...}` dicts in
 * `live_tools.py:_SPEC` that feed `actions.run_action`.
 */
export interface ActionSpec {
  type: string;
  [key: string]: unknown;
}

/** What a dispatched action returns. The spoken reply is built from `summary`. */
export interface ToolResult {
  ok: boolean;
  /** Short, user-facing outcome — the model speaks/relays this, not the raw data. */
  summary: string;
  /** Structured payload for the HUD (chart/table/image path/etc.), if any. */
  data?: unknown;
  /** Base64 JPEG images returned by the tool (e.g., screenshots). */
  images?: string[];
  /** True when the action needs the user's on-screen approval before running. */
  needsApproval?: boolean;
  error?: string;
}

/** Provider tier — decides which place/web tools are offered (registry.ts). */
export type ProviderTier = "vertex" | "gemini" | "groq" | "local";

/** Live capability flags, resolved per tier (mirrors `live_tools._capabilities`). */
export interface Capabilities {
  placesOk: boolean;
  webOk: boolean;
}
