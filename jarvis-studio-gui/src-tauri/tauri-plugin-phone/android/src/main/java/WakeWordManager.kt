// ponytail: the library's WakeWordEngine never exposes the audio it hears, so this file
// drives openWakeWord 0.1.5's `internal` AudioProcessor/OnnxModelRunner itself. The
// suppression works on this build's Kotlin 1.9 (K1); vendor those two classes if a Kotlin 2
// upgrade rejects it.
@file:Suppress("INVISIBLE_MEMBER", "INVISIBLE_REFERENCE")

package com.jarvis.phone

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.core.content.ContextCompat
import com.rementia.openwakeword.lib.audio.AudioProcessor
import com.rementia.openwakeword.lib.ml.OnnxModelRunner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * On-device "Hey Jarvis" — same openWakeWord stack as the desktop Python backend,
 * running locally with no cloud calls until a wake is detected. Same model, audio format,
 * chunking, threshold and cooldown as the library's WakeWordEngine it replaced; the one
 * addition is [PreRollRing], so each detection hands over the seconds that fired it.
 */
class WakeWordManager(
    private val context: Context,
    private val onDetected: (score: Float) -> Unit,
    /** The latest detection's audio: up to 3 s before it plus what followed, until
     *  [POST_ROLL_MS] passed or [stop] — the model often fires before "Jarvis" has ended
     *  (live 2026-09-27: scores climbed 0.37 → 0.99 over the next frames, and a clip cut at
     *  the first one read "You're on surface"). */
    private val onPreRoll: (ShortArray) -> Unit,
) {
    companion object {
        private const val TAG = "JarvisWW"
        private const val RELEASE_WAIT_MS = 2_000L
        private const val SAMPLE_RATE = 16_000
        /** 80 ms — the step the model scores on (the library's BUFFER_SIZE_IN_SHORTS). */
        private const val CHUNK = 1280
        // 0.35 (was 0.4): genuine "Hey Jarvis" peaks ~0.6–0.99 on-device while ambient
        // noise sat ≤0.26 in testing, so a slightly lower bar fires a touch sooner and
        // catches softer/faster utterances. Conversation can clear it too; the pre-roll
        // check in wakeword.ts is what rejects those.
        private const val THRESHOLD = 0.35f
        private const val COOLDOWN_MS = 3_000L
        /** 3 s of history: "Hey Jarvis" plus room for a slow speaker. */
        private const val PRE_ROLL_SAMPLES = SAMPLE_RATE * 3
        /** How long a detection's audio keeps recording past the frame that fired it. */
        private const val POST_ROLL_MS = 400L

        /** Outlives any one manager: release() cancels [scope] right after stop(). */
        private val reaper = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    /** Recording + inference. Ours, so [stop] can wait for it before closing the models. */
    private var job: Job? = null
    private var processor: AudioProcessor? = null
    private var runner: OnnxModelRunner? = null
    private val ring = PreRollRing(PRE_ROLL_SAMPLES)
    /** When the detection whose audio isn't handed over yet fired (0 = none). */
    private var pendingAt = 0L

    /** The pending detection's audio, once its post-roll is done (or [force]d by stop). */
    @Synchronized
    private fun takePending(now: Long, force: Boolean): ShortArray? {
        if (pendingAt == 0L || (!force && now - pendingAt < POST_ROLL_MS)) return null
        pendingAt = 0L
        return ring.snapshot()
    }

    @Synchronized
    private fun markPending(now: Long) {
        pendingAt = now
    }

    /** Set right before returning false from [start] — the real reason the engine
     *  didn't come up, so the caller can tell a genuine mic/permission problem
     *  apart from e.g. a one-off model-asset failure instead of blaming
     *  "microphone access" for everything indiscriminately. */
    var lastError: String? = null
        private set

    fun start(): Boolean {
        if (job != null) return true
        lastError = null
        return try {
            require(
                ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                    PackageManager.PERMISSION_GRANTED,
            ) { "RECORD_AUDIO permission is required for wake word detection" }
            // openWakeWord loads model files from the APK's ASSETS via AssetManager.open()
            // — NOT from the filesystem. So the path must be the asset-relative NAME;
            // hey_jarvis.onnx (plus melspectrogram.onnx / embedding_model.onnx) ship in
            // src/main/assets. Passing an absolute /data/... path threw FileNotFoundException
            // and was the long-standing reason "Hey Jarvis" never listened on-device.
            android.util.Log.i(TAG, "loading hey_jarvis.onnx")
            val r = OnnxModelRunner(context.applicationContext.assets, "hey_jarvis.onnx")
            runner = r
            val p = AudioProcessor(context.applicationContext.assets, r)
            processor = p
            job = scope.launch {
                var lastFire = 0L
                // A mic hiccup must not end detection for good: pause briefly and
                // re-open the microphone for as long as we're running.
                while (isActive) {
                    try {
                        mic().collect { chunk ->
                            ring.write(chunk)
                            val now = System.currentTimeMillis()
                            takePending(now, force = false)?.let { audio ->
                                withContext(Dispatchers.Main) { onPreRoll(audio) }
                            }
                            val score = try {
                                p.predictWakeWord(FloatArray(chunk.size) { chunk[it] / 32768f })
                            } catch (e: Exception) {
                                android.util.Log.w(TAG, "inference failed: ${e.message}")
                                return@collect
                            }
                            if (score > THRESHOLD && now - lastFire >= COOLDOWN_MS) {
                                lastFire = now
                                android.util.Log.i(TAG, "DETECTION score=${"%.3f".format(score)}")
                                markPending(now)
                                withContext(Dispatchers.Main) { onDetected(score) }
                            }
                        }
                    } catch (e: Exception) {
                        if (!isActive) break
                        android.util.Log.w(TAG, "microphone hiccup: ${e.message}")
                    }
                    delay(500L)
                }
            }
            android.util.Log.i(TAG, "listening")
            true
        } catch (e: Exception) {
            lastError = e.message ?: e.javaClass.simpleName
            android.util.Log.e(TAG, "start() failed: ${e.javaClass.simpleName}: ${e.message}", e)
            stop()
            false
        }
    }

    /** 16 kHz mono PCM in 80 ms chunks, recorded on the IO pool so inference never
     *  holds up the microphone (the library's AudioRecorder, minus the float copy). */
    @SuppressLint("MissingPermission") // checked in start()
    private fun mic(): Flow<ShortArray> = flow {
        val min = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val rec = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            maxOf(min, CHUNK * 2),
        )
        try {
            check(rec.state == AudioRecord.STATE_INITIALIZED) { "Failed to initialize AudioRecord" }
            val buf = ShortArray(CHUNK)
            rec.startRecording()
            while (currentCoroutineContext().isActive) {
                val n = rec.read(buf, 0, CHUNK)
                if (n > 0) emit(buf.copyOf(n))
            }
        } finally {
            if (rec.recordingState == AudioRecord.RECORDSTATE_RECORDING) rec.stop()
            rec.release()
        }
    }.flowOn(Dispatchers.IO)

    fun stop() {
        // JS stops the engine ~0.1–0.4 s after a wake to take the microphone: hand over the
        // detection's audio as it stands rather than lose it with the loop.
        takePending(System.currentTimeMillis(), force = true)?.let(onPreRoll)
        val j = job
        val p = processor
        val r = runner
        job = null
        processor = null
        runner = null
        // Cancelling only ASKS the loop to stop, and closing the ONNX sessions while an
        // OrtSession.run is still in flight on another thread SIGABRT'd the whole process
        // (2026-09-23), which also left Android marking our accessibility service
        // "crashed". So wait for the loop to actually finish, off the main thread, first.
        reaper.launch {
            val done = j == null || withTimeoutOrNull(RELEASE_WAIT_MS) { j.cancelAndJoin() } != null
            if (!done) {
                // Leaking three small sessions beats crashing the app.
                android.util.Log.w(TAG, "inference didn't stop in ${RELEASE_WAIT_MS}ms; not releasing the models")
                return@launch
            }
            try {
                p?.close()
                r?.close()
            } catch (_: Exception) {
            }
        }
    }

    fun release() {
        stop()
        scope.cancel()
    }
}
