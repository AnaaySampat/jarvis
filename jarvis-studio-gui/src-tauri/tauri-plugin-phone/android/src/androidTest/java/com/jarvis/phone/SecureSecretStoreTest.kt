package com.jarvis.phone

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.security.KeyStore
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SecureSecretStoreTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var keyAlias: String
    private lateinit var preferencesName: String
    private lateinit var preferences: android.content.SharedPreferences
    private lateinit var store: SecureSecretStore

    @Before
    fun setUp() {
        val nonce = System.nanoTime().toString()
        keyAlias = "aura.config.secrets.test.$nonce"
        preferencesName = "aura_config_secret_ciphertexts_test_$nonce"
        preferences = context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE)
        store = SecureSecretStore(context, keyAlias, preferencesName)
    }

    @After
    fun tearDown() {
        preferences.edit().clear().commit()
        KeyStore.getInstance("AndroidKeyStore").apply {
            load(null)
            if (containsAlias(keyAlias)) deleteEntry(keyAlias)
        }
    }

    @Test
    fun roundTripPersistsOnlyCiphertextAndDeleteRemovesIt() {
        val plaintext = "gsk_test_credential_that_must_not_reach_preferences"

        store.set("groqKey", plaintext)

        assertEquals(plaintext, store.get("groqKey"))
        val raw = preferences.getString("groqKey", null).orEmpty()
        assertTrue(raw.startsWith("v1."))
        assertFalse(raw.contains(plaintext))
        assertFalse(preferences.all.toString().contains(plaintext))

        store.delete("groqKey")
        assertNull(store.get("groqKey"))
        assertFalse(preferences.contains("groqKey"))
    }

    @Test
    fun repeatedWritesUseDifferentRandomIvs() {
        store.set("geminiKey", "same-secret")
        val first = preferences.getString("geminiKey", null)

        store.set("geminiKey", "same-secret")
        val second = preferences.getString("geminiKey", null)

        assertNotEquals(first, second)
        assertEquals("same-secret", store.get("geminiKey"))
    }

    @Test
    fun ciphertextCannotBeMovedToAnotherSecretName() {
        store.set("geminiKey", "bound-to-gemini")
        val ciphertext = preferences.getString("geminiKey", null)
        preferences.edit().putString("groqKey", ciphertext).commit()

        var rejected = false
        try {
            store.get("groqKey")
        } catch (_: Exception) {
            rejected = true
        }

        assertTrue(rejected)
    }

    @Test(expected = IllegalArgumentException::class)
    fun unknownSecretNamesAreRejected() {
        store.set("arbitrarySecret", "must-not-store")
    }
}
