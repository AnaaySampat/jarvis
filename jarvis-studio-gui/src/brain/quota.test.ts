/**
 * Checks for quota.ts — the free-tier route memory — and the route ladder.
 *
 * The bench decision is what's worth guarding: too eager and a healthy route is
 * stranded for a day, too lax and we re-hammer a spent key every turn, which is
 * the bug this module exists to fix. Mirrors `aura/jarvis-studio-backend/
 * test_quota.py` so the two apps' behaviour can't quietly drift apart.
 */

import { beforeEach, describe, expect, it } from "vitest";
import * as quota from "./quota";
import { routesFor, usableRoutes } from "./routes";
import { splitKeys } from "./resolveConfig";
import {
  ProviderError,
  isRateLimitSignal,
  isRetryable,
  isFatalForRoute,
  limitWindow,
  retryAfterMsFrom,
} from "./errorClass";
import type { BrainConfig } from "./config";
import type { KV } from "./memory/store";

const R = { provider: "groq", model: "openai/gpt-oss-120b", keyIndex: 0 };
const R2 = { provider: "groq", model: "openai/gpt-oss-120b", keyIndex: 1 };

function fakeKV(): KV {
  const mem = new Map<string, string>();
  return {
    get: (k) => mem.get(k) ?? null,
    set: (k, v) => void mem.set(k, v),
    remove: (k) => void mem.delete(k),
  };
}

function headers(data: Record<string, string>) {
  const lower = new Map(Object.entries(data).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null };
}

beforeEach(() => {
  quota.setStorage(fakeKV());
  quota.reset();
});

describe("bench ladder", () => {
  it("escalates 2m → 10m → 1h → a day, then caps", () => {
    const steps = [0, 1, 2, 3, 4].map(() => quota.bench(R));
    expect(steps).toEqual([2 * quota.MINUTE, 10 * quota.MINUTE, quota.HOUR, quota.DAY, quota.DAY]);
  });

  it("restarts the ladder after a success", () => {
    quota.bench(R);
    quota.bench(R);
    quota.onSuccess(R);
    expect(quota.usable(R)).toBe(true);
    expect(quota.bench(R)).toBe(2 * quota.MINUTE);
  });

  it("backs off a route that keeps timing out, but never onto the day ladder", () => {
    // A slow answer must not quarantine a healthy route for a day; a route that
    // times out again and again must not cost every turn its full timeout either.
    const got = Array.from({ length: 5 }, () => quota.bench(R, { quotaSignal: false }));
    expect(got).toEqual([
      20_000,
      2 * quota.MINUTE,
      10 * quota.MINUTE,
      10 * quota.MINUTE,
      10 * quota.MINUTE,
    ]);
    quota.onSuccess(R); // one answer proves it's alive again
    expect(quota.bench(R, { quotaSignal: false })).toBe(20_000);
    // ...and transient failures never feed the quota ladder.
    expect(quota.bench(R)).toBe(2 * quota.MINUTE);
  });

  it("treats Retry-After as a floor, never a ceiling", () => {
    expect(quota.bench(R, { retryAfterMs: 600_000 })).toBe(600_000);
    quota.reset();
    expect(quota.bench(R, { retryAfterMs: 5_000 })).toBe(2 * quota.MINUTE);
    quota.reset();
    expect(quota.bench(R, { retryAfterMs: 99 * quota.DAY })).toBe(quota.DAY);
  });

  it("benches a per-minute limit for the provider's wait, and never climbs the ladder", () => {
    // Groq's TPM 429 resets in seconds. On the ladder it cost 2m, then 10m, then an
    // hour — which is how one burst of operator steps spent every route (2026-09-23).
    for (let i = 0; i < 5; i++) {
      expect(quota.bench(R, { window: "minute", retryAfterMs: 7_660 })).toBe(7_660);
    }
    // …and a later DAILY limit still starts at the bottom of the ladder.
    expect(quota.bench(R, { window: "day" })).toBe(2 * quota.MINUTE);
  });

  it("clamps a per-minute bench to a sane range", () => {
    expect(quota.bench(R, { window: "minute" })).toBe(20_000);
    expect(quota.bench(R, { window: "minute", retryAfterMs: 100 })).toBe(2_000);
    expect(quota.bench(R, { window: "minute", retryAfterMs: 10 * quota.MINUTE })).toBe(65_000);
  });

  it("reports how soon a route is ready, from benches and from headers", () => {
    expect(quota.readyIn(R)).toBe(0);
    quota.bench(R, { window: "minute", retryAfterMs: 8_000 });
    expect(quota.readyIn(R)).toBeGreaterThan(7_000);
    quota.noteResponse(
      R2,
      200,
      headers({
        "x-ratelimit-remaining-tokens": "0",
        "x-ratelimit-reset-tokens": "5s",
      }),
    );
    expect(quota.readyIn(R2)).toBeGreaterThan(4_000);
    expect(quota.readyIn(R2)).toBeLessThanOrEqual(5_000);
  });

  it("benches per key, not per model", () => {
    quota.bench(R);
    expect(quota.usable(R)).toBe(false);
    expect(quota.usable(R2)).toBe(true);
  });
});

