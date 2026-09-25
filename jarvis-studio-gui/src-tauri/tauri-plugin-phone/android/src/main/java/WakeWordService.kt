package com.jarvis.phone

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Foreground service that owns the "Hey Jarvis" listener. Its whole reason to exist:
 * Android will NOT let a background app touch the microphone at all (enforced by
 * AppOpsManager since Android 9, and since Android 14 a foreground service must
 * explicitly declare the "microphone" type or startForeground() throws) — before this,
 * WakeWordManager lived directly on the Tauri Activity/Plugin, so wake-word listening
 * died the instant the screen locked or the app left the foreground. This is the
 * confirmed root cause the user identified live: not a permission bug, an Android
 * background-execution policy this app was never opted into.
 *
 * The always-visible notification below is not optional — it's the OS's own
 * transparency requirement for any app that keeps recording audio while backgrounded,
 * not a design choice this app could remove even if it wanted to.
 */
class WakeWordService : Service() {

    companion object {
        private const val TAG = "JarvisWW"

        // Proactive recycle interval. Root cause not fully pinned down (needs the
        // openwakeword native engine's own source, which isn't available to us — see
        // the memory of this investigation), but the failure signature is clear from
        // logcat review: the engine's detection Flow can go silently inert — it never
        // throws and never completes, it just stops emitting — while `manager` stays
        // non-null, so `isListening` (manager != null) keeps reporting true forever
        // and the JS poll's self-heal (which only restarts on listening:false) never
        // fires. Rather than chase an exact repro, bound the outage: tear down and
        // recreate the engine on a fixed cadence so a silent stall self-recovers
        // within minutes instead of requiring a full app restart. Only runs while a
        // manager exists — i.e. while genuinely idle-listening, never mid-command
        // capture (JS fully stops this service before recording a command and
        // restarts it after, so there's no window where a recycle could race that).
        private const val RECYCLE_INTERVAL_MS = 8 * 60 * 1000L

        @Volatile
        var instance: WakeWordService? = null
        const val CHANNEL_ID = "jarvis_wakeword"
        const val NOTIF_ID = 4201
        const val ACTION_STOP = "com.jarvis.phone.WAKEWORD_STOP"

        /** Set by PhonePlugin BEFORE calling [launch] — a companion (not instance)
         *  property so it can be set before the service exists at all:
         *  startForegroundService() returns immediately, while onCreate()/
         *  onStartCommand() run moments later on the main thread. If this lived on
         *  the instance, PhonePlugin would have nowhere to put the callback until
         *  after the service was already up, racing the very first detection. */
        @Volatile
        var onDetected: (() -> Unit)? = null

        /** True once the service is up AND its listener actually started (not just
         *  that onCreate() ran) — what callers need to know "is it really working". */
        val isListening: Boolean
            get() = instance?.manager != null

        /** The reason the LAST start attempt failed, if any — read after the service
         *  has already torn itself down (stopSelf() clears [instance] via onDestroy,
         *  so this can't live on the instance either). Cleared at the start of every
         *  fresh attempt so a stale reason from a previous failure can't linger. */
        @Volatile
        var lastError: String? = null

        /** Monotonic wake-detection counter. JS polls it (plugin:phone|poll_wake_word)
         *  and reacts whenever it grows. This replaces the Tauri event/Channel bridge
         *  for delivering detections — that bridge drops callbacks on this device during
         *  the WebView's startup reloads, so `trigger("wake-detected")` never reached the
         *  live page. The plain request/response poll path is reliable (getDeviceStats
         *  polls it every second without loss). Survives engine stop/start (companion). */
        val wakeSeq = java.util.concurrent.atomic.AtomicInteger(0)

        /** One-shot: fired from onStartCommand once we KNOW whether listening
         *  actually started. PhonePlugin sets this instead of blocking its own
         *  thread waiting for the service — Service lifecycle callbacks (onCreate/
         *  onStartCommand) run on the main thread, and an earlier version of this
         *  code polled with Thread.sleep() from the plugin command handler, which
         *  (if that handler also runs on the main thread) deadlocks: the service
         *  can never call onCreate() while the main thread is busy sleeping waiting
         *  for onCreate() to have already run. Confirmed live — wake word silently
         *  failed 100% of the time until this was made non-blocking. */
        @Volatile
        var onStartResult: ((Boolean, String?) -> Unit)? = null

        /** Start (or no-op if already running) the wake-word foreground service. */
        fun launch(context: Context) {
            val intent = Intent(context, WakeWordService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun shutdown(context: Context) {
            context.stopService(Intent(context, WakeWordService::class.java))
        }

        /**
         * Instant beep + haptic buzz the MOMENT "Hey Jarvis" is detected — before
         * command capture even starts. openWakeWord's own audio-buffering (mel-
         * spectrogram context window) is an inherent ~1s+ of the perceived wake delay
         * that isn't fixable at the JS/native-glue layer (measured: our poll-based
         * reaction is already ~125-130ms, right at the poll-interval floor). A cheap,
         * proven mitigation for that dead-silence stretch — the same trick voice
         * assistants use — is to acknowledge the instant detection fires, so it FEELS
         * responsive even though the underlying model latency is unchanged. Both calls
         * are fire-and-forget and swallow errors: a missing vibrator/audio route on some
         * device must never block or crash the detection path.
         */
        fun playWakeCue(context: Context) {
            try {
                val tg = android.media.ToneGenerator(
                    android.media.AudioManager.STREAM_NOTIFICATION,
                    70, // quiet — an acknowledgement, not an alert
                )
                tg.startTone(android.media.ToneGenerator.TONE_PROP_BEEP, 90)
                android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                    try { tg.release() } catch (_: Exception) {}
                }, 200)
            } catch (_: Exception) {
            }
            try {
                val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE)
                        as android.os.VibratorManager
                    vm.defaultVibrator
                } else {
                    @Suppress("DEPRECATION")
                    context.getSystemService(Context.VIBRATOR_SERVICE) as android.os.Vibrator
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(android.os.VibrationEffect.createOneShot(35, 120))
                } else {
                    @Suppress("DEPRECATION")
                    vibrator.vibrate(35)
                }
            } catch (_: Exception) {
            }
        }
    }

    private var manager: WakeWordManager? = null
    private val recycleHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val recycleRunnable = Runnable { recycleEngine() }

    override fun onCreate() {
        super.onCreate()
        instance = this
        createChannel()
    }

    private fun newDetectionCallback(): () -> Unit = {
        wakeSeq.incrementAndGet()
        playWakeCue(applicationContext)
        onDetected?.invoke()
    }

    private fun scheduleRecycle() {
        recycleHandler.removeCallbacks(recycleRunnable)
        recycleHandler.postDelayed(recycleRunnable, RECYCLE_INTERVAL_MS)
    }

    /** Proactive self-heal: tear down and recreate the engine on a fixed cadence
     *  (see RECYCLE_INTERVAL_MS) so a silent engine stall can't outlive a few
     *  minutes. Safe to call any time `manager` is non-null — that only happens
     *  while idle-listening, never mid-command-capture. */
    private fun recycleEngine() {
        if (manager == null) return // already torn down (stopping/capturing) — nothing to do
        android.util.Log.i(TAG, "watchdog: proactive engine recycle (every ${RECYCLE_INTERVAL_MS / 60000}min)")
        manager?.release()
        manager = null
        val mgr = WakeWordManager(applicationContext, newDetectionCallback())
        val ok = mgr.start()
        if (ok) {
            manager = mgr
            android.util.Log.i(TAG, "watchdog: recycle OK, still listening")
            scheduleRecycle()
        } else {
            // Couldn't restart — don't sit around as a dead foreground service;
            // stopSelf() flips isListening to false so the JS poll's own self-heal
            // (which starts a brand-new service) takes over from here.
            lastError = mgr.lastError
            android.util.Log.w(TAG, "watchdog: recycle failed (reason=${mgr.lastError}) → stopSelf")
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        android.util.Log.i(TAG, "onStartCommand action=${intent?.action} managerNull=${manager == null}")
        if (intent?.action == ACTION_STOP) {
            android.util.Log.i(TAG, "ACTION_STOP → stopSelf")
            stopSelf()
            return START_NOT_STICKY
        }
        startForegroundCompat()
        if (manager == null) {
            lastError = null
            val mgr = WakeWordManager(applicationContext, newDetectionCallback())
            val ok = mgr.start()
            android.util.Log.i(TAG, "manager.start() → $ok lastError=${mgr.lastError}")
            if (ok) {
                manager = mgr
                scheduleRecycle()
                val cb = onStartResult
                onStartResult = null
                cb?.invoke(true, null)
            } else {
                // Couldn't actually start listening (bad asset, engine failure, or a
                // genuine mic problem) — don't sit around as a foreground service for
                // nothing; let the caller's own retry logic (wakeword.ts) handle it.
                lastError = mgr.lastError
                val cb = onStartResult
                onStartResult = null
                cb?.invoke(false, mgr.lastError)
                android.util.Log.w(TAG, "start failed → stopSelf (reason=${mgr.lastError})")
                stopSelf()
            }
        } else {
            android.util.Log.i(TAG, "already listening → callback(true)")
            val cb = onStartResult
            onStartResult = null
            cb?.invoke(true, null)
        }
        return START_STICKY
    }

    private fun startForegroundCompat() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    private fun buildNotification(): Notification {
        val stopIntent = Intent(this, WakeWordService::class.java).apply { action = ACTION_STOP }
        val stopPending = PendingIntent.getService(
            this, 0, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val contentPending = launch?.let {
            PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE)
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle("JARVIS is listening")
            .setContentText("Say “Hey Jarvis” any time — tap Stop to turn this off")
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .apply { if (contentPending != null) setContentIntent(contentPending) }
            .addAction(0, "Stop", stopPending)
            .build()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Wake word listening",
                NotificationManager.IMPORTANCE_LOW,
            ).apply { description = "Shown while JARVIS is listening for \"Hey Jarvis\"." }
            nm.createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        android.util.Log.i(TAG, "onDestroy")
        recycleHandler.removeCallbacks(recycleRunnable)
        manager?.release()
        manager = null
        if (instance === this) instance = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
