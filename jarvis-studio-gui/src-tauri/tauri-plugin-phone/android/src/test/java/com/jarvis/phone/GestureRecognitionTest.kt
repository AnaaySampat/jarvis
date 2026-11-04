package com.jarvis.phone

import com.jarvis.phone.GestureRecognition.Gesture
import org.junit.Assert.*
import org.junit.Test

class GestureRecognitionTest {
    @Test fun onlyConfidentKnownLabelsAreAccepted() {
        assertEquals(Gesture.PEACE, GestureRecognition.recognize("Victory", 0.9f))
        assertEquals(Gesture.OPEN_PALM, GestureRecognition.recognize("Open_Palm", 0.8f))
        assertEquals(Gesture.THUMBS_UP, GestureRecognition.recognize("Thumb_Up", 0.95f))
        assertEquals(Gesture.FIST, GestureRecognition.recognize("Closed_Fist", 0.9f))
        for (score in listOf(0.79f, Float.NaN, Float.POSITIVE_INFINITY, 1.1f)) {
            assertEquals(Gesture.UNKNOWN, GestureRecognition.recognize("Victory", score))
        }
        assertEquals(Gesture.UNKNOWN, GestureRecognition.recognize("None", 1f))
        assertEquals(Gesture.POINT_UP, GestureRecognition.recognize("Pointing_Up", 1f))
        assertEquals(Gesture.THUMBS_DOWN, GestureRecognition.recognize("Thumb_Down", 0.9f))
        assertEquals(Gesture.LOVE, GestureRecognition.recognize("ILoveYou", 0.9f))
        assertEquals(Gesture.PEACE, GestureRecognition.recognize("Victory", 0.7f, 0.65f))
    }

    private fun hold(latch: GestureLatch, gesture: Gesture, from: Long, to: Long,
        neutral: Boolean = gesture == Gesture.UNKNOWN): List<Gesture> =
        (from..to step 100).mapNotNull { latch.update(gesture, it, neutral) }

    private fun ready(): GestureLatch = GestureLatch().also { hold(it, Gesture.UNKNOWN, 0, 400) }

    @Test fun deliberateHoldEmitsOnceUntilReleased() {
        val latch = ready()
        assertEquals(listOf(Gesture.PEACE), hold(latch, Gesture.PEACE, 500, 1500))
        assertTrue(hold(latch, Gesture.PEACE, 1600, 2500).isEmpty())
        hold(latch, Gesture.UNKNOWN, 2600, 3000)
        assertEquals(listOf(Gesture.PEACE), hold(latch, Gesture.PEACE, 3100, 3900))
    }

    @Test fun trackingJitterDoesNotRepeatAnAction() {
        val latch = ready()
        hold(latch, Gesture.OPEN_PALM, 500, 1100)
        latch.update(Gesture.UNKNOWN, 1200, neutral = false)
        assertTrue(hold(latch, Gesture.OPEN_PALM, 1300, 2200).isEmpty())
        hold(latch, Gesture.UNKNOWN, 2300, 2900, neutral = false)
        assertTrue(hold(latch, Gesture.OPEN_PALM, 3000, 3900).isEmpty())
    }

    @Test fun changedPoseRequiresReleaseButFistCanAlwaysStop() {
        val latch = ready()
        hold(latch, Gesture.PEACE, 500, 1100)
        assertTrue(hold(latch, Gesture.OPEN_PALM, 1200, 2100).isEmpty())
        assertEquals(listOf(Gesture.FIST), hold(latch, Gesture.FIST, 2200, 3000))
        val fresh = GestureLatch(200)
        assertTrue(hold(fresh, Gesture.FIST, 0, 700).isEmpty())
        assertEquals(Gesture.FIST, fresh.update(Gesture.FIST, 800))
    }

