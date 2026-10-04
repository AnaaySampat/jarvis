package com.jarvis.phone

import android.content.Context
import dadb.AdbKeyPair
import dadb.Dadb
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