describe("provider headers", () => {
  it("benches on a 200 that already reports nothing left", () => {
    // The whole point: the next turn skips this route instead of spending a 429
    // to rediscover what this response already told us.
    quota.noteResponse(
      R,
      200,
      headers({
        "x-ratelimit-remaining-requests": "50",
        "x-ratelimit-remaining-tokens": "0",
        "x-ratelimit-reset-tokens": "7.66s",
      }),
    );
    expect(quota.usable(R)).toBe(false);
  });

  it("keeps the tightest axis", () => {
    quota.noteResponse(
      R,
      200,
      headers({
        "x-ratelimit-remaining-requests": "0",
        "x-ratelimit-remaining-tokens": "9000",
        "x-ratelimit-reset-requests": "2m30s",
      }),
    );
    expect(quota.usable(R)).toBe(false);
  });

  it("leaves a healthy route alone", () => {
    quota.noteResponse(
      R,
      200,
      headers({
        "x-ratelimit-remaining-requests": "900",
        "x-ratelimit-remaining-tokens": "12000",
        "x-ratelimit-reset-tokens": "3s",
      }),
    );
    expect(quota.usable(R)).toBe(true);
  });

  it("keeps a zero-remaining reading through onSuccess", () => {
    // noteResponse runs just before onSuccess on every 200. A success proves the
    // route answered, NOT that quota is left — if the same response said zero,
    // that has to survive or the next turn walks into the 429 anyway.
    quota.noteResponse(
      R,
      200,
      headers({
        "x-ratelimit-remaining-tokens": "0",
        "x-ratelimit-reset-tokens": "30s",
      }),
    );
    quota.onSuccess(R);
    expect(quota.usable(R)).toBe(false);
  });

  it("parses Groq's duration formats", () => {
    expect(quota.headerNumber("7.66s")).toBe(7.66);
    expect(quota.headerNumber("2m59.56s")).toBeCloseTo(179.56);
    expect(quota.headerNumber("1h30m")).toBe(5400);
    expect(quota.headerNumber("60")).toBe(60);
    expect(quota.headerNumber("")).toBeNull();
    expect(quota.headerNumber(null)).toBeNull();
  });
});

describe("learned limits", () => {
  const groq413 =
    "Request too large for model `openai/gpt-oss-120b` on tokens per minute " +
    "(TPM): Limit 30000, Requested 33476";

  it("reads the ceiling the provider stated", () => {
    expect(quota.learnLimit(R, groq413)).toEqual({ kind: "tpm", limit: 30000 });
    expect(quota.learnedLimits(R)).toEqual({ tpm: 30000 });
  });

  it("only ever lowers", () => {
    // Hitting a ceiling proves our belief was too HIGH. Raising it on a looser
    // later message would re-open the gap that caused the 429.
    quota.learnLimit(R, "tokens per minute (TPM): Limit 30000");
    quota.learnLimit(R, "tokens per minute (TPM): Limit 90000");
    expect(quota.learnedLimits(R)).toEqual({ tpm: 30000 });
    quota.learnLimit(R, "tokens per minute (TPM): Limit 6000");
    expect(quota.learnedLimits(R)).toEqual({ tpm: 6000 });
  });

  it("refuses to guess the axis", () => {
    expect(quota.learnLimit(R, "Limit 30000, Requested 33476")).toBeNull();
    expect(quota.learnLimit(R, "tokens per minute (TPM): no number")).toBeNull();
    expect(quota.learnedLimits(R)).toEqual({});
  });

  it("prefers the day axis over the minute one", () => {
    expect(quota.parseLimit("requests per day (RPD): Limit 1000")?.kind).toBe("rpd");
    expect(quota.parseLimit("tokens per day: Limit 500000")?.kind).toBe("tpd");
  });
});

