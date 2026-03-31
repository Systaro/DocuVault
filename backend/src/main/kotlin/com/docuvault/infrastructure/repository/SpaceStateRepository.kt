package com.docuvault.infrastructure.repository

import com.docuvault.domain.space.SpaceState
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import java.util.*

interface SpaceStateRepository : JpaRepository<SpaceState, UUID> {
    fun findBySpaceIdAndKey(spaceId: UUID, key: String): SpaceState?

    @Modifying
    @Query("DELETE FROM SpaceState s WHERE s.space.id = :spaceId AND s.key = :key")
    fun deleteBySpaceIdAndKey(spaceId: UUID, key: String)
}
