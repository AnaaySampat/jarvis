/**
 * One model call, walking the route ladder until something answers.
 *
 * Its own module rather than part of `loop.ts` because BOTH the chat loop and the
 * on-phone operator (`tools/dispatch.ts`) need it, and `loop.ts` already imports
 * dispatch — putting it there makes those two files import each other.
 *
 * Replaces the old "retry once after 3.5s, then try the single other provider"
 * shape. Two things changed that matter: a route that fails is REMEMBERED (so the
 * next turn skips it instead of paying another 429 to learn the same thing), and
 * there are as many routes as the user has models × keys instead of two.
 */

import type { BrainConfig } from "./config";
import type { ChatMessage, ToolDeclaration } from "./types";
import { taskModelClass } from "./modelPolicy";
import { providerFor, type LLMReply } from "./providers";
import { routesFor } from "./routes";
import * as quota from "./quota";
import {
  isAbort,
  isFatalForRoute,
  isModelGone,
  isRateLimitSignal,
  isRetryable,
  limitWindow,
  ProviderError,
  retiredModelReplacement,
} from "./errorClass";
import { recordRemap } from "./modelRemap";
import { markModelDead } from "./providers/catalog";
import { EXTRA_PROVIDERS } from "./providers/openaiCompat";
import { markNoTools } from "./modelRanker";

/** Raised when the whole ladder is spent. Its message is the honest wait time. */
export class ExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExhaustedError";
  }
}

/**
 * Take a failed route out of rotation. Returns true when the failure is
 * MODEL-level (404), so the caller skips that model's sibling keys rather than
 * burning one attempt per key on a route that cannot work for any of them.
 */
function benchRoute(route: quota.Route, err: unknown): boolean {
  const detail = err instanceof ProviderError ? err.detail : String((err as Error)?.message ?? err);
  quota.learnLimit(route, detail);

  // Google retires model ids and names the replacement in the 404 itself. Record
  // it so routesFor() substitutes the live id from the next turn onward, instead
  // of this route staying dead until someone edits a constant. Without this the
  // whole Gemini tier parks for a DAY, every request piles onto the other
  // provider, and the user's first symptom is that provider's rate limit —
  // which is exactly how 2026-09-22 played out.
  const replacement = retiredModelReplacement(err);
  if (replacement) {
    recordRemap(route.model, replacement);
    console.warn(`[route] ${route.model} is retired -> using ${replacement} from now on`);
  }

  const held = quota.bench(route, {
    retryAfterMs: err instanceof ProviderError ? err.retryAfterMs : null,
    quotaSignal: isRateLimitSignal(err),
    window: limitWindow(err),
    // A rejected key or a missing model won't come back within a cooldown, and
    // re-trying it every 90s just wastes the user's turns. Saving keys in
    // Settings clears every bench, which is the action that actually fixes these.
    ...(isFatalForRoute(err) ? { durationMs: quota.DAY, quotaSignal: false } : {}),
  });
  console.warn(
    `[route] ${route.provider}/${route.model}#${route.keyIndex} benched ${quota.formatEta(held)}`,
    detail.slice(0, 160),
  );
  // A pooled provider's model that 404s is listed but not callable with this key —
  // swap in the next discovered candidate rather than losing the provider for a day.
  if (isModelGone(err) && (EXTRA_PROVIDERS as readonly string[]).includes(route.provider)) {
    markModelDead(route.provider, route.model);
  }
  return isModelGone(err);
}

/**
 * Feed a route the NATIVE phone operator benched mid-task back into the shared
 * quota table, so the next chat turn skips it instead of paying another 429 to
 * rediscover what the operator already learned.
 */
export function benchFromNative(b: {
  provider: string;
  model: string;
  keyIndex: number;
  status: number;
  detail: string;
  retryAfterMs: number | null;
}): void {
  benchRoute(
    { provider: b.provider, model: b.model, keyIndex: b.keyIndex },
    new ProviderError(`${b.provider} ${b.status}`, {
      status: b.status,
      retryAfterMs: b.retryAfterMs,
      detail: b.detail,
    }),
  );
}

