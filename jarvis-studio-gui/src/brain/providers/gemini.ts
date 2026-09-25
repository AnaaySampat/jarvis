/**
 * Gemini / Vertex provider (BYO Google API key over HTTP).
 *
 * Uses the Vertex AI global endpoint when tier=vertex and a project id is set;
 * otherwise the Gemini Developer API (generativelanguage.googleapis.com).
 * API keys (AIza… / AQ.…) authenticate via ?key=; OAuth tokens (ya29.…) via Bearer.
 */

import type { BrainConfig } from "../config";
import type { ChatMessage, ToolCall, ToolDeclaration } from "../types";
import { toGeminiTools } from "../tools/registry";
import { platformFetch } from "../tools/httpClient";
import { GEMINI_DEFAULT, VERTEX_DEFAULT } from "../resolveConfig";
import { getAccessToken, extractProjectId } from "./vertexAuth";
import { ProviderError, retryAfterMsFrom } from "../errorClass";
import * as quota from "../quota";
import type { ChatOpts, LLMProvider, LLMReply, ProviderWire } from "./index";

/** Build a Gemini `generationConfig` from the per-call knobs. Turning thinking off is
 *  generation-specific (measured 2026-09-25): 2.5 takes thinkingBudget=0 and 400s on
 *  thinkingLevel; 3.x 400s on budget 0 and takes thinkingLevel="minimal". Mirrors
 *  NativeOperator.kt `thinkingOff`. */
function genConfig(model: string, opts?: ChatOpts): Record<string, unknown> | undefined {
  const cfg: Record<string, unknown> = {};
  if (opts?.maxOutputTokens && opts.maxOutputTokens > 0) cfg.maxOutputTokens = opts.maxOutputTokens;
  // Gemma 4 thinks by default and ignores includeThoughts:false, so its reasoning came
  // back as extra text parts and was spoken as the answer (2026-09-25). It's a fast-tier
  // fallback — the thinking was also the source of its 30s timeouts — so always minimal
  // (Gemma takes minimal|high only, and 400s on thinkingBudget).
  if (/gemma-4/i.test(model)) {
    cfg.thinkingConfig = { thinkingLevel: "minimal" };
  } else if (opts?.disableThinking && /gemini-2\.5/i.test(model)) {
    cfg.thinkingConfig = { thinkingBudget: 0 };
  } else if (opts?.disableThinking && /gemini-[3-9]/i.test(model)) {
    cfg.thinkingConfig = { thinkingLevel: "minimal" };
  }
  return Object.keys(cfg).length ? cfg : undefined;
}

const DEV_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const VERTEX_LOCATION = "global";
const SAFE_MODEL = GEMINI_DEFAULT;
// Vertex has its own publisher-model lifecycle (see resolveConfig.ts) — never fall
// back to the Developer API's default here, it 404s on Vertex.
const VERTEX_SAFE_MODEL = VERTEX_DEFAULT;

function authForKey(key: string): {
  query: Record<string, string>;
  headers: Record<string, string>;
} {
  const k = (key || "").trim();
  if (k.startsWith("ya29.")) {
    return { query: {}, headers: { Authorization: `Bearer ${k}` } };
  }
  // A header, not ?key=: URLs end up in logs and error strings; headers don't.
  return { query: {}, headers: { "x-goog-api-key": k } };
}

export class GeminiProvider implements LLMProvider {
  readonly name: string;
  constructor(private cfg: BrainConfig) {
    this.name = cfg.tier === "vertex" ? "vertex" : "gemini";
  }

