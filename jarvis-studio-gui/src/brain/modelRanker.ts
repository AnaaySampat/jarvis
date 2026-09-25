/**
 * Smart routing: rank every model the user's keys can reach, and send each turn to
 * the weakest model that is still good enough.
 *
 * Port of the desktop app's `llm/model_ranker.py` + `groq_bridge.rank_models`.
 *
 * Scores come from real benchmarks first (modelCatalog.ts — the Artificial Analysis
 * Intelligence Index). A Gemini call with Google Search is asked ONLY about models
 * the catalog doesn't know, with the catalog's real values as anchors, and only when
 * the user presses Re-rank (it spends shared Gemini quota); answers are cached until
 * the next press. There is deliberately no ungrounded fallback — measured on the desktop, a
 * from-memory ranking put 2024 models at the top. Tiers come from rules, never the LLM.
 *
 * Scoring is deterministic, so the ranking is recomputed whenever the reachable
 * models change: a key added or removed, a provider's listing changing.
 *
 * Unlike the desktop, a model here is a (provider, model) pair, not a prefixed id —
 * the route ladder already carries both.
 */

import * as catalog from "./modelCatalog";
import type { RankTier } from "./modelCatalog";
import { makeKV, readJson, writeJson, type KV } from "./memory/store";
import { postJson } from "./tools/httpClient";
import { liveModelId } from "./modelRemap";

export type { RankTier };
export const TIERS: RankTier[] = ["fast", "mid", "flagship"];

export interface RankedModel {
  provider: string;
  model: string;
  /** Artificial Analysis Intelligence Index (or an anchored estimate). */
  score: number;
  /** What kind of turn it is good enough for. */
  tier: RankTier;
  /** Native function calling works (only an observed rejection turns this off). */
  tools: boolean;
  source: "benchmark" | "llm" | "guess";
  basis: string;
}

type Estimate = { chat: false } | { score: number; basis: string };

interface RankState {
  rankedAt: number;
  models: RankedModel[];
  /** Discovered chat models per provider — what `models` was computed from. */
  available: Record<string, string[]>;
  /** Cached LLM estimates, keyed by NORMALIZED name (same model, every provider). */
  estimates: Record<string, Estimate>;
  estimatedBy: string;
  /** "provider/model" pairs seen rejecting tool calls. Survives re-ranking. */
  noTools: string[];
  lastResult: string;
}

// v2: v1's `noTools` was filled by a detector that fired on any tool-shaped 400 and
// benched Gemini 3.6/3.5-flash from every action turn. Discovery refills the rest.
const STORAGE_KEY = "jarvis.ranking.v2";
const BATCH = 30;
/** Estimates on another scale (e.g. LMArena Elo ~1200) are rejected whole. */
const MAX_ESTIMATE = 70;
/** Searching ~30 models is a minutes-long job, not a chat turn. */
const ESTIMATE_TIMEOUT_MS = 180_000;
/** Grounded models to ask, best first (remapped if Google retired one). */
const ESTIMATORS = ["gemini-3.6-flash", "gemini-3.5-flash"];

let kv: KV | null = null;
let state: RankState | null = null;
let inProgress = false;
const listeners = new Set<() => void>();

function store(): KV {
  if (!kv) kv = makeKV();
  return kv;
}

function empty(): RankState {
  return {
    rankedAt: 0,
    models: [],
    available: {},
    estimates: {},
    estimatedBy: "",
    noTools: [],
    lastResult: "",
  };
}

function load(): RankState {
  if (!state) state = { ...empty(), ...readJson<Partial<RankState>>(store(), STORAGE_KEY, {}) };
  return state;
}

function save(): void {
  writeJson(store(), STORAGE_KEY, load());
  for (const fn of listeners) fn();
}

/** Test seam: swap in a fake KV and forget the in-memory copy. */
export function setRankerStorage(next: KV | null): void {
  kv = next;
  state = null;
  inProgress = false;
}

/** Re-render hook for Settings. Returns the unsubscribe. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const pairKey = (provider: string, model: string) => `${provider}/${model}`;

// ── Scoring ──────────────────────────────────────────────────────────────────

/** Rank every (provider, model), best first. Pure: catalog score, else the cached
 *  estimate, else a conservative guess that keeps an unscored model behind every
 *  scored one of its class. */
