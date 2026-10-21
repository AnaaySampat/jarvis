package com.jarvis.phone

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray

/**
 * WhatsApp on the phone, for when the PC isn't there to answer (its own channel is a
 * linked device, desktop whatsapp_channel.py). JARVIS watches WhatsApp's notifications
 * (JarvisNotificationListener) and answers through the notification's own reply button,
 * so nothing opens on screen.
 *
 * Who counts: a person's chat (never a group) whose title is a contact the user listed,
 * by name or number, with a message that starts with JARVIS's name ("Jarvis, set a
 * timer for 10 minutes"). WhatsApp doesn't notify the owner about their own messages,
 * so the "Message yourself" chat can't reach JARVIS this way: the user's own commands
 * come from another number (a second number on WhatsApp Business on this phone works).
 *
 * Nothing is decided here. A command is queued with a `seq`; JS polls it (`poll_whatsapp`,
 * never the event bridge, ARCHITECTURE §5), runs it as an ordinary brain turn and sends
 * the answer back with `whatsapp_reply`. A hidden WebView is paused about a minute after
 * JARVIS leaves the screen, so when JS hasn't polled for a while a command also posts a
 * "tap to run" notification: opening JARVIS runs it. Nothing is answered for JS.
 */
object WhatsAppInbox {
    private const val TAG = "WhatsAppInbox"
    private const val PREFS = "jarvis_whatsapp"
    private const val NOTIFICATION_ID = 7230
    private const val KEPT = 20
    /** A message older than this when it's noticed (sent while the phone was off). */
    const val STALE_MS = 10 * 60_000L
    /** JS polls every ~1.5 s while it runs; longer than this and it's paused. */
    private const val JS_ASLEEP_MS = 6_000L
    val PACKAGES = setOf("com.whatsapp", "com.whatsapp.w4b")

    data class Command(
        val seq: Int,
        val key: String,
        val pkg: String,
        val sender: String,
        val text: String,
        val at: Long,
    )

    // ── Pure (JVM-tested) ──

    private val NAME = Regex("""^\W*(?:(?:hey|hi|ok(?:ay)?|yo)\W+)?jarvis\b\W*""", RegexOption.IGNORE_CASE)

    /** The command in a message that starts with JARVIS's name, without the name; null
     *  when it doesn't (not for JARVIS). The desktop's whatsapp_channel.addressed. */
    fun addressed(text: String): String? {
        val m = NAME.find(text) ?: return null
        return text.substring(m.range.last + 1).trim()
    }

    private fun digits(s: String) = s.filter { it.isDigit() }

    /** Is the chat [title] one of the [allowed] contacts? A number matches by its digits
     *  (WhatsApp shows an unsaved sender as "+91 98765 43210"); a name matches exactly
     *  as the contact is saved (DirectMatch.titleMatches: "Al" is not "Alice"). */
    fun senderAllowed(title: String, allowed: List<String>): Boolean = allowed.any { entry ->
        val d = digits(entry)
        if (d.length >= 7) {
            val t = digits(title)
            t.length >= 7 && t == d
        } else {
            entry.isNotBlank() && DirectMatch.titleMatches(title, entry)
        }
    }

    /** The allow list as typed: comma, semicolon or one per line. */
    fun parseAllowed(raw: String): List<String> =
        raw.split(',', ';', '\n').map { it.trim() }.filter { it.isNotEmpty() }.distinct().take(20)

    // ── State ──

    @Volatile private var enabled: Boolean? = null
    @Volatile private var allowed: List<String> = emptyList()
    @Volatile var seq = 0
        private set
    /** When this process started: `seq` restarts with it (like ShareInbox). */
    val boot: Long = System.currentTimeMillis()
    private val queue = ArrayDeque<Command>()
    /** Per notification: the newest message time already looked at. */
    private val seenUpTo = HashMap<String, Long>()
    @Volatile private var lastPoll = 0L

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun load(context: Context) {
        if (enabled != null) return
        val p = prefs(context)
        allowed = parseAllowed(p.getString("allowed", "") ?: "")
        enabled = p.getBoolean("enabled", false)
    }

    /** `whatsapp_config`: JS keeps this in step with Settings ▸ PC & WhatsApp. */
    fun configure(context: Context, on: Boolean, allowedRaw: String) {
        prefs(context).edit().putBoolean("enabled", on).putString("allowed", allowedRaw).apply()
        allowed = parseAllowed(allowedRaw)
        enabled = on
        if (!on) synchronized(this) { queue.clear() }
    }

