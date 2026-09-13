package com.docuvault.infrastructure.repository

import com.docuvault.domain.oauth.OauthAuthorizationCode
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository
import java.time.Instant
import java.util.*

@Repository
interface OauthAuthorizationCodeRepository : JpaRepository<OauthAuthorizationCode, UUID> {
    fun findByCodeHash(codeHash: String): OauthAuthorizationCode?
    fun deleteByExpiresAtBefore(cutoff: Instant): Long
}
