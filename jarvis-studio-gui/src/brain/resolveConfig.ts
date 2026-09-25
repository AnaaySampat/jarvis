/**
 * Map stored onboarding/settings → BrainConfig.
 * Picks provider tier from explicit provider_mode or the selected model.
 * Tiers on mobile: Vertex AI (Service Account JSON), Gemini Developer API, Groq.
 */

import type { BrainConfig } from "./config";
import { modelClassFor } from "./modelPolicy";

export const GROQ_DEFAULT = "openai/gpt-oss-120b";
// Confirmed live on this account 2026-09-22 (Settings model discovery). Google
// retires ids on a schedule: 2.0-flash and 2.0-flash-lite both 404'd that day with
// "no longer available. Please update your code to use models/gemini-3.6-flash".
// modelRemap.ts now reads that replacement out of the 404 and substitutes it, so a
// stale constant here costs one failed request rather than a day-long outage.
export const GEMINI_DEFAULT = "gemini-3.6-flash";
// Vertex AI's publisher-model catalog is a separate lifecycle from the Gemini Developer
// API's — confirmed live 2026-07-04 that this project's Vertex catalog 404s on
// gemini-2.0-flash (retired from Vertex) while gemini-2.5-flash resolves in both
// "global" and region-pinned locations. Keep Vertex on its own default so a future
// Gemini Developer API deprecation/change doesn't silently break Vertex or vice versa.
// 2026-07-05: matched to the Windows app's verified-working default
// (jarvis-studio-backend/llm/groq_bridge.py DEFAULT_MODEL) — gemini-3.5-flash is the
// flagship/mid-tier default there, confirmed callable on the same project's Vertex
// global endpoint. The mobile app was stuck one generation behind on a stale pick.
export const VERTEX_DEFAULT = "gemini-3.5-flash";

export interface StoredKeys {
  geminiKey?: string;
  groqKey?: string;
  openrouterKey?: string;
  mistralKey?: string;
  nvidiaKey?: string;
  model?: string;
  pinnedLocation?: string;
  /** auto | vertex | gemini | groq | openrouter | nvidia | mistral */
  providerMode?: string;
  vertexSaJson?: string;
}

function isGeminiModel(id: string): boolean {
  return /^(gemini|gemma)/i.test(id);
}

/** Image models are reserved for the image-generation route; they can never be
 * selected as a conversational model, even through the free-form override. */
function isGeminiChatModel(id: string): boolean {
  return isGeminiModel(id) && modelClassFor(id) !== "image";
}

function isGroqModel(id: string): boolean {
  if (!id || isGeminiModel(id)) return false;
  return id.includes("/") || /^llama|^mixtral|^gemma|^qwen|^deepseek|^openai\/gpt-oss/i.test(id);
}

/** Every provider the user can pick in Settings ▸ Models, besides "auto". */
export const SCOPE_PROVIDERS = [
  "vertex",
  "gemini",
  "groq",
  "openrouter",
  "nvidia",
  "mistral",
] as const;

/** The stored provider choice: a provider id, "auto", or "" (never chosen — older
 *  installs, which inferred the provider from the picked model instead). */
function normalizeMode(raw?: string): string {
  const m = (raw || "").trim().toLowerCase();
  return m === "auto" || (SCOPE_PROVIDERS as readonly string[]).includes(m) ? m : "";
}

/**
 * Split one stored secret into the several credentials it may hold, newline- or
 * comma-separated. Free-tier quota is metered per key, so pasting three Groq keys
 * triples the headroom; the storage format stays a single string (no Keystore
 * migration, no new secret fields). Order is preserved and duplicates dropped —
 * the ladder walks these in order, so the user's first key stays their primary.
 */
