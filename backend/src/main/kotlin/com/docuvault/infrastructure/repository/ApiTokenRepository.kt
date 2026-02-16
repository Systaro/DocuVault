package com.docuvault.infrastructure.repository

import com.docuvault.domain.user.ApiToken
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository
import java.util.*

@Repository
interface ApiTokenRepository : JpaRepository<ApiToken, UUID> {
    fun findByTokenHash(tokenHash: String): ApiToken?
    fun findByUserIdOrderByCreatedAtDesc(userId: UUID): List<ApiToken>
    fun countByUserIdAndRevokedAtIsNull(userId: UUID): Long
}
