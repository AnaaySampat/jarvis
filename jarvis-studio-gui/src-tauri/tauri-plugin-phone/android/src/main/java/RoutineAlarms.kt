package com.jarvis.phone

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/**
 * Timed routines while JARVIS is closed (schedule/routines.ts). The JS tick can't be the
 * clock: a hidden WebView is paused ~60s after JARVIS leaves the foreground. So JS hands
 * its timed routines here on every change (scheduleRoutines), this keeps ONE exact alarm
 * for the earliest, and when it fires posts "Time for <name>".
 *
 * Nothing runs here. Tapping the notification opens JARVIS, the WebView reads the tap
 * (pollRoutineTap) and runs the routine as an ordinary brain turn, so every step still
 * goes through dispatch. An untapped notification never counts as a run.
 *
 * Unlike Clock alarms (PhonePlugin.clockAction) this has to be an in-app alarm: what
 * fires is JARVIS itself. The list lives in SharedPreferences so the receiver can roll
 * each routine forward, and BOOT_COMPLETED re-arm it, without the WebView.
 */
object RoutineAlarms {
    private const val TAG = "RoutineAlarms"
    private const val PREFS = "jarvis_routine_alarms"
    private const val KEY = "routines"
    private const val NOTIFICATION_ID = 7210
    const val EXTRA_NAME = "com.jarvis.phone.ROUTINE"
    const val EXTRA_DATE = "com.jarvis.phone.ROUTINE_DATE"

    /** routines.ts CATCH_UP_MIN: an alarm this late (phone off, Doze) is dropped rather
     *  than announced hours after the fact. */
    const val CATCH_UP_MS = 120 * 60_000L

    /** One timed routine. [days] are JS getDay() numbers (0 = Sunday); [lastRun] is the
     *  local date it last ran, and that day is skipped, as in dueRoutines; [at] is the
     *  next fire time in epoch ms, -1 when there is none. */
    data class Entry(
        val name: String,
        val hour: Int,
        val minute: Int,
        val days: Set<Int>,
        val lastRun: String,
        val at: Long = -1,
    )

    data class Tap(val seq: Int, val name: String, val date: String)

    data class Synced(val count: Int, val nextAt: Long, val exact: Boolean, val notifications: Boolean)

    /** The last routine notification tapped. JS polls it (never the event bridge, §5)
     *  and runs each seq once. */
    @Volatile
    var tap = Tap(0, "", "")
        private set

    // ── Pure (JVM-tested) ──

