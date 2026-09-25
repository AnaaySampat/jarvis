/**
 * HTTP info-tools — the tools that are pure network calls and port straight from
 * Python with no platform (Kotlin) dependency. They run identically on phone and
 * desktop, the only difference being the transport (see ./httpClient: Tauri HTTP
 * plugin on-device, global fetch in the preview).
 *
 * Port references (under `reference/python-backend-spec/`):
 *   getWeather    ← weather.py:forecast_summary
 *   getNews       ← news.py:get_headlines
 *   webSearch     ← llm/groq_bridge.py:web_answer + gemini_bridge.py grounding
 *   findPlaces    ← places.py:find_nearby (OpenStreetMap Overpass)
 *   getDirections ← places.py:directions (Nominatim geocode + OSRM routing)
 *   makeQrCode    ← actions/__init__.py qr_code
 *
 * Location comes from ./location (LocationService); the Gemini key (web search) comes
 * from the brain config. Both arrive via the dispatch context below.
 */

import type { ToolResult } from "../types";
import type { BrainConfig } from "../config";
import { getJson, getText, postJson, resilientFetch, isOffline } from "./httpClient";
import { geocode, haversineM, prettyDist, type LocationService } from "./location";
import { wmo } from "../wmoCodes";

/** Swap in a single clear message when the device has no connectivity at all —
 *  otherwise keep the tool's own (already user-facing) failure summary. */
function offlineOr(fallback: string): string {
  return isOffline() ? "You're offline, sir — I can't reach the internet right now." : fallback;
}

/** What the HTTP tools need beyond their call args. Built by tools/dispatch.ts. */
export interface HttpToolCtx {
  config: BrainConfig;
  location: LocationService;
}

// ───────────────────────────── Weather (Open-Meteo) ─────────────────────────────

function condText(code: unknown): string {
  return wmo(code)[0];
}

interface OpenMeteo {
  current?: {
    temperature_2m?: number;
    relative_humidity_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    apparent_temperature?: number;
    time?: string;
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
  };
}

export async function getWeather(ctx: HttpToolCtx): Promise<ToolResult> {
  const loc = await ctx.location.coords();
  if (!loc) {
    return {
      ok: false,
      summary:
        "I don't know where you are yet, sir — allow location access or pin a place, and try again.",
    };
  }
  const days = 3;
  const url =
    "https://api.open-meteo.com/v1/forecast?" +
    new URLSearchParams({
      latitude: String(loc.lat),
      longitude: String(loc.lon),
      current:
        "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,apparent_temperature",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      forecast_days: String(days),
      timezone: "auto",
      wind_speed_unit: "mph",
    }).toString();

  let data: OpenMeteo;
  try {
    data = await getJson<OpenMeteo>(url, { timeoutMs: 8000 });
  } catch {
    return { ok: false, summary: offlineOr("I couldn't fetch the weather just now, sir.") };
  }

  const cur = data.current ?? {};
  const cond = condText(cur.weather_code);
  const where = loc.place && loc.place !== "—" ? ` in ${loc.place}` : "";
  const parts: string[] = [];
  if (typeof cur.temperature_2m === "number") {
    const feels =
      typeof cur.apparent_temperature === "number"
        ? ` (feels like ${Math.round(cur.apparent_temperature)}°C)`
        : "";
    const hum = cur.relative_humidity_2m ?? "—";
    const wind = Math.round(cur.wind_speed_10m ?? 0);
    parts.push(
      `Right now${where} it's ${Math.round(cur.temperature_2m)}°C${feels} and ${cond}, ` +
        `humidity ${hum}%, wind ${wind} mph.`,
    );
  }
  // Day labels anchored to the location's local date (timezone=auto), as in Python.
  const daily = data.daily ?? {};
  const dTime = daily.time ?? [];
  const base = new Date((cur.time ?? "").slice(0, 10) || Date.now());
  const labels = ["Today", "Tomorrow"];
  for (let i = 2; i < days; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    labels.push(d.toLocaleDateString(undefined, { weekday: "long" }));
  }
  for (let i = 0; i < Math.min(days, dTime.length); i++) {
    const cc = condText(daily.weather_code?.[i]);
    const lo = Math.round(daily.temperature_2m_min?.[i] ?? 0);
    const hi = Math.round(daily.temperature_2m_max?.[i] ?? 0);
    const pop = daily.precipitation_probability_max?.[i];
    const rain = typeof pop === "number" ? `, ${pop}% chance of rain` : "";
    parts.push(`${labels[i]}: ${lo}–${hi}°C, ${cc}${rain}.`);
  }
  if (!parts.length) {
    return { ok: false, summary: "I couldn't read the forecast just now, sir." };
  }
  return {
    ok: true,
    summary: parts.join(" "),
    data: { location: loc.place, temp: cur.temperature_2m, condition: cond },
  };
}

