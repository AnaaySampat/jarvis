package com.jarvis.phone

/** Labels from the bundled MediaPipe canned-gesture classifier, not screen-axis
 * heuristics. A thumbs-up is feedback only, never approval for an action. */
object GestureRecognition {
    enum class Gesture { OPEN_PALM, PEACE, THUMBS_UP, THUMBS_DOWN, POINT_UP, LOVE, FIST, UNKNOWN }

    fun recognize(label: String, score: Float, minimum: Float = 0.8f, runnerUp: Float = 0f): Gesture {
        if (!score.isFinite() || !minimum.isFinite() || !runnerUp.isFinite() ||
            minimum !in 0f..1f || runnerUp !in 0f..1f || score < minimum || score > 1f ||
            score - runnerUp < 0.12f) return Gesture.UNKNOWN
        return when (label) {
            "Open_Palm" -> Gesture.OPEN_PALM
            "Victory" -> Gesture.PEACE
            "Thumb_Up" -> Gesture.THUMBS_UP
            "Thumb_Down" -> Gesture.THUMBS_DOWN
            "Pointing_Up" -> Gesture.POINT_UP
            "ILoveYou" -> Gesture.LOVE
            "Closed_Fist" -> Gesture.FIST
            else -> Gesture.UNKNOWN
        }
    }

    fun usableHand(points: List<List<Float>>): Boolean {
        if (points.size != 21 || points.any { p -> p.size != 3 || p.any { !it.isFinite() } ||
            p[0] !in 0f..1f || p[1] !in 0f..1f || kotlin.math.abs(p[2]) > 2f }) return false
        val scale = kotlin.math.sqrt((0..2).sumOf { i ->
            val d = (points[0][i] - points[9][i]).toDouble()
            d * d
        })
        return scale >= 0.04
    }
    /** MediaPipe projects landmarks back onto the original sensor image even
     * when preprocessing rotates it. Publish upright coordinates as before,
     * including depth's normalization by the upright image width. */
    fun uprightLandmark(x: Float, y: Float, z: Float, rotation: Int, width: Int, height: Int): List<Float> =
        when (rotation) {
            90 -> listOf(1f - y, x, z * width / height)
            180 -> listOf(1f - x, 1f - y, z)
            270 -> listOf(y, 1f - x, z * width / height)
            else -> listOf(x, y, z)
        }
}

/** Require a deliberate hold. One held pose emits once; brief tracking dropouts
 * cannot re-arm it. All timing uses a monotonic clock supplied by the service. */
class GestureLatch(
    private val holdMs: Long = 600,
    private val releaseMs: Long = 400,
) {
    private var candidate = GestureRecognition.Gesture.UNKNOWN
    private var duration = 0L
    private var samples = 0
    private var lastFrame: Long? = null
    private var lastMatch: Long? = null
    private var interruptedAt: Long? = null
    private var emitted = false
    private var neutralAt: Long? = null
    private var neutralSamples = 0
    private var needsNeutral = true

    fun update(gesture: GestureRecognition.Gesture, nowMs: Long,
        neutral: Boolean = gesture == GestureRecognition.Gesture.UNKNOWN): GestureRecognition.Gesture? {
        val previous = lastFrame
        if (previous != null && nowMs <= previous) return null
        if (previous != null && nowMs - previous > 350) {
            clearHold()
            emitted = false
            needsNeutral = true
            neutralAt = null
            neutralSamples = 0
        }
        lastFrame = nowMs
        if (neutral) {
            if (neutralAt == null) neutralAt = nowMs
            neutralSamples++
            if (nowMs - neutralAt!! >= releaseMs && neutralSamples >= 3) {
                emitted = false
                needsNeutral = false
            }
        } else { neutralAt = null; neutralSamples = 0 }
        if (gesture == GestureRecognition.Gesture.UNKNOWN) {
            if (interruptedAt == null) interruptedAt = nowMs
            if (neutral || nowMs - interruptedAt!! > 180) clearHold()
            lastMatch = null
            return null
        }
        if (candidate != gesture || (interruptedAt?.let { nowMs - it > 180 } == true)) {
            clearHold()
            candidate = gesture
        }
        lastMatch?.let { duration += nowMs - it }
        lastMatch = nowMs
        interruptedAt = null
        samples++
        val required = if (gesture == GestureRecognition.Gesture.FIST) maxOf(800, holdMs) else holdMs
        if (samples < 3 || duration < required ||
            (gesture != GestureRecognition.Gesture.FIST && (needsNeutral || emitted))) return null
        emitted = true
        return gesture
    }

    private fun clearHold() {
        candidate = GestureRecognition.Gesture.UNKNOWN
        duration = 0
        samples = 0
        lastMatch = null
        interruptedAt = null
    }
}