describe("exhaustion reporting", () => {
  it("names a real time instead of 'give me a moment'", () => {
    expect(quota.soonestReset()).toBeNull();
    quota.bench(R); // 2 minutes
    quota.bench(R2, { retryAfterMs: quota.HOUR });
    const soonest = quota.soonestReset()!;
    expect(soonest).toBeGreaterThan(110_000);
    expect(soonest).toBeLessThanOrEqual(120_000);
    expect(quota.exhaustedMessage()).toContain("2 minutes");
  });

  it("words each magnitude sensibly", () => {
    expect(quota.formatEta(null)).toBe("shortly");
    expect(quota.formatEta(30_000)).toBe("under a minute");
    expect(quota.formatEta(4 * quota.MINUTE)).toBe("about 4 minutes");
    expect(quota.formatEta(quota.HOUR)).toBe("about an hour");
    expect(quota.formatEta(5 * quota.HOUR)).toBe("about 5 hours");
    expect(quota.formatEta(2 * quota.DAY)).toBe("tomorrow");
  });
});

describe("persistence", () => {
  it("restores benches across a relaunch", () => {
    // A 24h daily-exhaustion bench the app forgets on relaunch is not a bench.
    quota.bench(R, { durationMs: quota.DAY });
    quota.save(true);
    quota.reset();
    expect(quota.usable(R)).toBe(true); // sanity: memory really was dropped
    quota.load();
    expect(quota.usable(R)).toBe(false);
    expect(quota.cooldownRemaining(R)).toBeGreaterThan(quota.HOUR);
  });

  it("clear() unbenches everything but keeps learned limits", () => {
    quota.bench(R);
    quota.bench(R2);
    quota.learnLimit(R, "tokens per minute (TPM): Limit 30000");
    quota.clear();
    expect(quota.usable(R)).toBe(true);
    expect(quota.usable(R2)).toBe(true);
    // Learned limits are facts about the model, not about the key.
    expect(quota.learnedLimits(R)).toEqual({ tpm: 30000 });
  });
});

describe("error classification", () => {
  it("separates a real quota signal from mere retryability", () => {
    expect(isRateLimitSignal(new ProviderError("groq 429", { status: 429 }))).toBe(true);
    expect(isRateLimitSignal(new ProviderError("groq 413", { status: 413 }))).toBe(true);
    // Retryable, but says nothing about quota — must not feed the ladder.
    expect(isRateLimitSignal(new ProviderError("groq 503", { status: 503 }))).toBe(false);
    expect(isRateLimitSignal(new Error("network timeout"))).toBe(false);
    expect(isRetryable(new ProviderError("groq 503", { status: 503 }))).toBe(true);
    expect(isRetryable(new Error("Failed to fetch"))).toBe(true);
  });

  it("marks a rejected key or missing model as not-worth-retrying-soon", () => {
    expect(isFatalForRoute(new ProviderError("401", { status: 401 }))).toBe(true);
    expect(isFatalForRoute(new ProviderError("404", { status: 404 }))).toBe(true);
    expect(isFatalForRoute(new ProviderError("429", { status: 429 }))).toBe(false);
  });

  it("tells a per-minute limit from a daily one", () => {
    const groqTpm = new ProviderError("groq 429", {
      status: 429,
      detail:
        "Rate limit reached for model `openai/gpt-oss-20b` in organization `org_x` service " +
        "tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 7600, Requested 1200. " +
        "Please try again in 6.3s.",
    });
    const groqRpd = new ProviderError("groq 429", {
      status: 429,
      detail: "Rate limit reached … on requests per day (RPD): Limit 1000, Used 1000",
    });
    const geminiMinute = new ProviderError("gemini 429", {
      status: 429,
      detail:
        '{"error":{"code":429,"details":[{"violations":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]}]}}',
    });
    const geminiDay = new ProviderError("gemini 429", {
      status: 429,
      detail:
        '{"error":{"details":[{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}}',
    });
    expect(limitWindow(groqTpm)).toBe("minute");
    expect(limitWindow(groqRpd)).toBe("day");
    expect(limitWindow(geminiMinute)).toBe("minute");
    expect(limitWindow(geminiDay)).toBe("day");
    const upstream = new ProviderError("OpenRouter 429", {
      status: 429,
      detail:
        '{"error":{"code":429,"metadata":{"raw":"x:free is temporarily rate-limited upstream. Please retry shortly"}}}',
    });
    expect(limitWindow(upstream)).toBe("minute");
    expect(
      limitWindow(new ProviderError("gemini 429", { status: 429, detail: "quota exceeded" })),
    ).toBeNull();
  });

  it("reads the provider's wait out of the body when there's no header", () => {
    expect(retryAfterMsFrom(null, "… Please try again in 6.3s.")).toBeCloseTo(6_300);
    expect(retryAfterMsFrom(null, "… Please try again in 2m59.56s.")).toBeCloseTo(179_560);
    expect(retryAfterMsFrom(null, "Quota exceeded … Please retry in 7.6s.")).toBeCloseTo(7_600);
    expect(retryAfterMsFrom(null, '"retryDelay": "7s"')).toBe(7_000);
    expect(retryAfterMsFrom(null, "no hint here")).toBeNull();
  });

  it("never fails over on a user abort", () => {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    expect(isRetryable(abort)).toBe(false);
  });
});