// ───────────────────────────── News (Google News RSS) ───────────────────────────

// Topic → Google News RSS section. Port of news.py:_SECTIONS.
const NEWS_SECTIONS: Record<string, string> = {
  world: "WORLD",
  business: "BUSINESS",
  tech: "TECHNOLOGY",
  technology: "TECHNOLOGY",
  science: "SCIENCE",
  sport: "SPORTS",
  sports: "SPORTS",
  health: "HEALTH",
  entertainment: "ENTERTAINMENT",
};

function newsFeedUrl(topic: string): string {
  const t = (topic ?? "").toLowerCase().trim();
  const base = "https://news.google.com/rss";
  const params = "?hl=en&gl=US&ceid=US:en";
  if (!t || ["news", "top", "headlines", "latest"].includes(t)) return base + params;
  const section = NEWS_SECTIONS[t];
  if (section) return `${base}/headlines/section/topic/${section}${params}`;
  return `${base}/search?q=${encodeURIComponent(t)}&hl=en&gl=US&ceid=US:en`;
}

export async function getNews(topic: string): Promise<ToolResult> {
  let xml: string;
  try {
    xml = await getText(newsFeedUrl(topic), { timeoutMs: 9000 });
  } catch {
    return { ok: false, summary: offlineOr("I couldn't fetch the news just now, sir.") };
  }
  // Parse the RSS with the WebView's DOMParser (no XML lib needed).
  const items: Array<{ title: string; source: string }> = [];
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const nodes = doc.querySelectorAll("item");
    for (let i = 0; i < nodes.length && items.length < 5; i++) {
      let title = (nodes[i].querySelector("title")?.textContent ?? "").trim();
      if (!title) continue;
      // Google News titles end with " - Source"; split it out (news.py does too).
      let source = "";
      const cut = title.lastIndexOf(" - ");
      if (cut > 0) {
        source = title.slice(cut + 3).trim();
        title = title.slice(0, cut).trim();
      }
      items.push({ title, source });
    }
  } catch {
    return { ok: false, summary: "I couldn't read the news feed just now, sir." };
  }
  if (!items.length) return { ok: true, summary: "I couldn't find any headlines right now, sir." };
  const t = (topic ?? "").trim();
  const label = t && !["news", "top", "latest"].includes(t.toLowerCase()) ? ` on ${t}` : "";
  const spoken =
    `Here are the top headlines${label}, sir: ` +
    items.map((h, i) => `${i + 1}. ${h.title}.`).join(" ");
  return { ok: true, summary: spoken, data: { items } };
}

// ─────────────────────── Web search (Gemini Google-Search grounding) ─────────────

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** The Gemini model to ground with: the user's model if it's a Gemini one, else a
 * fast default. Port of groq_bridge.py:_grounding_model. */
function groundingModel(cfg: BrainConfig): string {
  const sel = (cfg.model ?? "").trim();
  return /gemini/i.test(sel) ? sel : "gemini-2.5-flash";
}

