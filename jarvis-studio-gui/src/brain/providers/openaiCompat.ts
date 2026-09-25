/**
 * OpenAI-compatible providers — Groq, OpenRouter, Mistral and NVIDIA NIM share one
 * chat-completions wire shape, so they share this one class, parameterised by preset.
 *
 * Why more than Groq: the user runs on free tiers only, and every free tier has a
 * small per-minute and per-day ceiling. Pooling several providers' free quota — each
 * behind the same quota.ts pacing — is the only zero-cost way to more headroom.
 * Their model ids are DISCOVERED (providers/catalog.ts), never pinned: OpenRouter's
 * free catalog in particular turns over within weeks.
 */

import type { BrainConfig } from "../config";
import type { ChatMessage, ToolCall, ToolDeclaration } from "../types";
import { toOpenAITools } from "../tools/registry";
import { platformFetch } from "../tools/httpClient";
import { GROQ_DEFAULT } from "../resolveConfig";
import { ProviderError, retryAfterMsFrom } from "../errorClass";
import * as quota from "../quota";
import type { ChatOpts, LLMProvider, LLMReply, ProviderWire } from "./index";

export interface CompatPreset {
  label: string;
  chatUrl: string;
  modelsUrl: string;
  /** Groq takes `max_completion_tokens`; Mistral, OpenRouter and NVIDIA take `max_tokens`. */
  maxTokensField: "max_completion_tokens" | "max_tokens";
  /** Groq accepts `reasoning_effort` on gpt-oss/qwen; elsewhere it is left out. */
  reasoningEffort?: boolean;
}

export const OPENAI_COMPAT = {
  groq: {
    label: "Groq",
    chatUrl: "https://api.groq.com/openai/v1/chat/completions",
    modelsUrl: "https://api.groq.com/openai/v1/models",
    maxTokensField: "max_completion_tokens",
    reasoningEffort: true,
  },
  openrouter: {
    label: "OpenRouter",
    chatUrl: "https://openrouter.ai/api/v1/chat/completions",
    modelsUrl: "https://openrouter.ai/api/v1/models",
    maxTokensField: "max_tokens",
  },
  mistral: {
    label: "Mistral",
    chatUrl: "https://api.mistral.ai/v1/chat/completions",
    modelsUrl: "https://api.mistral.ai/v1/models",
    maxTokensField: "max_tokens",
  },
  nvidia: {
    label: "NVIDIA NIM",
    chatUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
    modelsUrl: "https://integrate.api.nvidia.com/v1/models",
    maxTokensField: "max_tokens",
  },
} satisfies Record<string, CompatPreset>;

export type CompatId = keyof typeof OPENAI_COMPAT;

/** The pooled free providers, in the order the ladder tries them after Gemini/Groq.
 *  Mistral last: its free tier trains on what it's sent. */
export const EXTRA_PROVIDERS = ["openrouter", "nvidia", "mistral"] as const;
export type ExtraProviderId = (typeof EXTRA_PROVIDERS)[number];

export function isCompatProvider(id: string): id is CompatId {
  return Object.prototype.hasOwnProperty.call(OPENAI_COMPAT, id);
}

export class OpenAICompatProvider implements LLMProvider {
  readonly name: CompatId;
  private readonly preset: CompatPreset;
  constructor(
    private cfg: BrainConfig,
    id: CompatId = "groq",
  ) {
    this.name = id;
    this.preset = OPENAI_COMPAT[id];
  }

  private key(keyIndex: number): string {
    const key = this.cfg.keys[this.name]?.[keyIndex];
    if (!key) throw new Error(`${this.preset.label} API key missing`);
    return key;
  }

  /** Only Groq has a sensible default to swap a Gemini id for; the pooled providers'
   *  routes always carry a discovered model id of their own. */
  private model(requested: string): string {
    return this.name === "groq" && /^(gemini|gemma)/i.test(requested) ? GROQ_DEFAULT : requested;
  }

  /** Where and how the native phone operator should POST for this route. */
  async wire(route: { model: string; keyIndex: number }): Promise<ProviderWire> {
    const model = this.model(route.model);
    return {
      url: this.preset.chatUrl,
      headers: { Authorization: `Bearer ${this.key(route.keyIndex)}` },
      model,
      format: "openai",
      maxTokensField: this.preset.maxTokensField,
      ...(this.preset.reasoningEffort && /gpt-oss|qwen/i.test(model)
        ? { reasoningEffort: "low" }
        : {}),
    };
  }

  async chat(
    messages: ChatMessage[],
    tools: ToolDeclaration[],
    opts?: ChatOpts,
  ): Promise<LLMReply> {
    const keyIndex = opts?.keyIndex ?? 0;
    const key = this.key(keyIndex);
    const model = this.model(opts?.model ?? this.cfg.model);

    const body = {
      model,
      messages: toOpenAIMessages(messages),
      ...(tools.length ? { tools: toOpenAITools(tools), tool_choice: "auto" as const } : {}),
      // Cap generation for mechanical callers. Turn reasoning down too, but ONLY
      // where the field is accepted — a plain llama 400s on an unknown param.
      ...(opts?.maxOutputTokens ? { [this.preset.maxTokensField]: opts.maxOutputTokens } : {}),
      ...(opts?.disableThinking && this.preset.reasoningEffort && /gpt-oss|qwen/i.test(model)
        ? { reasoning_effort: "low" as const }
        : {}),
    };

    const res = await platformFetch(opts?.timeoutMs)(this.preset.chatUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: opts?.signal,
    });

    // Groq (and others that send x-ratelimit-* headers) report remaining quota on
    // EVERY response, 200 included — that's what lets the next turn skip a spent
    // route instead of spending a 429 to rediscover it.
    const route: quota.Route = { provider: this.name, model, keyIndex };
    quota.noteResponse(route, res.status, res.headers);

    if (!res.ok) {
      const detail = await res.text();
      throw new ProviderError(`${this.preset.label} ${res.status}`, {
        status: res.status,
        retryAfterMs: retryAfterMsFrom(res.headers, detail),
        // Long enough for errorClass.limitWindow to see which quota window hit.
        detail: detail.slice(0, 2_000),
      });
    }
    const json = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
        };
      }>;
    } | null;
    const msg = json?.choices?.[0]?.message ?? {};
    const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((tc, i) => ({
      id: tc.id ?? `${this.name}-${i}`,
      name: tc.function?.name ?? "",
      args: safeParse(tc.function?.arguments),
    }));
    const text = (msg.content ?? "").trim();
    // A 200 with nothing in it is a failed call, not an answer: OpenRouter's free
    // nemotron did this 3× in a row on 2026-09-23 and the reply would have been
    // blank. As a 5xx the ladder benches the route briefly and tries the next one.
    if (!text && !toolCalls.length) {
      throw new ProviderError(`${this.preset.label} returned an empty reply`, {
        status: 502,
        detail: JSON.stringify(json ?? null).slice(0, 2_000),
      });
    }
    quota.onSuccess(route);
    return { text, toolCalls };
  }
}

function toOpenAIMessages(messages: ChatMessage[]) {
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === "system") {
      out.push({ role: "system", content: m.content });
      continue;
    }
    if (m.role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: m.toolCallId ?? "call_0",
        content: m.content,
      });
      continue;
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc, i) => ({
          id: tc.id ?? `call_${i}`,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
        })),
      });
      continue;
    }
    out.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    });
  }
  return out;
}

function safeParse(s: unknown): Record<string, unknown> {
  if (typeof s !== "string") return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
