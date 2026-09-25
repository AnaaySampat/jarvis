package com.jarvis.phone

import android.content.Context
import com.rementia.openwakeword.lib.WakeWordEngine
import com.rementia.openwakeword.lib.model.DetectionMode
import com.rementia.openwakeword.lib.model.WakeWordModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * On-device "Hey Jarvis" — same openWakeWord stack as the desktop Python backend,
 * running locally with no cloud calls until a wake is detected.
 */
class WakeWordManager(
    private val context: Context,
    private val onDetected: () -> Unit,
) {
    companion object {
        private const val TAG = "JarvisWW"
        private const val RELEASE_WAIT_MS = 2_000L

        /** Outlives any one manager: release() cancels [scope] right after stop(). */
        private val reaper = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var engine: WakeWordEngine? = null
    /** Parent of the engine's own inference job — ours, so [stop] can wait for it. */
    private var engineJob: Job? = null
    private var collectJob: Job? = null
    private var running = false

    /** Set right before returning false from [start] — the real reason the engine
     *  didn't come up, so the caller can tell a genuine mic/permission problem
     *  apart from e.g. a one-off model-asset copy failure instead of blaming
     *  "microphone access" for everything indiscriminately. */
    var lastError: String? = null
        private set

    fun start(): Boolean {
        if (running) return true
        lastError = null
        return try {
            // openWakeWord (xyz.rementia:openwakeword) loads model files from the APK's
            // ASSETS via AssetManager.open(modelPath) — NOT from the filesystem. So
            // modelPath must be the asset-relative NAME; hey_jarvis.onnx (plus the lib's
            // melspectrogram.onnx / embedding_model.onnx) all ship in src/main/assets.
            // The previous code copied hey_jarvis.onnx into filesDir and passed that
            // absolute /data/... path, which AssetManager.open() can't resolve — it threw
            // FileNotFoundException and the engine never loaded. That was the real,
            // long-standing reason "Hey Jarvis" never actually listened on-device.
            android.util.Log.i(TAG, "constructing engine (model asset: hey_jarvis.onnx)")

            val models = listOf(
                WakeWordModel(
                    name = "Hey Jarvis",
                    // 0.35 (was 0.4): genuine "Hey Jarvis" peaks ~0.6–0.99 on-device while
                    // ambient noise sat ≤0.26 in testing, so a slightly lower bar fires a
                    // touch sooner and catches softer/faster utterances without adding
                    // false triggers.
                    modelPath = "hey_jarvis.onnx",
                    threshold = 0.35f,
                ),
            )
            val job = Job()
            val eng = WakeWordEngine(
                context = context.applicationContext,
                models = models,
                detectionMode = DetectionMode.SINGLE_BEST,
                detectionCooldownMs = 3000L,
                // The library's default scope is the same dispatcher; passing our own
                // is what lets stop() wait for in-flight inference (see stop()).
                scope = CoroutineScope(job + Dispatchers.Default),
            )
            engine = eng
            engineJob = job
            running = true
            collectJob = scope.launch {
                // A flow `catch` would COMPLETE the flow on the first mic/engine
                // hiccup and silently end detection. Instead: swallow the error,
                // pause briefly, and re-collect for as long as we're running.
                while (running) {
                    try {
                        eng.detections.collect {
                            android.util.Log.i(TAG, "DETECTION score=${"%.3f".format(it.score)}")
                            onDetected()
                        }
                    } catch (e: Exception) {
                        android.util.Log.w(TAG, "detections.collect hiccup: ${e.message}")
                    }
                    if (!running) break
                    delay(500L)
                }
            }
            eng.start()
            android.util.Log.i(TAG, "engine.start() returned; listening")
            true
        } catch (e: Exception) {
            lastError = e.message ?: e.javaClass.simpleName
            android.util.Log.e(TAG, "start() failed: ${e.javaClass.simpleName}: ${e.message}", e)
            stop()
            false
        }
    }

    fun stop() {
        running = false
        collectJob?.cancel()
        collectJob = null
        val eng = engine ?: return
        val job = engineJob
        engine = null
        engineJob = null
        try {
            eng.stop()
        } catch (_: Exception) {
        }
        // The library's stop() only CANCELS its inference job and release() then closes
        // the ONNX sessions at once — an OrtSession.run still in flight on another
        // thread hit the destroyed session and SIGABRT'd the whole process (2026-09-23),
        // which also left Android marking our accessibility service "crashed". So wait
        // for the job to actually finish, off the main thread, before closing anything.
        reaper.launch {
            val done = job == null || withTimeoutOrNull(RELEASE_WAIT_MS) { job.cancelAndJoin() } != null
            if (!done) {
                // Leaking three small sessions beats crashing the app.
                android.util.Log.w(TAG, "inference didn't stop in ${RELEASE_WAIT_MS}ms; not releasing the engine")
                return@launch
            }
            try {
                eng.release()
            } catch (_: Exception) {
            }
        }
    }

    fun release() {
        stop()
        scope.cancel()
    }
}
