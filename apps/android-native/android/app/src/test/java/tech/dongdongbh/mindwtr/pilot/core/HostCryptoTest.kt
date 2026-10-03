package tech.dongdongbh.mindwtr.pilot.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.File
import java.text.Normalizer
import java.util.Base64

/**
 * HostCrypto is byte for byte core's SyncCryptoPrimitives: the raw outputs in primitive-vectors.json (core's @noble/hashes and
 * WebCrypto, checked against OpenSSL, the library RN's react-native-quick-crypto wraps) and the MWENC1 containers in vectors.json
 * (core and the desktop's Rust). A key that differs by one bit cannot open another device's data.
 */
class HostCryptoTest {
    // Gradle runs unit tests in the app module's folder; the fixtures are core's, read where they live.
    private val fixtures = File("../../../../packages/core/src/__fixtures__/sync-crypto")
    private val primitives by lazy { JSONObject(File(fixtures, "primitive-vectors.json").readText()) }
    private val containers by lazy { JSONArray(File(fixtures, "vectors.json").readText()) }

    private fun hex(text: String) = ByteArray(text.length / 2) { text.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    private fun b64(text: String): ByteArray = Base64.getDecoder().decode(text)
    private fun JSONArray.objects() = List(length()) { getJSONObject(it) }

    @Test fun argon2idMatchesCoreAndOpenSsl() {
        val cases = primitives.getJSONArray("argon2id").objects()
        assertEquals(8, cases.size)
        for (case in cases) {
            val key = HostCrypto.argon2id(hex(case.getString("passHex")), hex(case.getString("saltHex")), case.getInt("mKib"), case.getInt("t"),
                case.getInt("p"), case.getInt("dkLen"))
            assertArrayEquals(case.getString("passphrase"), hex(case.getString("keyHex")), key)
        }
    }

    @Test fun aesGcmSealsAndOpensAsCoreAndOpenSsl() {
        for (case in primitives.getJSONArray("aesGcm").objects()) {
            val key = hex(case.getString("keyHex"))
            val nonce = hex(case.getString("nonceHex"))
            val aad = hex(case.getString("aadHex"))
            val plaintext = hex(case.getString("plaintextHex"))
            val sealed = hex(case.getString("sealedHex"))
            assertArrayEquals(sealed, HostCrypto.aesGcmSeal(key, nonce, plaintext, aad))
            assertArrayEquals(plaintext, HostCrypto.aesGcmOpen(key, nonce, sealed, aad))
        }
    }

    @Test fun aChangedByteTagOrAadIsAnAuthFailure() {
        val case = primitives.getJSONArray("aesGcm").getJSONObject(5)
        val key = hex(case.getString("keyHex"))
        val nonce = hex(case.getString("nonceHex"))
        val aad = hex(case.getString("aadHex"))
        val sealed = hex(case.getString("sealedHex"))
        for (at in listOf(0, sealed.size / 2, sealed.size - 1)) {
            val changed = sealed.copyOf().also { it[at] = (it[at].toInt() xor 1).toByte() }
            assertThrows(HostCrypto.AuthFailure::class.java) { HostCrypto.aesGcmOpen(key, nonce, changed, aad) }
        }
        val otherAad = aad.copyOf().also { it[0] = (it[0].toInt() xor 1).toByte() }
        assertThrows(HostCrypto.AuthFailure::class.java) { HostCrypto.aesGcmOpen(key, nonce, sealed, otherAad) }
        val otherKey = key.copyOf().also { it[31] = (it[31].toInt() xor 1).toByte() }
        assertThrows(HostCrypto.AuthFailure::class.java) { HostCrypto.aesGcmOpen(otherKey, nonce, sealed, aad) }
        // Too short to hold a tag: the same failure, as RN's adapter answers it.
        assertThrows(HostCrypto.AuthFailure::class.java) { HostCrypto.aesGcmOpen(key, nonce, ByteArray(15), aad) }
        assertThrows(HostCrypto.AuthFailure::class.java) { HostCrypto.aesGcmOpen(key, nonce, ByteArray(0), aad) }
    }

    @Test fun everyMwenc1ContainerIsReproducedAndOpened() {
        val cases = containers.objects()
        assertEquals(5, cases.size)
        for (case in cases) {
            val encrypted = b64(case.getString("encryptedB64"))
            val header = encrypted.copyOfRange(0, 54)
            val params = case.getJSONObject("params")
            // Core derives from the NFC form, so a decomposed "café" opens what a precomposed one sealed.
            val pass = Normalizer.normalize(case.getString("passphrase"), Normalizer.Form.NFC).toByteArray(Charsets.UTF_8)
            val key = HostCrypto.argon2id(pass, b64(case.getString("saltB64")), params.getInt("mKib"), params.getInt("t"), params.getInt("p"), 32)
            val plaintext = b64(case.getString("plaintextB64"))
            val body = HostCrypto.aesGcmSeal(key, header.copyOfRange(34, 46), plaintext, header)
            assertArrayEquals(case.getString("name"), encrypted.copyOfRange(54, encrypted.size), body)
            assertArrayEquals(case.getString("name"), plaintext, HostCrypto.aesGcmOpen(key, header.copyOfRange(34, 46), body, header))
        }
    }

    @Test fun sha256MatchesCore() {
        val files = HostFiles(File("build/tmp/host-crypto-files"), File("build/tmp/host-crypto-cache"), syncDirectory = {})
        for (case in primitives.getJSONArray("sha256").objects()) {
            assertEquals(case.getString("digestHex"), files.call("""{"op":"sha256"}""", hex(case.getString("inputHex"))).value)
        }
    }

    @Test fun parametersArgon2ForbidsAreRefusedAsCoreRefusesThem() {
        val salt = ByteArray(16)
        // Fewer than 8 KiB per lane, no pass, no lane, a short output or salt: noble and OpenSSL refuse each.
        for ((m, t, p, dkLen) in listOf(listOf(15, 1, 2, 32), listOf(64, 0, 1, 32), listOf(64, 1, 0, 32), listOf(64, 1, 1, 3))) {
            assertThrows(IllegalArgumentException::class.java) { HostCrypto.argon2id(ByteArray(1), salt, m, t, p, dkLen) }
        }
        assertThrows(IllegalArgumentException::class.java) { HostCrypto.argon2id(ByteArray(1), ByteArray(7), 64, 1, 1, 32) }
    }

    @Test fun aKeyOrNonceOfAnotherSizeIsRefused() {
        assertThrows(IllegalArgumentException::class.java) { HostCrypto.aesGcmSeal(ByteArray(16), ByteArray(12), ByteArray(1), ByteArray(0)) }
        assertThrows(IllegalArgumentException::class.java) { HostCrypto.aesGcmSeal(ByteArray(32), ByteArray(16), ByteArray(1), ByteArray(0)) }
    }
}
