package com.jarvis.phone

import android.app.Activity
import android.app.ActivityManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.media.AudioManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.AlarmClock
import android.provider.CalendarContract
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.webkit.WebView
import android.widget.TextView
import androidx.activity.result.ActivityResult
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.documentfile.provider.DocumentFile
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.BufferedReader
import java.io.FileReader
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

@InvokeArg
internal class TapArgs {
    var index: Int = -1
    var observationGeneration: Long = -1L
    var selector: String = ""
    var expectedApp: String = ""
    var windowId: Int = -1
}

@InvokeArg
internal class TapXyArgs {
    var x: Int = 0
    var y: Int = 0
    var observationGeneration: Long = -1L
    var expectedApp: String = ""
}

@InvokeArg
internal class SetTextArgs {
    var index: Int = -1
    var text: String = ""
    var observationGeneration: Long = -1L
    var selector: String = ""
    var expectedApp: String = ""
    var windowId: Int = -1
}

@InvokeArg
internal class TypeTextArgs {
    var text: String = ""
    var index: Int = -1
    var observationGeneration: Long = -1L
    var selector: String = ""
    var expectedApp: String = ""
    var windowId: Int = -1
}

@InvokeArg
internal class ScrollArgs {
    var direction: String = "down"
}

@InvokeArg
internal class OpenAppArgs {
    var name: String = ""
}

@InvokeArg
internal class OpenUrlArgs {
    var url: String = ""
}

@InvokeArg
internal class VolumeArgs {
    var level: Int = 50
}

@InvokeArg
internal class SystemSettingsArgs {
    var target: String = ""
}

@InvokeArg
internal class CloseAppArgs {
    var name: String = ""
}

@InvokeArg
internal class SpeakArgs {
    var text: String = ""
}

@InvokeArg
internal class SwipeArgs {
    var startX: Int = 0
    var startY: Int = 0
    var endX: Int = 0
    var endY: Int = 0
    var duration: Long = 250
    var observationGeneration: Long = -1L
    var expectedApp: String = ""
}

@InvokeArg
internal class TaskBeginArgs {
    var taskId: String = ""
    var idempotencyKey: String = ""
    var goal: String = ""
    var deadlineAtMs: Long = 0L
    var risk: String = "R1"
    var sourceDeviceId: String = ""
    var capabilityProfileJson: String = ""
    var retryBudget: Int = 3
    var typedPlanJson: String = ""
}

@InvokeArg
internal class TaskCheckpointArgs {
    var taskId: String = ""
    var state: String = "executing"
    var step: Int = 0
    var receipt: String = ""
    var verifiedCheckpoint: String = ""
}

@InvokeArg
internal class TaskFinishArgs {
    var taskId: String = ""
    var state: String = "failed"
    var result: String = ""
    var verificationReceipt: String = ""
}

@InvokeArg
internal class TaskIdArgs {
    var taskId: String = ""
}

@InvokeArg
internal class OperatorStartArgs {
    var taskId: String = ""
    var goal: String = ""
    /** The user approved an R2 (external side effect) goal up front. */
    var consent: Boolean = false
    /** Resolved model routes from the brain; see NativeOperator.RouteSpec. */
    var routesJson: String = ""
    /** The user wants to end up in the driven app (media, an open chat) — don't
     *  bring JARVIS back on success. */
    var stayInApp: Boolean = false
}

@InvokeArg
internal class OperatorStatusArgs {
    var taskId: String = ""
    /** Step lines already delivered; only newer ones are returned. */
    var since: Int = 0
}

@InvokeArg
internal class ConfigSecretNameArgs {
    var name: String = ""
}

@InvokeArg
internal class ConfigSecretSetArgs {
    var name: String = ""
    var value: String = ""
}

@InvokeArg
internal class IdentityAuthArgs {
    var hostId: String = ""
    var nonce: String = ""
}

@InvokeArg
internal class IdentityEnvelopeArgs {
    var connectionNonce: String = ""
    var messageType: String = ""
    var taskId: String = ""
    var payloadDigest: String = ""
}

@InvokeArg
internal class IdentityPairingArgs {
    var hostId: String = ""
    var challengeId: String = ""
    var connectionNonce: String = ""
    var deviceName: String = "Aura phone"
}

@InvokeArg
internal class IdentityVerifyHostChallengeArgs {
    var publicKey: String = ""
    var expectedFingerprint: String = ""
    var hostId: String = ""
    var nonce: String = ""
    var expiresAt: Long = 0L
    var connectionId: String = ""
    var signature: String = ""
}

@InvokeArg
internal class IdentityVerifyHostEnvelopeArgs {
    var publicKey: String = ""
    var expectedFingerprint: String = ""
    var hostId: String = ""
    var connectionNonce: String = ""
    var counter: Long = 0L
    var messageType: String = ""
    var taskId: String = ""
    var payloadDigest: String = ""
    var signature: String = ""
}

@InvokeArg
internal class FileOpArgs {
    var uri: String = ""
    var path: String = ""
}

@InvokeArg
internal class CalendarArgs {
    /** add | remove | show */
    var action: String = ""
    var title: String = ""
    var notes: String = ""
    var startMillis: Long = 0
    var endMillis: Long = 0
    /** Event id returned by a previous `add`, for `remove`. */
    var eventId: Long = 0
}

@InvokeArg
internal class ClockArgs {
    /** alarm | timer | show_alarms | show_timers | dismiss_timer */
    var action: String = ""
    var label: String = ""
    var hour: Int = -1
    var minute: Int = 0
    /** Timer length in seconds. */
    var seconds: Int = 0
    /** Repeat days for an alarm: "daily", "weekdays", "weekends", or "mon,wed,fri". */
    var days: String = ""
}

/** Boundary validation for durable journal content.
 *
 * Room intentionally has no screenshot/blob/evidence-text column. Structured values
 * are parsed and scanned again natively so a compromised WebView cannot smuggle a
 * credential, OTP, bearer, cookie or base64 screenshot into a JSON-shaped field.
 */
internal object TaskJournalPayloadPolicy {
    private val opaqueId = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
    private val secretAssignment = Regex(
        // Raw strings take ONE backslash: this used to say `\\b`, a literal backslash,
        // so the filter never matched anything (fixed 2026-09-25).
        """(?i)\b(password|passwd|passcode|otp|one[-_ ]?time[-_ ]?password|secret|""" +
            """api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|authorization|cookie)""" +
            """\b\s*[:=]\s*\S+""",
    )
    private val dataImage = Regex("(?i)data:image/[^;]+;base64,")
    private val longBase64 = Regex("(?i)(?:[A-Za-z0-9+/]{256,}={0,2})")
    private val forbiddenKeys = setOf(
        "password", "passwd", "passcode", "otp", "onetimepassword", "secret",
        "apikey", "accesstoken", "refreshtoken", "authtoken", "authorization",
        "cookie", "cookies", "screenshot", "screenshotbase64", "image", "imagebase64",
        "base64", "clipboard",
    )

    fun safeId(value: String): String? = value.trim().takeIf { opaqueId.matches(it) }

    fun safeRisk(value: String): String? = value.trim().takeIf {
        it in setOf("R0", "R1", "R2", "R3")
    }

    fun safeText(value: String, maxChars: Int, allowEmpty: Boolean = true): String? {
        val text = value.trim()
        if (!allowEmpty && text.isEmpty()) return null
        if (text.length > maxChars) return null
        if (dataImage.containsMatchIn(text) || longBase64.containsMatchIn(text)) return null
        if (secretAssignment.containsMatchIn(text)) return null
        return text
    }

    fun capabilityProfile(raw: String): String? {
        val normalized = safeJson(raw, DEFAULT_CAPABILITY_PROFILE_JSON, 16_000) ?: return null
        val root = runCatching { JSONObject(normalized) }.getOrNull() ?: return null
        if (!root.has("version") || root.optJSONArray("capabilities") == null) return null
        return normalized
    }

    fun typedPlan(raw: String): String? {
        val normalized = safeJson(raw, DEFAULT_TYPED_PLAN_JSON, 64_000) ?: return null
        val root = runCatching { JSONObject(normalized) }.getOrNull() ?: return null
        if (!root.has("version") || root.optJSONArray("steps") == null) return null
        return normalized
    }

    fun verifiedCheckpoint(raw: String): String? {
        if (raw.isBlank()) return ""
        val normalized = safeJson(raw, "", 8_000) ?: return null
        val root = runCatching { JSONObject(normalized) }.getOrNull() ?: return null
        if (!root.has("version") || root.optString("kind").isBlank()) return null
        return normalized
    }

    private fun safeJson(raw: String, fallback: String, maxChars: Int): String? {
        val text = raw.trim().ifEmpty { fallback }
        if (text.isEmpty() || text.length > maxChars) return null
        val value = runCatching { JSONTokener(text).nextValue() }.getOrNull() ?: return null
        if (value !is JSONObject || unsafeJson(value)) return null
        return value.toString()
    }

