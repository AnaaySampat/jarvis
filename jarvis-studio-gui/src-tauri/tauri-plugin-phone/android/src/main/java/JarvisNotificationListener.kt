package com.jarvis.phone

import android.app.Notification
import android.app.RemoteInput
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.util.concurrent.ConcurrentHashMap

/**
 * Notification access: read what's showing, and reply through a notification's own
 * reply button — the one way a third-party app can answer a WhatsApp/Telegram message
 * with nothing opening on screen. Enabled by the user in Settings ▸ Notification
 * access (a restricted setting for sideloaded installs). Never posts or dismisses.
 */
class JarvisNotificationListener : NotificationListenerService() {

    companion object {
        @Volatile var instance: JarvisNotificationListener? = null

        fun enabled(context: Context): Boolean =
            NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)

        fun component(context: Context) = ComponentName(context, JarvisNotificationListener::class.java)

        private const val REPLY_CONFIRM_MS = 3_000L
    }

    data class Item(
        val key: String,
        val pkg: String,
        val app: String,
        val title: String,
        val text: String,
        val postTime: Long,
    )

    /** Last time each notification key was posted, updated or removed (elapsedRealtime). */
    private val changedAt = ConcurrentHashMap<String, Long>()

    override fun onListenerConnected() {
        instance = this
    }

    override fun onListenerDisconnected() {
        instance = null
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn?.let { changedAt[it.key] = SystemClock.elapsedRealtime() }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        sbn?.let { changedAt[it.key] = SystemClock.elapsedRealtime() }
    }

    /** What a person would see in the shade: not JARVIS's own, not ongoing (music,
     *  downloads, the wake-word service), not group summaries, not empty. Newest first. */
    fun items(): List<Item> {
        val pm = packageManager
        return (activeNotifications ?: emptyArray())
            .filter { sbn ->
                val n = sbn.notification
                sbn.packageName != packageName &&
                    !sbn.isOngoing &&
                    n.flags and Notification.FLAG_GROUP_SUMMARY == 0
            }
            .mapNotNull { sbn ->
                val (title, text) = titleAndText(sbn.notification)
                if (title.isBlank() && text.isBlank()) return@mapNotNull null
                val app = try {
                    pm.getApplicationLabel(pm.getApplicationInfo(sbn.packageName, 0)).toString()
                } catch (_: Exception) {
                    sbn.packageName
                }
                Item(sbn.key, sbn.packageName, app, title, text, sbn.postTime)
            }
            .sortedByDescending { it.postTime }
    }

    private fun titleAndText(n: Notification): Pair<String, String> {
        val extras = n.extras
        val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(n)
        val title = (style?.conversationTitle ?: extras.getCharSequence(Notification.EXTRA_TITLE))
            ?.toString().orEmpty()
        val text = if (style != null && style.messages.isNotEmpty()) {
            style.messages.takeLast(3).joinToString("\n") { m ->
                val who = m.person?.name?.toString()
                if (style.isGroupConversation && !who.isNullOrBlank()) "$who: ${m.text}" else m.text.toString()
            }
        } else {
            (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
                ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString().orEmpty()
        }
        return title.trim() to text.trim()
    }

    /** The newest notification from [person] in one of [pkgs] (or an app whose label is
     *  [appLabel]) that carries a free-text reply action. */
    fun findReplyable(pkgs: Set<String>, appLabel: String, person: String): StatusBarNotification? {
        val keys = items()
            .filter { (it.pkg in pkgs || it.app.equals(appLabel, ignoreCase = true)) && DirectMatch.titleMatches(it.title, person) }
            .map { it.key }
        val byKey = (activeNotifications ?: emptyArray()).associateBy { it.key }
        return keys.mapNotNull { byKey[it] }.firstOrNull { replyAction(it.notification) != null }
    }

    private fun replyAction(n: Notification): Notification.Action? {
        val replyable = n.actions?.filter { a -> a.remoteInputs?.any { it.allowFreeFormInput } == true }
            ?: return null
        val semantic = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            replyable.firstOrNull { it.semanticAction == Notification.Action.SEMANTIC_ACTION_REPLY }
        } else {
            null
        }
        return semantic ?: replyable.firstOrNull()
    }

    /**
     * Fill the notification's reply box with [text] and press its send. Confirmed only
     * when the app reacts — updates the notification with the reply, or clears it —
     * within a few seconds; a PendingIntent that merely didn't throw proves nothing.
     */
    fun reply(sbn: StatusBarNotification, text: String): Boolean {
        val action = replyAction(sbn.notification) ?: return false
        val inputs = action.remoteInputs ?: return false
        val results = Bundle().apply { inputs.forEach { putCharSequence(it.resultKey, text) } }
        val fill = Intent().addFlags(Intent.FLAG_RECEIVER_FOREGROUND)
        RemoteInput.addResultsToIntent(inputs, fill, results)
        val sentAt = SystemClock.elapsedRealtime()
        try {
            action.actionIntent.send(this, 0, fill)
        } catch (_: Exception) {
            return false
        }
        val deadline = sentAt + REPLY_CONFIRM_MS
        while (SystemClock.elapsedRealtime() < deadline) {
            if ((changedAt[sbn.key] ?: 0L) >= sentAt) return true
            Thread.sleep(100)
        }
        return false
    }
}
