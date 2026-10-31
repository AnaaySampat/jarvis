
package com.jarvis.phone

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView

import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService

import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarkerResult

import android.graphics.Bitmap
import java.util.concurrent.Executors

class GestureCameraService : LifecycleService() {

    companion object {
        const val ACTION_START = "com.jarvis.phone.GESTURE_START"
        const val ACTION_STOP = "com.jarvis.phone.GESTURE_STOP"

        @Volatile
        var onGesture: ((GestureRecognition.Gesture) -> Unit)? = null
    }

    private lateinit var windowManager: WindowManager
    private lateinit var previewView: PreviewView
    private lateinit var statusText: TextView

    private var overlay: LinearLayout? = null
    private var landmarker: HandLandmarker? = null

    private val cameraExecutor =
        Executors.newSingleThreadExecutor()

    private var lastGesture =
        GestureRecognition.Gesture.UNKNOWN

    private var lastGestureTime = 0L

    override fun onCreate() {
        super.onCreate()
        windowManager =
            getSystemService(Context.WINDOW_SERVICE) as WindowManager
    }

    override fun onStartCommand(
        intent: Intent?,
        flags: Int,
        startId: Int
    ): Int {

        super.onStartCommand(intent, flags, startId)

        when (intent?.action) {
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }

            ACTION_START, null -> {
                startCameraForeground()
                createOverlay()
                createLandmarker()
                startCamera()
            }
        }

        return START_NOT_STICKY
    }

    private fun startCameraForeground() {
        val channelId = "jarvis_gesture_camera"

        val manager = getSystemService(
            NotificationManager::class.java
        )

        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(
                NotificationChannel(
                    channelId,
                    "JARVIS Gesture Camera",
                    NotificationManager.IMPORTANCE_LOW
                )
            )
        }

        val notification: Notification =
            NotificationCompat.Builder(this, channelId)
                .setContentTitle("JARVIS Gesture Recognition")
                .setContentText("Camera hand tracking is active")
                .setSmallIcon(android.R.drawable.ic_menu_camera)
                .setOngoing(true)
                .build()

        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                701,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
            )
        } else {
            startForeground(701, notification)
        }
    }

    private fun createOverlay() {
        previewView = PreviewView(this)

        statusText = TextView(this).apply {
            text = "JARVIS: Waiting for hand..."
            textSize = 13f
            setTextColor(Color.WHITE)
            setPadding(12, 8, 12, 8)
            setBackgroundColor(Color.rgb(20, 25, 35))
        }

        overlay = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.BLACK)
            addView(
                previewView,
                LinearLayout.LayoutParams(
                    280, 190
                )
            )
            addView(
                statusText,
                LinearLayout.LayoutParams(
                    280,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                )
            )
        }

        val params = WindowManager.LayoutParams(
            280,
            WindowManager.LayoutParams.WRAP_CONTENT,
            if (Build.VERSION.SDK_INT >= 26)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else
                WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.END
            x = 16
            y = 120
        }

        windowManager.addView(overlay, params)
    }

    private fun createLandmarker() {
        try {
            val options = HandLandmarker.HandLandmarkerOptions.builder()
                .setBaseOptions(
                    BaseOptions.builder()
                        .setModelAssetPath("hand_landmarker.task")
                        .build()
                )
                .setRunningMode(RunningMode.IMAGE)
                .setNumHands(1)
                .build()

            landmarker = HandLandmarker.createFromOptions(
                this,
                options
            )

        } catch (e: Exception) {
            statusText.text =
                "MediaPipe error: ${e.message}"
        }
    }

    private fun startCamera() {
        val providerFuture =
            ProcessCameraProvider.getInstance(this)

        providerFuture.addListener({

            try {
                val provider = providerFuture.get()

                val preview = Preview.Builder()
                    .build()
                    .also {
                        it.setSurfaceProvider(
                            previewView.surfaceProvider
                        )
                    }

                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(
                        ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST
                    )
                    .setOutputImageFormat(
                        ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888
                    )
                    .build()

                analysis.setAnalyzer(cameraExecutor) { image ->

                    try {
                        val bitmap = Bitmap.createBitmap(
                            image.width,
                            image.height,
                            Bitmap.Config.ARGB_8888
                        )

                        bitmap.copyPixelsFromBuffer(
                            image.planes[0].buffer
                        )

                        val rotated = rotateBitmap(
                            bitmap,
                            image.imageInfo.rotationDegrees
                        )

                        val mpImage =
                            BitmapImageBuilder(rotated).build()

                        val result = landmarker?.detect(mpImage)

                        if (result != null) {
                            processResult(result)
                        }

                        mpImage.close()
                        rotated.recycle()
                        bitmap.recycle()

                    } catch (e: Exception) {
                        android.util.Log.e(
                            "JarvisGesture",
                            "Frame error",
                            e
                        )
                    } finally {
                        image.close()
                    }
                }

                provider.unbindAll()

                provider.bindToLifecycle(
                    this,
                    CameraSelector.DEFAULT_FRONT_CAMERA,
                    preview,
                    analysis
                )

            } catch (e: Exception) {
                android.util.Log.e(
                    "JarvisGesture",
                    "Camera failed",
                    e
                )
                statusText.post {
                    statusText.text = "Camera unavailable"
                }
            }

        }, ContextCompat.getMainExecutor(this))
    }

    private fun rotateBitmap(
        source: Bitmap,
        degrees: Int
    ): Bitmap {
        if (degrees == 0) return source

        val matrix = android.graphics.Matrix().apply {
            postRotate(degrees.toFloat())
        }

        return Bitmap.createBitmap(
            source,
            0,
            0,
            source.width,
            source.height,
            matrix,
            true
        )
    }

    private fun processResult(
        result: HandLandmarkerResult
    ) {
        if (result.landmarks().isEmpty()) {
            statusText.post {
                statusText.text = "Waiting for hand..."
            }
            return
        }

        val gesture = GestureRecognition.recognize(
            result.landmarks()[0]
        )

        statusText.post {
            statusText.text = "JARVIS: ${gesture.name}"
        }

        val now = System.currentTimeMillis()

        // Avoid repeating the same voice response every frame.
        if (
            gesture != GestureRecognition.Gesture.UNKNOWN &&
            (gesture != lastGesture || now - lastGestureTime > 2500)
        ) {
            lastGesture = gesture
            lastGestureTime = now

            onGesture?.invoke(gesture)
        }
    }

    override fun onDestroy() {
        try {
            val provider =
                ProcessCameraProvider.getInstance(this).get()

            provider.unbindAll()
        } catch (_: Exception) {
        }

        landmarker?.close()
        landmarker = null

        overlay?.let {
            try {
                windowManager.removeView(it)
            } catch (_: Exception) {
            }
        }

        overlay = null
        cameraExecutor.shutdown()

        super.onDestroy()
    }
}
