package com.docuvault.api.spaces

import com.docuvault.domain.space.PermissionLevel
import com.docuvault.domain.space.Space
import com.docuvault.domain.space.SpacePermission
import com.docuvault.domain.space.SpaceType
import com.docuvault.domain.user.UserRole
import com.docuvault.infrastructure.repository.DocumentRepository
import com.docuvault.api.teams.TeamSpacePermissionDto
import com.docuvault.api.teams.toDto as teamPermissionToDto
import com.docuvault.infrastructure.repository.SpacePermissionRepository
import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.TeamRepository
import com.docuvault.infrastructure.repository.TeamSpacePermissionRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.PermissionService
import com.docuvault.service.TeamService
import com.docuvault.service.git.GitLabService
import com.docuvault.service.git.GitOperationException
import com.docuvault.service.git.GitService
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.transaction.annotation.Transactional
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.web.bind.annotation.*
import org.springframework.web.multipart.MultipartFile
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest
import software.amazon.awssdk.services.s3.model.GetObjectRequest
import software.amazon.awssdk.services.s3.model.PutObjectRequest
import java.time.Instant
import java.util.*

@RestController
@RequestMapping("/spaces")
class SpaceController(
    private val spaceRepository: SpaceRepository,
    private val spacePermissionRepository: SpacePermissionRepository,
    private val teamRepository: TeamRepository,
    private val teamPermissionRepository: TeamSpacePermissionRepository,
    private val teamService: TeamService,
    private val userRepository: UserRepository,
    private val documentRepository: DocumentRepository,
    private val gitLabService: GitLabService,
    private val gitService: GitService,
    private val permissionService: PermissionService,
    private val s3Client: S3Client,
    @Value("\${minio.bucket}") private val logoBucket: String
) {
    private val logger = org.slf4j.LoggerFactory.getLogger(SpaceController::class.java)
    @GetMapping
    fun listSpaces(
        @AuthenticationPrincipal userDetails: UserDetails,
        @RequestParam(required = false) parentId: UUID?,
        @RequestParam(required = false) topLevel: Boolean?
    ): ResponseEntity<List<SpaceDto>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val spaces = when {
            topLevel == true -> {
                if (user.role == UserRole.SUPER_ADMIN) {
                    spaceRepository.findByParentIdIsNull()
                } else {
                    permissionService.getAccessibleSpaces(user.id!!, user.role)
                        .filter { it.parent == null }
                }
            }
            parentId != null -> {
                if (!permissionService.hasAccess(user.id!!, parentId, user.role)) {
                    return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
                }
                spaceRepository.findByParentId(parentId)
            }
            else -> {
                if (user.role == UserRole.SUPER_ADMIN) {
                    spaceRepository.findAll()
                } else {
                    permissionService.getAccessibleSpaces(user.id!!, user.role)
                }
            }
        }

        return ResponseEntity.ok(spaces.map { it.toDto(
            documentCount = if (it.type == SpaceType.REPOSITORY) documentRepository.countBySpaceId(it.id!!) else 0,
            childCount = spaceRepository.countChildren(it.id!!)
        ) })
    }

    @GetMapping("/children/{parentId}")
    fun getChildren(
        @PathVariable parentId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<List<SpaceDto>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val accessibleIds = if (user.role == UserRole.SUPER_ADMIN) null
            else permissionService.getAccessibleSpaces(user.id!!, user.role).mapTo(mutableSetOf()) { it.id }

        if (accessibleIds != null && parentId !in accessibleIds) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val children = spaceRepository.findByParentId(parentId)
            .filter { accessibleIds == null || it.id in accessibleIds }
        return ResponseEntity.ok(children.map { it.toDto(
            documentCount = if (it.type == SpaceType.REPOSITORY) documentRepository.countBySpaceId(it.id!!) else 0,
            childCount = spaceRepository.countChildren(it.id!!)
        ) })
    }

    @GetMapping("/{id}")
    fun getSpace(
        @PathVariable id: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<SpaceDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        return ResponseEntity.ok(space.toDto(
            documentCount = if (space.type == SpaceType.REPOSITORY) documentRepository.countBySpaceId(space.id!!) else 0,
            childCount = spaceRepository.countChildren(space.id!!)
        ))
    }

    @GetMapping("/slug/{slug}")
    fun getSpaceBySlug(
        @PathVariable slug: String,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<SpaceDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findBySlug(slug)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        return ResponseEntity.ok(space.toDto(
            documentCount = if (space.type == SpaceType.REPOSITORY) documentRepository.countBySpaceId(space.id!!) else 0,
            childCount = spaceRepository.countChildren(space.id!!)
        ))
    }

    @GetMapping("/path/{*fullPath}")
    fun getSpaceByPath(
        @PathVariable fullPath: String,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<SpaceDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val slugs = fullPath.split("/").filter { it.isNotBlank() }
        if (slugs.isEmpty()) {
            return ResponseEntity.badRequest().build()
        }

        var currentSpace: Space? = spaceRepository.findBySlugAndParentIsNull(slugs[0])
        for (i in 1 until slugs.size) {
            if (currentSpace == null) break
            currentSpace = spaceRepository.findBySlugAndParentId(slugs[i], currentSpace.id)
        }

        if (currentSpace == null) {
            return ResponseEntity.notFound().build()
        }

        if (!permissionService.hasAccess(user.id!!, currentSpace.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        return ResponseEntity.ok(currentSpace.toDto(
            documentCount = if (currentSpace.type == SpaceType.REPOSITORY) documentRepository.countBySpaceId(currentSpace.id!!) else 0,
            childCount = spaceRepository.countChildren(currentSpace.id!!)
        ))
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    fun createSpace(
        @AuthenticationPrincipal userDetails: UserDetails,
        @Valid @RequestBody request: CreateSpaceRequest
    ): ResponseEntity<Any> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val spaceType = try {
            SpaceType.valueOf(request.type.uppercase())
        } catch (e: IllegalArgumentException) {
            return ResponseEntity.badRequest().body(mapOf("message" to "Invalid space type: ${request.type}"))
        }

        // Validate parent
        val parent = if (request.parentId != null) {
            val p = spaceRepository.findById(request.parentId).orElse(null)
                ?: return ResponseEntity.badRequest().body(mapOf("message" to "Parent space not found"))

            // Check parent depth - max 2 levels (Group → Subgroup → Repo)
            if (p.getDepth() >= 1 && spaceType == SpaceType.GROUP) {
                return ResponseEntity.badRequest().body(mapOf("message" to "Groups can only be nested 2 levels deep"))
            }
            if (p.getDepth() >= 2) {
                return ResponseEntity.badRequest().body(mapOf("message" to "Maximum nesting depth exceeded (2 levels)"))
            }

            // Check user has permission on parent
            if (!permissionService.hasEditAccess(user.id!!, p.id!!, user.role)) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
            }

            p
        } else {
            // Top-level must be a group
            if (spaceType == SpaceType.REPOSITORY) {
                return ResponseEntity.badRequest().body(mapOf("message" to "Repositories must be inside a group"))
            }
            null
        }

        // Check slug uniqueness within parent scope
        val existingSpace = if (parent != null) {
            spaceRepository.findBySlugAndParentId(request.slug, parent.id)
        } else {
            spaceRepository.findBySlugAndParentIsNull(request.slug)
        }
        if (existingSpace != null) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(mapOf("message" to "A space with this slug already exists at this level"))
        }

        // Groups cannot have git sync settings
        if (spaceType == SpaceType.GROUP && (request.gitlabProjectId != null || request.gitlabUrl != null)) {
            return ResponseEntity.badRequest().body(mapOf("message" to "Groups cannot have Git repository settings"))
        }

        val gitlabProject = request.gitlabProjectId?.let { gitLabService.getProject(it) }

        val space = Space(
            name = request.name,
            slug = request.slug,
            description = request.description,
            type = spaceType,
            parent = parent,
            gitlabProjectId = if (spaceType == SpaceType.REPOSITORY) request.gitlabProjectId else null,
            gitlabUrl = if (spaceType == SpaceType.REPOSITORY) (gitlabProject?.httpUrlToRepo ?: request.gitlabUrl) else null,
            branch = request.branch ?: gitlabProject?.defaultBranch ?: "main",
            syncEnabled = if (spaceType == SpaceType.REPOSITORY) (request.syncEnabled ?: true) else false,
            createdBy = user
        )

        val savedSpace = spaceRepository.save(space)

        // Grant admin permission to creator (only if no parent, otherwise inherit)
        if (parent == null) {
            val permission = SpacePermission(
                user = user,
                space = savedSpace,
                permissionLevel = PermissionLevel.ADMIN
            )
            spacePermissionRepository.save(permission)
        }

        // Clone the repository if GitLab URL is provided (only for repos)
        if (savedSpace.type == SpaceType.REPOSITORY && savedSpace.gitlabUrl != null) {
            try {
                gitService.cloneRepository(savedSpace)
                logger.info("Successfully cloned repository for new space '${savedSpace.name}'")
            } catch (e: GitOperationException) {
                logger.warn("Failed to clone repository for space '${savedSpace.name}': ${e.message}")
                savedSpace.lastSyncError = e.message ?: "Failed to clone repository"
                spaceRepository.save(savedSpace)
            } catch (e: Exception) {
                logger.error("Unexpected error cloning repository for space '${savedSpace.name}': ${e.message}", e)
                savedSpace.lastSyncError = "Failed to clone repository"
                spaceRepository.save(savedSpace)
            }
        }

        return ResponseEntity.status(HttpStatus.CREATED).body(savedSpace.toDto(childCount = 0))
    }

    @PutMapping("/{id}")
    @Transactional
    fun updateSpace(
        @PathVariable id: UUID,
        @AuthenticationPrincipal userDetails: UserDetails,
        @Valid @RequestBody request: UpdateSpaceRequest
    ): ResponseEntity<Any> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        var space = spaceRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasAdminAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        // Handle parent change (move operation)
        val wantsParentChange = request.parentId != null || request.clearParent == true
        if (wantsParentChange) {
            val newParentId = if (request.clearParent == true) null else request.parentId

            // Validate the move
            if (newParentId != null) {
                val newParent = spaceRepository.findById(newParentId).orElse(null)
                    ?: return ResponseEntity.badRequest().body(mapOf("message" to "Parent group not found"))

                // Cannot move into itself
                if (newParentId == space.id) {
                    return ResponseEntity.badRequest().body(mapOf("message" to "Cannot move a space into itself"))
                }

                // Parent must be a group
                if (newParent.type != SpaceType.GROUP) {
                    return ResponseEntity.badRequest().body(mapOf("message" to "Parent must be a group"))
                }

                // Check depth constraints
                val parentDepth = newParent.getDepth()
                if (space.type == SpaceType.GROUP && parentDepth >= 1) {
                    return ResponseEntity.badRequest().body(mapOf("message" to "Groups can only be nested 2 levels deep"))
                }
                if (parentDepth >= 2) {
                    return ResponseEntity.badRequest().body(mapOf("message" to "Maximum nesting depth exceeded"))
                }

                // Check slug uniqueness in new location
                val existing = spaceRepository.findBySlugAndParentIdExcluding(space.slug, newParentId, space.id!!)
                if (existing != null) {
                    return ResponseEntity.badRequest().body(mapOf("message" to "A space with this slug already exists in the target group"))
                }
            } else {
                // Moving to top level - only groups allowed at top level
                if (space.type == SpaceType.REPOSITORY) {
                    return ResponseEntity.badRequest().body(mapOf("message" to "Repositories cannot be at top level"))
                }

                // Check slug uniqueness at top level
                val existing = spaceRepository.findBySlugAndParentIsNullExcluding(space.slug, space.id!!)
                if (existing != null) {
                    return ResponseEntity.badRequest().body(mapOf("message" to "A space with this slug already exists at top level"))
                }
            }

            // Perform the move
            spaceRepository.updateParent(space.id!!, newParentId)

            // Reload the space to get updated data
            space = spaceRepository.findById(id).orElse(null)!!
        }

        request.name?.let { space.name = it }
        request.description?.let { space.description = it }

        // Only allow sync settings for repositories
        if (space.type == SpaceType.REPOSITORY) {
            request.branch?.let { space.branch = it }
            request.syncEnabled?.let { space.syncEnabled = it }
            request.syncIntervalMinutes?.let { space.syncIntervalMinutes = it }
        }

        space.updatedAt = Instant.now()

        val updated = spaceRepository.save(space)
        return ResponseEntity.ok(updated.toDto(
            documentCount = if (space.type == SpaceType.REPOSITORY) documentRepository.countBySpaceId(space.id!!) else 0,
            childCount = spaceRepository.countChildren(space.id!!)
        ))
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN', 'ORG_ADMIN')")
    fun deleteSpace(
        @PathVariable id: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<Unit> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasAdminAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        // Delete local repository (only for repos)
        if (space.type == SpaceType.REPOSITORY) {
            gitService.deleteRepository(space.id!!)
        }

        // Note: children are deleted via CASCADE in database
        spaceRepository.delete(space)
        return ResponseEntity.noContent().build()
    }

    @GetMapping("/{id}/permissions")
    fun getSpacePermissions(
        @PathVariable id: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<List<SpacePermissionDto>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!spaceRepository.existsById(id)) {
            return ResponseEntity.notFound().build()
        }

        if (!permissionService.hasAdminAccess(user.id!!, id, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val permissions = spacePermissionRepository.findAllBySpaceId(id)
        return ResponseEntity.ok(permissions.map { it.toDto() })
    }

    @PostMapping("/{id}/permissions")
    fun addSpacePermission(
        @PathVariable id: UUID,
        @AuthenticationPrincipal userDetails: UserDetails,
        @Valid @RequestBody request: AddPermissionRequest
    ): ResponseEntity<SpacePermissionDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasAdminAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val targetUser = userRepository.findById(request.userId).orElse(null)
            ?: return ResponseEntity.badRequest().build()

        val existingPermission = spacePermissionRepository.findByUserIdAndSpaceId(request.userId, id)
        if (existingPermission != null) {
            existingPermission.permissionLevel = PermissionLevel.valueOf(request.permissionLevel)
            val updated = spacePermissionRepository.save(existingPermission)
            return ResponseEntity.ok(updated.toDto())
        }

        val permission = SpacePermission(
            user = targetUser,
            space = space,
            permissionLevel = PermissionLevel.valueOf(request.permissionLevel)
        )

        val saved = spacePermissionRepository.save(permission)
        return ResponseEntity.status(HttpStatus.CREATED).body(saved.toDto())
    }

    @DeleteMapping("/{id}/permissions/{userId}")
    @Transactional
    fun removeSpacePermission(
        @PathVariable id: UUID,
        @PathVariable userId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<Unit> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!spaceRepository.existsById(id)) {
            return ResponseEntity.notFound().build()
        }

        if (!permissionService.hasAdminAccess(user.id!!, id, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        spacePermissionRepository.deleteByUserIdAndSpaceId(userId, id)
        return ResponseEntity.noContent().build()
    }

    @GetMapping("/{id}/team-permissions")
    @Transactional(readOnly = true)
    fun getSpaceTeamPermissions(
        @PathVariable id: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<List<TeamSpacePermissionDto>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!spaceRepository.existsById(id)) {
            return ResponseEntity.notFound().build()
        }

        if (!permissionService.hasAdminAccess(user.id!!, id, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        return ResponseEntity.ok(teamPermissionRepository.findAllBySpaceId(id).map { it.teamPermissionToDto() })
    }

    @PostMapping("/{id}/team-permissions")
    @Transactional
    fun addSpaceTeamPermission(
        @PathVariable id: UUID,
        @AuthenticationPrincipal userDetails: UserDetails,
        @Valid @RequestBody request: AddTeamPermissionRequest
    ): ResponseEntity<TeamSpacePermissionDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasAdminAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val team = teamRepository.findById(request.teamId).orElse(null)
            ?: return ResponseEntity.badRequest().build()

        val level = try {
            PermissionLevel.valueOf(request.permissionLevel)
        } catch (_: IllegalArgumentException) {
            return ResponseEntity.badRequest().build()
        }

        val saved = teamService.grantSpace(team, space.id, level)
            ?: return ResponseEntity.badRequest().build()

        return ResponseEntity.ok(saved.teamPermissionToDto())
    }

    @DeleteMapping("/{id}/team-permissions/{teamId}")
    @Transactional
    fun removeSpaceTeamPermission(
        @PathVariable id: UUID,
        @PathVariable teamId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<Unit> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (!spaceRepository.existsById(id)) {
            return ResponseEntity.notFound().build()
        }

        if (!permissionService.hasAdminAccess(user.id!!, id, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        teamPermissionRepository.deleteByTeamIdAndSpaceId(teamId, id)
        return ResponseEntity.noContent().build()
    }

    @PostMapping("/{id}/logo", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun uploadLogo(
        @PathVariable id: UUID,
        @AuthenticationPrincipal userDetails: UserDetails,
        @RequestParam("file") file: MultipartFile
    ): ResponseEntity<SpaceDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasAdminAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val allowedTypes = setOf("image/png", "image/jpeg", "image/svg+xml", "image/webp")
        if (file.contentType !in allowedTypes) {
            return ResponseEntity.badRequest().build()
        }
        if (file.size > 2 * 1024 * 1024) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).build()
        }

        val ext = when (file.contentType) {
            "image/png" -> "png"
            "image/jpeg" -> "jpg"
            "image/svg+xml" -> "svg"
            "image/webp" -> "webp"
            else -> "png"
        }
        val key = "${space.id}.$ext"

        // Delete old logo if it exists with different extension
        space.logoUrl?.let { oldUrl ->
            val oldKey = oldUrl.substringAfterLast("/")
            if (oldKey != key) {
                try { s3Client.deleteObject(DeleteObjectRequest.builder().bucket(logoBucket).key(oldKey).build()) } catch (_: Exception) {}
            }
        }

        s3Client.putObject(
            PutObjectRequest.builder()
                .bucket(logoBucket)
                .key(key)
                .contentType(file.contentType)
                .build(),
            software.amazon.awssdk.core.sync.RequestBody.fromBytes(file.bytes)
        )

        space.logoUrl = "/api/spaces/${space.id}/logo"
        space.updatedAt = Instant.now()
        val updated = spaceRepository.save(space)
        return ResponseEntity.ok(updated.toDto(
            documentCount = if (space.type == SpaceType.REPOSITORY) documentRepository.countBySpaceId(space.id!!) else 0,
            childCount = spaceRepository.countChildren(space.id!!)
        ))
    }

    @GetMapping("/{id}/logo")
    fun getLogo(@PathVariable id: UUID): ResponseEntity<ByteArray> {
        val space = spaceRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (space.logoUrl == null) {
            return ResponseEntity.notFound().build()
        }

        // Find the logo object by trying known extensions
        for (ext in listOf("png", "jpg", "svg", "webp")) {
            val key = "${space.id}.$ext"
            try {
                val response = s3Client.getObject(GetObjectRequest.builder().bucket(logoBucket).key(key).build())
                val bytes = response.readAllBytes()
                val contentType = when (ext) {
                    "png" -> MediaType.IMAGE_PNG
                    "jpg" -> MediaType.IMAGE_JPEG
                    "svg" -> MediaType.valueOf("image/svg+xml")
                    "webp" -> MediaType.valueOf("image/webp")
                    else -> MediaType.APPLICATION_OCTET_STREAM
                }
                return ResponseEntity.ok().contentType(contentType).body(bytes)
            } catch (_: Exception) {
                continue
            }
        }
        return ResponseEntity.notFound().build()
    }

    @DeleteMapping("/{id}/logo")
    fun deleteLogo(
        @PathVariable id: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<SpaceDto> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(id).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasAdminAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        // Delete all possible logo files
        for (ext in listOf("png", "jpg", "svg", "webp")) {
            try { s3Client.deleteObject(DeleteObjectRequest.builder().bucket(logoBucket).key("${space.id}.$ext").build()) } catch (_: Exception) {}
        }

        space.logoUrl = null
        space.updatedAt = Instant.now()
        val updated = spaceRepository.save(space)
        return ResponseEntity.ok(updated.toDto(
            documentCount = if (space.type == SpaceType.REPOSITORY) documentRepository.countBySpaceId(space.id!!) else 0,
            childCount = spaceRepository.countChildren(space.id!!)
        ))
    }

    @GetMapping("/{spaceId}/my-permission")
    fun getMyPermission(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails
    ): ResponseEntity<Map<String, String>> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        if (user.role == UserRole.SUPER_ADMIN) {
            return ResponseEntity.ok(mapOf("level" to "ADMIN"))
        }

        val level = permissionService.getEffectivePermission(user.id!!, spaceId)
            ?: return ResponseEntity.status(HttpStatus.FORBIDDEN).build()

        return ResponseEntity.ok(mapOf("level" to level.name))
    }
}