  async chat(
    messages: ChatMessage[],
    tools: ToolDeclaration[],
    opts?: ChatOpts,
  ): Promise<LLMReply> {
    const keyIndex = opts?.keyIndex ?? 0;
    const t = await this.target(opts?.model ?? this.cfg.model, keyIndex);
    const body = JSON.stringify(buildRequest(messages, tools, genConfig(t.model, opts)));
    const res = await platformFetch(opts?.timeoutMs)(t.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...t.headers },
      body,
      signal: opts?.signal,
    });
    // Vertex authenticates with the Service Account JSON, not an API key — one
    // credential, so that route always sits at index 0.
    return t.serviceAccount
      ? this.finalize(res, "vertex", { provider: "vertex", model: t.model, keyIndex: 0 })
      : this.finalize(res, this.name, { provider: this.name, model: t.model, keyIndex });
  }

  /** Where and how the native phone operator should POST for this route. */
  async wire(route: { model: string; keyIndex: number }): Promise<ProviderWire> {
    const t = await this.target(route.model, route.keyIndex);
    return { url: t.url, headers: t.headers, model: t.model, format: "gemini" };
  }

  /** Shared response handling for both auth paths: status check, parse.
   *
   *  Google publishes no x-ratelimit-* headers, so unlike Groq there is nothing to
   *  read on a success — this route's ceilings are learned from its failures. The
   *  noteResponse call still runs so a Retry-After on a 429 is captured. */
  private async finalize(
    res: Response,
    providerLabel: string,
    route: quota.Route,
  ): Promise<LLMReply> {
    quota.noteResponse(route, res.status, res.headers);
    if (!res.ok) {
      const detail = await res.text();
      throw new ProviderError(`${providerLabel} ${res.status}`, {
        status: res.status,
        retryAfterMs: retryAfterMsFrom(res.headers, detail),
        // Long enough to reach Gemini's quotaId (…PerMinute… / …PerDay…), which
        // sits deep in its 429 body — errorClass.limitWindow reads it.
        detail: detail.slice(0, 2_000),
      });
    }
    quota.onSuccess(route);
    return parseResponse(await res.json());
  }

  private endpoint(model: string, action: string): string {
    if (this.cfg.tier === "vertex") {
      const project = (this.cfg.vertexProject || "").trim();
      const region = (this.cfg.vertexRegion || VERTEX_LOCATION).trim() || VERTEX_LOCATION;
      if (project) {
        return (
          `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}` +
          `/locations/${encodeURIComponent(region)}/publishers/google/models/${model}:${action}`
        );
      }
    }
    return `${DEV_API_BASE}/models/${model}:${action}`;
  }

  /**
   * The URL + auth headers for one generateContent call on this route — the single
   * place endpoint and credential knowledge lives, used by chat() and by wire().
   * With a Service Account configured it is Vertex over the JWT→OAuth2 flow;
   * otherwise an API key (AIza…/AQ.… via ?key=, a ya29. token via Bearer).
   */
  private async target(
    requested: string,
    keyIndex: number,
  ): Promise<{
    url: string;
    headers: Record<string, string>;
    model: string;
    serviceAccount: boolean;
  }> {
    if (this.cfg.tier === "vertex" && this.cfg.vertexServiceAccountJson) {
      const saJson = this.cfg.vertexServiceAccountJson;
      const token = await getAccessToken(saJson);
      const project = this.cfg.vertexProject || extractProjectId(saJson);
      const region = (this.cfg.vertexRegion || VERTEX_LOCATION).trim() || VERTEX_LOCATION;
      // The "global" location is a bare host (no region subdomain) — every other
      // region is billed/routed through a region-pinned subdomain instead.
      const host =
        region.toLowerCase() === "global"
          ? "aiplatform.googleapis.com"
          : `${region}-aiplatform.googleapis.com`;
      const model = /^(gemini|gemma)/i.test(requested) ? requested : VERTEX_SAFE_MODEL;
      return {
        url: `https://${host}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(region)}/publishers/google/models/${model}:generateContent`,
        headers: { Authorization: `Bearer ${token}` },
        model,
        serviceAccount: true,
      };
    }
    const key = this.cfg.keys.gemini?.[keyIndex];
    if (!key) throw new Error("Google API key missing — add it in Settings.");
    const model = /^(gemini|gemma)/i.test(requested) ? requested : SAFE_MODEL;
    const { query, headers } = authForKey(key);
    const url = new URL(this.endpoint(model, "generateContent"));
    Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
    const project = (this.cfg.vertexProject || "").trim();
    if (this.cfg.tier === "vertex" && project) {
      headers["x-goog-user-project"] = project;
    }
    return { url: url.toString(), headers, model, serviceAccount: false };
  }
}

