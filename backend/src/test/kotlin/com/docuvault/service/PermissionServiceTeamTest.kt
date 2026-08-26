package com.docuvault.service

import com.docuvault.domain.space.PermissionLevel
import com.docuvault.domain.space.Space
import com.docuvault.domain.space.SpacePermission
import com.docuvault.domain.space.SpaceType
import com.docuvault.domain.team.Team
import com.docuvault.domain.team.TeamSpacePermission
import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.SpacePermissionRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.TeamMembershipRepository
import com.docuvault.infrastructure.repository.TeamSpacePermissionRepository
import com.docuvault.infrastructure.repository.UserRepository
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import java.util.*

/**
 * Access can now arrive two ways — the user's own grant or any team they're in.
 * These pin down how the two combine, since getting it wrong either leaks a
 * space or silently locks people out of one they should reach.
 *
 * Unstubbed repository calls fall back to Mockito's defaults (null / empty
 * list), which is exactly "no grant here", so only the positive cases are set up.
 */
class PermissionServiceTeamTest {

    private val spacePermissionRepository = mock(SpacePermissionRepository::class.java)
    private val spaceRepository = mock(SpaceRepository::class.java)
    private val membershipRepository = mock(TeamMembershipRepository::class.java)
    private val teamPermissionRepository = mock(TeamSpacePermissionRepository::class.java)
    private val userRepository = mock(UserRepository::class.java)

    private val service = PermissionService(
        spacePermissionRepository,
        spaceRepository,
        membershipRepository,
        teamPermissionRepository,
        userRepository
    )

    private val owner = User(id = UUID.randomUUID(), email = "owner@x.io", passwordHash = "h", name = "Owner")
    private val user = User(id = UUID.randomUUID(), email = "u@x.io", passwordHash = "h", name = "User")
    private val team = Team(id = UUID.randomUUID(), name = "Engineering", slug = "engineering")

    private fun space(name: String, parent: Space? = null) = Space(
        id = UUID.randomUUID(),
        name = name,
        slug = name.lowercase(),
        type = if (parent == null) SpaceType.GROUP else SpaceType.REPOSITORY,
        parent = parent,
        createdBy = owner
    ).also { `when`(spaceRepository.findById(it.id!!)).thenReturn(Optional.of(it)) }

    private fun inTeam() {
        `when`(membershipRepository.findTeamIdsByUserId(user.id!!)).thenReturn(listOf(team.id!!))
    }

    private fun directGrant(s: Space, level: PermissionLevel) {
        `when`(spacePermissionRepository.findByUserIdAndSpaceId(user.id!!, s.id!!))
            .thenReturn(SpacePermission(user = user, space = s, permissionLevel = level))
    }

    private fun teamGrant(s: Space, level: PermissionLevel) {
        `when`(teamPermissionRepository.findAllBySpaceIdAndTeamIdIn(s.id!!, listOf(team.id!!)))
            .thenReturn(listOf(TeamSpacePermission(team = team, space = s, permissionLevel = level)))
    }

    @Test
    fun `team grant applies when the user has no direct permission`() {
        val repo = space("docs")
        inTeam()
        teamGrant(repo, PermissionLevel.EDIT)

        assertEquals(PermissionLevel.EDIT, service.getEffectivePermission(user.id!!, repo.id!!))
        assertTrue(service.hasEditAccess(user.id!!, repo.id!!, UserRole.VIEWER))
    }

    @Test
    fun `the stronger of direct and team grant wins`() {
        val repo = space("docs")
        inTeam()
        directGrant(repo, PermissionLevel.VIEW)
        teamGrant(repo, PermissionLevel.ADMIN)

        assertEquals(PermissionLevel.ADMIN, service.getEffectivePermission(user.id!!, repo.id!!))
        assertTrue(service.hasAdminAccess(user.id!!, repo.id!!, UserRole.VIEWER))
    }

    @Test
    fun `a weaker team grant never downgrades a direct grant`() {
        val repo = space("docs")
        inTeam()
        directGrant(repo, PermissionLevel.ADMIN)
        teamGrant(repo, PermissionLevel.VIEW)

        assertEquals(PermissionLevel.ADMIN, service.getEffectivePermission(user.id!!, repo.id!!))
    }

    @Test
    fun `a team grant on a parent group is inherited by the child space`() {
        val group = space("acme")
        val repo = space("docs", parent = group)
        inTeam()
        teamGrant(group, PermissionLevel.EDIT)

        assertEquals(PermissionLevel.EDIT, service.getEffectivePermission(user.id!!, repo.id!!))
    }

    @Test
    fun `a direct grant on the child still beats the team grant on its parent`() {
        val group = space("acme")
        val repo = space("docs", parent = group)
        inTeam()
        directGrant(repo, PermissionLevel.VIEW)
        teamGrant(group, PermissionLevel.ADMIN)

        // The child level answers first — the parent is only consulted when
        // nothing at all is set on the child.
        assertEquals(PermissionLevel.VIEW, service.getEffectivePermission(user.id!!, repo.id!!))
    }

    @Test
    fun `no membership and no direct grant means no access`() {
        val repo = space("docs")

        assertNull(service.getEffectivePermission(user.id!!, repo.id!!))
        assertFalse(service.hasEditAccess(user.id!!, repo.id!!, UserRole.VIEWER))
    }

    @Test
    fun `granted spaces combine direct and team-derived access without duplicates`() {
        val shared = space("shared")
        val personal = space("personal")
        `when`(spaceRepository.findAllByUserId(user.id!!)).thenReturn(listOf(personal, shared))
        `when`(spaceRepository.findAllByTeamMemberUserId(user.id!!)).thenReturn(listOf(shared))

        val granted = service.getGrantedSpaces(user.id!!)

        assertEquals(2, granted.size)
        assertTrue(granted.any { it.id == personal.id })
        assertTrue(granted.any { it.id == shared.id })
    }

    @Test
    fun `space members include users reached through a team`() {
        val repo = space("docs")
        val direct = User(id = UUID.randomUUID(), email = "d@x.io", passwordHash = "h", name = "Direct")
        `when`(spacePermissionRepository.findAllBySpaceId(repo.id!!))
            .thenReturn(listOf(SpacePermission(user = direct, space = repo, permissionLevel = PermissionLevel.VIEW)))
        `when`(teamPermissionRepository.findUsersBySpaceId(repo.id!!)).thenReturn(listOf(user, direct))

        val members = service.membersOf(repo)

        assertEquals(setOf(direct, user), members)
    }
}
