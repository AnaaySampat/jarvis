package com.jarvis.phone

internal enum class NavigationWaitDecision {
    WAIT,
    SUCCEEDED,
    CANCELLED,
    TIMED_OUT,
}

/** Pure decision gate so an accepted global navigation action cannot be confused
 * with a verified UI transition, and STOP always wins a concurrent completion. */
internal fun navigationWaitDecision(
    expectedEpoch: Int,
    currentEpoch: Int,
    startedAtMs: Long,
    nowMs: Long,
    lastEventAtMs: Long,
    beforeState: String,
    afterState: String,
    quietMs: Long,
    timeoutMs: Long,
): NavigationWaitDecision {
    if (expectedEpoch != currentEpoch) return NavigationWaitDecision.CANCELLED
    if (beforeState != afterState && nowMs - lastEventAtMs >= quietMs) {
        return NavigationWaitDecision.SUCCEEDED
    }
    if (nowMs - startedAtMs >= timeoutMs) return NavigationWaitDecision.TIMED_OUT
    return NavigationWaitDecision.WAIT
}
