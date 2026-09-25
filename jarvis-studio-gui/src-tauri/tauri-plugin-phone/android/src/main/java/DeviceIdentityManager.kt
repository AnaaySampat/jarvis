package com.jarvis.phone

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.nio.charset.StandardCharsets
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec

/**
 * Non-exportable phone identity used by Aura's PC protocol.
 *
 * Only the public key, fingerprint, monotonically increasing counter and
 * signatures cross the Tauri bridge. The EC private key remains inside Android
 * Keystore and is never serialised into WebView storage, logs, QR codes or app
 * backups. Counter persistence happens synchronously before a signature is
 * returned, so process death cannot cause a previously accepted counter to be
 * reused.
 */
internal class DeviceIdentityManager(private val context: Context) {
    companion object {
        private const val KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "aura.remote.device.identity.v1"
        private const val PREFS = "aura_device_identity_meta_v1"
        private const val COUNTER = "outbound_counter"
    }

    data class Info(
        val deviceId: String,
        val publicKey: String,
        val fingerprint: String,
    )

    data class Signed(
        val deviceId: String,
        val counter: Long,
        val signature: String,
        val publicKey: String = "",
        val fingerprint: String = "",
        val deviceName: String = "",
    )

    private val lock = Any()
    private val preferences by lazy {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    private fun ensureKey() = synchronized(lock) {
        val store = keyStore()
        // The alias existing is the ONLY generation gate. `getKey` can return
        // null transiently (Keystore daemon hiccups, notably on Samsung) — if
        // that were the gate, a hiccup would silently mint a NEW identity and
        // orphan the desktop-side pairing. Better to fail one signature (the
        // caller resolves ok:false and the JS layer retries) than to churn the
        // device identity.
        if (store.containsAlias(KEY_ALIAS)) return@synchronized
        val generator = KeyPairGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_EC,
            KEYSTORE,
        )
        generator.initialize(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
            )
                .setAlgorithmParameterSpec(java.security.spec.ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                // User authentication is intentionally not required: an explicitly
                // requested unattended R0/R1 task must survive Activity destruction.
                .setUserAuthenticationRequired(false)
                .build(),
        )
        generator.generateKeyPair()
    }

    private fun publicDer(): ByteArray {
        ensureKey()
        return keyStore().getCertificate(KEY_ALIAS).publicKey.encoded
    }

    private fun digest(bytes: ByteArray): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(bytes)

    private fun b64(bytes: ByteArray): String =
        Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

