package com.docuvault.infrastructure.repository

import com.docuvault.domain.space.SpaceToken
import org.springframework.data.jpa.repository.JpaRepository
import java.util.*

interface SpaceTokenRepository : JpaRepository<SpaceToken, UUID> {
    fun findByTokenHash(tokenHash: String): SpaceToken?
    fun findBySpaceIdOrderByCreatedAtDesc(spaceId: UUID): List<SpaceToken>
}
