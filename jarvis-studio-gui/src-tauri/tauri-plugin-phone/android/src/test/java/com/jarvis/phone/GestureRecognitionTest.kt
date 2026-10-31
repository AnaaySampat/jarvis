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
        assertEquals(Gesture.UNKNOWN, GestureRecognition.recognize("Pointing_Up", 1f))
    }

    @Test fun deliberateHoldEmitsOnceUntilReleased() {
        val latch = GestureLatch()
        assertNull(latch.update(Gesture.PEACE, 0))
        assertNull(latch.update(Gesture.PEACE, 599))
        assertEquals(Gesture.PEACE, latch.update(Gesture.PEACE, 600))
        assertNull(latch.update(Gesture.PEACE, 10_000))
        assertNull(latch.update(Gesture.UNKNOWN, 10_100))
        assertNull(latch.update(Gesture.UNKNOWN, 10_500))
        assertNull(latch.update(Gesture.PEACE, 10_600))
        assertEquals(Gesture.PEACE, latch.update(Gesture.PEACE, 11_200))
    }

    @Test fun trackingJitterDoesNotRepeatAnAction() {
        val latch = GestureLatch()
        latch.update(Gesture.OPEN_PALM, 0)
        assertEquals(Gesture.OPEN_PALM, latch.update(Gesture.OPEN_PALM, 600))
        latch.update(Gesture.UNKNOWN, 700)
        latch.update(Gesture.OPEN_PALM, 800)
        assertNull(latch.update(Gesture.OPEN_PALM, 1400))
    }

    @Test fun changedPoseAlsoNeedsAFullHold() {
        val latch = GestureLatch()
        latch.update(Gesture.PEACE, 0)
        latch.update(Gesture.PEACE, 600)
        assertNull(latch.update(Gesture.FIST, 700))
        assertNull(latch.update(Gesture.FIST, 1299))
        assertEquals(Gesture.FIST, latch.update(Gesture.FIST, 1300))
    }
}
