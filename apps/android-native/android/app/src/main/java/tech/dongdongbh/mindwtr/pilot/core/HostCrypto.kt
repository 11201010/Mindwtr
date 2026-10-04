package tech.dongdongbh.mindwtr.pilot.core

import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import org.json.JSONObject
import java.util.Arrays
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Core's SyncCryptoPrimitives (packages/core/src/sync-crypto.ts) for the JS host, as RN's sync-crypto-native.ts gives them with
 * react-native-quick-crypto (OpenSSL): Argon2id v1.3 by BouncyCastle, AES-256-GCM by javax.crypto. Random bytes are the host's
 * crypto.getRandomValues (SecureRandom). HostIo runs every call on its crypto thread, never the engine's.
 */
object HostCrypto {
    /** GCM's tag: core appends it to the ciphertext. */
    private const val TAG_BYTES = 16

    /** A tag or AAD mismatch, or input too short to hold a tag: core's SyncCryptoAuthError, never which of them. */
    class AuthFailure : Exception("wrong passphrase or corrupted data")

    /** Argon2id v1.3, no secret and no associated data, as core's @noble/hashes and RN's OpenSSL derive it. */
    fun argon2id(pass: ByteArray, salt: ByteArray, mKib: Int, t: Int, p: Int, dkLen: Int): ByteArray {
        // BouncyCastle accepts what Argon2 forbids (it rounds the memory up); core's other primitives refuse it, so this does too.
        require(p in 1..0xffffff && t >= 1 && mKib >= 8 * p && dkLen >= 4 && salt.size >= 8) { "invalid Argon2id parameters" }
        val parameters = Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
            .withVersion(Argon2Parameters.ARGON2_VERSION_13)
            .withSalt(salt)
            .withMemoryAsKB(mKib)
            .withIterations(t)
            .withParallelism(p)
            .build()
        val out = ByteArray(dkLen)
        Argon2BytesGenerator().apply { init(parameters) }.generateBytes(pass, out)
        return out
    }

    /** The ciphertext with its 16-byte tag appended. */
    fun aesGcmSeal(key: ByteArray, nonce: ByteArray, plaintext: ByteArray, aad: ByteArray): ByteArray =
        gcm(Cipher.ENCRYPT_MODE, key, nonce, aad).doFinal(plaintext)

    /** The plaintext, or [AuthFailure]. */
    fun aesGcmOpen(key: ByteArray, nonce: ByteArray, ctAndTag: ByteArray, aad: ByteArray): ByteArray {
        if (ctAndTag.size < TAG_BYTES) throw AuthFailure()
        val cipher = gcm(Cipher.DECRYPT_MODE, key, nonce, aad)
        return try {
            cipher.doFinal(ctAndTag)
        } catch (_: AEADBadTagException) {
            throw AuthFailure()
        }
    }

    private fun gcm(mode: Int, key: ByteArray, nonce: ByteArray, aad: ByteArray): Cipher {
        // Core checks the key's length; a 16-byte key here would silently be AES-128.
        require(key.size == 32) { "AES-256-GCM needs a 32-byte key" }
        require(nonce.size == 12) { "AES-GCM needs a 12-byte nonce" }
        return Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BYTES * 8, nonce))
            updateAAD(aad)
        }
    }

    /**
     * An Argon2id request's cost (`m`, `t`, `p`, `dkLen`), each an exact whole number in range, or IllegalArgumentException: a
     * fraction, an overflow or a text is refused, never rounded or wrapped into a cost core did not ask for. Above Int's range is
     * refused too (core's own ceiling, 256 MiB, is far below).
     */
    fun argon2Params(request: JSONObject): IntArray = intArrayOf(
        exact(request, "m", 1), exact(request, "t", 1), exact(request, "p", 1, 0xffffff), exact(request, "dkLen", 4),
    )

    private fun exact(request: JSONObject, name: String, min: Long, max: Long = Int.MAX_VALUE.toLong()): Int {
        val value = request.opt(name)
        require(value is Number) { "invalid Argon2id parameters" }
        val number = value.toDouble()
        require(number.isFinite() && number == Math.floor(number) && number >= min && number <= max) { "invalid Argon2id parameters" }
        return number.toInt()
    }

    /**
     * One call's answer, off the engine thread: [compute]'s bytes through [encode], or null once [closed] (the host stopped), so
     * a derived key or a plaintext never waits in a queue nobody drains. The result's bytes are cleared either way.
     */
    fun <T> answer(closed: () -> Boolean, compute: () -> ByteArray, encode: (ByteArray) -> T): T? {
        if (closed()) return null
        val out = compute()
        try {
            return if (closed()) null else encode(out)
        } finally {
            wipe(out)
        }
    }

    /** Clears a passphrase's or key's bytes once a call is done with them. */
    fun wipe(vararg bytes: ByteArray?) = bytes.forEach { if (it != null) Arrays.fill(it, 0) }
}
