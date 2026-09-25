/**
 * Free-tier quota memory: what just failed, and when it comes back.
 *
 * Mirrors the desktop app's `llm/quota.py` (`aura/jarvis-studio-backend`) — same
 * ladder, same header parsing, same wording — so the two apps behave identically
 * on the same free-tier key. Keep them in sync when either changes.
 *
 * Before this, `loop.ts` answered a 429 with one 3.5s sleep and a retry on the
 * SAME model and the SAME key, then a single cross-provider hop. Nothing was
 * remembered, so the next turn walked straight back into the same dead route.
 *
 * Three ideas, ported from the freellmapi gateway:
 *   1. Groq reports remaining quota on EVERY response via x-ratelimit-* headers,
 *      so we can know a route is spent BEFORE wasting a call on it. (Gemini
 *      publishes none — its ceilings are learned from failures instead.)
 *   2. A failed route is benched on an escalating ladder — 2m, 10m, 1h, a day —
 *      so a genuinely spent daily quota stops eating a fallback slot every turn.
 *      A success clears the ladder.
 *   3. Providers state their real limit in the error body ("Limit 30000"), so we
 *      can learn it rather than rediscover it.
 *
 * State is keyed on a route (provider, model, key index) and persisted, because a
 * 24h bench the app forgets on relaunch is not a bench.
 */

import { makeKV, type KV } from "./memory/store";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const STORAGE_KEY = "jarvis.quota.v1";

/** One concrete way to answer a turn. */
export interface Route {
  provider: string;
  model: string;
  /** Position in the provider's key list. */
  keyIndex: number;
}

/** Field separator for the composite storage key. A control character, because
 *  model ids legitimately contain '/', ':' and '.' — any of those would split
 *  a key like 'openai/gpt-oss-120b' in the wrong place on the way back in. */
const SEP = "\u001f";

export function routeKey(r: Route): string {
  return `${r.provider}${SEP}${r.model}${SEP}${r.keyIndex}`;
}

function parseRouteKey(s: string): Route | null {
  const parts = s.split(SEP);
  if (parts.length !== 3) return null;
  const keyIndex = Number(parts[2]);
  if (!Number.isInteger(keyIndex)) return null;
  return { provider: parts[0]!, model: parts[1]!, keyIndex };
}

// Escalate per route over a rolling 24h window so a spent daily quota quarantines
// for the rest of the day rather than looping through a 2-minute bench 20 times.
const LADDER = [2 * MINUTE, 10 * MINUTE, HOUR, DAY];

// A failure carrying NO quota information (timeout, 5xx, transport) gets this
// fixed short bench and never advances the ladder — otherwise two slow answers
// would escalate a healthy route to a day-long quarantine for being slow. Short,
// because the common case is Gemini's 503 "high demand", which passes in seconds.
const TRANSIENT = 20_000;
// ...but a route that KEEPS timing out is not "briefly busy": on 2026-09-25 a Gemma
// route timed out at 30s, was back in 20s, and would cost the next turn another 30s.
// Repeats within SLOW_WINDOW climb this short ladder instead. Capped at 10 minutes,
// never the day ladder, and any success resets it (onSuccess).
const TRANSIENT_LADDER = [TRANSIENT, 2 * MINUTE, 10 * MINUTE];
const SLOW_WINDOW = 30 * MINUTE;

// A PER-MINUTE ceiling (TPM/RPM) clears within its minute. Bench for exactly what
// the provider asked, clamped to this range, and never climb the day ladder for it.
const MINUTE_WINDOW_DEFAULT = 20_000;
const MINUTE_WINDOW_MIN = 2_000;
const MINUTE_WINDOW_MAX = 65_000;

const cooldowns = new Map<string, number>(); // routeKey -> expiry (epoch ms)
const hits = new Map<string, number[]>(); // routeKey -> recent bench timestamps
const slow = new Map<string, number[]>(); // routeKey -> recent transient failures (memory only)
const headers = new Map<string, { remaining: number; resetAt: number }>();
const learned = new Map<string, Record<string, number>>(); // "provider<SEP>model"

let kv: KV | null = null;
let dirty = false;
let lastSave = 0;
const SAVE_INTERVAL = 10_000; // debounce: a hint file, not a ledger

function store(): KV {
  if (!kv) kv = makeKV();
  return kv;
}

/** Test seam: swap in a fake KV. */
export function setStorage(next: KV | null): void {
  kv = next;
}

// ── Persistence ──────────────────────────────────────────────────────────────

let loaded = false;

