package com.jarvis.phone

import android.app.Activity
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.SearchManager
import android.content.BroadcastReceiver
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.ContactsContract
import android.provider.MediaStore
import android.provider.Settings
import android.telephony.PhoneNumberUtils
import android.telephony.SmsManager
import android.telephony.TelephonyManager
import android.view.KeyEvent
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import app.tauri.plugin.JSObject
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.runBlocking
import org.json.JSONArray

/**
 * One-step Android actions: what Gemini does in one call and JARVIS used to send
 * through the operator loop (Quick Settings, a Settings search, typing into WhatsApp).
 *
 * The rule that runs through every function here: the reply describes the state
 * Android reports AFTER the action (torch callback, interruption filter, ringer mode,
 * isMusicActive, the SMS sent-broadcast, WhatsApp's emptied box), never what was asked
 * for. Anything blocking is called from PhonePlugin's IO scope, not the main thread.
 */
internal object DirectActions {

    private const val SPOTIFY = "com.spotify.music"
    private const val YT_MUSIC = "com.google.android.apps.youtube.music"
    private const val MAPS = "com.google.android.apps.maps"
    private val WHATSAPP = listOf("com.whatsapp", "com.whatsapp.w4b")

    private fun res(ok: Boolean, summary: String, code: String = if (ok) "ok" else "action_failed") =
        JSObject().apply {
            put("ok", ok)
            put("summary", summary)
            put("code", code)
        }

    /** Poll [cond] every 50 ms until it holds or [timeoutMs] passes. */
    private fun waitFor(timeoutMs: Long, cond: () -> Boolean): Boolean {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        while (true) {
            if (cond()) return true
            if (SystemClock.elapsedRealtime() >= deadline) return false
            Thread.sleep(50)
        }
    }

