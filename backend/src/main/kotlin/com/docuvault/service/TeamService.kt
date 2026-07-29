package com.docuvault.service

import com.docuvault.domain.space.PermissionLevel
import com.docuvault.domain.team.Team
import com.docuvault.domain.team.TeamMembership
import com.docuvault.domain.team.TeamSpacePermission
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.TeamMembershipRepository
import com.docuvault.infrastructure.repository.TeamRepository
import com.docuvault.infrastructure.repository.TeamSpacePermissionRepository
import com.docuvault.infrastructure.repository.UserRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.*

/**
 * Reconciliation logic shared by every entry point that edits teams — the team
 * admin screen, the per-user team picker and the per-space team grant list all
 * funnel through here so membership and grant handling stays in one place.
 */
@Service
class TeamService(
    private val teamRepository: TeamRepository,
    private val membershipRepository: TeamMembershipRepository,
    private val teamPermissionRepository: TeamSpacePermissionRepository,
    private val userRepository: UserRepository,
    private val spaceRepository: SpaceRepository
) {
    /** Builds a URL-safe slug from the name, suffixing a counter on collision. */
    fun uniqueSlug(name: String, excludeTeamId: UUID? = null): String {
        val base = name.lowercase()
            .replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
            .replace(Regex("[^a-z0-9]+"), "-")
            .trim('-')
            .ifBlank { "team" }

        var candidate = base
        var counter = 2
        while (true) {
            val existing = teamRepository.findBySlug(candidate)
            if (existing == null || existing.id == excludeTeamId) return candidate
            candidate = "$base-$counter"
            counter++
        }
    }

    /** Makes the team's members exactly [userIds], adding and removing as needed. */
    @Transactional
    fun setMembers(team: Team, userIds: List<UUID>) {
        val desired = userIds.toSet()
        val current = membershipRepository.findAllByTeamId(team.id!!)
        val currentIds = current.map { it.user.id!! }.toSet()

        current.filter { it.user.id !in desired }
            .forEach { membershipRepository.delete(it) }

        desired.filter { it !in currentIds }.forEach { userId ->
            val user = userRepository.findById(userId).orElse(null) ?: return@forEach
            membershipRepository.save(TeamMembership(team = team, user = user))
        }
    }

    /** Makes the user's team memberships exactly [teamIds]. */
    @Transactional
    fun setTeamsForUser(userId: UUID, teamIds: List<UUID>) {
        val desired = teamIds.toSet()
        val current = membershipRepository.findAllByUserId(userId)
        val currentIds = current.map { it.team.id!! }.toSet()

        current.filter { it.team.id !in desired }
            .forEach { membershipRepository.delete(it) }

        val user = userRepository.findById(userId).orElse(null) ?: return
        desired.filter { it !in currentIds }.forEach { teamId ->
            val team = teamRepository.findById(teamId).orElse(null) ?: return@forEach
            membershipRepository.save(TeamMembership(team = team, user = user))
        }
    }

    /** Makes the team's space grants exactly [grants] (spaceId -> level). */
    @Transactional
    fun setPermissions(team: Team, grants: Map<UUID, PermissionLevel>) {
        val current = teamPermissionRepository.findAllByTeamId(team.id!!)
        val currentBySpace = current.associateBy { it.space.id!! }

        current.filter { it.space.id !in grants.keys }
            .forEach { teamPermissionRepository.delete(it) }

        grants.forEach { (spaceId, level) ->
            val existing = currentBySpace[spaceId]
            if (existing != null) {
                if (existing.permissionLevel != level) {
                    existing.permissionLevel = level
                    teamPermissionRepository.save(existing)
                }
            } else {
                val space = spaceRepository.findById(spaceId).orElse(null) ?: return@forEach
                teamPermissionRepository.save(
                    TeamSpacePermission(team = team, space = space, permissionLevel = level)
                )
            }
        }
    }

    /** Upserts a single space grant for a team. */
    @Transactional
    fun grantSpace(team: Team, spaceId: UUID, level: PermissionLevel): TeamSpacePermission? {
        val existing = teamPermissionRepository.findByTeamIdAndSpaceId(team.id!!, spaceId)
        if (existing != null) {
            existing.permissionLevel = level
            return teamPermissionRepository.save(existing)
        }
        val space = spaceRepository.findById(spaceId).orElse(null) ?: return null
        return teamPermissionRepository.save(
            TeamSpacePermission(team = team, space = space, permissionLevel = level)
        )
    }
}
