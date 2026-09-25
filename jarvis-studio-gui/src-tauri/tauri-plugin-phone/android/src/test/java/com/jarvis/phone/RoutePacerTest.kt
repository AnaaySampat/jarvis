package com.jarvis.phone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RoutePacerTest {
    private var clock = 1_000_000L
    private fun pacer(n: Int = 2) = RoutePacer(n) { clock }

    private val groqTpm =
        "Rate limit reached for model `openai/gpt-oss-20b` in organization `org_x` on tokens per " +
            "minute (TPM): Limit 8000, Used 7600, Requested 1200. Please try again in 6.3s."

    @Test fun aPerMinuteLimitCostsExactlyTheProviderWait() {
        val p = pacer()
        val retry = RoutePacer.retryAfterMs(null, groqTpm)
        assertEquals(6_300L, retry)
        assertEquals(6_300L, p.noteFailure(0, 429, groqTpm, retry))
        assertEquals(6_300L, p.readyIn(0, 1_000))
        clock += 6_300
        assertEquals(0L, p.readyIn(0, 1_000))
    }

    @Test fun aDailyLimitTakesTheRouteOutForTheTask() {
        val p = pacer()
        val forMs = p.noteFailure(0, 429, "… on requests per day (RPD): Limit 1000", null)
        assertEquals(RoutePacer.GONE, forMs)
        clock += 10 * 60_000
        assert(p.readyIn(0, 1) > 60_000)
    }

    @Test fun geminiQuotaIdsAndRetryDelayAreRead() {
        val minute = """{"error":{"code":429,"details":[{"violations":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]},{"retryDelay":"7s"}]}}"""
        assertEquals("minute", RoutePacer.limitWindow(minute))
        assertEquals(7_000L, RoutePacer.retryAfterMs(null, minute))
        assertEquals("day", RoutePacer.limitWindow("""{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}"""))
        assertNull(RoutePacer.limitWindow("You exceeded your current quota"))
    }

    @Test fun perMinuteBenchesAreClampedAndBusyRoutesGetAShortBreather() {
        val p = pacer()
        assertEquals(RoutePacer.MINUTE_MIN_MS, p.noteFailure(0, 429, "tokens per minute", 100))
        assertEquals(RoutePacer.MINUTE_MAX_MS, p.noteFailure(0, 429, "tokens per minute", 600_000))
        assertEquals(RoutePacer.MINUTE_DEFAULT_MS, p.noteFailure(0, 429, "tokens per minute", null))
        assertEquals(RoutePacer.TRANSIENT_MS, p.noteFailure(1, 503, "high demand", null))
    }

    @Test fun aRouteTheHeadersSayIsOutOfTokensIsSkippedUntilItsReset() {
        // Groq reports remaining tokens on every response; a 200 saying 500 left means
        // a 2k-token step would 429 — wait for the reset instead of sending it.
        val p = pacer()
        p.noteHeaders(0, "500", "4.5s")
        assertEquals(4_500L, p.readyIn(0, 2_000))
        assertEquals(0L, p.readyIn(0, 400)) // a small request still fits
        clock += 4_500
        assertEquals(0L, p.readyIn(0, 2_000))
    }

    @Test fun aMissingModelBenchesEveryKeyForIt() {
        val p = pacer(3)
        p.noteFailure(0, 404, "not found", null, sameModel = listOf(0, 2))
        assert(p.readyIn(2, 1) > 0)
        assertEquals(0L, p.readyIn(1, 1))
    }

    @Test fun aGoneModelIsOutForTheTask() {
        // NVIDIA answered 410 Gone (2026-09-23) where others say 404.
        val p = pacer(2)
        assertEquals(RoutePacer.GONE, p.noteFailure(0, 410, "Gone", null, sameModel = listOf(0, 1)))
        assert(p.readyIn(1, 1) > 0)
    }

    @Test fun durationsParseLikeTheBrain() {
        assertEquals(7.66, RoutePacer.durationSeconds("7.66s")!!, 1e-9)
        assertEquals(179.56, RoutePacer.durationSeconds("2m59.56s")!!, 1e-9)
        assertEquals(60.0, RoutePacer.durationSeconds("60")!!, 1e-9)
        assertNull(RoutePacer.durationSeconds(""))
    }
}
