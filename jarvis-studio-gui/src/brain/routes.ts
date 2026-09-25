/**
 * The route ladder — every way this config can answer a turn, best first.
 *
 * `resolveConfig` decides what we'd LIKE to answer with. This decides what we
 * actually try when that first choice is unavailable, and (via `quota.ts`)
 * remembers across turns which routes are already spent.
 *
 * The old shape was one provider plus `makeFallback`'s single alternative: a Groq
 * 429 had exactly one place to go, and if that also failed the user was told to
 * come back later. A user with two Groq keys and a Gemini key now has six routes.
 *
 * Mirrors the desktop app's `_model_ladder` in `llm/groq_bridge.py`. Once smart
 * routing has a ranking (modelRanker.ts), it leads: the turn's difficulty picks a
 * tier and every ranked model the keys reach is tried good-enough-tier first. The
 * hardcoded per-provider tiers below stay as the tail, for before the first ranking
 * and for a provider whose listing never came back.
 */

import type { BrainConfig } from "./config";
import { GEMINI_DEFAULT, GROQ_DEFAULT, VERTEX_DEFAULT } from "./resolveConfig";
import { modelClassFor, type ChatModelClass } from "./modelPolicy";
import { liveModelId } from "./modelRemap";
import * as quota from "./quota";
import { catalogModels, isDead } from "./providers/catalog";
import { ladder as rankedLadder, type RankTier } from "./modelRanker";
import { EXTRA_PROVIDERS } from "./providers/openaiCompat";

/** Groq's fast/cheap tier — the last thing to try before giving up on Groq.
 *  Matches the desktop app's `_AUTO_FAST_GROQ`. */
const GROQ_FAST = "openai/gpt-oss-20b";

/**
 * Google's cheapest tier — a smaller model answering beats no answer. Vertex and
 * the Developer API have separate model lifecycles (see resolveConfig.ts), so
 * they get separate picks: each id below appears in that surface's curated list
 * in `providers/models.ts`, and using the other one 404s.
 */
const GOOGLE_FAST: Record<string, string> = {
  vertex: "gemini-2.5-flash-lite",
  gemini: "gemini-3.5-flash", // 2.0-flash-lite retired 2026-09-22
};

/** Best known chat model in each strength bucket for Auto mode. These remain
 * intentionally conservative: the route ladder still tries lower-capability
 * fallbacks if a preferred model is unavailable to the user's key. */
const GOOGLE_SMART: Record<string, string> = {
  vertex: "gemini-2.5-flash",
  gemini: GEMINI_DEFAULT,
};
const GOOGLE_VERY_SMART: Record<string, string> = {
  vertex: VERTEX_DEFAULT,
  // The Gemini Developer API's broadly available default is Flash. Do not send
  // free-tier keys to a Pro SKU merely because a request sounds difficult.
  gemini: GEMINI_DEFAULT,
};

function isGeminiModel(id: string): boolean {
  return /^(gemini|gemma)/i.test(id);
}

/** Credentials that can serve a provider, in the order the user entered them.
 *  Vertex authenticates with Service Account JSON rather than an API key, so it
 *  contributes exactly one (keyless) slot. */
export function keyCountFor(cfg: BrainConfig, provider: string): number {
  if (provider === "vertex") return cfg.vertexServiceAccountJson ? 1 : 0;
  return cfg.keys[provider as keyof BrainConfig["keys"]]?.length ?? 0;
}

/** The Google provider this config actually talks to: Vertex when a Service
 *  Account is configured, else the Gemini Developer API. */
function googleProvider(cfg: BrainConfig): "vertex" | "gemini" {
  return cfg.tier === "vertex" && cfg.vertexServiceAccountJson ? "vertex" : "gemini";
}

const isPooled = (p: string) => (EXTRA_PROVIDERS as readonly string[]).includes(p);

const RANK_TIER: Record<ChatModelClass, RankTier> = {
  dumb: "fast",
  smart: "mid",
  "very-smart": "flagship",
};

/**
 * Every route worth trying, best first — BEFORE quota filtering.
 *
 * The user's choice decides the head and how far the ladder may stray from it:
 *   - a specific model → that model, then (fallback on) its provider's others, then all;
 *   - Auto on one provider → the best of that provider's models for this turn, then
 *     (fallback on) everything else;
 *   - Auto on Auto → the whole ranking. The fallback switch has nothing to pin here.
 * Tail is graceful degradation: same provider first (identical wire shape and tool
 * support, so the switch is invisible), then the others, then the pooled providers.
 */
