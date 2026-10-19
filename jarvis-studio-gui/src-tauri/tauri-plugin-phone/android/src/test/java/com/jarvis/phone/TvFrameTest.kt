package com.jarvis.phone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TvFrameTest {
    private fun rgb(r: Int, g: Int, b: Int) = (0xFF shl 24) or (r shl 16) or (g shl 8) or b

    @Test
    fun aBlackFrameIsDarkEverywhere() {
        assertTrue(TvFrame.brightest(IntArray(100) { rgb(10, 12, 16) }) <= TvFrame.BLACK)
        val withText = IntArray(100) { rgb(0, 0, 0) }.also { it[42] = rgb(255, 255, 255) }
        assertEquals(255, TvFrame.brightest(withText))
    }

    @Test
    fun theSignatureIsGreyAndAFlatScreenIsBlank() {
        assertEquals(255, TvFrame.signature(intArrayOf(rgb(255, 255, 255)))[0].toInt() and 0xFF)
        assertEquals(0, TvFrame.signature(intArrayOf(rgb(0, 0, 0)))[0].toInt())
        assertTrue(TvFrame.blank(IntArray(64) { rgb(30, 30, 30) }))
        assertFalse(TvFrame.blank(IntArray(64) { if (it == 5) rgb(200, 200, 200) else rgb(30, 30, 30) }))
    }
}
