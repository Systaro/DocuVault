package com.docuvault.service

import com.docuvault.domain.space.PermissionLevel
import com.docuvault.domain.space.Space
import com.docuvault.domain.space.SpaceType
import com.docuvault.domain.team.Team
import com.docuvault.domain.user.User
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.SpacePermissionRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.TeamMembershipRepository
import com.docuvault.infrastructure.repository.TeamSpacePermissionRepository
import com.docuvault.infrastructure.repository.UserRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.*

/**
 * A person who can reach a space, and where their access comes from.
 * [viaSpace] is the space the grant is defined on — the space itself or an
 * ancestor it was inherited from; null for super admins, who hold no grant.
 * [viaTeam] is set when the grant reached them through a team rather than directly.
 */
data class SpaceMember(
    val user: User,
    val level: PermissionLevel,
    val viaSpace: Space?,
    val viaTeam: Team?,
    val superAdmin: Boolean = false
)

@Service
class PermissionService(
    private val spacePermissionRepository: SpacePermissionRepository,
    private val spaceRepository: SpaceRepository,
    private val teamMembershipRepository: TeamMembershipRepository,
    private val teamSpacePermissionRepository: TeamSpacePermissionRepository,
    private val userRepository: UserRepository
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
     * The repositories behind [spaceId] that the user may actually read: the
     * space itself for a repository, or every readable descendant repository
     * for a group.
     *
     * [hasAccess] alone is not enough for a group. It answers yes as soon as the
     * user can reach any one child, and expanding such a group to all of its
     * children would hand out the siblings too. Empty means no access.
     */
    @Transactional(readOnly = true)
    fun readableRepositoryIds(userId: UUID, userRole: UserRole, spaceId: UUID): List<UUID> {
        val accessible = getAccessibleSpaces(userId, userRole)
        val space = accessible.firstOrNull { it.id == spaceId } ?: return emptyList()
        if (space.type != SpaceType.GROUP) return listOf(spaceId)

        val childrenByParent = accessible.groupBy { it.parent?.id }
        val repositoryIds = mutableListOf<UUID>()
        fun collect(parentId: UUID) {
            childrenByParent[parentId].orEmpty().forEach { child ->
                if (child.type == SpaceType.GROUP) collect(child.id!!) else repositoryIds.add(child.id!!)
            }
        }
        collect(spaceId)
        return repositoryIds
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

    /**
     * Everyone who can actually reach this space, with the grant that gets them
     * there. Unlike [membersOf] this walks the hierarchy the same way [resolve]
     * does, so a space that carries no grants of its own still lists the people
     * who reach it through an ancestor — without this a child space reads as
     * having no members at all.
     *
     * Per user the nearest level in the chain wins, mirroring [resolve]: a grant
     * on the space itself hides an inherited one, and at any single level the
     * strongest of their direct and team grants applies. Super admins are folded
     * in at the end; they hold no rows but reach everything.
     */
    @Transactional(readOnly = true)
    fun effectiveMembersOf(space: Space): List<SpaceMember> {
        val found = LinkedHashMap<UUID, SpaceMember>()

        var current: Space? = space
        while (current != null) {
            val level = current
            val atThisLevel = mutableListOf<SpaceMember>()

            spacePermissionRepository.findAllBySpaceId(level.id!!).forEach {
                atThisLevel += SpaceMember(it.user, it.permissionLevel, level, null)
            }
            teamSpacePermissionRepository.findAllBySpaceId(level.id!!).forEach { grant ->
                teamMembershipRepository.findAllByTeamId(grant.team.id!!).forEach {
                    atThisLevel += SpaceMember(it.user, grant.permissionLevel, level, grant.team)
                }
            }

            // Only users with no nearer grant are settled here; among the grants
            // at this level the strongest wins.
            atThisLevel
                .filter { it.user.enabled && !found.containsKey(it.user.id!!) }
                .groupBy { it.user.id!! }
                .forEach { (userId, grants) ->
                    found[userId] = grants.maxBy { it.level.ordinal }
                }

            current = level.parent
        }

        userRepository.findAllByRoleAndEnabledTrue(UserRole.SUPER_ADMIN).forEach {
            found.putIfAbsent(it.id!!, SpaceMember(it, PermissionLevel.ADMIN, null, null, superAdmin = true))
        }

        return found.values.sortedWith(
            compareByDescending<SpaceMember> { it.level.ordinal }.thenBy { it.user.name.lowercase() }
        )
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
