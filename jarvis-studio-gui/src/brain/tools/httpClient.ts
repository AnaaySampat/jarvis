/**
 * Unified HTTP client for the info-tools.
 *
 * Why this exists: the Python backend ran every info-tool request server-side, with
 * no browser in the loop. On Android the brain runs *inside* the WebView, so a plain
 * `fetch` is subject to two browser limits the Python code never hit:
 *   1. CORS — endpoints that send no `Access-Control-Allow-Origin` (Google News RSS,
 *      GDELT) are BLOCKED from a WebView page.
 *   2. Forbidden headers — a browser cannot set `User-Agent`, which Nominatim and
 *      Overpass REQUIRE per their usage policy.
 *
 * So on a real device we route through the **Tauri HTTP plugin** (`@tauri-apps/
 * plugin-http`): the request is made by the Rust core, exactly like the Python
 * server — no CORS, and we can send a polite, identifying User-Agent.
 *
 * In the browser preview (plain Vite, no Tauri runtime) we fall back to the global
 * `fetch`; the CORS-friendly endpoints (Open-Meteo, Overpass main, Nominatim, OSRM,
 * ipwho.is) still work there for fast live UI testing — only the no-CORS ones (news)
 * are device-only.
 */

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

/** Polite, identifying UA (Nominatim/Overpass policy). Only applied on-device. */
const USER_AGENT = "JarvisAndroid/0.1 (personal voice assistant)";

/** True inside a Tauri WebView (the plugin's `fetch` only works there). */
export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** True when the device has no network connectivity at all (vs. a reachable-but-
 *  erroring server). Checked once at the point a fetch actually fails, so a chain
 *  of provider/fallback errors collapses into one clear "you're offline" message
 *  instead of a stack of raw transport errors. */
export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function requestFailure(url: string, err: unknown, nativeErr?: unknown): Error {
  if (isOffline()) return new Error("You're offline — I can't reach the internet right now.");
  const host = hostOf(url);
  const fallback = describeError(err) || "request failed";
  if (nativeErr) {
    const native = describeError(nativeErr) || "native request failed";
    return new Error(
      `Network request to ${host} failed. Native HTTP failed first (${native}); ` +
        `WebView fetch fallback also failed (${fallback}). Rebuild/reinstall the latest APK ` +
        `so the http capability is active, then check internet access.`,
    );
  }
  return new Error(`Network request to ${host} failed: ${fallback}`);
}

/** Drop browser-forbidden headers (User-Agent) so a plain-`fetch` fallback can't throw. */
function stripForbidden(init: RequestInit): RequestInit {
  const h = init.headers;
  if (!h) return init;
  if (h instanceof Headers) {
    const c = new Headers(h);
    c.delete("User-Agent");
    return { ...init, headers: c };
  }
  const rest: Record<string, string> = {};
  for (const [k, v] of Object.entries(h as Record<string, string>)) {
    if (k.toLowerCase() !== "user-agent") rest[k] = v;
  }
  return { ...init, headers: rest };
}

/**
 * The core transport — the single way the brain reaches the network.
 *
 * On-device it PREFERS the Tauri HTTP plugin (the request is made by the Rust core, so
 * there's no CORS and we can send a User-Agent). If that throws for any reason — e.g.
 * a device where the plugin misbehaves — it transparently RETRIES with the WebView's
 * own `fetch`, which still reaches the CORS-friendly endpoints (Gemini, Open-Meteo,
 * ipwho…). A timeout ALWAYS applies, so a stalled request can never freeze a turn —
 * that silent stall is exactly what made chat/voice look like they "did nothing".
 */
export async function resilientFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = 30000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const external = init.signal as AbortSignal | null | undefined;
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", () => controller.abort(), { once: true });
  }
  const opts: RequestInit = { ...init, signal: controller.signal };
  try {
    if (inTauri()) {
      try {
        return await (tauriFetch as typeof fetch)(url, opts);
      } catch (e) {
        if (controller.signal.aborted) throw requestFailure(url, e);
        try {
          return await fetch(url, stripForbidden(opts));
        } catch (fallbackErr) {
          throw requestFailure(url, fallbackErr, e);
        }
      }
    }
    try {
      return await fetch(url, stripForbidden(opts));
    } catch (e) {
      throw requestFailure(url, e);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retry a single-attempt network call once after a short backoff — the same
 * try/wait/retry-once shape `loop.ts`'s `chatWithFailover` uses for a 429, applied here
 * to the two single-attempt calls that matter most for voice (STT, Vertex OAuth token
 * exchange) so one transient blip doesn't fail the whole turn. Skips the retry when
 * we're already known to be offline — retrying won't fix a dead connection.
 */
export async function withRetry<T>(fn: () => Promise<T>, delayMs = 1200): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isOffline()) throw err;
    await new Promise((r) => setTimeout(r, delayMs));
    return fn();
  }
}

/**
 * A `fetch`-shaped helper for the LLM providers / STT / model-discovery. Routes through
 * `resilientFetch` so those calls to `generativelanguage.googleapis.com` /
 * `api.groq.com` work on-device (plugin, no CORS) AND survive a plugin that's down
 * (WebView-fetch fallback). The http capability whitelists both hosts.
 */
export function platformFetch(timeoutMs?: number): typeof fetch {
  return ((url: string, init?: RequestInit) =>
    resilientFetch(url, init ?? {}, timeoutMs)) as typeof fetch;
}

export interface HttpOptions {
  method?: "GET" | "POST";
  /** Plain-text or form body for POST. */
  body?: string;
  headers?: Record<string, string>;
  /** Abort after this many ms (default 12s, matching the Python timeouts). */
  timeoutMs?: number;
}

async function request(url: string, opts: HttpOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  // The browser forbids setting User-Agent; only the Rust-side plugin honours it
  // (resilientFetch strips it before any plain-fetch fallback so that can't throw).
  if (inTauri()) headers["User-Agent"] = USER_AGENT;

  return resilientFetch(
    url,
    {
      method: opts.method ?? "GET",
      headers,
      ...(opts.body !== undefined ? { body: opts.body } : {}),
    },
    opts.timeoutMs ?? 12000,
  );
}

/** GET → response text. Throws on a non-2xx status or network/timeout failure. */
export async function getText(url: string, opts: HttpOptions = {}): Promise<string> {
  const res = await request(url, { ...opts, method: "GET" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** GET → parsed JSON. Throws on a non-2xx status or network/timeout failure. */
export async function getJson<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T> {
  const res = await request(url, { ...opts, method: "GET" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** POST a body → parsed JSON. Used for Gemini grounding. */
export async function postJson<T = unknown>(
  url: string,
  body: string,
  opts: HttpOptions = {},
): Promise<T> {
  const res = await request(url, { ...opts, method: "POST", body });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  return (await res.json()) as T;
}
