package com.jarvis.phone

import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Exports are rebuilt from a closed vocabulary, never a log or checkpoint dump. */
internal object DiagnosticExportPolicy {
    private val states = setOf("queued", "running", "needs_you", "completed", "partial", "failed", "cancelled")
    private val categories = setOf("connection", "compatibility", "permission", "provider", "connector", "background", "storage")
    fun sanitize(raw: String): String {
        require(raw.length <= 100_000) { "Diagnostics are too large" }
        val source = JSONObject(raw)
        require(source.optInt("version") == 1)
        val out = JSONObject().put("version", 1)
        val versions = JSONObject()
        val inputVersions = source.optJSONObject("versions") ?: JSONObject()
        for (key in listOf("android", "windows", "contract")) {
            val value = inputVersions.optString(key)
            if (Regex("[0-9]{1,3}(\\.[0-9]{1,3}){0,3}([+-][a-z0-9.]{1,24})?").matches(value)) versions.put(key, value)
        }
        out.put("versions", versions)
        val issues = JSONArray()
        val inputIssues = source.optJSONArray("categories") ?: JSONArray()
        for (i in 0 until minOf(inputIssues.length(), 30)) {
            val category = inputIssues.optString(i)
            if (category in categories) issues.put(category)
        }
        out.put("categories", issues)
        val tasks = JSONArray()
        val inputTasks = source.optJSONArray("tasks") ?: JSONArray()
        for (i in 0 until minOf(inputTasks.length(), 100)) {
            val row = inputTasks.optJSONObject(i) ?: continue
            val status = row.optString("status")
            if (status !in states) continue
            val task = JSONObject().put("id", "task-${i + 1}").put("status", status)
            for (key in listOf("elapsed_ms", "tool_calls", "model_decisions", "unverified_results")) {
                val value = row.optLong(key, -1)
                if (value in 0..604_800_000L) task.put(key, value)
            }
            task.put("provider_cost", JSONObject.NULL)
            tasks.put(task)
        }
        return out.put("tasks", tasks).toString(2)
    }
}

internal object EcosystemHealth {
    fun status(context: Context, accessibility: Boolean): JSONObject {
        fun granted(permission: String) = ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
        val permissions = JSONObject()
            .put("microphone", granted(Manifest.permission.RECORD_AUDIO))
            .put("calendar", granted(Manifest.permission.READ_CALENDAR) && granted(Manifest.permission.WRITE_CALENDAR))
            .put("accessibility", accessibility)
            .put("notificationAccess", NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName))
            .put("notifications", NotificationManagerCompat.from(context).areNotificationsEnabled())
        val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        return JSONObject().put("ok", true)
            .put("appVersion", context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "")
            .put("sdk", Build.VERSION.SDK_INT).put("permissions", permissions)
            .put("batteryExempt", power.isIgnoringBatteryOptimizations(context.packageName))
            .put("backgroundRestricted", Build.VERSION.SDK_INT >= 28 && activityManager.isBackgroundRestricted)
            .put("wakeListening", WakeWordService.isListening)
            .put("portableBackground", false)
    }

    fun export(context: Context, raw: String) {
        val file = File(context.cacheDir, "jarvis-diagnostics.json")
        file.writeText(DiagnosticExportPolicy.sanitize(raw))
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val share = Intent(Intent.ACTION_SEND).setType("application/json")
            .putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(Intent.createChooser(share, "Export JARVIS diagnostics").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
