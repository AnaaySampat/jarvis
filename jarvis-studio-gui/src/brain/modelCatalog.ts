/**
 * Curated model catalog: real benchmark scores for the model families JARVIS can
 * reach, so smart routing doesn't depend on an LLM's guess.
 *
 * Port of the desktop app's `llm/model_catalog.py` — keep the two tables identical.
 *
 * Scores are the Artificial Analysis Intelligence Index (artificialanalysis.ai,
 * snapshot below). Measured on the desktop, an LLM ranking from search alone was far
 * off: gpt-oss-120b 33-65 (real: 12 at high effort), Gemini 3.1 Pro above 3.8 Flash
 * (real: 30 vs 41). The table is the ground truth; the ranker asks an LLM only about
 * models that aren't in it.
 *
 * Where AA lists several reasoning efforts, the score is the one JARVIS actually
 * runs at: Groq gpt-oss gets reasoning_effort=low; other providers use their
 * default, taken as the middle of the published range. Older models AA no longer
 * tracks sit below their tracked successor (marked "older").
 *
 * To update: re-read the leaderboard, edit KNOWN (here AND on the desktop), bump SNAPSHOT.
 */

export type RankTier = "fast" | "mid" | "flagship";

export const SNAPSHOT = "Sep 2026";

/** At/above this a model is "flagship" (unless it is a small/fast model). */
const FLAGSHIP_MIN = 35;

/** (pattern on the normalized id, score, tier, note). First match wins, so a more
 *  specific pattern must come before a general one. Score -1 = not a chat model. */
