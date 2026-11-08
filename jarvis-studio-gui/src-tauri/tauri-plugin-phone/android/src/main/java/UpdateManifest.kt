package com.jarvis.phone

import java.net.URI
import org.json.JSONObject

/** Shared, deliberately strict boundary for data supplied by GitHub releases. */
internal object UpdateManifest {
    const val REPO = "https://github.com/AnaaySampat/jarvis"
    private val versionPattern = Regex("^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$")

    data class ApkIdentity(val packageId: String, val versionName: String, val versionCode: Long, val minSdk: Int, val signers: Set<String>)

    fun verifyPayload(asset: JSONObject, size: Long, sha256: String) {
        require(size == asset.getLong("size")) { "The APK download is incomplete. Download it again." }
        require(sha256 == asset.getString("sha256")) { "The APK checksum does not match. Download it again." }
    }

    fun verifyIdentity(release: JSONObject, installed: ApkIdentity, downloaded: ApkIdentity, sdk: Int) {
        require(downloaded.packageId == installed.packageId && downloaded.packageId == "com.jarvis.app" &&
            downloaded.versionCode == release.getLong("versionCode") && downloaded.versionName == release.getString("versionName") &&
            downloaded.versionCode > installed.versionCode) { "The APK identity or version is incorrect." }
        require(downloaded.signers.isNotEmpty() && downloaded.signers == installed.signers) { "This APK uses a different signing key. Keep the installed app and contact the developer." }
        require(downloaded.minSdk <= sdk) { "This update requires a newer Android version." }
    }

    fun newer(left: String, right: String): Boolean {
        fun parts(v: String) = v.removePrefix("v").split('-', limit = 2)
        val a = parts(left); val b = parts(right)
        if (!versionPattern.matches(left.removePrefix("v")) || !versionPattern.matches(right.removePrefix("v"))) return false
        val an = a[0].split('.').map { it.toLong() }; val bn = b[0].split('.').map { it.toLong() }
        for (i in 0..2) if (an[i] != bn[i]) return an[i] > bn[i]
        if (a.size == 1 || b.size == 1) return a.size == 1 && b.size > 1
        val ap = a[1].split('.'); val bp = b[1].split('.')
        for (i in 0 until maxOf(ap.size, bp.size)) {
            if (i >= ap.size || i >= bp.size) return ap.size > bp.size
            if (ap[i] == bp[i]) continue
            val x = ap[i].toLongOrNull(); val y = bp[i].toLongOrNull()
            return if (x != null && y != null) x > y else if ((x == null) != (y == null)) x == null else ap[i] > bp[i]
        }
        return false
    }

    fun releaseUrl(url: String): Boolean = runCatching {
        val uri = URI(url)
        uri.scheme == "https" && uri.host == "github.com" && uri.port == -1 && uri.userInfo == null &&
            uri.rawQuery == null && uri.rawFragment == null &&
            uri.path.startsWith("/AnaaySampat/jarvis/releases/tag/") && !uri.path.contains("..")
    }.getOrDefault(false)

    fun assetUrl(url: String, tag: String): Boolean = runCatching {
        val uri = URI(url)
        uri.scheme == "https" && uri.host == "github.com" && uri.port == -1 && uri.userInfo == null &&
            uri.rawQuery == null && uri.rawFragment == null &&
            uri.path.startsWith("/AnaaySampat/jarvis/releases/download/$tag/") &&
            uri.path.substringAfterLast('/').isNotBlank() && !uri.path.contains("..")
    }.getOrDefault(false)

    fun validate(json: JSONObject, tag: String, prerelease: Boolean): JSONObject {
        require(json.getInt("schemaVersion") == 1) { "Unsupported update metadata." }
        val version = json.getString("versionName")
        require(versionPattern.matches(version) && tag == "v$version") { "Release version mismatch." }
        require(json.getString("packageId") == "com.jarvis.app") { "Incorrect update package." }
        require(json.getLong("versionCode") in 1..2100000000L) { "Invalid Android build number." }
        require(json.getInt("minSdk") in 24..100) { "Invalid minimum Android version." }
        require(json.getString("channel") == if (prerelease) "beta" else "stable") { "Release channel mismatch." }
        require(prerelease == version.contains('-')) { "Prerelease flag mismatch." }
        require(json.getString("title").length in 1..180) { "Missing release title." }
        for (key in listOf("features", "fixes")) {
            val rows = json.getJSONArray(key)
            require(rows.length() <= 100) { "Too many release highlights." }
            val ids = mutableSetOf<String>()
            for (i in 0 until rows.length()) {
                val item = rows.getJSONObject(i)
                require(item.getString("id").length in 1..100 && ids.add(item.getString("id"))) { "Invalid highlight ID." }
                require(item.getString("title").length in 1..180 && item.optString("description").length <= 1000) { "Invalid release highlight." }
            }
        }
        val assets = json.getJSONArray("assets")
        require(assets.length() in 1..4) { "No compatible APK assets." }
        for (i in 0 until assets.length()) {
            val asset = assets.getJSONObject(i)
            require(asset.getString("abi") in listOf("arm64-v8a", "armeabi-v7a", "x86_64", "x86"))
            require(assetUrl(asset.getString("url"), tag) && asset.getString("url").endsWith(".apk")) { "Untrusted APK URL." }
            require(asset.getLong("size") in 1..2000000000L) { "Invalid APK size." }
            require(Regex("^[a-f0-9]{64}$").matches(asset.getString("sha256"))) { "Invalid APK checksum." }
        }
        return json
    }
}