export function buildRequest(
  messages: ChatMessage[],
  tools: ToolDeclaration[],
  generationConfig?: Record<string, unknown>,
) {
  const systemParts: string[] = [];
  const contents: Array<{ role: string; parts: unknown[] }> = [];
  // Tracks the in-progress "user" turn merging a RUN of consecutive tool-result
  // messages. loop.ts emits one `role:"tool"` ChatMessage per call when the model
  // makes several tool calls in one turn (runTurn's inner for-loop) — Gemini/Vertex
  // requires ALL of those functionResponse parts to land in a SINGLE following
  // turn, matching the model turn's functionCall part count 1:1. Emitting one
  // "user" content entry per tool message (the old behaviour) split them across
  // separate turns instead, which is exactly what produced the Vertex 400 "number
  // of function response parts is equal to the number of function call parts"
  // error on any reply that used more than one tool at once.
  let toolGroup: { role: string; parts: unknown[] } | null = null;

  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
      toolGroup = null;
      continue;
    }
    if (m.role === "tool") {
      const name = m.toolName || m.toolCallId || "tool";
      if (!toolGroup) {
        toolGroup = { role: "user", parts: [] };
        contents.push(toolGroup);
      }
      toolGroup.parts.push({ functionResponse: { name, response: safeJson(m.content) } });
      if (m.images) {
        for (const b64 of m.images) {
          toolGroup.parts.push({ inlineData: { mimeType: "image/jpeg", data: b64 } });
        }
      }
      continue;
    }
    toolGroup = null; // any non-tool message ends the current run
    if (m.role === "assistant" && m.toolCalls?.length) {
      const parts: unknown[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls) {
        parts.push({
          functionCall: { name: tc.name, args: tc.args ?? {} },
          // Must round-trip verbatim on replay or Gemini/Vertex 2.5+ "thinking"
          // models 400 with "missing a thought_signature" from the 2nd+ tool round.
          ...(tc.thoughtSignature ? { thoughtSignature: tc.thoughtSignature } : {}),
        });
      }
      contents.push({ role: "model", parts });
      continue;
    }

    const parts: unknown[] = [];
    if (m.content) parts.push({ text: m.content });
    if (m.images) {
      for (const b64 of m.images) {
        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: b64,
          },
        });
      }
    }
    if (parts.length === 0) continue;
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts,
    });
  }

  return {
    contents,
    ...(systemParts.length
      ? { systemInstruction: { parts: [{ text: systemParts.join("\n\n") }] } }
      : {}),
    ...(tools.length ? { tools: [{ functionDeclarations: toGeminiTools(tools) }] } : {}),
    ...(generationConfig ? { generationConfig } : {}),
  };
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return { result: s };
  }
}

interface GeminiPart {
  text?: unknown;
  thought?: unknown;
  functionCall?: { name?: string; args?: unknown };
  thoughtSignature?: unknown;
}

function parseResponse(
  json: { candidates?: Array<{ content?: { parts?: GeminiPart[] } }> } | null,
): LLMReply {
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const p of parts) {
    // Reasoning, not answer — never show or speak it.
    if (typeof p.text === "string" && p.thought !== true) text += p.text;
    if (p.functionCall) {
      toolCalls.push({
        id: `gemini-${toolCalls.length}`,
        name: p.functionCall.name ?? "",
        args: (p.functionCall.args ?? {}) as Record<string, unknown>,
        ...(typeof p.thoughtSignature === "string" ? { thoughtSignature: p.thoughtSignature } : {}),
      });
    }
  }
  return { text: text.trim(), toolCalls };
}