export async function webSearch(query: string, ctx: HttpToolCtx): Promise<ToolResult> {
  const q = (query ?? "").trim();
  if (!q) return { ok: false, summary: "What should I look up, sir?" };
  // Grounded search is a one-shot side call, not a chat turn — it doesn't ride
  // the route ladder, so it just uses the user's primary Gemini key.
  const key = ctx.config.keys.gemini?.[0];
  if (!key) {
    return {
      ok: false,
      summary:
        "Live web search needs a Gemini key, sir — add one in Settings and I'll pull it straight from the web.",
    };
  }
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const where = (ctx.location.pinnedPlace ?? (await ctx.location.coords())?.place ?? "").trim();
  const systemBits = [
    "You are JARVIS. Answer the user's question directly and concisely from live web " +
      "search results. State figures and names precisely; don't hedge.",
    `Today's date is ${today}. For 'best/top/latest/current' questions, prefer the MOST ` +
      "recent information and say which year or edition it reflects.",
  ];
  if (where) {
    systemBits.push(
      `The user is in ${where}. For 'near me'/'nearest'/'around here' questions, assume ` +
        "this location unless they name a different place.",
    );
  }
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: q }] }],
    system_instruction: { parts: [{ text: systemBits.join("\n\n") }] },
    tools: [{ google_search: {} }],
    // Deliberately NO maxOutputTokens. On 2.5+/3.x models, THINKING tokens are
    // charged against that same ceiling, and a grounded search thinks hard — the
    // 800 this was ported with got spent before a single answer token was written,
    // so the reply came back as a candidate with no parts and finishReason
    // MAX_TOKENS. That is the whole "JARVIS can't web search" bug: the request
    // succeeded, the extraction below found no text, and every search reported "I
    // couldn't find a clear answer". The Python this is ported from only got away
    // with 800 because it paired it with thinkingBudget=0
    // (groq_bridge._gemini_thinking_budget). That knob is model-generation-specific
    // (2.5 takes thinkingBudget, 3.x takes thinking_level) and 400s where it isn't
    // supported; an uncapped reply is neither, and the system instruction above
    // already asks for a concise answer.
    generationConfig: { temperature: 0.3 },
  });
  let json: GeminiGroundedResponse;
  try {
    json = await postJson<GeminiGroundedResponse>(
      `${GEMINI_BASE}/models/${groundingModel(ctx.config)}:generateContent`,
      body,
      // Uncapped output means the model may think for a while before answering.
      { headers: { "Content-Type": "application/json", "x-goog-api-key": key }, timeoutMs: 30000 },
    );
  } catch (err) {
    return {
      ok: false,
      summary: offlineOr(`I couldn't reach the web just now, sir. (${String(err)})`),
    };
  }
  const cand = json.candidates?.[0];
  const text = (cand?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) {
    // Say WHY. A bare "no clear answer" is what let the MAX_TOKENS bug above look
    // like "search just doesn't work" instead of a fixable request-shape mistake.
    const why = cand?.finishReason ?? json.promptFeedback?.blockReason ?? "";
    return {
      ok: false,
      summary: /SAFETY|BLOCK|PROHIBITED|RECITATION/i.test(why)
        ? "That search came back blocked by Google's filters, sir."
        : `I couldn't find a clear answer to that just now, sir.${why ? ` (${why})` : ""}`,
    };
  }
  // Dedup the grounding sources for the HUD/citations.
  const sources: Array<{ title: string; uri: string }> = [];
  const seen = new Set<string>();
  for (const chunk of cand?.groundingMetadata?.groundingChunks ?? []) {
    const uri = (chunk.web?.uri ?? "").trim();
    const title = (chunk.web?.title ?? "").trim();
    const k = uri || title;
    if (!k || seen.has(k)) continue;
    seen.add(k);
    sources.push({ title: title || uri, uri });
  }
  return { ok: true, summary: text, data: { sources } };
}

interface GeminiGroundedResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
    groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> };
  }>;
  promptFeedback?: { blockReason?: string };
}

// ─────────────────────────── Places (OpenStreetMap) ─────────────────────────────

// Plain-English category → Overpass tag filter + plural label. Port of
// places.py:_CATEGORIES (first match wins; catch-all is restaurants).
const CATEGORIES: Array<[string[], string, string]> = [
  [
    ["restaurant", "food", "eat", "dinner", "lunch", "place to eat", "diner"],
    '["amenity"="restaurant"]',
    "restaurants",
  ],
  [["cafe", "coffee", "café", "tea"], '["amenity"="cafe"]', "cafés"],
  [
    ["bakery", "bakeries", "croissant", "pastry", "bread", "cake", "donut", "doughnut", "baked"],
    '["shop"~"bakery|pastry|confectionery"]',
    "bakeries",
  ],
  [
    ["fast food", "burger", "mcdonald", "pizza", "takeaway", "take out"],
    '["amenity"="fast_food"]',
    "fast-food spots",
  ],
  [["bar", "pub", "drink", "beer"], '["amenity"~"bar|pub"]', "bars & pubs"],
  [["pharmacy", "chemist", "drugstore", "medicine"], '["amenity"="pharmacy"]', "pharmacies"],
  [
    ["hospital", "clinic", "doctor", "emergency", "urgent care"],
    '["amenity"~"hospital|clinic|doctors"]',
    "medical facilities",
  ],
  [["atm", "cash machine"], '["amenity"="atm"]', "ATMs"],
  [["bank"], '["amenity"="bank"]', "banks"],
  [["fuel", "gas station", "petrol", "gas"], '["amenity"="fuel"]', "fuel stations"],
  [["supermarket", "grocery", "groceries", "store"], '["shop"~"supermarket|convenience"]', "shops"],
  [
    ["hotel", "motel", "stay", "lodging"],
    '["tourism"~"hotel|motel|guest_house"]',
    "places to stay",
  ],
  [["park", "garden"], '["leisure"="park"]', "parks"],
  [["gym", "fitness"], '["leisure"~"fitness_centre|sports_centre"]', "gyms"],
  [["parking"], '["amenity"="parking"]', "parking"],
  [["school"], '["amenity"="school"]', "schools"],
];

