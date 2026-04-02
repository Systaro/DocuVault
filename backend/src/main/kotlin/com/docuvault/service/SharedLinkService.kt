package com.docuvault.service

import com.docuvault.domain.space.ShareType
import com.docuvault.domain.space.SharedLink
import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.SharedLinkRepository
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.stereotype.Service
import java.security.SecureRandom
import java.time.Instant
import java.util.*

@Service
class SharedLinkService(
    private val sharedLinkRepository: SharedLinkRepository,
    private val passwordEncoder: PasswordEncoder
) {
    private val secureRandom = SecureRandom()

    fun createLink(
        space: Space,
        filePath: String,
        createdBy: User,
        expiresAt: Instant? = null,
        password: String? = null,
        shareType: ShareType = ShareType.FILE,
        writableScopes: List<String> = emptyList()
    ): SharedLink {
        val token = generateToken()
        val link = SharedLink(
            token = token,
            space = space,
            filePath = filePath,
            createdBy = createdBy,
            expiresAt = expiresAt,
            passwordHash = password?.let { passwordEncoder.encode(it) },
            shareType = shareType,
            writableScopes = writableScopes
        )
        return sharedLinkRepository.save(link)
    }

    fun findByToken(token: String): SharedLink? {
        return sharedLinkRepository.findByToken(token)
    }

    fun findActiveByToken(token: String): SharedLink? {
        val link = sharedLinkRepository.findByToken(token) ?: return null
        return if (link.isActive()) link else null
    }

    fun findBySpaceAndFile(spaceId: UUID, filePath: String): List<SharedLink> {
        return sharedLinkRepository.findBySpaceIdAndFilePath(spaceId, filePath)
    }

    fun findBySpace(spaceId: UUID): List<SharedLink> {
        return sharedLinkRepository.findBySpaceId(spaceId)
    }

    fun revoke(linkId: UUID, spaceId: UUID): Boolean {
        val link = sharedLinkRepository.findById(linkId).orElse(null) ?: return false
        if (link.space.id != spaceId) return false
        link.revokedAt = Instant.now()
        sharedLinkRepository.save(link)
        return true
    }

    fun recordAccess(link: SharedLink) {
        link.accessCount++
        link.lastAccessedAt = Instant.now()
        sharedLinkRepository.save(link)
    }

    fun validatePassword(link: SharedLink, password: String): Boolean {
        val hash = link.passwordHash ?: return false
        return passwordEncoder.matches(password, hash)
    }

    fun updatePassword(linkId: UUID, spaceId: UUID, password: String?): Boolean {
        val link = sharedLinkRepository.findById(linkId).orElse(null) ?: return false
        if (link.space.id != spaceId) return false
        link.passwordHash = password?.let { passwordEncoder.encode(it) }
        sharedLinkRepository.save(link)
        return true
    }

    private fun generateToken(): String {
        val bytes = ByteArray(32) // 256-bit
        secureRandom.nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