const KNOWN: Array<[string, number, RankTier | "", string]> = [
  // ── Google Gemini / Gemma ──
  ["^gemini-3\\.8-flash-lite", 24, "fast", "AA est. (3.5 Flash-Lite 22-24)"],
  ["^gemini-3\\.8-flash", 41, "flagship", "AA 41"],
  ["^gemini-3\\.7-flash", 39, "flagship", "AA 37-40"],
  ["^gemini-3\\.6-flash", 34, "mid", "AA 34"],
  ["^gemini-3\\.5-flash-lite", 22, "fast", "AA 22"],
  ["^gemini-3\\.5-flash", 33, "mid", "AA 33-34"],
  ["^gemini-3\\.1-pro", 30, "mid", "AA 30"],
  ["^gemini-3\\.1-flash-lite", 16, "fast", "AA 16"],
  ["^gemini-3-flash", 26, "mid", "AA 26"],
  ["^gemini-2\\.5-pro", 16, "mid", "AA 16"],
  ["^gemini-2\\.5-flash-lite", 9, "fast", "AA 9"],
  ["^gemini-2\\.5-flash", 13, "mid", "AA 13"],
  ["^gemini-2\\.0-flash-lite", 5, "fast", "older"],
  ["^gemini-2\\.0-flash", 7, "fast", "older"],
  ["^gemma-4-31b", 19, "mid", "AA 19"],
  ["^gemma-4-26b", 17, "mid", "AA 17"],
  ["^gemma-4-12b", 14, "fast", "AA 14"],
  ["^gemma-4-e4b", 9, "fast", "AA 9"],
  ["^gemma-4-e2b", 8, "fast", "AA 8"],
  ["^gemma-3n", 5, "fast", "AA 5"],
  ["^gemma-3-", 5, "fast", "AA 4-5"],
  ["^(recurrent)?gemma-2", 2, "fast", "older"],
  // ── OpenAI open weights (Groq runs them at reasoning_effort=low) ──
  ["^gpt-oss-120b", 10, "mid", "AA 10 (low effort)"],
  ["^gpt-oss-20b", 9, "fast", "AA 9-10"],
  ["^gpt-oss-safeguard", -1, "", "classifier"],
  // Not in NON_CHAT as "omni": that would also drop nemotron-3-nano-omni, the one
  // NVIDIA model known to answer.
  ["^gemini-omni", -1, "", "multimodal generation, not chat"],
  // ── Qwen / Kimi / GLM / DeepSeek / MiniMax ──
  ["^qwen3\\.8-27b", 26, "mid", "AA 20-34 by effort"],
  ["^qwen3\\.6-35b", 18, "mid", "AA 18"],
  ["^qwen3\\.5-9b", 14, "fast", "AA 14"],
  ["^qwen3\\.5-4b", 13, "fast", "AA 13"],
  ["^kimi-k3", 39, "flagship", "AA 34-44 by effort"],
  ["^kimi-k2\\.7", 26, "mid", "AA 26"],
  ["^glm-5\\.3-flash", 42, "flagship", "AA 42"],
  ["^glm-5\\.3", 40, "flagship", "AA 45 max effort"],
  ["^deepseek-v4\\.1-flash", 35, "flagship", "AA 39 max effort"],
  ["^deepseek-coder", 1, "fast", "older"],
  ["^minimax-m3", 29, "mid", "AA 29"],
  // ── NVIDIA Nemotron ──
  ["^nemotron-3-ultra", 23, "mid", "AA 23"],
  ["^nemotron-3\\.5-lightning", 13, "fast", "AA 13"],
  ["^nemotron-3-super", 13, "mid", "AA 13"],
  ["^nemotron-3-nano-omni", 10, "fast", "AA 10"],
  ["^nemotron-(3-nano|nano-3)", 9, "fast", "AA 9"],
  ["^llama-3\\.1-nemotron-ultra", 8, "mid", "AA 8"],
  ["^llama-3\\.1-nemotron-70b", 5, "mid", "older"],
  ["^llama-3\\.1-nemotron-51b", 4, "mid", "older"],
  ["^nemotron-4-340b", 4, "mid", "older"],
  ["^mistral-nemo-minitron", 2, "fast", "older"],
  ["^llama3-chatqa", 2, "mid", "older"],
  // ── Meta Llama ──
  ["^llama-4-maverick", 10, "mid", "AA 10"],
  ["^llama-4-scout", 8, "fast", "AA 8"],
  ["^llama-3\\.3-70b", 8, "mid", "AA 8"],
  ["^llama-3\\.1-405b", 7, "mid", "AA 7"],
  ["^llama-3\\.2-90b", 6, "mid", "AA 6"],
  ["^llama-3\\.2-11b", 5, "fast", "AA 5"],
  ["^llama-?2", 1, "fast", "older"],
  ["^muse-glimmer", 17, "mid", "AA 17"],
  // ── Mistral (Mistral API ids and NVIDIA-hosted ones) ──
  ["^mistral-large-2(-|$)", 4, "mid", "older"],
  ["^mistral-large-(latest|3|25)", 9, "mid", "AA 9"],
  ["^mistral-large$", 4, "mid", "older"],
  ["^mistral-medium", 14, "mid", "AA 14"],
  ["^mistral-small", 11, "fast", "AA 9-11"],
  ["^magistral-medium", 12, "mid", "AA 12"],
  ["^magistral-small", 9, "fast", "AA 9"],
  ["^ministral-(3-)?14b|^ministral-14b", 6, "fast", "AA 6"],
  ["^ministral", 5, "fast", "AA 5"],
  ["^mistral-7b", 2, "fast", "older"],
  ["^mistral-nemo-\\d", 3, "fast", "older"], // not mistral-nemotron (2025)
  ["^mixtral", 3, "mid", "older"],
  ["^(codestral|devstral)", 6, "mid", "coding model"],
  ["^pixtral", 5, "mid", "older"],
  // ── Others seen on NVIDIA / OpenRouter / Groq ──
  ["^inkling-small", 28, "fast", "AA 28"],
  ["^inkling", 25, "mid", "AA 25"],
  ["^ling-3\\.0-flash-fin", 23, "mid", "AA 23"],
  ["^ling-3\\.0-flash", 25, "mid", "AA 25"],
  ["^north-mini-code", 10, "fast", "AA 10"],
  ["^lfm-?2\\.5-2\\.6b", 8, "fast", "AA 8"],
  ["^jamba-1\\.7", 6, "mid", "AA 6"],
  ["^jamba", 4, "mid", "older"],
  ["^phi-4", 6, "fast", "AA 6"],
  ["^phi-3", 2, "fast", "older"],
  ["^granite-4\\.2-30b", 15, "mid", "AA 15"],
  ["^granite-4\\.2-8b", 11, "fast", "AA 11"],
  ["^granite", 2, "fast", "older"],
  ["^(yi-large|dbrx)", 2, "mid", "older"],
  ["^(sea-lion|zamba2|allam)", 2, "fast", "older / small"],
  ["^palmyra", 4, "mid", "domain model"],
];
const KNOWN_RE = KNOWN.map(([p, ...rest]) => [new RegExp(p), ...rest] as const);