// Specific venues OSM has no clean category for → name search, not a loose category
// match. Port of places.py:_SPECIFIC_VENUE_HINTS.
const SPECIFIC_VENUE_HINTS = [
  "trampoline",
  "theme park",
  "water park",
  "amusement",
  "skate park",
  "go kart",
  "go-kart",
  "bowling",
  "arcade",
  "escape room",
  "laser tag",
  "aquarium",
  "zoo",
  "stadium",
  "cinema",
  "movie theat",
  "play area",
  "play centre",
  "play center",
];

function classify(query: string): [string, string] {
  const qx = (query ?? "").toLowerCase().trim();
  const specific = SPECIFIC_VENUE_HINTS.some((h) => qx.includes(h));
  if (!specific) {
    for (const [keys, filt, label] of CATEGORIES) {
      if (keys.some((k) => qx.includes(k))) return [filt, label];
    }
  }
  if (qx) {
    const safe = qx.replace(/"/g, "");
    return [`["name"~"${safe}",i]`, `places matching “${query}”`];
  }
  return ['["amenity"="restaurant"]', "restaurants"];
}

// Overpass mirrors that send CORS headers (verified): the main .de endpoint and the
// independent mail.ru mirror. The lz4 mirror is dropped — it sends NO CORS header, so
// a WebView fetch is blocked. We race both and take the first to answer.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

interface OverpassResp {
  elements?: Array<{
    lat?: number;
    lon?: number;
    center?: { lat?: number; lon?: number };
    tags?: Record<string, string>;
  }>;
}

/** Run an Overpass QL query as a GET (no preflight), racing the mirrors. */
async function overpass(queryBody: string): Promise<OverpassResp> {
  const suffix = `?data=${encodeURIComponent(queryBody)}`;
  return Promise.any(
    OVERPASS_ENDPOINTS.map((base) => getJson<OverpassResp>(base + suffix, { timeoutMs: 14000 })),
  );
}

export async function findPlaces(query: string, ctx: HttpToolCtx): Promise<ToolResult> {
  const loc = await ctx.location.coords();
  if (!loc) {
    return {
      ok: false,
      summary: "I don't know where you are yet, sir — allow location access and try again.",
    };
  }
  const [filt, label] = classify(query);
  let items: Array<{ name: string; distance: string; extra: string; dist: number }> = [];
  // Near radius first, then a wider one only if empty (port of the 2-tier search).
  for (const radius of [2000, 9000]) {
    const q =
      `[out:json][timeout:12];` +
      `(node${filt}(around:${radius},${loc.lat},${loc.lon});` +
      `way${filt}(around:${radius},${loc.lat},${loc.lon}););` +
      `out center 24;`;
    let data: OverpassResp;
    try {
      data = await overpass(q);
    } catch {
      return { ok: false, summary: offlineOr("I couldn't reach the maps service just now, sir.") };
    }
    const seen = new Set<string>();
    const rows: typeof items = [];
    for (const el of data.elements ?? []) {
      const tags = el.tags ?? {};
      const name = (tags.name ?? "").trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      const elat = el.lat ?? el.center?.lat;
      const elon = el.lon ?? el.center?.lon;
      if (typeof elat !== "number" || typeof elon !== "number") continue;
      seen.add(name.toLowerCase());
      const dist = haversineM(loc.lat, loc.lon, elat, elon);
      const extra = (tags.cuisine ?? tags.amenity ?? tags.shop ?? "").replace(/_/g, " ");
      rows.push({ name, dist, distance: prettyDist(dist), extra });
    }
    if (rows.length) {
      rows.sort((a, b) => a.dist - b.dist);
      items = rows.slice(0, 6);
      break;
    }
  }
  if (!items.length) return { ok: true, summary: `I couldn't find any ${label} near you, sir.` };
  const spoken =
    `The nearest ${label}: ` +
    items.map((r) => `${r.name} (${r.distance}${r.extra ? ", " + r.extra : ""})`).join("; ") +
    ".";
  return { ok: true, summary: spoken, data: { items } };
}

// ─────────────────────────── Directions (Nominatim + OSRM) ──────────────────────

// Leading question phrasing the model sometimes passes as the destination ("how far
// is the nearest blue tokai"). Port of places.py:_GEO_QUESTION_RE.
const GEO_QUESTION =
  /^\s*(how\s+far(\s+away)?(\s+is|\s+are)?|how\s+long(\s+to|\s+does\s+it\s+take(\s+to\s+(get|reach))?)?|distance\s+(to|from\s+me\s+to)|where\s+is|how\s+do\s+i\s+(get|reach)(\s+to)?|directions?\s+to|navigate\s+to|route\s+to|get\s+to|take\s+me\s+to)\s+/i;

interface OsrmResp {
  routes?: Array<{ distance?: number; duration?: number }>;
}

export async function getDirections(destination: string, ctx: HttpToolCtx): Promise<ToolResult> {
  const loc = await ctx.location.coords();
  if (!loc) {
    return {
      ok: false,
      summary: "I don't know your current location yet, sir — allow location access and try again.",
    };
  }
  const dest = (destination ?? "").replace(GEO_QUESTION, "").trim();
  const target = await geocode(dest, loc.lat, loc.lon).catch(() => null);
  if (!target) return { ok: false, summary: `I couldn't find “${destination}” on the map, sir.` };
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${loc.lon},${loc.lat};${target.lon},${target.lat}?overview=false`;
  let data: OsrmResp;
  try {
    data = await getJson<OsrmResp>(url, { timeoutMs: 10000 });
  } catch {
    return { ok: false, summary: offlineOr("I couldn't reach the routing service just now, sir.") };
  }
  const route = data.routes?.[0];
  if (!route || typeof route.distance !== "number" || typeof route.duration !== "number") {
    return { ok: false, summary: `I couldn't find a driving route to “${destination}”, sir.` };
  }
  const km = route.distance / 1000;
  const mins = route.duration / 60;
  const dur =
    mins >= 60
      ? `${Math.floor(mins / 60)} h ${Math.round(mins % 60)} min`
      : `${Math.round(mins)} min`;
  const short = target.name.split(",")[0];
  return {
    ok: true,
    summary: `${short} is about ${km.toFixed(1)} km away — roughly a ${dur} drive, sir.`,
  };
}

