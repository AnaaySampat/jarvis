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

/**
 * The command after a wake, recorded from the same microphone stream the wake came from.
 * The old flow stopped this engine and opened the WebView's mic instead, and the ~0.5–1 s
 * handoff lost the start of "Hey Jarvis, open X" said in one breath. Seeded with the
 * pre-roll, so one clip holds "Hey Jarvis" and the command (one transcription, which also
 * serves as the wake check). Ends on a pause after speech, no speech at all, or a ceiling.
 */
class CommandCapture(seed: ShortArray, private val sampleRate: Int) {
    companion object {
        /** The model fires before "Jarvis" has ended; loud audio this soon is its tail. */
        const val GRACE_MS = 300L
        /** Speech comes in runs; a lone loud chunk is a room blip (live 2026-10-11: scattered
         *  single blips added up to "speech" and kept a silent wake recording for 6–8 s). */
        const val MIN_RUN_CHUNKS = 2
        const val SILENCE_MS = 1_000L
        const val NO_SPEECH_MS = 4_000L
        const val MAX_MS = 10_000L
    }

    private val buf = ShortArray(seed.size + (sampleRate * MAX_MS / 1000).toInt()).also { seed.copyInto(it) }
    private var size = seed.size
    private var afterWake = 0L // samples since the wake
    private var run = 0 // consecutive loud chunks
    private var lastLoudMs = 0L

    /** Whether anything past the wake word sounded like speech. */
    var speech = false
        private set

    /** Add the next chunk; true once the command is over. */
    fun add(chunk: ShortArray, loud: Boolean): Boolean {
        val n = minOf(chunk.size, buf.size - size)
        chunk.copyInto(buf, size, 0, n)
        size += n
        afterWake += chunk.size
        val ms = afterWake * 1000 / sampleRate
        run = if (loud) run + 1 else 0
        if (run >= MIN_RUN_CHUNKS && ms > GRACE_MS) {
            lastLoudMs = ms
            speech = true
        }
        return ms >= MAX_MS || size == buf.size ||
            if (speech) ms - lastLoudMs >= SILENCE_MS else ms >= NO_SPEECH_MS
    }

    fun audio(): ShortArray = buf.copyOf(size)
}

/**
 * Energy VAD against the room's level, per 80 ms chunk. The level is the 30th-percentile
 * chunk of the last 4 s before the wake, held fixed while the command records, so neither
 * the command nor one odd chunk can move it. Loud = [ratio]× the level. Tuned live
 * 2026-10-11 on the raw MIC source (no AGC): a room at ~0.020 put a spoken command at
 * 0.040–0.060, so the WebView capture's old 3× never fired; a tracked floor that dropped
 * instantly fell to a 0.004 chunk, and one that only rose on quiet chunks stuck at the
 * near-silent first chunks after the mic opened — either way the room counted as speech
 * and every capture ran to its 10 s ceiling.
 * ponytail: plain energy VAD — swap for a model VAD (Silero) if loud rooms keep commands
 * from ending. Tune [ratio]/[minRms] from the "command end" logcat line.
 */
class NoiseFloor(
    private val minRms: Float = 0.005f,
    private val ratio: Float = 2f,
    window: Int = 50,
) {
    private val recent = FloatArray(window)
    private var count = 0
    private var pos = 0
    private var held = -1f // the level frozen for a command (-1 = idle)

    var lastRms = 0f
        private set

    /** The room's level: held during a command, else the last few seconds'. */
    val floor: Float
        get() = if (held >= 0f) held else level()

    private fun level(): Float {
        if (count == 0) return 0f
        val sorted = recent.copyOf(count).sorted()
        return sorted[(count - 1) * 3 / 10]
    }

    /** At a wake: judge the command against the room as it was just before. */
    fun hold() {
        held = level()
    }

    fun release() {
        held = -1f
    }

    fun loud(chunk: ShortArray): Boolean {
        var sum = 0.0
        for (s in chunk) sum += (s / 32768.0) * (s / 32768.0)
        val rms = if (chunk.isEmpty()) 0f else kotlin.math.sqrt(sum / chunk.size).toFloat()
        lastRms = rms
        // Exact zeros are the mic still opening, not the room.
        if (held < 0f && rms > 0f) {
            recent[pos] = rms
            pos = (pos + 1) % recent.size
            if (count < recent.size) count++
        }
        return rms > maxOf(minRms, floor * ratio)
    }
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
