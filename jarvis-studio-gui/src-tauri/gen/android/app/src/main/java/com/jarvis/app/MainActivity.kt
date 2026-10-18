package com.jarvis.app

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import com.jarvis.phone.RoutineAlarms

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // The UI is always dark. The default (auto) style follows the SYSTEM theme, so a
    // phone in light mode drew dark status-bar icons on the dark HUD — unreadable.
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)
    RoutineAlarms.takeTap(intent)
  }

  // A routine notification's tap is taken here, not in PhonePlugin: Tauri registers its
  // plugins only after the WebView starts, and a tap that brings a killed JARVIS back
  // arrives as onNewIntent before that, so the plugin never saw it (2026-10-18, live).
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    RoutineAlarms.takeTap(intent)
  }
}
