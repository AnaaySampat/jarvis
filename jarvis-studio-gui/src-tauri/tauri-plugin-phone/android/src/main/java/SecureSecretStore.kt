package com.jarvis.phone

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Stores Aura's provider credentials encrypted by a non-exportable Android
 * Keystore key. SharedPreferences contains only an authenticated ciphertext and
 * a random IV; plaintext is returned to the WebView only for the lifetime of an
 * explicit bridge call and is never written to WebView storage.
 */
internal class SecureSecretStore(
    private val context: Context,
    private val keyAlias: String = DEFAULT_KEY_ALIAS,
    private val preferencesName: String = DEFAULT_PREFS,
) {
    companion object {
        private const val KEYSTORE = "AndroidKeyStore"
        internal const val DEFAULT_KEY_ALIAS = "aura.config.secrets.v1"
        internal const val DEFAULT_PREFS = "aura_config_secret_ciphertexts_v1"
        private const val VERSION = "v1"
        private const val MAX_SECRET_BYTES = 256 * 1024
        private const val GCM_TAG_BITS = 128
        private val ALLOWED_NAMES = setOf(
            "geminiKey", "groqKey", "vertexSaJson", "openrouterKey", "mistralKey", "nvidiaKey",
        )
    }

    private val lock = Any()
    private val preferences by lazy {
        context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE)
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    private fun key(): SecretKey = synchronized(lock) {
        val store = keyStore()
        (store.getKey(keyAlias, null) as? SecretKey)?.let { return@synchronized it }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                keyAlias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                // Aura may need a provider key while completing an explicitly
                // requested unattended R0/R1 task, so per-use authentication is
                // intentionally not required.
                .setUserAuthenticationRequired(false)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        generator.generateKey()
    }

    private fun checkedName(name: String): String = name.trim().also {
        require(it in ALLOWED_NAMES) { "unsupported secret name" }
    }

    private fun aad(name: String): ByteArray =
        "aura-config-secret-v1\n$name".toByteArray(StandardCharsets.UTF_8)

    private fun b64(bytes: ByteArray): String =
        Base64.encodeToString(bytes, Base64.NO_WRAP)

    private fun fromB64(text: String): ByteArray = Base64.decode(text, Base64.NO_WRAP)

    fun set(name: String, value: String) = synchronized(lock) {
        val cleanName = checkedName(name)
        val plaintext = value.toByteArray(StandardCharsets.UTF_8)
        try {
            require(plaintext.isNotEmpty()) { "secret value is empty" }
            require(plaintext.size <= MAX_SECRET_BYTES) { "secret value is too large" }

            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key())
            cipher.updateAAD(aad(cleanName))
            val ciphertext = cipher.doFinal(plaintext)
            val encoded = "$VERSION.${b64(cipher.iv)}.${b64(ciphertext)}"
            check(preferences.edit().putString(cleanName, encoded).commit()) {
                "could not persist encrypted secret"
            }
        } finally {
            plaintext.fill(0)
        }
    }

    fun get(name: String): String? = synchronized(lock) {
        val cleanName = checkedName(name)
        val encoded = preferences.getString(cleanName, null) ?: return@synchronized null
        val parts = encoded.split('.', limit = 3)
        require(parts.size == 3 && parts[0] == VERSION) { "encrypted secret is malformed" }
        val iv = fromB64(parts[1])
        val ciphertext = fromB64(parts[2])
        require(iv.size == 12 && ciphertext.size >= 16) { "encrypted secret is malformed" }

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(GCM_TAG_BITS, iv))
        cipher.updateAAD(aad(cleanName))
        val plaintext = cipher.doFinal(ciphertext)
        try {
            String(plaintext, StandardCharsets.UTF_8)
        } finally {
            plaintext.fill(0)
        }
    }

    fun delete(name: String) = synchronized(lock) {
        val cleanName = checkedName(name)
        check(preferences.edit().remove(cleanName).commit()) {
            "could not delete encrypted secret"
        }
    }
}
