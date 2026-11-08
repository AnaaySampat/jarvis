package com.jarvis.phone

import android.app.Activity
import android.app.Application
import android.app.DownloadManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject

/** All entry points use the same lock and durable state, including workers and receivers. */
internal object AppUpdates {
    private const val PERIOD = 6 * 60 * 60 * 1000L
    private const val NOTIFICATION = 7460
    private const val CHANNEL = "jarvis_app_updates"
    @Volatile var foreground = false
    @Volatile var listener: (() -> Unit)? = null
    private var registered = false
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("app_updates_v1", Context.MODE_PRIVATE)
    private fun state(ctx: Context) = runCatching { JSONObject(prefs(ctx).getString("state", "{}")!!) }.getOrDefault(JSONObject())
    private fun save(ctx: Context, value: JSONObject) { prefs(ctx).edit().putString("state", value.toString()).commit(); runCatching { listener?.invoke() } }
    @Suppress("DEPRECATION")
    private fun installed(ctx: Context): PackageInfo = ctx.packageManager.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNATURES or if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else 0)
    @Suppress("DEPRECATION")
    private fun code(info: PackageInfo) = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
    private fun manager(ctx: Context) = ctx.getSystemService(DownloadManager::class.java)
    private fun file(ctx: Context) = File(ctx.getExternalFilesDir(null) ?: error("Download storage is unavailable."), "updates/update.apk")

    @Synchronized fun initialize(activity: Activity) {
        foreground = activity.hasWindowFocus()
        if (!registered) {
            registered = true
            activity.application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
                override fun onActivityResumed(a: Activity) { if (a.javaClass.name == "com.jarvis.app.MainActivity") foreground = true }
                override fun onActivityPaused(a: Activity) { if (a.javaClass.name == "com.jarvis.app.MainActivity") foreground = false }
                override fun onActivityCreated(a: Activity, b: Bundle?) {}
                override fun onActivityStarted(a: Activity) {}
                override fun onActivityStopped(a: Activity) {}
                override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
                override fun onActivityDestroyed(a: Activity) {}
            })
        }
        schedule(activity)
    }

    private fun schedule(ctx: Context) {
        val wm = WorkManager.getInstance(ctx)
        if (!prefs(ctx).getBoolean("automatic", true)) { wm.cancelUniqueWork("jarvis-app-updates"); return }
        wm.enqueueUniquePeriodicWork("jarvis-app-updates", ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<AppUpdateWorker>(6, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
    }

    private fun clearDownload(ctx: Context, s: JSONObject) {
        val session = s.optInt("sessionId", -1)
        if (session >= 0) runCatching { ctx.packageManager.packageInstaller.abandonSession(session) }
        s.remove("sessionId")
        val id = s.optLong("downloadId", -1)
        if (id >= 0) manager(ctx).remove(id)
        file(ctx).delete()
        s.remove("downloadId"); s.remove("progress"); s.remove("verified")
    }

    @Synchronized fun command(ctx: Context, activity: Activity?, action: String, options: JSONObject): JSONObject {
        val p = prefs(ctx)
        try {
            when (action) {
                "check" -> check(ctx, options.optBoolean("force"))
                "preferences" -> {
                    val oldChannel = p.getString("channel", "stable") ?: "stable"
                    val channel = options.optString("channel", oldChannel)
                    require(channel == "stable" || channel == "beta")
                    val edit = p.edit().putString("channel", channel)
                    for (key in listOf("automatic", "autoDownload")) if (options.has(key)) edit.putBoolean(key, options.getBoolean(key))
                    if (oldChannel != channel) {
                        val s = state(ctx); clearDownload(ctx, s); save(ctx, JSONObject())
                        edit.remove("checkedAt").remove("retryAt").remove("etag").remove("response").remove("notified")
                        ctx.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION)
                    }
                    edit.commit(); schedule(ctx)
                }
                "download" -> { requireRelease(ctx, options); download(ctx, false) }
                "cancel" -> { val s = state(ctx); clearDownload(ctx, s); s.put("phase", "available").remove("error"); save(ctx, s) }
                "snooze", "skip" -> {
                    val s = state(ctx)
                    if (action == "skip") s.put("skipped", s.optJSONObject("release")?.optString("id"))
                    else s.put("snoozedUntil", System.currentTimeMillis() + TimeUnit.DAYS.toMillis(1))
                    save(ctx, s); ctx.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION)
                }
                "open" -> { val s = state(ctx); s.remove("skipped"); s.remove("snoozedUntil"); save(ctx, s) }
                "install" -> { requireRelease(ctx, options); require(activity != null && foreground) { "Open JARVIS to install the update." }; install(ctx, activity) }
                "status" -> Unit
                "foreground" -> { foreground = options.optBoolean("visible") }
                else -> error("Unknown update action.")
            }
        } catch (e: Exception) {
            val s = state(ctx); s.put("error", e.message ?: "The update could not be completed.")
            if (s.optString("phase") == "installing") s.put("phase", "ready")
            save(ctx, s)
        }
        val result = status(ctx)
        val opened = p.getBoolean("open", false)
        if (opened) p.edit().putBoolean("open", false).commit()
        return result.put("openRequested", opened)
    }

    private fun requireRelease(ctx: Context, options: JSONObject) {
        require(options.getString("releaseId") == state(ctx).getJSONObject("release").getString("id")) { "This update has changed. Check again." }
    }

    /** HTTPS only; the initial URL is fixed or validated before calling. */
    private fun json(ctx: Context, url: String, discovery: Boolean = false): String {
        var current = url
        repeat(5) {
            val connection = URL(current).openConnection() as HttpURLConnection
            try {
                connection.instanceFollowRedirects = false; connection.connectTimeout = 10000; connection.readTimeout = 10000
                connection.setRequestProperty("User-Agent", "JARVIS-Android-Updater")
                connection.setRequestProperty("Accept", if (discovery) "application/vnd.github+json" else "application/json")
                if (discovery) prefs(ctx).getString("etag", null)?.let { connection.setRequestProperty("If-None-Match", it) }
                val response = connection.responseCode
                if (response == 304 && discovery) return prefs(ctx).getString("response", null) ?: error("No cached release data.")
                if (response in 300..399) {
                    val next = URL(URL(current), connection.getHeaderField("Location") ?: error("Invalid redirect."))
                    require(next.protocol == "https" && next.userInfo == null && (next.port == -1 || next.port == 443) &&
                        next.host in setOf("github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com")) { "Untrusted download redirect." }
                    current = next.toString()
                } else {
                    if (response == 403 || response == 429) {
                        val reset = connection.getHeaderField("X-RateLimit-Reset")?.toLongOrNull()?.times(1000)
                        val retry = connection.getHeaderField("Retry-After")?.toLongOrNull()?.times(1000)?.plus(System.currentTimeMillis())
                        prefs(ctx).edit().putLong("retryAt", maxOf(reset ?: 0, retry ?: 0, System.currentTimeMillis() + TimeUnit.MINUTES.toMillis(15))).commit()
                    }
                    require(response in 200..299) { "Update server returned HTTP $response. Try again later." }
                    val bytes = connection.inputStream.use { it.readBytesLimited(1024 * 1024) }
                    val result = bytes.toString(Charsets.UTF_8)
                    if (discovery) prefs(ctx).edit().putString("etag", connection.getHeaderField("ETag")).putString("response", result).commit()
                    return result
                }
            } finally { connection.disconnect() }
        }
        error("Too many update redirects.")
    }

    private fun java.io.InputStream.readBytesLimited(limit: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
        while (true) { val n = read(buffer); if (n < 0) break; require(out.size() + n <= limit) { "Update metadata is too large." }; out.write(buffer, 0, n) }
        return out.toByteArray()
    }

    @Synchronized fun check(ctx: Context, force: Boolean = false) {
        val p = prefs(ctx); val now = System.currentTimeMillis()
        if ((!force && (!p.getBoolean("automatic", true) || now - p.getLong("checkedAt", 0) < PERIOD)) || now < p.getLong("retryAt", 0)) return
        val previous = state(ctx)
        if (previous.optString("phase") in setOf("downloading", "installing", "awaiting_confirmation")) return
        try {
            val beta = p.getString("channel", "stable") == "beta"
            val raw = json(ctx, "https://api.github.com/repos/AnaaySampat/jarvis/releases" + if (beta) "?per_page=20" else "/latest", true)
            val releases = if (beta) JSONArray(raw) else JSONArray().put(JSONObject(raw))
            val current = installed(ctx)
            var chosen: JSONObject? = null
            var legacy: JSONObject? = null
            val ordered = (0 until releases.length()).map { releases.getJSONObject(it) }.sortedWith { left, right ->
                when {
                    UpdateManifest.newer(left.optString("tag_name"), right.optString("tag_name")) -> -1
                    UpdateManifest.newer(right.optString("tag_name"), left.optString("tag_name")) -> 1
                    else -> 0
                }
            }
            for (release in ordered) {
                if (release.optBoolean("draft") || (!beta && release.optBoolean("prerelease"))) continue
                val tag = release.optString("tag_name")
                if (!UpdateManifest.newer(tag, current.versionName ?: "0.0.0")) continue
                val page = release.optString("html_url")
                if (!UpdateManifest.releaseUrl(page)) continue
                val assets = release.optJSONArray("assets") ?: JSONArray()
                val metadata = (0 until assets.length()).map { assets.getJSONObject(it) }.firstOrNull { it.optString("name") == "android-update.json" }
                if (metadata == null) {
                    val candidate = JSONObject().put("id", tag).put("versionName", tag.removePrefix("v")).put("url", page).put("legacy", true).put("features", JSONArray()).put("fixes", JSONArray())
                    if (legacy == null || UpdateManifest.newer(tag, legacy.getString("versionName"))) legacy = candidate
                    continue
                }
                val url = metadata.getString("browser_download_url")
                require(UpdateManifest.assetUrl(url, tag)) { "Untrusted update metadata URL." }
                val manifest = UpdateManifest.validate(JSONObject(json(ctx, url)), tag, release.optBoolean("prerelease"))
                if (manifest.getLong("versionCode") <= code(current)) continue
                val candidates = manifest.getJSONArray("assets")
                val asset = Build.SUPPORTED_ABIS.firstNotNullOfOrNull { abi ->
                    (0 until candidates.length()).map { candidates.getJSONObject(it) }.firstOrNull { it.getString("abi") == abi }
                }
                manifest.put("id", tag).put("url", page)
                if (asset == null || manifest.getInt("minSdk") > Build.VERSION.SDK_INT) manifest.put("incompatible", true)
                else {
                    // Bind the manifest to an APK actually attached to this exact release.
                    require((0 until assets.length()).any { assets.getJSONObject(it).optString("browser_download_url") == asset.getString("url") && assets.getJSONObject(it).optLong("size") == asset.getLong("size") }) { "The release APK does not match its metadata." }
                    manifest.put("asset", asset)
                }
                if (chosen == null || (chosen.optBoolean("incompatible") && !manifest.optBoolean("incompatible")) ||
                    (chosen.optBoolean("incompatible") == manifest.optBoolean("incompatible") && manifest.getLong("versionCode") > chosen.getLong("versionCode"))) chosen = manifest
                if (!manifest.optBoolean("incompatible")) break
            }
            val candidate = chosen ?: legacy
            if (candidate == null && previous.has("release")) {
                clearDownload(ctx, previous); save(ctx, JSONObject())
                ctx.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION)
            } else if (candidate != null && candidate.optString("id") != previous.optJSONObject("release")?.optString("id")) {
                clearDownload(ctx, previous)
                save(ctx, JSONObject().put("release", candidate).put("phase", "available"))
            } else { previous.remove("error"); save(ctx, previous) }
            p.edit().putLong("checkedAt", now).remove("retryAt").putInt("failures", 0).commit()
            if (p.getBoolean("autoDownload", false) && state(ctx).optString("phase") == "available" && eligible(ctx)) download(ctx, true)
        } catch (e: Exception) {
            val attempts = (p.getInt("failures", 0) + 1).coerceAtMost(6)
            p.edit().putInt("failures", attempts).putLong("retryAt", maxOf(p.getLong("retryAt", 0), now + TimeUnit.MINUTES.toMillis(5L shl (attempts - 1)))).commit()
            previous.put("error", e.message ?: "Couldn't check for updates."); save(ctx, previous)
        }
    }

    private fun eligible(ctx: Context): Boolean {
        val s = state(ctx)
        return s.optString("skipped") != s.optJSONObject("release")?.optString("id") && s.optLong("snoozedUntil") <= System.currentTimeMillis()
    }

    private fun download(ctx: Context, wifi: Boolean) {
        val s = state(ctx); val release = s.getJSONObject("release")
        require(!release.optBoolean("legacy") && !release.optBoolean("incompatible")) { "This release cannot be installed on this device." }
        if (s.optString("phase") in setOf("downloading", "ready", "awaiting_confirmation", "installing")) return
        val asset = release.getJSONObject("asset")
        clearDownload(ctx, s); file(ctx).parentFile!!.mkdirs()
        val request = DownloadManager.Request(Uri.parse(asset.getString("url")))
            .setTitle("JARVIS ${release.getString("versionName")}").setDescription("Downloading app update")
            .setDestinationUri(Uri.fromFile(file(ctx))).setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setAllowedOverMetered(!wifi).setAllowedOverRoaming(false)
        if (wifi) request.setAllowedNetworkTypes(DownloadManager.Request.NETWORK_WIFI)
        s.put("downloadId", manager(ctx).enqueue(request)).put("phase", "downloading").remove("error")
        save(ctx, s)
    }

    @Suppress("DEPRECATION")
    private fun signers(info: PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
        return signatures?.map { it.toCharsString() }?.toSet() ?: emptySet()
    }

    @Suppress("DEPRECATION")
    private fun verify(ctx: Context, s: JSONObject) {
        val release = s.getJSONObject("release"); val asset = release.getJSONObject("asset"); val apk = file(ctx)
        require(apk.length() == asset.getLong("size")) { "The APK download is incomplete. Download it again." }
        val digest = MessageDigest.getInstance("SHA-256")
        apk.inputStream().use { input -> val bytes = ByteArray(65536); while (true) { val n = input.read(bytes); if (n < 0) break; digest.update(bytes, 0, n) } }
        UpdateManifest.verifyPayload(asset, apk.length(), digest.digest().joinToString("") { "%02x".format(it) })
        val info = ctx.packageManager.getPackageArchiveInfo(apk.absolutePath, PackageManager.GET_SIGNATURES or if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else 0) ?: error("The APK is invalid.")
        val current = installed(ctx)
        fun identity(value: PackageInfo) = UpdateManifest.ApkIdentity(value.packageName, value.versionName ?: "", code(value), value.applicationInfo?.minSdkVersion ?: 24, signers(value))
        UpdateManifest.verifyIdentity(release, identity(current), identity(info), Build.VERSION.SDK_INT)
    }

    @Synchronized fun status(ctx: Context): JSONObject {
        val s = state(ctx); val current = installed(ctx); val release = s.optJSONObject("release")
        if (release != null && !UpdateManifest.newer(release.optString("versionName"), current.versionName ?: "0.0.0")) {
            clearDownload(ctx, s)
            val recap = release.optString("versionName")
            save(ctx, JSONObject().put("updatedTo", recap)); ctx.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION)
            return status(ctx)
        }
        if (s.optString("phase") == "downloading") {
            manager(ctx).query(DownloadManager.Query().setFilterById(s.optLong("downloadId"))).use { cursor ->
                if (!cursor.moveToFirst()) { s.put("phase", "available").put("error", "The download was removed. Try again."); save(ctx, s) }
                else when (cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))) {
                    DownloadManager.STATUS_SUCCESSFUL -> {
                        try { verify(ctx, s); s.put("phase", "ready").put("verified", true).remove("error") }
                        catch (e: Exception) { clearDownload(ctx, s); s.put("phase", "available").put("error", e.message) }
                        save(ctx, s)
                    }
                    DownloadManager.STATUS_FAILED -> { clearDownload(ctx, s); s.put("phase", "available").put("error", "Download failed. Check your connection and free storage, then retry."); save(ctx, s) }
                    else -> {
                        s.put("downloaded", cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)))
                        s.put("total", cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)))
                    }
                }
            }
        }
        if (s.optString("phase") == "ready" && !file(ctx).exists()) { s.put("phase", "available").remove("verified"); save(ctx, s) }
        if (s.optString("phase") in setOf("installing", "awaiting_confirmation") && ctx.packageManager.packageInstaller.getSessionInfo(s.optInt("sessionId", -1)) == null) {
            s.put("phase", if (file(ctx).exists()) "ready" else "available").put("error", "Installation didn't finish. You can try again.")
            s.remove("sessionId"); save(ctx, s)
        }
        val p = prefs(ctx)
        s.put("currentVersion", current.versionName).put("currentCode", code(current))
            .put("channel", p.getString("channel", "stable")).put("automatic", p.getBoolean("automatic", true))
            .put("autoDownload", p.getBoolean("autoDownload", false)).put("checkedAt", p.getLong("checkedAt", 0))
            .put("retryAt", p.getLong("retryAt", 0)).put("eligible", eligible(ctx))
        return s
    }

    private fun install(ctx: Context, activity: Activity) {
        val s = state(ctx)
        require(s.optString("phase") in setOf("ready", "awaiting_permission", "awaiting_confirmation")) { "Download and verify the update first." }
        verify(ctx, s)
        val previousSession = s.optInt("sessionId", -1)
        if (previousSession >= 0) runCatching { ctx.packageManager.packageInstaller.abandonSession(previousSession) }
        s.remove("sessionId")
        if (Build.VERSION.SDK_INT >= 26 && !ctx.packageManager.canRequestPackageInstalls()) {
            s.put("phase", "awaiting_permission"); save(ctx, s)
            activity.runOnUiThread { activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}"))) }
            return
        }
        if (Build.VERSION.SDK_INT < 26 && Settings.Secure.getInt(ctx.contentResolver, Settings.Secure.INSTALL_NON_MARKET_APPS, 0) == 0) {
            s.put("phase", "awaiting_permission"); save(ctx, s)
            activity.runOnUiThread { activity.startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS)) }; return
        }
        require(foreground) { "Return to JARVIS to continue installation." }
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(ctx.packageName); setSize(file(ctx).length())
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
        }
        val sessionId = installer.createSession(params)
        try {
            installer.openSession(sessionId).use { session ->
                file(ctx).inputStream().use { input -> session.openWrite("update.apk", 0, file(ctx).length()).use { output -> input.copyTo(output); session.fsync(output) } }
                val intent = Intent(ctx, AppUpdateInstallReceiver::class.java).setAction("${ctx.packageName}.UPDATE_RESULT")
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
                val callback = PendingIntent.getBroadcast(ctx, sessionId, intent, flags)
                s.put("phase", "installing").put("sessionId", sessionId).remove("error"); save(ctx, s)
                session.commit(callback.intentSender)
            }
        } catch (e: Exception) { installer.abandonSession(sessionId); throw e }
    }

    private fun notification(ctx: Context, intent: Intent, text: String, token: String) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel(CHANNEL, "App updates", NotificationManager.IMPORTANCE_DEFAULT))
        if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return
        val pi = PendingIntent.getActivity(ctx, NOTIFICATION, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        try {
            nm.notify(NOTIFICATION, NotificationCompat.Builder(ctx, CHANNEL).setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle("JARVIS update").setContentText(text).setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(pi).setAutoCancel(true).setOnlyAlertOnce(true).build())
            prefs(ctx).edit().putString("notified", token).commit()
        } catch (_: SecurityException) { /* The foreground popup works without notification permission. */ }
    }

    @Synchronized fun notifyAvailable(ctx: Context) {
        val s = status(ctx); val release = s.optJSONObject("release") ?: return
        if (foreground || !eligible(ctx) || release.optBoolean("incompatible")) return
        val token = release.getString("id") + ":" + s.optString("phase")
        if (prefs(ctx).getString("notified", "") == token) return
        val count = release.optJSONArray("features")?.length() ?: 0
        val detail = if (s.optString("phase") == "ready") "Ready to install" else if (count > 0) "$count new ${if (count == 1) "feature" else "features"}" else "Improvements and fixes"
        notification(ctx, Intent(ctx, AppUpdateEntryActivity::class.java), "JARVIS ${release.getString("versionName")} is available — $detail", token)
    }

    @Synchronized fun installerResult(ctx: Context, intent: Intent) {
        val s = state(ctx)
        if (intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1) != s.optInt("sessionId", -2)) return
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION") val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                s.put("phase", "awaiting_confirmation"); save(ctx, s)
                val next = Intent(ctx, AppUpdateEntryActivity::class.java).putExtra("confirmation", confirm).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                if (foreground) runCatching { ctx.startActivity(next) }.onFailure { notification(ctx, next, "Tap to confirm the JARVIS update", "confirm") }
                else notification(ctx, next, "Tap to confirm the JARVIS update", "confirm")
            }
            PackageInstaller.STATUS_SUCCESS -> { save(ctx, s.put("phase", "installed")); status(ctx) }
            else -> {
                val message = when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, 1)) {
                    PackageInstaller.STATUS_FAILURE_ABORTED -> "Installation cancelled. Your download is ready when you are."
                    PackageInstaller.STATUS_FAILURE_STORAGE -> "Not enough storage to install the update. Free space and try again."
                    PackageInstaller.STATUS_FAILURE_CONFLICT -> "Android rejected the package or signing key. Keep the installed app."
                    PackageInstaller.STATUS_FAILURE_BLOCKED -> "Android blocked installation. Review the system installer message and permissions."
                    else -> "Android couldn't install the update. You can try again."
                }
                s.put("phase", "ready").put("error", message); save(ctx, s)
            }
        }
    }

    @Synchronized fun requestOpen(ctx: Context) { prefs(ctx).edit().putBoolean("open", true).commit() }
}

class AppUpdateWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result { AppUpdates.check(applicationContext); AppUpdates.notifyAvailable(applicationContext); return Result.success() }
}

class AppUpdateDownloadReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return
        val saved = runCatching { JSONObject(context.getSharedPreferences("app_updates_v1", Context.MODE_PRIVATE).getString("state", "{}")!!) }.getOrDefault(JSONObject())
        if (intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) != saved.optLong("downloadId", -2)) return
        WorkManager.getInstance(context).enqueueUniqueWork("jarvis-update-download", ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<AppUpdateDownloadWorker>().build())
    }
}

class AppUpdateDownloadWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result { AppUpdates.status(applicationContext); AppUpdates.notifyAvailable(applicationContext); return Result.success() }
}

class AppUpdateInstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) { AppUpdates.installerResult(context, intent) }
}

/** Internal notification trampoline; it never accepts an external intent or URL. */
class AppUpdateEntryActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        @Suppress("DEPRECATION") val confirmation = intent.getParcelableExtra<Intent>("confirmation")
        if (confirmation != null) startActivity(confirmation)
        else {
            AppUpdates.requestOpen(this)
            packageManager.getLaunchIntentForPackage(packageName)?.let { startActivity(it.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)) }
        }
        finish()
    }
}
