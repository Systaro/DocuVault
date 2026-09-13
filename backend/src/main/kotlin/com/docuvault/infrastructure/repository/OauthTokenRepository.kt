package com.docuvault.infrastructure.repository

import com.docuvault.domain.oauth.OauthToken
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository
import java.time.Instant
import java.util.*

@Repository
interface OauthTokenRepository : JpaRepository<OauthToken, UUID> {
    fun findByAccessTokenHash(accessTokenHash: String): OauthToken?
    fun findByRefreshTokenHash(refreshTokenHash: String): OauthToken?
    fun findByUser_IdAndClient_IdAndRevokedAtIsNull(userId: UUID, clientId: UUID): List<OauthToken>
    fun deleteByRefreshExpiresAtBefore(cutoff: Instant): Long
}
