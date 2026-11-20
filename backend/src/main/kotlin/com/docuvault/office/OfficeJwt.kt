package com.docuvault.office

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import java.security.MessageDigest
import java.time.Instant
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * HS256 JSON Web Tokens, the only kind the office document server speaks: it
 * expects the editor configuration signed with the shared secret, and signs its
 * own calls back to us with it.
 */
object OfficeJwt {
    private val mapper = jacksonObjectMapper()
    private val encoder = Base64.getUrlEncoder().withoutPadding()
    private val decoder = Base64.getUrlDecoder()
    private val header = encoder.encodeToString("""{"alg":"HS256","typ":"JWT"}""".toByteArray())

    fun sign(claims: Map<String, Any?>, secret: String): String {
        val body = encoder.encodeToString(mapper.writeValueAsBytes(claims))
        return "$header.$body.${signature("$header.$body", secret)}"
    }

    /**
     * The claims of [token] when it is an HS256 token signed with [secret] and not
     * expired; null for anything else, including other algorithms ("none" among them).
     */
    fun verify(token: String, secret: String, now: Instant = Instant.now()): JsonNode? {
        val parts = token.trim().split('.')
        if (parts.size != 3) return null
        val head = readJson(parts[0]) ?: return null
        if (head.path("alg").asText() != "HS256") return null
        val expected = signature("${parts[0]}.${parts[1]}", secret)
        if (!MessageDigest.isEqual(expected.toByteArray(), parts[2].toByteArray())) return null
        val claims = readJson(parts[1]) ?: return null
        val exp = claims.path("exp")
        if (exp.isNumber && exp.asLong() < now.epochSecond) return null
        return claims
    }

    private fun readJson(part: String): JsonNode? =
        runCatching { mapper.readTree(decoder.decode(part)) }.getOrNull()?.takeIf { it.isObject }

    private fun signature(input: String, secret: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret.toByteArray(), "HmacSHA256"))
        return encoder.encodeToString(mac.doFinal(input.toByteArray()))
    }
}
