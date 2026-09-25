/**
 * Which models the pooled free providers (OpenRouter, NVIDIA NIM, Mistral) should be
 * asked — discovered from each provider's own /models listing, cached on device.
 *
 * Discovered, never pinned. "Every pinned model id is a time bomb" (ARCHITECTURE §2)
 * applies double here: OpenRouter's free catalog listed 21 models on 2026-09-23,
 * none of which existed a few months earlier. So each provider keeps a ranked list of
 * candidates, re-read whenever keys change or the app starts, and routes through the
 * best two that haven't 404'd for this key ([markModelDead]); a provider with no
 * picks simply contributes no routes.
 *
 * `routesFor()` runs synchronously on every turn, so the picks are read from an
 * in-memory copy of the cache; `refreshCatalog()` does the network work.
 */

import { platformFetch } from "../tools/httpClient";
import { makeKV, readJson, writeJson, type KV } from "../memory/store";
import { EXTRA_PROVIDERS, OPENAI_COMPAT, type ExtraProviderId } from "./openaiCompat";
import { recordDiscovered } from "../modelRanker";

const STORAGE_KEY = "jarvis.catalog.v1";
const DEAD_KEY = "jarvis.catalog.dead.v1";
const PICKS_PER_PROVIDER = 2;
/** Ranked candidates kept per provider, so a pick that turns out dead is replaced
 *  from the last listing without another network call. */
const CANDIDATES_PER_PROVIDER = 8;
/** A listed model can 404 for THIS account (NVIDIA lists models a free key can't
 *  call: both 2026-09-23 picks answered "Function not found for account"). Skip it
 *  for a week — long enough not to pay the 404 again, short enough that a new key or
 *  a model that gets deployed is retried. */
const DEAD_FOR_MS = 7 * 24 * 60 * 60 * 1000;

let kv: KV | null = null;
let cache: Partial<Record<ExtraProviderId, string[]>> | null = null;

function store(): KV {
  if (!kv) kv = makeKV();
  return kv;
}

/** Test seam: swap in a fake KV and forget the in-memory copy. */
export function setCatalogStorage(next: KV | null): void {
  kv = next;
  cache = null;
}

const deadKey = (provider: string, model: string) => `${provider}/${model}`;

export function isDead(provider: string, model: string, now = Date.now()): boolean {
  const at = readJson<Record<string, number>>(store(), DEAD_KEY, {})[deadKey(provider, model)];
  return at != null && now - at < DEAD_FOR_MS;
}

/** Record that [model] can't be called with this key (it 404'd), so the next
 *  candidate takes its place in [catalogModels]. */
export function markModelDead(provider: string, model: string, now = Date.now()): void {
  const dead = readJson<Record<string, number>>(store(), DEAD_KEY, {});
  for (const [k, at] of Object.entries(dead)) if (now - at >= DEAD_FOR_MS) delete dead[k];
  dead[deadKey(provider, model)] = now;
  writeJson(store(), DEAD_KEY, dead);
}

/** The model ids to route through [provider], best first. Empty until discovered. */
export function catalogModels(provider: ExtraProviderId): string[] {
  return candidates(provider)
    .filter((m) => !isDead(provider, m))
    .slice(0, PICKS_PER_PROVIDER);
}

/** Every ranked candidate for [provider], dead ones included. */
function candidates(provider: ExtraProviderId): string[] {
  if (!cache) cache = readJson(store(), STORAGE_KEY, {});
  return cache[provider] ?? [];
}

/** Test seam / manual override. */
export function setCatalog(picks: Partial<Record<ExtraProviderId, string[]>>): void {
  cache = { ...picks };
  writeJson(store(), STORAGE_KEY, cache);
}

/**
 * Re-read each keyed provider's model list and keep its best picks. Never throws; a
 * provider that fails keeps its previous picks (a blip shouldn't drop working routes)
 * and one with no key is cleared. Returns how many models each provider now offers.
 */
export async function refreshCatalog(
  keys: Partial<Record<ExtraProviderId, string>>,
): Promise<Partial<Record<ExtraProviderId, number>>> {
  const next: Partial<Record<ExtraProviderId, string[]>> = {};
  const counts: Partial<Record<ExtraProviderId, number>> = {};
  await Promise.all(
    EXTRA_PROVIDERS.map(async (provider) => {
      const key = (keys[provider] || "").split(/[\n,]/)[0]?.trim();
      if (!key) return;
      try {
        const res = await platformFetch()(OPENAI_COMPAT[provider].modelsUrl, {
          method: "GET",
          headers: { Authorization: `Bearer ${key}` },
        });
        if (!res.ok) throw new Error(`${provider} models ${res.status}`);
        next[provider] = PICKERS[provider]((await res.json()) as ModelListing);
      } catch {
        next[provider] = candidates(provider);
      }
    }),
  );
  setCatalog(next);
  // Smart routing ranks every candidate (dead ones are skipped at routing time).
  recordDiscovered(Object.fromEntries(EXTRA_PROVIDERS.map((p) => [p, next[p] ?? []])));
  for (const provider of Object.keys(next) as ExtraProviderId[]) {
    counts[provider] = catalogModels(provider).length;
  }
  return counts;
}

