/**
 * Per-key model discovery — the phone equivalent of the desktop
 * `reference/python-backend-spec/llm/model_discovery.py`.
 *
 * Only lists models the configured API keys can actually serve, filtered to
 * free-tier chat models (no Whisper/TTS/embeddings, no Gemini preview/heavy SKUs).
 */

import { platformFetch } from "../tools/httpClient";
import { modelClassFor } from "../modelPolicy";
import { recordDiscovered } from "../modelRanker";

export interface ModelOpt {
  value: string;
  label: string;
  /** Informational entries (such as image generation) are shown but cannot be
   * selected as a chat model. */
  selectable?: boolean;
}
export interface ModelGroup {
  label: string;
  opts: ModelOpt[];
  kind?: "auto" | "chat" | "image";
}

const GEMINI_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";

const GROQ_DROP =
  /whisper|distil-whisper|tts|guard|embed|moderation|playai|orpheus|canopylabs|distil/i;
const GEMINI_DROP =
  /embedding|aqa|imagen|veo|-tts|image|learnlm|vision-latest|exp-|preview|thinking|native-audio/i;

/** Curated Groq free-tier chat models when the live /models call fails. */
const GROQ_FREE_FALLBACK: ModelOpt[] = [
  { value: "openai/gpt-oss-120b", label: "GPT-OSS 120B — deep reasoning (free)" },
  { value: "openai/gpt-oss-20b", label: "GPT-OSS 20B — fast (free)" },
];

/** Curated Gemini Developer API free-tier models when discovery fails. */
const GEMINI_FREE_FALLBACK: ModelOpt[] = [
  // Only reached when live discovery fails. Every id in the previous version of
  // this list (2.0-flash, 2.0-flash-lite, 1.5-flash) had been retired by Google,
  // so the "fallback" could not serve a single request. Confirmed live 2026-09-22.
  { value: "gemini-3.6-flash", label: "Gemini 3.6 Flash (free tier)" },
  { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash (free tier)" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (free tier)" },
];

/** One group per provider, in the order given. Image models never enter the chat
 *  picker; they are selected by the direct image route below instead. */
function groupedByProvider(sources: Array<{ label: string; opts: ModelOpt[] }>): ModelGroup[] {
  return sources
    .map((source) => ({
      label: source.label,
      opts: source.opts.filter((o) => modelClassFor(o.value) !== "image"),
      kind: "chat" as const,
    }))
    .filter((g) => g.opts.length > 0);
}

/**
 * Discover models for the keys the user has configured. Never throws — a provider
 * that errors just contributes no group. Only groups matching present keys are returned.
 */
export async function discoverModels(keys: {
  gemini?: string;
  groq?: string;
  vertexSaJson?: string;
}): Promise<ModelGroup[]> {
  const groups: ModelGroup[] = [
    {
      label: "Auto",
      opts: [{ value: "auto", label: "Auto — pick the best model per request" }],
      kind: "auto",
    },
  ];
  const hasGemini = Boolean((keys.gemini || "").trim());
  const hasGroq = Boolean((keys.groq || "").trim());
  const hasVertex = Boolean((keys.vertexSaJson || "").trim());
  // Vertex counts too — a Vertex-only user (SA JSON, no Gemini/Groq key) must still
  // get their model list. Returning here before the discovery below left the dropdown
  // empty (fell back to just "Auto").
  if (!hasGemini && !hasGroq && !hasVertex) {
    recordDiscovered({ vertex: [], gemini: [], groq: [] }); // every key removed
    return groups;
  }

  // null = the listing failed (keep what smart routing had); [] = no key.
  const list = (on: boolean, fetch: () => Promise<ModelOpt[]>) =>
    on ? fetch().catch(() => null) : Promise.resolve([] as ModelOpt[]);
  const [vtxR, gemR, groqR] = await Promise.all([
    list(hasVertex, () => vertexModels(keys.vertexSaJson!)),
    list(hasGemini, () => geminiModels(keys.gemini!)),
    list(hasGroq, () => groqModels(keys.groq!)),
  ]);
  const ids = (r: ModelOpt[] | null) => r && r.map((o) => o.value);
  recordDiscovered({ vertex: ids(vtxR), gemini: ids(gemR), groq: ids(groqR) });
  const [vtx, gem, groq] = [vtxR ?? [], gemR ?? [], groqR ?? []];
  groups.push(
    ...groupedByProvider([
      ...(vtx.length ? [{ label: "Vertex AI", opts: vtx }] : []),
      ...(gem.length ? [{ label: "Google Gemini", opts: gem }] : []),
      ...(groq.length ? [{ label: "Groq", opts: groq }] : []),
    ]),
  );
  if (hasGemini) {
    groups.push({
      label: "Image models — used automatically",
      kind: "image",
      opts: [
        {
          value: "__image_auto__",
          label: "Gemini image generator — only for image-creation requests",
          selectable: false,
        },
      ],
    });
  }
  return groups;
}

