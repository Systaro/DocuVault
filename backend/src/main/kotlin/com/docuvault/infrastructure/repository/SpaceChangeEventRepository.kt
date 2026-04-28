package com.docuvault.infrastructure.repository

import com.docuvault.domain.space.SpaceChangeEvent
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository
import java.time.Instant
import java.util.*

@Repository
interface SpaceChangeEventRepository : JpaRepository<SpaceChangeEvent, UUID> {
    fun findBySpaceIdAndDetectedAtAfterOrderByDetectedAtAsc(
        spaceId: UUID,
        detectedAt: Instant
    ): List<SpaceChangeEvent>

    fun findByDetectedAtBetweenOrderBySpaceIdAscDetectedAtAsc(
        from: Instant,
        to: Instant
    ): List<SpaceChangeEvent>
}