    fun isoDate(ms: Long, tz: TimeZone): String {
        val c = Calendar.getInstance(tz).apply { timeInMillis = ms }
        return String.format(
            Locale.US, "%04d-%02d-%02d",
            c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH),
        )
    }

    /** The first [hour]:[minute] strictly after [now] on one of [days], skipping
     *  [lastRun]'s date. -1 for no days or a bad time. */
    fun nextDue(now: Long, hour: Int, minute: Int, days: Set<Int>, lastRun: String, tz: TimeZone): Long {
        if (days.isEmpty() || hour !in 0..23 || minute !in 0..59) return -1
        val today = Calendar.getInstance(tz).apply { timeInMillis = now }
        // Today plus a full week, for a once-a-week routine that already ran today. Each
        // day is set fresh so a DST change keeps the wall-clock time.
        for (i in 0..7) {
            val c = (today.clone() as Calendar).apply {
                add(Calendar.DAY_OF_MONTH, i)
                set(Calendar.HOUR_OF_DAY, hour)
                set(Calendar.MINUTE, minute)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }
            val at = c.timeInMillis
            if (at > now && (c.get(Calendar.DAY_OF_WEEK) - 1) in days && isoDate(at, tz) != lastRun) return at
        }
        return -1
    }

    /** JS's list (no `at`) or the stored one (with it). Rows without a name are dropped. */
    fun fromJson(json: String): List<Entry> {
        val arr = try { JSONArray(json) } catch (_: Exception) { return emptyList() }
        return (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            val name = o.optString("name").trim()
            val d = o.optJSONArray("days") ?: JSONArray()
            val days = (0 until d.length()).map { d.optInt(it, -1) }.filter { it in 0..6 }.toSet()
            if (name.isEmpty()) null
            else Entry(name, o.optInt("hour", -1), o.optInt("minute", -1), days, o.optString("lastRun"), o.optLong("at", -1))
        }
    }

    fun toJson(list: List<Entry>): String = JSONArray(list.map { e ->
        JSONObject()
            .put("name", e.name).put("hour", e.hour).put("minute", e.minute)
            .put("days", JSONArray(e.days.sorted())).put("lastRun", e.lastRun).put("at", e.at)
    }).toString()

    /** Every routine's next fire time from [now]; ones that never fire are dropped. */
    fun scheduled(list: List<Entry>, now: Long, tz: TimeZone): List<Entry> =
        list.map { it.copy(at = nextDue(now, it.hour, it.minute, it.days, it.lastRun, tz)) }.filter { it.at > 0 }

    /** At [now]: the routines to announce (due, and at most CATCH_UP_MS late) and the
     *  whole list rolled past [now]. */
    fun fire(list: List<Entry>, now: Long, tz: TimeZone): Pair<List<Entry>, List<Entry>> {
        val due = list.filter { it.at in 1..now }
        val rolled = list.map { e ->
            if (e.at in 1..now) e.copy(at = nextDue(now, e.hour, e.minute, e.days, e.lastRun, tz)) else e
        }
        return due.filter { now - it.at <= CATCH_UP_MS } to rolled.filter { it.at > 0 }
    }

    // ── Android ──

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun load(context: Context) = fromJson(prefs(context).getString(KEY, null) ?: "[]")
    private fun store(context: Context, list: List<Entry>) {
        prefs(context).edit().putString(KEY, toJson(list)).apply()
    }

    /** scheduleRoutines: replace the list, re-arm, and report what the phone can really do. */
    fun sync(context: Context, json: String): Synced {
        val now = System.currentTimeMillis()
        val tz = TimeZone.getDefault()
        val given = fromJson(json)
        // A routine that's gone, or already ran today, has nothing left to tap.
        val today = isoDate(now, tz)
        val open = given.filter { it.lastRun != today }.map { it.name }.toSet()
        (load(context) + given).map { it.name }.filter { it !in open }.toSet().forEach { cancelNotice(context, it) }
        val list = scheduled(given, now, tz)
        store(context, list)
        val exact = arm(context, list)
        return Synced(
            list.size,
            list.minOfOrNull { it.at } ?: -1,
            exact,
            NotificationManagerCompat.from(context).areNotificationsEnabled(),
        )
    }

    /** The alarm, BOOT_COMPLETED (a reboot drops alarms) and an app update: announce
     *  what's due, roll forward, re-arm. */
    fun onAlarm(context: Context) {
        val tz = TimeZone.getDefault()
        val (due, rolled) = fire(load(context), System.currentTimeMillis(), tz)
        due.forEach { notice(context, it, isoDate(it.at, tz)) }
        store(context, rolled)
        arm(context, rolled)
    }

    /** The time zone changed. Stored times are instants, and a routine is a wall-clock
     *  time, so each one's next time is worked out again in the new zone. */
    fun onTimeZoneChanged(context: Context) {
        val list = scheduled(load(context), System.currentTimeMillis(), TimeZone.getDefault())
        store(context, list)
        arm(context, list)
    }

    /** One alarm, for the earliest routine. True when it's exact; without the exact-alarm
     *  grant Android may hold an inexact one for several minutes. */
    private fun arm(context: Context, list: List<Entry>): Boolean {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pi = PendingIntent.getBroadcast(
            context, 0, Intent(context, RoutineAlarmReceiver::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val at = list.minOfOrNull { it.at }
        if (at == null) {
            am.cancel(pi)
            return true
        }
        val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
        if (exact) {
            try {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
                return true
            } catch (e: SecurityException) {
                Log.w(TAG, "exact alarm refused: ${e.message}")
            }
        }
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        return false
    }

    private fun tag(name: String) = "routine:$name"

    private fun cancelNotice(context: Context, name: String) {
        NotificationManagerCompat.from(context).cancel(tag(name), NOTIFICATION_ID)
    }

    private fun notice(context: Context, e: Entry, date: String) =
        post(context, e.name, date, "Time for ${e.name}")

    /** The routine notification: tapping it opens JARVIS, which runs routine [name] for
     *  [date] (takeTap → pollRoutineTap). Also posted by ArrivalWatcher on getting home. */
    fun post(context: Context, name: String, date: String, title: String) {
        val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_NAME, name)
            putExtra(EXTRA_DATE, date)
        } ?: return
        // ponytail: request code is the name's hash, so two names that collide would share
        // one tap target. Upgrade: a stored id per routine.
        val pi = PendingIntent.getActivity(
            context, tag(name).hashCode(), open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(context, PhonePlugin.REMINDER_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText("Tap and JARVIS runs it.")
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(tag(name), NOTIFICATION_ID, n)
        } catch (ex: SecurityException) {
            Log.w(TAG, "routine notification not permitted: ${ex.message}")
        }
    }

    /** A launch from a routine notification (MainActivity.onCreate / onNewIntent; the
     *  plugin isn't registered yet when a tap revives a killed JARVIS). The extras are
     *  removed so a recreated activity can't take it twice; a relaunch from Recents
     *  replays the original intent, so it's ignored. */
    fun takeTap(intent: Intent?) {
        val name = intent?.getStringExtra(EXTRA_NAME) ?: return
        val date = intent.getStringExtra(EXTRA_DATE) ?: ""
        intent.removeExtra(EXTRA_NAME)
        intent.removeExtra(EXTRA_DATE)
        if ((intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return
        synchronized(this) { tap = Tap(tap.seq + 1, name, date) }
    }
}

class RoutineAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) =
        if (intent?.action == Intent.ACTION_TIMEZONE_CHANGED) RoutineAlarms.onTimeZoneChanged(context)
        else RoutineAlarms.onAlarm(context)
}