export function routesFor(
  cfg: BrainConfig,
  requestedClass?: ChatModelClass,
  needsTools = true,
): quota.Route[] {
  const google = googleProvider(cfg);
  const googleDefault = google === "vertex" ? VERTEX_DEFAULT : GEMINI_DEFAULT;
  const scope = cfg.providerScope || "auto";

  const requestedGoogle =
    requestedClass === "dumb"
      ? GOOGLE_FAST[google]!
      : requestedClass === "very-smart"
        ? GOOGLE_VERY_SMART[google]!
        : GOOGLE_SMART[google]!;
  const requestedGroq = requestedClass === "dumb" ? GROQ_FAST : GROQ_DEFAULT;
  const googleModels = cfg.autoModel
    ? [requestedGoogle, GOOGLE_SMART[google]!, GOOGLE_VERY_SMART[google]!, GOOGLE_FAST[google]!]
    : [googleDefault, GOOGLE_FAST[google]!];
  const groqModels = cfg.autoModel
    ? [requestedGroq, GROQ_DEFAULT, GROQ_FAST]
    : [GROQ_DEFAULT, GROQ_FAST];
  /** The built-in models for one provider — what it offers before any ranking. */
  const builtIn = (provider: string): string[] =>
    provider === "groq"
      ? groqModels
      : provider === google
        ? googleModels
        : isPooled(provider)
          ? catalogModels(provider as (typeof EXTRA_PROVIDERS)[number])
          : [];

  const chain: Array<{ provider: string; model: string }> = [];
  const push = (provider: string, rawModel: string) => {
    if (!rawModel) return;
    // Substitute any id Google has told us is retired (see modelRemap.ts). Doing
    // it HERE, at the one place every route model enters the chain, means the
    // constants above, the user's configured model and the Auto-mode picks are
    // all covered by one call. Dedupe AFTER remapping, so two ids that now point
    // at the same live model collapse into one route instead of two identical
    // attempts.
    const model = liveModelId(rawModel);
    if (chain.some((c) => c.provider === provider && c.model === model)) return;
    chain.push({ provider, model });
  };

  // Google appears once — whichever of Vertex/Gemini this config talks to.
  const reachable = (p: string) =>
    (p === "gemini" || p === "vertex" ? p === google : true) && keyCountFor(cfg, p) > 0;
  const rankedFor = (allowed: (p: string) => boolean) =>
    rankedLadder(
      RANK_TIER[requestedClass ?? "smart"],
      needsTools,
      (p) => reachable(p) && allowed(p),
    ).filter((r) => !isDead(r.provider, r.model));
  // Smart routing across providers: every ranked model the keys reach. Pooled free
  // providers stay out of it: interleaved by score they led the ladder, and their
  // shared free pools 429 "upstream" most of the time, so each turn paid a string
  // of failures before reaching a key the user owns (2026-09-25). They keep their
  // place as the tail fallback below — unless the user picked one as the provider.
  const ranked = rankedFor((p) => !isPooled(p));
  const scopedRanked = scope === "auto" ? ranked : rankedFor((p) => p === scope);

  let head: { provider: string; model: string } | null = null;
  if (!cfg.autoModel) {
    const configured = (cfg.model || "").trim();
    const provider = scope !== "auto" ? scope : isGeminiModel(configured) ? google : "groq";
    // Image models only make images; never route chat through one.
    head =
      modelClassFor(configured) === "image"
        ? provider === "groq"
          ? { provider, model: GROQ_DEFAULT }
          : { provider: google, model: googleDefault }
        : { provider, model: configured };
  } else if (scopedRanked.length) {
    // The ranking picks the model: the first one with a route that isn't benched
    // right now (so an Auto config doesn't pin a spent model).
    head =
      scopedRanked.find((r) =>
        Array.from({ length: keyCountFor(cfg, r.provider) }).some((_, keyIndex) =>
          quota.usable({ provider: r.provider, model: liveModelId(r.model), keyIndex }),
        ),
      ) ?? scopedRanked[0]!;
  } else {
    // Before the first ranking: the built-in pick for this turn.
    const provider = scope !== "auto" ? scope : cfg.tier === "groq" ? "groq" : google;
    head = { provider, model: builtIn(provider)[0] ?? "" };
  }
  if (head) push(head.provider, head.model);

  // Automatic switching off keeps every turn inside the user's choice: the one
  // model they picked, or the one provider they picked. Its keys are still walked
  // below: a second key is the same model with its own quota, not a different
  // model answering. Auto on Auto has no choice to stay inside.
  const fallback = cfg.autoSwitchModels !== false;
  const pinnedModel = !cfg.autoModel && !fallback && Boolean(head?.model);
  const pinnedProvider = cfg.autoModel && scope !== "auto" && !fallback;

  if (!pinnedModel) {
    // The chosen provider's other models first (cheapest switch).
    if (scope !== "auto") {
      scopedRanked.forEach((r) => push(r.provider, r.model));
      builtIn(scope).forEach((m) => push(scope, m));
    }
    if (!pinnedProvider) {
      ranked.forEach((r) => push(r.provider, r.model));
      const first = head?.provider === "groq" ? "groq" : google;
      const second = first === "groq" ? google : "groq";
      builtIn(first).forEach((m) => push(first, m));
      builtIn(second).forEach((m) => push(second, m));
      // Then the pooled free providers, each with the models discovered for it
      // (providers/catalog.ts). More free quota, never a replacement for the primary.
      for (const provider of EXTRA_PROVIDERS) builtIn(provider).forEach((m) => push(provider, m));
    }
  }

  const routes: quota.Route[] = [];
  for (const { provider, model } of chain) {
    for (let keyIndex = 0; keyIndex < keyCountFor(cfg, provider); keyIndex++) {
      routes.push({ provider, model, keyIndex });
    }
  }
  return routes;
}

/** routesFor() minus what we already know is spent. Empty means genuinely
 *  exhausted — that, and only that, is when the user hears about a rate limit. */
export function usableRoutes(
  cfg: BrainConfig,
  requestedClass?: ChatModelClass,
  needsTools = true,
): quota.Route[] {
  return routesFor(cfg, requestedClass, needsTools).filter((r) => quota.usable(r));
}