/** Restore persisted state the first time anything reads it. Self-triggering
 *  rather than wired into app startup: the brain is imported from several entry
 *  points (chat, the operator, the wake-word listener) and a bench that only
 *  reloads on one of those paths is a bench that sometimes silently isn't one. */
function ensureLoaded(): void {
  if (loaded) return;
  load();
}

export function load(): void {
  loaded = true;
  cooldowns.clear();
  hits.clear();
  slow.clear();
  headers.clear();
  learned.clear();
  let parsed: unknown;
  try {
    const raw = store().get(STORAGE_KEY);
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    return;
  }
  // Everything below re-validates rather than trusting the shape: this is user-
  // writable storage, and a malformed record must degrade to "no memory", never
  // to a crash on the first turn after an upgrade.
  if (!parsed || typeof parsed !== "object") return;
  const data = parsed as Record<string, unknown>;
  const section = (name: string): Record<string, unknown> => {
    const value = data[name];
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  };

  const now = Date.now();
  for (const [key, expiry] of Object.entries(section("cooldowns"))) {
    if (parseRouteKey(key) && typeof expiry === "number" && expiry > now) {
      cooldowns.set(key, expiry);
    }
  }
  for (const [key, stamps] of Object.entries(section("hits"))) {
    if (!parseRouteKey(key) || !Array.isArray(stamps)) continue;
    const recent = (stamps as unknown[]).filter(
      (t): t is number => typeof t === "number" && t > now - DAY,
    );
    if (recent.length) hits.set(key, recent);
  }
  for (const [key, limits] of Object.entries(section("learned"))) {
    if (limits && typeof limits === "object") {
      learned.set(key, limits as Record<string, number>);
    }
  }
}

/** Write benches out, debounced. Header observations are deliberately NOT
 *  persisted: they describe a minute-scale window that is stale by the next
 *  launch, and a stale "remaining: 0" would strand a perfectly healthy route. */
export function save(force = false): void {
  if (!dirty && !force) return;
  const now = Date.now();
  if (!force && now - lastSave < SAVE_INTERVAL) return;
  const payload = {
    cooldowns: Object.fromEntries([...cooldowns].filter(([, e]) => e > now)),
    hits: Object.fromEntries([...hits].map(([k, s]) => [k, s.filter((t) => t > now - DAY)])),
    learned: Object.fromEntries(learned),
  };
  try {
    store().set(STORAGE_KEY, JSON.stringify(payload));
    dirty = false;
    lastSave = now;
  } catch {
    /* storage full or blocked — quota memory degrades to this session only */
  }
}

// ── Provider headers ─────────────────────────────────────────────────────────

/** A header value as a number of seconds. Groq sends durations like "7.66s" and
 *  "2m59.56s" in the reset headers, plain integers in the remaining ones. */
export function headerNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const plain = Number(text);
  if (Number.isFinite(plain)) return plain;
  const units: Record<string, number> = { ms: 0.001, s: 1, m: 60, h: 3600, d: 86400 };
  let total = 0;
  let matched = false;
  for (const [, value, unit] of text.matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)/g)) {
    total += Number(value) * units[unit!]!;
    matched = true;
  }
  return matched ? total : null;
}

type HeaderBag = { get(name: string): string | null };

/**
 * Record what the provider just said about this route's remaining quota.
 *
 * Called on EVERY response, 200 included — a 200 reporting 0 remaining is the
 * whole point: the next turn skips this route instead of spending a 429 to
 * discover it. Providers that publish nothing are a silent no-op.
 */
export function noteResponse(route: Route, status: number, bag?: HeaderBag | null): void {
  if (!bag || typeof bag.get !== "function") return;
  const key = routeKey(route);

  let remaining: number | null = null;
  let reset = 0;
  for (const metric of ["requests", "tokens"] as const) {
    const left = headerNumber(bag.get(`x-ratelimit-remaining-${metric}`));
    if (left == null) continue;
    // Keep the TIGHTEST axis: whichever of requests/tokens runs out first is the
    // one that will actually 429 us.
    if (remaining == null || left < remaining) {
      remaining = left;
      reset = headerNumber(bag.get(`x-ratelimit-reset-${metric}`)) ?? 0;
    }
  }
  if (remaining != null) {
    headers.set(key, { remaining, resetAt: Date.now() + reset * 1000 });
  }

  const retryAfter = headerNumber(bag.get("retry-after"));
  if (status === 429 && retryAfter) {
    headers.set(key, { remaining: 0, resetAt: Date.now() + retryAfter * 1000 });
    dirty = true;
  }
}

