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
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import android.util.Size
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
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
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.components.processors.ClassifierOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.core.ImageProcessingOptions
import com.google.mediapipe.tasks.vision.gesturerecognizer.GestureRecognizer
import java.util.concurrent.Executors
import kotlin.math.hypot
import kotlin.math.roundToInt

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
        val runnerUpScore: Float = 0f,
        val handCount: Int = 0,
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
                            .setNumHands(2)
                            .setCannedGesturesClassifierOptions(ClassifierOptions.builder()
                                .setMaxResults(2).setScoreThreshold(0f).build())
                            .setMinHandDetectionConfidence(0.65f)
                            .setMinHandPresenceConfidence(0.65f)
                            .setMinTrackingConfidence(0.65f)
                            .build())
                    main.post { if (!closing) bindCamera() }
                } catch (error: Exception) {
                    modelLoadFailed(error)
                } catch (error: LinkageError) {
                    // JNI loading and static initializers throw Errors, not Exceptions.
                    // Stop this session instead of killing the whole app process.
                    modelLoadFailed(error)
                }
            }
        } catch (error: Exception) {
            Log.e("GestureCamera", "Could not start camera service or preview", error)
            finish("Camera could not start. Check camera and display-over-apps permissions.")
        }
        return START_NOT_STICKY
    }

    private fun modelLoadFailed(error: Throwable) {
        Log.e("GestureCamera", "Could not load gesture model", error)
        main.post { finish("Gesture model could not load. Restart JARVIS and try again.") }
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

    @Suppress("DEPRECATION") // Display metrics before API 30; overlay coordinates use display pixels.
    private fun showOverlay() {
        val density = resources.displayMetrics.density
        fun dp(n: Int) = (n * density).toInt()
        val windows = getSystemService(WindowManager::class.java)
        val displays = getSystemService(DisplayManager::class.java)
        fun safeBounds(): Rect {
            if (Build.VERSION.SDK_INT >= 30) {
                try {
                    val metrics = windows.currentWindowMetrics
                    val bars = metrics.windowInsets.getInsetsIgnoringVisibility(
                        WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                    return Rect(bars.left + dp(8), bars.top + dp(8),
                        maxOf(bars.left + dp(8) + 1, metrics.bounds.width() - bars.right - dp(8)),
                        maxOf(bars.top + dp(8) + 1, metrics.bounds.height() - bars.bottom - dp(8)))
                } catch (_: Exception) {
                    // Some vendors do not expose window metrics to service contexts.
                }
            }
            val display = android.util.DisplayMetrics()
            windows.defaultDisplay.getRealMetrics(display)
            fun barHeight(name: String): Int {
                val id = resources.getIdentifier(name, "dimen", "android")
                return if (id == 0) 0 else resources.getDimensionPixelSize(id)
            }
            return Rect(dp(8), barHeight("status_bar_height") + dp(8),
                maxOf(dp(8) + 1, display.widthPixels - dp(8)),
                maxOf(barHeight("status_bar_height") + dp(8) + 1,
                    display.heightPixels - barHeight("navigation_bar_height") - dp(8)))
        }
        fun surface(color: Int, radius: Int = 10) = GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(radius).toFloat()
        }
        fun button(label: String) = Button(this).apply {
            text = label
            isAllCaps = false
            textSize = 11f
            minWidth = 0
            minimumWidth = 0
            minHeight = 0
            minimumHeight = 0
            setPadding(dp(5), 0, dp(5), 0)
            setTextColor(Color.WHITE)
            background = surface(Color.rgb(44, 53, 66))
        }
        previewView = PreviewView(this).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            contentDescription = "Front camera preview"
        }
        // Keep PreviewView attached, measured and in the draw path while collapsed.
        // A one-pixel viewport keeps its TextureView surface alive for CameraX.
        val previewHolder = FrameLayout(this).apply {
            clipChildren = true
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            addView(previewView, FrameLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(112)))
        }
        val handle = TextView(this).apply {
            text = "⠿  Gesture camera"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.rgb(216, 225, 235))
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(3), 0, dp(3), 0)
        }
        statusText = TextView(this).apply {
            text = "Starting camera…"
            setTextColor(Color.rgb(183, 195, 209))
            setPadding(dp(3), dp(3), dp(3), dp(5))
            textSize = 11f
            minLines = 2
            maxLines = 2
        }
        val toggle = button("Show preview")
        val stop = button("Stop camera").apply {
            background = surface(Color.rgb(111, 41, 45))
            setOnClickListener { finish("Camera stopped.") }
        }
        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(toggle, LinearLayout.LayoutParams(0, dp(48), 1f).apply { rightMargin = dp(6) })
            addView(stop, LinearLayout.LayoutParams(0, dp(48), 1f))
        }
        val view = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(8), dp(4), dp(8), dp(8))
            background = surface(Color.rgb(21, 27, 36), 14).apply {
                setStroke(dp(1).coerceAtLeast(1), Color.rgb(65, 77, 93))
            }
            elevation = dp(8).toFloat()
            clipToOutline = true
            addView(handle, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(28)))
            addView(previewHolder, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 1))
            addView(statusText, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT))
            addView(actions, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(48)))
        }
        val initialBounds = safeBounds()
        val layout = WindowManager.LayoutParams(
            minOf(dp(172), initialBounds.width()), WindowManager.LayoutParams.WRAP_CONTENT,
            if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN, PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.TOP or Gravity.LEFT
            x = initialBounds.right - width
            y = maxOf(initialBounds.top, initialBounds.bottom - dp(116))
        }
        var expanded = false
        fun resizePreview(show: Boolean) {
            expanded = show
            previewHolder.layoutParams = previewHolder.layoutParams.apply { height = if (show) dp(112) else 1 }
            previewHolder.importantForAccessibility = if (show) View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
                else View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            toggle.text = if (show) "Hide preview" else "Show preview"
            handle.contentDescription = "Drag gesture camera. Tap to ${if (show) "hide" else "show"} preview."
        }
        fun clampToDisplay() {
            if (closing || !view.isAttachedToWindow) return
            val bounds = safeBounds()
            if (expanded && view.height > bounds.height()) resizePreview(false)
            val width = minOf(dp(172), bounds.width())
            val x = layout.x.coerceIn(bounds.left, maxOf(bounds.left, bounds.right - width))
            val y = layout.y.coerceIn(bounds.top, maxOf(bounds.top, bounds.bottom - view.height))
            if (layout.width != width || layout.x != x || layout.y != y) {
                layout.width = width
                layout.x = x
                layout.y = y
                windows.updateViewLayout(view, layout)
            }
        }
        fun togglePreview() {
            resizePreview(!expanded)
            view.post { clampToDisplay() }
        }
        resizePreview(false)
        toggle.setOnClickListener { togglePreview() }
        handle.setOnClickListener { togglePreview() }
        val threshold = ViewConfiguration.get(this).scaledTouchSlop
        var touchX = 0f
        var touchY = 0f
        var startX = 0
        var startY = 0
        var dragging = false
        // Only the handle owns drag events. Stop and preview buttons remain normal clicks.
        handle.setOnTouchListener { target, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    touchX = event.rawX
                    touchY = event.rawY
                    startX = layout.x
                    startY = layout.y
                    dragging = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - touchX
                    val dy = event.rawY - touchY
                    if (hypot(dx.toDouble(), dy.toDouble()) > threshold) dragging = true
                    if (dragging && !closing) {
                        layout.x = startX + dx.roundToInt()
                        layout.y = startY + dy.roundToInt()
                        val bounds = safeBounds()
                        layout.x = layout.x.coerceIn(bounds.left, maxOf(bounds.left, bounds.right - view.width))
                        layout.y = layout.y.coerceIn(bounds.top, maxOf(bounds.top, bounds.bottom - view.height))
                        windows.updateViewLayout(view, layout)
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!dragging) target.performClick()
                    dragging = false
                    true
                }
                MotionEvent.ACTION_CANCEL -> { dragging = false; true }
                else -> false
            }
        }
        val displayListener = object : DisplayManager.DisplayListener {
            override fun onDisplayAdded(displayId: Int) {}
            override fun onDisplayRemoved(displayId: Int) {}
            override fun onDisplayChanged(displayId: Int) {
                if (view.display?.displayId == displayId) view.post { clampToDisplay() }
            }
        }
        view.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(attached: View) {
                displays.registerDisplayListener(displayListener, main)
            }
            override fun onViewDetachedFromWindow(detached: View) {
                displays.unregisterDisplayListener(displayListener)
            }
        })
        view.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> clampToDisplay() }
        windows.addView(view, layout)
        overlay = view
        view.post { clampToDisplay() }
    }

    private fun gestureLabel(gesture: GestureRecognition.Gesture): String = when (gesture) {
        GestureRecognition.Gesture.OPEN_PALM -> "Open palm"
        GestureRecognition.Gesture.PEACE -> "Peace sign"
        GestureRecognition.Gesture.THUMBS_UP -> "Thumbs up"
        GestureRecognition.Gesture.THUMBS_DOWN -> "Thumbs down"
        GestureRecognition.Gesture.POINT_UP -> "Point up"
        GestureRecognition.Gesture.LOVE -> "Thumb, index and little finger"
        GestureRecognition.Gesture.FIST -> "Closed fist · hold to stop"
        GestureRecognition.Gesture.UNKNOWN -> "Show one whole hand"
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
            } catch (error: Exception) {
                Log.e("GestureCamera", "Could not bind front camera", error)
                finish("Front camera unavailable. Close other camera apps and try again.")
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun analyze(image: ImageProxy) {
        var bitmap: Bitmap? = null
        var rotated: Bitmap? = null
        var input: MPImage? = null
        try {
            val now = SystemClock.uptimeMillis()
            val capturedAt = System.currentTimeMillis()
            if (closing || now - lastFrameAt < 66) return // about fifteen inferences/sec at 30 fps
            lastFrameAt = now
            bitmap = image.toBitmap() // CameraX handles row/pixel stride, including padding
            // Let MediaPipe rotate during preprocessing instead of allocating and
            // copying a second bitmap on every analysis frame.
            input = BitmapImageBuilder(bitmap).build()
            val options = ImageProcessingOptions.builder()
                .setRotationDegrees(image.imageInfo.rotationDegrees).build()
            val result = recognizer?.recognizeForVideo(input, options, now)
            val categories = result?.gestures()?.firstOrNull()?.sortedByDescending { it.score() }
            val category = categories?.firstOrNull()
            val runnerUp = categories?.getOrNull(1)?.score() ?: 0f
            val points = result?.landmarks()?.firstOrNull()?.map {
                GestureRecognition.uprightLandmark(it.x(), it.y(), it.z(),
                    image.imageInfo.rotationDegrees, bitmap.width, bitmap.height)
            } ?: emptyList()
            val handCount = result?.landmarks()?.size ?: 0
            val rawPose = GestureRecognition.recognize(category?.categoryName() ?: "",
                category?.score() ?: 0f, 0f)
            val minimum = if (rawPose == GestureRecognition.Gesture.FIST) maxOf(0.85f, confidence) else confidence
            val gesture = if (handCount == 1 && GestureRecognition.usableHand(points))
                GestureRecognition.recognize(category?.categoryName() ?: "",
                    category?.score() ?: 0f, minimum, runnerUp)
                else GestureRecognition.Gesture.UNKNOWN
            if (photoAt > 0 && now >= photoAt && gesture != GestureRecognition.Gesture.FIST) {
                photoAt = 0
                val token = photoToken
                rotated = if (image.imageInfo.rotationDegrees == 0) bitmap else {
                    val matrix = Matrix().apply { postRotate(image.imageInfo.rotationDegrees.toFloat()) }
                    Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
                }
                val saved = saveSnapshot(rotated, token)
                main.post {
                    if (token != photoToken) return@post
                    photoDone?.invoke(saved.first, saved.second)
                    photoDone = null
                    if (!closing) state = state.copy(summary = saved.second)
                }
            }
            failures = 0
            val event = latch.update(gesture, now, neutral = handCount == 0)
            main.post {
                if (closing) return@post
                main.removeCallbacks(startupTimeout)
                if (!state.running) {
                    state = state.copy(running = true, starting = false, summary = "Hold a gesture for a moment.")
                }
                state = state.copy(frameSeq = state.frameSeq + 1, observedAt = capturedAt,
                    pose = rawPose.name, score = category?.score() ?: 0f, landmarks = points,
                    handCount = handCount, runnerUpScore = runnerUp)
                if (photoDone == null) {
                    val label = when (gesture) {
                        GestureRecognition.Gesture.UNKNOWN -> when {
                            handCount > 1 -> "Show only one hand"
                            handCount == 0 -> "Ready. Raise one hand"
                            else -> "Pose unclear. Show your whole hand"
                        }
                        else -> gestureLabel(gesture)
                    }
                    if (statusText.text.toString() != label) statusText.text = label
                }
                if (event != null) {
                    state = state.copy(seq = state.seq + 1, gesture = event.name,
                        detectedAt = System.currentTimeMillis())
                    if (event == GestureRecognition.Gesture.FIST) finish("Camera stopped by closed fist.")
                }
            }
        } catch (error: LinkageError) {
            Log.e("GestureCamera", "Gesture runtime could not process a camera frame", error)
            main.post { finish("Gesture recognition could not load. Restart JARVIS and try again.") }
        } catch (error: Exception) {
            if (failures == 0) Log.e("GestureCamera", "Could not recognize camera frame", error)
            failures++
            if (failures >= 5) main.post { finish("Gesture recognition failed. Restart the camera to try again.") }
        } finally {
            if (rotated !== bitmap) rotated?.recycle()
            // MPImage owns the bitmap. Keep it alive through an explicit photo.
            input?.close()
            if (input == null) bitmap?.recycle()
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
        worker.execute {
            try {
                recognizer?.close()
            } catch (error: Exception) {
                Log.e("GestureCamera", "Could not close gesture model", error)
            } catch (error: LinkageError) {
                Log.e("GestureCamera", "Gesture runtime unavailable during cleanup", error)
            } finally {
                recognizer = null
            }
        }
        worker.shutdown()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}
