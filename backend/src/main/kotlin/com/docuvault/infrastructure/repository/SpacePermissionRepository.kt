package com.docuvault.infrastructure.repository

import com.docuvault.domain.space.PermissionLevel
import com.docuvault.domain.space.SpacePermission
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository
import java.util.*

@Repository
interface SpacePermissionRepository : JpaRepository<SpacePermission, UUID> {
    fun findByUserIdAndSpaceId(userId: UUID, spaceId: UUID): SpacePermission?
    fun findAllByUserId(userId: UUID): List<SpacePermission>
    fun findAllBySpaceId(spaceId: UUID): List<SpacePermission>
    fun deleteByUserIdAndSpaceId(userId: UUID, spaceId: UUID)
    fun existsByUserIdAndSpaceIdAndPermissionLevelIn(
        userId: UUID,
        spaceId: UUID,
        levels: List<PermissionLevel>
    ): Boolean
}