export function splitKeys(raw?: string): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(/[\n,]/)) {
    const key = part.trim();
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

/** Resolve tier + a concrete model id the chosen provider can actually serve. */
export function resolveBrainConfig(stored: StoredKeys): BrainConfig {
  const keys: BrainConfig["keys"] = {};
  const geminiKeys = splitKeys(stored.geminiKey);
  const groqKeys = splitKeys(stored.groqKey);
  if (geminiKeys.length) keys.gemini = geminiKeys;
  if (groqKeys.length) keys.groq = groqKeys;
  // The pooled free providers only ever add fallback routes (routes.ts).
  for (const [id, raw] of [
    ["openrouter", stored.openrouterKey],
    ["mistral", stored.mistralKey],
    ["nvidia", stored.nvidiaKey],
  ] as const) {
    const split = splitKeys(raw);
    if (split.length) keys[id] = split;
  }
  const pinnedLocation = stored.pinnedLocation || "";
  const picked = (stored.model || "").trim();
  const auto = !picked || picked.toLowerCase() === "auto";
  const mode = normalizeMode(stored.providerMode);

  const geminiCfg = (model: string): BrainConfig => ({
    tier: "gemini",
    model,
    autoModel: auto,
    keys,
    pinnedLocation,
  });

  const groqCfg = (model: string): BrainConfig => ({
    tier: "groq",
    model,
    autoModel: auto,
    keys,
    pinnedLocation,
  });

  const vertexCfg = (model: string): BrainConfig => {
    let project = "";
    try {
      const parsed = JSON.parse(stored.vertexSaJson || "{}");
      project = parsed.project_id || "";
    } catch {
      /* ignore */
    }
    return {
      tier: "vertex",
      model,
      autoModel: auto,
      keys,
      pinnedLocation,
      vertexProject: project,
      // "global" (not a region-pinned subdomain) is the broadest endpoint — it serves
      // both the established Gemini generations and new releases (Gemini 3 series
      // launched global-only) without a per-model region map to keep in sync.
      vertexRegion: "global",
      vertexServiceAccountJson: stored.vertexSaJson,
    };
  };

  // The provider the user scoped routing to. One whose key has since been removed
  // falls back to auto rather than leaving the user with no routes at all.
  const hasKeyFor: Record<string, boolean> = {
    vertex: Boolean(stored.vertexSaJson),
    gemini: Boolean(keys.gemini),
    groq: Boolean(keys.groq),
    openrouter: Boolean(keys.openrouter),
    nvidia: Boolean(keys.nvidia),
    mistral: Boolean(keys.mistral),
  };
  const scope = mode && mode !== "auto" && hasKeyFor[mode] ? mode : "auto";
  const scoped = (c: BrainConfig, providerScope: string): BrainConfig => ({
    ...c,
    providerScope,
  });

  if (scope === "vertex") {
    // Honor the user's picked model when it's one the Gemini family can serve;
    // only fall back to the default on "auto" or a foreign (Groq) model id.
    const model = !auto && isGeminiChatModel(picked) ? picked : VERTEX_DEFAULT;
    return scoped(vertexCfg(model), scope);
  }
  if (scope === "gemini") {
    const model = !auto && isGeminiChatModel(picked) ? picked : GEMINI_DEFAULT;
    return scoped(geminiCfg(model), scope);
  }
  if (scope === "groq") {
    // Anything but a Google id: the picker only offers what Groq's own listing
    // returned, and ids like "allam-2-7b" match no family pattern.
    const model = !auto && picked && !isGeminiModel(picked) ? picked : GROQ_DEFAULT;
    return scoped(groqCfg(model), scope);
  }

  // Google surface + tier for everything the route ladder doesn't choose (and for
  // the ladder's head before the first ranking). Vertex only when it's the one
  // Google credential: GeminiProvider picks its endpoint from the tier, so the
  // tier has to BE vertex for a Vertex route to reach Vertex.
  const autoCfg = (): BrainConfig => {
    if (keys.gemini) return keys.groq ? groqCfg(GROQ_DEFAULT) : geminiCfg(GEMINI_DEFAULT);
    if (stored.vertexSaJson) return vertexCfg(VERTEX_DEFAULT);
    if (keys.groq) return groqCfg(GROQ_DEFAULT);
    return geminiCfg(GEMINI_DEFAULT);
  };

  if (scope !== "auto") {
    // A pooled provider (OpenRouter / NVIDIA / Mistral): its routes come from the
    // ladder; the tier stays a keyed Google/Groq one for everything else.
    return scoped({ ...autoCfg(), model: auto ? "" : picked, autoModel: auto }, scope);
  }

  // No provider chosen but a model is (installs from before the provider choice):
  // the model's family decides.
  if (!auto) {
    if (isGeminiChatModel(picked) && keys.gemini) return scoped(geminiCfg(picked), "gemini");
    if (isGroqModel(picked) && keys.groq) return scoped(groqCfg(picked), "groq");
    if (keys.groq) return scoped(groqCfg(isGroqModel(picked) ? picked : GROQ_DEFAULT), "groq");
    if (keys.gemini)
      return scoped(geminiCfg(isGeminiChatModel(picked) ? picked : GEMINI_DEFAULT), "gemini");
  }

  return scoped({ ...autoCfg(), autoModel: true }, "auto");
}
