package com.jarvis.phone

/**
 * Per-route pacing for the native operator's model ladder. Pure (clock injected) so
 * the JVM tests can drive it; NativeOperator's HttpLadderModel does the I/O.
 *
 * WHY. On free tiers the binding limits are per MINUTE (Groq: tokens per minute; the
 * operator sends ~2k tokens a step and a step takes ~0.7s), and they reset in seconds.
 * The ladder used to bench a 429'd route for 2 minutes and fall straight through to
 * the next — so one burst of steps benched every route within ~20s and the task died
 * (2026-09-23). Now a per-minute limit costs exactly the wait the provider names,
 * a route Groq's own headers say is out of tokens is skipped until its reset instead
 * of being spent on a 429, and when every route is only briefly out the ladder waits.
 *
 * Mirrors the TS side (quota.ts bench windows, errorClass.limitWindow /
 * retryAfterMsFrom) so a route's window is classified the same way in both.
 */
class RoutePacer(private val routeCount: Int, private val now: () -> Long) {
    companion object {
        const val TRANSIENT_MS = 20_000L
        const val MINUTE_DEFAULT_MS = 20_000L
        const val MINUTE_MIN_MS = 2_000L
        const val MINUTE_MAX_MS = 65_000L
        const val UNKNOWN_QUOTA_MS = 60_000L
        /** Longer than any task: the route is out for the rest of it. */
        const val GONE = Long.MAX_VALUE / 4

        private val DAY_RE = Regex("per\\s*day|perday|\\b(?:rpd|tpd)\\b")
        private val MINUTE_RE = Regex("per\\s*min(?:ute)?|perminute|\\b(?:rpm|tpm)\\b|rate-limited upstream")
        private val RETRY_DELAY_RE = Regex("\"retryDelay\"\\s*:\\s*\"(\\d+(?:\\.\\d+)?)s\"")
        private val RETRY_PROSE_RE =
            Regex("(?:try again|retry) in ((?:\\d+(?:\\.\\d+)?\\s*(?:ms|s|m|h)\\s*)+)", RegexOption.IGNORE_CASE)
        private val DURATION_PART_RE = Regex("(\\d+(?:\\.\\d+)?)\\s*(ms|s|m|h|d)")

        /** "minute", "day", or null when the body doesn't say (errorClass.limitWindow). */
        fun limitWindow(detail: String): String? {
            val msg = detail.lowercase()
            return when {
                DAY_RE.containsMatchIn(msg) -> "day"
                MINUTE_RE.containsMatchIn(msg) -> "minute"
                else -> null
            }
        }

        /** Seconds from "7.66s", "2m59.56s", "60" (quota.headerNumber). */
        fun durationSeconds(raw: String?): Double? {
            val text = raw?.trim().orEmpty()
            if (text.isEmpty()) return null
            text.toDoubleOrNull()?.let { return it }
            val units = mapOf("ms" to 0.001, "s" to 1.0, "m" to 60.0, "h" to 3600.0, "d" to 86400.0)
            val parts = DURATION_PART_RE.findAll(text).toList()
            if (parts.isEmpty()) return null
            return parts.sumOf { it.groupValues[1].toDouble() * units.getValue(it.groupValues[2]) }
        }

        /** The provider's requested wait in ms: Retry-After, Gemini's retryDelay, or
         *  Groq/Gemini prose ("Please try again in 6.3s"). */
        fun retryAfterMs(header: String?, body: String): Long? {
            header?.trim()?.toDoubleOrNull()?.let { return (it * 1000).toLong() }
            RETRY_DELAY_RE.find(body)?.let { return (it.groupValues[1].toDouble() * 1000).toLong() }
            val prose = RETRY_PROSE_RE.find(body) ?: return null
            return durationSeconds(prose.groupValues[1])?.let { (it * 1000).toLong() }
        }
    }

    private val benchedUntil = LongArray(routeCount)
    private val tokensLeft = arrayOfNulls<Long>(routeCount)
    private val tokensResetAt = LongArray(routeCount)

    /** Record Groq-style `x-ratelimit-*-tokens` headers from ANY response, 200s included —
     *  a 200 that reports nothing left is the chance to skip the route, not 429 it. */
    fun noteHeaders(route: Int, remainingTokens: String?, resetTokens: String?) {
        val left = remainingTokens?.trim()?.toLongOrNull() ?: return
        tokensLeft[route] = left
        tokensResetAt[route] = now() + ((durationSeconds(resetTokens) ?: 0.0) * 1000).toLong()
    }

    /** Ms until [route] can take a request of about [estTokens]; 0 means now. */
    fun readyIn(route: Int, estTokens: Int): Long {
        val t = now()
        var wait = maxOf(0L, benchedUntil[route] - t)
        val left = tokensLeft[route]
        if (left != null && left < estTokens && tokensResetAt[route] > t) {
            wait = maxOf(wait, tokensResetAt[route] - t)
        }
        return wait
    }

    /** Bench [route] after a failed call; returns the bench length. A missing model is
     *  missing for every key, so [sameModel] routes are benched with it on a 404. */
    fun noteFailure(route: Int, status: Int, detail: String, retryAfterMs: Long?, sameModel: List<Int> = emptyList()): Long {
        val forMs = when (status) {
            // 400: the body is built per provider/model (thinking knobs, token field), so
            // one model rejecting it says nothing about the next — skip it for this task.
            400, 401, 403, 404, 410 -> GONE // won't recover within a task
            429, 413 -> when (limitWindow(detail)) {
                "minute" -> (retryAfterMs ?: MINUTE_DEFAULT_MS).coerceIn(MINUTE_MIN_MS, MINUTE_MAX_MS)
                "day" -> GONE
                else -> retryAfterMs?.coerceAtMost(MINUTE_MAX_MS) ?: UNKNOWN_QUOTA_MS
            }
            else -> TRANSIENT_MS // busy / timeout / network: a short breather
        }
        val until = if (forMs >= GONE) GONE else now() + forMs
        benchedUntil[route] = until
        if (status == 404 || status == 410) sameModel.forEach { benchedUntil[it] = until }
        return forMs
    }
}