export function compute(
  available: Record<string, string[]>,
  estimates: Record<string, Estimate> = {},
  noTools: string[] = [],
): RankedModel[] {
  const rows: RankedModel[] = [];
  const seen = new Set<string>();
  for (const [provider, ids] of Object.entries(available)) {
    for (const model of ids) {
      const k = pairKey(provider, model);
      if (seen.has(k) || catalog.excluded(model)) continue;
      seen.add(k);
      const known = catalog.lookup(model);
      let score: number, tier: RankTier, basis: string, source: RankedModel["source"];
      if (known) {
        if ("chat" in known) continue;
        ({ score, tier, basis } = known);
        source = "benchmark";
      } else {
        const est = estimates[catalog.normalize(model)];
        if (est && "chat" in est) continue;
        if (est) {
          ({ score, basis } = est);
          source = "llm";
        } else {
          score = catalog.guessScore(model);
          basis = "no benchmark data yet";
          source = "guess";
        }
        tier = catalog.tierFor(model, score);
      }
      rows.push({
        provider,
        model,
        score: Math.round(score * 10) / 10,
        tier,
        tools: !noTools.includes(k),
        source,
        basis: basis.slice(0, 80),
      });
    }
  }
  return rows.sort((a, b) => b.score - a.score || a.model.localeCompare(b.model));
}

/** Chat models the benchmark catalog doesn't cover (normalized, de-duplicated). */
export function unknownModels(available: Record<string, string[]>): string[] {
  const out = new Set<string>();
  for (const ids of Object.values(available)) {
    for (const m of ids) {
      if (!catalog.excluded(m) && !catalog.lookup(m)) out.add(catalog.normalize(m));
    }
  }
  return [...out];
}

function recompute(s: RankState): void {
  s.models = compute(s.available, s.estimates, s.noTools);
  s.rankedAt = Date.now();
  const n = (src: string) => s.models.filter((m) => m.source === src).length;
  s.lastResult =
    `Ranked ${s.models.length} models: ${n("benchmark")} from benchmarks` +
    (n("llm") ? `, ${n("llm")} estimated` : "") +
    (n("guess") ? `, ${n("guess")} unscored` : "") +
    ".";
}

/**
 * Discovery results in, ranking out. `null` for a provider keeps what it had (a
 * failed listing shouldn't drop working routes); `[]` clears it (its key was
 * removed). Synchronous — the benchmark ranking is usable immediately.
 */
export function recordDiscovered(lists: Record<string, string[] | null>): void {
  const s = load();
  let changed = false;
  for (const [provider, ids] of Object.entries(lists)) {
    if (ids === null) continue;
    const prev = s.available[provider] ?? [];
    if (prev.length === ids.length && prev.every((m, i) => m === ids[i])) continue;
    if (ids.length) s.available[provider] = [...ids];
    else delete s.available[provider];
    changed = true;
  }
  if (!changed && s.models.length) return;
  recompute(s);
  save();
}

// ── Routing ──────────────────────────────────────────────────────────────────

export function hasRanking(): boolean {
  return load().models.length > 0;
}

/** Below this a model is worse than no answer: on 2026-09-25 the phone operator's
 *  ladder held groq/allam-2-7b (AA 2), whose replies aren't usable commands — each
 *  one burns a step. Above the unscored guesses (4/6), so a new model still gets in. */
const MIN_ROUTE_SCORE = 3;

/** Models to try, in order, for a turn that needs `tier`: that tier best-first,
 *  then each stronger tier, then (last resort) the weaker ones. */
export function ladder(
  tier: RankTier,
  needsTools: boolean,
  allowed: (provider: string) => boolean,
): Array<{ provider: string; model: string }> {
  const want = TIERS.indexOf(tier);
  const group = (m: RankedModel) => {
    const t = TIERS.indexOf(m.tier);
    return t === want ? 0 : t > want ? t - want : 10 + (want - t);
  };
  return load()
    .models.filter(
      (m) => m.score >= MIN_ROUTE_SCORE && allowed(m.provider) && (m.tools || !needsTools),
    )
    .sort((a, b) => group(a) - group(b) || b.score - a.score)
    .map(({ provider, model }) => ({ provider, model }));
}

/** A provider rejected tool calling for this model — remember it (it survives
 *  re-ranking) so action turns route past it instead of re-paying the 400. */
export function markNoTools(provider: string, model: string): void {
  const s = load();
  const k = pairKey(provider, model);
  if (s.noTools.includes(k)) return;
  s.noTools.push(k);
  for (const m of s.models) if (pairKey(m.provider, m.model) === k) m.tools = false;
  save();
  console.warn(`[ranker] ${k} rejected tool calls — excluded from action turns`);
}

/** What the Settings panel shows. */
export function summary() {
  const s = load();
  const counts = { benchmark: 0, llm: 0, guess: 0 };
  for (const m of s.models) counts[m.source]++;
  return {
    in_progress: inProgress,
    last_result: s.lastResult,
    ranked_at: s.rankedAt || null,
    catalog: catalog.SNAPSHOT,
    estimated_by: s.estimatedBy,
    counts,
    models: s.models,
  };
}

// ── Estimating the models the catalog doesn't know ───────────────────────────

