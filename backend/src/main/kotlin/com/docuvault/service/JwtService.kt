package com.docuvault.service

import io.jsonwebtoken.Claims
import io.jsonwebtoken.Jwts
import io.jsonwebtoken.security.Keys
import jakarta.annotation.PostConstruct
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import java.util.*
import javax.crypto.SecretKey

@Service
class JwtService(
    @Value("\${jwt.secret}") private val secret: String,
    @Value("\${jwt.expiration}") private val expiration: Long,
    @Value("\${jwt.refresh-expiration}") private val refreshExpiration: Long
) {
    companion object {
        private const val MIN_SECRET_LENGTH = 32
        private val WEAK_SECRETS = setOf(
            "default-dev-secret-change-in-production",
            "your-super-secret-jwt-key-change-in-production",
            "change-me", "secret", "password"
        )
    }

    @PostConstruct
    fun validateSecret() {
        require(secret.isNotBlank()) { "JWT_SECRET must be configured. Generate one with: openssl rand -base64 64" }
        require(secret.length >= MIN_SECRET_LENGTH) { "JWT_SECRET must be at least $MIN_SECRET_LENGTH characters. Current length: ${secret.length}" }
        require(secret.lowercase() !in WEAK_SECRETS) { "JWT_SECRET is a known weak default. Please generate a strong random secret." }
    }

    private val key: SecretKey by lazy {
        Keys.hmacShaKeyFor(secret.toByteArray())
    }

    fun generateToken(email: String, additionalClaims: Map<String, Any> = emptyMap()): String {
        return buildToken(email, additionalClaims, expiration)
    }

    fun generateRefreshToken(email: String): String {
        return buildToken(email, emptyMap(), refreshExpiration)
    }

    private fun buildToken(email: String, claims: Map<String, Any>, expirationTime: Long): String {
        val now = Date()
        val expiryDate = Date(now.time + expirationTime)

        return Jwts.builder()
            .claims(claims)
            .subject(email)
            .issuedAt(now)
            .expiration(expiryDate)
            .signWith(key)
            .compact()
    }

    fun extractEmail(token: String): String? {
        return try {
            extractAllClaims(token).subject
        } catch (e: Exception) {
            null
        }
    }

    fun isTokenValid(token: String, email: String): Boolean {
        val extractedEmail = extractEmail(token)
        return extractedEmail == email && !isTokenExpired(token)
    }

    private fun isTokenExpired(token: String): Boolean {
        return try {
            extractAllClaims(token).expiration.before(Date())
        } catch (e: Exception) {
            true
        }
    }

    private fun extractAllClaims(token: String): Claims {
        return Jwts.parser()
            .verifyWith(key)
            .build()
            .parseSignedClaims(token)
            .payload
    }
}