export interface AskOpts {
  maxOutputTokens?: number;
  disableThinking?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * The honest "nothing left to try" message.
 *
 * With switching off, "every model I can reach" would be a lie — we deliberately
 * only reached for one. Name it, and point at the switch that changes it, so a
 * rate-limited turn doesn't look like a broken app.
 */
function exhausted(cfg: BrainConfig, attemptedModel = cfg.model): ExhaustedError {
  // Leave a trace. "I've used up the free quota on every model I can reach" is the
  // single most common way a phone task dies, and until now it logged NOTHING —
  // the route that failed, why, and how long it is parked for were all invisible,
  // so the only diagnosis available was guesswork. A phone task spends one call
  // per step, so it reaches this far sooner than a chat turn does.
  const snap = quota.snapshot();
  console.warn(
    `[route] EXHAUSTED — no usable route left (attempted ${attemptedModel || "?"}). ` +
      `Benched: ${
        snap.benched.length
          ? snap.benched
              .map((b) => `${b.route.replace(//g, "/")} (${b.secondsLeft}s left)`)
              .join(", ")
          : "none"
      }`,
  );
  if (cfg.autoSwitchModels === false && attemptedModel) {
    return new ExhaustedError(
      `${quota.exhaustedMessage(attemptedModel)} Automatic model switching is off, so I didn't ` +
        `try any other model — turn it on in Settings if you'd rather I fall back.`,
    );
  }
  return new ExhaustedError(quota.exhaustedMessage());
}

export async function chatOverLadder(
  convo: ChatMessage[],
  tools: ToolDeclaration[],
  cfg: BrainConfig,
  onFallback?: (msg: string) => void,
  opts?: AskOpts,
): Promise<LLMReply> {
  // The same ladder is used for a post-tool follow-up, so look back for the
  // actual user request rather than classifying raw tool output as a new task.
  const userText = [...convo].reverse().find((m) => m.role === "user")?.content ?? "";
  // The class also picks the smart-routing tier for a pinned model's fallbacks.
  const requestedClass = opts?.disableThinking ? "dumb" : taskModelClass(userText);
  const allRoutes = routesFor(cfg, requestedClass, tools.length > 0);
  let lastError: unknown = null;
  const skipModels = new Set<string>();

  // A per-minute limit benches its route for seconds, not minutes, so when every
  // route is out only briefly the right answer is ONE short wait — not "I've used
  // up the free quota" over a ceiling that resets in 8s. Usually that happens after
  // a pass has just failed, so the wait may come before any pass or after the first.
  const usableNow = () =>
    allRoutes.filter((route) => quota.usable(route) && !skipModels.has(route.model));
  let waited = false;
  for (let pass = 0; pass < 3; pass++) {
    let routes = usableNow();
    if (!routes.length && !waited) {
      const wait = Math.min(...allRoutes.map((r) => quota.readyIn(r)));
      if (Number.isFinite(wait) && wait <= SHORT_WAIT_MS) {
        waited = true;
        await sleep(wait + 250, opts?.signal);
        routes = usableNow();
      }
    }
    if (!routes.length) break;
    const reply = await tryRoutes(routes);
    if (reply) return reply;
  }
  throw exhausted(cfg, allRoutes[0]?.model);

  async function tryRoutes(routes: quota.Route[]): Promise<LLMReply | null> {
    for (const route of routes) {
      if (skipModels.has(route.model)) continue;
      try {
        const reply = await providerFor(cfg, route.provider).chat(convo, tools, {
          ...opts,
          model: route.model,
          keyIndex: route.keyIndex,
        });
        // The preferred route silently failed and we're answering on a different
        // one — say so now rather than only when everything fails, so a
        // misconfigured primary can't hide behind a fallback that happens to work
        // (exactly what masked the Vertex model/region bug).
        //
        // Only a genuine MODEL change is worth reporting. Falling to route 1 can also
        // just be the next key for the same model, which is invisible by design —
        // announcing "Switched to groq/<same model>" reads as a bug, and it would fire
        // even with switching turned off, where the whole promise is that the model
        // never changes.
        // Compare against the PREFERRED route, not the head of the quota-filtered
        // list: once the preferred one is benched it is no longer routes[0], so
        // `index > 0` was false and the notice went silent for the whole bench
        // window — exactly the silent fallback this is here to surface.
        const head = allRoutes[0]!;
        if (route.model !== head.model || route.provider !== head.provider) {
          // lastError is null when the preferred route never ran this turn because
          // quota had already benched it — say that instead of printing "null".
          const why = lastError
            ? String((lastError as Error)?.message ?? lastError)
            : `${head.provider}/${head.model} is benched`;
          onFallback?.(
            `Switched to ${route.provider}/${route.model} for this reply: ` + why.slice(0, 150),
          );
        }
        return reply;
      } catch (err) {
        // The user cancelled — failing over would answer a question nobody asked.
        if (isAbort(err)) throw err;
        lastError = err;
        // This model can't do tool calls (Gemma on the Gemini API, some pooled
        // models). Remember it so action turns route past it from now on, and try
        // the next model rather than failing the turn over it.
        if (tools.length && rejectsTools(err)) {
          markNoTools(route.provider, route.model);
          skipModels.add(route.model);
          continue;
        }
        // A failure the ladder can't route around (a malformed request, say) is the
        // caller's problem, not a reason to replay it against every other model.
        if (!isRetryable(err)) throw err;
        if (benchRoute(route, err)) skipModels.add(route.model);
      }
    }
    return null;
  }
}

/** A 400 saying this MODEL can't do tool/function calling. Marking is permanent, so
 *  it needs the "not supported/enabled" wording: a 400 that merely mentions tools
 *  (a bad schema, Gemini's "function call turn must follow a user turn") is about
 *  this one request, and once benched Gemini 3.6/3.5-flash from every action turn. */
export function rejectsTools(err: unknown): boolean {
  if (!(err instanceof ProviderError) || err.status !== 400) return false;
  const d = (err.detail || err.message || "").toLowerCase();
  const aboutTools = /tool|function.?call/.test(d);
  return aboutTools && /not (?:supported|enabled|available)|does ?n[o']t support|unsupported/.test(d);
}

/** Longest a turn will wait for a briefly-benched route before calling it spent. */
const SHORT_WAIT_MS = 15_000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
