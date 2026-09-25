package com.jarvis.phone

import org.junit.Assert.assertEquals
import org.junit.Test

class NavigationWaitGateTest {
    @Test
    fun acceptanceWithoutStateChangeTimesOutFailClosed() {
        assertEquals(
            NavigationWaitDecision.TIMED_OUT,
            decide(nowMs = 1_800, before = "same", after = "same"),
        )
    }

    @Test
    fun changedAndQuietStateSucceeds() {
        assertEquals(
            NavigationWaitDecision.SUCCEEDED,
            decide(nowMs = 500, lastEventAtMs = 200, before = "before", after = "after"),
        )
    }

    @Test
    fun stopWinsEvenAfterAChangedQuietState() {
        assertEquals(
            NavigationWaitDecision.CANCELLED,
            decide(
                nowMs = 500,
                lastEventAtMs = 200,
                before = "before",
                after = "after",
                currentEpoch = 2,
            ),
        )
    }

    @Test
    fun changedButStillAnimatingKeepsWaiting() {
        assertEquals(
            NavigationWaitDecision.WAIT,
            decide(nowMs = 500, lastEventAtMs = 400, before = "before", after = "after"),
        )
    }

    private fun decide(
        nowMs: Long,
        lastEventAtMs: Long = 0,
        before: String,
        after: String,
        currentEpoch: Int = 1,
    ) = navigationWaitDecision(
        expectedEpoch = 1,
        currentEpoch = currentEpoch,
        startedAtMs = 0,
        nowMs = nowMs,
        lastEventAtMs = lastEventAtMs,
        beforeState = before,
        afterState = after,
        quietMs = 220,
        timeoutMs = 1_800,
    )
}
