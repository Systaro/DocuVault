package com.docuvault.office

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import java.time.Instant
import java.util.Base64

class OfficeJwtTest {
    private val secret = "test-secret-with-enough-length"

    @Test
    fun `a signed token verifies and keeps its claims`() {
        val token = OfficeJwt.sign(mapOf("status" to 2, "users" to listOf("u1")), secret)
        val claims = OfficeJwt.verify(token, secret)!!
        assertEquals(2, claims.path("status").asInt())
        assertEquals("u1", claims.path("users")[0].asText())
    }

    @Test
    fun `wrong secret, changed body or expiry make it fail`() {
        val token = OfficeJwt.sign(mapOf("status" to 2), secret)
        assertNull(OfficeJwt.verify(token, "another-secret"))

        val parts = token.split('.')
        val forgedBody = Base64.getUrlEncoder().withoutPadding().encodeToString("""{"status":6}""".toByteArray())
        assertNull(OfficeJwt.verify("${parts[0]}.$forgedBody.${parts[2]}", secret))

        val expiring = OfficeJwt.sign(mapOf("exp" to 1_000L), secret)
        assertNull(OfficeJwt.verify(expiring, secret, Instant.ofEpochSecond(1_001)))
    }

    @Test
    fun `an unsigned token is refused`() {
        val enc = Base64.getUrlEncoder().withoutPadding()
        val none = enc.encodeToString("""{"alg":"none"}""".toByteArray()) + "." +
            enc.encodeToString("""{"status":2}""".toByteArray()) + "."
        assertNull(OfficeJwt.verify(none, secret))
    }
}
