package com.jarvis.phone

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
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

    /** Feed 80 ms chunks (1280 samples) of [pattern]: 'L' loud, '.' quiet. Returns the
     *  chunk index the capture ended on (-1 = never) and the capture. */
    private fun run(pattern: String, seed: ShortArray = ShortArray(0)): Pair<Int, CommandCapture> {
        val c = CommandCapture(seed, 16_000)
        pattern.forEachIndexed { i, ch ->
            if (c.add(ShortArray(1280) { i.toShort() }, ch == 'L')) return i to c
        }
        return -1 to c
    }

    @Test
    fun `one breath - a command right after the wake is kept, from its first word`() {
        // "Hey Jarvis open YouTube": the tail of "Jarvis", then the command at once.
        val (end, c) = run("LLLLLLLLLL" + ".".repeat(20), seed = ShortArray(48_000) { 7 })
        assertTrue(c.speech)
        assertEquals(9 + 13, end) // 1 s (13 chunks) after the last loud one
        val audio = c.audio()
        assertEquals(7, audio[0].toInt()) // the pre-roll leads the clip
        assertEquals(48_000 + 23 * 1280, audio.size)
        assertEquals(0, audio[48_000].toInt()) // then every chunk after the wake, none lost
    }

    @Test
    fun `two breaths - a pause after the wake doesn't end it before the command`() {
        // wake tail, ~1.5 s waiting for the beep, then the command.
        val (end, c) = run("LL" + ".".repeat(18) + "LLLLLL" + ".".repeat(20))
        assertTrue(c.speech)
        assertEquals(25 + 13, end)
    }

    @Test
    fun `nothing said - ends at 4 s with no speech, and the wake's own tail doesn't count`() {
        val (end, c) = run("LLL" + ".".repeat(60))
        assertFalse(c.speech)
        assertEquals(49, end) // 50 chunks = 4 s
    }

    @Test
    fun `scattered room blips are not speech - a silent wake ends at 4 s`() {
        val (end, c) = run("L" + ".L..".repeat(20))
        assertFalse(c.speech)
        assertEquals(49, end)
    }

    @Test
    fun `a long command is cut at the 10 s ceiling`() {
        val (end, c) = run("L".repeat(200))
        assertTrue(c.speech)
        assertEquals(124, end) // 125 chunks = 10 s
    }

    private fun chunk(rms: Double) =
        ShortArray(1280) { ((if (it % 2 == 0) 1 else -1) * (rms * 32768).toInt()).toShort() }

    @Test
    fun `noise floor - steady room noise is quiet, speech over it is loud`() {
        val f = NoiseFloor()
        repeat(20) { assertFalse(f.loud(chunk(0.009))) }
        assertTrue(f.loud(chunk(0.09)))
    }

    @Test
    fun `noise floor - a long command at 2-3x a noisy room stays loud throughout`() {
        // Live 2026-10-11: room 0.020, the command 0.040-0.060 for ~1.6 s.
        val f = NoiseFloor()
        repeat(35) { f.loud(chunk(0.020)) }
        repeat(15) { f.loud(chunk(0.060)) } // "Hey Jarvis" in the pre-roll
        f.hold()
        repeat(30) { assertTrue("speech chunk $it", f.loud(chunk(0.048))) }
        assertFalse(f.loud(chunk(0.022)))
    }

    @Test
    fun `noise floor - one unusually quiet chunk doesn't make the room count as speech`() {
        val f = NoiseFloor()
        repeat(20) { f.loud(chunk(0.020)) }
        f.loud(chunk(0.004))
        f.hold()
        repeat(10) { assertFalse("room chunk $it", f.loud(chunk(0.022))) }
    }

    @Test
    fun `noise floor - the near-silent chunks of a mic just opening don't stick`() {
        // Live 2026-10-11: a floor seeded from them sat at 0.003, the room (0.020) counted as
        // speech, and every capture ran to 10 s.
        val f = NoiseFloor()
        repeat(5) { f.loud(chunk(0.0)) }
        repeat(3) { f.loud(chunk(0.003)) }
        repeat(50) { f.loud(chunk(0.020)) }
        f.hold()
        assertFalse(f.loud(chunk(0.022)))
        assertTrue(f.loud(chunk(0.05)))
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
