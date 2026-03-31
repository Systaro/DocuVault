package com.docuvault.service

import com.docuvault.domain.space.Space
import com.docuvault.domain.space.SpaceToken
import com.docuvault.infrastructure.repository.SpaceTokenRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Instant
import java.util.*

@Service
class SpaceTokenService(
    private val spaceTokenRepository: SpaceTokenRepository
) {
    companion object {
        const val TOKEN_PREFIX = "dvs_"
        private const val TOKEN_BYTE_LENGTH = 32
    }

    private val secureRandom = SecureRandom()

    @Transactional
    fun createToken(space: Space, name: String): Pair<SpaceToken, String> {
        val rawBytes = ByteArray(TOKEN_BYTE_LENGTH)
        secureRandom.nextBytes(rawBytes)
        val rawToken = TOKEN_PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(rawBytes)

        val saved = spaceTokenRepository.save(
            SpaceToken(
                space = space,
                name = name,
                tokenHash = hashToken(rawToken),
                tokenPrefix = rawToken.take(12)
            )
        )
        return Pair(saved, rawToken)
    }

    fun listTokens(spaceId: UUID): List<SpaceToken> =
        spaceTokenRepository.findBySpaceIdOrderByCreatedAtDesc(spaceId)

    @Transactional
    fun revokeToken(tokenId: UUID, spaceId: UUID): Boolean {
        val token = spaceTokenRepository.findById(tokenId).orElse(null) ?: return false
        if (token.space.id != spaceId) return false
        if (token.revokedAt != null) return false
        token.revokedAt = Instant.now()
        spaceTokenRepository.save(token)
        return true
    }

    /** Returns the spaceId if the raw token is valid, null otherwise. */
    @Transactional
    fun authenticateToken(rawToken: String): UUID? {
        if (!rawToken.startsWith(TOKEN_PREFIX)) return null
        val token = spaceTokenRepository.findByTokenHash(hashToken(rawToken)) ?: return null
        if (!token.isValid()) return null
        token.lastUsedAt = Instant.now()
        spaceTokenRepository.save(token)
        return token.space.id
    }

    private fun hashToken(rawToken: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        return digest.digest(rawToken.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }
}