    private fun fromB64(text: String): ByteArray =
        Base64.decode(text, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

    private fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

    fun info(): Info {
        val public = publicDer()
        val hash = digest(public)
        return Info(
            deviceId = "phone-${hex(hash).take(32)}",
            publicKey = b64(public),
            fingerprint = "sha256:${b64(hash)}",
        )
    }

    private fun nextCounter(): Long = synchronized(lock) {
        val current = preferences.getLong(COUNTER, 0L)
        if (current == Long.MAX_VALUE) throw IllegalStateException("identity counter exhausted")
        val next = current + 1L
        if (!preferences.edit().putLong(COUNTER, next).commit()) {
            throw IllegalStateException("could not persist identity counter")
        }
        next
    }

    private fun sign(material: String): String {
        ensureKey()
        val privateKey = keyStore().getKey(KEY_ALIAS, null)
        val signer = Signature.getInstance("SHA256withECDSA")
        signer.initSign(privateKey as java.security.PrivateKey)
        signer.update(material.toByteArray(StandardCharsets.UTF_8))
        return b64(signer.sign())
    }

    private fun safeLine(value: String, label: String, max: Int = 512): String {
        val clean = value.trim()
        require(clean.isNotEmpty() && clean.length <= max && !clean.contains('\n') && !clean.contains('\r')) {
            "$label is invalid"
        }
        return clean
    }

    fun signAuth(hostId: String, nonce: String): Signed {
        val identity = info()
        val cleanHost = safeLine(hostId, "host id")
        val cleanNonce = safeLine(nonce, "connection nonce")
        val counter = nextCounter()
        val material = "aura-auth-v1\n$cleanHost\n${identity.deviceId}\n$cleanNonce\n$counter"
        return Signed(identity.deviceId, counter, sign(material))
    }

    fun signEnvelope(
        connectionNonce: String,
        messageType: String,
        taskId: String,
        payloadDigest: String,
    ): Signed {
        val identity = info()
        val nonce = safeLine(connectionNonce, "connection nonce")
        val type = safeLine(messageType, "message type", 128)
        val task = taskId.trim().also {
            require(it.length <= 128 && !it.contains('\n') && !it.contains('\r'))
        }
        val digest = safeLine(payloadDigest, "payload digest", 128)
        val counter = nextCounter()
        val material = "aura-envelope-v1\ndevice\n${identity.deviceId}\n$nonce\n$counter\n$type\n$task\n$digest"
        return Signed(identity.deviceId, counter, sign(material))
    }

    fun signPairing(
        hostId: String,
        challengeId: String,
        connectionNonce: String,
        requestedName: String,
    ): Signed {
        val identity = info()
        val host = safeLine(hostId, "host id")
        val challenge = safeLine(challengeId, "pairing challenge")
        val nonce = safeLine(connectionNonce, "connection nonce")
        val name = requestedName.trim().replace(Regex("\\s+"), " ").take(80).ifBlank { "Aura phone" }
        require(!name.contains('\n') && !name.contains('\r'))
        val material = "aura-pair-v1\n$host\n$challenge\n${identity.deviceId}\n$nonce\n${identity.publicKey}\n$name"
        return Signed(
            deviceId = identity.deviceId,
            counter = 0,
            signature = sign(material),
            publicKey = identity.publicKey,
            fingerprint = identity.fingerprint,
            deviceName = name,
        )
    }

    private fun hostKey(publicKey: String, expectedFingerprint: String): java.security.PublicKey {
        val encoded = fromB64(safeLine(publicKey, "host public key", 4096))
        val actual = "sha256:${b64(digest(encoded))}"
        val expected = safeLine(expectedFingerprint, "host fingerprint", 256)
        require(
            MessageDigest.isEqual(
                actual.toByteArray(StandardCharsets.US_ASCII),
                expected.toByteArray(StandardCharsets.US_ASCII),
            ),
        ) { "host fingerprint mismatch" }
        return KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(encoded))
    }

    private fun verify(
        publicKey: String,
        expectedFingerprint: String,
        material: String,
        signature: String,
    ): Boolean = try {
        val verifier = Signature.getInstance("SHA256withECDSA")
        verifier.initVerify(hostKey(publicKey, expectedFingerprint))
        verifier.update(material.toByteArray(StandardCharsets.UTF_8))
        verifier.verify(fromB64(signature))
    } catch (_: Exception) {
        false
    }

    fun verifyHostChallenge(
        publicKey: String,
        expectedFingerprint: String,
        hostId: String,
        nonce: String,
        expiresAt: Long,
        connectionId: String,
        signature: String,
    ): Boolean {
        val material = "aura-host-challenge-v1\n$hostId\n$nonce\n$expiresAt\n$connectionId"
        return verify(publicKey, expectedFingerprint, material, signature)
    }

    fun verifyHostEnvelope(
        publicKey: String,
        expectedFingerprint: String,
        hostId: String,
        connectionNonce: String,
        counter: Long,
        messageType: String,
        taskId: String,
        payloadDigest: String,
        signature: String,
    ): Boolean {
        val material = "aura-envelope-v1\nhost\n$hostId\n$connectionNonce\n$counter\n$messageType\n$taskId\n$payloadDigest"
        return verify(publicKey, expectedFingerprint, material, signature)
    }
}
