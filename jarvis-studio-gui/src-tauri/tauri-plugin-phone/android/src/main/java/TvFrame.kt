package com.jarvis.phone

/**
 * The pure half of a TV screenshot (TvAdb.capture), free of Android types so the JVM
 * tests can drive it: whether a frame is black (a copy-protected layer, or nothing on
 * screen) and the small grey signature remote/tvSight.ts compares to tell whether a
 * button press changed anything. Mirrors the desktop's actions/tv.py capture.
 */
internal object TvFrame {
    /** Every channel at or below this = a black frame. */
    const val BLACK = 16
    const val SIG_W = 64
    const val SIG_H = 36

    /** The brightest channel of any pixel (ARGB ints). */
    fun brightest(pixels: IntArray): Int {
        var max = 0
        for (p in pixels) {
            val c = maxOf((p shr 16) and 0xFF, (p shr 8) and 0xFF, p and 0xFF)
            if (c > max) max = c
        }
        return max
    }

    /** Grey levels of a SIG_W×SIG_H thumbnail, one byte each. */
    fun signature(thumb: IntArray): ByteArray = ByteArray(thumb.size) { i ->
        val p = thumb[i]
        ((((p shr 16) and 0xFF) * 299 + ((p shr 8) and 0xFF) * 587 + (p and 0xFF) * 114) / 1000).toByte()
    }

    /** One flat colour: nothing on screen yet (an app loading). */
    fun blank(thumb: IntArray): Boolean {
        val g = signature(thumb).map { it.toInt() and 0xFF }
        return g.isNotEmpty() && (g.maxOrNull()!! - g.minOrNull()!!) <= 6
    }
}