describe("route ladder", () => {
  const cfg = (over: Partial<BrainConfig> = {}): BrainConfig => ({
    tier: "groq",
    model: "openai/gpt-oss-120b",
    keys: { groq: ["g1", "g2"], gemini: ["k1"] },
    ...over,
  });

  it("expands every model across every key", () => {
    const routes = routesFor(cfg());
    // Two Groq keys × Groq models, then the Gemini side.
    expect(routes.length).toBeGreaterThan(2);
    expect(routes[0]).toEqual({ provider: "groq", model: "openai/gpt-oss-120b", keyIndex: 0 });
    expect(routes[1]).toEqual({ provider: "groq", model: "openai/gpt-oss-120b", keyIndex: 1 });
    expect(routes.some((r) => r.provider === "gemini")).toBe(true);
  });

  it("leads with the configured model and never repeats a route", () => {
    const routes = routesFor(cfg({ model: "gemini-2.0-flash", tier: "gemini" }));
    expect(routes[0]).toEqual({ provider: "gemini", model: "gemini-2.0-flash", keyIndex: 0 });
    const seen = routes.map((r) => `${r.provider}/${r.model}#${r.keyIndex}`);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("contributes no routes for a provider with no keys", () => {
    const routes = routesFor(cfg({ keys: { groq: ["only-groq"] } }));
    expect(routes.every((r) => r.provider === "groq")).toBe(true);
  });

  // Automatic model switching, off. The promise is narrow and exact: the model the
  // user chose is the only model that ever answers — but its own keys still rotate,
  // because a second key is fresh quota for the SAME model, not a downgrade.
  it("pins to the configured model when auto-switching is off", () => {
    const routes = routesFor(cfg({ autoSwitchModels: false }));
    expect(routes.every((r) => r.model === "openai/gpt-oss-120b")).toBe(true);
    expect(routes.every((r) => r.provider === "groq")).toBe(true);
  });

  it("still walks every key of the pinned model", () => {
    const routes = routesFor(cfg({ autoSwitchModels: false }));
    expect(routes.map((r) => r.keyIndex)).toEqual([0, 1]);
  });

  it("keeps the full ladder when auto-switching is on", () => {
    const pinned = routesFor(cfg({ autoSwitchModels: false }));
    const open = routesFor(cfg({ autoSwitchModels: true }));
    expect(open.length).toBeGreaterThan(pinned.length);
    expect(open.some((r) => r.model !== "openai/gpt-oss-120b")).toBe(true);
  });

  // Nothing to pin TO — pinning an empty model would leave zero routes and fail
  // every turn, which is worse than the fallback it was meant to avoid.
  it("falls back to the full ladder when no model is configured", () => {
    const routes = routesFor(cfg({ autoSwitchModels: false, model: "" }));
    expect(routes.length).toBeGreaterThan(1);
  });

  it("drops benched routes and reports exhaustion only when all are gone", () => {
    const config = cfg({ keys: { groq: ["g1"] } });
    const all = routesFor(config);
    expect(usableRoutes(config)).toHaveLength(all.length);
    all.forEach((r) => quota.bench(r));
    expect(usableRoutes(config)).toHaveLength(0);
  });
});

describe("multi-key parsing", () => {
  it("splits on newlines and commas, trims, and dedupes in order", () => {
    expect(splitKeys("a\nb,c\n\n b ")).toEqual(["a", "b", "c"]);
    expect(splitKeys("  solo  ")).toEqual(["solo"]);
    expect(splitKeys("")).toEqual([]);
    expect(splitKeys(undefined)).toEqual([]);
  });
});