    private fun unsafeJson(value: Any?): Boolean = when (value) {
        is JSONObject -> {
            val keys = value.keys()
            var unsafe = false
            while (keys.hasNext() && !unsafe) {
                val key = keys.next()
                val normalizedKey = key.lowercase(Locale.ROOT).replace(Regex("[^a-z0-9]"), "")
                unsafe = normalizedKey in forbiddenKeys || unsafeJson(value.opt(key))
            }
            unsafe
        }
        is JSONArray -> (0 until value.length()).any { unsafeJson(value.opt(it)) }
        is String -> dataImage.containsMatchIn(value) || longBase64.containsMatchIn(value) ||
            secretAssignment.containsMatchIn(value)
        else -> false
    }
}

/**
 * The Tauri bridge to the accessibility service. Each @Command maps to a JS
 * `invoke("plugin:phone|<command>")` call. Methods are named to match the camelCase
 * names the Rust mobile layer forwards (run_mobile_plugin("isEnabled", …) etc.).
 */
@TauriPlugin
class PhonePlugin(private val activity: Activity) : Plugin(activity) {

    companion object {
        const val REMINDER_CHANNEL_ID = "jarvis_reminders"
        private val VERIFICATION_RECEIPT =
            Regex("^aura\\.verify\\.v1:(model|deterministic):[a-f0-9]{64}$")
    }

    private val autonomyScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val autonomyDao by lazy { AutonomyTaskDatabase.get(activity).tasks() }
    private val deviceIdentity by lazy { DeviceIdentityManager(activity.applicationContext) }
    private val secureSecrets by lazy { SecureSecretStore(activity.applicationContext) }

    override fun load(webView: WebView) {
        super.load(webView)
        createReminderChannel()
        requestNotificationPermission()
        AutonomyRecoveryWorker.enqueue(activity)
        // ~3s of loadLabel calls, paid now in the background instead of by the first task.
        Thread({ LauncherApps.all(activity.applicationContext) }, "launcher-apps-warmup").start()
    }

