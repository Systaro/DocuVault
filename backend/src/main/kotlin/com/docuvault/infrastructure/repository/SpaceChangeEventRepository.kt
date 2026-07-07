package com.docuvault.infrastructure.repository

import com.docuvault.domain.space.SpaceChangeEvent
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
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

    /** In-app feed: newest changes in the given spaces, excluding the user's own. */
    @Query(
        """
        SELECT e FROM SpaceChangeEvent e
        WHERE e.space.id IN :spaceIds
        AND (e.triggeredBy IS NULL OR e.triggeredBy.id <> :userId)
        ORDER BY e.detectedAt DESC
        """
    )
    fun findFeed(spaceIds: List<UUID>, userId: UUID, pageable: Pageable): List<SpaceChangeEvent>

    @Query(
        """
        SELECT COUNT(e) FROM SpaceChangeEvent e
        WHERE e.space.id IN :spaceIds
        AND e.detectedAt > :since
        AND (e.triggeredBy IS NULL OR e.triggeredBy.id <> :userId)
        """
    )
    fun countFeedSince(spaceIds: List<UUID>, userId: UUID, since: Instant): Long
}