    /** Commands after [since] (`poll_whatsapp`). Polling is also how JS says it's awake. */
    fun poll(since: Int): List<Command> {
        lastPoll = SystemClock.elapsedRealtime()
        return synchronized(this) { queue.filter { it.seq > since } }
    }

    // ── From the notification listener ──

    fun offer(context: Context, sbn: StatusBarNotification) {
        if (sbn.packageName !in PACKAGES) return
        load(context)
        if (enabled != true || allowed.isEmpty()) return
        val n = sbn.notification
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(n) ?: return
        if (style.isGroupConversation) return
        val title = (style.conversationTitle ?: n.extras.getCharSequence(Notification.EXTRA_TITLE))
            ?.toString()?.trim().orEmpty()
        if (!senderAllowed(title, allowed)) return
        val now = System.currentTimeMillis()
        val fresh = synchronized(this) {
            val upTo = seenUpTo[sbn.key] ?: 0L
            val me = style.user
            val news = style.messages.filter { m ->
                // The user's own messages (JARVIS's replies too) have no person, or the
                // style's user as theirs.
                val who = m.person
                val mine = who == null || (who.key != null && who.key == me.key) ||
                    (who.key == null && who.name?.toString() == me.name?.toString())
                m.timestamp > upTo && !mine && now - m.timestamp <= STALE_MS
            }
            style.messages.maxOfOrNull { it.timestamp }?.let { seenUpTo[sbn.key] = maxOf(upTo, it) }
            news.mapNotNull { m ->
                val cmd = addressed(m.text?.toString().orEmpty()) ?: return@mapNotNull null
                if (cmd.isEmpty()) return@mapNotNull null
                seq += 1
                Command(seq, sbn.key, sbn.packageName, title, cmd.take(1_000), m.timestamp)
            }.onEach { c ->
                queue.addLast(c)
                while (queue.size > KEPT) queue.removeFirst()
            }
        }
        if (fresh.isEmpty()) return
        Log.i(TAG, "${fresh.size} command(s) from $title")
        if (SystemClock.elapsedRealtime() - lastPoll > JS_ASLEEP_MS) notice(context, fresh.last())
    }

    /** JARVIS isn't running its brain right now: say a command is waiting. */
    private fun notice(context: Context, c: Command) {
        val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        } ?: return
        val pi = PendingIntent.getActivity(
            context, NOTIFICATION_ID, open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(context, PhonePlugin.REMINDER_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("WhatsApp for JARVIS from ${c.sender}")
            .setContentText("“${c.text}” — tap and JARVIS answers it.")
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, n)
        } catch (ex: SecurityException) {
            Log.w(TAG, "notification not permitted: ${ex.message}")
        }
    }

    // ── The answer ──

    /** Send [text] back to command [cmdSeq]'s chat through WhatsApp's own notification
     *  (the one it came in, or that person's newest). Blocks up to a few seconds for
     *  WhatsApp to take it (JarvisNotificationListener.reply). A blank [text] drops the
     *  command unanswered: it's the PC's to answer. */
    fun reply(cmdSeq: Int, text: String): Pair<Boolean, String> {
        val c = synchronized(this) { queue.firstOrNull { it.seq == cmdSeq } }
            ?: return false to "That WhatsApp message isn't waiting any more."
        if (text.isBlank()) {
            synchronized(this) { queue.removeAll { it.seq == cmdSeq } }
            return true to "Left for the PC."
        }
        val listener = JarvisNotificationListener.instance
            ?: return false to "Notification access is off, so I can't answer in WhatsApp."
        val sbn = listener.activeNotifications?.firstOrNull { it.key == c.key }
            ?: listener.findReplyable(setOf(c.pkg), "", c.sender)
            ?: return false to "${c.sender}'s WhatsApp notification is gone (it was opened), so I couldn't answer there."
        val sent = listener.reply(sbn, "🤖 ${text.trim()}".take(4_000))
        synchronized(this) { queue.removeAll { it.seq == cmdSeq } }
        return if (sent) true to "Answered ${c.sender} on WhatsApp."
        else false to "WhatsApp didn't take the answer to ${c.sender}."
    }

    fun toJson(list: List<Command>): JSONArray = JSONArray(list.map { c ->
        org.json.JSONObject()
            .put("seq", c.seq).put("sender", c.sender).put("text", c.text).put("at", c.at)
            .put("app", if (c.pkg == "com.whatsapp.w4b") "WhatsApp Business" else "WhatsApp")
    })

}
