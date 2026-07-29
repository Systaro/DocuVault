package com.docuvault.service

import com.docuvault.domain.space.PermissionLevel
import com.docuvault.domain.space.Space
import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.SpacePermissionRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.TeamMembershipRepository
import com.docuvault.infrastructure.repository.TeamSpacePermissionRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.*

@Service
class PermissionService(
    private val spacePermissionRepository: SpacePermissionRepository,
    private val spaceRepository: SpaceRepository,
    private val teamMembershipRepository: TeamMembershipRepository,
    private val teamSpacePermissionRepository: TeamSpacePermissionRepository
) {
    /**
     * Gets the effective permission for a user on a space.
     * Combines the user's own grant with the grants of every team they belong to
     * (highest level wins), then traverses up the hierarchy if nothing is set here.
     * Returns null if no permission is found at any level.
     */
    @Transactional(readOnly = true)
    fun getEffectivePermission(userId: UUID, spaceId: UUID): PermissionLevel? {
        val space = spaceRepository.findById(spaceId).orElse(null) ?: return null
        return getEffectivePermissionForSpace(userId, space)
    }

    private fun getEffectivePermissionForSpace(userId: UUID, space: Space): PermissionLevel? {
        val teamIds = teamMembershipRepository.findTeamIdsByUserId(userId)
        return resolve(userId, teamIds, space)
    }

    private fun resolve(userId: UUID, teamIds: List<UUID>, space: Space): PermissionLevel? {
        val spaceId = space.id!!
        val levels = mutableListOf<PermissionLevel>()

        spacePermissionRepository.findByUserIdAndSpaceId(userId, spaceId)
            ?.let { levels.add(it.permissionLevel) }

        if (teamIds.isNotEmpty()) {
            teamSpacePermissionRepository.findAllBySpaceIdAndTeamIdIn(spaceId, teamIds)
                .forEach { levels.add(it.permissionLevel) }
        }

        // Strongest grant at this level wins; only fall back to the parent when
        // neither the user nor any of their teams has a say here.
        levels.maxByOrNull { it.ordinal }?.let { return it }

        val parent = space.parent ?: return null
        return resolve(userId, teamIds, parent)
    }

    /**
     * Checks if a user has at least the required permission level on a space.
     * Takes inheritance and team membership into account.
     */
    fun hasPermission(userId: UUID, spaceId: UUID, requiredLevel: PermissionLevel): Boolean {
        val effectiveLevel = getEffectivePermission(userId, spaceId) ?: return false
        return effectiveLevel.ordinal >= requiredLevel.ordinal
    }

    /**
     * Checks if a user has access to a space (any permission level).
     * Super admins always have access.
     * For groups, also returns true if the user has access to any descendant space.
     */
    @Transactional(readOnly = true)
    fun hasAccess(userId: UUID, spaceId: UUID, userRole: UserRole): Boolean {
        if (userRole == UserRole.SUPER_ADMIN) return true
        return getAccessibleSpaces(userId, userRole).any { it.id == spaceId }
    }

    /**
     * Checks if a user has edit access to a space.
     * Requires EDIT or ADMIN permission level.
     * Super admins always have edit access.
     */
    fun hasEditAccess(userId: UUID, spaceId: UUID, userRole: UserRole): Boolean {
        if (userRole == UserRole.SUPER_ADMIN) return true
        return hasPermission(userId, spaceId, PermissionLevel.EDIT)
    }

    /**
     * Checks if a user has admin access to a space.
     * Requires ADMIN permission level.
     * Super admins always have admin access.
     */
    fun hasAdminAccess(userId: UUID, spaceId: UUID, userRole: UserRole): Boolean {
        if (userRole == UserRole.SUPER_ADMIN) return true
        return hasPermission(userId, spaceId, PermissionLevel.ADMIN)
    }

    /**
     * Gets all spaces a user can access, considering hierarchy.
     * Returns spaces where the user has a direct grant, a grant through one of
     * their teams, or an inherited permission from an ancestor of either.
     */
    @Transactional(readOnly = true)
    fun getAccessibleSpaces(userId: UUID, userRole: UserRole): List<Space> {
        if (userRole == UserRole.SUPER_ADMIN) {
            return spaceRepository.findAll()
        }

        val grantedSpaces = getGrantedSpaces(userId)

        val allAccessible = mutableSetOf<Space>()
        grantedSpaces.forEach { space ->
            // Include the space itself and all its children
            allAccessible.add(space)
            addChildrenRecursively(space, allAccessible)
            // Include all ancestor groups so they appear as containers in the dashboard
            addAncestorsRecursively(space, allAccessible)
        }

        return allAccessible.toList()
    }

    /**
     * Spaces the user was explicitly granted, directly or through a team.
     * Unlike [getAccessibleSpaces] this does not expand children or ancestors.
     */
    @Transactional(readOnly = true)
    fun getGrantedSpaces(userId: UUID): List<Space> =
        (spaceRepository.findAllByUserId(userId) + spaceRepository.findAllByTeamMemberUserId(userId))
            .distinctBy { it.id }

    /**
     * Everyone holding a grant on this space — directly or through a team.
     * Used to resolve notification recipients; does not walk the hierarchy.
     */
    @Transactional(readOnly = true)
    fun membersOf(space: Space): Set<User> {
        val spaceId = space.id!!
        val members = mutableSetOf<User>()
        members += spacePermissionRepository.findAllBySpaceId(spaceId).map { it.user }
        members += teamSpacePermissionRepository.findUsersBySpaceId(spaceId)
        return members
    }

    private fun addChildrenRecursively(space: Space, collection: MutableSet<Space>) {
        space.children.forEach { child ->
            collection.add(child)
            addChildrenRecursively(child, collection)
        }
    }

    private fun addAncestorsRecursively(space: Space, collection: MutableSet<Space>) {
        val parent = space.parent ?: return
        collection.add(parent)
        addAncestorsRecursively(parent, collection)
    }
}
