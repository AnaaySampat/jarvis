package com.jarvis.phone

/** Slider policy shared by the listener and its native command. */
internal object WakeSensitivity {
    const val DEFAULT_LEVEL = 60

    fun normalize(level: Int): Int = level.coerceIn(0, 100)

    /** Keep the existing 0.35 threshold exactly at the default. */
    fun thresholdFor(level: Int): Float {
        val value = normalize(level)
        return if (value <= DEFAULT_LEVEL) {
            0.35f + 0.25f * (DEFAULT_LEVEL - value) / DEFAULT_LEVEL
        } else {
            0.35f - 0.17f * (value - DEFAULT_LEVEL) / (100 - DEFAULT_LEVEL)
        }
    }
}
