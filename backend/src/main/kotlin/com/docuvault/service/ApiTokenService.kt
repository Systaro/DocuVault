package com.docuvault.service

import com.docuvault.domain.user.ApiToken
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.ApiTokenRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.security.SecureRandom
import java.time.Instant
import java.util.*

@Service
class ApiTokenService(
    private val apiTokenRepository: ApiTokenRepository
) {
    companion object {
        private const val TOKEN_PREFIX = "dv_"
        private const val TOKEN_BYTE_LENGTH = 32
        private const val MAX_TOKENS_PER_USER = 10
    }

    private val secureRandom = SecureRandom()

    @Transactional
    fun createToken(user: User, name: String, expiresAt: Instant? = null): Pair<ApiToken, String> {
        val activeCount = apiTokenRepository.countByUserIdAndRevokedAtIsNull(user.id!!)
        if (activeCount >= MAX_TOKENS_PER_USER) {
            throw IllegalStateException("Maximum of $MAX_TOKENS_PER_USER active tokens per user")
        }

        val rawBytes = ByteArray(TOKEN_BYTE_LENGTH)
        secureRandom.nextBytes(rawBytes)
        val rawToken = TOKEN_PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(rawBytes)

        val tokenHash = hashToken(rawToken)
        val tokenPrefix = rawToken.take(12)

        val apiToken = ApiToken(
            user = user,
            name = name,
            tokenHash = tokenHash,
            tokenPrefix = tokenPrefix,
            expiresAt = expiresAt
        )

        val saved = apiTokenRepository.save(apiToken)
        return Pair(saved, rawToken)
    }

    fun listTokens(userId: UUID): List<ApiToken> {
        return apiTokenRepository.findByUserIdOrderByCreatedAtDesc(userId)
    }

    @Transactional
    fun revokeToken(tokenId: UUID, userId: UUID): Boolean {
        val token = apiTokenRepository.findById(tokenId).orElse(null) ?: return false
        if (token.user.id != userId) return false
        if (token.revokedAt != null) return false

        token.revokedAt = Instant.now()
        apiTokenRepository.save(token)
        return true
    }

    @Transactional
    fun authenticateToken(rawToken: String): User? {
        if (!rawToken.startsWith(TOKEN_PREFIX)) return null

        val tokenHash = hashToken(rawToken)
        val apiToken = apiTokenRepository.findByTokenHash(tokenHash) ?: return null

        if (!apiToken.isValid()) return null

        apiToken.lastUsedAt = Instant.now()
        apiTokenRepository.save(apiToken)

        return apiToken.user
    }

    private fun hashToken(rawToken: String): String = TokenHashing.sha256Hex(rawToken)
}