// ── Learned limits ───────────────────────────────────────────────────────────
// Ordered day-before-minute and tokens-before-requests so "tokens per day" isn't
// shadowed by the 'tpm' alternative, and a body mentioning both lands on the more
// specific token ceiling.
const LIMIT_AXES: Array<[string, RegExp]> = [
  ["tpd", /tokens?\s*per\s*day|\btpd\b/i],
  ["tpm", /tokens?\s*per\s*min(?:ute)?|\btpm\b/i],
  ["rpd", /requests?\s*per\s*day|\brpd\b/i],
  ["rpm", /requests?\s*per\s*min(?:ute)?|\brpm\b/i],
];

/**
 * Pull a provider-stated ceiling out of an error body. Groq 413s read: "Request
 * too large ... on tokens per minute (TPM): Limit 30000, Requested 33476".
 * Returns null unless BOTH a number and a confident axis are present — guessing
 * the axis would record the wrong ceiling and mis-gate every later request.
 */
export function parseLimit(message?: string | null): { kind: string; limit: number } | null {
  if (!message) return null;
  const found = /\blimit[:\s]+([\d,]+)/i.exec(message);
  if (!found) return null;
  const limit = Number(found[1]!.replace(/,/g, ""));
  if (!Number.isFinite(limit) || limit <= 0) return null;
  for (const [kind, pattern] of LIMIT_AXES) {
    if (pattern.test(message)) return { kind, limit };
  }
  return null;
}

/** Record a stated ceiling, but only when it makes us MORE conservative: hitting
 *  a limit proves our previous belief was too high, never too low. */
export function learnLimit(
  route: Route,
  message?: string | null,
): { kind: string; limit: number } | null {
  const parsed = parseLimit(message);
  if (!parsed) return null;
  const key = `${route.provider}${SEP}${route.model}`;
  const slot = learned.get(key) ?? {};
  const existing = slot[parsed.kind];
  if (existing != null && existing <= parsed.limit) return null;
  slot[parsed.kind] = parsed.limit;
  learned.set(key, slot);
  dirty = true;
  return parsed;
}

export function learnedLimits(route: Route): Record<string, number> {
  return { ...(learned.get(`${route.provider}${SEP}${route.model}`) ?? {}) };
}

// ── Benching ─────────────────────────────────────────────────────────────────

export interface BenchOpts {
  /** The provider's own requested wait, in ms. Honoured as a FLOOR. */
  retryAfterMs?: number | null;
  /** False for failures carrying no quota information (timeout, 5xx, transport).
   *  Those get the short fixed bench and never advance the ladder. */
  quotaSignal?: boolean;
  /** Force a specific bench, for failures the ladder's reasoning doesn't fit
   *  (a rejected key, a model that no longer exists). */
  durationMs?: number;
  /** The quota window the provider named (errorClass.limitWindow). "minute" gets a
   *  seconds-long bench off the provider's own wait and never advances the ladder. */
  window?: "minute" | "day" | null;
}

/** Take a route out of rotation. Returns the bench length in ms. */
export function bench(route: Route, opts: BenchOpts = {}): number {
  ensureLoaded();
  const key = routeKey(route);
  const now = Date.now();
  const quotaSignal = opts.quotaSignal ?? true;

  let duration: number;
  if (opts.durationMs == null && quotaSignal && opts.window === "minute") {
    duration = Math.min(
      MINUTE_WINDOW_MAX,
      Math.max(MINUTE_WINDOW_MIN, opts.retryAfterMs ?? MINUTE_WINDOW_DEFAULT),
    );
    cooldowns.set(key, now + duration);
    headers.delete(key);
    dirty = true;
    save();
    return duration;
  }
  if (opts.durationMs != null) {
    duration = opts.durationMs;
  } else if (!quotaSignal) {
    const recent = (slow.get(key) ?? []).filter((t) => t > now - SLOW_WINDOW);
    recent.push(now);
    slow.set(key, recent);
    duration = TRANSIENT_LADDER[Math.min(recent.length - 1, TRANSIENT_LADDER.length - 1)]!;
  } else {
    const recent = (hits.get(key) ?? []).filter((t) => t > now - DAY);
    recent.push(now);
    hits.set(key, recent);
    duration = LADDER[Math.min(recent.length - 1, LADDER.length - 1)]!;
  }

  // Never bench shorter than our own reasoning, but do extend when the provider
  // explicitly asks for longer than we would have. Capped at a day.
  if (opts.retryAfterMs && opts.retryAfterMs > duration) {
    duration = Math.min(opts.retryAfterMs, DAY);
  }

  cooldowns.set(key, now + duration);
  headers.delete(key);
  dirty = true;
  save();
  return duration;
}

