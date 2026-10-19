package com.jarvis.phone

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import dadb.AdbKeyPair
import dadb.Dadb
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/**
 * Network ADB to the user's Android TV: the TV's own "USB debugging", reached over the
 * home Wi-Fi on port 5555. The phone is the ADB client, so nothing is installed on the
 * TV. The first connection from this phone makes the TV ask "Allow USB debugging?";
 * the user accepts once (ticking "Always allow") and the TV remembers this key.
 *
 * Transport only: brain/remote/tv.ts builds every command from typed actions and reads
 * back the TV's state to verify each one.
 */
internal class TvAdb(context: Context) {
    data class Reply(val ok: Boolean, val output: String, val exitCode: Int, val summary: String)

    /** A screenshot: [image] is base64 JPEG (≤ maxSide), [blocked] = nothing could be
     *  captured or it came back black (a copy-protected layer — Netflix), [sig] the
     *  64×36 grey signature (base64), [blank] one flat colour. */
    data class Capture(
        val ok: Boolean,
        val image: String = "",
        val blocked: Boolean = false,
        val blank: Boolean = false,
        val sig: String = "",
        val summary: String = "",
    )

    // noBackupFilesDir: app-private and never copied off the phone by a backup.
    private val privFile = File(context.noBackupFilesDir, "tv_adbkey")
    private val pubFile = File(context.noBackupFilesDir, "tv_adbkey.pub")
    private var dadb: Dadb? = null
    private var dadbTarget = ""

    @Synchronized
    fun shell(host: String, command: String): Reply {
        val target = parseTarget(host) ?: return Reply(false, "", -1, "That isn't a valid TV address.")
        if (command.isBlank() || command.length > MAX_COMMAND) {
            return Reply(false, "", -1, "Refused an empty or oversized TV command.")
        }
        // Twice: a TV that went to standby drops the socket without closing it, so
        // the first command afterwards fails on the dead connection.
        var last: Exception? = null
        repeat(2) {
            try {
                val r = connection(target).shell(command)
                return Reply(true, r.allOutput, r.exitCode, "")
            } catch (e: Exception) {
                last = e
                drop()
            }
        }
        return Reply(false, "", -1, describe(last, target))
    }

    /** `screencap -p` over the binary exec channel (shell output is text). The TV
     *  returns nothing while a secure surface is up (SurfaceFlinger: "FB is protected"). */
    @Synchronized
    fun capture(host: String, maxSide: Int = 1280): Capture {
        val target = parseTarget(host) ?: return Capture(false, summary = "That isn't a valid TV address.")
        var last: Exception? = null
        repeat(2) {
            try {
                val png = connection(target).open("exec:screencap -p").use { it.source.readByteArray() }
                return encode(png, maxSide)
            } catch (e: Exception) {
                last = e
                drop()
            }
        }
        return Capture(false, summary = describe(last, target))
    }

    private fun encode(png: ByteArray, maxSide: Int): Capture {
        if (png.isEmpty()) return Capture(true, blocked = true)
        val full = BitmapFactory.decodeByteArray(png, 0, png.size)
            ?: return Capture(false, summary = "The TV's screenshot couldn't be read.")
        val scale = minOf(1.0, maxSide.toDouble() / maxOf(full.width, full.height))
        val shot = if (scale < 1.0) {
            Bitmap.createScaledBitmap(full, (full.width * scale).toInt(), (full.height * scale).toInt(), true)
        } else full
        val pixels = IntArray(shot.width * shot.height)
        shot.getPixels(pixels, 0, shot.width, 0, 0, shot.width, shot.height)
        if (TvFrame.brightest(pixels) <= TvFrame.BLACK) return Capture(true, blocked = true)
        val thumb = Bitmap.createScaledBitmap(shot, TvFrame.SIG_W, TvFrame.SIG_H, true)
        val small = IntArray(TvFrame.SIG_W * TvFrame.SIG_H)
        thumb.getPixels(small, 0, TvFrame.SIG_W, 0, 0, TvFrame.SIG_W, TvFrame.SIG_H)
        val jpeg = ByteArrayOutputStream().also { shot.compress(Bitmap.CompressFormat.JPEG, 85, it) }
        return Capture(
            true,
            image = Base64.encodeToString(jpeg.toByteArray(), Base64.NO_WRAP),
            blank = TvFrame.blank(small),
            sig = Base64.encodeToString(TvFrame.signature(small), Base64.NO_WRAP),
        )
    }

    private fun connection(target: Pair<String, Int>): Dadb {
        val key = "${target.first}:${target.second}"
        dadb?.let { if (dadbTarget == key) return it }
        drop()
        if (!privFile.exists() || !pubFile.exists()) AdbKeyPair.generate(privFile, pubFile)
        val keys = AdbKeyPair.read(privFile, pubFile)
        return Dadb.create(target.first, target.second, keys, CONNECT_TIMEOUT_MS, SOCKET_TIMEOUT_MS)
            .also {
                dadb = it
                dadbTarget = key
            }
    }

    private fun drop() {
        try {
            dadb?.close()
        } catch (_: Exception) {
        }
        dadb = null
        dadbTarget = ""
    }

    companion object {
        private const val DEFAULT_PORT = 5555
        private const val CONNECT_TIMEOUT_MS = 5_000
        // Also how long the user has to accept the TV's first "Allow USB debugging?" prompt.
        private const val SOCKET_TIMEOUT_MS = 30_000
        private const val MAX_COMMAND = 4_000
        private val TARGET = Regex("^([A-Za-z0-9.-]{1,253})(?::(\\d{1,5}))?$")

        fun parseTarget(raw: String): Pair<String, Int>? {
            val m = TARGET.matchEntire(raw.trim()) ?: return null
            val port = m.groupValues[2].ifEmpty { "$DEFAULT_PORT" }.toInt()
            return if (port in 1..65535) m.groupValues[1] to port else null
        }

        fun describe(e: Exception?, target: Pair<String, Int>): String {
            val where = "${target.first}:${target.second}"
            val msg = e?.message.orEmpty()
            return when {
                msg.contains("unauthorized", true) || msg.contains("authentication", true) ->
                    "The TV didn't allow this phone. Accept \"Allow USB debugging?\" on the TV " +
                        "(tick Always allow), then try again."
                e is SocketTimeoutException ->
                    "The TV at $where didn't answer in time. If it's showing \"Allow USB debugging?\", " +
                        "accept it (tick Always allow) and try again."
                e is ConnectException || e is NoRouteToHostException || e is UnknownHostException ->
                    "I can't reach the TV at $where. Check it's on, on the same Wi-Fi as this phone, " +
                        "with USB debugging on."
                else -> "The TV connection failed: ${msg.ifEmpty { e?.javaClass?.simpleName ?: "unknown error" }}"
            }
        }
    }
}