async function geminiModels(key: string): Promise<ModelOpt[]> {
  const res = await platformFetch()(`${GEMINI_MODELS_URL}?pageSize=200`, {
    method: "GET",
    headers: { "x-goog-api-key": key },
  });
  if (!res.ok) throw new Error(`Gemini models ${res.status}`);
  const json = (await res.json()) as {
    models?: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[] }>;
  } | null;
  const out: ModelOpt[] = [];
  for (const m of json?.models ?? []) {
    const methods: string[] = m.supportedGenerationMethods ?? [];
    if (!methods.includes("generateContent")) continue;
    const id = String(m.name ?? "").replace(/^models\//, "");
    if (!id || !/^(gemini|gemma)/i.test(id)) continue;
    if (GEMINI_DROP.test(id)) continue;
    out.push({ value: id, label: m.displayName || id });
  }
  out.sort((a, b) => b.value.localeCompare(a.value, undefined, { numeric: true }));
  return out.length ? out : GEMINI_FREE_FALLBACK;
}

async function groqModels(key: string): Promise<ModelOpt[]> {
  const res = await platformFetch()(GROQ_MODELS_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Groq models ${res.status}`);
  const json = (await res.json()) as { data?: Array<{ id?: string }> } | null;
  const out: ModelOpt[] = [];
  for (const m of json?.data ?? []) {
    const id = String(m.id ?? "");
    if (!id || GROQ_DROP.test(id)) continue;
    out.push({ value: id, label: id });
  }
  out.sort((a, b) => a.value.localeCompare(b.value));
  return out.length ? out : GROQ_FREE_FALLBACK;
}

/**
 * Curated Vertex AI Gemini models. Unlike Gemini Developer API and Groq, Vertex AI
 * (rebranded "Gemini Enterprise Agent Platform") has no public REST method to list
 * available publisher/foundation models — `publishers.models` only exposes `get`
 * (a single already-known model) and action methods (generateContent, predict, …),
 * confirmed against the live aiplatform.googleapis.com v1 API discovery document,
 * which has no `publishers` resource at all. So this list IS the real available set;
 * there's no live call that could return something more authoritative than it.
 *
 * The 3-series launched on the "global" endpoint (see VERTEX_LOCATION in gemini.ts,
 * now the default vertexRegion) rather than region-pinned subdomains — resolveConfig
 * was switched from a hardcoded "us-central1" so these actually resolve.
 *
 * 2026-07-05: mirrored from the Windows app's own curated list, which is verified
 * against the SAME GCP project/Vertex global endpoint (`jarvis-studio-backend/llm/
 * model_discovery.py` `_VERTEX_CURATED`, kept in sync with `gemini_bridge.py`'s
 * module docstring). The phone's list had drifted a generation behind (still
 * carrying a "gemini-3-flash-preview" id the desktop app never uses/verifies) —
 * this is the reason "some Vertex models on the phone weren't correct." Omits the
 * desktop's `gemini-live-2.5-flash-native-audio` and image-generation model ids:
 * those need the Live API / image-modality plumbing the phone's chat-only
 * `chatVertex` (plain `generateContent`) doesn't implement. Re-verify this list
 * against the desktop file if Google's Vertex catalog changes again.
 */
const VERTEX_FALLBACK: ModelOpt[] = [
  { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash — flagship (Vertex AI)" },
  { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite — fastest (Vertex AI)" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash — capable mid-tier (Vertex AI)" },
  { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite — cheap/fast (Vertex AI)" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro (Vertex AI)" },
];

/** No live discovery endpoint exists for Vertex (see VERTEX_FALLBACK comment) —
 *  this always returns the curated list. Kept as a function (not an alias for the
 *  constant) so a future real endpoint, if Google ever ships one, drops in cleanly. */
async function vertexModels(_saJson: string): Promise<ModelOpt[]> {
  return VERTEX_FALLBACK;
}