data class CreateSpaceRequest(
    @field:NotBlank(message = "Name is required")
    val name: String,

    @field:NotBlank(message = "Slug is required")
    val slug: String,

    val description: String? = null,
    val type: String = "REPOSITORY",
    val parentId: UUID? = null,
    val gitlabProjectId: Int? = null,
    val gitlabUrl: String? = null,
    val branch: String? = null,
    val syncEnabled: Boolean? = true
)

data class UpdateSpaceRequest(
    val name: String? = null,
    val description: String? = null,
    val parentId: UUID? = null,
    val clearParent: Boolean? = null,  // Set to true to move to top level
    val branch: String? = null,
    val syncEnabled: Boolean? = null,
    val syncIntervalMinutes: Int? = null
)

data class AddPermissionRequest(
    val userId: UUID,
    val permissionLevel: String
)

data class AddTeamPermissionRequest(
    val teamId: UUID,
    val permissionLevel: String
)

data class SpaceDto(
    val id: UUID,
    val name: String,
    val slug: String,
    val description: String?,
    val type: String,
    val parentId: UUID?,
    val parentSlug: String?,
    val fullPath: String,
    val gitlabProjectId: Int?,
    val gitlabUrl: String?,
    val branch: String,
    val syncEnabled: Boolean,
    val syncIntervalMinutes: Int,
    val lastSyncedAt: Instant?,
    val createdAt: Instant,
    val updatedAt: Instant,
    val gitError: String? = null,
    val documentCount: Long = 0,
    val childCount: Long = 0,
    val logoUrl: String? = null,
    val lastSyncFilesChanged: Int? = null,
    val syncStatus: String = "OK",
    val conflictMrUrl: String? = null,
    val conflictBranch: String? = null,
    val conflictDetectedAt: Instant? = null
)