/** Not general chat models — never routed to, whatever an LLM says. */
const NON_CHAT = new RegExp(
  "embed|guard|safety|reward|rerank|retriev|whisper|tts|transcribe|parse|ocr|" +
    "clip|robotics|computer-use|image|imagen|veo|lyria|detector|calibration|" +
    "deplot|kosmos|diffusion|safeguard|cosmos-reason|deep-research|antigravity|" +
    "nano-banana|orpheus|fuyu|neva|vila|translate|starcoder|codegemma|codellama",
);

/** Aliases that silently re-point to another model; the concrete ids are ranked. */
const ALIAS = /-latest$/;
const ALIAS_OK = /^(mistral|magistral|ministral|codestral|devstral|pixtral)/;

/** Whole tokens only: a bare "mini" would match inside "gemini". */
const SPEED =
  /(^|[-_.])(lite|mini|nano|tiny|small|xs|instant|lightning|haiku|e\d+b|[1-9]b|1[0-4]b)([-_.:]|$)/;

/** "nvidia/nemotron-3-super-120b-a12b:free" → "nemotron-3-super-120b-a12b". */
export function normalize(model: string): string {
  const m = (model || "")
    .trim()
    .toLowerCase()
    .replace(/:free$/, "");
  return m.slice(m.lastIndexOf("/") + 1);
}

/** Non-chat models, and auto-updating aliases (their target is ranked itself). */
export function excluded(model: string): boolean {
  const n = normalize(model);
  if (NON_CHAT.test(n)) return true;
  return ALIAS.test(n) && !ALIAS_OK.test(n);
}

export type CatalogHit = { chat: false } | { score: number; tier: RankTier; basis: string };

/** Score for a known family, {chat:false} for a known non-chat model, null when
 *  the table doesn't know it. */
export function lookup(model: string): CatalogHit | null {
  const n = normalize(model);
  for (const [re, score, tier, note] of KNOWN_RE) {
    if (!re.test(n)) continue;
    if (score < 0) return { chat: false };
    return {
      score,
      tier: tier as RankTier,
      basis: note.startsWith("AA") ? `${note} (${SNAPSHOT})` : note,
    };
  }
  return null;
}

/** Tier for a model the table doesn't know: small/fast by name, else by score. */
export function tierFor(model: string, score: number): RankTier {
  if (SPEED.test(normalize(model))) return "fast";
  return score >= FLAGSHIP_MIN ? "flagship" : "mid";
}

/** Conservative score for an unknown model with no LLM estimate: below every
 *  tracked current model of its class, so it is only a late fallback. */
export function guessScore(model: string): number {
  return SPEED.test(normalize(model)) ? 4 : 6;
}

/** Known scores as reference points for the LLM that estimates unknown models. */
export function anchors(limit = 40): string {
  const rows = KNOWN.filter(([, s, , note]) => s > 0 && note.startsWith("AA")).map(
    ([p, s]) =>
      [
        p
          .replace(/^\^|\$$/g, "")
          .replace(/\\/g, "")
          .split("(")[0]!
          .replace(/-+$/, ""),
        s,
      ] as const,
  );
  rows.sort((a, b) => b[1] - a[1]);
  const step = Math.max(1, Math.floor(rows.length / limit));
  return rows
    .filter((_, i) => i % step === 0)
    .slice(0, limit)
    .map(([name, score]) => `- ${name}: ${score}`)
    .join("\n");
}
