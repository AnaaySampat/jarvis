package com.jarvis.phone

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class UpdateManifestTest {
    @Test fun corruptedDownloadsWrongPackagesKeysAndDowngradesAreRejected() {
        val release = manifest()
        val installed = UpdateManifest.ApkIdentity("com.jarvis.app", "2.5.6-rc.1", 2005006, 24, setOf("original"))
        val downloaded = installed.copy(versionName = "2.5.6-rc.2", versionCode = 2005007)
        UpdateManifest.verifyIdentity(release, installed, downloaded, 36)
        for (invalid in listOf(downloaded.copy(packageId = "com.other.app"), downloaded.copy(signers = setOf("replacement")), downloaded.copy(signers = emptySet()), downloaded.copy(versionCode = 2005005), downloaded.copy(versionName = "2.5.5"), downloaded.copy(minSdk = 37))) {
            assertThrows(IllegalArgumentException::class.java) { UpdateManifest.verifyIdentity(release, installed, invalid, 36) }
        }
        val asset = release.getJSONArray("assets").getJSONObject(0)
        UpdateManifest.verifyPayload(asset, 100, "a".repeat(64))
        assertThrows(IllegalArgumentException::class.java) { UpdateManifest.verifyPayload(asset, 99, "a".repeat(64)) }
        assertThrows(IllegalArgumentException::class.java) { UpdateManifest.verifyPayload(asset, 100, "b".repeat(64)) }
    }
    private fun manifest() = JSONObject().put("schemaVersion", 1).put("versionName", "2.5.6-rc.2")
        .put("versionCode", 2005007).put("packageId", "com.jarvis.app").put("channel", "beta").put("minSdk", 24)
        .put("title", "Updates").put("features", JSONArray().put(JSONObject().put("id", "popup").put("title", "New popup")))
        .put("fixes", JSONArray()).put("assets", JSONArray().put(JSONObject().put("abi", "arm64-v8a")
            .put("url", "${UpdateManifest.REPO}/releases/download/v2.5.6-rc.2/JARVIS-v2.5.6-rc.2-arm64.apk")
            .put("size", 100).put("sha256", "a".repeat(64))))

    @Test fun releaseCandidatesSortNumericallyAndPromoteToStable() {
        assertTrue(UpdateManifest.newer("2.5.6-rc.10", "2.5.6-rc.2"))
        assertTrue(UpdateManifest.newer("2.5.6", "2.5.6-rc.2"))
        assertFalse(UpdateManifest.newer("2.5.6-rc.2", "2.5.6"))
        assertFalse(UpdateManifest.newer("2.5.6", "2.5.6"))
        assertTrue(UpdateManifest.newer("2.10.0", "2.9.0"))
        assertFalse(UpdateManifest.newer("not-a-version", "2.5.0"))
    }
    @Test fun metadataMustMatchTheExactReleaseAndPackage() {
        assertEquals(2005007, UpdateManifest.validate(manifest(), "v2.5.6-rc.2", true).getInt("versionCode"))
        for (change in listOf("packageId" to "com.other.app", "versionName" to "2.5.5", "channel" to "stable", "schemaVersion" to 99, "versionCode" to 0)) {
            assertThrows(IllegalArgumentException::class.java) { UpdateManifest.validate(manifest().put(change.first, change.second), "v2.5.6-rc.2", true) }
        }
    }
    @Test fun arbitraryHostsQueriesAndOtherReleasesAreRejected() {
        val path = "${UpdateManifest.REPO}/releases/download/v2.5.6-rc.2/update.apk"
        assertTrue(UpdateManifest.assetUrl(path, "v2.5.6-rc.2"))
        for (url in listOf(path.replace("https:", "http:"), path.replace("github.com", "github.com.evil.test"), "$path?redirect=bad", path.replace("v2.5.6-rc.2", "v2.5.5"), path.replace("github.com", "attacker@github.com"))) {
            assertFalse(UpdateManifest.assetUrl(url, "v2.5.6-rc.2"))
        }
    }
    @Test fun invalidChecksumsAndDuplicateHighlightsCannotBeInstalled() {
        val invalid = manifest()
        invalid.getJSONArray("assets").getJSONObject(0).put("sha256", "invalid")
        assertThrows(IllegalArgumentException::class.java) { UpdateManifest.validate(invalid, "v2.5.6-rc.2", true) }
        val duplicate = manifest()
        duplicate.getJSONArray("features").put(duplicate.getJSONArray("features").getJSONObject(0))
        assertThrows(IllegalArgumentException::class.java) { UpdateManifest.validate(duplicate, "v2.5.6-rc.2", true) }
    }
}