    private fun open(ctx: Context, intent: Intent): Boolean = try {
        ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (_: Exception) {
        false
    }

    private fun installed(ctx: Context, pkg: String) =
        ctx.packageManager.getLaunchIntentForPackage(pkg) != null

    /** Paused by parental controls or Digital Wellbeing. Starting it doesn't throw —
     *  Android shows "App isn't available" instead — so a start alone proves nothing
     *  (live 2026-10-18: parental controls had paused Maps, and navigate said it started). */
    private fun suspended(ctx: Context, pkg: String): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            try { ctx.packageManager.isPackageSuspended(pkg) } catch (_: Exception) { false }

    private fun pausedApp(name: String) = res(
        false,
        "$name is paused on this phone (parental controls or Digital Wellbeing), so I can't use it right now.",
        "app_suspended",
    )

    private fun granted(ctx: Context, perm: String) =
        ContextCompat.checkSelfPermission(ctx, perm) == PackageManager.PERMISSION_GRANTED

    private val asked = ConcurrentHashMap.newKeySet<String>()

    /**
     * Ask for a runtime permission the first time it's missing (this process), the way
     * the calendar does: nothing listens for the answer, the next request re-checks.
     * Returns true when the dialog was just shown, false when it was asked already.
     */
    private fun askOnce(act: Activity, perm: String, code: Int): Boolean {
        if (!asked.add(perm)) return false
        act.runOnUiThread { ActivityCompat.requestPermissions(act, arrayOf(perm), code) }
        return true
    }

    private fun openAppSettings(ctx: Context) = open(
        ctx,
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", ctx.packageName, null)),
    )

    private fun guarded(what: String, block: () -> JSObject): JSObject = try {
        block()
    } catch (e: SecurityException) {
        res(false, "Android refused that ($what): ${e.message}", "permission_denied")
    } catch (e: Exception) {
        res(false, "Couldn't $what: ${e.message}")
    }

    // ── Device controls ─────────────────────────────────────────────────────────

    fun device(act: Activity, a: DeviceActionArgs): JSObject {
        val action = a.action.trim().lowercase(Locale.ROOT)
        return guarded(action.replace('_', ' ')) {
            when (action) {
                "flashlight_on" -> torch(act, true)
                "flashlight_off" -> torch(act, false)
                "dnd_on" -> dnd(act, true)
                "dnd_off" -> dnd(act, false)
                "ringer_normal" -> ringer(act, AudioManager.RINGER_MODE_NORMAL, "Ringer on.")
                "ringer_vibrate" -> ringer(act, AudioManager.RINGER_MODE_VIBRATE, "Phone set to vibrate.")
                "ringer_silent" -> ringer(act, AudioManager.RINGER_MODE_SILENT, "Phone silenced.")
                "media_play" -> media(act, KeyEvent.KEYCODE_MEDIA_PLAY)
                "media_pause" -> media(act, KeyEvent.KEYCODE_MEDIA_PAUSE)
                "media_play_pause" -> media(act, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
                "media_next" -> skip(act, KeyEvent.KEYCODE_MEDIA_NEXT, "next")
                "media_previous" -> skip(act, KeyEvent.KEYCODE_MEDIA_PREVIOUS, "previous")
                "volume_up" -> volumeStep(act, AudioManager.ADJUST_RAISE, a.value)
                "volume_down" -> volumeStep(act, AudioManager.ADJUST_LOWER, a.value)
                "mute" -> volumeStep(act, AudioManager.ADJUST_MUTE, 1)
                "unmute" -> volumeStep(act, AudioManager.ADJUST_UNMUTE, 1)
                "mute_toggle" -> {
                    val manager = act.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                    volumeStep(act, if (manager.isStreamMute(AudioManager.STREAM_MUSIC))
                        AudioManager.ADJUST_UNMUTE else AudioManager.ADJUST_MUTE, 1)
                }
                "microphone_mute", "microphone_unmute" -> {
                    val manager = act.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                    val mute = a.action == "microphone_mute"
                    manager.isMicrophoneMute = mute
                    if (manager.isMicrophoneMute == mute) res(true, "Android reports microphone ${if (mute) "muted" else "unmuted"}.")
                    else res(false, "Android did not change the microphone mute state.")
                }
                "brightness" -> brightness(act, a.value)
                "auto_rotate_on" -> autoRotate(act, true)
                "auto_rotate_off" -> autoRotate(act, false)
                "lock_screen" -> lockScreen()
                "navigate" -> navigate(act, a.query, a.mode)
                "play" -> play(act, a.query, a.app)
                else -> res(false, "I don't know the device action '${a.action}'.")
            }
        }
    }

    // Android reports torch state per camera through a callback, never by a getter.
    private val torchState = ConcurrentHashMap<String, Boolean>()
    @Volatile private var torchCallback: CameraManager.TorchCallback? = null

    private fun torch(ctx: Context, on: Boolean): JSObject {
        val cm = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val id = cm.cameraIdList.firstOrNull {
            cm.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
        } ?: return res(false, "This phone has no flashlight I can use.", "unsupported")
        if (torchCallback == null) {
            val cb = object : CameraManager.TorchCallback() {
                override fun onTorchModeChanged(cameraId: String, enabled: Boolean) {
                    torchState[cameraId] = enabled
                }
            }
            cm.registerTorchCallback(cb, Handler(Looper.getMainLooper()))
            torchCallback = cb
        }
        val word = if (on) "on" else "off"
        return try {
            cm.setTorchMode(id, on)
            if (waitFor(1_500) { torchState[id] == on }) res(true, "Flashlight $word.")
            else res(false, "Android didn't confirm the flashlight turned $word.")
        } catch (_: CameraAccessException) {
            res(false, "The camera is in use, so I can't switch the flashlight $word.", "camera_busy")
        }
    }

    private fun needsPolicyAccess(ctx: Context): JSObject {
        open(ctx, Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS))
        return res(
            false,
            "I need Do Not Disturb access first. I've opened the screen: switch JARVIS on there, then ask again.",
            "needs_access",
        )
    }

    private fun dnd(ctx: Context, on: Boolean): JSObject {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (!nm.isNotificationPolicyAccessGranted) return needsPolicyAccess(ctx)
        nm.setInterruptionFilter(
            if (on) NotificationManager.INTERRUPTION_FILTER_PRIORITY else NotificationManager.INTERRUPTION_FILTER_ALL,
        )
        val reached = waitFor(1_500) {
            val f = nm.currentInterruptionFilter
            if (on) f != NotificationManager.INTERRUPTION_FILTER_ALL && f != NotificationManager.INTERRUPTION_FILTER_UNKNOWN
            else f == NotificationManager.INTERRUPTION_FILTER_ALL
        }
        val word = if (on) "on" else "off"
        if (reached) return res(true, "Do Not Disturb is $word.")
        // Android 15+ (for apps targeting 35+): setInterruptionFilter only toggles an
        // app-owned rule, "Do Not Disturb (JARVIS)". Turning on works (the strictest rule
        // wins); turning off ends only ours, never one the user or a schedule started.
        // Seen live 2026-10-18. Quick Settings can still end it, so hand that to phone_task.
        if (!on && Build.VERSION.SDK_INT >= 35) {
            return res(
                false,
                "Do Not Disturb is still on: it was turned on outside JARVIS (Quick Settings or a schedule), " +
                    "and Android only lets an app switch off its own. Use phone_task to turn it off from Quick Settings.",
                "dnd_not_ours",
            )
        }
        return res(false, "I asked for Do Not Disturb $word, but Android still reports it the other way.")
    }

    private fun ringer(ctx: Context, mode: Int, okText: String): JSObject {
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (am.ringerMode == mode) return res(true, okText)
        try {
            am.ringerMode = mode
        } catch (_: SecurityException) {
            // Going to or from silent changes Do Not Disturb state, which needs its access.
            return needsPolicyAccess(ctx)
        }
        return if (waitFor(1_000) { am.ringerMode == mode }) res(true, okText)
        else res(false, "Android didn't take that ringer change.")
    }

    private fun audio(ctx: Context) = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    private fun sendKey(am: AudioManager, code: Int) {
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, code))
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, code))
    }

    private fun media(ctx: Context, code: Int): JSObject {
        val am = audio(ctx)
        // The player's own state when its session is visible; isMusicActive otherwise
        // (it also counts brief system sounds, so it's the weaker signal).
        val session = sessions(ctx).firstOrNull()
        val isPlaying = { session?.playbackState?.let { it.state == PlaybackState.STATE_PLAYING } ?: am.isMusicActive }
        val wasPlaying = isPlaying()
        val wantPlaying = when (code) {
            KeyEvent.KEYCODE_MEDIA_PLAY -> true
            KeyEvent.KEYCODE_MEDIA_PAUSE -> false
            else -> !wasPlaying
        }
        if (wasPlaying == wantPlaying) {
            return res(true, if (wantPlaying) "Something is already playing." else "Nothing is playing.")
        }
        when {
            session == null -> sendKey(am, code)
            wantPlaying -> session.transportControls.play()
            else -> session.transportControls.pause()
        }
        return if (waitFor(2_000) { isPlaying() == wantPlaying }) {
            res(true, if (wantPlaying) "Playing." else "Paused.")
        } else if (wantPlaying) {
            res(false, "I sent play, but nothing started — no media app is ready to resume.")
        } else {
            res(false, "I sent pause, but audio is still playing.")
        }
    }

    /** Active media sessions, most recent first. Empty without notification access. */
    private fun sessions(ctx: Context): List<MediaController> = try {
        ctx.getSystemService(MediaSessionManager::class.java)
            .getActiveSessions(JarvisNotificationListener.component(ctx))
    } catch (_: SecurityException) {
        emptyList()
    }

    /** What's playing, for "send this to the TV": the playing session (else the most
     *  recent) with where it is now — PlaybackState's position plus the time since it
     *  was reported, while playing. Nothing is guessed without notification access. */
    fun mediaNow(ctx: Context): JSObject {
        if (!JarvisNotificationListener.enabled(ctx)) {
            return res(false, "Turn on notification access for JARVIS so I can see what's playing.", "no_access")
        }
        val all = sessions(ctx)
        val s = all.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING } ?: all.firstOrNull()
            ?: return res(false, "Nothing is playing on the phone.", "nothing_playing")
        val st = s.playbackState
        val playing = st?.state == PlaybackState.STATE_PLAYING
        var position = st?.position ?: 0L
        if (playing && st != null && st.lastPositionUpdateTime > 0) {
            position += ((SystemClock.elapsedRealtime() - st.lastPositionUpdateTime) * st.playbackSpeed).toLong()
        }
        return res(true, "ok").apply {
            put("package", s.packageName)
            put("title", s.metadata?.getString(MediaMetadata.METADATA_KEY_TITLE) ?: "")
            put("artist", s.metadata?.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: "")
            put("playing", playing)
            put("position", maxOf(position, 0L))
        }
    }

    /** The title of the active media session, when notification access lets us see it. */
    private fun nowPlaying(ctx: Context): String? =
        sessions(ctx).firstOrNull()?.metadata?.getString(MediaMetadata.METADATA_KEY_TITLE)

    private fun skip(ctx: Context, code: Int, which: String): JSObject {
        val am = audio(ctx)
        val session = sessions(ctx).firstOrNull()
        val before = session?.metadata?.getString(MediaMetadata.METADATA_KEY_TITLE)
        // The player's own session control, when we can see it: a media key sent to a
        // paused Spotify was dropped live (2026-10-18), skipToNext on its session isn't.
        when {
            session == null -> sendKey(am, code)
            code == KeyEvent.KEYCODE_MEDIA_NEXT -> session.transportControls.skipToNext()
            else -> session.transportControls.skipToPrevious()
        }
        if (before == null) {
            // Without notification access the track can't be read back: say only what was done.
            return res(true, "Sent '$which track' to the media player (I can't see what's playing to confirm).")
        }
        var after: String? = before
        val changed = waitFor(2_500) { after = nowPlaying(ctx); after != null && after != before }
        return if (changed) res(true, "Now playing: $after.")
        else res(false, "I sent '$which track', but the song didn't change.")
    }

    private fun volumeStep(ctx: Context, direction: Int, steps: Int): JSObject {
        val am = audio(ctx)
        val n = if (direction == AudioManager.ADJUST_MUTE) 1 else steps.coerceIn(1, 15)
        repeat(n) { i ->
            am.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, if (i == n - 1) AudioManager.FLAG_SHOW_UI else 0)
        }
        val pct = am.getStreamVolume(AudioManager.STREAM_MUSIC) * 100 / am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val muted = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && am.isStreamMute(AudioManager.STREAM_MUSIC)
        return when {
            direction == AudioManager.ADJUST_MUTE ->
                if (muted || pct == 0) res(true, "Media muted.") else res(false, "Android didn't mute the media volume.")
            else -> res(true, "Media volume is now $pct%.")
        }
    }

    private fun needsWriteSettings(ctx: Context): JSObject {
        open(ctx, Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:${ctx.packageName}")))
        return res(
            false,
            "I need permission to change system settings first. I've opened the screen: allow JARVIS there, then ask again.",
            "needs_access",
        )
    }

    // ponytail: linear 0-100 → 0-255. Phones map that number through their own
    // brightness curve, so "50%" won't look like half on every device.
    private fun brightness(ctx: Context, value: Int): JSObject {
        if (!Settings.System.canWrite(ctx)) return needsWriteSettings(ctx)
        val cr = ctx.contentResolver
        if (value < 0) {
            Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC)
            val auto = Settings.System.getInt(cr, Settings.System.SCREEN_BRIGHTNESS_MODE, -1) ==
                Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC
            return if (auto) res(true, "Auto-brightness on.") else res(false, "Android didn't turn auto-brightness on.")
        }
        val level = (value.coerceIn(0, 100) * 255 / 100).coerceAtLeast(1)
        Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL)
        Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS, level)
        val now = Settings.System.getInt(cr, Settings.System.SCREEN_BRIGHTNESS, -1)
        return if (now == level) res(true, "Brightness set to ${value.coerceIn(0, 100)}%.")
        else res(false, "Android kept the brightness at its own level.")
    }

    private fun autoRotate(ctx: Context, on: Boolean): JSObject {
        if (!Settings.System.canWrite(ctx)) return needsWriteSettings(ctx)
        val cr = ctx.contentResolver
        Settings.System.putInt(cr, Settings.System.ACCELEROMETER_ROTATION, if (on) 1 else 0)
        val now = Settings.System.getInt(cr, Settings.System.ACCELEROMETER_ROTATION, -1)
        return if (now == (if (on) 1 else 0)) res(true, "Auto-rotate ${if (on) "on" else "off"}.")
        else res(false, "Android didn't change auto-rotate.")
    }

    private fun lockScreen(): JSObject {
        val svc = JarvisAccessibilityService.instance
            ?: return res(false, "Locking the screen needs JARVIS's accessibility service switched on.", "accessibility_disabled")
        return if (svc.lockScreen()) res(true, "Screen locked.") else res(false, "Android didn't lock the screen.")
    }

    // The destination goes in as data (Uri.encode) and JARVIS builds the URI itself, so
    // a model-written string can never become a deep link — open_url's http-only rule
    // stays intact.
    private fun navigate(ctx: Context, destination: String, mode: String): JSObject {
        val dest = destination.trim()
        if (dest.isEmpty()) return res(false, "Where should I navigate to?")
        val m = when (mode.trim().lowercase(Locale.ROOT)) {
            "walking", "walk" -> "w"
            "bicycling", "cycling", "bike" -> "b"
            else -> "d"
        }
        if (suspended(ctx, MAPS)) return pausedApp("Google Maps")
        val nav = Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=${Uri.encode(dest)}&mode=$m"))
            .setPackage(MAPS)
        if (nav.resolveActivity(ctx.packageManager) != null && open(ctx, nav)) {
            return res(true, "Started Google Maps navigation to $dest.")
        }
        val geo = Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=${Uri.encode(dest)}"))
        val geoApp = geo.resolveActivity(ctx.packageManager)?.packageName
        if (geoApp != null && suspended(ctx, geoApp)) return pausedApp("Your maps app")
        return if (geoApp != null && open(ctx, geo)) {
            res(true, "Opened $dest in your maps app — tap Directions to start.")
        } else {
            res(false, "There's no maps app on this phone that takes directions.", "unsupported")
        }
    }

    private fun play(ctx: Context, query: String, app: String): JSObject {
        val q = query.trim()
        if (q.isEmpty()) return res(false, "What should I play?")
        val wanted = app.trim().lowercase(Locale.ROOT)
        val pkg = when {
            wanted.contains("spotify") -> SPOTIFY
            wanted.contains("youtube") -> YT_MUSIC
            else -> listOf(SPOTIFY, YT_MUSIC).firstOrNull { installed(ctx, it) } ?: SPOTIFY
        }
        val name = if (pkg == SPOTIFY) "Spotify" else "YouTube Music"
        if (!installed(ctx, pkg)) return res(false, "$name isn't installed.", "unsupported")
        if (suspended(ctx, pkg)) return pausedApp(name)
        val am = audio(ctx)
        // Something already playing would read as success below, so pause it first.
        if (am.isMusicActive) {
            sendKey(am, KeyEvent.KEYCODE_MEDIA_PAUSE)
            waitFor(1_000) { !am.isMusicActive }
        }
        // Spotify ignores MEDIA_PLAY_FROM_SEARCH now (opened, stayed paused — live
        // 2026-10-18) but its media session takes playFromSearch. With notification
        // access we can reach that session; open the app first if it has none yet.
        val access = JarvisNotificationListener.enabled(ctx)
        fun sessionOf() = sessions(ctx).firstOrNull {
            it.packageName == pkg &&
                ((it.playbackState?.actions ?: 0L) and PlaybackState.ACTION_PLAY_FROM_SEARCH) != 0L
        }
        val session = sessionOf() ?: if (access) {
            ctx.packageManager.getLaunchIntentForPackage(pkg)?.let { open(ctx, it) }
            waitFor(4_000) { sessionOf() != null }
            sessionOf()
        } else {
            null
        }
        if (session != null) {
            session.transportControls.playFromSearch(q, Bundle())
        } else {
            val intent = Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH)
                .setPackage(pkg)
                .putExtra(SearchManager.QUERY, q)
                .putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*")
            if (intent.resolveActivity(ctx.packageManager) == null || !open(ctx, intent)) {
                return res(false, "$name doesn't take play requests from other apps.", "unsupported")
            }
        }
        // Neither call proves playback. With the session, only the player's own PLAYING
        // counts: isMusicActive blipped true live while Spotify stayed idle (2026-10-18).
        val started = if (session != null) {
            waitFor(7_000) { session.playbackState?.state == PlaybackState.STATE_PLAYING }
        } else {
            waitFor(7_000) { am.isMusicActive }
        }
        if (!started) {
            val hint = if (access) "" else " (turn on notification access for JARVIS and I can start it directly)"
            return res(
                false,
                "I asked $name to play \"$q\", but nothing started playing$hint. phone_task can search and play it in the app.",
                "not_playing",
            )
        }
        val title = session?.metadata?.getString(MediaMetadata.METADATA_KEY_TITLE)
        return res(true, if (title != null) "Playing on $name: $title." else "Playing \"$q\" on $name.")
    }

    // ── Messages and calls ──────────────────────────────────────────────────────
    // Two calls from JS with the user's approval between them: `resolve` says who and
    // how, the user approves exactly that, then `message`/`call` uses the approved
    // number — never a second lookup that could land on someone else.

    fun comm(act: Activity, a: CommActionArgs): JSObject = guarded("reach ${a.to.ifBlank { a.name }}") {
        when (a.action.trim().lowercase(Locale.ROOT)) {
            "resolve" -> resolve(act, a.to, appOf(a.app))
            "message" -> message(act, a)
            "call" -> if (appOf(a.app) == "whatsapp") whatsappCall(act, a.name, a.number, a.video) else call(act, a.name, a.number)
            else -> res(false, "I don't know the contact action '${a.action}'.")
        }
    }

    /** whatsapp | sms | phone, or the other app's name as said ("telegram"). */
    private fun appOf(app: String): String {
        val s = app.trim().lowercase(Locale.ROOT)
        return when {
            s.isEmpty() || s.contains("whatsapp") -> "whatsapp"
            s == "sms" || s.contains("text") || s.contains("messages") -> "sms"
            s == "phone" || s == "call" -> "phone"
            else -> s
        }
    }

    private fun candidate(name: String, number: String, route: String, app: String) = res(true, name).apply {
        put("name", name)
        put("number", number)
        put("route", route)
        put("app", app)
    }

    private fun notificationReplyTarget(app: String, person: String) =
        JarvisNotificationListener.instance?.findReplyable(
            if (app == "whatsapp") WHATSAPP.toSet() else emptySet(),
            if (app == "whatsapp") "" else app,
            person,
        )

    private fun resolve(act: Activity, to: String, app: String): JSObject {
        val who = to.trim()
        if (who.isEmpty()) return res(false, "Who should I contact?")
        val usesContacts = app == "whatsapp" || app == "sms" || app == "phone"
        if (!usesContacts) {
            // Telegram, Instagram, Signal…: there's no public way in except replying to
            // a notification from that person.
            notificationReplyTarget(app, who)
                ?: return res(
                    false,
                    "I can only message on $app by replying to a notification from $who, and there isn't one showing" +
                        (if (JarvisNotificationListener.instance == null) " (notification access is off)." else "."),
                    "no_notification",
                )
            return candidate(who, "", "notification", app)
        }
        val route = { name: String ->
            when (app) {
                "sms" -> "sms"
                "phone" -> "call"
                else -> if (notificationReplyTarget(app, name) != null) "notification" else "chat"
            }
        }
        if (DirectMatch.looksLikeNumber(who)) return candidate(who, who, route(who), app)
        if (!granted(act, android.Manifest.permission.READ_CONTACTS)) {
            if (!askOnce(act, android.Manifest.permission.READ_CONTACTS, 110)) openAppSettings(act)
            return res(
                false,
                "I need access to your contacts to find $who. Allow Contacts for JARVIS, then ask again.",
                "needs_permission",
            )
        }
        return when (val pick = DirectMatch.pickContact(who, contactRows(act, who))) {
            is DirectMatch.Pick.One -> candidate(pick.name, pick.number, route(pick.name), app)
            is DirectMatch.Pick.Ambiguous -> res(
                false,
                "More than one contact matches \"$who\": ${pick.names.joinToString(", ")}. Which one?",
                "ambiguous",
            ).apply { put("names", JSONArray(pick.names)) }
            DirectMatch.Pick.None -> {
                // A WhatsApp group (or a chat not in Contacts) can still be answered from its notification.
                if (app == "whatsapp" && notificationReplyTarget(app, who) != null) candidate(who, "", "notification", app)
                else res(false, "I couldn't find \"$who\" in your contacts.", "not_found")
            }
        }
    }

    private fun contactRows(ctx: Context, query: String): List<DirectMatch.PhoneRow> {
        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER,
            ContactsContract.CommonDataKinds.Phone.IS_SUPER_PRIMARY,
            ContactsContract.CommonDataKinds.Phone.TYPE,
        )
        val rows = ArrayList<DirectMatch.PhoneRow>()
        ctx.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            projection,
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} LIKE ?",
            arrayOf("%${query.trim()}%"),
            null,
        )?.use { c ->
            while (c.moveToNext() && rows.size < 200) {
                rows += DirectMatch.PhoneRow(
                    contactId = c.getLong(0),
                    name = c.getString(1).orEmpty(),
                    number = c.getString(2).orEmpty(),
                    superPrimary = c.getInt(3) != 0,
                    mobile = c.getInt(4) == ContactsContract.CommonDataKinds.Phone.TYPE_MOBILE,
                )
            }
        }
        return rows.filter { it.number.isNotBlank() }
    }

    private fun message(act: Activity, a: CommActionArgs): JSObject {
        val text = a.text.trim()
        if (text.isEmpty()) return res(false, "What should the message say?")
        val app = appOf(a.app)
        val name = a.name.ifBlank { a.number }
        if (app == "sms") return sms(act, name, a.number, text)
        // Nothing opens on screen when the person has a notification we can reply to.
        notificationReplyTarget(app, a.name)?.let { sbn ->
            val sent = JarvisNotificationListener.instance?.reply(sbn, text) == true
            return if (sent) res(true, "Replied to $name on ${label(app)} (through its notification).")
            else res(false, "${label(app)} didn't take the reply to $name. Nothing was confirmed sent.", "not_sent")
        }
        if (app != "whatsapp") {
            return res(false, "There's no notification from $name on $app to reply to any more.", "no_notification")
        }
        if (a.number.isBlank()) return res(false, "I don't have a phone number for $name to open a WhatsApp chat.", "not_found")
        return whatsappChat(act, name, a.number, text)
    }

    private fun label(app: String) = when (app) {
        "whatsapp" -> "WhatsApp"
        "sms" -> "SMS"
        else -> app.replaceFirstChar { it.titlecase(Locale.ROOT) }
    }

    /** The number as WhatsApp's click-to-chat wants it: country code + digits, no "+". */
    private fun internationalDigits(ctx: Context, number: String): String? {
        val tm = ctx.getSystemService(TelephonyManager::class.java)
        val iso = listOf(tm?.networkCountryIso, tm?.simCountryIso, Locale.getDefault().country)
            .firstOrNull { !it.isNullOrBlank() }?.uppercase(Locale.ROOT)
        val e164 = iso?.let { PhoneNumberUtils.formatNumberToE164(number, it) }
            ?: number.trim().takeIf { it.startsWith("+") }
        return e164?.filter { it.isDigit() }?.takeIf { it.length >= 8 }
    }

    /**
     * WhatsApp's official click-to-chat link opens the chat with the text typed; the
     * accessibility service presses Send. Sent = the message box emptied afterwards.
     */
    private fun whatsappChat(act: Activity, name: String, number: String, text: String): JSObject {
        val svc = JarvisAccessibilityService.instance
        if (svc?.isDeviceLocked() == true) return res(false, "The phone is locked, so I can't send that.", "device_locked")
        val pkg = WHATSAPP.firstOrNull { installed(act, it) } ?: return res(false, "WhatsApp isn't installed.", "unsupported")
        if (suspended(act, pkg)) return pausedApp("WhatsApp")
        val digits = internationalDigits(act, number)
            ?: return res(false, "I couldn't turn $number into an international number for WhatsApp.", "bad_number")
        val uri = Uri.parse("https://api.whatsapp.com/send?phone=$digits&text=${Uri.encode(text)}")
        if (!open(act, Intent(Intent.ACTION_VIEW, uri).setPackage(pkg))) return res(false, "WhatsApp wouldn't open.")
        if (svc == null) {
            return res(
                false,
                "I opened your WhatsApp chat with $name with the message typed. Tap Send (switch on JARVIS's accessibility service and I can send it myself).",
                "typed_not_sent",
            )
        }
        val tapped = svc.clickInApp(pkg, "send", "Send", 6_000)
        val sent = tapped && waitFor(2_000) {
            val box = svc.textInApp(pkg, "entry")
            box == null || !box.contains(text.take(24))
        }
        runBlocking { NativeOperator.bringToFront(act) }
        return when {
            sent -> res(true, "Sent to $name on WhatsApp.")
            tapped -> res(false, "I pressed Send, but couldn't confirm the message left. Check your chat with $name.", "unverified")
            else -> res(false, "WhatsApp didn't show a Send button — $name may not be on WhatsApp. Nothing was sent.", "not_sent")
        }
    }

    private fun sms(act: Activity, name: String, number: String, text: String): JSObject {
        if (number.isBlank()) return res(false, "I don't have a phone number for $name.", "not_found")
        if (!granted(act, android.Manifest.permission.SEND_SMS)) {
            if (askOnce(act, android.Manifest.permission.SEND_SMS, 111)) {
                return res(false, "I need permission to send texts. Allow SMS for JARVIS, then ask again.", "needs_permission")
            }
            // Still not granted (declined, or a restricted setting on this install): hand
            // it to the Messages app with the text typed, and say that it isn't sent.
            val compose = Intent(Intent.ACTION_SENDTO, Uri.fromParts("smsto", number, null)).putExtra("sms_body", text)
            compose.resolveActivity(act.packageManager)?.packageName?.let { if (suspended(act, it)) return pausedApp("Messages") }
            return if (open(act, compose)) res(false, "I opened Messages with your text to $name typed. Tap Send.", "typed_not_sent")
            else res(false, "I'm not allowed to send texts, and no messaging app would take it.", "permission_denied")
        }
        val sms = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) act.getSystemService(SmsManager::class.java)
            else @Suppress("DEPRECATION") SmsManager.getDefault()
        val parts = sms.divideMessage(text)
        val action = "com.jarvis.phone.SMS_SENT.${SystemClock.elapsedRealtimeNanos()}"
        val latch = CountDownLatch(parts.size)
        val failed = AtomicBoolean(false)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (resultCode != Activity.RESULT_OK) failed.set(true)
                latch.countDown()
            }
        }
        ContextCompat.registerReceiver(act, receiver, IntentFilter(action), ContextCompat.RECEIVER_NOT_EXPORTED)
        try {
            val sent = ArrayList(parts.indices.map { i ->
                PendingIntent.getBroadcast(
                    act, i, Intent(action).setPackage(act.packageName),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_ONE_SHOT,
                )
            })
            sms.sendMultipartTextMessage(number, null, parts, sent, null)
            // The radio's own verdict on every part — not "the call didn't throw".
            val answered = latch.await(10, TimeUnit.SECONDS)
            return when {
                answered && !failed.get() -> res(true, "Text sent to $name.")
                answered -> res(false, "The text to $name failed to send (no signal or SMS refused).", "not_sent")
                else -> res(false, "The phone didn't confirm the text to $name went out.", "unverified")
            }
        } finally {
            act.unregisterReceiver(receiver)
        }
    }

    private fun call(act: Activity, name: String, number: String): JSObject {
        if (number.isBlank()) return res(false, "I don't have a phone number for $name.", "not_found")
        val tel = Uri.fromParts("tel", number, null)
        if (granted(act, android.Manifest.permission.CALL_PHONE)) {
            return if (open(act, Intent(Intent.ACTION_CALL, tel))) res(true, "Calling $name.")
            else res(false, "The phone app wouldn't start the call.")
        }
        if (askOnce(act, android.Manifest.permission.CALL_PHONE, 112)) {
            return res(false, "I need permission to place calls. Allow Phone for JARVIS, then ask again.", "needs_permission")
        }
        val dial = Intent(Intent.ACTION_DIAL, tel)
        dial.resolveActivity(act.packageManager)?.packageName?.let { if (suspended(act, it)) return pausedApp("The phone app") }
        return if (open(act, dial)) res(false, "I opened the dialer with $name's number. Tap Call.", "dial_only")
        else res(false, "No phone app would take that number.", "unsupported")
    }

    /**
     * A WhatsApp voice/video call, in one step. WhatsApp writes a "voice call" and a
     * "video call" row into Contacts for every WhatsApp contact (the rows Google
     * Assistant's "call X on WhatsApp" uses); opening one starts the call. The row is
     * matched to the approved number's WhatsApp id, so it can't ring someone else.
     * Started = the phone's audio enters call mode, not "the intent didn't throw".
     */
    private fun whatsappCall(act: Activity, name: String, number: String, video: Boolean): JSObject {
        if (number.isBlank()) return res(false, "I don't have a phone number for $name.", "not_found")
        val pkg = WHATSAPP.firstOrNull { installed(act, it) } ?: return res(false, "WhatsApp isn't installed.", "unsupported")
        if (suspended(act, pkg)) return pausedApp("WhatsApp")
        val digits = internationalDigits(act, number)
            ?: return res(false, "I couldn't turn $number into an international number for WhatsApp.", "bad_number")
        val mime = "vnd.android.cursor.item/vnd.com.whatsapp.${if (video) "video" else "voip"}.call"
        val rowId = act.contentResolver.query(
            ContactsContract.Data.CONTENT_URI,
            arrayOf(ContactsContract.Data._ID),
            "${ContactsContract.Data.MIMETYPE} = ? AND ${ContactsContract.Data.DATA1} = ?",
            arrayOf(mime, "$digits@s.whatsapp.net"),
            null,
        )?.use { c -> if (c.moveToFirst()) c.getLong(0) else null }
        val am = audio(act)
        val kind = if (video) "video call" else "call"
        // Every wait below stays inside the JS side's 15 s ceiling (PHONE_INVOKE_TIMEOUT_MS).
        // JARVIS's own mic puts the phone in the same mode (seen in the audio log
        // 2026-10-18), so only a change INTO call mode counts as the call starting.
        val wasInCommunication = am.mode == AudioManager.MODE_IN_COMMUNICATION
        val inCall = { ms: Long ->
            !wasInCommunication && waitFor(ms) { am.mode == AudioManager.MODE_IN_COMMUNICATION }
        }
        if (rowId != null) {
            val intent = Intent(Intent.ACTION_VIEW)
                .setDataAndType(ContentUris.withAppendedId(ContactsContract.Data.CONTENT_URI, rowId), mime)
                .setPackage(pkg)
            // WhatsApp guards this activity: live 2026-10-18 it was a "Permission Denial"
            // for JARVIS (only privileged callers like the system assistant get in). A
            // refused start falls through to the chat's own call button below.
            if (open(act, intent)) {
                return if (inCall(8_000)) res(true, "WhatsApp $kind to $name started.")
                else res(false, "I asked WhatsApp to start a $kind to $name, but the call didn't start.", "unverified")
            }
        }
        // Open the chat by the official link and press its call button.
        val svc = JarvisAccessibilityService.instance
            ?: return res(false, "A WhatsApp $kind needs JARVIS's accessibility service switched on.", "accessibility_disabled")
        if (svc.isDeviceLocked()) return res(false, "The phone is locked, so I can't start that call.", "device_locked")
        if (!open(act, Intent(Intent.ACTION_VIEW, Uri.parse("https://api.whatsapp.com/send?phone=$digits")).setPackage(pkg))) {
            return res(false, "WhatsApp wouldn't open.")
        }
        val pressed = svc.clickInApp(pkg, "", if (video) "Video call" else "Voice call", 5_000)
        if (pressed && !inCall(3_000)) {
            // Some versions ask "Start voice call?" first.
            svc.clickInApp(pkg, "android:id/button1", "", 1_500)
        }
        if (pressed && inCall(4_000)) {
            return res(true, "WhatsApp $kind to $name started.")
        }
        runBlocking { NativeOperator.bringToFront(act) }
        return if (pressed) {
            res(false, "I pressed WhatsApp's $kind button, but the call didn't start.", "unverified")
        } else {
            res(false, "WhatsApp didn't show a $kind button for $name — they may not be on WhatsApp. No call was made.", "not_on_whatsapp")
        }
    }

    // ── Notifications ───────────────────────────────────────────────────────────

    fun notifications(act: Activity, a: NotificationActionArgs): JSObject = guarded("read notifications") {
        val action = a.action.trim().lowercase(Locale.ROOT)
        val listener = JarvisNotificationListener.instance?.takeIf { JarvisNotificationListener.enabled(act) }
        if (listener == null) {
            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                    .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, JarvisNotificationListener.component(act).flattenToString())
            } else {
                Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")
            }
            open(act, intent)
            return@guarded res(
                false,
                "I need notification access first. I've opened the screen: switch JARVIS on there, then ask again.",
                "needs_access",
            )
        }
        if (action == "request_access") return@guarded res(true, "Notification access is already on.")
        if (action != "read") return@guarded res(false, "I don't know the notification action '${a.action}'.")
        val items = listener.items().filter { item ->
            (a.app.isBlank() || item.app.contains(a.app.trim(), ignoreCase = true) || item.pkg.contains(a.app.trim(), ignoreCase = true)) &&
                (a.from.isBlank() || item.title.contains(a.from.trim(), ignoreCase = true))
        }.take(15)
        val list = JSONArray()
        items.forEach { item ->
            list.put(JSObject().apply {
                put("app", item.app)
                put("title", item.title)
                put("text", item.text.take(400))
                put("time", item.postTime)
            })
        }
        res(true, if (items.isEmpty()) "No notifications." else "${items.size} notifications.").apply { put("items", list) }
    }
}