// ─────────────────────────────── QR code ────────────────────────────────────────

export async function makeQrCode(text: string): Promise<ToolResult> {
  const t = (text ?? "").trim();
  if (!t) return { ok: false, summary: "What should I put in the QR code, sir?" };
  // A QR image URL the HUD can render as <img>; no fetch (so no CORS concern).
  const imageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(t)}`;
  return { ok: true, summary: `Here's a QR code for ${t}.`, data: { imageUrl, text: t } };
}

// ─────────────────────────────── Image generation ───────────────────────────────

/** Inline image generation — TEXT+IMAGE generateContent. Port of
 *  `llm/gemini_bridge.py:gemini_generate_image` (its Imagen `:predict` branch is
 *  Vertex/ADC-only and was dropped there too, so this is the same single path).
 *  Works off any Gemini key regardless of which model is answering the chat.
 *
 *  A LIST, not the one pinned id it was ported with. `gemini-2.5-flash-image`
 *  answers the very first request of the day with
 *  `Quota exceeded … generate_content_free_tier_requests, limit: 0` — the free tier
 *  allocates that model nothing, so it never worked and no amount of waiting would
 *  make it. The chat model then relayed that 429 in its own words as "I've used up
 *  the free quota", which is why this looked like an exhausted allowance instead of
 *  a model the key can't call at all. Which image model a key can serve keeps
 *  moving (2.5-flash-image retires 2026-10-02), so ask cheapest-first and walk up
 *  rather than betting the feature on one id.
 *  ponytail: no memo of which id won — the rejections are instant, so two wasted
 *  round-trips cost ~1s against a ~10s generation. Cache it if that ever shows up. */
