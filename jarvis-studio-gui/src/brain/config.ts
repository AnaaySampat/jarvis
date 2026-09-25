/**
 * Brain configuration — provider tier, model, and the user's BYO API keys.
 */

import type { ProviderTier } from "./types";

export interface BrainConfig {
  tier: ProviderTier;
  model: string;
  /** True when the user selected Auto rather than pinning a particular model.
   *  Auto mode can then match a request to the dumb/smart/very-smart buckets. */
  autoModel?: boolean;
  /**
   * Which provider the user scoped routing to (Settings ▸ Models ▸ Provider):
   * "auto" routes across every keyed provider; a provider id keeps Auto's pick —
   * and, with fallback off, every route — on that provider. Separate from `tier`,
   * which is the Google endpoint and the client for calls the ladder doesn't pick.
   */
  providerScope?: string;
  /**
   * BYO credentials, one entry per key. Free-tier quota is metered PER KEY, so a
   * user who pastes three Groq keys gets three times the headroom — the route
   * ladder walks them in the order entered. Storage is unchanged (still one
   * string per provider, newline/comma separated); resolveConfig splits it.
   */
  keys: {
    gemini?: string[];
    groq?: string[];
    /** Pooled free providers — fallbacks only, never the primary tier. */
    openrouter?: string[];
    mistral?: string[];
    nvidia?: string[];
  };
  pinnedLocation?: string;
  /** GCP project id for Vertex AI (mobile: paired with Gemini/Vertex API key). */
  vertexProject?: string;
  /** Vertex location — global for Gemini generative calls. */
  vertexRegion?: string;
  /** Shorter, chattier replies (conversation mode). */
  conversationMode?: boolean;
  /** Mirror agenda items into the phone's real calendar. Default on (undefined is
   *  treated as on); writing to someone's actual calendar is outward-facing, so it
   *  gets an explicit off switch rather than being unconditional. */
  calendarSync?: boolean;
  /**
   * Fall back to other models when the chosen one can't answer. Default on
   * (undefined is on) — an answer from a cheaper model beats no answer.
   *
   * Off pins every turn to the configured model, across all of its keys. The
   * ladder still rotates keys, because that's the same model with fresh quota,
   * not a different one answering. When that model is spent the turn fails with
   * a truthful "it's rate-limited" instead of quietly downgrading.
   */
  autoSwitchModels?: boolean;
  /** Service Account JSON (Vertex AI on mobile). */
  vertexServiceAccountJson?: string;
}

export const DEFAULT_CONFIG: BrainConfig = {
  tier: "gemini",
  model: "gemini-3.6-flash",
  keys: {},
};

/** True when the active tier has the credentials it needs to talk to its LLM. */
export function configReady(cfg: BrainConfig): boolean {
  switch (cfg.tier) {
    case "vertex":
      return Boolean(cfg.vertexServiceAccountJson);
    case "gemini":
      return Boolean(cfg.keys.gemini?.length);
    case "groq":
      return Boolean(cfg.keys.groq?.length);
    case "local":
      return true;
  }
}
