package com.jarvis.phone

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class WakePreRollTest {
    @Test
    fun `ring keeps the newest samples, oldest first`() {
        val ring = PreRollRing(4)
        ring.write(shortArrayOf(1, 2))
        assertArrayEquals(shortArrayOf(1, 2), ring.snapshot()) // not yet full
        ring.write(shortArrayOf(3, 4, 5))
        assertArrayEquals(shortArrayOf(2, 3, 4, 5), ring.snapshot())
        ring.write(shortArrayOf(6, 7, 8, 9, 10))
        assertArrayEquals(shortArrayOf(7, 8, 9, 10), ring.snapshot())
    }

    @Test
    fun `wav header describes 16-bit mono PCM and the samples follow little-endian`() {
        val wav = pcm16Wav(shortArrayOf(1, -2, 300), 16_000)
        val b = ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals("RIFF", String(wav, 0, 4, Charsets.US_ASCII))
        assertEquals(36 + 6, b.getInt(4))
        assertEquals("WAVEfmt ", String(wav, 8, 8, Charsets.US_ASCII))
        assertEquals(1, b.getShort(20).toInt()) // PCM
        assertEquals(1, b.getShort(22).toInt()) // mono
        assertEquals(16_000, b.getInt(24))
        assertEquals(32_000, b.getInt(28)) // byte rate
        assertEquals(16, b.getShort(34).toInt())
        assertEquals("data", String(wav, 36, 4, Charsets.US_ASCII))
        assertEquals(6, b.getInt(40))
        assertEquals(listOf<Short>(1, -2, 300), listOf(b.getShort(44), b.getShort(46), b.getShort(48)))
        assertEquals(50, wav.size)
    }
}