const IMAGE_GEN_MODELS = [
  "gemini-3.1-flash-lite-image",
  "gemini-3.1-flash-image",
  "gemini-2.5-flash-image",
];

interface GeminiInlinePart {
  text?: string;
  inline_data?: { data?: string; mime_type?: string };
  inlineData?: { data?: string; mimeType?: string };
}

/** First inline image in a generateContent reply, as a data: URL. */
function extractImage(json: {
  candidates?: Array<{ content?: { parts?: GeminiInlinePart[] } }>;
}): string | null {
  for (const p of json.candidates?.[0]?.content?.parts ?? []) {
    const inline = p.inline_data ?? p.inlineData;
    const data = inline?.data;
    if (!data) continue;
    const mime =
      (inline as { mime_type?: string }).mime_type ??
      (inline as { mimeType?: string }).mimeType ??
      "image/png";
    return `data:${mime};base64,${data}`;
  }
  return null;
}

/** The API's own `error.message`, when the failure body carries one. */
function apiErrorMessage(body: string): string {
  try {
    return String(
      (JSON.parse(body) as { error?: { message?: string } })?.error?.message ?? "",
    ).trim();
  } catch {
    return "";
  }
}

/**
 * Why image generation failed, in words that point at the actual remedy.
 *
 * `limit: 0` is the case worth naming: it does NOT mean a spent allowance, it means
 * this key was never given any image quota — so "it should free up shortly" (the
 * app's normal rate-limit line, and what the chat model paraphrased on its own)
 * sends the user off to wait for something that will never happen.
 */
export function imageGenFailure(status: number, body: string): string {
  if (/limit:\s*0\b/i.test(body)) {
    return (
      "Image generation isn't included in your Gemini key's free tier, sir — Google " +
      "allocates it zero requests, so this isn't a quota that frees up later. Enable " +
      "billing on the key at aistudio.google.com/apikey and I'll draw it for you."
    );
  }
  if (status === 429) {
    return "Google is rate-limiting image generation on your key just now, sir — give it a few minutes.";
  }
  const detail = apiErrorMessage(body);
  if (detail) return `I couldn't generate that image, sir — ${detail}`;
  return `I couldn't generate that image, sir.${status ? ` (HTTP ${status})` : ""}`;
}

export async function generateImage(prompt: string, ctx: HttpToolCtx): Promise<ToolResult> {
  const p = (prompt ?? "").trim();
  if (!p) return { ok: false, summary: "Tell me what image to create, sir." };
  const key = ctx.config.keys.gemini?.[0];
  if (!key) {
    return {
      ok: false,
      summary:
        "Image generation needs a Gemini key, sir — add one in Settings and I'll draw it for you.",
      error: "no_credentials",
    };
  }
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: p }] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  });

  // resilientFetch rather than postJson: a rejection's STATUS and BODY are the whole
  // signal here (429/limit:0 vs a safety block vs a dead key), and postJson flattens
  // both into one opaque `HTTP 429: …` string.
  let lastStatus = 0;
  let lastBody = "";
  for (const model of IMAGE_GEN_MODELS) {
    let res: Response;
    try {
      res = await resilientFetch(
        `${GEMINI_BASE}/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body,
        },
        45000,
      );
    } catch (err) {
      // Transport, not the model — the next id would fail identically.
      return {
        ok: false,
        summary: offlineOr(`I couldn't generate that image, sir. (${String(err)})`),
      };
    }
    if (!res.ok) {
      // Every image model is its own quota bucket and its own enablement, so a
      // rejection says nothing about the next one. Remember it and move down.
      lastStatus = res.status;
      lastBody = await res.text().catch(() => "");
      continue;
    }
    const json = (await res.json().catch(() => ({}))) as {
      candidates?: Array<{ content?: { parts?: GeminiInlinePart[] } }>;
    };
    const imageUrl = extractImage(json);
    if (!imageUrl) {
      // A 200 with no image part almost always means a safety block rather than a
      // transport failure, so say the useful thing instead of "try again" on a
      // retry that would be refused identically — by every model on the list.
      return {
        ok: false,
        summary:
          "That image didn't come back — the prompt was most likely blocked by content filters. Try rephrasing it.",
        error: "no_image",
      };
    }
    const caption = (json.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    return {
      ok: true,
      summary: caption || `Here's the image for: ${p}`,
      data: { imageUrl, prompt: p },
    };
  }
  return { ok: false, summary: imageGenFailure(lastStatus, lastBody), error: "image_failed" };
}
