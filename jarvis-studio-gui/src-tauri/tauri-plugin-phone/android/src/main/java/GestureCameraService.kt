package com.jarvis.phone

import android.app.KeyguardManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.ContentValues
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.Environment
import android.provider.MediaStore
import android.util.Size
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.gesturerecognizer.GestureRecognizer
import java.util.concurrent.Executors

/** Explicit, five-minute sessions. No recording, network access, boot restart, or
 * Activity reference. The Stop button and screen-lock shutdown work without JS. */
class GestureCameraService : LifecycleService() {
    data class State(
        val running: Boolean = false,
        val starting: Boolean = false,
        val seq: Int = 0,
        val gesture: String = "UNKNOWN",
        val detectedAt: Long = 0,
        val summary: String = "Camera is off.",
        val frameSeq: Int = 0,
        val observedAt: Long = 0,
        val pose: String = "UNKNOWN",
        val score: Float = 0f,
        val landmarks: List<List<Float>> = emptyList(),
    )

    companion object {
        const val ACTION_START = "com.jarvis.phone.GESTURE_START"
        const val ACTION_STOP = "com.jarvis.phone.GESTURE_STOP"
        @Volatile var state = State()
            private set
        @Volatile private var instance: GestureCameraService? = null

        fun takePhoto(done: (Boolean, String) -> Unit) {
            Handler(Looper.getMainLooper()).post {
                val service = instance
                if (service == null || !state.running || service.closing) {
                    done(false, "Start the gesture camera before taking a photo.")
                } else service.schedulePhoto(done)
            }
        }

        @Synchronized fun prepareStart(): Boolean {
            if (state.running || state.starting) return false
            state = state.copy(starting = true, gesture = "UNKNOWN", detectedAt = 0,
                observedAt = 0, pose = "UNKNOWN", score = 0f, landmarks = emptyList(),
                summary = "Starting gesture camera...")
            return true
        }

        @Synchronized fun failedStart() {
            state = state.copy(starting = false, running = false,
                summary = "Could not start the camera. Open JARVIS and try again.")
        }
    }

    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private var latch = GestureLatch()
    private var confidence = 0.8f
    @Volatile private var photoAt = 0L
    @Volatile private var photoToken = 0
    private var photoDone: ((Boolean, String) -> Unit)? = null
    private var provider: ProcessCameraProvider? = null
    private var preview: Preview? = null
    private var analysis: ImageAnalysis? = null
    private var recognizer: GestureRecognizer? = null // worker thread only
    private var overlay: LinearLayout? = null
    private lateinit var statusText: TextView
    private lateinit var previewView: PreviewView
    private var started = false
    @Volatile private var closing = false
    private var lastFrameAt = -200L
    private var failures = 0
    private val timeout = Runnable { finish("Gesture session ended after five minutes.") }
    private val startupTimeout = Runnable { finish("Camera startup timed out. Try again.") }
    private val screenOff = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            finish("Camera stopped when the screen locked.")
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        ContextCompat.registerReceiver(this, screenOff, IntentFilter(Intent.ACTION_SCREEN_OFF),
            ContextCompat.RECEIVER_NOT_EXPORTED)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        if (intent?.action != ACTION_START) {
            finish("Camera is off.")
            return START_NOT_STICKY
        }
        if (started || closing) return START_NOT_STICKY
        started = true
        latch = GestureLatch(intent.getIntExtra("holdMs", 600).coerceIn(200, 2000).toLong(),
            intent.getIntExtra("releaseMs", 400).coerceIn(200, 1500).toLong())
        confidence = intent.getFloatExtra("confidence", 0.8f).let { if (it.isFinite()) it.coerceIn(0.65f, 0.98f) else 0.8f }
        try {
            if (getSystemService(KeyguardManager::class.java).isKeyguardLocked) {
                finish("Unlock your phone and open JARVIS to start the camera.")
                return START_NOT_STICKY
            }
            showForeground()
            showOverlay()
            main.postDelayed(startupTimeout, 20_000)
            main.postDelayed(timeout, 5 * 60_000)
            worker.execute {
                try {
                    recognizer = GestureRecognizer.createFromOptions(this,
                        GestureRecognizer.GestureRecognizerOptions.builder()
                            .setBaseOptions(BaseOptions.builder()
                                .setModelAssetPath("gesture_recognizer.task").build())
                            .setRunningMode(RunningMode.VIDEO)
                            .setNumHands(1)
                            .setMinHandDetectionConfidence(0.65f)
                            .setMinHandPresenceConfidence(0.65f)
                            .setMinTrackingConfidence(0.65f)
                            .build())
                    main.post { if (!closing) bindCamera() }
                } catch (_: Exception) {
                    main.post { finish("Gesture model could not load. Restart JARVIS and try again.") }
                }
            }
        } catch (_: Exception) {
            finish("Camera could not start. Check camera and display-over-apps permissions.")
        }
        return START_NOT_STICKY
    }

    private fun showForeground() {
        val channel = "jarvis_gesture_camera"
        if (Build.VERSION.SDK_INT >= 26) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(channel, "JARVIS gesture camera", NotificationManager.IMPORTANCE_LOW))
        }
        val stop = PendingIntent.getService(this, 702,
            Intent(this, GestureCameraService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, channel)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentTitle("JARVIS gesture camera is on")
            .setContentText("On-device recognition. Stops after five minutes.")
            .setOngoing(true)
            .addAction(android.R.drawable.ic_media_pause, "Stop camera", stop)
            .build()
        ServiceCompat.startForeground(this, 701, notification,
            if (Build.VERSION.SDK_INT >= 30) ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA else 0)
    }

    private fun showOverlay() {
        val density = resources.displayMetrics.density
        fun dp(n: Int) = (n * density).toInt()
        previewView = PreviewView(this).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
        statusText = TextView(this).apply {
            text = "Starting gesture camera..."
            setTextColor(Color.WHITE)
            setPadding(dp(8), dp(6), dp(8), dp(6))
            textSize = 12f
        }
        val stop = Button(this).apply {
            text = "Stop camera"
            setOnClickListener { finish("Camera stopped.") }
        }
        val view = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(20, 25, 35))
            addView(previewView, LinearLayout.LayoutParams(dp(180), dp(135)))
            addView(statusText)
            addView(stop)
        }
        getSystemService(WindowManager::class.java).addView(view, WindowManager.LayoutParams(
            dp(180), WindowManager.LayoutParams.WRAP_CONTENT,
            if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT).apply {
                gravity = Gravity.TOP or Gravity.END
                x = dp(8)
                y = dp(100)
            })
        overlay = view
    }

    private fun bindCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            if (closing) return@addListener
            try {
                val camera = future.get()
                provider = camera
                if (!camera.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA)) {
                    finish("This device has no front camera.")
                    return@addListener
                }
                val cameraPreview = Preview.Builder().build().also {
                    it.setSurfaceProvider(previewView.surfaceProvider)
                }
                val cameraAnalysis = ImageAnalysis.Builder()
                    .setResolutionSelector(ResolutionSelector.Builder()
                        .setResolutionStrategy(ResolutionStrategy(Size(640, 480),
                            ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER)).build())
                    .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
                preview = cameraPreview
                analysis = cameraAnalysis
                cameraAnalysis.setAnalyzer(worker, ::analyze)
                camera.bindToLifecycle(this, CameraSelector.DEFAULT_FRONT_CAMERA,
                    cameraPreview, cameraAnalysis)
                // Running means a real frame reached the recognizer, not merely that
                // Android accepted startForegroundService or bound a camera object.
            } catch (_: Exception) {
                finish("Front camera unavailable. Close other camera apps and try again.")
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun analyze(image: ImageProxy) {
        var bitmap: Bitmap? = null
        var rotated: Bitmap? = null
        try {
            val now = SystemClock.uptimeMillis()
            val capturedAt = System.currentTimeMillis()
            if (closing || now - lastFrameAt < 125) return // at most eight inferences/sec
            lastFrameAt = now
            bitmap = image.toBitmap() // CameraX handles row/pixel stride, including padding
            rotated = if (image.imageInfo.rotationDegrees == 0) bitmap else {
                val matrix = Matrix().apply { postRotate(image.imageInfo.rotationDegrees.toFloat()) }
                Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
            }
            val input = BitmapImageBuilder(rotated).build()
            val result = try { recognizer?.recognizeForVideo(input, now) } finally { input.close() }
            val category = result?.gestures()?.firstOrNull()?.firstOrNull()
            val gesture = GestureRecognition.recognize(category?.categoryName() ?: "",
                category?.score() ?: 0f, confidence)
            val points = result?.landmarks()?.firstOrNull()?.map { listOf(it.x(), it.y(), it.z()) } ?: emptyList()
            if (photoAt > 0 && now >= photoAt && gesture != GestureRecognition.Gesture.FIST) {
                photoAt = 0
                val token = photoToken
                val saved = saveSnapshot(rotated, token)
                main.post {
                    if (token != photoToken) return@post
                    photoDone?.invoke(saved.first, saved.second)
                    photoDone = null
                    if (!closing) state = state.copy(summary = saved.second)
                }
            }
            failures = 0
            val event = latch.update(gesture, now)
            main.post {
                if (closing) return@post
                main.removeCallbacks(startupTimeout)
                if (!state.running) {
                    state = state.copy(running = true, starting = false, summary = "Hold a gesture for a moment.")
                }
                state = state.copy(frameSeq = state.frameSeq + 1, observedAt = capturedAt,
                    pose = gesture.name, score = category?.score() ?: 0f, landmarks = points)
                if (photoDone == null) {
                    statusText.text = when (gesture) {
                        GestureRecognition.Gesture.UNKNOWN -> "Hold your hand in view"
                        else -> gesture.name.replace('_', ' ')
                    }
                }
                if (event != null) {
                    state = state.copy(seq = state.seq + 1, gesture = event.name,
                        detectedAt = System.currentTimeMillis())
                    if (event == GestureRecognition.Gesture.FIST) finish("Camera stopped by closed fist.")
                }
            }
        } catch (_: Exception) {
            failures++
            if (failures >= 5) main.post { finish("Gesture recognition failed. Restart the camera to try again.") }
        } finally {
            if (rotated !== bitmap) rotated?.recycle()
            bitmap?.recycle()
            image.close()
        }
    }

    private fun finish(message: String) {
        if (closing) return
        closing = true
        state = state.copy(running = false, starting = false, summary = message)
        stopSelf()
    }

    private fun schedulePhoto(done: (Boolean, String) -> Unit) {
        if (photoDone != null) { done(false, "A photo countdown is already running."); return }
        photoDone = done
        val token = ++photoToken
        photoAt = SystemClock.uptimeMillis() + 3000
        fun countdown() {
            if (closing || photoDone == null || token != photoToken) return
            val seconds = ((photoAt - SystemClock.uptimeMillis() + 999) / 1000).coerceAtLeast(0)
            statusText.text = if (seconds > 0) "Photo in $seconds..." else "Capturing photo..."
            state = state.copy(summary = statusText.text.toString())
            if (seconds > 0) main.postDelayed({ countdown() }, 1000)
        }
        countdown()
        main.postDelayed({
            if (photoDone != null && token == photoToken) {
                photoToken++
                photoAt = 0; photoDone?.invoke(false, "No camera frame arrived for the photo."); photoDone = null
            }
        }, 8000)
    }

    private fun saveSnapshot(bitmap: Bitmap, token: Int): Pair<Boolean, String> {
        if (closing || token != photoToken) return false to "Photo cancelled."
        val name = "JARVIS-${System.currentTimeMillis()}.jpg"
        if (Build.VERSION.SDK_INT >= 29) {
            val resolver = contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, name)
                put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/JARVIS")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
            val uri = try { resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) }
                catch (_: Exception) { return false to "Could not create the photo. Check available storage." }
                ?: return false to "Could not create the photo."
            return try {
                val saved = resolver.openOutputStream(uri)?.use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) } == true
                if (!saved || closing || token != photoToken) {
                    resolver.delete(uri, null, null)
                    false to "Photo failed or was cancelled."
                } else {
                    val updated = resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
                    if (updated == 1) true to "Saved camera snapshot to Pictures/JARVIS/$name."
                    else { resolver.delete(uri, null, null); false to "Could not finish saving the photo." }
                }
            } catch (_: Exception) {
                try { resolver.delete(uri, null, null) } catch (_: Exception) { }
                false to "Could not save the photo. Check available storage."
            }
        }
        return try {
            val folder = getExternalFilesDir(Environment.DIRECTORY_PICTURES)
                ?: return false to "Photo storage is unavailable."
            val file = java.io.File(folder, name)
            val saved = file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
            if (!saved || closing || token != photoToken) { file.delete(); false to "Photo failed or was cancelled." }
            else true to "Saved camera snapshot in JARVIS's app Pictures folder: $name."
        } catch (_: Exception) { false to "Could not save the photo. Check available storage." }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        finish("Camera stopped when JARVIS was closed.")
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        closing = true
        if (instance === this) instance = null
        photoAt = 0
        photoToken++
        photoDone?.invoke(false, "Photo cancelled because the camera stopped.")
        photoDone = null
        main.removeCallbacksAndMessages(null)
        if (state.running || state.starting) {
            state = state.copy(running = false, starting = false, summary = "Camera is off.")
        }
        try { unregisterReceiver(screenOff) } catch (_: Exception) { }
        analysis?.clearAnalyzer()
        // Unbind only this service's use cases; other camera consumers are untouched.
        val cases = listOfNotNull(preview, analysis)
        if (cases.isNotEmpty()) provider?.unbind(*cases.toTypedArray())
        overlay?.let { try { getSystemService(WindowManager::class.java).removeView(it) } catch (_: Exception) { } }
        overlay = null
        // Close the model behind any current inference, on the same worker.
        worker.execute { recognizer?.close(); recognizer = null }
        worker.shutdown()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}
