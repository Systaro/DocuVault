package com.docuvault.infrastructure.repository

import com.docuvault.domain.team.TeamSpacePermission
import com.docuvault.domain.user.User
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository
import java.util.*

@Repository
interface TeamSpacePermissionRepository : JpaRepository<TeamSpacePermission, UUID> {
    fun findAllByTeamId(teamId: UUID): List<TeamSpacePermission>
    fun findAllBySpaceId(spaceId: UUID): List<TeamSpacePermission>
    fun findByTeamIdAndSpaceId(teamId: UUID, spaceId: UUID): TeamSpacePermission?
    fun deleteByTeamIdAndSpaceId(teamId: UUID, spaceId: UUID)
    fun countByTeamId(teamId: UUID): Long

    fun findAllBySpaceIdAndTeamIdIn(spaceId: UUID, teamIds: Collection<UUID>): List<TeamSpacePermission>

    /** Every user who reaches this space through one of its team grants. */
    @Query(
        """
        SELECT DISTINCT m.user FROM TeamMembership m
        WHERE m.team.id IN (SELECT p.team.id FROM TeamSpacePermission p WHERE p.space.id = :spaceId)
        """
    )
    fun findUsersBySpaceId(spaceId: UUID): List<User>
}