    @Test fun sparseFramesAndDuplicateTimestampsCannotFormAHold() {
        val latch = ready()
        latch.update(Gesture.PEACE, 500)
        assertNull(latch.update(Gesture.PEACE, 1100))
        assertTrue(hold(latch, Gesture.PEACE, 1200, 2000).isEmpty())
        hold(latch, Gesture.UNKNOWN, 2100, 2500)
        latch.update(Gesture.PEACE, 2600)
        repeat(20) { assertNull(latch.update(Gesture.PEACE, 2600)) }
        assertTrue(hold(latch, Gesture.PEACE, 2700, 3100).isEmpty())
        assertEquals(Gesture.PEACE, latch.update(Gesture.PEACE, 3200))
    }

    @Test fun briefUncertaintyPausesEvidenceWithoutCountingIt() {
        val latch = ready()
        hold(latch, Gesture.PEACE, 500, 800)
        latch.update(Gesture.UNKNOWN, 900, neutral = false)
        assertTrue(hold(latch, Gesture.PEACE, 1000, 1200).isEmpty())
        assertEquals(Gesture.PEACE, latch.update(Gesture.PEACE, 1300))
    }

    @Test fun ambiguousScoresAndInvalidThresholdsAreRejected() {
        assertEquals(Gesture.UNKNOWN, GestureRecognition.recognize("Victory", 0.9f, 0.8f, 0.85f))
        assertEquals(Gesture.PEACE, GestureRecognition.recognize("Victory", 0.9f, 0.8f, 0.1f))
        assertEquals(Gesture.UNKNOWN, GestureRecognition.recognize("Victory", 0.9f, Float.NaN))
        assertEquals(Gesture.UNKNOWN, GestureRecognition.recognize("Victory", 0.9f, 0.8f, Float.NaN))
    }

    @Test fun handQualityRejectsMissingCroppedAndTinyLandmarks() {
        val points = (0..20).map { i -> listOf(0.3f + (i % 4) * 0.035f, 0.2f + (i / 4) * 0.06f, 0f) }
        assertTrue(GestureRecognition.usableHand(points))
        assertFalse(GestureRecognition.usableHand(emptyList()))
        assertFalse(GestureRecognition.usableHand(points.map { listOf(it[0] - 0.4f, it[1], it[2]) }))
        assertFalse(GestureRecognition.usableHand(points.map { listOf(0.5f, 0.5f, 0f) }))
    }

    @Test fun briefDropoutPausesRatherThanDiscardsTheHold() {
        val latch = GestureLatch()
        hold(latch, Gesture.FIST, 0, 300)
        assertNull(latch.update(Gesture.UNKNOWN, 400, neutral = false))
        assertTrue(hold(latch, Gesture.FIST, 500, 900).isEmpty())
        assertEquals(Gesture.FIST, latch.update(Gesture.FIST, 1000))
    }

    @Test fun sustainedDropoutRequiresAnotherFullHold() {
        val latch = GestureLatch()
        hold(latch, Gesture.FIST, 0, 300)
        hold(latch, Gesture.UNKNOWN, 400, 700, neutral = false)
        assertTrue(hold(latch, Gesture.FIST, 800, 1500).isEmpty())
        assertEquals(Gesture.FIST, latch.update(Gesture.FIST, 1600))
    }

    @Test fun sensorLandmarksKeepUprightPointerAndSwipeCoordinates() {
        val expected = mapOf(
            0 to floatArrayOf(0.2f, 0.7f, 0.3f),
            90 to floatArrayOf(0.3f, 0.2f, 0.4f),
            180 to floatArrayOf(0.8f, 0.3f, 0.3f),
            270 to floatArrayOf(0.7f, 0.8f, 0.4f),
        )
        for ((rotation, point) in expected) {
            assertArrayEquals(point, GestureRecognition.uprightLandmark(
                0.2f, 0.7f, 0.3f, rotation, 640, 480).toFloatArray(), 0.000001f)
        }
    }

    @Test fun oppositeRotationsPreserveCalibrationGeometryAndDepth() {
        val rotated = GestureRecognition.uprightLandmark(0.2f, 0.7f, -0.3f, 90, 640, 480)
        val restored = GestureRecognition.uprightLandmark(
            rotated[0], rotated[1], rotated[2], 270, 480, 640)
        assertArrayEquals(floatArrayOf(0.2f, 0.7f, -0.3f), restored.toFloatArray(), 0.000001f)
    }
}
