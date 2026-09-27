package com.jarvis.phone

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The last few seconds the wake-word model heard. On a detection they go to a real speech
 * recogniser, which must hear "Hey Jarvis" in them before the command counts: the small
 * on-device model also fires on conversation that only sounds close (live 2026-09-26, it
 * typed a nearby conversation into JARVIS), and scores alone can't separate the two —
 * genuine wakes on this phone scored as low as 0.37. Android-free, so it's JVM-tested.
 */
class PreRollRing(private val capacity: Int) {
    private val buf = ShortArray(capacity)
    private var pos = 0
    private var filled = false

    // Written by the listen loop, read by WakeWordManager.stop() on the main thread.
    @Synchronized
    fun write(samples: ShortArray) {
        for (s in samples) {
            buf[pos] = s
            pos = (pos + 1) % capacity
            if (pos == 0) filled = true
        }
    }

    /** Everything held, oldest first. */
    @Synchronized
    fun snapshot(): ShortArray =
        if (filled) buf.copyOfRange(pos, capacity) + buf.copyOfRange(0, pos) else buf.copyOfRange(0, pos)
}

/** 16-bit mono PCM as a WAV file (what the recognisers accept without a codec). */
fun pcm16Wav(samples: ShortArray, sampleRate: Int): ByteArray {
    val data = samples.size * 2
    val out = ByteBuffer.allocate(44 + data).order(ByteOrder.LITTLE_ENDIAN)
    out.put("RIFF".toByteArray(Charsets.US_ASCII)).putInt(36 + data).put("WAVE".toByteArray(Charsets.US_ASCII))
    out.put("fmt ".toByteArray(Charsets.US_ASCII)).putInt(16)
        .putShort(1).putShort(1) // PCM, mono
        .putInt(sampleRate).putInt(sampleRate * 2)
        .putShort(2).putShort(16) // block align, bits per sample
    out.put("data".toByteArray(Charsets.US_ASCII)).putInt(data)
    for (s in samples) out.putShort(s)
    return out.array()
}
