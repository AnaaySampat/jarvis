package com.jarvis.phone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WakeSensitivityTest {
    @Test
    fun `default preserves the existing detector threshold`() {
        assertEquals(0.35f, WakeSensitivity.thresholdFor(WakeSensitivity.DEFAULT_LEVEL), 0f)
    }

    @Test
    fun `endpoints bound the sensitivity without disabling detection`() {
        assertEquals(0.60f, WakeSensitivity.thresholdFor(0), 0.00001f)
        assertEquals(0.18f, WakeSensitivity.thresholdFor(100), 0.00001f)
        assertEquals(WakeSensitivity.thresholdFor(0), WakeSensitivity.thresholdFor(Int.MIN_VALUE), 0f)
        assertEquals(WakeSensitivity.thresholdFor(100), WakeSensitivity.thresholdFor(Int.MAX_VALUE), 0f)
    }

    @Test
    fun `raising sensitivity consistently lowers the detector threshold`() {
        for (level in 0 until 100) {
            assertTrue(WakeSensitivity.thresholdFor(level) > WakeSensitivity.thresholdFor(level + 1))
        }
    }
}
