package com.docuvault.service

import com.docuvault.domain.space.PermissionLevel
import com.docuvault.domain.space.Space
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.SpacePermissionRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import org.springframework.stereotype.Service
import java.util.*

@Service
class PermissionService(
    private val spacePermissionRepository: SpacePermissionRepository,
    private val spaceRepository: SpaceRepository
) {
    /**
     * Gets the effective permission for a user on a space.
     * Checks direct permission first, then traverses up the hierarchy.
     * Returns null if no permission is found at any level.
     */
    fun getEffectivePermission(userId: UUID, spaceId: UUID): PermissionLevel? {
        val space = spaceRepository.findById(spaceId).orElse(null) ?: return null
        return getEffectivePermissionForSpace(userId, space)
    }

    private fun getEffectivePermissionForSpace(userId: UUID, space: Space): PermissionLevel? {
        // Check direct permission first
        val directPermission = spacePermissionRepository.findByUserIdAndSpaceId(userId, space.id!!)
        if (directPermission != null) {
            return directPermission.permissionLevel
        }

        // Check parent permission (inheritance)
        val parent = space.parent
        if (parent != null) {
            return getEffectivePermissionForSpace(userId, parent)
        }

        return null
    }

    /**
     * Checks if a user has at least the required permission level on a space.
     * Takes inheritance into account.
     */
    fun hasPermission(userId: UUID, spaceId: UUID, requiredLevel: PermissionLevel): Boolean {
        val effectiveLevel = getEffectivePermission(userId, spaceId) ?: return false
        return effectiveLevel.ordinal >= requiredLevel.ordinal
    }

    /**
     * Checks if a user has access to a space (any permission level).
     * Super admins always have access.
     */
    fun hasAccess(userId: UUID, spaceId: UUID, userRole: UserRole): Boolean {
        if (userRole == UserRole.SUPER_ADMIN) return true
        return getEffectivePermission(userId, spaceId) != null
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
     * Returns spaces where the user has direct permission or inherited permission.
     */
    fun getAccessibleSpaces(userId: UUID, userRole: UserRole): List<Space> {
        if (userRole == UserRole.SUPER_ADMIN) {
            return spaceRepository.findAll()
        }

        // Get spaces with direct permissions
        val directAccessSpaces = spaceRepository.findAllByUserId(userId)

        val allAccessible = mutableSetOf<Space>()
        directAccessSpaces.forEach { space ->
            // Include the space itself and all its children
            allAccessible.add(space)
            addChildrenRecursively(space, allAccessible)
            // Include all ancestor groups so they appear as containers in the dashboard
            addAncestorsRecursively(space, allAccessible)
        }

        return allAccessible.toList()
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