data class SpacePermissionDto(
    val id: UUID,
    val userId: UUID,
    val userName: String,
    val userEmail: String,
    val permissionLevel: String
)

fun Space.toDto(gitError: String? = null, documentCount: Long = 0, childCount: Long = 0) = SpaceDto(
    id = this.id!!,
    name = this.name,
    slug = this.slug,
    description = this.description,
    type = this.type.name,
    parentId = this.parent?.id,
    parentSlug = this.parent?.slug,
    fullPath = this.getFullPath(),
    gitlabProjectId = this.gitlabProjectId,
    gitlabUrl = this.gitlabUrl,
    branch = this.branch,
    syncEnabled = this.syncEnabled,
    syncIntervalMinutes = this.syncIntervalMinutes,
    lastSyncedAt = this.lastSyncedAt,
    createdAt = this.createdAt,
    updatedAt = this.updatedAt,
    gitError = gitError ?: this.lastSyncError,
    documentCount = documentCount,
    childCount = childCount,
    logoUrl = this.logoUrl,
    lastSyncFilesChanged = this.lastSyncFilesChanged,
    syncStatus = this.syncStatus.name,
    conflictMrUrl = this.conflictMrUrl,
    conflictBranch = this.conflictBranch,
    conflictDetectedAt = this.conflictDetectedAt
)

fun SpacePermission.toDto() = SpacePermissionDto(
    id = this.id!!,
    userId = this.user.id!!,
    userName = this.user.name,
    userEmail = this.user.email,
    permissionLevel = this.permissionLevel.name
)
