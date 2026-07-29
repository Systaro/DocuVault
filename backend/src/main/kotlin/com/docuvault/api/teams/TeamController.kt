package com.docuvault.api.teams

import com.docuvault.domain.space.PermissionLevel
import com.docuvault.domain.team.Team
import com.docuvault.domain.team.TeamSpacePermission
import com.docuvault.domain.user.User
import com.docuvault.infrastructure.repository.TeamMembershipRepository
import com.docuvault.infrastructure.repository.TeamRepository
import com.docuvault.infrastructure.repository.TeamSpacePermissionRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.TeamService
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Pattern
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.*
import java.time.Instant
import java.util.*

@RestController
@RequestMapping("/teams")
class TeamController(
    private val teamRepository: TeamRepository,
    private val membershipRepository: TeamMembershipRepository,
    private val teamPermissionRepository: TeamSpacePermissionRepository,
    private val userRepository: UserRepository,
    private val teamService: TeamService
) {
    /**
     * Readable by any signed-in user: space admins need the list to grant a team
     * access to their space, and it exposes nothing beyond names and headcounts.
     */
    @GetMapping
    fun listTeams(): ResponseEntity<List<TeamDto>> {
        val teams = teamRepository.findAll()
            .sortedBy { it.name.lowercase() }
            .map { it.toDto(memberCount(it), spaceCount(it)) }
        return ResponseEntity.ok(teams)
    }

    /** Flat membership list so the user admin table can show team badges in one request. */
    @GetMapping("/memberships")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    fun listMemberships(): ResponseEntity<List<TeamMembershipDto>> {
        val memberships = membershipRepository.findAll().map {
            TeamMembershipDto(
                teamId = it.team.id!!,
                teamName = it.team.name,
                teamColor = it.team.color,
                userId = it.user.id!!
            )
        }
        return ResponseEntity.ok(memberships)
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    @Transactional(readOnly = true)
    fun getTeam(@PathVariable id: UUID): ResponseEntity<TeamDetailDto> {
        val team = teamRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()
        return ResponseEntity.ok(buildDetail(team))
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    @Transactional
    fun createTeam(
        @AuthenticationPrincipal userDetails: UserDetails,
        @Valid @RequestBody request: SaveTeamRequest
    ): ResponseEntity<TeamDetailDto> {
        val creator = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val team = teamRepository.save(
            Team(
                name = request.name.trim(),
                slug = teamService.uniqueSlug(request.name),
                description = request.description?.trim()?.ifBlank { null },
                color = request.color,
                createdBy = creator
            )
        )

        teamService.setMembers(team, request.memberIds)
        teamService.setPermissions(team, request.permissionMap())

        return ResponseEntity.status(HttpStatus.CREATED).body(buildDetail(team))
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    @Transactional
    fun updateTeam(
        @PathVariable id: UUID,
        @Valid @RequestBody request: SaveTeamRequest
    ): ResponseEntity<TeamDetailDto> {
        val team = teamRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (team.name != request.name.trim()) {
            team.name = request.name.trim()
            team.slug = teamService.uniqueSlug(request.name, excludeTeamId = team.id)
        }
        team.description = request.description?.trim()?.ifBlank { null }
        team.color = request.color
        team.updatedAt = Instant.now()
        teamRepository.save(team)

        teamService.setMembers(team, request.memberIds)
        teamService.setPermissions(team, request.permissionMap())

        return ResponseEntity.ok(buildDetail(team))
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    @Transactional
    fun deleteTeam(@PathVariable id: UUID): ResponseEntity<Unit> {
        if (!teamRepository.existsById(id)) {
            return ResponseEntity.notFound().build()
        }
        // Memberships and grants cascade; members keep their direct permissions.
        teamRepository.deleteById(id)
        return ResponseEntity.noContent().build()
    }

    @PostMapping("/{id}/members")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    @Transactional
    fun addMember(
        @PathVariable id: UUID,
        @Valid @RequestBody request: AddTeamMemberRequest
    ): ResponseEntity<TeamDetailDto> {
        val team = teamRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()
        if (!userRepository.existsById(request.userId)) {
            return ResponseEntity.badRequest().build()
        }

        val existingIds = membershipRepository.findAllByTeamId(team.id!!).map { it.user.id!! }
        teamService.setMembers(team, (existingIds + request.userId).distinct())

        return ResponseEntity.ok(buildDetail(team))
    }

    @DeleteMapping("/{id}/members/{userId}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    @Transactional
    fun removeMember(
        @PathVariable id: UUID,
        @PathVariable userId: UUID
    ): ResponseEntity<Unit> {
        if (!teamRepository.existsById(id)) {
            return ResponseEntity.notFound().build()
        }
        membershipRepository.deleteByTeamIdAndUserId(id, userId)
        return ResponseEntity.noContent().build()
    }

    @PutMapping("/{id}/permissions")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    @Transactional
    fun setPermissions(
        @PathVariable id: UUID,
        @Valid @RequestBody request: SetTeamPermissionsRequest
    ): ResponseEntity<List<TeamSpacePermissionDto>> {
        val team = teamRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()

        val grants = try {
            request.permissions.associate { it.spaceId to PermissionLevel.valueOf(it.permissionLevel) }
        } catch (_: IllegalArgumentException) {
            return ResponseEntity.badRequest().build()
        }

        teamService.setPermissions(team, grants)
        return ResponseEntity.ok(teamPermissionRepository.findAllByTeamId(team.id!!).map { it.toDto() })
    }

    private fun buildDetail(team: Team): TeamDetailDto {
        val members = membershipRepository.findAllByTeamId(team.id!!)
            .map { it.user }
            .sortedBy { it.name.lowercase() }
            .map { it.toTeamMemberDto() }
        val permissions = teamPermissionRepository.findAllByTeamId(team.id)
            .map { it.toDto() }
            .sortedBy { it.spaceFullPath }
        return TeamDetailDto(
            id = team.id,
            name = team.name,
            slug = team.slug,
            description = team.description,
            color = team.color,
            memberCount = members.size,
            spaceCount = permissions.size,
            createdAt = team.createdAt,
            members = members,
            permissions = permissions
        )
    }

    private fun memberCount(team: Team): Int = membershipRepository.countByTeamId(team.id!!).toInt()
    private fun spaceCount(team: Team): Int = teamPermissionRepository.countByTeamId(team.id!!).toInt()
}

data class TeamDto(
    val id: UUID,
    val name: String,
    val slug: String,
    val description: String?,
    val color: String?,
    val memberCount: Int,
    val spaceCount: Int,
    val createdAt: Instant
)

data class TeamDetailDto(
    val id: UUID,
    val name: String,
    val slug: String,
    val description: String?,
    val color: String?,
    val memberCount: Int,
    val spaceCount: Int,
    val createdAt: Instant,
    val members: List<TeamMemberDto>,
    val permissions: List<TeamSpacePermissionDto>
)

/** Lightweight team reference for badges next to a user. */
data class TeamBadgeDto(
    val id: UUID,
    val name: String,
    val color: String?
)

data class TeamMembershipDto(
    val teamId: UUID,
    val teamName: String,
    val teamColor: String?,
    val userId: UUID
)

data class TeamMemberDto(
    val userId: UUID,
    val name: String,
    val email: String,
    val role: String,
    val enabled: Boolean
)

data class TeamSpacePermissionDto(
    val teamId: UUID,
    val teamName: String,
    val teamColor: String?,
    val spaceId: UUID,
    val spaceName: String,
    val spaceFullPath: String,
    val spaceType: String,
    val permissionLevel: String
)

data class SaveTeamRequest(
    @field:NotBlank(message = "Name is required")
    val name: String,
    val description: String? = null,
    @field:Pattern(regexp = "^#[0-9a-fA-F]{6}$", message = "Color must be a hex value like #6fb3b8")
    val color: String? = null,
    val memberIds: List<UUID> = emptyList(),
    val permissions: List<TeamPermissionEntry> = emptyList()
) {
    fun permissionMap(): Map<UUID, PermissionLevel> =
        permissions.mapNotNull { entry ->
            runCatching { entry.spaceId to PermissionLevel.valueOf(entry.permissionLevel) }.getOrNull()
        }.toMap()
}

data class TeamPermissionEntry(
    val spaceId: UUID,
    val permissionLevel: String
)

data class SetTeamPermissionsRequest(
    val permissions: List<TeamPermissionEntry> = emptyList()
)

data class AddTeamMemberRequest(
    val userId: UUID
)

fun Team.toDto(memberCount: Int, spaceCount: Int) = TeamDto(
    id = this.id!!,
    name = this.name,
    slug = this.slug,
    description = this.description,
    color = this.color,
    memberCount = memberCount,
    spaceCount = spaceCount,
    createdAt = this.createdAt
)

fun Team.toBadgeDto() = TeamBadgeDto(id = this.id!!, name = this.name, color = this.color)

fun User.toTeamMemberDto() = TeamMemberDto(
    userId = this.id!!,
    name = this.name,
    email = this.email,
    role = this.role.name,
    enabled = this.enabled
)

fun TeamSpacePermission.toDto() = TeamSpacePermissionDto(
    teamId = this.team.id!!,
    teamName = this.team.name,
    teamColor = this.team.color,
    spaceId = this.space.id!!,
    spaceName = this.space.name,
    spaceFullPath = this.space.getFullPath(),
    spaceType = this.space.type.name,
    permissionLevel = this.permissionLevel.name
)
