package com.jarvis.phone

import com.google.mediapipe.tasks.components.containers.NormalizedLandmark

object GestureRecognition {

    enum class Gesture {
        OPEN_PALM,
        PEACE,
        THUMBS_UP,
        FIST,
        UNKNOWN
    }

    fun recognize(
        points: List<NormalizedLandmark>
    ): Gesture {

        if (points.size < 21) return Gesture.UNKNOWN

        // Finger tips and joints
        val index = points[8].y() < points[6].y()
        val middle = points[12].y() < points[10].y()
        val ring = points[16].y() < points[14].y()
        val pinky = points[20].y() < points[18].y()

        // Thumb extension: use horizontal distance
        // because thumb orientation differs by hand.
        val thumb = kotlin.math.abs(
            points[4].x() - points[2].x()
        ) > 0.08f

        if (index && middle && ring && pinky) {
            return Gesture.OPEN_PALM
        }

        if (index && middle && !ring && !pinky) {
            return Gesture.PEACE
        }

        if (
            thumb &&
            !index && !middle && !ring && !pinky &&
            points[4].y() < points[3].y()
        ) {
            return Gesture.THUMBS_UP
        }

        if (!index && !middle && !ring && !pinky && !thumb) {
            return Gesture.FIST
        }

        return Gesture.UNKNOWN
    }

    fun response(gesture: Gesture): String {
        return when (gesture) {
            Gesture.OPEN_PALM ->
                "Hello. Hand detected."

            Gesture.PEACE ->
                "Peace gesture detected."

            Gesture.THUMBS_UP ->
                "Approval confirmed."

            Gesture.FIST ->
                "Closed fist detected."

            Gesture.UNKNOWN ->
                "Gesture not recognised."
        }
    }
}
