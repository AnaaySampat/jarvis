/**
 * Provider-error classification for the route ladder.
 *
 * Trimmed from the freellmapi gateway's `lib/error-classify.ts` to the classes
 * Groq / Gemini / Vertex actually emit. The distinctions matter because they lead
 * to different recovery:
 *
 *   - a real 429 means the QUOTA is spent → escalating bench, rotate keys
 *   - a timeout or 5xx means the provider is BUSY → short bench, never escalate
 *   - a 401/403/404 won't fix itself in a cooldown → park it for the day
 *
 * Collapsing these (which is what a `/429|rate.?limit|.../.test(msg)` catch-all
 * does) escalates a slow answer into a day-long quarantine, and re-tries a dead
 * key every ninety seconds forever.
 */

import { headerNumber } from "./quota";

/** A provider failure with the raw facts the bench decision needs. */
export class ProviderError extends Error {
  /** HTTP status, or 0 when the request never reached the server. */
  readonly status: number;
  /** The provider's own requested wait, in ms, when it sent one. */
  readonly retryAfterMs: number | null;
  /** Raw response body (truncated) — where providers state their real limits. */
  readonly detail: string;

  constructor(
    message: string,
    opts: { status?: number; retryAfterMs?: number | null; detail?: string } = {},
  ) {
    super(message);
    this.name = "ProviderError";
    this.status = opts.status ?? 0;
    this.retryAfterMs = opts.retryAfterMs ?? null;
    this.detail = opts.detail ?? message;
  }
}

function messageOf(err: unknown): string {
  if (err instanceof ProviderError) return `${err.message} ${err.detail}`.toLowerCase();
  return String((err as Error)?.message ?? err).toLowerCase();
}

function statusOf(err: unknown): number {
  return err instanceof ProviderError ? err.status : 0;
}

/**
 * A genuine provider QUOTA signal. Deliberately much narrower than
 * `isRetryable`: timeouts, 5xx and transport failures are all worth retrying
 * elsewhere but say nothing about quota, and only a real quota signal may feed
 * the escalating bench ladder.
 *
 * 413 counts: Groq answers an over-budget request with "Request too large ... on
 * tokens per minute (TPM): Limit 30000", which is a ceiling, not a bad request.
 */
export function isRateLimitSignal(err: unknown): boolean {
  const status = statusOf(err);
  if (status !== 0) return status === 429 || status === 413;
  const msg = messageOf(err);
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("quota") ||
    msg.includes("resource_exhausted")
  );
}

/**
 * Which quota WINDOW a rate-limit failure belongs to, or null when the body doesn't
 * say. A per-minute ceiling clears in seconds; a daily one doesn't.
 *
 * Treating both alike is what made the free tier feel broken: Groq's tokens-per-
 * minute 429s (which reset in ~8s) went onto the 2m → 10m → 1h → day ladder, so one
 * burst of operator steps parked every route for minutes and the next few parked
 * them for hours (2026-09-23). Reads Groq's "on tokens per minute (TPM)" / "per day"
 * wording and Gemini's quotaId ("…PerMinutePerProject…" / "…PerDay…").
 */
export function limitWindow(err: unknown): "minute" | "day" | null {
  const msg = messageOf(err);
  if (/per\s*day|perday|\b(?:rpd|tpd)\b/.test(msg)) return "day";
  // OpenRouter's ":free" pool: "temporarily rate-limited upstream. Please retry
  // shortly" is the shared pool, not the user's quota — it climbed to hour-long benches.
  if (/per\s*min(?:ute)?|perminute|\b(?:rpm|tpm)\b|rate-limited upstream/.test(msg)) return "minute";
  return null;
}

/** Won't recover within any sane cooldown: a rejected key, or a model this tier
 *  can't reach. Park it for the day and move on — saving keys in Settings clears
 *  the bench, which is the one action that actually fixes these. */
