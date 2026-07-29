package com.docuvault.infrastructure.repository

import com.docuvault.domain.team.TeamMembership
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository
import java.util.*

@Repository
interface TeamMembershipRepository : JpaRepository<TeamMembership, UUID> {
    fun findAllByUserId(userId: UUID): List<TeamMembership>
    fun findAllByTeamId(teamId: UUID): List<TeamMembership>
    fun findByTeamIdAndUserId(teamId: UUID, userId: UUID): TeamMembership?
    fun deleteByTeamIdAndUserId(teamId: UUID, userId: UUID)
    fun countByTeamId(teamId: UUID): Long

    @Query("SELECT m.team.id FROM TeamMembership m WHERE m.user.id = :userId")
    fun findTeamIdsByUserId(userId: UUID): List<UUID>
}
