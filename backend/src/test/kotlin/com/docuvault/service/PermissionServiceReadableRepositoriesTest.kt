package com.docuvault.service

import com.docuvault.domain.space.Space
import com.docuvault.domain.space.SpaceType
import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.SpacePermissionRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.TeamMembershipRepository
import com.docuvault.infrastructure.repository.TeamSpacePermissionRepository
import com.docuvault.infrastructure.repository.UserRepository
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import java.util.*

/**
 * Semantic search and the assistant expand a group into its repositories. A
 * user who can reach one child of a group "has access" to the group, so the
 * expansion is where a sibling repository would leak if it were not filtered.
 */
class PermissionServiceReadableRepositoriesTest {

    private val spaceRepository = mock(SpaceRepository::class.java)

    private val service = PermissionService(
        mock(SpacePermissionRepository::class.java),
        spaceRepository,
        mock(TeamMembershipRepository::class.java),
        mock(TeamSpacePermissionRepository::class.java),
        mock(UserRepository::class.java)
    )

    private val owner = User(id = UUID.randomUUID(), email = "owner@x.io", passwordHash = "h", name = "Owner")
    private val user = User(id = UUID.randomUUID(), email = "u@x.io", passwordHash = "h", name = "User")

    private val group = Space(id = UUID.randomUUID(), name = "Acme", slug = "acme", type = SpaceType.GROUP, createdBy = owner)
    private val open = child("open")
    private val secret = child("secret")

    private fun child(name: String) = Space(
        id = UUID.randomUUID(), name = name, slug = name, type = SpaceType.REPOSITORY, parent = group, createdBy = owner
    ).also { group.children.add(it) }

    private fun granted(vararg spaces: Space) {
        `when`(spaceRepository.findAllByUserId(user.id!!)).thenReturn(spaces.toList())
        `when`(spaceRepository.findAllByTeamMemberUserId(user.id!!)).thenReturn(emptyList())
    }

    @Test
    fun `a group expands only to the children the user can read`() {
        granted(open)

        assertEquals(listOf(open.id), service.readableRepositoryIds(user.id!!, UserRole.VIEWER, group.id!!))
    }

    @Test
    fun `a grant on the group reaches every child`() {
        granted(group)

        assertEquals(
            setOf(open.id, secret.id),
            service.readableRepositoryIds(user.id!!, UserRole.VIEWER, group.id!!).toSet()
        )
    }

    @Test
    fun `a repository the user cannot read yields nothing`() {
        granted(open)

        assertTrue(service.readableRepositoryIds(user.id!!, UserRole.VIEWER, secret.id!!).isEmpty())
    }

    @Test
    fun `a super admin reads every repository in the group`() {
        `when`(spaceRepository.findAll()).thenReturn(listOf(group, open, secret))

        assertEquals(
            setOf(open.id, secret.id),
            service.readableRepositoryIds(user.id!!, UserRole.SUPER_ADMIN, group.id!!).toSet()
        )
    }
}
