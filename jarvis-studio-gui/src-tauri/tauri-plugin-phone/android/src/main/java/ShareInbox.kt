package com.jarvis.phone

import android.content.Intent

/**
 * Text shared to JARVIS from another app's Share sheet (a YouTube or Netflix link, to
 * play on the TV). MainActivity hands every intent here, like a routine tap: Tauri
 * registers plugins only after the WebView starts, so a share that launches JARVIS
 * would never reach PhonePlugin. JS polls [shared] (`poll_share`) — `seq` bumps once
 * per share — instead of the event bridge (ARCHITECTURE §5).
 */
object ShareInbox {
    data class Shared(val seq: Int, val text: String)

    /** When this process started: `seq` restarts with it, so JS keys a share it has
     *  handled by both, and a WebView reload doesn't replay the last one. */
    val boot: Long = System.currentTimeMillis()

    @Volatile
    var shared = Shared(0, "")
        private set

    fun take(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND || intent.type?.startsWith("text/") != true) return
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim()?.take(2_000) ?: return
        intent.action = null          // a config change re-delivers the intent: take it once
        if ((intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0 || text.isEmpty()) return
        synchronized(this) { shared = Shared(shared.seq + 1, text) }
    }
}