export function isFatalForRoute(err: unknown): boolean {
  const status = statusOf(err);
  return status === 401 || status === 403 || status === 404 || status === 410;
}

/** MODEL-level, not key-level: every key on this provider fails a missing model
 *  identically, so the ladder skips its sibling keys instead of burning an
 *  attempt per key on a route that cannot work. */
export function isModelGone(err: unknown): boolean {
  // 410: NVIDIA answers a model the key can no longer call with Gone, not Not Found.
  const status = statusOf(err);
  return status === 404 || status === 410;
}

/**
 * The replacement model Google names in its own retirement 404, or null.
 *
 * Google retires model ids on a schedule and answers a retired one with, verbatim:
 *   "This model models/gemini-2.0-flash is no longer available.
 *    Please update your code to use models/gemini-3.6-flash"
 *
 * That has now bitten this project three times — a pinned id silently dies, every
 * request falls to the other provider, and the first visible symptom is the
 * fallback provider's rate limit. The error carries the fix, so read it instead of
 * waiting for a human to notice and re-pin a constant that will rot the same way.
 */
export function retiredModelReplacement(err: unknown): string | null {
  if (statusOf(err) !== 404) return null;
  // messageOf lowercases; model ids are lowercase anyway.
  const m = /no longer available[^]*?use\s+models\/([a-z0-9.-]+)/i.exec(messageOf(err));
  const id = m?.[1]?.replace(/[.,)]+$/, "") ?? "";
  return id && /^(gemini|gemma)/.test(id) ? id : null;
}

/** Worth trying another route at all. False for a client abort — the user
 *  cancelled, so failing over would be answering a question nobody asked. */
export function isRetryable(err: unknown): boolean {
  if (isAbort(err)) return false;
  const status = statusOf(err);
  if (status !== 0) {
    return (
      status === 408 ||
      status === 409 ||
      status === 413 ||
      status === 422 ||
      status === 429 ||
      status === 401 ||
      status === 403 ||
      status === 404 ||
      status === 410 ||
      status >= 500
    );
  }
  const msg = messageOf(err);
  return (
    msg.includes("rate limit") ||
    msg.includes("quota") ||
    msg.includes("resource_exhausted") ||
    msg.includes("timeout") ||
    msg.includes("network") ||
    msg.includes("failed to fetch") ||
    msg.includes("fetch failed") ||
    msg.includes("load failed") ||
    msg.includes("connection") ||
    msg.includes("unavailable") ||
    msg.includes("native http") ||
    msg.includes("cors") ||
    msg.includes("not found")
  );
}

/** The caller hung up (AbortSignal). Never a provider's fault, never benched. */
export function isAbort(err: unknown): boolean {
  const name = (err as Error)?.name;
  if (name === "AbortError") return true;
  const msg = String((err as Error)?.message ?? err).toLowerCase();
  return msg.includes("aborted") || msg.includes("abortsignal");
}

/** Retry-After as ms. Providers send either a seconds count or, in Google's error
 *  bodies, a `"retryDelay": "42s"` field — check both rather than trust one. */
export function retryAfterMsFrom(
  bag: { get(name: string): string | null } | null | undefined,
  body?: string,
): number | null {
  const raw = bag?.get?.("retry-after");
  if (raw) {
    const seconds = Number(String(raw).trim());
    if (Number.isFinite(seconds)) return seconds * 1000;
  }
  const found = body ? /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body) : null;
  if (found) return Number(found[1]) * 1000;
  // Groq: "Please try again in 7.66s." / "in 2m59.56s"; Gemini: "Please retry in 7.6s."
  const prose = body
    ? /(?:try again|retry) in ((?:\d+(?:\.\d+)?\s*(?:ms|s|m|h)\s*)+)/i.exec(body)
    : null;
  const seconds = prose ? headerNumber(prose[1]!.trim()) : null;
  return seconds != null ? seconds * 1000 : null;
}