    /** Android 13+ drops notify() SILENTLY without this runtime grant — declaring it in
     *  the manifest is not enough. It was never requested, so phone-task results and
     *  reminders never showed (found 2026-09-23: granted=false, no log, no exception). */
    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val perm = android.Manifest.permission.POST_NOTIFICATIONS
        if (androidx.core.content.ContextCompat.checkSelfPermission(activity, perm) !=
            android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            androidx.core.app.ActivityCompat.requestPermissions(activity, arrayOf(perm), 102)
        }
    }

    private fun createReminderChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channel = NotificationChannel(
                REMINDER_CHANNEL_ID,
                "JARVIS Reminders",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply { description = "Reminders and timers you asked JARVIS to set." }
            nm.createNotificationChannel(channel)
        }
    }

    private fun service(): JarvisAccessibilityService? = JarvisAccessibilityService.instance

    // ── Native text-to-speech ───────────────────────────────────────────────────
    // Android System WebView does NOT implement window.speechSynthesis, so the JS
    // TTS is a no-op on-device. We speak through the platform TextToSpeech engine
    // (Google/Samsung TTS) instead. Initialised lazily; the first utterance queues
    // until the engine reports ready.
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var pendingSpeak: String? = null

    // True while an utterance is actually sounding. The engine has no
    // language-agnostic "duration" API, so JS previously held its "speaking" HUD
    // state (and the stop-until-done button) for an ESTIMATED duration instead of
    // real completion — on longer replies the estimate ran out early and the STOP
    // control vanished while JARVIS was still audibly talking. UtteranceProgressListener
    // gives the real start/end, polled by JS the same reliable way wake-word
    // detections are (pollSpeaking below) rather than the flaky Tauri event bridge.
    @Volatile
    private var speaking = false

    // Rolling /proc/stat sample for CPU % (needs two reads).
    private var lastCpuIdle = 0L
    private var lastCpuTotal = 0L
    private var lastCpuPct = 0

    // ── On-device wake word (openWakeWord — same family as desktop Python backend) ──
    // Runs in WakeWordService (a foreground service), NOT held directly here — a plain
    // object tied to this plugin/Activity died the instant the screen locked or the
    // app left the foreground (Android revokes mic access from backgrounded apps
    // outright unless a foreground service with the "microphone" type is holding it).

    private fun ensureTts() {
        if (tts != null) return
        tts = TextToSpeech(activity) { status ->
            if (status == TextToSpeech.SUCCESS) {
                ttsReady = true
                configureTtsVoice()
                pendingSpeak?.let { speakNow(it) }
                pendingSpeak = null
            }
        }
        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {
                speaking = true
            }

            override fun onDone(utteranceId: String?) {
                speaking = false
            }

            @Deprecated("Deprecated in Java", ReplaceWith(""))
            override fun onError(utteranceId: String?) {
                speaking = false
            }

            override fun onError(utteranceId: String?, errorCode: Int) {
                speaking = false
            }
        })
    }

    /** Calmer, lower-pitched British male voice — closer to desktop JARVIS. */
    private fun configureTtsVoice() {
        val engine = tts ?: return
        try {
            engine.language = Locale.UK
            engine.setSpeechRate(0.92f)
            engine.setPitch(0.86f)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                val voices = engine.voices ?: return
                val en = voices.filter { v ->
                    val lang = v.locale?.language ?: ""
                    lang == "en" || lang.startsWith("en")
                }
                val pool = if (en.isNotEmpty()) en else voices.toList()
                val picked = pool.firstOrNull { v ->
                    val n = v.name.lowercase()
                    (n.contains("male") || n.contains("daniel") || n.contains("david") || n.contains("ryan"))
                        && !n.contains("female")
                } ?: pool.firstOrNull { v ->
                    val n = v.name.lowercase()
                    n.contains("network") || n.contains("neural") || n.contains("enhanced")
                } ?: pool.firstOrNull { v ->
                    (v.locale?.country ?: "").equals("GB", ignoreCase = true)
                } ?: pool.firstOrNull()
                if (picked != null) engine.voice = picked
            }
        } catch (_: Exception) {
        }
    }

    private fun speakNow(text: String) {
        // QUEUE_FLUSH so a fresh reply (or a rapid double-greeting) replaces the last.
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "jarvis")
    }

    @Command
    fun speak(invoke: Invoke) {
        val args = invoke.parseArgs(SpeakArgs::class.java)
        val text = args.text.trim()
        if (text.isEmpty()) {
            invoke.resolve(result(true, "nothing to say"))
            return
        }
        ensureTts()
        if (ttsReady) speakNow(text) else pendingSpeak = text
        invoke.resolve(result(true, "speaking"))
    }

    @Command
    fun stopSpeaking(invoke: Invoke) {
        pendingSpeak = null
        speaking = false
        try {
            tts?.stop()
        } catch (_: Exception) {
        }
        invoke.resolve(result(true, "stopped"))
    }

    /** Polled by JS (same reliable request/response pattern as pollWakeWord) so the
     *  "speaking" HUD state — and anything gated on it, like the phone-control STOP
     *  banner — tracks real TTS completion instead of an estimated duration. */
    @Command
    fun pollSpeaking(invoke: Invoke) {
        invoke.resolve(JSObject().apply { put("speaking", speaking) })
    }

    @Command
    fun startWakeWord(invoke: Invoke) {
        if (androidx.core.content.ContextCompat.checkSelfPermission(activity, android.Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            androidx.core.app.ActivityCompat.requestPermissions(activity, arrayOf(android.Manifest.permission.RECORD_AUDIO), 101)
            invoke.resolve(result(false, "Microphone permission required. Please grant it and try again."))
            return
        }

        // (Re)bind the detection callback on EVERY call — including the "already
        // listening" path below. The WebView reloads several times at startup, and each
        // reload replaces the JS "wake-detected" listener with a fresh one; if we only
        // bound this on the first (soon-discarded) page context, detections would fire
        // natively but never reach the live page. `trigger`/`hasListener` resolve against
        // this Activity-scoped plugin's CURRENT listener registry, so rebinding here keeps
        // the event routed to whatever context is live now. We trigger unconditionally
        // (no hasListener gate — a stale/dead channel just no-ops) so a mis-reported
        // hasListener can't silently swallow the wake. Set BEFORE launch() since
        // startForegroundService() returns before the first detection can race in.
        WakeWordService.onDetected = {
            android.util.Log.i("JarvisWW", "wake-detected → JS (hasListener=${hasListener("wake-detected")})")
            trigger("wake-detected", JSObject())
        }

        if (WakeWordService.isListening) {
            invoke.resolve(result(true, "already listening for Hey Jarvis"))
            return
        }

        // Resolve from a CALLBACK the service fires once it actually knows success/
        // failure — NOT by blocking this thread waiting for it. Service lifecycle
        // callbacks (onCreate/onStartCommand) run on the main thread; an earlier
        // version of this polled with Thread.sleep() here, which — if this @Command
        // handler ALSO runs on the main thread — deadlocks outright: the service can
        // never reach onCreate() while the thread it needs is asleep waiting for
        // onCreate() to have already happened. Confirmed live: that version silently
        // failed every single time (no native log line even reached, so the JS retry
        // never had a chance).
        val resolved = java.util.concurrent.atomic.AtomicBoolean(false)
        val handler = android.os.Handler(android.os.Looper.getMainLooper())
        fun finish(ok: Boolean, reason: String?) {
            if (!resolved.compareAndSet(false, true)) return
            if (ok) {
                invoke.resolve(result(true, "listening for Hey Jarvis"))
                return
            }
            // Only blame "microphone access" when the failure actually looks like a
            // permission/hardware access problem — the OS permission check above
            // already passed, so a generic engine/asset failure calling this a
            // permission issue every time was misleading (and reported wrongly on
            // every launch even for users who'd already granted the mic).
            val looksLikePermission = reason != null &&
                Regex("permission|denied|securityexception|audiorecord", RegexOption.IGNORE_CASE)
                    .containsMatchIn(reason)
            val summary = when {
                looksLikePermission -> "Could not start wake word — allow microphone access for JARVIS."
                reason != null -> "Could not start wake word: $reason"
                else -> "Could not start wake word."
            }
            invoke.resolve(result(false, summary))
        }
        WakeWordService.onStartResult = { ok, reason -> handler.post { finish(ok, reason) } }
        // Safety net: if onStartResult somehow never fires (an unexpected service
        // failure before onStartCommand runs), don't leave the JS promise hanging.
        handler.postDelayed({ finish(false, WakeWordService.lastError) }, 3000)

        WakeWordService.launch(activity.applicationContext)
    }

    @Command
    fun stopWakeWord(invoke: Invoke) {
        WakeWordService.onDetected = null
        WakeWordService.shutdown(activity.applicationContext)
        invoke.resolve(result(true, "wake word stopped"))
    }

    /** Reliable, poll-based delivery of wake detections + engine liveness. The JS wake
     *  listener polls this ~3×/s instead of relying on the Tauri event/Channel bridge,
     *  which drops callbacks on this device during the WebView's startup reloads (so
     *  `trigger("wake-detected")` never reached the live page). `seq` is a monotonic
     *  detection counter; `listening` lets JS restart the engine if it ever dies. */
    @Command
    fun pollWakeWord(invoke: Invoke) {
        val res = JSObject()
        res.put("seq", WakeWordService.wakeSeq.get())
        res.put("listening", WakeWordService.isListening)
        invoke.resolve(res)
    }

    // ── Cross-app floating STOP overlay ──────────────────────────────────────────
    // JS shows/hides this whenever a phone_task is running or JARVIS is speaking
    // (mirrors the in-app banner's own condition) so there's an escape hatch even
    // while some OTHER app is in the foreground and the JARVIS HUD itself isn't
    // on screen to show its own banner.

    // The cross-app STOP can be drawn two ways. When the accessibility service is
    // running (phone-control users) it draws a TYPE_ACCESSIBILITY_OVERLAY for free —
    // no extra permission. Voice-only users never enable accessibility, so the
    // overlay used to silently no-op for them (the reported "STOP only shows on the
    // JARVIS screen" bug — only the in-app React banner remained). For that case we
    // fall back to a TYPE_APPLICATION_OVERLAY, which needs the "draw over other apps"
    // (SYSTEM_ALERT_WINDOW) grant. Both paths feed the SAME stopTapSeq counter, so
    // pollStopOverlay below is unchanged regardless of which one is showing.
    private var appOverlayView: View? = null

    private fun canDrawOverlays(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(activity)

    /** Draw the STOP button as an app overlay (no accessibility service). Returns
     *  false if the "draw over other apps" permission hasn't been granted. */
    private fun showAppStopOverlay(): Boolean {
        if (!canDrawOverlays()) return false
        if (appOverlayView != null) return true
        return try {
            val ctx = activity.applicationContext
            fun dp(v: Int) = TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), ctx.resources.displayMetrics).toInt()
            val size = dp(48)
            val view = TextView(ctx).apply {
                text = "⏹"  // ⏹
                setTextColor(Color.WHITE)
                textSize = 18f
                gravity = Gravity.CENTER
                background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(Color.parseColor("#E5384D"))
                }
                elevation = dp(6).toFloat()
                setOnClickListener {
                    // Same counter the a11y overlay bumps → JS poll reacts identically.
                    JarvisAccessibilityService.stopTapSeq.incrementAndGet()
                    isEnabled = false
                    alpha = 0.5f
                }
            }
            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else
                @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
            val params = WindowManager.LayoutParams(
                size, size, type,
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT,
            ).apply {
                gravity = Gravity.TOP or Gravity.END
                x = dp(8)
                y = dp(160)
            }
            val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            wm.addView(view, params)
            appOverlayView = view
            true
        } catch (e: Exception) {
            android.util.Log.w("JarvisA11y", "showAppStopOverlay failed: ${e.message}")
            false
        }
    }

    private fun hideAppStopOverlay() {
        val view = appOverlayView ?: return
        appOverlayView = null
        try {
            val wm = activity.applicationContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            wm.removeView(view)
        } catch (_: Exception) {
        }
    }

    @Command
    fun showStopOverlay(invoke: Invoke) {
        // Prefer the accessibility overlay (free, no permission). Fall back to an app
        // overlay so the STOP still appears over other apps for voice-only users.
        val svc = service()
        if (svc != null) {
            svc.showStopOverlay()
            invoke.resolve(result(true, "overlay shown (accessibility)"))
            return
        }
        if (showAppStopOverlay()) {
            invoke.resolve(result(true, "overlay shown (app)"))
            return
        }
        // Neither path is available → tell JS a permission is needed so it can ask.
        invoke.resolve(JSObject().apply {
            put("ok", false)
            put("needsPermission", true)
            put("summary", "Allow “draw over other apps” so the STOP button can show while you're in another app.")
        })
    }

    @Command
    fun hideStopOverlay(invoke: Invoke) {
        service()?.hideStopOverlay()
        hideAppStopOverlay()
        invoke.resolve(result(true, "overlay hidden"))
    }

    /** Polled by JS (same pattern as pollWakeWord) while the overlay is visible. */
    @Command
    fun pollStopOverlay(invoke: Invoke) {
        invoke.resolve(JSObject().apply {
            put("seq", JarvisAccessibilityService.stopTapSeq.get())
        })
    }

    /** Open the system "draw over other apps" screen for JARVIS so the user can grant
     *  it. There's no runtime-prompt for SYSTEM_ALERT_WINDOW — it's a settings toggle. */
    @Command
    fun requestOverlayPermission(invoke: Invoke) {
        if (canDrawOverlays()) {
            invoke.resolve(result(true, "already granted"))
            return
        }
        try {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:${activity.packageName}"),
            ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
            activity.startActivity(intent)
            invoke.resolve(result(true, "settings opened"))
        } catch (e: Exception) {
            invoke.resolve(result(false, "Couldn't open the overlay-permission screen: ${e.message}"))
        }
    }

    override fun onDestroy() {
        // Stop any in-flight speech when the app is closed/swiped away. Without this,
        // a reply already handed to the system TextToSpeech service keeps playing out
        // loud after the app is gone (the user had to force-stop to silence it) — the
        // utterance lives in the separate TTS process, not ours, so only an explicit
        // stop()/shutdown() ends it.
        try {
            tts?.stop()
            tts?.shutdown()
        } catch (_: Exception) {
        }
        tts = null
        ttsReady = false
        pendingSpeak = null
        speaking = false
        hideAppStopOverlay()  // don't leak the app-overlay window if we drew one
        autonomyScope.cancel()
        // Deliberately does NOT stop WakeWordService here — the whole point of a
        // foreground service is that "Hey Jarvis" keeps listening after the
        // Activity/plugin is gone (app backgrounded, screen locked). Only an
        // explicit stopWakeWord (the toggle) or the OS itself should end it.
        super.onDestroy()
    }

    /**
     * Live device stats for the HUD gauges (CPU/RAM/storage/battery). Every
     * section is independently guarded — this used to let a single subsystem
     * throw (e.g. an OEM quirk in BatteryManager/ActivityManager on a specific
     * device) take down the ENTIRE call before `invoke.resolve` ever ran, which
     * left the JS side's `fetchNativeStats()` seeing a permanent rejection and
     * every gauge frozen at its default forever ("dead dials") with no visible
     * error anywhere. Now a failing section just omits its fields; the rest of
     * the panel still updates.
     */
    @Command
    fun getDeviceStats(invoke: Invoke) {
        val out = JSObject()
        val ctx = activity.applicationContext

        // ── Battery ──
        try {
            val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
            val level = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
            if (level in 0..100) out.put("batteryPct", level)
            val filter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
            val status = ctx.registerReceiver(null, filter)
            val plugged = status?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0
            val charging = plugged != 0
            out.put("charging", charging)
            val tempTenth = status?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) ?: 0
            if (tempTenth > 0) out.put("temp", tempTenth / 10.0)
            // Time-to-full/empty isn't on all SDK levels — read sticky-broadcast extras when present.
            val remainSec = if (charging) {
                status?.getIntExtra("android.os.extra.CHARGING_TIME", -1) ?: -1
            } else {
                status?.getIntExtra("android.os.extra.DISCHARGING_TIME", -1) ?: -1
            }
            if (remainSec > 0) {
                val h = remainSec / 3600
                val m = (remainSec % 3600) / 60
                val t = if (h > 0) "${h}h ${m}m" else "${m}m"
                out.put("remaining", if (charging) "${t} to full" else "${t} left")
            }
        } catch (_: Exception) {
        }

        // ── RAM ──
        try {
            val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val mem = ActivityManager.MemoryInfo()
            am.getMemoryInfo(mem)
            val ramTotal = mem.totalMem
            val ramAvail = mem.availMem
            if (ramTotal > 0) {
                out.put("ramTotalGb", ramTotal / (1024.0 * 1024.0 * 1024.0))
                out.put("ram", ((ramTotal - ramAvail) * 100.0 / ramTotal).toInt().coerceIn(0, 100))
            }
        } catch (_: Exception) {
        }

        // ── Internal storage ──
        try {
            val stat = StatFs(Environment.getDataDirectory().absolutePath)
            val total = stat.totalBytes
            val free = stat.availableBytes
            if (total > 0) {
                out.put("diskTotalGb", total / (1024.0 * 1024.0 * 1024.0))
                out.put("diskUsedGb", (total - free) / (1024.0 * 1024.0 * 1024.0))
                out.put("disk", ((total - free) * 100.0 / total).toInt().coerceIn(0, 100))
            }
        } catch (_: Exception) {
        }

        // ── CPU (delta from /proc/stat) ──
        try {
            out.put("cpu", sampleCpu())
        } catch (_: Exception) {
        }

        invoke.resolve(out)
    }

    private fun result(ok: Boolean, summary: String): JSObject =
        JSObject().apply {
            put("ok", ok)
            put("summary", summary)
        }

    private fun actionResult(receipt: JarvisAccessibilityService.ActionReceipt): JSObject =
        JSObject().apply {
            put("ok", receipt.ok)
            put("summary", receipt.summary)
            put("code", receipt.code)
            put("generation", receipt.generation)
        }

    private fun targetReceipt(args: TapArgs) = JarvisAccessibilityService.TargetReceipt(
        index = args.index,
        generation = args.observationGeneration,
        selector = args.selector,
        expectedApp = args.expectedApp,
        windowId = args.windowId,
    )

    private fun targetReceipt(args: SetTextArgs) = JarvisAccessibilityService.TargetReceipt(
        index = args.index,
        generation = args.observationGeneration,
        selector = args.selector,
        expectedApp = args.expectedApp,
        windowId = args.windowId,
    )

    private fun targetReceipt(args: TypeTextArgs) = JarvisAccessibilityService.TargetReceipt(
        index = args.index,
        generation = args.observationGeneration,
        selector = args.selector,
        expectedApp = args.expectedApp,
        windowId = args.windowId,
    )

    private fun serviceOff() = result(false, "The JARVIS accessibility service isn't enabled.")

    private fun sampleCpu(): Int {
        return try {
            BufferedReader(FileReader("/proc/stat")).use { br ->
                val line = br.readLine() ?: return lastCpuPct
                val parts = line.split("\\s+".toRegex()).drop(1).take(7)
                if (parts.size < 4) return lastCpuPct
                val nums = parts.map { it.toLongOrNull() ?: 0L }
                val idle = nums[3]
                val total = nums.sum()
                val diffIdle = idle - lastCpuIdle
                val diffTotal = total - lastCpuTotal
                lastCpuIdle = idle
                lastCpuTotal = total
                if (diffTotal > 0) {
                    lastCpuPct = ((100.0 * (diffTotal - diffIdle) / diffTotal).toInt()).coerceIn(0, 100)
                }
                lastCpuPct
            }
        } catch (_: Exception) {
            lastCpuPct
        }
    }

    private fun identityFailure(summary: String) = JSObject().apply {
        put("ok", false)
        put("summary", summary)
    }

    @Command
    fun configSecretSet(invoke: Invoke) {
        val args = invoke.parseArgs(ConfigSecretSetArgs::class.java)
        autonomyScope.launch {
            try {
                secureSecrets.set(args.name, args.value)
                invoke.resolve(result(true, "Credential stored securely."))
            } catch (_: Exception) {
                invoke.resolve(result(false, "Credential could not be stored securely."))
            }
        }
    }

    @Command
    fun configSecretGet(invoke: Invoke) {
        val args = invoke.parseArgs(ConfigSecretNameArgs::class.java)
        autonomyScope.launch {
            try {
                val value = secureSecrets.get(args.name)
                invoke.resolve(JSObject().apply {
                    put("ok", true)
                    put("present", value != null)
                    if (value != null) put("value", value)
                    put(
                        "summary",
                        if (value != null) "Credential loaded securely."
                        else "Credential is not configured.",
                    )
                })
            } catch (_: Exception) {
                invoke.resolve(JSObject().apply {
                    put("ok", false)
                    put("present", false)
                    put("summary", "Credential could not be loaded securely.")
                })
            }
        }
    }

    @Command
    fun configSecretDelete(invoke: Invoke) {
        val args = invoke.parseArgs(ConfigSecretNameArgs::class.java)
        autonomyScope.launch {
            try {
                secureSecrets.delete(args.name)
                invoke.resolve(result(true, "Credential removed."))
            } catch (_: Exception) {
                invoke.resolve(result(false, "Credential could not be removed."))
            }
        }
    }

    @Command
    fun identityInfo(invoke: Invoke) {
        try {
            val info = deviceIdentity.info()
            invoke.resolve(JSObject().apply {
                put("ok", true)
                put("deviceId", info.deviceId)
                put("publicKey", info.publicKey)
                put("fingerprint", info.fingerprint)
            })
        } catch (_: Exception) {
            invoke.resolve(identityFailure("Android Keystore identity is unavailable."))
        }
    }

    @Command
    fun identitySignAuth(invoke: Invoke) {
        val args = invoke.parseArgs(IdentityAuthArgs::class.java)
        try {
            val signed = deviceIdentity.signAuth(args.hostId, args.nonce)
            invoke.resolve(JSObject().apply {
                put("ok", true)
                put("deviceId", signed.deviceId)
                put("counter", signed.counter)
                put("signature", signed.signature)
            })
        } catch (_: Exception) {
            invoke.resolve(identityFailure("Could not sign the PC authentication challenge."))
        }
    }

    @Command
    fun identitySignEnvelope(invoke: Invoke) {
        val args = invoke.parseArgs(IdentityEnvelopeArgs::class.java)
        try {
            val signed = deviceIdentity.signEnvelope(
                args.connectionNonce,
                args.messageType,
                args.taskId,
                args.payloadDigest,
            )
            invoke.resolve(JSObject().apply {
                put("ok", true)
                put("deviceId", signed.deviceId)
                put("counter", signed.counter)
                put("signature", signed.signature)
            })
        } catch (_: Exception) {
            invoke.resolve(identityFailure("Could not sign the remote protocol envelope."))
        }
    }

    @Command
    fun identitySignPairing(invoke: Invoke) {
        val args = invoke.parseArgs(IdentityPairingArgs::class.java)
        try {
            val signed = deviceIdentity.signPairing(
                args.hostId,
                args.challengeId,
                args.connectionNonce,
                args.deviceName,
            )
            invoke.resolve(JSObject().apply {
                put("ok", true)
                put("deviceId", signed.deviceId)
                put("publicKey", signed.publicKey)
                put("fingerprint", signed.fingerprint)
                put("deviceName", signed.deviceName)
                put("signature", signed.signature)
            })
        } catch (_: Exception) {
            invoke.resolve(identityFailure("Could not prove the phone identity for pairing."))
        }
    }

    @Command
    fun identityVerifyHostChallenge(invoke: Invoke) {
        val args = invoke.parseArgs(IdentityVerifyHostChallengeArgs::class.java)
        val verified = deviceIdentity.verifyHostChallenge(
            args.publicKey,
            args.expectedFingerprint,
            args.hostId,
            args.nonce,
            args.expiresAt,
            args.connectionId,
            args.signature,
        )
        invoke.resolve(JSObject().apply {
            put("ok", verified)
            put("verified", verified)
            put("summary", if (verified) "Host identity verified." else "Host identity verification failed.")
        })
    }

    @Command
    fun identityVerifyHostEnvelope(invoke: Invoke) {
        val args = invoke.parseArgs(IdentityVerifyHostEnvelopeArgs::class.java)
        val verified = deviceIdentity.verifyHostEnvelope(
            args.publicKey,
            args.expectedFingerprint,
            args.hostId,
            args.connectionNonce,
            args.counter,
            args.messageType,
            args.taskId,
            args.payloadDigest,
            args.signature,
        )
        invoke.resolve(JSObject().apply {
            put("ok", verified)
            put("verified", verified)
            put("summary", if (verified) "Host envelope verified." else "Host envelope verification failed.")
        })
    }

    @Command
    fun isEnabled(invoke: Invoke) {
        invoke.resolve(JSObject().apply { put("enabled", accessibilityEnabled()) })
    }

    @Command
    fun taskBegin(invoke: Invoke) {
        val args = invoke.parseArgs(TaskBeginArgs::class.java)
        val taskId = TaskJournalPayloadPolicy.safeId(args.taskId)
        val idempotencyKey = TaskJournalPayloadPolicy.safeId(
            args.idempotencyKey.ifBlank { args.taskId },
        )
        val goal = TaskJournalPayloadPolicy.safeText(args.goal, 2_000, allowEmpty = false)
        // Blank risk = classify here, with the same classifier the operator enforces,
        // rather than keeping a second copy of it in the brain.
        val risk = if (args.risk.isBlank()) classifyGoalRisk(goal.orEmpty())
        else TaskJournalPayloadPolicy.safeRisk(args.risk)
        val capabilityProfile = TaskJournalPayloadPolicy.capabilityProfile(
            args.capabilityProfileJson,
        )
        val typedPlan = TaskJournalPayloadPolicy.typedPlan(args.typedPlanJson)
        if (taskId == null || idempotencyKey == null || goal == null || risk == null) {
            invoke.resolve(result(false, "A valid task id, goal, idempotency key, and R0-R3 risk are required."))
            return
        }
        if (capabilityProfile == null || typedPlan == null) {
            invoke.resolve(result(false, "Task metadata was invalid or contained sensitive material."))
            return
        }
        if (args.deadlineAtMs <= System.currentTimeMillis()) {
            invoke.resolve(result(false, "The task deadline has already expired."))
            return
        }
        autonomyScope.launch {
            val nativeSourceDevice = deviceIdentity.info().deviceId
            if (
                args.sourceDeviceId.isNotBlank() &&
                args.sourceDeviceId.trim() != nativeSourceDevice
            ) {
                invoke.resolve(result(false, "The claimed task source did not match this device."))
                return@launch
            }
            val now = System.currentTimeMillis()
            val outcome = autonomyDao.begin(
                AutonomyTaskEntity(
                    taskId = taskId,
                    idempotencyKey = idempotencyKey,
                    goal = goal,
                    state = "planning",
                    risk = risk,
                    deadlineAtMs = args.deadlineAtMs,
                    sourceDeviceId = nativeSourceDevice,
                    capabilityProfileJson = capabilityProfile,
                    retryBudget = args.retryBudget.coerceIn(0, 10),
                    typedPlanJson = typedPlan,
                    createdAtMs = now,
                    updatedAtMs = now,
                ),
            )
            val accepted = outcome.task
            if (accepted == null || outcome.conflict.isNotBlank()) {
                invoke.resolve(
                    result(
                        false,
                        if (outcome.conflict == "idempotency_conflict") {
                            "That idempotency key belongs to a different immutable task specification."
                        } else {
                            "That task id conflicts with an existing durable task."
                        },
                    ),
                )
                return@launch
            }
            val terminal = accepted.state in setOf("succeeded", "failed", "cancelled") ||
                accepted.cancelRequested
            if (!terminal) {
                AutonomySupervisorService.start(activity, accepted.taskId)
            }
            invoke.resolve(JSObject().apply {
                put("ok", true)
                put(
                    "summary",
                    when {
                        outcome.created -> "Durable task accepted."
                        terminal -> "Existing terminal task returned idempotently."
                        else -> "Existing task resumed idempotently."
                    },
                )
                put("taskId", accepted.taskId)
                put("state", accepted.state)
                put("eventSeq", accepted.eventSeq)
                put("created", outcome.created)
                put("idempotent", !outcome.created)
                put("result", accepted.result)
                put("cancelRequested", accepted.cancelRequested)
                put(
                    "verified",
                    accepted.state == "succeeded" &&
                        accepted.verificationReceipt.isNotBlank() &&
                        accepted.verificationDigest.isNotBlank(),
                )
                put("verificationReceipt", accepted.verificationReceipt)
                put("verificationDigest", accepted.verificationDigest)
                put("verifiedAtMs", accepted.verifiedAtMs)
            })
        }
    }

    @Command
    fun taskCheckpoint(invoke: Invoke) {
        val args = invoke.parseArgs(TaskCheckpointArgs::class.java)
        val allowed = setOf("planning", "policy_check", "executing", "verifying", "suspended")
        if (args.taskId.isBlank() || args.state !in allowed) {
            invoke.resolve(result(false, "Invalid task checkpoint."))
            return
        }
        val receipt = TaskJournalPayloadPolicy.safeText(args.receipt, 800)
        val verifiedCheckpoint = TaskJournalPayloadPolicy.verifiedCheckpoint(
            args.verifiedCheckpoint,
        )
        if (receipt == null || verifiedCheckpoint == null) {
            invoke.resolve(result(false, "Checkpoint contained sensitive or malformed journal data."))
            return
        }
        autonomyScope.launch {
            val changed = autonomyDao.checkpoint(
                args.taskId,
                args.state,
                args.step.coerceAtLeast(0),
                receipt,
                System.currentTimeMillis(),
                verifiedCheckpoint,
            )
            invoke.resolve(result(changed == 1, if (changed == 1) "Checkpoint persisted." else "Task is missing or cancelled."))
        }
    }

    @Command
    fun taskFinish(invoke: Invoke) {
        val args = invoke.parseArgs(TaskFinishArgs::class.java)
        val allowed = setOf("succeeded", "failed", "suspended", "cancelled")
        if (args.taskId.isBlank() || args.state !in allowed) {
            invoke.resolve(result(false, "Invalid terminal task state."))
            return
        }
        val verificationReceipt = args.verificationReceipt.trim()
        if (args.state == "succeeded" && !VERIFICATION_RECEIPT.matches(verificationReceipt)) {
            invoke.resolve(result(false, "Success rejected: a valid verification receipt is required."))
            return
        }
        autonomyScope.launch {
            val accepted = finishJournalTask(
                activity,
                autonomyDao,
                args.taskId,
                args.state,
                args.result,
                verificationReceipt,
            )
            invoke.resolve(
                result(
                    accepted,
                    if (accepted) "Terminal result persisted."
                    else "Terminal transition rejected because the task is stale, cancelled, expired, or already terminal.",
                ),
            )
        }
    }

    @Command
    fun taskCancel(invoke: Invoke) {
        val args = invoke.parseArgs(TaskIdArgs::class.java)
        if (args.taskId.isBlank()) return invoke.resolve(result(false, "A task id is required."))
        service()?.cancelAllActions()
        autonomyScope.launch {
            val changed = autonomyDao.cancel(args.taskId, System.currentTimeMillis())
            if (changed == 1) AutonomySupervisorService.cancel(activity, args.taskId)
            invoke.resolve(
                result(
                    changed == 1,
                    if (changed == 1) "Task cancelled and actuator lease invalidated."
                    else "Cancellation rejected because the task is missing or already terminal.",
                ),
            )
        }
    }

    // ── Native operator ──────────────────────────────────────────────────────────
    // The whole phone_task loop runs natively (NativeOperator / OperatorCore) because
    // a hidden WebView is paused ~60s after JARVIS leaves the foreground. JS starts a
    // task and polls its progress; it never has to be awake for the task to finish.

    @Command
    fun operatorStart(invoke: Invoke) {
        val args = invoke.parseArgs(OperatorStartArgs::class.java)
        val taskId = TaskJournalPayloadPolicy.safeId(args.taskId)
        val goal = args.goal.trim()
        if (taskId == null || goal.isEmpty()) {
            invoke.resolve(result(false, "A task id and goal are required."))
            return
        }
        if (service() == null) {
            invoke.resolve(result(false, "The JARVIS accessibility service isn't enabled.").apply {
                put("error", "accessibility_disabled")
            })
            return
        }
        // Consent for an external side effect (send, share, post, call) has to be taken
        // NOW, while JARVIS is on screen — mid-task, its UI is behind the driven app.
        val risk = classifyGoalRisk(goal)
        if (risk == "R2" && !args.consent) {
            invoke.resolve(result(false, "This task has an external side effect and needs approval first.").apply {
                put("error", "needs_consent")
                put("needsConsent", true)
                put("risk", risk)
            })
            return
        }
        val routes = NativeOperator.parseRoutes(args.routesJson)
        if (routes.isEmpty()) {
            invoke.resolve(result(false, "No usable model route was supplied.").apply { put("error", "no_routes") })
            return
        }
        autonomyScope.launch {
            val row = autonomyDao.get(taskId)
            if (row == null || row.cancelRequested || row.state !in setOf("planning", "policy_check", "executing", "verifying")) {
                invoke.resolve(result(false, "The task journal has no active task $taskId.").apply { put("error", "task_journal_unavailable") })
                return@launch
            }
            val error = NativeOperator.start(
                activity, autonomyDao, taskId, goal, args.consent && risk == "R2", routes, args.stayInApp,
            )
            invoke.resolve(
                if (error == null) result(true, "Phone task started.")
                else result(false, error).apply { put("error", "operator_busy") },
            )
        }
    }

    @Command
    fun operatorStatus(invoke: Invoke) {
        val args = invoke.parseArgs(OperatorStatusArgs::class.java)
        invoke.resolve(JSObject(NativeOperator.status(args.taskId, args.since).toString()))
    }

    @Command
    fun taskStatus(invoke: Invoke) {
        val args = invoke.parseArgs(TaskIdArgs::class.java)
        autonomyScope.launch {
            val row = autonomyDao.get(args.taskId)
            if (row == null) {
                invoke.resolve(result(false, "Task not found."))
            } else {
                invoke.resolve(JSObject().apply {
                    put("ok", true)
                    put("summary", row.state)
                    put("taskId", row.taskId)
                    put("state", row.state)
                    put("step", row.step)
                    put("receipt", row.receipt)
                    put("result", row.result)
                    put("eventSeq", row.eventSeq)
                    put("idempotencyKey", row.idempotencyKey)
                    put("sourceDeviceId", row.sourceDeviceId)
                    put("capabilityProfileJson", row.capabilityProfileJson)
                    put("retryBudget", row.retryBudget)
                    put("retryCount", row.retryCount)
                    put("typedPlanJson", row.typedPlanJson)
                    put("lastVerifiedCheckpoint", row.lastVerifiedCheckpoint)
                    put("cancelRequested", row.cancelRequested)
                    put("verified", row.state == "succeeded" && row.verificationDigest.isNotBlank())
                    put("verificationReceipt", row.verificationReceipt)
                    put("verificationDigest", row.verificationDigest)
                    put("verifiedAtMs", row.verifiedAtMs)
                    put("updatedAtMs", row.updatedAtMs)
                    put("events", JSArray().apply {
                        autonomyDao.events(row.taskId, 0L, 200).forEach { event ->
                            put(JSObject().apply {
                                put("taskId", event.taskId)
                                put("seq", event.seq)
                                put("eventType", event.eventType)
                                put("state", event.state)
                                put("step", event.step)
                                put("checkpointJson", event.checkpointJson)
                                put("evidenceDigest", event.evidenceDigest)
                                put("createdAtMs", event.createdAtMs)
                            })
                        }
                    })
                })
            }
        }
    }

    /**
     * `service() != null` only reflects whether the OS has ALREADY bound our
     * accessibility service instance in this process — right after a cold app
     * launch (or if the system briefly rebinds it), that can lag a few hundred ms
     * behind the user's actual Settings toggle, which reported "please enable
     * accessibility" even when it was already granted. Fall back to reading the
     * system's own enabled-services list (the same source Settings ▸ Accessibility
     * itself reads from) so a merely-not-yet-bound service still counts as enabled.
     */
    private fun accessibilityEnabled(): Boolean {
        if (service() != null) return true
        val expected = "${activity.packageName}/${JarvisAccessibilityService::class.java.name}"
        val enabledList = Settings.Secure.getString(
            activity.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ) ?: return false
        return enabledList.split(':').any { it.equals(expected, ignoreCase = true) }
    }

    @Command
    fun observe(invoke: Invoke) {
        val out = JSObject()
        val svc = service()
        if (svc == null) {
            out.put("app", "")
            out.put("nodes", JSArray())
            out.put("ready", false)
            invoke.resolve(out)
            return
        }
        val snapshot = svc.snapshot()
        val arr = JSArray()
        for (n in snapshot.nodes) {
            val jn = JSObject()
            jn.put("index", n.index)
            jn.put("text", n.text)
            jn.put("description", n.description)
            jn.put("id", n.id)
            jn.put("role", n.role)
            jn.put("enabled", n.enabled)
            jn.put("focused", n.focused)
            jn.put("clickable", n.clickable)
            jn.put("editable", n.editable)
            jn.put("scrollable", n.scrollable)
            jn.put("checked", n.checked)
            jn.put("selected", n.selected)
            jn.put("password", n.password)
            jn.put("actions", JSArray().apply { n.actions.forEach { put(it) } })
            jn.put("windowId", n.windowId)
            jn.put("path", n.path)
            jn.put("collectionIndex", n.collectionIndex)
            jn.put("selector", n.selector)
            jn.put(
                "bounds",
                JSObject().apply {
                    put("x", n.bounds.left)
                    put("y", n.bounds.top)
                    put("w", n.bounds.width())
                    put("h", n.bounds.height())
                },
            )
            arr.put(jn)
        }
        out.put("app", snapshot.app)
        out.put("nodes", arr)
        out.put("ready", true)
        out.put("generation", snapshot.generation)
        out.put("windowId", snapshot.windowId)
        out.put("observedAtMs", snapshot.observedAtMs)
        invoke.resolve(out)
    }

    @Command
    fun tap(invoke: Invoke) {
        val svc = service() ?: return invoke.resolve(serviceOff())
        val args = invoke.parseArgs(TapArgs::class.java)
        svc.tapIndex(targetReceipt(args)) { invoke.resolve(actionResult(it)) }
    }

    @Command
    fun tapXy(invoke: Invoke) {
        val svc = service() ?: return invoke.resolve(serviceOff())
        val args = invoke.parseArgs(TapXyArgs::class.java)
        svc.tapXY(args.x, args.y, args.observationGeneration, args.expectedApp) {
            invoke.resolve(actionResult(it))
        }
    }

    @Command
    fun longPress(invoke: Invoke) {
        val svc = service() ?: return invoke.resolve(serviceOff())
        val args = invoke.parseArgs(TapArgs::class.java)
        svc.longPressIndex(targetReceipt(args)) { invoke.resolve(actionResult(it)) }
    }

    @Command
    fun doubleTap(invoke: Invoke) {
        val svc = service() ?: return invoke.resolve(serviceOff())
        val args = invoke.parseArgs(TapArgs::class.java)
        svc.doubleTapIndex(targetReceipt(args)) { invoke.resolve(actionResult(it)) }
    }

    @Command
    fun setText(invoke: Invoke) {
        val svc = service() ?: return invoke.resolve(serviceOff())
        val args = invoke.parseArgs(SetTextArgs::class.java)
        svc.setTextIndex(targetReceipt(args), args.text) { invoke.resolve(actionResult(it)) }
    }

    @Command
    fun typeText(invoke: Invoke) {
        val svc = service() ?: return invoke.resolve(serviceOff())
        val args = invoke.parseArgs(TypeTextArgs::class.java)
        svc.typeFocused(targetReceipt(args), args.text) { invoke.resolve(actionResult(it)) }
    }

    @Command
    fun scroll(invoke: Invoke) {
        val svc = service() ?: return invoke.resolve(serviceOff())
        val args = invoke.parseArgs(ScrollArgs::class.java)
        svc.scrollDir(args.direction) { invoke.resolve(actionResult(it)) }
    }

    @Command
    fun back(invoke: Invoke) {
        val svc = service() ?: return invoke.resolve(serviceOff())
        svc.goBack { invoke.resolve(actionResult(it)) }
    }

    @Command
    fun home(invoke: Invoke) {
        val svc = service() ?: return invoke.resolve(serviceOff())
        svc.goHome { invoke.resolve(actionResult(it)) }
    }

    @Command
    fun swipe(invoke: Invoke) {
        val svc = service() ?: return invoke.resolve(serviceOff())
        val args = invoke.parseArgs(SwipeArgs::class.java)
        svc.dispatchSwipe(
            args.startX,
            args.startY,
            args.endX,
            args.endY,
            args.duration,
            args.observationGeneration,
            args.expectedApp,
        ) { invoke.resolve(actionResult(it)) }
    }

    @Command
    fun captureScreenshot(invoke: Invoke) {
        val svc = service() ?: return invoke.resolve(serviceOff())
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.R) {
            invoke.resolve(result(false, "Screenshot requires Android 11+."))
            return
        }
        svc.captureScreenshotBase64 { base64 ->
            if (base64 == null) {
                invoke.resolve(result(false, "Failed to capture screenshot (null)."))
            } else {
                val out = JSObject()
                out.put("ok", true)
                out.put("base64", base64)
                invoke.resolve(out)
            }
        }
    }

    @Command
    fun openApp(invoke: Invoke) {
        val args = invoke.parseArgs(OpenAppArgs::class.java)
        if (service()?.isDeviceLocked() == true) {
            invoke.resolve(JSObject().apply {
                put("ok", false)
                put("summary", "The phone is locked; task suspended until unlock.")
                put("code", "device_locked")
            })
            return
        }
        val ok = launchApp(activity, args.name)
        invoke.resolve(result(ok, if (ok) "Opened ${args.name}." else "Couldn't find an app called ${args.name}."))
    }

    @Command
    fun openUrl(invoke: Invoke) {
        val args = invoke.parseArgs(OpenUrlArgs::class.java)
        var url = args.url.trim()
        if (url.isEmpty()) {
            invoke.resolve(result(false, "No URL given."))
            return
        }
        if (!url.contains("://")) url = "https://$url"
        // The URL is model-authored, and web pages the model read can steer it. Only
        // web links: a deep-link scheme (upi:, intent:, content:, an app's own) would
        // let injected text drive another app straight from open_website.
        val scheme = Uri.parse(url).scheme?.lowercase()
        if (scheme != "https" && scheme != "http") {
            invoke.resolve(result(false, "I only open web links (http/https), not $scheme: links."))
            return
        }
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(intent)
            invoke.resolve(result(true, "Opened $url."))
        } catch (_: Exception) {
            invoke.resolve(result(false, "Couldn't open that link."))
        }
    }

    @Command
    fun setVolume(invoke: Invoke) {
        val args = invoke.parseArgs(VolumeArgs::class.java)
        val am = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val level = args.level.coerceIn(0, 100)
        val vol = (level * max / 100.0).toInt().coerceIn(0, max)
        am.setStreamVolume(AudioManager.STREAM_MUSIC, vol, 0)
        invoke.resolve(result(true, "Media volume set to $level%."))
    }

    @Command
    fun readClipboard(invoke: Invoke) {
        val cm = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = cm.primaryClip
        if (clip == null || clip.itemCount == 0) {
            invoke.resolve(result(true, "Your clipboard is empty."))
            return
        }
        val text = clip.getItemAt(0).coerceToText(activity)?.toString()?.trim().orEmpty()
        invoke.resolve(
            result(
                text.isNotEmpty(),
                if (text.isNotEmpty()) text else "Your clipboard is empty.",
            ),
        )
    }

    @Command
    fun openSystemSettings(invoke: Invoke) {
        val args = invoke.parseArgs(SystemSettingsArgs::class.java)
        val target = args.target.trim().lowercase()
        val action = when {
            target.contains("wifi") -> Settings.ACTION_WIFI_SETTINGS
            target.contains("bluetooth") -> Settings.ACTION_BLUETOOTH_SETTINGS
            target.contains("battery") -> Settings.ACTION_BATTERY_SAVER_SETTINGS
            target.contains("location") -> Settings.ACTION_LOCATION_SOURCE_SETTINGS
            target.contains("sound") || target.contains("volume") -> Settings.ACTION_SOUND_SETTINGS
            target.contains("accessibility") -> Settings.ACTION_ACCESSIBILITY_SETTINGS
            else -> Settings.ACTION_SETTINGS
        }
        try {
            val intent = Intent(action).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
            activity.startActivity(intent)
            invoke.resolve(result(true, "Opened ${target.ifEmpty { "system" }} settings."))
        } catch (_: Exception) {
            invoke.resolve(result(false, "Couldn't open settings."))
        }
    }

    @Command
    fun closeApp(invoke: Invoke) {
        // Without kill permissions we send the user home — honest partial close.
        val args = invoke.parseArgs(CloseAppArgs::class.java)
        val name = args.name.trim()
        val intent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        activity.startActivity(intent)
        invoke.resolve(
            result(
                true,
                if (name.isEmpty()) "Went to the home screen."
                else "Left $name — switched to the home screen.",
            ),
        )
    }

    @Command
    fun openAccessibilitySettings(invoke: Invoke) {
        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        activity.startActivity(intent)
        invoke.resolve(result(true, "Opened Accessibility settings."))
    }

    // ── Read-only file access (Storage Access Framework) ────────────────────────
    // Scoped to ONE user-granted folder tree at a time — no broad filesystem access.
    // The JS side persists the returned tree `uri` and passes it back on every
    // read_file/list_directory call; nothing here is stored natively.

    @Command
    fun pickFolder(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        startActivityForResult(invoke, intent, "pickFolderResult")
    }

    @ActivityCallback
    private fun pickFolderResult(invoke: Invoke, activityResult: ActivityResult) {
        val uri = activityResult.data?.data
        if (activityResult.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.resolve(result(false, "No folder was chosen."))
            return
        }
        try {
            activity.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (_: Exception) {
        }
        val name = DocumentFile.fromTreeUri(activity, uri)?.name ?: uri.lastPathSegment ?: "folder"
        val out = result(true, "Granted read access to \"$name\".")
        out.put("uri", uri.toString())
        out.put("name", name)
        invoke.resolve(out)
    }

    /** Walk from the granted tree root through `/`-separated path segments. */
    private fun resolveDoc(treeUri: Uri, path: String): DocumentFile? {
        var doc: DocumentFile? = DocumentFile.fromTreeUri(activity, treeUri) ?: return null
        for (seg in path.split("/").filter { it.isNotBlank() }) {
            doc = doc?.listFiles()?.firstOrNull { it.name == seg }
            if (doc == null) return null
        }
        return doc
    }

    @Command
    fun listDirectory(invoke: Invoke) {
        val args = invoke.parseArgs(FileOpArgs::class.java)
        if (args.uri.isBlank()) {
            invoke.resolve(result(false, "No folder has been granted yet — choose one in Settings."))
            return
        }
        val treeUri = Uri.parse(args.uri)
        val dir = resolveDoc(treeUri, args.path)
        if (dir == null || !dir.isDirectory) {
            invoke.resolve(result(false, "Couldn't find that folder."))
            return
        }
        val children = dir.listFiles()
        val entries = JSArray()
        for (c in children) {
            entries.put(
                JSObject().apply {
                    put("name", c.name ?: "")
                    put("isDir", c.isDirectory)
                },
            )
        }
        val out = result(true, if (children.isEmpty()) "This folder is empty." else "Found ${children.size} item(s).")
        out.put("entries", entries)
        invoke.resolve(out)
    }

    @Command
    fun readFile(invoke: Invoke) {
        val args = invoke.parseArgs(FileOpArgs::class.java)
        if (args.uri.isBlank()) {
            invoke.resolve(result(false, "No folder has been granted yet — choose one in Settings."))
            return
        }
        val treeUri = Uri.parse(args.uri)
        val file = resolveDoc(treeUri, args.path)
        if (file == null || file.isDirectory) {
            invoke.resolve(result(false, "Couldn't find that file."))
            return
        }
        val maxBytes = 200_000
        if (file.length() > maxBytes) {
            invoke.resolve(result(false, "That file is too large to read here (over ${maxBytes / 1000} KB)."))
            return
        }
        try {
            val text = activity.contentResolver.openInputStream(file.uri)?.use {
                it.readBytes().toString(Charsets.UTF_8)
            }
            if (text == null) {
                invoke.resolve(result(false, "Couldn't open that file."))
                return
            }
            val out = result(true, "Read ${file.name}.")
            out.put("content", text)
            invoke.resolve(out)
        } catch (_: Exception) {
            invoke.resolve(result(false, "Couldn't read that file as text — it may be binary."))
        }
    }

    // ── Clock: alarms and timers in the user's REAL Clock app ───────────────────
    // Everything time-based goes through android.provider.AlarmClock, which hands
    // the request to whichever Clock app the user actually uses. Deliberately NOT
    // an in-app AlarmManager alarm: those live and die with this process, don't
    // appear anywhere the user can see or edit them, and are silently lost on
    // reboot. And deliberately NOT the accessibility operator either — these are
    // documented public intents, so there's no screen-driving to go wrong.
    //
    // EXTRA_SKIP_UI asks the Clock to set it without coming to the foreground. Most
    // Clock apps honour it; the ones that don't will show their own UI, which is
    // the correct fallback rather than a failure.

    private fun calendarDays(spec: String): ArrayList<Int> {
        val days = ArrayList<Int>()
        val s = spec.trim().lowercase()
        if (s.isEmpty()) return days
        val byName = mapOf(
            "mon" to Calendar.MONDAY, "tue" to Calendar.TUESDAY, "wed" to Calendar.WEDNESDAY,
            "thu" to Calendar.THURSDAY, "fri" to Calendar.FRIDAY, "sat" to Calendar.SATURDAY,
            "sun" to Calendar.SUNDAY,
        )
        when (s) {
            "daily", "everyday", "every day" -> days.addAll(byName.values)
            "weekdays" -> days.addAll(listOf(Calendar.MONDAY, Calendar.TUESDAY, Calendar.WEDNESDAY, Calendar.THURSDAY, Calendar.FRIDAY))
            "weekends" -> days.addAll(listOf(Calendar.SATURDAY, Calendar.SUNDAY))
            else -> for (part in s.split(",")) {
                val key = part.trim().take(3)
                byName[key]?.let { if (!days.contains(it)) days.add(it) }
            }
        }
        return days
    }

    /** Fire a Clock intent, or report honestly that no Clock app accepted it.
     *
     * ponytail: Android 10+ blocks background activity starts silently (no throw),
     * so a wake-word request made while JARVIS is backgrounded could no-op. In
     * practice the SYSTEM_ALERT_WINDOW grant this app already asks for exempts it.
     * If that turns out not to hold on some OEM, the upgrade path is a foreground
     * service or a notification the user taps — not a retry loop here. */
    private fun startClockIntent(intent: Intent, okMessage: String): JSObject {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (intent.resolveActivity(activity.packageManager) == null) {
            return result(false, "I couldn't find a clock app on this phone that handles that.")
        }
        return try {
            activity.startActivity(intent)
            result(true, okMessage)
        } catch (exc: Exception) {
            result(false, "The clock app wouldn't accept that: ${exc.message}")
        }
    }

    // ── Calendar: agenda items in the user's REAL calendar ──────────────────────
    // Same reasoning as the Clock above: an entry the user can only see inside
    // JARVIS isn't on their calendar in any sense that matters. Writes go through
    // CalendarContract so they land silently in whatever calendar they actually
    // use, and sync to every other device that calendar is signed into.
    //
    // Permission is asked for, never assumed: with WRITE_CALENDAR we insert
    // directly; without it we fall back to ACTION_INSERT, which needs no
    // permission and opens the calendar's own prefilled new-event screen. That
    // fallback is a real answer, not a failure — the user still gets the event.

    private fun hasCalendarWrite(): Boolean =
        ContextCompat.checkSelfPermission(activity, android.Manifest.permission.WRITE_CALENDAR) ==
            PackageManager.PERMISSION_GRANTED &&
        ContextCompat.checkSelfPermission(activity, android.Manifest.permission.READ_CALENDAR) ==
            PackageManager.PERMISSION_GRANTED

    /** The calendar to write into: the account's primary one, else the first the
     *  user can actually contribute to. Null when none is usable. */
    private fun primaryCalendarId(): Long? {
        val projection = arrayOf(
            CalendarContract.Calendars._ID,
            CalendarContract.Calendars.IS_PRIMARY,
            CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,
        )
        return try {
            activity.contentResolver.query(
                CalendarContract.Calendars.CONTENT_URI, projection,
                "${CalendarContract.Calendars.VISIBLE} = 1", null, null,
            )?.use { c ->
                var fallback: Long? = null
                while (c.moveToNext()) {
                    val id = c.getLong(0)
                    val access = c.getInt(2)
                    if (access < CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR) continue
                    if (c.getInt(1) == 1) return@use id
                    if (fallback == null) fallback = id
                }
                fallback
            }
        } catch (_: SecurityException) {
            null
        }
    }

    @Command
    fun calendarAction(invoke: Invoke) {
        val args = invoke.parseArgs(CalendarArgs::class.java)
        val title = args.title.trim().ifEmpty { "JARVIS" }
        // A zero-length event renders as a point in time in most calendar UIs and is
        // easy to miss, so give a bare agenda item a sensible half-hour block.
        val start = args.startMillis
        val end = if (args.endMillis > start) args.endMillis else start + 30 * 60 * 1000

        val response = when (args.action.trim().lowercase()) {
            "add" -> {
                if (start <= 0) {
                    result(false, "I need a time before I can put that in your calendar.")
                } else if (!hasCalendarWrite()) {
                    // No permission: hand the event to the calendar's own new-event
                    // screen, which needs none. Deliberately NOT also firing a
                    // permission request here — that dialog and this activity would
                    // race, and the dialog loses. Permission is asked for from the
                    // Settings toggle ("request_permission"), where nothing competes.
                    val intent = Intent(Intent.ACTION_INSERT)
                        .setData(CalendarContract.Events.CONTENT_URI)
                        .putExtra(CalendarContract.Events.TITLE, title)
                        .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start)
                        .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end)
                    if (args.notes.isNotBlank()) {
                        intent.putExtra(CalendarContract.Events.DESCRIPTION, args.notes)
                    }
                    startClockIntent(intent, "Opened your calendar to add it — tap save.")
                } else {
                    val calId = primaryCalendarId()
                    if (calId == null) {
                        result(false, "I couldn't find a calendar on this phone I'm allowed to write to.")
                    } else {
                        try {
                            val values = ContentValues().apply {
                                put(CalendarContract.Events.CALENDAR_ID, calId)
                                put(CalendarContract.Events.TITLE, title)
                                put(CalendarContract.Events.DTSTART, start)
                                put(CalendarContract.Events.DTEND, end)
                                put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().id)
                                if (args.notes.isNotBlank()) {
                                    put(CalendarContract.Events.DESCRIPTION, args.notes)
                                }
                            }
                            val uri = activity.contentResolver
                                .insert(CalendarContract.Events.CONTENT_URI, values)
                            val id = uri?.lastPathSegment?.toLongOrNull()
                            if (id == null) {
                                result(false, "Your calendar refused that event.")
                            } else {
                                result(true, "Added to your calendar.").apply { put("eventId", id) }
                            }
                        } catch (exc: Exception) {
                            result(false, "Couldn't write to your calendar: ${exc.message}")
                        }
                    }
                }
            }

            "remove" -> {
                if (args.eventId <= 0) {
                    result(false, "I don't have a calendar event id for that.")
                } else if (!hasCalendarWrite()) {
                    result(false, "I don't have permission to change your calendar.")
                } else {
                    try {
                        val uri = ContentUris.withAppendedId(
                            CalendarContract.Events.CONTENT_URI, args.eventId,
                        )
                        val n = activity.contentResolver.delete(uri, null, null)
                        if (n > 0) result(true, "Removed from your calendar.")
                        else result(false, "That event was already gone from your calendar.")
                    } catch (exc: Exception) {
                        result(false, "Couldn't remove that event: ${exc.message}")
                    }
                }
            }

            "show" -> {
                val at = if (start > 0) start else System.currentTimeMillis()
                val uri = CalendarContract.CONTENT_URI.buildUpon()
                    .appendPath("time").appendPath(at.toString()).build()
                startClockIntent(Intent(Intent.ACTION_VIEW).setData(uri), "Opened your calendar.")
            }

            // Called when the user switches calendar sync on, so the dialog appears
            // with JARVIS in front and nothing else competing for the foreground.
            "request_permission" -> {
                if (hasCalendarWrite()) {
                    result(true, "Calendar access already granted.")
                } else {
                    ActivityCompat.requestPermissions(
                        activity,
                        arrayOf(
                            android.Manifest.permission.READ_CALENDAR,
                            android.Manifest.permission.WRITE_CALENDAR,
                        ),
                        104,
                    )
                    result(true, "Asked for calendar access.")
                }
            }

            else -> result(false, "I don't know the calendar action '${args.action}'.")
        }
        invoke.resolve(response)
    }

    @Command
    fun clockAction(invoke: Invoke) {
        val args = invoke.parseArgs(ClockArgs::class.java)
        val label = args.label.trim()

        val response = when (args.action.trim().lowercase()) {
            "alarm" -> {
                if (args.hour !in 0..23 || args.minute !in 0..59) {
                    result(false, "I need a valid time of day to set that alarm.")
                } else {
                    val intent = Intent(AlarmClock.ACTION_SET_ALARM).apply {
                        putExtra(AlarmClock.EXTRA_HOUR, args.hour)
                        putExtra(AlarmClock.EXTRA_MINUTES, args.minute)
                        putExtra(AlarmClock.EXTRA_SKIP_UI, true)
                        if (label.isNotEmpty()) putExtra(AlarmClock.EXTRA_MESSAGE, label)
                        // putIntegerArrayListExtra, not the generic putExtra: the
                        // Clock app reads this with getIntegerArrayListExtra, which
                        // only sees a value stored through the typed putter.
                        val days = calendarDays(args.days)
                        if (days.isNotEmpty()) putIntegerArrayListExtra(AlarmClock.EXTRA_DAYS, days)
                    }
                    val hhmm = String.format(Locale.US, "%02d:%02d", args.hour, args.minute)
                    val repeat = if (args.days.isNotBlank()) " (${args.days.trim()})" else ""
                    startClockIntent(intent, "Alarm set for $hhmm$repeat in your clock app.")
                }
            }

            "timer" -> {
                if (args.seconds <= 0) {
                    result(false, "I need a length for that timer.")
                } else {
                    val intent = Intent(AlarmClock.ACTION_SET_TIMER).apply {
                        putExtra(AlarmClock.EXTRA_LENGTH, args.seconds)
                        putExtra(AlarmClock.EXTRA_SKIP_UI, true)
                        if (label.isNotEmpty()) putExtra(AlarmClock.EXTRA_MESSAGE, label)
                    }
                    val mins = args.seconds / 60
                    val secs = args.seconds % 60
                    val spoken = when {
                        mins > 0 && secs > 0 -> "$mins min $secs sec"
                        mins > 0 -> "$mins minute" + if (mins == 1) "" else "s"
                        else -> "$secs second" + if (secs == 1) "" else "s"
                    }
                    startClockIntent(intent, "Timer started for $spoken in your clock app.")
                }
            }

            "show_alarms" ->
                startClockIntent(Intent(AlarmClock.ACTION_SHOW_ALARMS), "Opened your alarms.")

            "show_timers" ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startClockIntent(Intent(AlarmClock.ACTION_SHOW_TIMERS), "Opened your timers.")
                } else {
                    result(false, "This version of Android can't open the timer list directly.")
                }

            "dismiss_timer" ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    val intent = Intent(AlarmClock.ACTION_DISMISS_TIMER).apply {
                        putExtra(AlarmClock.EXTRA_SKIP_UI, true)
                    }
                    startClockIntent(intent, "Timer dismissed.")
                } else {
                    result(false, "This version of Android can't dismiss timers directly.")
                }

            else -> result(false, "I don't know the clock action '${args.action}'.")
        }
        invoke.resolve(response)
    }
}
