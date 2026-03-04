package com.docuvault.service

import jakarta.servlet.http.Cookie
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

@Service
class ShareAccessTokenService(
    @Value("\${encryption.key}") private val encryptionKey: String
) {
    companion object {
        private const val MAX_AGE_SECONDS = 3600
        private const val HMAC_ALGORITHM = "HmacSHA256"
    }

    fun generateAccessCookie(shareToken: String): Cookie {
        val timestamp = System.currentTimeMillis().toString()
        val hmac = computeHmac(shareToken + timestamp)
        val value = Base64.getEncoder().encodeToString("$timestamp:$hmac".toByteArray())

        val cookieName = getCookieName(shareToken)
        val cookie = Cookie(cookieName, value)
        cookie.path = "/api/shared/$shareToken"
        cookie.isHttpOnly = true
        cookie.maxAge = MAX_AGE_SECONDS
        cookie.setAttribute("SameSite", "Strict")
        return cookie
    }

    fun validateAccessCookie(cookieValue: String, shareToken: String): Boolean {
        return try {
            val decoded = String(Base64.getDecoder().decode(cookieValue))
            val parts = decoded.split(":", limit = 2)
            if (parts.size != 2) return false

            val timestamp = parts[0].toLongOrNull() ?: return false
            val hmac = parts[1]

            val ageMs = System.currentTimeMillis() - timestamp
            if (ageMs < 0 || ageMs > MAX_AGE_SECONDS * 1000L) return false

            val expectedHmac = computeHmac(shareToken + timestamp)
            hmac == expectedHmac
        } catch (_: Exception) {
            false
        }
    }

    fun getCookieName(shareToken: String): String {
        val prefix = shareToken.take(8)
        return "dv_share_$prefix"
    }

    private fun computeHmac(data: String): String {
        val mac = Mac.getInstance(HMAC_ALGORITHM)
        val keySpec = SecretKeySpec(encryptionKey.toByteArray(), HMAC_ALGORITHM)
        mac.init(keySpec)
        val hmacBytes = mac.doFinal(data.toByteArray())
        return hmacBytes.joinToString("") { "%02x".format(it) }
    }
}