const ESTIMATE_SYSTEM =
  "You estimate how capable large language models are, for the model router of a " +
  "voice assistant. Use Google Search to look up each model — its Artificial " +
  "Analysis Intelligence Index if published, else its release date, size and " +
  "published benchmarks — rather than memory. Answer with ONLY a JSON array.";

export function estimatePrompt(ids: string[], today: string): string {
  return [
    `Today is ${today}. Estimate each model's Artificial Analysis Intelligence ` +
      "Index. For reference, these are REAL current values on that scale:",
    catalog.anchors(),
    "",
    "Models to estimate (copy each id exactly):",
    ...ids.map((i) => `- ${i}`),
    "",
    'Return [{"id": "<id>", "score": <number on the scale above>, ' +
      '"basis": "<max 8 words: where the estimate came from>"}]. Use the published ' +
      "value when one exists; otherwise compare with the reference models of the " +
      "same generation and size. A model that is not a general chat model (speech, " +
      'image, embedding, OCR, safety classifier, translation-only) gets {"id": ' +
      '"<id>", "chat": false}.',
  ].join("\n");
}

function extractJsonArray(text: string): unknown {
  let t = (text || "").trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fence) t = fence[1]!.trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** {normalized id: estimate} for the ids asked about. Anything else is dropped;
 *  a batch on another scale is rejected whole. */
export function parseEstimates(text: string, ids: string[]): Record<string, Estimate> {
  const rows = extractJsonArray(text);
  if (!Array.isArray(rows)) return {};
  const out: Record<string, Estimate> = {};
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const n = catalog.normalize(String(row.id ?? ""));
    if (!ids.includes(n) || n in out) continue;
    if (row.chat === false) {
      out[n] = { chat: false };
      continue;
    }
    const score = Number(row.score);
    if (row.score == null || !Number.isFinite(score)) continue;
    if (score > MAX_ESTIMATE) return {};
    out[n] = {
      score: Math.round(Math.max(0, score) * 10) / 10,
      basis: "est. " + String(row.basis ?? "").slice(0, 70),
    };
  }
  return out;
}

interface GroundedResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

/** (answer, model used) from Gemini + Google Search, or ["", ""] when none answers. */
async function askGrounded(prompt: string, geminiKey: string): Promise<[string, string]> {
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    system_instruction: { parts: [{ text: ESTIMATE_SYSTEM }] },
    tools: [{ google_search: {} }],
    // No maxOutputTokens: thinking tokens count against it (see tools/http.ts webSearch).
    generationConfig: { temperature: 0.2 },
  });
  for (const raw of ESTIMATORS) {
    const model = liveModelId(raw);
    try {
      const json = await postJson<GroundedResponse>(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        body,
        {
          headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
          timeoutMs: ESTIMATE_TIMEOUT_MS,
        },
      );
      const text = (json.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("")
        .trim();
      if (text) return [text, model];
    } catch (err) {
      console.warn(`[ranker] ${model} estimate failed:`, String(err).slice(0, 160));
    }
  }
  return ["", ""];
}

/**
 * Look up every model the catalog doesn't know, and re-rank. ONLY the Re-rank button
 * calls this: each lookup spends the Gemini quota that chat and phone tasks share, and
 * running it on every launch did exactly that. Never throws. Needs a Gemini Developer
 * API key — without one, unknown models stay conservatively placed.
 */
export async function estimateUnknown(geminiKey: string | undefined): Promise<void> {
  if (inProgress) return; // a second press while one runs
  const key = (geminiKey || "").split(/[\n,]/)[0]?.trim() ?? "";
  const s = load();
  const todo = unknownModels(s.available);
  if (!todo.length || !key) {
    recompute(s);
    if (todo.length) {
      s.lastResult += ` ${todo.length} unknown model(s) placed conservatively (needs a Gemini key to look them up).`;
    }
    save();
    return;
  }

  inProgress = true;
  s.estimates = {};
  recompute(s); // the benchmark ranking is usable while the lookup runs
  save();
  try {
    console.info(`[ranker] estimating ${todo.length} model(s): ${todo.join(", ")}`);
    const today = new Date().toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
    const got: Record<string, Estimate> = {};
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      for (let attempt = 0; attempt < 2; attempt++) {
        // one retry for an off-scale/garbled batch
        const [text, by] = await askGrounded(estimatePrompt(batch, today), key);
        const parsed = parseEstimates(text, batch);
        if (by) s.estimatedBy = by;
        if (Object.keys(parsed).length || !text) {
          Object.assign(got, parsed);
          break;
        }
      }
    }
    Object.assign(s.estimates, got);
    const missing = todo.filter((n) => !(n in got));
    recompute(s);
    if (missing.length) {
      s.lastResult += ` ${missing.length} couldn't be estimated (web search unavailable) — placed conservatively; Re-rank later to retry.`;
    }
  } finally {
    inProgress = false;
    save();
  }
}
