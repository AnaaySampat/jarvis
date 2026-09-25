/**
 * LLM provider interface + factory.
 *
 * Ports the provider-routing in `reference/python-backend-spec/main.py` and
 * `llm/model_discovery.py`. Every provider exposes the same `chat()` so the brain
 * loop is provider-neutral; the request/response wire shapes differ inside.
 */

import type { BrainConfig } from "../config";
import type { ChatMessage, ToolCall, ToolDeclaration } from "../types";

/** A provider's reply for one turn: spoken text and/or tool calls to run. */
export interface LLMReply {
  /** Assistant text (may be empty when the model only wants to call tools). */
  text: string;
  /** Tool calls the model requested this turn (empty when it just answered). */
  toolCalls: ToolCall[];
}

export interface LLMProvider {
  readonly name: string;
  /**
   * One model turn. `tools` is the palette (already in this provider's wire shape
   * via registry.ts). The provider must surface tool calls in `LLMReply.toolCalls`.
   * TODO(phase-1): add a streaming variant for low-latency speech.
   */
  chat(
    messages: ChatMessage[],
    tools: ToolDeclaration[],
    opts?: ChatOpts,
  ): Promise<LLMReply>;
  /** Where and how to POST one plain (no-tools) call for a route — for the native
   *  phone operator, which runs outside this WebView and only shapes the body. */
  wire(route: { model: string; keyIndex: number }): Promise<ProviderWire>;
}

export interface ProviderWire {
  url: string;
  headers: Record<string, string>;
  /** The model id actually requested (after the provider's own substitutions). */
  model: string;
  format: "gemini" | "openai";
  /** openai format only: which body field caps output (providers disagree). */
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  /** openai format only: send reasoning_effort with this value. */
  reasoningEffort?: string;
}

/** Per-call knobs. `maxOutputTokens`/`disableThinking` let a mechanical caller (the
 *  on-phone operator's step decisions) cap generation and turn OFF a reasoning
 *  model's "thinking" — a large per-step latency win, mirroring the desktop
 *  autopilot's deliberately non-thinking fast model. */
export interface ChatOpts {
  model?: string;
  signal?: AbortSignal;
  maxOutputTokens?: number;
  disableThinking?: boolean;
  /** Which of the provider's keys to use. Free-tier quota is metered per key, so
   *  the route ladder rotates through them rather than re-hitting a spent one. */
  keyIndex?: number;
  /** Abort the HTTP call after this long (default: resilientFetch's 30s). */
  timeoutMs?: number;
}

import { GeminiProvider } from "./gemini";
import { isCompatProvider, OpenAICompatProvider } from "./openaiCompat";

/**
 * Build the provider for the active tier. Fallback across providers/models/keys
 * is the route ladder's job (`routes.ts` + `loop.ts`), not this factory's.
 */
export function makeProvider(cfg: BrainConfig): LLMProvider {
  switch (cfg.tier) {
    case "gemini":
    case "vertex":
      return new GeminiProvider(cfg);
    case "groq":
      return new OpenAICompatProvider(cfg, "groq");
    case "local":
      // TODO(phase-4): on-device model (llama.cpp / MediaPipe LLM) — not yet viable.
      throw new Error("Local on-device LLM is not supported on Android yet.");
  }
}

/**
 * A provider bound to one route's PROVIDER (not its model or key — those ride on
 * ChatOpts). Vertex and Gemini share a client; the tier on `cfg` already decides
 * which endpoint and auth it uses.
 */
export function providerFor(cfg: BrainConfig, provider: string): LLMProvider {
  return isCompatProvider(provider)
    ? new OpenAICompatProvider(cfg, provider)
    : new GeminiProvider(cfg);
}
