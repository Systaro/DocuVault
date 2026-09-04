package com.docuvault.infrastructure.repository

import com.docuvault.domain.space.AccessRequest
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository
import java.time.Instant
import java.util.*

@Repository
interface AccessRequestRepository : JpaRepository<AccessRequest, UUID> {

    /** Whether this person already asked for this space recently — the dedupe check. */
    fun existsBySpaceIdAndUserIdAndCreatedAtAfter(
        spaceId: UUID,
        userId: UUID,
        createdAt: Instant
    ): Boolean
}