// ── Pickers: what counts as a usable free chat model on each provider ─────────────

/** Names that say "not a general chat model": safety/embedding/code tools, and
 *  domain- or modality-specialised variants (finance, health, vision-language…). */
const NOT_CHAT =
  /safety|guard|embed|rerank|reward|moderation|code|coder|ocr|parse|retriev|-vl\b|-vl:|vision|omni|-fin\b|-fin:|sante|medic|legal|-mini\b|-mini:|nano|lite\b/i;

/** Largest parameter count a model id states ("26b-a4b" → 26), or null if none. */
function statedBillions(id: string): number | null {
  const sizes = [...id.matchAll(/(?:^|[-_/:.])(\d+(?:\.\d+)?)b(?=$|[-_:.])/gi)].map((m) =>
    Number(m[1]),
  );
  return sizes.length ? Math.max(...sizes) : null;
}

/** Tiny models can't hold the operator's one-JSON-command protocol; giant ones are
 *  slow on free capacity. Prefer a stated 20–150B, largest first, then unsized ids
 *  (in the provider's own order); drop stated sizes outside the band. */
const MIN_BILLIONS = 20;
const MAX_BILLIONS = 150;

function rankBySize(ids: string[]): string[] {
  const inBand = (b: number) => b >= MIN_BILLIONS && b <= MAX_BILLIONS;
  const sized = ids
    .filter((id) => statedBillions(id) != null && inBand(statedBillions(id)!))
    .sort((a, b) => statedBillions(b)! - statedBillions(a)!);
  const unsized = ids.filter((id) => statedBillions(id) == null);
  return [...sized, ...unsized];
}

/** The slice of an OpenAI-style GET /models listing the pickers read. */
interface ModelListing {
  data?: Array<{
    id?: unknown;
    supported_parameters?: string[];
    capabilities?: { completion_chat?: boolean; function_calling?: boolean };
    deprecation?: unknown;
  }>;
}
type Entry = NonNullable<ModelListing["data"]>[number];

/** Free (`:free`), tool-capable (the chat loop sends tools), general, mid-to-large. */
export function pickOpenRouter(json: ModelListing): string[] {
  const ids: string[] = (json?.data ?? [])
    .filter((m: Entry) => typeof m?.id === "string" && m.id.endsWith(":free"))
    .filter((m: Entry) => (m.supported_parameters ?? []).includes("tools"))
    .map((m: Entry) => m.id as string)
    .filter((id: string) => !NOT_CHAT.test(id));
  return rankBySize(ids).slice(0, CANDIDATES_PER_PROVIDER);
}

/** Mistral publishes capabilities per model and stable "-latest" aliases: prefer
 *  those aliases (small first — fast), else any chat + function-calling model. */
export function pickMistral(json: ModelListing): string[] {
  const usable = (json?.data ?? []).filter(
    (m: Entry) =>
      typeof m?.id === "string" &&
      m.capabilities?.completion_chat !== false &&
      m.capabilities?.function_calling !== false &&
      !m.deprecation &&
      !NOT_CHAT.test(m.id),
  );
  const ids = usable.map((m: Entry) => m.id as string);
  const preferred = [
    "mistral-small-latest",
    "mistral-medium-latest",
    "mistral-large-latest",
  ].filter((id) => ids.includes(id));
  return [...new Set([...preferred, ...ids])].slice(0, CANDIDATES_PER_PROVIDER);
}

/** NVIDIA's public /v1/models is a stale catalog, not what a key can call. On
 *  2026-09-23 a free account's model page offered three models: two answered 410
 *  "reached its end of life" (llama-3.3-70b-instruct, qwen2.5-coder-32b), and every
 *  listed pick 404'd or timed out. The one that answered is this — which the name
 *  filter drops ("nano", "omni") — so it leads regardless. When NVIDIA retires it,
 *  its 404/410 marks it dead ([markModelDead]) for a week at the cost of one call. */
const NVIDIA_SEED = ["nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"];

/** NVIDIA's listing carries no capability flags, so choose instruct-tuned general
 *  models by name, same size preference as OpenRouter. */
export function pickNvidia(json: ModelListing): string[] {
  const ids: string[] = (json?.data ?? [])
    .map((m: Entry) => m?.id)
    .filter(
      (id: unknown): id is string =>
        typeof id === "string" && /instruct|chat|gpt-oss/i.test(id) && !NOT_CHAT.test(id),
    );
  return [...new Set([...NVIDIA_SEED, ...rankBySize(ids)])].slice(0, CANDIDATES_PER_PROVIDER);
}

const PICKERS: Record<ExtraProviderId, (json: ModelListing) => string[]> = {
  openrouter: pickOpenRouter,
  mistral: pickMistral,
  nvidia: pickNvidia,
};
