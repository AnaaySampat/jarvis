package com.jarvis.phone

/** Labels from the bundled MediaPipe canned-gesture classifier, not screen-axis
 * heuristics. A thumbs-up is feedback only, never approval for an action. */
object GestureRecognition {
    enum class Gesture { OPEN_PALM, PEACE, THUMBS_UP, THUMBS_DOWN, POINT_UP, LOVE, FIST, UNKNOWN }

    fun recognize(label: String, score: Float, minimum: Float = 0.8f): Gesture {
        if (!score.isFinite() || score < minimum || score > 1f) return Gesture.UNKNOWN
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
}

/** Require a deliberate hold. One held pose emits once; brief tracking dropouts
 * cannot re-arm it. All timing uses a monotonic clock supplied by the service. */
class GestureLatch(
    private val holdMs: Long = 600,
    private val releaseMs: Long = 400,
) {
    private var candidate = GestureRecognition.Gesture.UNKNOWN
    private var since = 0L
    private var emitted = GestureRecognition.Gesture.UNKNOWN

    fun update(gesture: GestureRecognition.Gesture, nowMs: Long): GestureRecognition.Gesture? {
        if (candidate != gesture) {
            candidate = gesture
            since = nowMs
        }
        if (gesture == GestureRecognition.Gesture.UNKNOWN) {
            if (nowMs - since >= releaseMs) emitted = GestureRecognition.Gesture.UNKNOWN
            return null
        }
        if (nowMs - since < holdMs || gesture == emitted) return null
        emitted = gesture
        return gesture
    }
}
