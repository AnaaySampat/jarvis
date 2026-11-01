package com.jarvis.gesturesmoke

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.widget.TextView
import com.jarvis.phone.GestureCameraService

/** Runs inside the optimized app, so a separate instrumentation APK cannot hide
 * or introduce problems with the minified Kotlin/runtime dependency graph. */
class SmokeActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var label: TextView
    private var cycle = 0
    private var phase = "idle"
    private var deadline = 0L
    private var firstFrame = 0
    private val poll = object : Runnable {
        override fun run() {
            val state = GestureCameraService.state
            when (phase) {
                "starting" -> {
                    if (!state.starting && !state.running) { fail(state.summary); return }
                    if (state.running) {
                        firstFrame = state.frameSeq
                        phase = "frames"
                        deadline = SystemClock.uptimeMillis() + 5_000
                    }
                }
                "frames" -> if (state.frameSeq > firstFrame) {
                    stopService(Intent(this@SmokeActivity, GestureCameraService::class.java))
                    phase = "stopping"
                    deadline = SystemClock.uptimeMillis() + 5_000
                }
                "stopping" -> if (!state.starting && !state.running) {
                    cycle++
                    if (cycle == 2) {
                        phase = "done"
                        label.text = "PASS: Camera delivered recognized frames and restarted."
                        Log.i("GestureCameraSmoke", label.text.toString())
                    } else {
                        phase = "idle"
                        handler.postDelayed({ startCamera() }, 250)
                    }
                    return
                }
                else -> return
            }
            if (SystemClock.uptimeMillis() >= deadline) { fail("Timed out in $phase: ${state.summary}"); return }
            handler.postDelayed(this, 100)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        label = TextView(this).apply { text = "Starting release camera smoke test..." }
        setContentView(label)
        // Wait for the activity to be visible for Android's while-in-use grant.
        handler.postDelayed({ startCamera() }, 500)
    }

    private fun startCamera() {
        if (!GestureCameraService.prepareStart()) { fail("Camera was already active"); return }
        try {
            val intent = Intent(this, GestureCameraService::class.java).setAction(GestureCameraService.ACTION_START)
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent) else startService(intent)
            phase = "starting"
            deadline = SystemClock.uptimeMillis() + 25_000
            handler.post(poll)
        } catch (error: Exception) { fail(error.toString()) }
    }

    private fun fail(message: String) {
        phase = "done"
        stopService(Intent(this, GestureCameraService::class.java))
        label.text = "FAIL: $message"
        Log.e("GestureCameraSmoke", label.text.toString())
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        stopService(Intent(this, GestureCameraService::class.java))
        super.onDestroy()
    }
}