/** A served request proves the route is alive: drop its bench and reset the
 *  ladder, so the next failure starts at 2 minutes rather than inheriting steps. */
export function onSuccess(route: Route): void {
  const key = routeKey(route);
  const had = cooldowns.delete(key);
  const hadHits = hits.delete(key);
  slow.delete(key);
  // Header observations deliberately survive: noteResponse runs just before this
  // on every 200, and a success reporting 0 tokens remaining is exactly the
  // signal to keep — clearing it would throw away the pre-flight gate.
  if (had || hadHits) {
    dirty = true;
    save();
  }
}

/** False when we already know this route will fail. */
export function usable(route: Route): boolean {
  ensureLoaded();
  const key = routeKey(route);
  const now = Date.now();
  const expiry = cooldowns.get(key);
  if (expiry != null) {
    if (now < expiry) return false;
    cooldowns.delete(key);
  }
  const observed = headers.get(key);
  if (observed) {
    if (now >= observed.resetAt) headers.delete(key);
    else if (observed.remaining <= 0) return false;
  }
  return true;
}

/** Ms until this route is usable again; 0 when it already is. */
export function cooldownRemaining(route: Route): number {
  return Math.max(0, (cooldowns.get(routeKey(route)) ?? 0) - Date.now());
}

/** Ms until this route can be tried again — its bench, or a provider header that
 *  said nothing is left until a reset. 0 when it's usable now. */
export function readyIn(route: Route): number {
  ensureLoaded();
  const now = Date.now();
  const key = routeKey(route);
  const bench = Math.max(0, (cooldowns.get(key) ?? 0) - now);
  const observed = headers.get(key);
  const header = observed && observed.remaining <= 0 ? Math.max(0, observed.resetAt - now) : 0;
  return Math.max(bench, header);
}

/** Ms until the FIRST benched route returns, or null when nothing is benched. */
export function soonestReset(): number | null {
  const now = Date.now();
  const live = [...cooldowns.values(), ...[...headers.values()].map((h) => h.resetAt)].filter(
    (e) => e > now,
  );
  return live.length ? Math.min(...live) - now : null;
}

/** A spoken-language ETA. JARVIS talks, so "4 minutes" beats "243000ms". */
export function formatEta(ms: number | null): string {
  if (ms == null || ms <= 0) return "shortly";
  if (ms < 90_000) return "under a minute";
  if (ms < HOUR) return `about ${Math.round(ms / MINUTE)} minutes`;
  if (ms < DAY) {
    const hours = Math.round(ms / HOUR);
    return hours <= 1 ? "about an hour" : `about ${hours} hours`;
  }
  return "tomorrow";
}

/** The only rate-limit sentence the user should ever see — and only once every
 *  route is genuinely spent, with a real time rather than "give me a moment". */
export function exhaustedMessage(what = "every model I can reach"): string {
  return `I've used up the free quota on ${what}, sir. It should free up ${formatEta(soonestReset())}.`;
}

/**
 * Drop every bench, storage included — the escape hatch.
 *
 * An escalated bench can park a route for a day off one bad window. Called when
 * the user saves their API keys, which is exactly when they've fixed the cause
 * and shouldn't wait out a quarantine that no longer applies. Learned limits
 * survive: those are facts about the model, not about the key.
 */
export function clear(): void {
  cooldowns.clear();
  hits.clear();
  slow.clear();
  headers.clear();
  dirty = true;
  save(true);
}

/** Diagnostics for Settings / logs. Read-only. */
export function snapshot() {
  const now = Date.now();
  return {
    benched: [...cooldowns]
      .filter(([, e]) => e > now)
      .sort((a, b) => a[1] - b[1])
      .map(([k, e]) => ({ route: k, secondsLeft: Math.round((e - now) / 1000) })),
    remaining: Object.fromEntries(
      [...headers].filter(([, h]) => h.resetAt > now).map(([k, h]) => [k, h.remaining]),
    ),
    learned: Object.fromEntries(learned),
  };
}

/** Test seam: forget everything in memory (leaves storage alone). */
export function reset(): void {
  cooldowns.clear();
  hits.clear();
  slow.clear();
  headers.clear();
  learned.clear();
  dirty = false;
  lastSave = 0;
  // Counts as loaded: a test that reset state does not want it read back in.
  loaded = true;
}
